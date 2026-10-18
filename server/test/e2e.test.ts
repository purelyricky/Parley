import { afterEach, describe, expect, it } from 'vitest';
import { ProviderError } from '../src/providers/types.js';
import { TelnyxSim, connectApp, postWebhook, register, startHarness, type Harness } from './harness.js';
import { sleep, waitFor } from './helpers.js';

let h: Harness;
afterEach(async () => {
  await h?.stop();
});

describe('phone call, end to end (fake Telnyx / ElevenLabs / Claude, real server)', () => {
  it('dials, plays the AI notice, and translates both directions', async () => {
    h = await startHarness();
    const token = await register(h, 'alice', 'en', 'alice-voice');
    const app = await connectApp(h, token);

    // 1. alice starts a phone call to a Hungarian speaker
    app.send({ type: 'call.phone', to: '+36 30 123 4567', theirLanguage: 'hu' });
    const dialing = await app.waitFor('call.state', (m) => m.state === 'dialing');
    expect(dialing).toMatchObject({ kind: 'phone', peer: { label: '+36301234567', language: 'hu' }, translate: true });

    await waitFor(() => h.fakes.telephony.dials.length === 1, 3000, 'dial');
    const dial = h.fakes.telephony.dials[0]!;
    expect(dial).toMatchObject({
      to: '+36301234567',
      from: '+15550001111',
      connectionId: 'conn-1',
      webhookUrl: 'https://parley.example.test/telnyx/webhook',
      clientState: dialing.callId,
    });
    expect(dial.streamUrl).toBe(`wss://parley.example.test/telnyx/stream/${dialing.callId}`);

    // 2. the friend picks up: Telnyx opens the media stream
    const tel = new TelnyxSim(h, dialing.callId);
    await tel.answer();
    const connected = await app.waitFor('call.state', (m) => m.state === 'connected');
    expect(connected.startedAt).toBeTypeOf('number');

    // 3. the friend hears the AI notice, in Hungarian, in the neutral voice (not alice's clone)
    await tel.waitForAudio(1000);
    expect(h.fakes.tts.calls[0]).toMatchObject({ voiceId: 'default-voice', language: 'hu', format: 'ulaw_8k' });
    expect(h.fakes.tts.calls[0]!.text).toMatch(/^\[en>hu\] Hello! This call is being translated by an A\.I\./);
    await app.waitFor('notice');

    // 4. the friend speaks Hungarian -> alice sees captions and hears English
    const friendAudio = Buffer.from(Array.from({ length: 160 }, (_, i) => i));
    tel.speak(friendAudio);
    const huStt = await waitFor(() => h.fakes.stt.open('hu', 'ulaw_8k'), 2000, 'phone-side STT');
    expect(huStt.received[0]!.equals(friendAudio)).toBe(true); // raw mu-law goes straight to STT, no transcoding

    huStt.partial('Szia');
    await app.waitFor('transcript.partial', (m) => m.who === 'them');
    huStt.utter('Szia, hogy vagy ma este');
    await app.waitFor('transcript', (m) => m.who === 'them' && m.text === 'Szia, hogy vagy ma este' && m.language === 'hu');
    await app.waitFor('transcript.translation', (m) => m.who === 'them' && m.language === 'en' && m.text === '[hu>en] Szia, hogy vagy ma este');
    await waitFor(() => app.binary.length > 0, 2000, 'translated audio for alice');
    const toAlice = h.fakes.tts.calls.find((c) => c.language === 'en');
    expect(toAlice).toMatchObject({ voiceId: 'default-voice', format: 'pcm16_16k' }); // the friend has no clone

    // 5. alice speaks English -> the friend hears Hungarian in ALICE'S cloned voice
    const before = tel.playedBytes;
    app.sendAudio(Buffer.alloc(3200, 1));
    const enStt = await waitFor(() => h.fakes.stt.open('en', 'pcm16_16k'), 2000, 'app-side STT');
    enStt.utter('I am doing great, thanks');
    await app.waitFor('transcript', (m) => m.who === 'me' && m.text === 'I am doing great, thanks');
    await waitFor(() => tel.playedBytes > before, 2000, 'translated audio for the friend');
    const toFriend = h.fakes.tts.calls.find((c) => c.text === '[en>hu] I am doing great, thanks');
    expect(toFriend).toMatchObject({ voiceId: 'alice-voice', language: 'hu', format: 'ulaw_8k' });

    // 6. the friend hangs up (Telnyx webhook) -> alice's call ends; we do not hang up a second time
    expect(await tel.webhook(h, dialing.callId, 'call.hangup', { hangup_cause: 'normal_clearing' })).toBe(200);
    const ended = await app.waitFor('call.state', (m) => m.state === 'ended');
    expect(ended.reason).toBe('remote_hangup');
    await sleep(30);
    expect(h.fakes.telephony.hangups).toEqual([]);
    expect(h.server.manager.activeCalls).toBe(0);
  });

  it('hangs up the carrier leg when alice ends the call', async () => {
    h = await startHarness();
    const app = await connectApp(h, await register(h, 'alice', 'en'));
    app.send({ type: 'call.phone', to: '+36301234567', theirLanguage: 'hu' });
    const dialing = await app.waitFor('call.state', (m) => m.state === 'dialing');
    await waitFor(() => h.fakes.telephony.dials.length === 1);
    const tel = new TelnyxSim(h, dialing.callId);
    await tel.answer();
    await app.waitFor('call.state', (m) => m.state === 'connected');

    app.send({ type: 'call.hangup', callId: dialing.callId });
    const ended = await app.waitFor('call.state', (m) => m.state === 'ended');
    expect(ended.reason).toBe('hangup');
    await waitFor(() => h.fakes.telephony.hangups.length === 1, 2000, 'carrier hangup');
    expect(h.fakes.telephony.hangups).toEqual(['cc-1']);
    await waitFor(() => tel.closed, 2000, 'media stream closed');
  });

  it('reports "no answer" and "busy" from the carrier before the call connects', async () => {
    h = await startHarness();
    const app = await connectApp(h, await register(h, 'alice', 'en'));
    app.send({ type: 'call.phone', to: '+36301234567', theirLanguage: 'hu' });
    const dialing = await app.waitFor('call.state', (m) => m.state === 'dialing');
    await waitFor(() => h.fakes.telephony.dials.length === 1);
    await postWebhook(h, dialing.callId, 'call.hangup', { hangup_cause: 'user_busy' });
    const ended = await app.waitFor('call.state', (m) => m.state === 'ended');
    expect(ended).toMatchObject({ reason: 'busy', message: 'The line is busy.' });
  });

  it('surfaces a dial failure with a friendly message', async () => {
    h = await startHarness();
    h.fakes.telephony.fail = new ProviderError('Telnyx dial 403', 403, 'That country is not enabled for outbound calls on the phone provider account.');
    const app = await connectApp(h, await register(h, 'alice', 'en'));
    app.send({ type: 'call.phone', to: '+36301234567', theirLanguage: 'hu' });
    const ended = await app.waitFor('call.state', (m) => m.state === 'ended');
    expect(ended).toMatchObject({ reason: 'failed', message: expect.stringMatching(/not enabled/) });
    expect(h.server.manager.activeCalls).toBe(0);
  });

  it('rejects unknown media streams', async () => {
    h = await startHarness();
    const tel = new TelnyxSim(h, '00000000-0000-0000-0000-000000000000');
    await tel.opened;
    await waitFor(() => tel.closed, 2000, 'rejection');
  });

  it('shows the original audio when the listener turns translation off, and stops paying for STT', async () => {
    h = await startHarness();
    const app = await connectApp(h, await register(h, 'alice', 'en'));
    app.send({ type: 'call.phone', to: '+36301234567', theirLanguage: 'hu' });
    const dialing = await app.waitFor('call.state', (m) => m.state === 'dialing');
    await waitFor(() => h.fakes.telephony.dials.length === 1);
    const tel = new TelnyxSim(h, dialing.callId);
    await tel.answer();
    await app.waitFor('call.state', (m) => m.state === 'connected');

    tel.speak(Buffer.alloc(160, 0x7f));
    const stt = await waitFor(() => h.fakes.stt.open('hu', 'ulaw_8k'));

    app.send({ type: 'call.translate', callId: dialing.callId, enabled: false });
    const off = await app.waitFor('call.state', (m) => m.translate === false);
    expect(off.translationActive).toBe(false);
    await waitFor(() => stt.closed, 2000, 'STT closed');

    app.binary.length = 0;
    tel.speak(Buffer.alloc(160, 0x7f));
    await waitFor(() => app.binary.length > 0, 2000, 'raw audio');
    expect(app.binary[0]!.length).toBe(160 * 4); // 160 mu-law bytes -> 320 samples at 16 kHz -> 640 bytes
  });
});

describe('phone call guard rails', () => {
  it('refuses phone calls when Telnyx is not configured', async () => {
    h = await startHarness({ phone: false });
    const app = await connectApp(h, await register(h, 'alice', 'en'));
    expect(app.find('hello')).toMatchObject({ features: { phone: false } });
    app.send({ type: 'call.phone', to: '+36301234567', theirLanguage: 'hu' });
    const err = await app.waitFor('error');
    expect(err.code).toBe('phone_disabled');
  });

  it('validates numbers, languages and allowed countries', async () => {
    h = await startHarness({ config: { allowedDialPrefixes: ['+36'] } });
    const app = await connectApp(h, await register(h, 'alice', 'en'));
    app.send({ type: 'call.phone', to: '06301234567', theirLanguage: 'hu' });
    expect((await app.waitFor('error', (e) => e.code === 'bad_number')).code).toBe('bad_number');
    app.send({ type: 'call.phone', to: '+36301234567', theirLanguage: 'xx' });
    await app.waitFor('error', (e) => e.code === 'unsupported_language');
    app.send({ type: 'call.phone', to: '+15551234567', theirLanguage: 'en' });
    await app.waitFor('error', (e) => e.code === 'dest_not_allowed');
    expect(h.fakes.telephony.dials).toHaveLength(0);
  });

  it('limits phone calls per hour and rejects a second simultaneous call', async () => {
    h = await startHarness({ config: { phoneCallsPerHour: 2 } });
    const app = await connectApp(h, await register(h, 'alice', 'en'));
    app.send({ type: 'call.phone', to: '+36301234567', theirLanguage: 'hu' });
    const first = await app.waitFor('call.state', (m) => m.state === 'dialing');
    app.send({ type: 'call.phone', to: '+36301234568', theirLanguage: 'hu' });
    await app.waitFor('error', (e) => e.code === 'busy');
    app.send({ type: 'call.hangup', callId: first.callId });
    await app.waitFor('call.state', (m) => m.state === 'ended');

    app.send({ type: 'call.phone', to: '+36301234567', theirLanguage: 'hu' });
    await waitFor(() => app.messages.filter((m) => m.type === 'call.state' && m.state === 'dialing').length === 2);
    app.send({ type: 'call.hangup', callId: (app.messages.filter((m) => m.type === 'call.state' && m.state === 'dialing').at(-1) as { callId: string }).callId });
    await app.waitFor('call.state', (m) => m.state === 'ended' && m.callId !== first.callId);

    app.send({ type: 'call.phone', to: '+36301234567', theirLanguage: 'hu' });
    await app.waitFor('error', (e) => e.code === 'rate_limited');
  });

  it('ignores hang-up requests for calls the user is not part of', async () => {
    h = await startHarness();
    const alice = await connectApp(h, await register(h, 'alice', 'en'));
    const mallory = await connectApp(h, await register(h, 'mallory', 'en'));
    alice.send({ type: 'call.mirror', targetLanguage: 'es' });
    const state = await alice.waitFor('call.state', (m) => m.state === 'connected');
    mallory.send({ type: 'call.hangup', callId: state.callId });
    mallory.send({ type: 'call.translate', callId: state.callId, enabled: false });
    await sleep(50);
    expect(h.server.manager.activeCalls).toBe(1);
    expect(alice.find('call.state', (m) => m.state === 'ended')).toBeUndefined();
  });
});

describe('app-to-app calls by username', () => {
  async function twoUsers() {
    h = await startHarness({ phone: false });
    const alice = await connectApp(h, await register(h, 'alice', 'en', 'alice-voice'));
    const bob = await connectApp(h, await register(h, 'bob', 'hu', 'bob-voice'));
    return { alice, bob };
  }

  it('rings, connects, and translates both ways in each speaker\'s own cloned voice', async () => {
    const { alice, bob } = await twoUsers();
    alice.send({ type: 'call.user', to: '@Bob' });
    const ringing = await alice.waitFor('call.state', (m) => m.state === 'ringing');
    expect(ringing.peer).toEqual({ label: '@bob', language: 'hu' });
    const incoming = await bob.waitFor('call.incoming');
    expect(incoming).toMatchObject({ from: { username: 'alice', language: 'en' } });

    bob.send({ type: 'call.accept', callId: incoming.callId });
    await alice.waitFor('call.state', (m) => m.state === 'connected');
    const bobConnected = await bob.waitFor('call.state', (m) => m.state === 'connected');
    expect(bobConnected.peer).toEqual({ label: '@alice', language: 'en' });

    // alice speaks English -> bob hears Hungarian in alice's voice
    alice.sendAudio(Buffer.alloc(3200, 1));
    const enStt = await waitFor(() => h.fakes.stt.open('en', 'pcm16_16k'));
    enStt.utter('Hello Bob, how was your day');
    await bob.waitFor('transcript.translation', (m) => m.who === 'them' && m.language === 'hu');
    await alice.waitFor('transcript', (m) => m.who === 'me');
    await waitFor(() => bob.binary.length > 0, 2000, 'audio for bob');
    expect(h.fakes.tts.calls.find((c) => c.language === 'hu')).toMatchObject({ voiceId: 'alice-voice', format: 'pcm16_16k' });

    // bob answers in Hungarian -> alice hears English in bob's voice
    bob.sendAudio(Buffer.alloc(3200, 2));
    const huStt = await waitFor(() => h.fakes.stt.open('hu', 'pcm16_16k'));
    huStt.utter('Szia Alice, nagyon jó volt');
    await waitFor(() => alice.binary.length > 0, 2000, 'audio for alice');
    expect(h.fakes.tts.calls.find((c) => c.language === 'en')).toMatchObject({ voiceId: 'bob-voice' });
  });

  it('each listener can switch to the original voice independently', async () => {
    const { alice, bob } = await twoUsers();
    alice.send({ type: 'call.user', to: 'bob' });
    const incoming = await bob.waitFor('call.incoming');
    bob.send({ type: 'call.accept', callId: incoming.callId });
    await bob.waitFor('call.state', (m) => m.state === 'connected');

    bob.send({ type: 'call.translate', callId: incoming.callId, enabled: false });
    await bob.waitFor('call.state', (m) => m.translate === false);

    const mic = Buffer.from(Array.from({ length: 3200 }, (_, i) => i % 251));
    alice.sendAudio(mic);
    await waitFor(() => bob.binary.some((b) => b.equals(mic)), 2000, 'raw audio at bob');
    expect(h.fakes.stt.open('en')).toBeUndefined(); // nobody is translating alice -> no STT cost
    // alice still hears translated audio from bob
    expect(alice.find('call.state', (m) => m.translate === false)).toBeUndefined();
  });

  it('declines, and tells the caller', async () => {
    const { alice, bob } = await twoUsers();
    alice.send({ type: 'call.user', to: 'bob' });
    const incoming = await bob.waitFor('call.incoming');
    bob.send({ type: 'call.decline', callId: incoming.callId });
    const ended = await alice.waitFor('call.state', (m) => m.state === 'ended');
    expect(ended.reason).toBe('declined');
    await bob.waitFor('call.state', (m) => m.state === 'ended'); // the ringing screen closes too
  });

  it('refuses unknown, offline, busy and self calls', async () => {
    const { alice, bob } = await twoUsers();
    alice.send({ type: 'call.user', to: 'nobody' });
    await alice.waitFor('error', (e) => e.code === 'no_such_user');
    alice.send({ type: 'call.user', to: 'alice' });
    await alice.waitFor('error', (e) => e.code === 'self_call');

    await register(h, 'carol', 'es');
    alice.send({ type: 'call.user', to: 'carol' });
    await alice.waitFor('error', (e) => e.code === 'offline');

    bob.send({ type: 'call.mirror', targetLanguage: 'en' });
    await bob.waitFor('call.state', (m) => m.state === 'connected');
    alice.send({ type: 'call.user', to: 'bob' });
    await alice.waitFor('error', (e) => e.code === 'busy');
  });

  it('tells the other side when someone drops off', async () => {
    const { alice, bob } = await twoUsers();
    alice.send({ type: 'call.user', to: 'bob' });
    const incoming = await bob.waitFor('call.incoming');
    bob.send({ type: 'call.accept', callId: incoming.callId });
    await alice.waitFor('call.state', (m) => m.state === 'connected');
    await bob.waitFor('call.state', (m) => m.state === 'connected');

    alice.close(); // app killed / network lost
    const ended = await bob.waitFor('call.state', (m) => m.state === 'ended');
    expect(ended.reason).toBe('remote_hangup');
    expect(h.server.manager.activeCalls).toBe(0);
  });

  it('skips translation entirely when both people speak the same language', async () => {
    h = await startHarness({ phone: false });
    const a = await connectApp(h, await register(h, 'ann', 'en'));
    const b = await connectApp(h, await register(h, 'ben', 'en'));
    a.send({ type: 'call.user', to: 'ben' });
    const incoming = await b.waitFor('call.incoming');
    b.send({ type: 'call.accept', callId: incoming.callId });
    const state = await a.waitFor('call.state', (m) => m.state === 'connected');
    expect(state.translationActive).toBe(false);
    a.sendAudio(Buffer.alloc(640, 9));
    await waitFor(() => b.binary.length > 0);
    expect(h.fakes.stt.sessions).toHaveLength(0);
  });

  it('rejects connections with a bad token', async () => {
    h = await startHarness({ phone: false });
    const { TestClient } = await import('./helpers.js');
    const c = new TestClient(`${h.ws}/ws?token=nope`);
    h.clients.push(c);
    await expect(c.opened).rejects.toBeTruthy();
  });
});

describe('mirror test (talk to yourself in another language)', () => {
  it('speaks your words back in the chosen language in your own cloned voice', async () => {
    h = await startHarness({ phone: false });
    const app = await connectApp(h, await register(h, 'alice', 'en', 'alice-voice'));
    app.send({ type: 'call.mirror', targetLanguage: 'es' });
    const state = await app.waitFor('call.state', (m) => m.state === 'connected');
    expect(state).toMatchObject({ kind: 'mirror', peer: { label: 'Mirror test', language: 'es' }, translationActive: true });

    app.sendAudio(Buffer.alloc(3200, 1));
    const stt = await waitFor(() => h.fakes.stt.open('en', 'pcm16_16k'));
    stt.utter('Where is the train station');
    await app.waitFor('transcript.translation', (m) => m.language === 'es');
    await waitFor(() => app.binary.length > 0, 2000, 'echoed audio');
    expect(h.fakes.tts.calls[0]).toMatchObject({ text: '[en>es] Where is the train station', voiceId: 'alice-voice', language: 'es' });

    app.send({ type: 'call.hangup', callId: state.callId });
    await app.waitFor('call.state', (m) => m.state === 'ended');
  });
});

describe('protocol robustness', () => {
  it('answers pings and rejects garbage without crashing', async () => {
    h = await startHarness({ phone: false });
    const app = await connectApp(h, await register(h, 'alice', 'en'));
    app.send({ type: 'ping' });
    await app.waitFor('pong');
    app.send({ type: 'call.phone', to: 123 });
    await app.waitFor('error', (e) => e.code === 'bad_message');
    app.ws.send('{ not json');
    await app.waitFor('error', (e) => e.code === 'bad_message' && app.messages.filter((m) => m.type === 'error').length >= 2);
    app.send({ type: 'ping' });
    await waitFor(() => app.messages.filter((m) => m.type === 'pong').length === 2);
  });

  it('ignores stray audio when no call is active', async () => {
    h = await startHarness({ phone: false });
    const app = await connectApp(h, await register(h, 'alice', 'en'));
    app.sendAudio(Buffer.alloc(640));
    app.send({ type: 'ping' });
    await app.waitFor('pong');
    expect(h.fakes.stt.sessions).toHaveLength(0);
  });
});
