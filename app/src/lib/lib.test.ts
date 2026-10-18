import { describe, expect, it, vi } from 'vitest';
import { Api, ApiError } from './api';
import { base64ToBytes, bytesToBase64 } from './base64';
import { initialCall, lineText, reduceCall } from './callReducer';
import { CallSocket, type SocketLike } from './callSocket';
import { formatDuration, normalizeServerUrl, normalizeUsername, reasonText, timeAgo, toWsUrl, usernameProblem } from './format';
import { LANGUAGES } from './languages';
import { bytesToInt16, floatToInt16, int16ToBytes, int16ToFloat, meterLevel, resample, rms, SampleAligner } from './pcm';
import { CALLING_CODES, cleanPhone, formatPhone, isValidE164, suggestLanguage } from './phone';
import type { ServerMessage } from './protocol';
import { promptForElapsed, VOICE_PROMPTS } from './voicePrompts';
import { encodeWav } from './wav';

describe('pcm', () => {
  it('round-trips float <-> int16 and clamps', () => {
    const i = floatToInt16(new Float32Array([0, 1, -1, 2, -2, 0.5]));
    expect([...i]).toEqual([0, 32767, -32768, 32767, -32768, 16384]);
    const f = int16ToFloat(i);
    expect(f[1]).toBeCloseTo(1);
    expect(f[2]).toBeCloseTo(-1);
  });
  it('bytes <-> int16 are little endian', () => {
    const b = int16ToBytes(new Int16Array([1, -2, 256]));
    expect([...b]).toEqual([1, 0, 254, 255, 0, 1]);
    expect([...bytesToInt16(b)]).toEqual([1, -2, 256]);
  });
  it('reads views at an offset', () => {
    const big = new Uint8Array([9, 9, 1, 0, 2, 0]);
    expect([...bytesToInt16(big.subarray(2))]).toEqual([1, 2]);
  });
  it('resamples length and preserves a constant', () => {
    const out = resample(new Float32Array(480).fill(0.25), 48000, 16000);
    expect(out.length).toBe(160);
    expect(out.every((v) => Math.abs(v - 0.25) < 1e-6)).toBe(true);
    expect(resample(new Float32Array(10), 16000, 16000).length).toBe(10);
    expect(resample(new Float32Array(160), 16000, 24000).length).toBe(240);
  });
  it('measures level', () => {
    expect(rms(new Float32Array(10))).toBe(0);
    expect(rms(new Float32Array([0.5, -0.5]))).toBeCloseTo(0.5);
    expect(meterLevel(0)).toBe(0);
    expect(meterLevel(10)).toBe(1);
    expect(meterLevel(0.05)).toBeGreaterThan(0.4);
  });
  it('aligns odd-sized chunks', () => {
    const a = new SampleAligner();
    const all = int16ToBytes(new Int16Array([100, -200, 300]));
    const out = [...a.push(all.subarray(0, 3)), ...a.push(all.subarray(3, 4)), ...a.push(all.subarray(4))];
    expect(out).toEqual([100, -200, 300]);
  });
});

describe('wav + base64', () => {
  it('writes a valid header', () => {
    const wav = encodeWav(new Int16Array(16000), 16000);
    const s = (o: number, n: number) => String.fromCharCode(...wav.subarray(o, o + n));
    expect(s(0, 4)).toBe('RIFF');
    expect(s(8, 4)).toBe('WAVE');
    const v = new DataView(wav.buffer);
    expect(v.getUint32(24, true)).toBe(16000);
    expect(v.getUint32(40, true)).toBe(32000);
    expect(wav.length).toBe(44 + 32000);
  });
  it('base64 matches Buffer for all remainders', () => {
    for (const n of [0, 1, 2, 3, 4, 5, 100, 1001]) {
      const bytes = Uint8Array.from({ length: n }, (_, i) => (i * 37 + 11) & 255);
      expect(bytesToBase64(bytes)).toBe(Buffer.from(bytes).toString('base64'));
      expect([...base64ToBytes(Buffer.from(bytes).toString('base64'))]).toEqual([...bytes]);
    }
  });
});

describe('phone', () => {
  it('cleans and validates', () => {
    expect(cleanPhone('+36 (30) 123-4567')).toBe('+36301234567');
    expect(cleanPhone('0630')).toBe('0630');
    expect(isValidE164('+36301234567')).toBe(true);
    expect(isValidE164('36301234567')).toBe(false);
    expect(isValidE164('+123')).toBe(false);
  });
  it('suggests a language from the country code, longest prefix first', () => {
    expect(suggestLanguage('+36301234567')).toBe('hu');
    expect(suggestLanguage('+15551234567')).toBe('en');
    expect(suggestLanguage('+351912345678')).toBe('pt');
    expect(suggestLanguage('+420123456789')).toBe('cs');
    expect(suggestLanguage('0630')).toBeUndefined();
  });
  it('only suggests languages the app supports', () => {
    const codes = new Set(LANGUAGES.map((l) => l.code));
    for (const c of CALLING_CODES) expect(codes.has(c.language), `${c.country} -> ${c.language}`).toBe(true);
  });
  it('formats for display', () => {
    expect(formatPhone('+36301234567')).toBe('+36 30 123 4567');
    expect(formatPhone('+15551234567')).toBe('+1 555 123 4567');
  });
});

describe('format', () => {
  it('formats durations', () => {
    expect(formatDuration(0)).toBe('00:00');
    expect(formatDuration(75)).toBe('01:15');
    expect(formatDuration(3725)).toBe('1:02:05');
  });
  it('formats relative times', () => {
    const now = 1_000_000_000;
    expect(timeAgo(now - 5000, now)).toBe('Just now');
    expect(timeAgo(now - 5 * 60000, now)).toBe('5 min ago');
    expect(timeAgo(now - 3 * 3600000, now)).toBe('3 h ago');
    expect(timeAgo(now - 30 * 3600000, now)).toBe('Yesterday');
  });
  it('validates usernames', () => {
    expect(normalizeUsername('  @Erick ')).toBe('erick');
    expect(usernameProblem('ab')).toBeTruthy();
    expect(usernameProblem('has space')).toBeTruthy();
    expect(usernameProblem('Erick_99')).toBeNull();
  });
  it('normalises server URLs', () => {
    expect(normalizeServerUrl('abc.ngrok.app/')).toBe('https://abc.ngrok.app');
    expect(normalizeServerUrl('192.168.1.5:8080')).toBe('http://192.168.1.5:8080');
    expect(normalizeServerUrl('localhost:8080')).toBe('http://localhost:8080');
    expect(normalizeServerUrl('http://x.io')).toBe('http://x.io');
    expect(normalizeServerUrl('  ')).toBe('');
    expect(toWsUrl('https://a.b')).toBe('wss://a.b');
    expect(toWsUrl('http://a.b')).toBe('ws://a.b');
  });
  it('explains end reasons', () => {
    expect(reasonText('busy', 'Anna')).toBe('Anna is busy');
    expect(reasonText(undefined, 'Anna')).toBe('Call ended');
  });
  it('rotates voice prompts over time', () => {
    expect(promptForElapsed(0)).toBe(0);
    expect(promptForElapsed(13)).toBe(1);
    expect(promptForElapsed(9999)).toBe(VOICE_PROMPTS.length - 1);
  });
});

const state = (over: Partial<Extract<ServerMessage, { type: 'call.state' }>> = {}): ServerMessage => ({
  type: 'call.state', callId: 'c1', kind: 'user', state: 'connected', peer: { label: '@anna', language: 'hu' },
  translate: true, translationActive: true, ...over,
});

describe('callReducer', () => {
  it('merges transcript, translation and partials', () => {
    let c = reduceCall(null, state());
    expect(c?.state).toBe('connected');
    c = reduceCall(c, { type: 'transcript.partial', callId: 'c1', who: 'them', text: 'szia' });
    expect(c!.partial.them).toBe('szia');
    c = reduceCall(c, { type: 'transcript', callId: 'c1', id: 'a', who: 'them', text: 'Szia!', language: 'hu' });
    expect(c!.partial.them).toBeUndefined();
    c = reduceCall(c, { type: 'transcript.translation', callId: 'c1', id: 'a', who: 'them', text: 'Hi!', language: 'en' });
    expect(c!.lines).toHaveLength(1);
    expect(lineText(c!.lines[0]!, true)).toEqual({ main: 'Hi!', sub: 'Szia!' });
    expect(lineText(c!.lines[0]!, false)).toEqual({ main: 'Szia!' });
  });
  it('handles translation arriving before the transcript, and duplicates', () => {
    let c = reduceCall(null, state());
    c = reduceCall(c, { type: 'transcript.translation', callId: 'c1', id: 'a', who: 'me', text: 'Szia', language: 'hu' });
    c = reduceCall(c, { type: 'transcript', callId: 'c1', id: 'a', who: 'me', text: 'Hi', language: 'en' });
    c = reduceCall(c, { type: 'transcript', callId: 'c1', id: 'a', who: 'me', text: 'Hi', language: 'en' });
    expect(c!.lines).toHaveLength(1);
  });
  it('ignores other calls and keeps startedAt', () => {
    let c = reduceCall(null, state({ startedAt: 5 }));
    expect(reduceCall(c, { type: 'transcript', callId: 'zzz', id: 'x', who: 'me', text: 'x', language: 'en' })).toBe(c);
    c = reduceCall(c, state({ translate: false, translationActive: false }));
    expect(c!.startedAt).toBe(5);
    expect(c!.translate).toBe(false);
    c = reduceCall(c, state({ callId: 'c2' }));
    expect(c!.callId).toBe('c2');
    expect(c!.lines).toEqual([]);
  });
  it('records notices and end reasons', () => {
    let c = reduceCall(null, state());
    c = reduceCall(c, { type: 'notice', callId: 'c1', text: 'hello' });
    c = reduceCall(c, state({ state: 'ended', reason: 'remote_hangup' }));
    expect(c!.notices).toEqual(['hello']);
    expect(c!.reason).toBe('remote_hangup');
    expect(initialCall(state() as any).lines).toEqual([]);
  });
});

describe('Api', () => {
  const fake = (status: number, body: unknown) =>
    vi.fn(async () => ({ status, ok: status < 400, json: async () => body }));
  it('sends auth and parses json', async () => {
    const f = fake(200, { user: { username: 'e' } });
    const r = await new Api('http://s', 'tok', f).me();
    expect(r.user.username).toBe('e');
    const [url, init] = f.mock.calls[0] as any;
    expect(url).toBe('http://s/api/me');
    expect(init.headers.authorization).toBe('Bearer tok');
  });
  it('turns server errors into ApiError with the server message', async () => {
    const err = await new Api('http://s', null, fake(409, { error: { code: 'taken', message: 'Taken' } })).register('a', 'en').catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 409, code: 'taken', message: 'Taken' });
  });
  it('explains network failures', async () => {
    const f = vi.fn(async () => { throw new TypeError('Network request failed'); });
    const err = await new Api('http://s', null, f as any).health().catch((e) => e);
    expect(err).toMatchObject({ code: 'network' });
    expect(err.message).toMatch(/Can't reach the server/);
  });
  it('encodes usernames in paths', async () => {
    const f = fake(200, { available: true });
    await new Api('http://s', null, f).usernameAvailable('a/b');
    expect((f.mock.calls[0] as any)[0]).toBe('http://s/api/usernames/a%2Fb/available');
  });
});

class FakeWs implements SocketLike {
  static all: FakeWs[] = [];
  binaryType = 'blob'; readyState = 0; sent: any[] = [];
  onopen: any = null; onmessage: any = null; onclose: any = null; onerror: any = null;
  constructor(public url: string) { FakeWs.all.push(this); }
  send(d: any) { this.sent.push(d); }
  close() { this.readyState = 3; }
  open() { this.readyState = 1; this.onopen?.(); }
  drop(code = 1006) { this.readyState = 3; this.onclose?.({ code }); }
}

describe('CallSocket', () => {
  const setup = () => {
    vi.useFakeTimers();
    FakeWs.all = [];
    const msgs: ServerMessage[] = [], audio: Uint8Array[] = [], status: string[] = [];
    const s = new CallSocket('ws://x/ws?token=t', { onMessage: (m) => msgs.push(m), onAudio: (a) => audio.push(a), onStatus: (x) => status.push(x) }, (u) => new FakeWs(u));
    return { s, msgs, audio, status };
  };
  it('routes text and binary frames and sends only when open', () => {
    const { s, msgs, audio } = setup();
    s.connect();
    expect(s.send({ type: 'ping' })).toBe(false);
    const ws = FakeWs.all[0]!;
    expect(ws.binaryType).toBe('arraybuffer');
    ws.open();
    expect(s.send({ type: 'call.hangup', callId: 'c' })).toBe(true);
    expect(s.sendAudio(new Uint8Array([1, 2]))).toBe(true);
    expect(ws.sent[0]).toBe('{"type":"call.hangup","callId":"c"}');
    ws.onmessage({ data: '{"type":"pong"}' });
    ws.onmessage({ data: 'not json' });
    ws.onmessage({ data: new Uint8Array([1, 2, 3, 4]).buffer });
    expect(msgs).toEqual([{ type: 'pong' }]);
    expect([...audio[0]!]).toEqual([1, 2, 3, 4]);
    s.close();
    vi.useRealTimers();
  });
  it('reconnects with backoff and stops when closed on purpose', () => {
    const { s, status } = setup();
    s.connect();
    FakeWs.all[0]!.open();
    FakeWs.all[0]!.drop();
    expect(status).toContain('reconnecting');
    vi.advanceTimersByTime(600);
    expect(FakeWs.all).toHaveLength(2);
    FakeWs.all[1]!.drop();
    vi.advanceTimersByTime(600);
    expect(FakeWs.all).toHaveLength(2); // second delay is 1000ms
    vi.advanceTimersByTime(600);
    expect(FakeWs.all).toHaveLength(3);
    s.close();
    vi.advanceTimersByTime(60000);
    expect(FakeWs.all).toHaveLength(3);
    vi.useRealTimers();
  });
  it('sends heartbeats while open', () => {
    const { s } = setup();
    s.connect();
    const ws = FakeWs.all[0]!;
    ws.open();
    vi.advanceTimersByTime(20100);
    expect(ws.sent).toContain('{"type":"ping"}');
    s.close();
    vi.useRealTimers();
  });
});
