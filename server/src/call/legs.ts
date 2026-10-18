import type { WebSocket } from 'ws';
import { ULAW_SILENCE } from '../audio/g711.js';
import { PacedSender } from '../audio/pacer.js';
import type { AudioFormat } from '../audio/pcm.js';
import type { EndReason, ServerMessage } from '../protocol.js';
import { EchoFilter } from '../util/echoFilter.js';
import { silentLogger, type Logger } from '../util/log.js';
import { newId } from '../util/misc.js';
import { ChunkReorderer } from '../util/reorder.js';
import { SerialQueue } from '../util/serialQueue.js';

/**
 * A "leg" is one participant's connection to the call: the app user's phone, a real phone line,
 * or a mirror (test) endpoint. Legs only know how to receive their person's audio and play audio
 * to them; everything smart (STT, translation, TTS) lives in Route.
 */
export abstract class Leg {
  readonly id = newId();
  abstract readonly kind: 'app' | 'phone' | 'mirror';
  /** Native audio format of this leg's transport. */
  abstract readonly format: AudioFormat;

  /** What this leg's *listener* wants to hear: translated speech (true) or the raw original (false). */
  listenTranslated = true;
  /** Texts we recently played to this person (used to spot speakerphone echo). */
  readonly echo = new EchoFilter();
  /** Everything played to this person goes through here so sentences never overlap. */
  readonly outQueue = new SerialQueue();

  private audioListeners = new Set<(chunk: Buffer) => void>();
  private closeListeners = new Set<(reason: EndReason) => void>();
  private closedFlag = false;

  constructor(
    public language: string,
    /** Voice used when this leg's speaker is synthesized for others. undefined => default voice. */
    public voiceId: string | undefined,
    public readonly label: string,
  ) {}

  get closed(): boolean {
    return this.closedFlag;
  }

  /** Audio coming FROM this person, in native format. */
  onAudio(cb: (chunk: Buffer) => void): () => void {
    this.audioListeners.add(cb);
    return () => this.audioListeners.delete(cb);
  }

  onClose(cb: (reason: EndReason) => void): void {
    this.closeListeners.add(cb);
  }

  protected emitAudio(chunk: Buffer): void {
    for (const cb of this.audioListeners) cb(chunk);
  }

  protected emitClose(reason: EndReason): void {
    if (this.closedFlag) return;
    this.closedFlag = true;
    for (const cb of this.closeListeners) cb(reason);
  }

  /** Play audio (native format) to this person. */
  abstract sendAudio(chunk: Buffer): void;

  /** Immediately stop whatever is playing to this person. */
  clearAudio(): void {
    this.outQueue.clear();
  }

  /** UI-only notification (captions, state). No-op for legs without a screen. */
  notify(_msg: ServerMessage): void {}

  /** Tear down the transport. */
  close(): void {
    this.closedFlag = true;
    this.outQueue.clear();
    this.audioListeners.clear();
  }
}

/** What the app leg needs from its WebSocket connection. */
export interface AppConnection {
  readonly username: string;
  send(msg: ServerMessage): void;
  sendBinary(buf: Buffer): void;
  leg: AppLeg | undefined;
  callId: string | undefined;
}

export class AppLeg extends Leg {
  readonly kind = 'app' as const;
  readonly format = 'pcm16_16k' as const;

  constructor(
    readonly conn: AppConnection,
    language: string,
    voiceId: string | undefined,
    label: string,
  ) {
    super(language, voiceId, label);
  }

  /** Called by the gateway for each binary frame from the app. */
  receiveAudio(buf: Buffer): void {
    if (!this.closed) this.emitAudio(buf);
  }

  sendAudio(chunk: Buffer): void {
    if (!this.closed) this.conn.sendBinary(chunk);
  }

  override clearAudio(): void {
    super.clearAudio();
    if (!this.closed) this.conn.send({ type: 'audio.clear' });
  }

  override notify(msg: ServerMessage): void {
    this.conn.send(msg);
  }

  override close(): void {
    super.close();
    if (this.conn.leg === this) {
      this.conn.leg = undefined;
      this.conn.callId = undefined;
    }
  }
}

/** Plays whatever it is given straight back to a target app leg (used by the mirror test). */
export class MirrorLeg extends Leg {
  readonly kind = 'mirror' as const;
  readonly format = 'pcm16_16k' as const;

  constructor(
    language: string,
    private readonly target: AppLeg,
  ) {
    super(language, undefined, 'Mirror test');
  }

  sendAudio(chunk: Buffer): void {
    if (!this.closed) this.target.sendAudio(chunk);
  }

  override clearAudio(): void {
    super.clearAudio();
    this.target.clearAudio();
  }
}

export interface PhoneLegOptions {
  /** Pace outgoing audio to real time (recommended). */
  paced?: boolean;
  frameMs?: number;
  leadMs?: number;
  log?: Logger;
}

/** A real phone line, reached through a Telnyx media stream (8 kHz mu-law). */
export class PhoneLeg extends Leg {
  readonly kind = 'phone' as const;
  readonly format = 'ulaw_8k' as const;

  private ws: WebSocket | null = null;
  private pacer: PacedSender | null = null;
  private reorder = new ChunkReorderer<string>(5);
  private startListeners = new Set<() => void>();
  private readonly opts: Required<Omit<PhoneLegOptions, 'log'>>;
  private readonly log: Logger;
  streamStarted = false;
  streamId: string | undefined;

  constructor(language: string, label: string, options: PhoneLegOptions = {}) {
    super(language, undefined, label);
    this.opts = { paced: options.paced ?? true, frameMs: options.frameMs ?? 40, leadMs: options.leadMs ?? 200 };
    this.log = options.log ?? silentLogger;
  }

  onStreamStart(cb: () => void): void {
    this.startListeners.add(cb);
  }

  /** Telnyx opened its media-stream WebSocket to us. */
  attachStream(ws: WebSocket): void {
    this.ws = ws;
    const frameBytes = Math.round(8 * this.opts.frameMs); // 8 bytes per ms at 8 kHz mu-law
    this.pacer = this.opts.paced
      ? new PacedSender({
          frameBytes,
          frameMs: this.opts.frameMs,
          leadMs: this.opts.leadMs,
          padByte: ULAW_SILENCE,
          send: (frame) => this.sendFrame(frame),
        })
      : null;

    ws.on('message', (data) => this.onMessage(data.toString()));
    ws.on('close', () => this.emitClose('remote_hangup'));
    ws.on('error', (err) => this.log.warn('Telnyx stream error', err));
  }

  private onMessage(raw: string): void {
    let msg: {
      event?: string;
      stream_id?: string;
      start?: { media_format?: { encoding?: string; sample_rate?: number } };
      media?: { track?: string; chunk?: string | number; payload?: string };
      error?: unknown;
    };
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    switch (msg.event) {
      case 'start': {
        this.streamId = msg.stream_id;
        const fmt = msg.start?.media_format;
        if (fmt && (fmt.encoding !== 'PCMU' || fmt.sample_rate !== 8000)) {
          this.log.warn(`Unexpected stream format ${fmt.encoding}/${fmt.sample_rate}; expected PCMU/8000`);
        }
        if (!this.streamStarted) {
          this.streamStarted = true;
          for (const cb of this.startListeners) cb();
        }
        break;
      }
      case 'media': {
        const media = msg.media;
        if (!media?.payload) return;
        if (media.track && media.track !== 'inbound') return;
        const seq = Number(media.chunk);
        const payloads = Number.isFinite(seq) ? this.reorder.push(seq, media.payload) : [media.payload];
        for (const p of payloads) this.emitAudio(Buffer.from(p, 'base64'));
        break;
      }
      case 'stop':
        this.emitClose('remote_hangup');
        break;
      case 'error':
        this.log.warn('Telnyx stream reported an error', JSON.stringify(msg.error));
        break;
      default:
        break;
    }
  }

  sendAudio(chunk: Buffer): void {
    if (this.closed || !this.ws) return;
    if (this.pacer) this.pacer.push(chunk);
    else this.sendFrame(chunk);
  }

  private sendFrame(frame: Buffer): void {
    if (this.ws?.readyState !== 1 /* OPEN */) return;
    this.ws.send(JSON.stringify({ event: 'media', media: { payload: frame.toString('base64') } }));
  }

  override clearAudio(): void {
    super.clearAudio();
    this.pacer?.clear();
    if (this.ws?.readyState === 1) this.ws.send(JSON.stringify({ event: 'clear' }));
  }

  override close(): void {
    super.close();
    this.pacer?.stop();
    try {
      this.ws?.close();
    } catch {
      /* already closed */
    }
    this.ws = null;
  }
}
