import type { AudioFormat } from '../audio/pcm.js';

/** One live speech-to-text stream (one per speaker direction). */
export interface SttSession {
  /** Audio in the stream's native format (see SttOptions.format). */
  send(chunk: Buffer): void;
  close(): void;
}

export interface SttOptions {
  /** Language the speaker is speaking (ISO 639). */
  language: string;
  format: AudioFormat;
  onPartial(text: string): void;
  /** A finished sentence/utterance. */
  onCommitted(text: string): void;
  onError(err: Error): void;
}

export type SttFactory = (opts: SttOptions) => SttSession;

export interface ContextTurn {
  source: string;
  translation: string;
}

export interface TranslateInput {
  text: string;
  from: string;
  to: string;
  /** Recent turns (oldest first) so pronouns, names and topic stay consistent. */
  context: ContextTurn[];
}

export interface Translator {
  /** Returns the translation, or '' when the utterance should be skipped (noise / filler). */
  translate(input: TranslateInput, signal?: AbortSignal): Promise<string>;
}

export interface SynthesizeOptions {
  text: string;
  voiceId: string;
  /** Language of `text`. */
  language: string;
  format: AudioFormat;
  signal?: AbortSignal;
}

export interface Tts {
  /** Streams audio chunks in the requested format as they are generated. */
  synthesize(opts: SynthesizeOptions): AsyncIterable<Buffer>;
}

export interface CloneVoiceOptions {
  name: string;
  audio: Buffer;
  filename: string;
  mimeType: string;
}

export interface VoiceService {
  clone(opts: CloneVoiceOptions): Promise<{ voiceId: string }>;
  remove(voiceId: string): Promise<void>;
}

export interface DialOptions {
  to: string;
  from: string;
  connectionId: string;
  /** wss:// URL Telnyx opens to stream call audio. */
  streamUrl: string;
  webhookUrl: string;
  /** Opaque string echoed back in webhooks (we put the call id in it). */
  clientState: string;
  timeoutSecs: number;
}

export interface Telephony {
  dial(opts: DialOptions): Promise<{ callControlId: string }>;
  hangup(callControlId: string): Promise<void>;
}

export interface Providers {
  stt: SttFactory;
  translator: Translator;
  tts: Tts;
  voices: VoiceService;
  /** Undefined when Telnyx is not configured. */
  telephony: Telephony | undefined;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    /** Safe to show to the end user. */
    public readonly userMessage?: string,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}
