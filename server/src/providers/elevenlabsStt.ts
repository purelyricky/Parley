import WebSocket from 'ws';
import { FORMATS, bytesPerMs } from '../audio/pcm.js';
import { silentLogger, type Logger } from '../util/log.js';
import type { SttFactory, SttOptions, SttSession } from './types.js';

export interface ElevenLabsSttConfig {
  apiKey: string;
  vadSilenceSecs: number;
  /** wss://api.elevenlabs.io by default (tests point this at a local fake). */
  baseUrl?: string;
  /** Audio is batched to this size before each websocket message. */
  batchMs?: number;
  log?: Logger;
}

const ERROR_TYPES = new Set([
  'error',
  'auth_error',
  'quota_exceeded',
  'commit_throttled',
  'unaccepted_terms',
  'rate_limited',
  'queue_overflow',
  'resource_exhausted',
  'session_time_limit_exceeded',
  'input_error',
  'invalid_request',
  'chunk_size_exceeded',
  'transcriber_error',
]);

const MAX_RECONNECTS = 5;
const MAX_BUFFER_MS = 5000;

/**
 * Streaming speech-to-text over ElevenLabs Scribe v2 Realtime.
 * Server-side VAD decides where sentences end, so a "committed transcript" = one finished utterance.
 */
export function createElevenLabsStt(cfg: ElevenLabsSttConfig): SttFactory {
  return (opts) => new ElevenLabsSttSession(cfg, opts);
}

class ElevenLabsSttSession implements SttSession {
  private ws: WebSocket | null = null;
  private ready = false;
  private closed = false;
  private reconnects = 0;
  private batch: Buffer[] = [];
  private batchBytes = 0;
  private pending: Buffer[] = [];
  private pendingBytes = 0;
  private readonly batchThreshold: number;
  private readonly sampleRate: number;
  private readonly log: Logger;

  constructor(
    private readonly cfg: ElevenLabsSttConfig,
    private readonly opts: SttOptions,
  ) {
    const fmt = FORMATS[opts.format];
    this.sampleRate = fmt.sampleRate;
    this.batchThreshold = Math.round(bytesPerMs(opts.format) * (cfg.batchMs ?? 100));
    this.log = cfg.log ?? silentLogger;
    this.connect();
  }

  send(chunk: Buffer): void {
    if (this.closed || chunk.length === 0) return;
    this.batch.push(chunk);
    this.batchBytes += chunk.length;
    if (this.batchBytes >= this.batchThreshold) this.flushBatch();
  }

  close(): void {
    if (this.closed) return;
    this.flushBatch();
    this.closed = true;
    this.ready = false;
    try {
      this.ws?.close();
    } catch {
      /* already closing */
    }
    this.ws = null;
  }

  private flushBatch(): void {
    if (this.batchBytes === 0) return;
    const buf = Buffer.concat(this.batch);
    this.batch = [];
    this.batchBytes = 0;
    this.transmit(buf);
  }

  private transmit(buf: Buffer): void {
    if (this.ready && this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(
        JSON.stringify({
          message_type: 'input_audio_chunk',
          audio_base_64: buf.toString('base64'),
          commit: false,
          sample_rate: this.sampleRate,
        }),
      );
      return;
    }
    // Not connected yet (or reconnecting): hold on to the last few seconds so nothing is lost.
    this.pending.push(buf);
    this.pendingBytes += buf.length;
    const maxBytes = bytesPerMs(this.opts.format) * MAX_BUFFER_MS;
    while (this.pendingBytes > maxBytes && this.pending.length > 1) {
      this.pendingBytes -= this.pending.shift()!.length;
    }
  }

  private connect(): void {
    const base = this.cfg.baseUrl ?? 'wss://api.elevenlabs.io';
    const url = new URL('/v1/speech-to-text/realtime', base);
    url.searchParams.set('model_id', 'scribe_v2_realtime');
    url.searchParams.set('audio_format', FORMATS[this.opts.format].sttFormat);
    url.searchParams.set('commit_strategy', 'vad');
    url.searchParams.set('vad_silence_threshold_secs', String(this.cfg.vadSilenceSecs));
    url.searchParams.set('language_code', this.opts.language);
    url.searchParams.set('no_verbatim', 'true');

    const ws = new WebSocket(url, { headers: { 'xi-api-key': this.cfg.apiKey } });
    this.ws = ws;

    ws.on('open', () => {
      if (this.closed) return ws.close();
      this.ready = true;
      this.reconnects = 0;
      for (const buf of this.pending.splice(0)) this.transmit(buf);
      this.pendingBytes = 0;
    });

    ws.on('message', (data) => this.onMessage(data.toString()));

    ws.on('error', (err) => {
      this.log.warn('STT socket error', err);
    });

    ws.on('close', () => {
      this.ready = false;
      if (this.closed || this.ws !== ws) return;
      if (this.reconnects >= MAX_RECONNECTS) {
        this.closed = true;
        this.opts.onError(new Error('Speech recognition connection lost'));
        return;
      }
      const delay = 250 * 2 ** this.reconnects++;
      this.log.warn(`STT socket closed; reconnecting in ${delay}ms (#${this.reconnects})`);
      setTimeout(() => {
        if (!this.closed) this.connect();
      }, delay);
    });
  }

  private onMessage(raw: string): void {
    let msg: { message_type?: string; text?: string; error?: string; warning?: string };
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    switch (msg.message_type) {
      case 'partial_transcript':
        if (msg.text) this.opts.onPartial(msg.text);
        break;
      case 'committed_transcript': {
        const text = msg.text?.trim();
        if (text) this.opts.onCommitted(text);
        break;
      }
      case 'warning':
        this.log.warn(`STT warning: ${msg.warning ?? ''}`);
        break;
      default:
        if (msg.message_type && ERROR_TYPES.has(msg.message_type)) {
          this.log.error(`STT ${msg.message_type}: ${msg.error ?? ''}`);
          this.opts.onError(new Error(`${msg.message_type}: ${msg.error ?? 'speech recognition error'}`));
        }
    }
  }
}
