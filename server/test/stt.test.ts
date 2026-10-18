import type { IncomingMessage } from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WebSocketServer, type WebSocket } from 'ws';
import { createElevenLabsStt } from '../src/providers/elevenlabsStt.js';
import { sleep, waitFor } from './helpers.js';

interface Conn {
  ws: WebSocket;
  req: IncomingMessage;
  messages: { message_type: string; audio_base_64: string; commit: boolean; sample_rate: number }[];
}

let wss: WebSocketServer;
let conns: Conn[];
let baseUrl: string;

beforeEach(async () => {
  conns = [];
  wss = new WebSocketServer({ port: 0 });
  wss.on('connection', (ws, req) => {
    const conn: Conn = { ws, req, messages: [] };
    conns.push(conn);
    ws.on('message', (data) => conn.messages.push(JSON.parse(data.toString())));
  });
  await new Promise<void>((r) => wss.once('listening', () => r()));
  const addr = wss.address();
  baseUrl = `ws://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
});

afterEach(async () => {
  for (const c of wss.clients) c.terminate();
  await new Promise<void>((r) => wss.close(() => r()));
});

const make = (over: { format?: 'pcm16_16k' | 'ulaw_8k'; language?: string; batchMs?: number } = {}) => {
  const events = { partial: [] as string[], committed: [] as string[], errors: [] as Error[] };
  const factory = createElevenLabsStt({ apiKey: 'SECRET', vadSilenceSecs: 0.7, baseUrl, batchMs: over.batchMs ?? 100 });
  const session = factory({
    language: over.language ?? 'hu',
    format: over.format ?? 'pcm16_16k',
    onPartial: (t) => events.partial.push(t),
    onCommitted: (t) => events.committed.push(t),
    onError: (e) => events.errors.push(e),
  });
  return { session, events };
};

describe('ElevenLabs realtime STT client', () => {
  it('connects with the API key and the right session parameters', async () => {
    make({ format: 'ulaw_8k', language: 'hu' });
    const conn = await waitFor(() => conns[0], 2000, 'connection');
    expect(conn.req.headers['xi-api-key']).toBe('SECRET');
    const url = new URL(conn.req.url!, 'http://x');
    expect(url.pathname).toBe('/v1/speech-to-text/realtime');
    expect(url.searchParams.get('model_id')).toBe('scribe_v2_realtime');
    expect(url.searchParams.get('audio_format')).toBe('ulaw_8000');
    expect(url.searchParams.get('commit_strategy')).toBe('vad');
    expect(url.searchParams.get('vad_silence_threshold_secs')).toBe('0.7');
    expect(url.searchParams.get('language_code')).toBe('hu');
  });

  it('batches small chunks into ~100ms messages with base64 audio and the sample rate', async () => {
    const { session } = make({ format: 'pcm16_16k' });
    await waitFor(() => conns[0], 2000);
    await sleep(30);
    const chunk = Buffer.alloc(1600, 5); // 50 ms of 16 kHz PCM
    session.send(chunk);
    session.send(chunk); // together = 100 ms -> one message
    const conn = conns[0]!;
    await waitFor(() => conn.messages.length >= 1, 2000, 'audio message');
    expect(conn.messages).toHaveLength(1);
    const m = conn.messages[0]!;
    expect(m.message_type).toBe('input_audio_chunk');
    expect(m.commit).toBe(false);
    expect(m.sample_rate).toBe(16000);
    expect(Buffer.from(m.audio_base_64, 'base64').length).toBe(3200);
  });

  it('uses 8 kHz for phone audio', async () => {
    const { session } = make({ format: 'ulaw_8k' });
    await waitFor(() => conns[0], 2000);
    await sleep(30);
    session.send(Buffer.alloc(800, 0xff)); // 100 ms
    await waitFor(() => conns[0]!.messages.length >= 1, 2000);
    expect(conns[0]!.messages[0]!.sample_rate).toBe(8000);
  });

  it('keeps audio that is sent before the socket is open', async () => {
    const { session } = make({ batchMs: 20 });
    session.send(Buffer.alloc(640, 1)); // sent immediately, socket not open yet
    session.send(Buffer.alloc(640, 2));
    await waitFor(() => conns[0] && conns[0].messages.length >= 2, 2000, 'flushed audio');
    expect(Buffer.from(conns[0]!.messages[0]!.audio_base_64, 'base64')[0]).toBe(1);
    expect(Buffer.from(conns[0]!.messages[1]!.audio_base_64, 'base64')[0]).toBe(2);
  });

  it('delivers partial and committed transcripts', async () => {
    const { events } = make();
    const conn = await waitFor(() => conns[0], 2000);
    conn.ws.send(JSON.stringify({ message_type: 'session_started', session_id: 's' }));
    conn.ws.send(JSON.stringify({ message_type: 'partial_transcript', text: 'Sz' }));
    conn.ws.send(JSON.stringify({ message_type: 'partial_transcript', text: 'Szia' }));
    conn.ws.send(JSON.stringify({ message_type: 'committed_transcript', text: '  Szia, hogy vagy?  ' }));
    conn.ws.send(JSON.stringify({ message_type: 'committed_transcript', text: '   ' })); // ignored
    await waitFor(() => events.committed.length === 1, 2000);
    expect(events.partial).toEqual(['Sz', 'Szia']);
    expect(events.committed).toEqual(['Szia, hogy vagy?']);
  });

  it('reports service errors', async () => {
    const { events } = make();
    const conn = await waitFor(() => conns[0], 2000);
    conn.ws.send(JSON.stringify({ message_type: 'quota_exceeded', error: 'out of credits' }));
    await waitFor(() => events.errors.length === 1, 2000);
    expect(events.errors[0]!.message).toMatch(/quota_exceeded: out of credits/);
  });

  it('reconnects after an unexpected disconnect and keeps working', async () => {
    const { session, events } = make({ batchMs: 20 });
    const first = await waitFor(() => conns[0], 2000);
    await sleep(30);
    first.ws.close(); // server drops us
    await waitFor(() => conns.length === 2, 3000, 'reconnect');
    session.send(Buffer.alloc(640, 9));
    await waitFor(() => conns[1]!.messages.length >= 1, 2000, 'audio after reconnect');
    conns[1]!.ws.send(JSON.stringify({ message_type: 'committed_transcript', text: 'ok then' }));
    await waitFor(() => events.committed.length === 1, 2000);
  });

  it('stops for good after close()', async () => {
    const { session } = make();
    const conn = await waitFor(() => conns[0], 2000);
    session.close();
    await sleep(600);
    expect(conns).toHaveLength(1);
    expect(conn.ws.readyState).toBeGreaterThanOrEqual(2); // closing or closed
  });
});
