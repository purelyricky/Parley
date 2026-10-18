import { loadConfig, ConfigError, type Config } from './config.js';

export interface Check {
  name: string;
  ok: boolean;
  detail: string;
}

/**
 * Verifies every key and URL by making one cheap, real request to each service.
 * Run it with:  npm run doctor
 */
export async function runChecks(config: Config, doFetch: typeof fetch = fetch): Promise<Check[]> {
  const checks: Check[] = [];
  const add = async (name: string, fn: () => Promise<string>): Promise<void> => {
    try {
      checks.push({ name, ok: true, detail: await fn() });
    } catch (err) {
      checks.push({ name, ok: false, detail: err instanceof Error ? err.message : String(err) });
    }
  };

  await add('ElevenLabs key', async () => {
    const res = await doFetch('https://api.elevenlabs.io/v1/user/subscription', { headers: { 'xi-api-key': config.elevenlabsApiKey } });
    if (!res.ok) throw new Error(`HTTP ${res.status} - is the key correct?`);
    const json = (await res.json()) as { tier?: string; character_count?: number; character_limit?: number; can_use_instant_voice_cloning?: boolean };
    const cloning = json.can_use_instant_voice_cloning === false ? '  ⚠ instant voice cloning NOT included in this plan - upgrade to Starter ($6/mo)' : '';
    return `plan "${json.tier ?? 'unknown'}", ${json.character_count ?? '?'} / ${json.character_limit ?? '?'} credits used${cloning}`;
  });

  await add('Default voice', async () => {
    const res = await doFetch(`https://api.elevenlabs.io/v1/voices/${encodeURIComponent(config.defaultVoiceId)}`, {
      headers: { 'xi-api-key': config.elevenlabsApiKey },
    });
    if (!res.ok) throw new Error(`voice ${config.defaultVoiceId} not found (HTTP ${res.status}). Pick one in ElevenLabs > Voices and set DEFAULT_VOICE_ID`);
    const json = (await res.json()) as { name?: string };
    return `"${json.name ?? config.defaultVoiceId}"`;
  });

  await add('Anthropic key', async () => {
    const res = await doFetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': config.anthropicApiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: config.translationModel, max_tokens: 8, messages: [{ role: 'user', content: 'Say OK' }] }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 160)}`);
    return `model ${config.translationModel} answered`;
  });

  if (config.telnyx) {
    const telnyx = config.telnyx;
    await add('Telnyx key', async () => {
      const res = await doFetch('https://api.telnyx.com/v2/balance', { headers: { authorization: `Bearer ${telnyx.apiKey}` } });
      if (!res.ok) throw new Error(`HTTP ${res.status} - is the API key correct?`);
      const json = (await res.json()) as { data?: { balance?: string; currency?: string } };
      return `balance ${json.data?.balance ?? '?'} ${json.data?.currency ?? ''}`.trim();
    });
    await add('Telnyx number', async () => {
      const res = await doFetch(`https://api.telnyx.com/v2/phone_numbers?filter[phone_number]=${encodeURIComponent(telnyx.fromNumber)}`, {
        headers: { authorization: `Bearer ${telnyx.apiKey}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as { data?: { connection_id?: string }[] };
      const row = json.data?.[0];
      if (!row) throw new Error(`${telnyx.fromNumber} is not a number on this Telnyx account`);
      if (row.connection_id && row.connection_id !== telnyx.connectionId) {
        return `owned, but assigned to a different application (${row.connection_id}) than TELNYX_CONNECTION_ID - check the number's settings`;
      }
      return 'owned by this account';
    });
  }

  if (config.publicUrl) {
    const url = config.publicUrl;
    await add('Public URL', async () => {
      const res = await doFetch(`${url}/health`, { headers: { 'ngrok-skip-browser-warning': '1' } });
      if (!res.ok) throw new Error(`HTTP ${res.status} - is the server running and the tunnel pointing at port ${config.port}?`);
      return `${url} reaches this server`;
    });
  } else {
    checks.push({ name: 'Public URL', ok: true, detail: 'not set (only needed for phone calls)' });
  }
  return checks;
}

// Run only when executed directly (not when imported by tests).
if (process.argv[1] && /doctor\.(ts|js)$/.test(process.argv[1])) {
  try {
    const { config } = loadConfig();
    const checks = await runChecks(config);
    console.log('');
    for (const c of checks) console.log(`  ${c.ok ? '✓' : '✗'} ${c.name.padEnd(15)} ${c.detail}`);
    console.log('');
    process.exit(checks.every((c) => c.ok) ? 0 : 1);
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(`\n${err.message}\n`);
      process.exit(1);
    }
    throw err;
  }
}
