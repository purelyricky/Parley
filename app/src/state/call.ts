import { create } from 'zustand';
import { MicStream } from '../audio/MicStream';
import { PcmPlayer } from '../audio/PcmPlayer';
import { activateCallAudio, deactivateCallAudio, ensureMicPermission } from '../audio/session';
import { CallSocket, type SocketStatus } from '../lib/callSocket';
import { reduceCall, type CallView } from '../lib/callReducer';
import { toWsUrl } from '../lib/format';
import type { ServerMessage } from '../lib/protocol';
import { useAuth } from './auth';
import { useRecents } from './recents';

interface Incoming { callId: string; from: { username: string; language: string } }

interface CallStore {
  status: SocketStatus;
  call: CallView | null;
  incoming: Incoming | null;
  muted: boolean;
  micLevel: number;
  error: string | null;
  /** A call request is in flight; the server hasn't answered with call.state yet. */
  pending: boolean;

  connect(): void;
  disconnect(): void;
  clearError(): void;
  dismissCall(): void;

  callPhone(to: string, theirLanguage: string, translate: boolean): Promise<boolean>;
  callUser(to: string, translate: boolean): Promise<boolean>;
  callMirror(targetLanguage: string): Promise<boolean>;
  accept(): Promise<void>;
  decline(): void;
  hangup(): void;
  setTranslate(enabled: boolean): void;
  toggleMute(): void;
}

let socket: CallSocket | null = null;
let mic: MicStream | null = null;
let player: PcmPlayer | null = null;
let audioOn = false;
let muted = false;
let callMeta: { direction: 'out' | 'in'; kind: 'phone' | 'user' | 'mirror'; target: string; language: string } | null = null;
let probing = false;
let pendingTimer: ReturnType<typeof setTimeout> | null = null;

export const useCall = create<CallStore>((set, get) => {
  async function startAudio() {
    if (audioOn) return;
    audioOn = true;
    try {
      await activateCallAudio();
      player = new PcmPlayer();
      player.start();
      mic = new MicStream({
        onChunk: (b) => socket?.sendAudio(b),
        onLevel: (l) => set({ micLevel: l }),
        isMuted: () => muted,
      });
      mic.start();
    } catch (e) {
      audioOn = false;
      set({ error: "Couldn't start the microphone. Check Parley's microphone permission in Settings." });
    }
  }

  function stopAudio() {
    if (!audioOn) return;
    audioOn = false;
    mic?.stop(); mic = null;
    player?.stop(); player = null;
    set({ micLevel: 0 });
    void deactivateCallAudio();
  }

  function recordRecent(call: CallView) {
    if (!callMeta) return;
    const seconds = call.startedAt ? Math.round((Date.now() - call.startedAt) / 1000) : 0;
    useRecents.getState().add({
      id: call.callId, kind: callMeta.kind, target: callMeta.target, language: callMeta.language,
      at: Date.now(), seconds, direction: callMeta.direction,
      missed: callMeta.direction === 'in' && seconds === 0,
    });
  }

  function onMessage(m: ServerMessage) {
    switch (m.type) {
      case 'hello':
        useAuth.getState().setUser(m.user);
        useAuth.getState().setPhoneEnabled(m.features.phone);
        return;
      case 'call.incoming':
        // Only one call at a time; the server also enforces this.
        set({ incoming: { callId: m.callId, from: m.from } });
        return;
      case 'audio.clear':
        player?.clear();
        return;
      case 'error':
        if (!m.callId || get().call?.callId === m.callId || !get().call) set({ error: m.message, pending: false });
        return;
      case 'call.state': {
        const inc = get().incoming;
        if (inc && inc.callId === m.callId && m.state === 'ended') {
          // The caller gave up before we answered: a missed call, not a call screen.
          useRecents.getState().add({
            id: inc.callId, kind: 'user', target: inc.from.username, language: inc.from.language,
            at: Date.now(), seconds: 0, direction: 'in', missed: true,
          });
          set({ incoming: null });
          return;
        }
        const prev = get().call;
        const next = reduceCall(prev, m);
        set({ call: next, pending: false });
        if (get().incoming?.callId === m.callId && m.state !== 'ringing') set({ incoming: null });
        if (m.state === 'ended') {
          if (next) recordRecent(next);
          stopAudio();
          muted = false;
          set({ muted: false });
        } else if (m.state === 'connected' || m.state === 'ringing' || m.state === 'dialing') {
          void startAudio();
        }
        return;
      }
      default:
        set({ call: reduceCall(get().call, m) });
    }
  }

  async function place(meta: NonNullable<typeof callMeta>, msg: Parameters<CallSocket['send']>[0]) {
    if (get().call && get().call!.state !== 'ended') { set({ error: 'You are already in a call.' }); return false; }
    if (!socket?.isOpen) { set({ error: "Not connected to the server yet. Check the address in You → Server." }); return false; }
    if (!(await ensureMicPermission())) {
      set({ error: 'Parley needs the microphone. Enable it in Settings → Parley.' });
      return false;
    }
    callMeta = meta;
    set({ call: null, error: null, pending: true });
    if (pendingTimer) clearTimeout(pendingTimer);
    pendingTimer = setTimeout(() => set({ pending: false }), 12000);
    return socket.send(msg);
  }

  return {
    status: 'closed',
    call: null,
    incoming: null,
    muted: false,
    micLevel: 0,
    error: null,
    pending: false,

    connect() {
      const { serverUrl, token } = useAuth.getState();
      if (!serverUrl || !token) return;
      socket?.close();
      socket = new CallSocket(`${toWsUrl(serverUrl)}/ws?token=${encodeURIComponent(token)}`, {
        onMessage,
        onAudio: (b) => player?.push(b),
        onStatus: (status) => {
          set({ status });
          // A rejected token looks like a failed upgrade; check it so we don't retry forever.
          if (status === 'reconnecting' && !probing) {
            probing = true;
            useAuth.getState().refresh().finally(() => { probing = false; });
          }
        },
      });
      socket.connect();
    },

    disconnect() {
      socket?.close(); socket = null;
      stopAudio();
      set({ status: 'closed', call: null, incoming: null });
    },

    clearError() { set({ error: null }); },
    dismissCall() { if (get().call?.state === 'ended') set({ call: null }); },

    callPhone: (to, theirLanguage, translate) =>
      place({ direction: 'out', kind: 'phone', target: to, language: theirLanguage }, { type: 'call.phone', to, theirLanguage, translate }),
    callUser: (to, translate) =>
      place({ direction: 'out', kind: 'user', target: to, language: '' }, { type: 'call.user', to, translate }),
    callMirror: (targetLanguage) =>
      place({ direction: 'out', kind: 'mirror', target: 'mirror', language: targetLanguage }, { type: 'call.mirror', targetLanguage }),

    async accept() {
      const inc = get().incoming;
      if (!inc) return;
      if (!(await ensureMicPermission())) {
        socket?.send({ type: 'call.decline', callId: inc.callId });
        set({ incoming: null, error: 'Parley needs the microphone to take calls.' });
        return;
      }
      callMeta = { direction: 'in', kind: 'user', target: inc.from.username, language: inc.from.language };
      set({ call: null, incoming: null });
      socket?.send({ type: 'call.accept', callId: inc.callId });
    },

    decline() {
      const inc = get().incoming;
      if (!inc) return;
      socket?.send({ type: 'call.decline', callId: inc.callId });
      useRecents.getState().add({
        id: inc.callId, kind: 'user', target: inc.from.username, language: inc.from.language,
        at: Date.now(), seconds: 0, direction: 'in', missed: true,
      });
      set({ incoming: null });
    },

    hangup() {
      const c = get().call;
      if (!c || c.state === 'ended') return;
      socket?.send({ type: 'call.hangup', callId: c.callId });
    },

    setTranslate(enabled) {
      const c = get().call;
      if (!c || c.state === 'ended') return;
      set({ call: { ...c, translate: enabled } }); // optimistic; the server confirms with call.state
      socket?.send({ type: 'call.translate', callId: c.callId, enabled });
    },

    toggleMute() {
      muted = !muted;
      set({ muted });
    },
  };
});
