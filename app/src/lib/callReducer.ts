import type { CallKind, CallState, EndReason, Peer, ServerMessage } from './protocol';

export interface Line {
  id: string;
  who: 'me' | 'them';
  /** What was actually said, in the speaker's language. */
  original: string;
  language: string;
  /** What the listener heard (translation), when translating. */
  translated?: string;
  translatedLanguage?: string;
}

export interface CallView {
  callId: string;
  kind: CallKind;
  state: CallState;
  peer: Peer;
  translate: boolean;
  translationActive: boolean;
  startedAt?: number;
  reason?: EndReason;
  message?: string;
  lines: Line[];
  partial: { me?: string; them?: string };
  notices: string[];
}

export function initialCall(m: Extract<ServerMessage, { type: 'call.state' }>): CallView {
  return {
    callId: m.callId, kind: m.kind, state: m.state, peer: m.peer, translate: m.translate,
    translationActive: m.translationActive, startedAt: m.startedAt, reason: m.reason, message: m.message,
    lines: [], partial: {}, notices: [],
  };
}

/** Applies a server message to the current call (pure, so it is easy to test). */
export function reduceCall(call: CallView | null, m: ServerMessage): CallView | null {
  switch (m.type) {
    case 'call.state': {
      if (!call || call.callId !== m.callId) return initialCall(m);
      return {
        ...call, kind: m.kind, state: m.state, peer: m.peer, translate: m.translate,
        translationActive: m.translationActive, startedAt: m.startedAt ?? call.startedAt,
        reason: m.reason, message: m.message,
      };
    }
    case 'transcript.partial': {
      if (!call || call.callId !== m.callId) return call;
      return { ...call, partial: { ...call.partial, [m.who]: m.text || undefined } };
    }
    case 'transcript': {
      if (!call || call.callId !== m.callId) return call;
      const partial = { ...call.partial, [m.who]: undefined };
      if (call.lines.some((l) => l.id === m.id)) return { ...call, partial };
      return { ...call, partial, lines: [...call.lines, { id: m.id, who: m.who, original: m.text, language: m.language }] };
    }
    case 'transcript.translation': {
      if (!call || call.callId !== m.callId) return call;
      const exists = call.lines.some((l) => l.id === m.id);
      const lines = exists
        ? call.lines.map((l) => (l.id === m.id ? { ...l, translated: m.text, translatedLanguage: m.language } : l))
        : [...call.lines, { id: m.id, who: m.who, original: '', language: '', translated: m.text, translatedLanguage: m.language }];
      return { ...call, lines };
    }
    case 'notice': {
      if (!call || call.callId !== m.callId) return call;
      return { ...call, notices: [...call.notices, m.text] };
    }
    default:
      return call;
  }
}

/** What to show for a line: lead with what the *listener* understands. */
export function lineText(l: Line, translating: boolean): { main: string; sub?: string } {
  if (!translating || !l.translated) return { main: l.original || l.translated || '' };
  return { main: l.translated, sub: l.original || undefined };
}
