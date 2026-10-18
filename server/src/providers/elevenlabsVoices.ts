import { readErrorBody } from './elevenlabsTts.js';
import { ProviderError, type CloneVoiceOptions, type VoiceService } from './types.js';

export interface ElevenLabsVoicesConfig {
  apiKey: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

/** Instant Voice Cloning (IVC): needs a paid ElevenLabs plan (Starter, $6/mo, and up). */
export function createElevenLabsVoices(cfg: ElevenLabsVoicesConfig): VoiceService {
  const base = cfg.baseUrl ?? 'https://api.elevenlabs.io';
  const doFetch = cfg.fetchImpl ?? fetch;

  return {
    async clone({ name, audio, filename, mimeType }: CloneVoiceOptions) {
      const form = new FormData();
      form.append('name', name);
      form.append('description', 'Created by Parley with the owner\'s explicit consent');
      form.append('remove_background_noise', 'true');
      form.append('files', new Blob([new Uint8Array(audio)], { type: mimeType }), filename);

      const res = await doFetch(`${base}/v1/voices/add`, {
        method: 'POST',
        headers: { 'xi-api-key': cfg.apiKey },
        body: form,
      });
      if (!res.ok) {
        const detail = await readErrorBody(res);
        const needsPlan = res.status === 401 || res.status === 402 || /subscription|plan|upgrade/i.test(detail);
        throw new ProviderError(
          `ElevenLabs voice clone ${res.status}: ${detail}`,
          res.status,
          needsPlan
            ? 'Voice cloning is not available on the configured ElevenLabs plan.'
            : `The voice sample could not be used: ${detail}`,
        );
      }
      const json = (await res.json()) as { voice_id?: string };
      if (!json.voice_id) throw new ProviderError('ElevenLabs did not return a voice_id');
      return { voiceId: json.voice_id };
    },

    async remove(voiceId: string) {
      const res = await doFetch(`${base}/v1/voices/${encodeURIComponent(voiceId)}`, {
        method: 'DELETE',
        headers: { 'xi-api-key': cfg.apiKey },
      });
      // 404 = already gone; fine.
      if (!res.ok && res.status !== 404) {
        throw new ProviderError(`ElevenLabs delete voice ${res.status}: ${await readErrorBody(res)}`, res.status);
      }
    },
  };
}
