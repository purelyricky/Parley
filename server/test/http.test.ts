import { afterEach, describe, expect, it } from 'vitest';
import { ProviderError } from '../src/providers/types.js';
import { api, register, startHarness, type Harness } from './harness.js';
import { makeWav } from './helpers.js';

let h: Harness;
afterEach(async () => {
  await h?.stop();
});

describe('accounts', () => {
  it('registers, checks username availability and returns the profile', async () => {
    h = await startHarness();
    expect((await api(h, 'GET', '/api/usernames/erick/available')).json).toEqual({ available: true });
    const res = await api(h, 'POST', '/api/register', { body: { username: 'Erick', language: 'en' } });
    expect(res.status).toBe(201);
    expect(res.json.user).toEqual({ username: 'erick', language: 'en', hasVoice: false });
    expect(res.json.features).toEqual({ phone: true });
    expect((await api(h, 'GET', '/api/usernames/erick/available')).json).toEqual({ available: false });

    const me = await api(h, 'GET', '/api/me', { token: res.json.token });
    expect(me.json.user.username).toBe('erick');
  });

  it('rejects duplicate, invalid and unsupported registrations', async () => {
    h = await startHarness();
    await register(h, 'erick', 'en');
    expect((await api(h, 'POST', '/api/register', { body: { username: 'erick', language: 'hu' } })).status).toBe(409);
    expect((await api(h, 'POST', '/api/register', { body: { username: 'x', language: 'hu' } })).status).toBe(400);
    expect((await api(h, 'POST', '/api/register', { body: { username: 'someone', language: 'tlh' } })).json.error.code).toBe('unsupported_language');
    expect((await api(h, 'POST', '/api/register', { body: {} })).status).toBe(400);
  });

  it('requires a valid token', async () => {
    h = await startHarness();
    expect((await api(h, 'GET', '/api/me')).status).toBe(401);
    expect((await api(h, 'GET', '/api/me', { token: 'bogus' })).status).toBe(401);
  });

  it('changes language and looks up other users', async () => {
    h = await startHarness();
    const token = await register(h, 'erick', 'en');
    await register(h, 'anna', 'hu');
    expect((await api(h, 'PATCH', '/api/me', { token, body: { language: 'fr' } })).json.user.language).toBe('fr');
    expect((await api(h, 'PATCH', '/api/me', { token, body: { language: 'zz' } })).status).toBe(400);
    expect((await api(h, 'GET', '/api/users/Anna', { token })).json).toEqual({ username: 'anna', language: 'hu', online: false });
    expect((await api(h, 'GET', '/api/users/ghost', { token })).status).toBe(404);
  });

  it('deleting an account also deletes the cloned voice', async () => {
    h = await startHarness();
    const token = await register(h, 'erick', 'en', 'voice-xyz');
    expect((await api(h, 'DELETE', '/api/me', { token })).status).toBe(200);
    expect(h.fakes.voices.removed).toEqual(['voice-xyz']);
    expect((await api(h, 'GET', '/api/me', { token })).status).toBe(401);
  });

  it('serves the language list and health', async () => {
    h = await startHarness();
    const langs = (await api(h, 'GET', '/api/languages')).json.languages as { code: string }[];
    expect(langs.map((l) => l.code)).toEqual(expect.arrayContaining(['en', 'hu', 'es']));
    expect((await api(h, 'GET', '/health')).json).toMatchObject({ ok: true, phone: true });
  });
});

describe('voice cloning', () => {
  const wavBase64 = (seconds: number) => makeWav(seconds, 8000).toString('base64');

  it('requires consent', async () => {
    h = await startHarness();
    const token = await register(h, 'erick', 'en');
    const res = await api(h, 'POST', '/api/voice', { token, body: { audioBase64: wavBase64(30), consent: false } });
    expect(res.status).toBe(400);
    expect(res.json.error.code).toBe('consent_required');
    expect(h.fakes.voices.cloned).toHaveLength(0);
  });

  it('rejects recordings that are too short', async () => {
    h = await startHarness();
    const token = await register(h, 'erick', 'en');
    const res = await api(h, 'POST', '/api/voice', { token, body: { audioBase64: wavBase64(8), mimeType: 'audio/wav', consent: true } });
    expect(res.status).toBe(422);
    expect(res.json.error.code).toBe('too_short');
    expect(res.json.error.message).toMatch(/at least 25 seconds/);
  });

  it('clones the voice and stores it on the profile', async () => {
    h = await startHarness();
    const token = await register(h, 'erick', 'en');
    const res = await api(h, 'POST', '/api/voice', { token, body: { audioBase64: wavBase64(30), mimeType: 'audio/wav', consent: true } });
    expect(res.status).toBe(200);
    expect(res.json.user).toMatchObject({ username: 'erick', hasVoice: true });
    expect(h.fakes.voices.cloned[0]).toMatchObject({ name: 'Parley erick', filename: 'sample.wav', mimeType: 'audio/wav' });
    expect(h.users.byUsername('erick')).toMatchObject({ voiceId: 'voice-1' });
    expect(h.users.byUsername('erick')!.voiceConsentAt).toBeTypeOf('string');
  });

  it('replaces an older clone instead of piling them up', async () => {
    h = await startHarness();
    const token = await register(h, 'erick', 'en', 'old-voice');
    await api(h, 'POST', '/api/voice', { token, body: { audioBase64: wavBase64(30), consent: true } });
    await new Promise((r) => setTimeout(r, 20));
    expect(h.fakes.voices.removed).toEqual(['old-voice']);
    expect(h.users.byUsername('erick')!.voiceId).toBe('voice-1');
  });

  it('explains provider failures', async () => {
    h = await startHarness();
    h.fakes.voices.fail = new ProviderError('x', 401, 'Voice cloning is not available on the configured ElevenLabs plan.');
    const token = await register(h, 'erick', 'en');
    const res = await api(h, 'POST', '/api/voice', { token, body: { audioBase64: wavBase64(30), consent: true } });
    expect(res.status).toBe(422);
    expect(res.json.error.message).toMatch(/plan/);
  });

  it('deletes the voice', async () => {
    h = await startHarness();
    const token = await register(h, 'erick', 'en', 'voice-1');
    const res = await api(h, 'DELETE', '/api/voice', { token });
    expect(res.json.user.hasVoice).toBe(false);
    expect(h.fakes.voices.removed).toEqual(['voice-1']);
    expect(h.users.byUsername('erick')!.voiceId).toBeUndefined();
  });

  it('previews the clone speaking another language', async () => {
    h = await startHarness();
    const token = await register(h, 'erick', 'en', 'voice-1');
    const res = await api(h, 'POST', '/api/voice/preview', { token, body: { language: 'es' } });
    expect(res.status).toBe(200);
    expect(res.json.text).toMatch(/^\[en>es\] Hi! This is my voice/);
    expect(Buffer.from(res.json.audioBase64, 'base64').length).toBeGreaterThan(1000);
    expect(h.fakes.tts.calls[0]).toMatchObject({ voiceId: 'voice-1', language: 'es', format: 'pcm16_16k' });
  });

  it('needs a voice before previewing', async () => {
    h = await startHarness();
    const token = await register(h, 'erick', 'en');
    expect((await api(h, 'POST', '/api/voice/preview', { token, body: { language: 'es' } })).status).toBe(409);
  });
});
