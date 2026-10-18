// TEMPORARY: lazy import for Expo Go previews. Remove before release builds; see lazyAudioApi.ts.
import { getAudioApi } from './lazyAudioApi';

let configured = false;

/** Configures the OS audio session for a phone-call style experience (echo cancellation, speaker). */
export async function activateCallAudio(): Promise<void> {
  if (!configured) {
    getAudioApi().AudioManager.setAudioSessionOptions({
      iosCategory: 'playAndRecord',
      iosMode: 'voiceChat',
      iosOptions: ['allowBluetoothHFP', 'defaultToSpeaker'],
    });
    configured = true;
  }
  await getAudioApi().AudioManager.setAudioSessionActivity(true);
}

export async function deactivateCallAudio(): Promise<void> {
  try { await getAudioApi().AudioManager.setAudioSessionActivity(false); } catch { /* already inactive */ }
}

export async function ensureMicPermission(): Promise<boolean> {
  try {
    const current = await getAudioApi().AudioManager.checkRecordingPermissions();
    if (current === 'Granted') return true;
    return (await getAudioApi().AudioManager.requestRecordingPermissions()) === 'Granted';
  } catch {
    return false;
  }
}
