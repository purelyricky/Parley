import { Transcoder } from '../audio/pcm.js';
import type { Config } from '../config.js';
import type { ServerMessage } from '../protocol.js';
import type { ContextTurn, Providers, SttSession } from '../providers/types.js';
import type { Logger } from '../util/log.js';
import { newId } from '../util/misc.js';
import type { Leg } from './legs.js';

export interface RouteDeps {
  providers: Providers;
  config: Pick<Config, 'defaultVoiceId'>;
  log: Logger;
  callId: string;
  /** All legs of the call (used to send captions to every app screen). */
  legs: () => readonly Leg[];
}

const HISTORY_TURNS = 6;
const STT_ERROR_COOLDOWN_MS = 5000;

/**
 * One direction of a call: everything `src` says, delivered to `dst`.
 *
 *   dst wants the ORIGINAL (or both speak the same language):  src audio -> (transcode) -> dst
 *   dst wants TRANSLATION:  src audio -> speech-to-text -> Claude -> text-to-speech -> dst
 *
 * Because every person has their own leg we always know exactly who spoke - no speaker
 * detection or silence heuristics needed.
 */
export class Route {
  private stt: SttSession | undefined;
  private transcoder: Transcoder;
  private history: ContextTurn[] = [];
  private unsubscribe: () => void;
  private disposed = false;
  private lastSttError = 0;

  constructor(
    readonly src: Leg,
    readonly dst: Leg,
    private readonly deps: RouteDeps,
  ) {
    this.transcoder = new Transcoder(src.format, dst.format);
    this.unsubscribe = src.onAudio((chunk) => this.onAudio(chunk));
  }

  /** True while this direction is actually being translated. */
  get translating(): boolean {
    return this.dst.listenTranslated && this.src.language !== this.dst.language;
  }

  /** Re-evaluate after the listener toggled translation (or a language changed). */
  refresh(): void {
    if (this.translating) return;
    this.closeStt();
    this.dst.clearAudio();
    this.transcoder = new Transcoder(this.src.format, this.dst.format);
  }

  dispose(): void {
    this.disposed = true;
    this.unsubscribe();
    this.closeStt();
  }

  private onAudio(chunk: Buffer): void {
    if (this.disposed) return;
    if (this.translating) {
      this.ensureStt()?.send(chunk);
      return;
    }
    if (this.stt) this.closeStt();
    const out = this.transcoder.push(chunk);
    if (out.length > 0) this.dst.sendAudio(out);
  }

  private ensureStt(): SttSession | undefined {
    if (this.stt) return this.stt;
    if (Date.now() - this.lastSttError < STT_ERROR_COOLDOWN_MS) return undefined;
    this.stt = this.deps.providers.stt({
      language: this.src.language,
      format: this.src.format,
      onPartial: (text) => this.emit((who) => ({ type: 'transcript.partial', callId: this.deps.callId, who, text })),
      onCommitted: (text) => void this.onUtterance(text),
      onError: (err) => {
        this.deps.log.error('speech recognition failed', err);
        this.lastSttError = Date.now();
        this.closeStt(); // will be recreated after the cool-down
        this.notifyApps({
          type: 'error',
          code: 'stt_failed',
          message: 'Speech recognition hiccuped. Trying to reconnect…',
          callId: this.deps.callId,
        });
      },
    });
    return this.stt;
  }

  private closeStt(): void {
    this.stt?.close();
    this.stt = undefined;
  }

  private async onUtterance(text: string): Promise<void> {
    if (this.disposed || !this.translating) return;
    if (this.src.echo.isEcho(text)) {
      this.deps.log.info(`dropped echo from ${this.src.kind} leg: "${text}"`);
      return;
    }

    const id = newId();
    const language = this.src.language;
    this.emit((who) => ({ type: 'transcript', callId: this.deps.callId, id, who, text, language }));

    const t0 = Date.now();
    let translated: string;
    try {
      translated = await this.deps.providers.translator.translate({
        text,
        from: this.src.language,
        to: this.dst.language,
        context: [...this.history], // a snapshot: the history keeps changing while we wait
      });
    } catch (err) {
      this.deps.log.error('translation failed', err);
      this.notifyApps({
        type: 'error',
        code: 'translation_failed',
        message: 'Could not translate that sentence.',
        callId: this.deps.callId,
      });
      return;
    }
    if (this.disposed || !this.translating || !translated) return;
    const tTranslate = Date.now() - t0;

    this.history.push({ source: text, translation: translated });
    if (this.history.length > HISTORY_TURNS) this.history.shift();

    const dstLanguage = this.dst.language;
    this.emit((who) => ({
      type: 'transcript.translation',
      callId: this.deps.callId,
      id,
      who,
      text: translated,
      language: dstLanguage,
    }));

    // We are about to speak this to `dst`; remember it so its echo is not re-translated.
    this.dst.echo.remember(translated);
    this.speak(translated, t0, tTranslate);
  }

  private speak(text: string, startedAt: number, translateMs: number): void {
    const dst = this.dst;
    const voiceId = this.src.voiceId ?? this.deps.config.defaultVoiceId;
    dst.outQueue.enqueue(async (signal) => {
      const t1 = Date.now();
      let first = true;
      try {
        for await (const chunk of this.deps.providers.tts.synthesize({
          text,
          voiceId,
          language: dst.language,
          format: dst.format,
          signal,
        })) {
          if (signal.aborted || this.disposed) return;
          if (first) {
            first = false;
            this.deps.log.info(
              `latency: translate ${translateMs}ms, tts-first-audio ${Date.now() - t1}ms, total ${Date.now() - startedAt}ms`,
            );
          }
          dst.sendAudio(chunk);
        }
      } catch (err) {
        if (signal.aborted) return;
        this.deps.log.error('text-to-speech failed', err);
        this.notifyApps({
          type: 'error',
          code: 'tts_failed',
          message: 'Could not speak the translation.',
          callId: this.deps.callId,
        });
      }
    });
  }

  /** Send a message to every app screen, with "me"/"them" resolved from that screen's point of view. */
  private emit(build: (who: 'me' | 'them') => ServerMessage): void {
    for (const leg of this.deps.legs()) {
      if (leg.kind !== 'app') continue;
      leg.notify(build(leg === this.src ? 'me' : 'them'));
    }
  }

  private notifyApps(msg: ServerMessage): void {
    for (const leg of this.deps.legs()) if (leg.kind === 'app') leg.notify(msg);
  }
}
