import type { Config } from '../config.js';
import type { Logger } from '../util/log.js';
import { createClaudeTranslator } from './claudeTranslator.js';
import { createElevenLabsStt } from './elevenlabsStt.js';
import { createElevenLabsTts } from './elevenlabsTts.js';
import { createElevenLabsVoices } from './elevenlabsVoices.js';
import { createTelnyxTelephony } from './telnyx.js';
import type { Providers } from './types.js';

export function createProviders(config: Config, log: Logger): Providers {
  return {
    stt: createElevenLabsStt({
      apiKey: config.elevenlabsApiKey,
      vadSilenceSecs: config.vadSilenceSecs,
      log: log.child('stt'),
    }),
    translator: createClaudeTranslator({ apiKey: config.anthropicApiKey, model: config.translationModel }),
    tts: createElevenLabsTts({ apiKey: config.elevenlabsApiKey, model: config.ttsModel }),
    voices: createElevenLabsVoices({ apiKey: config.elevenlabsApiKey }),
    telephony: config.telnyx ? createTelnyxTelephony({ apiKey: config.telnyx.apiKey }) : undefined,
  };
}
