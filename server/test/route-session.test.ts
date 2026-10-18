import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Route } from '../src/call/route.js';
import { CallSession } from '../src/call/session.js';
import { silentLogger } from '../src/util/log.js';
import { FakeStt, FakeTranslator, FakeTts, TestLeg, makeFakes, sleep, waitFor } from './helpers.js';

function routeFixture(opts: { dstTranslated?: boolean; srcLang?: string; dstLang?: string; srcVoice?: string } = {}) {
  const fakes = makeFakes();
  const src = new TestLeg('app', 'pcm16_16k', opts.srcLang ?? 'en', opts.srcVoice, 'alice');
  const dst = new TestLeg('phone', 'ulaw_8k', opts.dstLang ?? 'hu', undefined, '+36301234567');
  dst.listenTranslated = opts.dstTranslated ?? true;
  const route = new Route(src, dst, {
    providers: fakes.providers,
    config: { defaultVoiceId: 'default-voice' },
    log: silentLogger,
    callId: 'call-1',
    legs: () => [src, dst],
  });
  return { fakes, src, dst, route };
}

const frame = (bytes = 3200): Buffer => Buffer.alloc(bytes, 3);

describe('Route: pass-through (no translation)', () => {
  it('forwards transcoded audio when the listener wants the original', () => {
    const { src, dst, fakes } = routeFixture({ dstTranslated: false });
    src.say(frame(3200)); // 100 ms of 16 kHz PCM
    expect(dst.sentBytes).toBe(800); // 100 ms of 8 kHz mu-law
    expect(fakes.stt.sessions).toHaveLength(0); // no speech recognition = no cost
  });

  it('does not translate when both sides speak the same language', () => {
    const { src, dst, fakes } = routeFixture({ srcLang: 'en', dstLang: 'en' });
    src.say(frame());
    expect(dst.sentBytes).toBe(800);
    expect(fakes.stt.sessions).toHaveLength(0);
  });
});

describe('Route: translation', () => {
  it('runs STT -> translate -> TTS and plays the result to the listener', async () => {
    const { src, dst, fakes } = routeFixture({ srcVoice: 'alice-voice' });
    src.say(frame());
    const stt = fakes.stt.open('en', 'pcm16_16k')!;
    expect(stt).toBeDefined();
    expect(stt.received[0]!.length).toBe(3200);
    expect(dst.sentBytes).toBe(0); // the original is muted

    stt.utter('How are you today');
    await waitFor(() => dst.sentBytes > 0, 2000, 'translated audio');

    expect(fakes.translator.calls[0]).toMatchObject({ text: 'How are you today', from: 'en', to: 'hu' });
    expect(fakes.tts.calls[0]).toEqual({
      text: '[en>hu] How are you today',
      voiceId: 'alice-voice', // the speaker's cloned voice
      language: 'hu',
      format: 'ulaw_8k',
    });
  });

  it('falls back to the default voice when the speaker has no clone', async () => {
    const { src, dst, fakes } = routeFixture();
    src.say(frame());
    fakes.stt.open('en')!.utter('Good morning to you');
    await waitFor(() => dst.sentBytes > 0);
    expect(fakes.tts.calls[0]!.voiceId).toBe('default-voice');
  });

  it('sends original and translated captions to app screens, from each screen\'s point of view', async () => {
    const fakes = makeFakes();
    const a = new TestLeg('app', 'pcm16_16k', 'en', undefined, 'alice');
    const b = new TestLeg('app', 'pcm16_16k', 'hu', undefined, 'bob');
    new Route(a, b, { providers: fakes.providers, config: { defaultVoiceId: 'd' }, log: silentLogger, callId: 'c', legs: () => [a, b] });
    a.say(frame());
    fakes.stt.open('en')!.utter('See you tomorrow evening');
    await waitFor(() => a.notes.some((n) => n.type === 'transcript.translation'));

    const aText = a.notes.find((n) => n.type === 'transcript');
    const bText = b.notes.find((n) => n.type === 'transcript');
    expect(aText).toMatchObject({ who: 'me', text: 'See you tomorrow evening', language: 'en' });
    expect(bText).toMatchObject({ who: 'them', text: 'See you tomorrow evening', language: 'en' });
    expect(b.notes.find((n) => n.type === 'transcript.translation')).toMatchObject({ who: 'them', language: 'hu' });
  });

  it('forwards live partial transcripts as captions to app screens only', () => {
    const { src, dst, fakes } = routeFixture(); // dst is a phone line: it has no screen
    src.say(frame());
    fakes.stt.open('en')!.partial('How are');
    expect(src.notes).toContainEqual({ type: 'transcript.partial', callId: 'call-1', who: 'me', text: 'How are' });
    expect(dst.notes).toHaveLength(0);
  });

  it('remembers earlier sentences as translation context', async () => {
    const { src, dst, fakes } = routeFixture();
    src.say(frame());
    const stt = fakes.stt.open('en')!;
    stt.utter('My sister lives in Pécs');
    await waitFor(() => dst.sentBytes > 0);
    stt.utter('She works at the hospital');
    await waitFor(() => fakes.translator.calls.length === 2);
    expect(fakes.translator.calls[1]!.context).toEqual([{ source: 'My sister lives in Pécs', translation: '[en>hu] My sister lives in Pécs' }]);
  });

  it('plays sentences in order without overlapping', async () => {
    const fakes = makeFakes();
    const slowTts = new FakeTts(30);
    fakes.providers.tts = slowTts;
    const src = new TestLeg('app', 'pcm16_16k', 'en');
    const dst = new TestLeg('phone', 'ulaw_8k', 'hu');
    new Route(src, dst, { providers: fakes.providers, config: { defaultVoiceId: 'd' }, log: silentLogger, callId: 'c', legs: () => [src, dst] });
    src.say(frame());
    const stt = fakes.stt.open('en')!;
    stt.utter('first sentence here');
    stt.utter('second sentence here');
    await dst.outQueue.onIdle().catch(() => undefined);
    await waitFor(() => slowTts.calls.length === 2 && dst.sent.length >= 4, 2000, 'both sentences');
    await dst.outQueue.onIdle();
    expect(slowTts.calls.map((c) => c.text)).toEqual(['[en>hu] first sentence here', '[en>hu] second sentence here']);
    // 'first' audio (fill 0x55, 2 chunks) fully precedes 'second' audio (3rd+4th chunks)
    expect(dst.sent.length).toBe(4);
  });

  it('drops speakerphone echo instead of re-translating it', async () => {
    const { src, dst, fakes } = routeFixture();
    src.echo.remember('Szia, hogy vagy ma este');
    src.say(frame());
    fakes.stt.open('en')!.utter('szia hogy vagy ma este');
    await sleep(30);
    expect(fakes.translator.calls).toHaveLength(0);
    expect(dst.sentBytes).toBe(0);
    expect(src.notes.find((n) => n.type === 'transcript')).toBeUndefined();
  });

  it('remembers what it speaks so the listener\'s own echo can be recognised', async () => {
    const { src, dst, fakes } = routeFixture();
    src.say(frame());
    fakes.stt.open('en')!.utter('Nice to hear from you');
    await waitFor(() => dst.sentBytes > 0);
    expect(dst.echo.isEcho('[en>hu] Nice to hear from you')).toBe(true);
  });

  it('reports a failed translation without speaking and keeps going', async () => {
    const { src, dst, fakes } = routeFixture();
    vi.spyOn(fakes.translator, 'translate').mockRejectedValueOnce(new Error('overloaded'));
    src.say(frame());
    const stt = fakes.stt.open('en')!;
    stt.utter('This one fails to translate');
    await waitFor(() => src.notes.some((n) => n.type === 'error' && n.code === 'translation_failed'));
    expect(dst.sentBytes).toBe(0);
    stt.utter('This one works fine');
    await waitFor(() => dst.sentBytes > 0);
  });

  it('skips noise the translator marks as empty', async () => {
    const { src, dst, fakes } = routeFixture();
    vi.spyOn(fakes.translator, 'translate').mockResolvedValueOnce('');
    src.say(frame());
    fakes.stt.open('en')!.utter('hmm');
    await sleep(30);
    expect(fakes.tts.calls).toHaveLength(0);
    expect(dst.sentBytes).toBe(0);
  });

  it('recreates speech recognition after an error, once the cool-down has passed', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      const { src, fakes, dst } = routeFixture();
      src.say(frame());
      const first = fakes.stt.open('en')!;
      first.opts.onError(new Error('connection lost'));
      expect(first.closed).toBe(true);
      expect(src.notes.some((n) => n.type === 'error' && n.code === 'stt_failed')).toBe(true);
      src.say(frame()); // within cool-down: ignored
      expect(fakes.stt.sessions).toHaveLength(1);
      vi.setSystemTime(Date.now() + 6000);
      src.say(frame());
      expect(fakes.stt.sessions).toHaveLength(2);
      void dst;
    } finally {
      vi.useRealTimers();
    }
  });

  it('switching to the original stops STT, flushes audio and forwards raw audio', () => {
    const { src, dst, fakes, route } = routeFixture();
    src.say(frame());
    const stt = fakes.stt.open('en')!;
    dst.listenTranslated = false;
    route.refresh();
    expect(stt.closed).toBe(true);
    expect(dst.cleared).toBeGreaterThan(0);
    src.say(frame(3200));
    expect(dst.sentBytes).toBe(800);
  });

  it('stops everything when disposed', () => {
    const { src, fakes, route, dst } = routeFixture();
    src.say(frame());
    const stt = fakes.stt.open('en')!;
    route.dispose();
    expect(stt.closed).toBe(true);
    src.say(frame());
    expect(fakes.stt.sessions).toHaveLength(1);
    expect(dst.sentBytes).toBe(0);
  });
});

describe('CallSession', () => {
  let fakes: ReturnType<typeof makeFakes>;
  const ended: string[] = [];

  beforeEach(() => {
    fakes = makeFakes();
    ended.length = 0;
  });
  afterEach(() => vi.useRealTimers());

  const session = (kind: 'phone' | 'user' | 'mirror' = 'user', maxCallMinutes = 30) =>
    new CallSession('s1', kind, 'ringing', {
      providers: fakes.providers,
      config: { defaultVoiceId: 'default-voice', maxCallMinutes },
      log: silentLogger,
      onEnded: (_s, reason) => ended.push(reason),
    });

  it('connects: two routes for a normal call, one for a mirror', () => {
    const s = session('user');
    s.addLeg(new TestLeg('app', 'pcm16_16k', 'en'));
    s.addLeg(new TestLeg('app', 'pcm16_16k', 'hu'));
    s.connect();
    expect(s.state).toBe('connected');
    expect(s.routes).toHaveLength(2);

    const m = session('mirror');
    m.addLeg(new TestLeg('app', 'pcm16_16k', 'en'));
    m.addLeg(new TestLeg('mirror', 'pcm16_16k', 'es'));
    m.connect();
    expect(m.routes).toHaveLength(1);
  });

  it('tells each app screen who the peer is and whether translation is active', () => {
    const s = session('user');
    const a = new TestLeg('app', 'pcm16_16k', 'en', undefined, '@alice');
    const b = new TestLeg('app', 'pcm16_16k', 'hu', undefined, '@bob');
    s.addLeg(a);
    s.addLeg(b);
    s.connect();
    expect(a.notes.at(-1)).toMatchObject({ type: 'call.state', state: 'connected', peer: { label: '@bob', language: 'hu' }, translate: true, translationActive: true });
    expect(b.notes.at(-1)).toMatchObject({ peer: { label: '@alice', language: 'en' } });
  });

  it('setTranslate updates the listener and broadcasts', () => {
    const s = session('user');
    const a = new TestLeg('app', 'pcm16_16k', 'en');
    const b = new TestLeg('app', 'pcm16_16k', 'hu');
    s.addLeg(a);
    s.addLeg(b);
    s.connect();
    s.setTranslate(a, false);
    expect(a.listenTranslated).toBe(false);
    expect(b.listenTranslated).toBe(true); // the other listener is unaffected
    expect(a.notes.at(-1)).toMatchObject({ translate: false, translationActive: false });
  });

  it('ends exactly once, closes legs and reports the reason', () => {
    const s = session('user');
    const a = new TestLeg('app', 'pcm16_16k', 'en');
    const b = new TestLeg('app', 'pcm16_16k', 'hu');
    s.addLeg(a);
    s.addLeg(b);
    s.connect();
    s.end('hangup');
    s.end('failed'); // ignored
    expect(ended).toEqual(['hangup']);
    expect(a.closed && b.closed).toBe(true);
    expect(a.notes.at(-1)).toMatchObject({ state: 'ended', reason: 'hangup' });
  });

  it('ends when a leg disappears', () => {
    const s = session('user');
    const a = new TestLeg('app', 'pcm16_16k', 'en');
    const b = new TestLeg('phone', 'ulaw_8k', 'hu');
    s.addLeg(a);
    s.addLeg(b);
    s.connect();
    b.hangUp();
    expect(ended).toEqual(['remote_hangup']);
  });

  it('enforces the maximum call length', () => {
    vi.useFakeTimers();
    const s = session('user', 1);
    s.addLeg(new TestLeg('app', 'pcm16_16k', 'en'));
    s.addLeg(new TestLeg('app', 'pcm16_16k', 'hu'));
    s.connect();
    vi.advanceTimersByTime(61_000);
    expect(ended).toEqual(['limit']);
  });

  it('gives up on an unanswered ring', () => {
    vi.useFakeTimers();
    const s = session('user');
    s.addLeg(new TestLeg('app', 'pcm16_16k', 'en'));
    s.startRingTimer(45_000);
    vi.advanceTimersByTime(46_000);
    expect(ended).toEqual(['no_answer']);
  });

  it('plays the AI-translation notice to a phone line in its language with the neutral voice', async () => {
    const s = session('phone');
    const app = new TestLeg('app', 'pcm16_16k', 'en', 'alice-voice', '+36301234567');
    const phone = new TestLeg('phone', 'ulaw_8k', 'hu', undefined, '+36301234567');
    s.addLeg(app);
    s.addLeg(phone);
    // PhoneLeg-only API is not needed for announce(); cast to the shape it uses
    await s.announce(phone as never, { name: 'alice', language: 'en' });
    await phone.outQueue.onIdle();

    expect(fakes.translator.calls[0]).toMatchObject({ from: 'en', to: 'hu' });
    expect(fakes.translator.calls[0]!.text).toMatch(/translated by an A\.I\. interpreter/);
    expect(fakes.translator.calls[0]!.text).toMatch(/alice/);
    expect(fakes.tts.calls[0]).toMatchObject({ voiceId: 'default-voice', language: 'hu', format: 'ulaw_8k' }); // NOT alice's clone
    expect(phone.sentBytes).toBeGreaterThan(0);
    expect(app.notes.some((n) => n.type === 'notice')).toBe(true);
  });

  it('plays the notice in English without translating', async () => {
    const s = session('phone');
    const phone = new TestLeg('phone', 'ulaw_8k', 'en');
    s.addLeg(new TestLeg('app', 'pcm16_16k', 'es'));
    s.addLeg(phone);
    await s.announce(phone as never, { name: 'ana', language: 'es' });
    await phone.outQueue.onIdle();
    expect(fakes.translator.calls).toHaveLength(0);
    expect(fakes.tts.calls[0]!.text).toMatch(/Spanish/);
  });

  it('still plays the notice (in English) if translating it fails', async () => {
    const s = session('phone');
    const phone = new TestLeg('phone', 'ulaw_8k', 'hu');
    s.addLeg(new TestLeg('app', 'pcm16_16k', 'en'));
    s.addLeg(phone);
    vi.spyOn(fakes.translator, 'translate').mockRejectedValueOnce(new Error('down'));
    await s.announce(phone as never, { name: 'a', language: 'en' });
    await phone.outQueue.onIdle();
    expect(fakes.tts.calls[0]!.text).toMatch(/^Hello!/);
  });
});

void FakeStt;
void FakeTranslator;
