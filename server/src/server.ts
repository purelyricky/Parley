import { createServer as createHttpServer, type Server } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import { CallManager, type ManagerDeps } from './call/manager.js';
import type { AppConnection, AppLeg } from './call/legs.js';
import type { Config } from './config.js';
import { createHttpApp } from './http.js';
import type { ClientMessage, ServerMessage } from './protocol.js';
import type { Providers } from './providers/types.js';
import type { UserStore } from './users.js';
import type { Logger } from './util/log.js';

export interface ServerDeps {
  config: Config;
  providers: Providers;
  users: UserStore;
  log: Logger;
  phoneLegOptions?: ManagerDeps['phoneLegOptions'];
}

export interface RunningServer {
  http: Server;
  manager: CallManager;
  listen(port?: number): Promise<number>;
  close(): Promise<void>;
}

const HEARTBEAT_MS = 20_000;

export function createServer(deps: ServerDeps): RunningServer {
  const { config, providers, users, log } = deps;
  const manager = new CallManager({ config, providers, users, log, phoneLegOptions: deps.phoneLegOptions });
  const app = createHttpApp({ config, providers, users, manager, log });
  const http = createHttpServer(app);

  const appWss = new WebSocketServer({ noServer: true, maxPayload: 1 << 20 });
  const telnyxWss = new WebSocketServer({ noServer: true, maxPayload: 1 << 20 });

  http.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://localhost');

    if (url.pathname === '/ws') {
      const user = users.byToken(url.searchParams.get('token'));
      if (!user) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }
      appWss.handleUpgrade(req, socket, head, (ws) => handleAppSocket(ws, user.username));
      return;
    }

    const telnyxMatch = url.pathname.match(/^\/telnyx\/stream\/([0-9a-fA-F-]{36})$/);
    if (telnyxMatch) {
      telnyxWss.handleUpgrade(req, socket, head, (ws) => {
        if (!manager.attachTelnyxStream(telnyxMatch[1]!, ws)) {
          log.warn('rejected a Telnyx stream for an unknown call');
          ws.close(1008, 'unknown call');
        }
      });
      return;
    }

    socket.destroy();
  });

  function handleAppSocket(ws: WebSocket, username: string): void {
    const conn: AppConnection = {
      username,
      leg: undefined as AppLeg | undefined,
      callId: undefined,
      send(msg: ServerMessage) {
        if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
      },
      sendBinary(buf: Buffer) {
        if (ws.readyState === ws.OPEN) ws.send(buf, { binary: true });
      },
    };
    manager.addConnection(conn);

    const user = users.byUsername(username);
    if (user) conn.send({ type: 'hello', user: users.toPublic(user), features: { phone: manager.phoneEnabled } });

    let alive = true;
    ws.on('pong', () => (alive = true));
    const heartbeat = setInterval(() => {
      if (!alive) return ws.terminate();
      alive = false;
      ws.ping();
    }, HEARTBEAT_MS);

    ws.on('message', (data, isBinary) => {
      if (isBinary) {
        conn.leg?.receiveAudio(data as Buffer);
        return;
      }
      let json: unknown;
      try {
        json = JSON.parse(data.toString());
      } catch {
        return conn.send({ type: 'error', code: 'bad_message', message: 'Unrecognized message.' });
      }
      manager.handleMessage(conn, json as ClientMessage);
    });

    ws.on('close', () => {
      clearInterval(heartbeat);
      manager.removeConnection(conn);
    });
    ws.on('error', (err) => log.warn(`app socket error (${username})`, err));
  }

  return {
    http,
    manager,
    listen(port = config.port) {
      return new Promise((resolve) => {
        http.listen(port, () => {
          const addr = http.address();
          resolve(typeof addr === 'object' && addr ? addr.port : port);
        });
      });
    },
    close() {
      manager.endAll();
      for (const c of appWss.clients) c.terminate();
      for (const c of telnyxWss.clients) c.terminate();
      return new Promise((resolve) => {
        http.close(() => resolve());
        http.closeAllConnections?.();
      });
    },
  };
}
