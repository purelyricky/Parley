// TEMPORARY (Expo Go preview only) -- REMOVE BEFORE MAKING A RELEASE BUILD.
//
// CURRENT STATE: `react-native-audio-api` is loaded lazily, on first use, through
// `getAudioApi()` below. MicStream.ts, PcmPlayer.ts and session.ts call it instead of
// importing the package at the top of the file.
//
// WHY: the package is native code that Expo Go does not include. A top-level import
// throws while `app/_layout.tsx` loads, which breaks every route ("missing default
// export") and hides the UI. Loading it lazily lets the screens render in Expo Go;
// call and mic features still need a development build.
//
// TO REVERT (agents: do this as soon as the user says they are ready to build/ship):
//   1. Delete this file.
//   2. In MicStream.ts, PcmPlayer.ts and session.ts restore the top-level import
//      (`import { AudioRecorder } from 'react-native-audio-api'`, etc.) and drop the
//      `getAudioApi()` calls.
//   3. Run `npm run typecheck` and `npm test`.
// Also remove the demo mode in src/demo/ and the `DEMO` hooks (see AGENTS.md).
// Search for "lazyAudioApi" and "DEMO" to find every place to change.
import { DEMO } from '../demo/demo';
import { demoAudioApi } from '../demo/demoAudio';

type AudioApi = typeof import('react-native-audio-api');

let cached: AudioApi | null = null;

export function getAudioApi(): AudioApi {
  if (cached) return cached;
  if (DEMO) return (cached = demoAudioApi as unknown as AudioApi);
  try {
    cached = require('react-native-audio-api') as AudioApi;
    return cached;
  } catch (e) {
    throw new Error(
      'react-native-audio-api is unavailable. Audio does not work in Expo Go; use a development build (npm run android / npm run ios).',
      { cause: e },
    );
  }
}
