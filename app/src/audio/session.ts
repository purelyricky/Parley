import { AudioManager } from 'react-native-audio-api';

let configured = false;

/** Configures the OS audio session for a phone-call style experience (echo cancellation, speaker). */
export async function activateCallAudio(): Promise<void> {
  if (!configured) {
    AudioManager.setAudioSessionOptions({
      iosCategory: 'playAndRecord',
      iosMode: 'voiceChat',
      iosOptions: ['allowBluetoothHFP', 'defaultToSpeaker'],
    });
    configured = true;
  }
  await AudioManager.setAudioSessionActivity(true);
}

export async function deactivateCallAudio(): Promise<void> {
  try { await AudioManager.setAudioSessionActivity(false); } catch { /* already inactive */ }
}

export async function ensureMicPermission(): Promise<boolean> {
  try {
    const current = await AudioManager.checkRecordingPermissions();
    if (current === 'Granted') return true;
    return (await AudioManager.requestRecordingPermissions()) === 'Granted';
  } catch {
    return false;
  }
}
