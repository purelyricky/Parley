import { WebSocket } from 'ws';
import { Leg } from '../src/call/legs.js';
import type { AudioFormat } from '../src/audio/pcm.js';
import type { Config } from '../src/config.js';
import type { ServerMessage } from '../src/protocol.js';
import type {
  DialOptions,
  Providers,
  SttOptions,
  SttSession,
  SynthesizeOptions,
  Translator,
  TranslateInput,
  Tts,
  VoiceService,
  CloneVoiceOptions,
  Telephony,
} from '../src/providers/types.js';

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export async function waitFor<T>(fn: () => T | undefined | false, timeoutMs = 3000, what = 'condition'): Promise<T> {
  const start = Date.now();
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() - start > timeoutMs) throw new Error(`Timed out waiting for ${what}`);
    await sleep(5);
  }
}

export function testConfig(overrides: Partial<Config> = {}): Config {
  return {
    port: 0,
    publicUrl: 'https://parley.example.test',
    elevenlabsApiKey: 'el-key',
    anthropicApiKey: 'an-key',
    telnyx: { apiKey: 'tx-key', connectionId: 'conn-1', fromNumber: '+15550001111' },
    defaultVoiceId: 'default-voice',
    ttsModel: 'eleven_flash_v2_5',
    translationModel: 'claude-haiku-5-5',
    vadSilenceSecs: 0.7,
    maxCallMinutes: 30,
    maxConcurrentCalls: 5,
    phoneCallsPerHour: 10,
    allowedDialPrefixes: [],
    minVoiceSeconds: 25,
    paceToPhone: false,
    dataDir: './data-test',
    ...overrides,
  };
}

// ---- fake providers -------------------------------------------------------------------------

export class FakeSttSession implements SttSession {
  received: Buffer[] = [];
  closed = false;
  constructor(readonly opts: SttOptions) {}
  send(chunk: Buffer): void {
    this.received.push(chunk);
  }
  close(): void {
    this.closed = true;
  }
  /** Pretend the speaker finished a sentence. */
  utter(text: string): void {
    this.opts.onCommitted(text);
  }
  partial(text: string): void {
    this.opts.onPartial(text);
  }
}

export class FakeStt {
  sessions: FakeSttSession[] = [];
  factory = (opts: SttOptions): SttSession => {
    const s = new FakeSttSession(opts);
    this.sessions.push(s);
    return s;
  };
  open(language: string, format?: AudioFormat): FakeSttSession | undefined {
    return this.sessions.find((s) => !s.closed && s.opts.language === language && (!format || s.opts.format === format));
  }
}

export interface TtsCall extends Omit<SynthesizeOptions, 'signal'> {}

export class FakeTts implements Tts {
  calls: TtsCall[] = [];
  /** Bytes produced per character of text. */
  constructor(private readonly delayMs = 0) {}
  async *synthesize(opts: SynthesizeOptions): AsyncGenerator<Buffer> {
    this.calls.push({ text: opts.text, voiceId: opts.voiceId, language: opts.language, format: opts.format });
    const bytes = opts.text.length * (opts.format === 'pcm16_16k' ? 320 : 80);
    const fill = opts.format === 'pcm16_16k' ? 0x11 : 0x55;
    const half = Math.max(2, Math.floor(bytes / 2) & ~1);
    yield Buffer.alloc(half, fill);
    if (this.delayMs) await sleep(this.delayMs);
    if (opts.signal?.aborted) return;
    yield Buffer.alloc(bytes - half, fill);
  }
}

export class FakeTranslator implements Translator {
  calls: TranslateInput[] = [];
  async translate(input: TranslateInput): Promise<string> {
    this.calls.push(input);
    return `[${input.from}>${input.to}] ${input.text}`;
  }
}

export class FakeVoices implements VoiceService {
  cloned: CloneVoiceOptions[] = [];
  removed: string[] = [];
  fail: Error | null = null;
  async clone(opts: CloneVoiceOptions): Promise<{ voiceId: string }> {
    if (this.fail) throw this.fail;
    this.cloned.push(opts);
    return { voiceId: `voice-${this.cloned.length}` };
  }
  async remove(voiceId: string): Promise<void> {
    this.removed.push(voiceId);
  }
}

export class FakeTelephony implements Telephony {
  dials: DialOptions[] = [];
  hangups: string[] = [];
  fail: Error | null = null;
  async dial(opts: DialOptions): Promise<{ callControlId: string }> {
    if (this.fail) throw this.fail;
    this.dials.push(opts);
    return { callControlId: `cc-${this.dials.length}` };
  }
  async hangup(id: string): Promise<void> {
    this.hangups.push(id);
  }
}

export interface Fakes {
  stt: FakeStt;
  tts: FakeTts;
  translator: FakeTranslator;
  voices: FakeVoices;
  telephony: FakeTelephony;
  providers: Providers;
}

export function makeFakes(opts: { phone?: boolean } = {}): Fakes {
  const stt = new FakeStt();
  const tts = new FakeTts();
  const translator = new FakeTranslator();
  const voices = new FakeVoices();
  const telephony = new FakeTelephony();
  return {
    stt,
    tts,
    translator,
    voices,
    telephony,
    providers: {
      stt: stt.factory,
      tts,
      translator,
      voices,
      telephony: opts.phone === false ? undefined : telephony,
    },
  };
}

// ---- fake legs for unit tests ---------------------------------------------------------------------

export class TestLeg extends Leg {
  sent: Buffer[] = [];
  notes: ServerMessage[] = [];
  cleared = 0;
  constructor(
    readonly kind: 'app' | 'phone' | 'mirror',
    readonly format: AudioFormat,
    language: string,
    voiceId?: string,
    label = 'test',
  ) {
    super(language, voiceId, label);
  }
  /** Simulate the person speaking. */
  say(chunk: Buffer): void {
    this.emitAudio(chunk);
  }
  sendAudio(chunk: Buffer): void {
    this.sent.push(chunk);
  }
  override clearAudio(): void {
    super.clearAudio();
    this.cleared++;
  }
  override notify(msg: ServerMessage): void {
    this.notes.push(msg);
  }
  hangUp(): void {
    this.emitClose('remote_hangup');
  }
  get sentBytes(): number {
    return this.sent.reduce((n, b) => n + b.length, 0);
  }
}

// ---- websocket test client ------------------------------------------------------------------------

export class TestClient {
  ws: WebSocket;
  messages: ServerMessage[] = [];
  binary: Buffer[] = [];
  opened: Promise<void>;

  constructor(url: string) {
    this.ws = new WebSocket(url);
    this.ws.on('message', (data, isBinary) => {
      if (isBinary) this.binary.push(data as Buffer);
      else this.messages.push(JSON.parse(data.toString()) as ServerMessage);
    });
    this.opened = new Promise((resolve, reject) => {
      this.ws.once('open', () => resolve());
      this.ws.once('error', reject);
    });
  }

  send(msg: object): void {
    this.ws.send(JSON.stringify(msg));
  }
  sendAudio(buf: Buffer): void {
    this.ws.send(buf, { binary: true });
  }

  find<T extends ServerMessage['type']>(type: T, pred: (m: Extract<ServerMessage, { type: T }>) => boolean = () => true) {
    return this.messages.find((m): m is Extract<ServerMessage, { type: T }> => m.type === type && pred(m as Extract<ServerMessage, { type: T }>));
  }

  waitFor<T extends ServerMessage['type']>(type: T, pred: (m: Extract<ServerMessage, { type: T }>) => boolean = () => true, ms = 3000) {
    return waitFor(() => this.find(type, pred), ms, `${type} message`);
  }

  close(): void {
    this.ws.close();
  }
}

// ---- misc builders ---------------------------------------------------------------------------------

/** A valid PCM WAV file of silence. */
export function makeWav(seconds: number, rate = 16000): Buffer {
  const data = Buffer.alloc(Math.round(seconds * rate) * 2);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0);
  h.writeUInt32LE(36 + data.length, 4);
  h.write('WAVE', 8);
  h.write('fmt ', 12);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write('data', 36);
  h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}
