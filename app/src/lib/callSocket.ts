import type { ClientMessage, ServerMessage } from './protocol';

export interface SocketLike {
  binaryType: string;
  readyState: number;
  send(data: string | ArrayBuffer | Uint8Array): void;
  close(): void;
  onopen: ((e?: any) => void) | null;
  onmessage: ((e: { data: any }) => void) | null;
  onclose: ((e?: any) => void) | null;
  onerror: ((e?: any) => void) | null;
}

export type SocketStatus = 'connecting' | 'open' | 'reconnecting' | 'closed';

export interface CallSocketHandlers {
  onMessage(m: ServerMessage): void;
  onAudio(bytes: Uint8Array): void;
  onStatus(s: SocketStatus): void;
  /** 4001-style rejection: token is no good. */
  onAuthFailed?(): void;
}

/** One WebSocket with JSON control messages + binary audio, reconnecting with backoff. */
export class CallSocket {
  private ws: SocketLike | null = null;
  private stopped = false;
  private attempt = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private heartbeat: ReturnType<typeof setInterval> | null = null;

  constructor(
    private url: string,
    private h: CallSocketHandlers,
    private make: (url: string) => SocketLike = (u) => new WebSocket(u) as unknown as SocketLike,
    private baseDelay = 500,
  ) {}

  connect() {
    this.stopped = false;
    this.h.onStatus(this.attempt === 0 ? 'connecting' : 'reconnecting');
    const ws = this.make(this.url);
    this.ws = ws;
    ws.binaryType = 'arraybuffer';
    ws.onopen = () => {
      this.attempt = 0;
      this.h.onStatus('open');
      this.heartbeat = setInterval(() => this.send({ type: 'ping' }), 20000);
    };
    ws.onmessage = (e) => {
      if (typeof e.data === 'string') {
        try { this.h.onMessage(JSON.parse(e.data) as ServerMessage); } catch { /* ignore garbage */ }
      } else {
        this.h.onAudio(e.data instanceof Uint8Array ? e.data : new Uint8Array(e.data));
      }
    };
    ws.onclose = (e) => {
      if (this.heartbeat) clearInterval(this.heartbeat);
      this.heartbeat = null;
      if (this.ws !== ws) return;
      this.ws = null;
      if (e?.code === 4001 || e?.code === 1008) { this.stopped = true; this.h.onStatus('closed'); this.h.onAuthFailed?.(); return; }
      if (this.stopped) { this.h.onStatus('closed'); return; }
      const delay = Math.min(8000, this.baseDelay * 2 ** this.attempt++);
      this.h.onStatus('reconnecting');
      this.timer = setTimeout(() => this.connect(), delay);
    };
    ws.onerror = () => { /* onclose follows */ };
  }

  get isOpen() { return this.ws?.readyState === 1; }

  send(m: ClientMessage): boolean {
    if (!this.isOpen) return false;
    this.ws!.send(JSON.stringify(m));
    return true;
  }

  sendAudio(bytes: Uint8Array): boolean {
    if (!this.isOpen) return false;
    this.ws!.send(bytes);
    return true;
  }

  close() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    if (this.heartbeat) clearInterval(this.heartbeat);
    const ws = this.ws;
    this.ws = null;
    ws?.close();
    this.h.onStatus('closed');
  }
}
