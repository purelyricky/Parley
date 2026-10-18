import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig, toWsUrl } from '../src/config.js';
import { StoreError, UserStore } from '../src/users.js';

const base = { ELEVENLABS_API_KEY: 'el', ANTHROPIC_API_KEY: 'an' };

describe('loadConfig', () => {
  it('works with only the two required keys and disables phone calls', () => {
    const { config, warnings } = loadConfig(base);
    expect(config.telnyx).toBeUndefined();
    expect(config.port).toBe(8080);
    expect(config.translationModel).toBe('claude-haiku-5-5');
    expect(warnings.join(' ')).toMatch(/phone calls disabled/);
  });

  it('lists every missing required key at once', () => {
    try {
      loadConfig({});
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigError);
      const msg = (err as ConfigError).message;
      expect(msg).toMatch(/ELEVENLABS_API_KEY/);
      expect(msg).toMatch(/ANTHROPIC_API_KEY/);
    }
  });

  it('enables Telnyx when all three settings and PUBLIC_URL are present', () => {
    const { config } = loadConfig({
      ...base,
      PUBLIC_URL: 'https://abc.ngrok-free.app/',
      TELNYX_API_KEY: 'k',
      TELNYX_CONNECTION_ID: 'c',
      TELNYX_FROM_NUMBER: '+15551234567',
    });
    expect(config.telnyx).toEqual({ apiKey: 'k', connectionId: 'c', fromNumber: '+15551234567' });
    expect(config.publicUrl).toBe('https://abc.ngrok-free.app'); // trailing slash removed
  });

  it('rejects half-configured Telnyx', () => {
    expect(() => loadConfig({ ...base, TELNYX_API_KEY: 'k' })).toThrow(/partly configured/);
  });

  it('requires PUBLIC_URL for phone calls and https for it', () => {
    const telnyx = { TELNYX_API_KEY: 'k', TELNYX_CONNECTION_ID: 'c', TELNYX_FROM_NUMBER: '+15551234567' };
    expect(() => loadConfig({ ...base, ...telnyx })).toThrow(/PUBLIC_URL is required/);
    expect(() => loadConfig({ ...base, ...telnyx, PUBLIC_URL: 'http://x.test' })).toThrow(/https/);
  });

  it('validates numbers and dial prefixes', () => {
    expect(() => loadConfig({ ...base, MAX_CALL_MINUTES: 'abc' })).toThrow(/MAX_CALL_MINUTES/);
    expect(() => loadConfig({ ...base, ALLOWED_DIAL_PREFIXES: '36' })).toThrow(/ALLOWED_DIAL_PREFIXES/);
    expect(loadConfig({ ...base, ALLOWED_DIAL_PREFIXES: '+36, +1' }).config.allowedDialPrefixes).toEqual(['+36', '+1']);
  });

  it('can switch off audio pacing', () => {
    expect(loadConfig(base).config.paceToPhone).toBe(true);
    expect(loadConfig({ ...base, PACE_PHONE_AUDIO: 'false' }).config.paceToPhone).toBe(false);
  });

  it('converts https to wss', () => {
    expect(toWsUrl('https://a.b')).toBe('wss://a.b');
  });
});

describe('UserStore', () => {
  it('registers, looks up by name and token, and normalizes usernames', () => {
    const s = new UserStore();
    const u = s.register('@Erick_K', 'en');
    expect(u.username).toBe('erick_k');
    expect(s.byToken(u.token)?.username).toBe('erick_k');
    expect(s.byUsername('ERICK_K')?.language).toBe('en');
    expect(s.toPublic(u)).toEqual({ username: 'erick_k', language: 'en', hasVoice: false });
  });

  it('rejects taken and invalid usernames', () => {
    const s = new UserStore();
    s.register('anna', 'hu');
    expect(() => s.register('ANNA', 'hu')).toThrow(StoreError);
    expect(() => s.register('a', 'hu')).toThrow(/3-20/);
    expect(() => s.register('has space', 'hu')).toThrow(StoreError);
    expect(s.isAvailable('anna')).toBe(false);
    expect(s.isAvailable('anna2')).toBe(true);
    expect(s.isAvailable('x')).toBe(false);
  });

  it('updates and clears fields', () => {
    const s = new UserStore();
    s.register('bob', 'en');
    s.update('bob', { voiceId: 'v1', voiceName: 'Bob' });
    expect(s.toPublic(s.byUsername('bob')!)).toMatchObject({ hasVoice: true, voiceName: 'Bob' });
    s.update('bob', { voiceId: undefined, voiceName: undefined });
    expect(s.toPublic(s.byUsername('bob')!).hasVoice).toBe(false);
  });

  it('persists to disk and reloads', () => {
    const dir = mkdtempSync(join(tmpdir(), 'parley-'));
    try {
      const file = join(dir, 'nested', 'users.json');
      const a = new UserStore(file);
      const u = a.register('carol', 'es');
      a.update('carol', { voiceId: 'v9' });
      const b = new UserStore(file);
      expect(b.byToken(u.token)?.voiceId).toBe('v9');
      expect(JSON.parse(readFileSync(file, 'utf8'))).toHaveLength(1);
      b.remove('carol');
      expect(new UserStore(file).byUsername('carol')).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
