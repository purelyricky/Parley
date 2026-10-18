// TEMPORARY scripted call server for demo mode (see demo.ts). Same surface as CallSocket.
import type { CallSocketHandlers } from '../lib/callSocket';
import type { CallKind, ClientMessage, Peer, ServerMessage } from '../lib/protocol';
import { useAuth } from '../state/auth';
import { DEMO_ROSTER } from './demoFetch';

const SCRIPT: { who: 'me' | 'them'; text: string; translated: string }[] = [
  { who: 'them', text: 'Hola, ¿cómo estás?', translated: 'Hi, how are you?' },
  { who: 'me', text: "I'm great, thanks! How is your day going?", translated: '¡Muy bien, gracias! ¿Cómo va tu día?' },
  { who: 'them', text: 'Muy bien. ¿Nos vemos mañana?', translated: 'Very good. Shall we meet tomorrow?' },
  { who: 'me', text: 'Yes, tomorrow at noon works for me.', translated: 'Sí, mañana al mediodía me viene bien.' },
];

let incomingShown = false;

export class DemoSocket {
  private open = false;
  private timers: ReturnType<typeof setTimeout>[] = [];
  private call: { id: string; kind: CallKind; peer: Peer; translate: boolean; startedAt?: number } | null = null;
  private seq = 0;

  constructor(private h: CallSocketHandlers) {}

  get isOpen() { return this.open; }

  connect() {
    this.h.onStatus('connecting');
    this.later(300, () => {
      this.open = true;
      this.h.onStatus('open');
      const user = useAuth.getState().user;
      if (user) this.emit({ type: 'hello', user, features: { phone: true } });
      if (!incomingShown) {
        incomingShown = true;
        // A demo incoming call, so the incoming screen can be tried.
        this.later(20000, () => {
          if (!this.call) this.emit({ type: 'call.incoming', callId: this.newId(), from: { username: 'anna', language: 'es' } });
        });
      }
    });
  }

  send(m: ClientMessage): boolean {
    if (!this.open) return false;
    switch (m.type) {
      case 'call.user': {
        const lang = DEMO_ROSTER[m.to]?.language ?? 'es';
        this.start('user', { label: `@${m.to}`, language: lang }, m.translate ?? true, true);
        break;
      }
      case 'call.phone':
        this.start('phone', { label: m.to, language: m.theirLanguage }, m.translate ?? true, true);
        break;
      case 'call.mirror':
        this.start('mirror', { label: 'Mirror test', language: m.targetLanguage }, true, false);
        break;
      case 'call.accept':
        this.start('user', { label: '@anna', language: 'es' }, true, false, m.callId);
        break;
      case 'call.translate':
        if (this.call) { this.call.translate = m.enabled; this.state('connected'); }
        break;
      case 'call.hangup':
        this.clearTimers();
        if (this.call) { this.state('ended', 'hangup'); this.call = null; }
        break;
    }
    return true;
  }

  sendAudio(_bytes: Uint8Array): boolean { return this.open; }

  close() {
    this.open = false;
    this.clearTimers();
    this.call = null;
    this.h.onStatus('closed');
  }

  private start(kind: CallKind, peer: Peer, translate: boolean, ring: boolean, id = this.newId()) {
    this.clearTimers();
    this.call = { id, kind, peer, translate };
    let t = 0;
    if (ring) {
      this.state('dialing');
      this.later((t += 700), () => this.state('ringing'));
      t += 1500;
    }
    this.later(t, () => {
      this.call!.startedAt = Date.now();
      this.state('connected');
      this.emit({ type: 'notice', callId: id, text: 'This call is translated by AI.' });
    });
    SCRIPT.forEach((line, i) => {
      const at = t + 2500 + i * 4500;
      this.later(at, () => this.emit({ type: 'transcript.partial', callId: id, who: line.who, text: line.text.split(' ').slice(0, 2).join(' ') + '…' }));
      this.later(at + 1200, () => {
        const lid = `demo-${id}-${i}`;
        this.emit({ type: 'transcript', callId: id, id: lid, who: line.who, text: line.text, language: line.who === 'me' ? 'en' : peer.language });
        this.emit({ type: 'transcript.translation', callId: id, id: lid, who: line.who, text: line.translated, language: line.who === 'me' ? peer.language : 'en' });
      });
    });
  }

  private state(state: 'dialing' | 'ringing' | 'connected' | 'ended', reason?: 'hangup') {
    const c = this.call;
    if (!c) return;
    this.emit({
      type: 'call.state', callId: c.id, kind: c.kind, state, peer: c.peer, translate: c.translate,
      translationActive: c.translate, startedAt: c.startedAt, reason,
    });
  }

  private emit(m: ServerMessage) { this.h.onMessage(m); }
  private newId() { return `demo-call-${++this.seq}-${Date.now()}`; }
  private later(ms: number, fn: () => void) { this.timers.push(setTimeout(fn, ms)); }
  private clearTimers() { this.timers.forEach(clearTimeout); this.timers = []; }
}
