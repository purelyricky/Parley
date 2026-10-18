import { FORMATS, PcmAligner } from '../audio/pcm.js';
import { ProviderError, type SynthesizeOptions, type Tts } from './types.js';

export interface ElevenLabsTtsConfig {
  apiKey: string;
  model: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

export async function readErrorBody(res: Response): Promise<string> {
  try {
    const text = await res.text();
    try {
      const json = JSON.parse(text) as { detail?: { message?: string } | string; errors?: { detail?: string }[] };
      if (typeof json.detail === 'string') return json.detail;
      if (json.detail?.message) return json.detail.message;
      if (json.errors?.[0]?.detail) return json.errors[0].detail;
    } catch {
      /* not json */
    }
    return text.slice(0, 300);
  } catch {
    return res.statusText;
  }
}

/** Streaming text-to-speech (default model: Flash v2.5, ~75 ms model latency, 32 languages). */
export function createElevenLabsTts(cfg: ElevenLabsTtsConfig): Tts {
  const base = cfg.baseUrl ?? 'https://api.elevenlabs.io';
  const doFetch = cfg.fetchImpl ?? fetch;
  // `language_code` (force the spoken language) is only accepted by the v2.5 models.
  const canEnforceLanguage = cfg.model.includes('v2_5');

  return {
    async *synthesize(opts: SynthesizeOptions): AsyncGenerator<Buffer> {
      const url = `${base}/v1/text-to-speech/${encodeURIComponent(opts.voiceId)}/stream?output_format=${
        FORMATS[opts.format].ttsFormat
      }`;
      const res = await doFetch(url, {
        method: 'POST',
        headers: { 'xi-api-key': cfg.apiKey, 'content-type': 'application/json', accept: 'audio/*' },
        body: JSON.stringify({
          text: opts.text,
          model_id: cfg.model,
          ...(canEnforceLanguage ? { language_code: opts.language } : {}),
          voice_settings: { stability: 0.5, similarity_boost: 0.8, speed: 1.0 },
        }),
        signal: opts.signal,
      });
      if (!res.ok) {
        const detail = await readErrorBody(res);
        throw new ProviderError(`ElevenLabs TTS ${res.status}: ${detail}`, res.status);
      }
      if (!res.body) throw new ProviderError('ElevenLabs TTS returned no body');

      const aligner = opts.format === 'pcm16_16k' ? new PcmAligner() : null;
      for await (const part of res.body as unknown as AsyncIterable<Uint8Array>) {
        const buf = Buffer.from(part);
        const out = aligner ? aligner.push(buf) : buf;
        if (out.length > 0) yield out;
      }
    },
  };
}
