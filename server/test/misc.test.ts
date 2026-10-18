import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { runChecks } from '../src/doctor.js';
import { LANGUAGES, isSupportedLanguage, languageName } from '../src/languages.js';
import { mapHangupCause } from '../src/call/manager.js';
import { testConfig } from './helpers.js';

const here = dirname(fileURLToPath(import.meta.url));

describe('protocol', () => {
  it('server and app copies of protocol.ts are identical', () => {
    const server = readFileSync(join(here, '../src/protocol.ts'), 'utf8');
    const appPath = join(here, '../../app/src/lib/protocol.ts');
    if (!existsSync(appPath)) return; // server checked out on its own
    expect(readFileSync(appPath, 'utf8')).toBe(server);
  });

  it('language lists are identical on both sides', () => {
    const appPath = join(here, '../../app/src/lib/languages.ts');
    if (!existsSync(appPath)) return;
    expect(readFileSync(appPath, 'utf8')).toBe(readFileSync(join(here, '../src/languages.ts'), 'utf8'));
  });
});

describe('languages', () => {
  it('has unique codes and the key ones', () => {
    const codes = LANGUAGES.map((l) => l.code);
    expect(new Set(codes).size).toBe(codes.length);
    expect(isSupportedLanguage('hu')).toBe(true);
    expect(isSupportedLanguage('klingon')).toBe(false);
    expect(languageName('hu')).toBe('Hungarian');
    expect(languageName('zz')).toBe('zz');
  });
});

describe('carrier hang-up causes', () => {
  it('maps to user-facing reasons', () => {
    expect(mapHangupCause('user_busy')).toBe('busy');
    expect(mapHangupCause('no_answer')).toBe('no_answer');
    expect(mapHangupCause('timeout')).toBe('no_answer');
    expect(mapHangupCause('call_rejected')).toBe('declined');
    expect(mapHangupCause('something_else')).toBe('failed');
  });
});

describe('doctor', () => {
  const cfg = testConfig();
  const jsonRes = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

  it('passes when every service answers', async () => {
    const fake = (async (url: string | URL | Request) => {
      const u = String(url);
      if (u.includes('/v1/user/subscription')) return jsonRes({ tier: 'starter', character_count: 10, character_limit: 30000, can_use_instant_voice_cloning: true });
      if (u.includes('/v1/voices/')) return jsonRes({ name: 'Rachel' });
      if (u.includes('anthropic.com')) return jsonRes({ content: [] });
      if (u.includes('/v2/balance')) return jsonRes({ data: { balance: '9.50', currency: 'USD' } });
      if (u.includes('/v2/phone_numbers')) return jsonRes({ data: [{ connection_id: 'conn-1' }] });
      if (u.endsWith('/health')) return jsonRes({ ok: true });
      return jsonRes({}, 404);
    }) as typeof fetch;
    const checks = await runChecks(cfg, fake);
    expect(checks.every((c) => c.ok)).toBe(true);
    expect(checks.map((c) => c.name)).toEqual(['ElevenLabs key', 'Default voice', 'Anthropic key', 'Telnyx key', 'Telnyx number', 'Public URL']);
    expect(checks[0]!.detail).toContain('starter');
  });

  it('flags a plan without instant voice cloning', async () => {
    const fake = (async (url: string | URL | Request) =>
      String(url).includes('subscription') ? jsonRes({ tier: 'free', can_use_instant_voice_cloning: false }) : jsonRes({}, 404)) as typeof fetch;
    const checks = await runChecks(testConfig({ telnyx: undefined, publicUrl: undefined }), fake);
    expect(checks[0]!.ok).toBe(true);
    expect(checks[0]!.detail).toMatch(/NOT included/);
  });

  it('reports each failing service separately with a hint', async () => {
    const fake = (async () => jsonRes({}, 401)) as typeof fetch;
    const checks = await runChecks(cfg, fake);
    expect(checks.filter((c) => !c.ok).map((c) => c.name)).toEqual(
      expect.arrayContaining(['ElevenLabs key', 'Anthropic key', 'Telnyx key', 'Public URL']),
    );
    expect(checks.find((c) => c.name === 'ElevenLabs key')!.detail).toMatch(/401/);
  });

  it('warns when the Telnyx number is attached to a different application', async () => {
    const fake = (async (url: string | URL | Request) =>
      String(url).includes('/v2/phone_numbers') ? jsonRes({ data: [{ connection_id: 'other-app' }] }) : jsonRes({ name: 'x', data: {}, tier: 't' })) as typeof fetch;
    const checks = await runChecks(cfg, fake);
    expect(checks.find((c) => c.name === 'Telnyx number')!.detail).toMatch(/different application/);
  });
});
