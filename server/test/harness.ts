import { WebSocket } from 'ws';
import type { Config } from '../src/config.js';
import { createServer, type RunningServer } from '../src/server.js';
import { UserStore } from '../src/users.js';
import { silentLogger } from '../src/util/log.js';
import { TestClient, makeFakes, testConfig, waitFor, type Fakes } from './helpers.js';

export interface Harness {
  server: RunningServer;
  http: string;
  ws: string;
  fakes: Fakes;
  users: UserStore;
  config: Config;
  clients: TestClient[];
  sockets: WebSocket[];
  stop(): Promise<void>;
}

/** A real Parley server on an ephemeral port, wired to fake ElevenLabs / Claude / Telnyx. */
export async function startHarness(opts: { phone?: boolean; config?: Partial<Config> } = {}): Promise<Harness> {
  const phone = opts.phone !== false;
  const config = testConfig({ ...(phone ? {} : { telnyx: undefined }), ...opts.config });
  const fakes = makeFakes({ phone });
  const users = new UserStore();
  const server = createServer({
    config,
    providers: fakes.providers,
    users,
    log: silentLogger,
    phoneLegOptions: { paced: false },
  });
  const port = await server.listen(0);
  const h: Harness = {
    server,
    http: `http://127.0.0.1:${port}`,
    ws: `ws://127.0.0.1:${port}`,
    fakes,
    users,
    config,
    clients: [],
    sockets: [],
    async stop() {
      for (const c of h.clients) c.close();
      for (const s of h.sockets) s.terminate();
      await server.close();
    },
  };
  return h;
}

export async function api(h: Harness, method: string, path: string, opts: { token?: string; body?: unknown } = {}) {
  const res = await fetch(`${h.http}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
    },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, any>;
  return { status: res.status, json };
}

/** Registers a user (optionally with an already-cloned voice) and returns their token. */
export async function register(h: Harness, username: string, language: string, voiceId?: string): Promise<string> {
  const { status, json } = await api(h, 'POST', '/api/register', { body: { username, language } });
  if (status !== 201) throw new Error(`register failed: ${status} ${JSON.stringify(json)}`);
  if (voiceId) h.users.update(username, { voiceId, voiceName: `Parley ${username}` });
  return json.token as string;
}

export async function connectApp(h: Harness, token: string): Promise<TestClient> {
  const client = new TestClient(`${h.ws}/ws?token=${token}`);
  h.clients.push(client);
  await client.opened;
  await client.waitFor('hello');
  return client;
}

/** Plays the role of Telnyx's media-stream WebSocket. */
export class TelnyxSim {
  ws: WebSocket;
  frames: { event: string; media?: { payload: string }; [k: string]: unknown }[] = [];
  opened: Promise<void>;
  closed = false;
  private seq = 0;

  constructor(h: Harness, callId: string) {
    this.ws = new WebSocket(`${h.ws}/telnyx/stream/${callId}`);
    h.sockets.push(this.ws);
    this.ws.on('message', (d) => this.frames.push(JSON.parse(d.toString())));
    this.ws.on('close', () => (this.closed = true));
    this.opened = new Promise((resolve, reject) => {
      this.ws.once('open', () => resolve());
      this.ws.once('error', reject);
    });
    this.opened.catch(() => undefined); // tests that never await it must not trigger unhandled rejections
  }

  /** Call answered: Telnyx sends `connected` then `start`. */
  async answer(): Promise<void> {
    await this.opened;
    this.ws.send(JSON.stringify({ event: 'connected' }));
    this.ws.send(
      JSON.stringify({
        event: 'start',
        sequence_number: '1',
        start: { media_format: { encoding: 'PCMU', sample_rate: 8000, channels: 1 } },
        stream_id: 'stream-1',
      }),
    );
  }

  /** The person on the phone speaks (mu-law bytes). */
  speak(ulaw: Buffer): void {
    this.seq++;
    this.ws.send(
      JSON.stringify({
        event: 'media',
        sequence_number: String(this.seq + 1),
        media: { track: 'inbound', chunk: String(this.seq), timestamp: String(this.seq * 20), payload: ulaw.toString('base64') },
        stream_id: 'stream-1',
      }),
    );
  }

  /** Audio the server has played into the call. */
  get playedBytes(): number {
    return this.frames.filter((f) => f.event === 'media').reduce((n, f) => n + Buffer.from(f.media!.payload, 'base64').length, 0);
  }

  async waitForAudio(minBytes = 1, ms = 3000): Promise<void> {
    await waitFor(() => this.playedBytes >= minBytes, ms, `${minBytes} bytes of audio to the phone`);
  }

  webhook(h: Harness, callId: string, eventType: string, payload: Record<string, unknown> = {}): Promise<number> {
    return postWebhook(h, callId, eventType, payload);
  }
}

/** A Telnyx call-status webhook (call.hangup etc.). */
export async function postWebhook(h: Harness, callId: string, eventType: string, payload: Record<string, unknown> = {}): Promise<number> {
  const res = await fetch(`${h.http}/telnyx/webhook`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      data: { event_type: eventType, payload: { client_state: Buffer.from(callId).toString('base64'), call_control_id: 'cc-1', ...payload } },
    }),
  });
  return res.status;
}
