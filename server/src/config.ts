export class ConfigError extends Error {
  constructor(public readonly problems: string[]) {
    super(`Invalid configuration:\n  - ${problems.join('\n  - ')}`);
    this.name = 'ConfigError';
  }
}

export interface TelnyxConfig {
  apiKey: string;
  connectionId: string;
  fromNumber: string;
}

export interface Config {
  port: number;
  /** Public https URL of this server (ngrok / cloudflared / your host). Needed for phone calls. */
  publicUrl: string | undefined;
  elevenlabsApiKey: string;
  anthropicApiKey: string;
  /** Undefined => phone calls are disabled (app-to-app + mirror test still work). */
  telnyx: TelnyxConfig | undefined;
  /** Voice used for the *other* person's speech when they have no cloned voice. */
  defaultVoiceId: string;
  ttsModel: string;
  translationModel: string;
  /** Seconds of silence that end a spoken sentence (lower = snappier, but may cut people off). */
  vadSilenceSecs: number;
  maxCallMinutes: number;
  maxConcurrentCalls: number;
  phoneCallsPerHour: number;
  /** Comma-separated E.164 prefixes allowed for outbound calls. Empty = any. Great cost safety valve. */
  allowedDialPrefixes: string[];
  minVoiceSeconds: number;
  /** Release audio to the phone line at real-time speed (recommended). Set PACE_PHONE_AUDIO=false to send bursts. */
  paceToPhone: boolean;
  dataDir: string;
}

const DEFAULT_VOICE = '21m00Tcm4TlvDq8ikWAM'; // ElevenLabs premade "Rachel"; override with DEFAULT_VOICE_ID

function num(env: NodeJS.ProcessEnv, key: string, fallback: number, problems: string[]): number {
  const raw = env[key];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    problems.push(`${key} must be a positive number (got "${raw}")`);
    return fallback;
  }
  return n;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): { config: Config; warnings: string[] } {
  const problems: string[] = [];
  const warnings: string[] = [];

  const elevenlabsApiKey = env.ELEVENLABS_API_KEY?.trim() ?? '';
  const anthropicApiKey = env.ANTHROPIC_API_KEY?.trim() ?? '';
  if (!elevenlabsApiKey) problems.push('ELEVENLABS_API_KEY is missing (https://elevenlabs.io/app/settings/api-keys)');
  if (!anthropicApiKey) problems.push('ANTHROPIC_API_KEY is missing (https://console.anthropic.com/settings/keys)');

  const publicUrl = env.PUBLIC_URL?.trim().replace(/\/+$/, '') || undefined;
  if (publicUrl && !/^https:\/\//.test(publicUrl)) {
    problems.push('PUBLIC_URL must start with https:// (e.g. your ngrok URL)');
  }

  const tApi = env.TELNYX_API_KEY?.trim();
  const tConn = env.TELNYX_CONNECTION_ID?.trim();
  const tFrom = env.TELNYX_FROM_NUMBER?.trim();
  let telnyx: TelnyxConfig | undefined;
  const telnyxSet = [tApi, tConn, tFrom].filter(Boolean).length;
  if (telnyxSet === 3) {
    if (!/^\+[1-9]\d{6,14}$/.test(tFrom!)) problems.push('TELNYX_FROM_NUMBER must be E.164, e.g. +15551234567');
    if (!publicUrl) problems.push('PUBLIC_URL is required for phone calls (Telnyx must reach your server)');
    telnyx = { apiKey: tApi!, connectionId: tConn!, fromNumber: tFrom! };
  } else if (telnyxSet > 0) {
    problems.push('Telnyx is partly configured: set all of TELNYX_API_KEY, TELNYX_CONNECTION_ID and TELNYX_FROM_NUMBER (or none)');
  } else {
    warnings.push('Telnyx not configured -> phone calls disabled. App-to-app calls and the mirror test still work.');
  }

  const port = num(env, 'PORT', 8080, problems);
  const config: Config = {
    port,
    publicUrl,
    elevenlabsApiKey,
    anthropicApiKey,
    telnyx,
    defaultVoiceId: env.DEFAULT_VOICE_ID?.trim() || DEFAULT_VOICE,
    ttsModel: env.TTS_MODEL?.trim() || 'eleven_flash_v2_5',
    translationModel: env.TRANSLATION_MODEL?.trim() || 'claude-haiku-5-5',
    vadSilenceSecs: num(env, 'VAD_SILENCE_SECS', 0.7, problems),
    maxCallMinutes: num(env, 'MAX_CALL_MINUTES', 30, problems),
    maxConcurrentCalls: num(env, 'MAX_CONCURRENT_CALLS', 5, problems),
    phoneCallsPerHour: num(env, 'PHONE_CALLS_PER_HOUR', 10, problems),
    allowedDialPrefixes: (env.ALLOWED_DIAL_PREFIXES ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    minVoiceSeconds: num(env, 'MIN_VOICE_SECONDS', 25, problems),
    paceToPhone: env.PACE_PHONE_AUDIO?.trim().toLowerCase() !== 'false',
    dataDir: env.DATA_DIR?.trim() || './data',
  };
  for (const p of config.allowedDialPrefixes) {
    if (!/^\+\d{1,6}$/.test(p)) problems.push(`ALLOWED_DIAL_PREFIXES entry "${p}" must look like +36 or +1`);
  }

  if (problems.length) throw new ConfigError(problems);
  return { config, warnings };
}

/** https://x.y -> wss://x.y */
export function toWsUrl(httpsUrl: string): string {
  return httpsUrl.replace(/^http/, 'ws');
}
