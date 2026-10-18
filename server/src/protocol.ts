// Wire protocol shared by the Parley server and the mobile app.
//
// KEEP THIS FILE IDENTICAL TO app/src/lib/protocol.ts
// (server/test/protocol-sync.test.ts fails if the two copies drift apart).
//
// Transport: one WebSocket per signed-in app at  wss://<server>/ws?token=<token>
//   - TEXT frames carry JSON (ClientMessage / ServerMessage)
//   - BINARY frames carry raw call audio: PCM signed 16-bit little-endian, 16 kHz, mono.
//       app -> server : microphone audio of the active call
//       server -> app : audio to play for the active call

export type CallKind = 'phone' | 'user' | 'mirror';

export type CallState = 'dialing' | 'ringing' | 'connected' | 'ended';

export type EndReason =
  | 'hangup' // you hung up
  | 'remote_hangup' // the other side hung up
  | 'declined'
  | 'no_answer'
  | 'busy'
  | 'failed'
  | 'offline' // username is not online
  | 'timeout'
  | 'limit' // max call length reached
  | 'error';

export interface PublicUser {
  username: string;
  language: string;
  hasVoice: boolean;
  voiceName?: string;
}

export interface Peer {
  /** Phone number, username, or a friendly label ("Mirror test"). */
  label: string;
  /** ISO language code the other side speaks. */
  language: string;
}

export type ClientMessage =
  | { type: 'ping' }
  | { type: 'call.phone'; to: string; theirLanguage: string; translate?: boolean }
  | { type: 'call.user'; to: string; translate?: boolean }
  | { type: 'call.mirror'; targetLanguage: string }
  | { type: 'call.accept'; callId: string }
  | { type: 'call.decline'; callId: string }
  | { type: 'call.hangup'; callId: string }
  | { type: 'call.translate'; callId: string; enabled: boolean };

export type ServerMessage =
  | { type: 'pong' }
  | { type: 'hello'; user: PublicUser; features: { phone: boolean } }
  | { type: 'call.incoming'; callId: string; from: { username: string; language: string } }
  | {
      type: 'call.state';
      callId: string;
      kind: CallKind;
      state: CallState;
      peer: Peer;
      /** Whether *you* asked to hear translated audio. */
      translate: boolean;
      /** True when translation is actually happening (you want it AND the languages differ). */
      translationActive: boolean;
      /** Epoch ms when the call connected. */
      startedAt?: number;
      reason?: EndReason;
      message?: string;
    }
  | { type: 'transcript.partial'; callId: string; who: 'me' | 'them'; text: string }
  | { type: 'transcript'; callId: string; id: string; who: 'me' | 'them'; text: string; language: string }
  | { type: 'transcript.translation'; callId: string; id: string; who: 'me' | 'them'; text: string; language: string }
  | { type: 'notice'; callId: string; text: string }
  | { type: 'audio.clear' }
  | { type: 'error'; code: string; message: string; callId?: string };

/** Audio format used between the app and the server. */
export const APP_AUDIO = { sampleRate: 16000, channels: 1, bitsPerSample: 16 } as const;
