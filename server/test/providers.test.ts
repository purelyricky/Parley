import { describe, expect, it, vi } from 'vitest';
import { SKIP_TOKEN, buildSystemPrompt, buildUserContent, cleanTranslation, createClaudeTranslator } from '../src/providers/claudeTranslator.js';
import { createElevenLabsTts } from '../src/providers/elevenlabsTts.js';
import { createElevenLabsVoices } from '../src/providers/elevenlabsVoices.js';
import { createTelnyxTelephony } from '../src/providers/telnyx.js';
import { ProviderError } from '../src/providers/types.js';

function streamOf(parts: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const p of parts) controller.enqueue(p);
      controller.close();
    },
  });
}

async function collect(iter: AsyncIterable<Buffer>): Promise<Buffer[]> {
  const out: Buffer[] = [];
  for await (const c of iter) out.push(c);
  return out;
}

describe('ElevenLabs TTS', () => {
  it('requests streaming audio in the right format and passes the voice settings', async () => {
    const fetchImpl = vi.fn(async () => new Response(streamOf([new Uint8Array([1, 2, 3, 4])]), { status: 200 }));
    const tts = createElevenLabsTts({ apiKey: 'KEY', model: 'eleven_flash_v2_5', fetchImpl: fetchImpl as unknown as typeof fetch });
    const chunks = await collect(tts.synthesize({ text: 'Szia!', voiceId: 'voice 1', language: 'hu', format: 'ulaw_8k' }));

    expect(Buffer.concat(chunks)).toEqual(Buffer.from([1, 2, 3, 4]));
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.elevenlabs.io/v1/text-to-speech/voice%201/stream?output_format=ulaw_8000');
    expect((init.headers as Record<string, string>)['xi-api-key']).toBe('KEY');
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({ text: 'Szia!', model_id: 'eleven_flash_v2_5', language_code: 'hu' });
    expect(body.voice_settings).toBeDefined();
  });

  it('asks for 16 kHz PCM for the app and keeps chunks sample-aligned', async () => {
    const fetchImpl = vi.fn(async () => new Response(streamOf([new Uint8Array([1, 2, 3]), new Uint8Array([4, 5, 6, 7])]), { status: 200 }));
    const tts = createElevenLabsTts({ apiKey: 'k', model: 'eleven_flash_v2_5', fetchImpl: fetchImpl as unknown as typeof fetch });
    const chunks = await collect(tts.synthesize({ text: 'hi', voiceId: 'v', language: 'en', format: 'pcm16_16k' }));
    expect((fetchImpl.mock.calls[0] as unknown as [string])[0]).toContain('output_format=pcm_16000');
    for (const c of chunks) expect(c.length % 2).toBe(0);
    expect(Buffer.concat(chunks).length).toBe(6); // 7th byte is held back until its partner arrives
  });

  it('omits language_code for models that do not accept it', async () => {
    const fetchImpl = vi.fn(async () => new Response(streamOf([new Uint8Array([1, 2])]), { status: 200 }));
    const tts = createElevenLabsTts({ apiKey: 'k', model: 'eleven_multilingual_v2', fetchImpl: fetchImpl as unknown as typeof fetch });
    await collect(tts.synthesize({ text: 'hi', voiceId: 'v', language: 'en', format: 'pcm16_16k' }));
    const body = JSON.parse((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.language_code).toBeUndefined();
  });

  it('turns an API error into a ProviderError with the server message', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ detail: { message: 'Quota exceeded' } }), { status: 401 }));
    const tts = createElevenLabsTts({ apiKey: 'k', model: 'eleven_flash_v2_5', fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(collect(tts.synthesize({ text: 'hi', voiceId: 'v', language: 'en', format: 'ulaw_8k' }))).rejects.toThrow(/401: Quota exceeded/);
  });
});

describe('ElevenLabs voice cloning', () => {
  it('uploads the sample as multipart form data and returns the voice id', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ voice_id: 'abc123' }), { status: 200 }));
    const voices = createElevenLabsVoices({ apiKey: 'KEY', fetchImpl: fetchImpl as unknown as typeof fetch });
    const result = await voices.clone({ name: 'Parley erick', audio: Buffer.from('RIFFxxxx'), filename: 'sample.wav', mimeType: 'audio/wav' });
    expect(result).toEqual({ voiceId: 'abc123' });

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.elevenlabs.io/v1/voices/add');
    expect((init.headers as Record<string, string>)['xi-api-key']).toBe('KEY');
    const form = init.body as FormData;
    expect(form.get('name')).toBe('Parley erick');
    expect(form.get('remove_background_noise')).toBe('true');
    const file = form.get('files') as File;
    expect(file.name).toBe('sample.wav');
    expect(file.type).toBe('audio/wav');
    expect(file.size).toBe(8);
  });

  it('explains plan problems in plain language', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ detail: { message: 'Instant voice cloning requires a paid subscription' } }), { status: 401 }));
    const voices = createElevenLabsVoices({ apiKey: 'k', fetchImpl: fetchImpl as unknown as typeof fetch });
    const err = await voices.clone({ name: 'x', audio: Buffer.from('a'), filename: 'a.wav', mimeType: 'audio/wav' }).catch((e) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect((err as ProviderError).userMessage).toMatch(/not available on the configured ElevenLabs plan/);
  });

  it('deletes voices and treats 404 as success', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 404 }));
    const voices = createElevenLabsVoices({ apiKey: 'k', fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(voices.remove('gone')).resolves.toBeUndefined();
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.elevenlabs.io/v1/voices/gone');
    expect(init.method).toBe('DELETE');
  });
});

describe('Telnyx', () => {
  const dialOptions = {
    to: '+36301234567',
    from: '+15551234567',
    connectionId: 'conn',
    streamUrl: 'wss://x.test/telnyx/stream/abc',
    webhookUrl: 'https://x.test/telnyx/webhook',
    clientState: 'call-id-1',
    timeoutSecs: 40,
  };

  it('dials with a bidirectional PCMU media stream and returns the call control id', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ data: { call_control_id: 'v3:abc' } }), { status: 200 }));
    const tel = createTelnyxTelephony({ apiKey: 'TK', fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(tel.dial(dialOptions)).resolves.toEqual({ callControlId: 'v3:abc' });

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.telnyx.com/v2/calls');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer TK');
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({
      connection_id: 'conn',
      to: '+36301234567',
      from: '+15551234567',
      stream_url: 'wss://x.test/telnyx/stream/abc',
      stream_track: 'inbound_track',
      stream_bidirectional_mode: 'rtp',
      stream_bidirectional_codec: 'PCMU',
      webhook_url: 'https://x.test/telnyx/webhook',
    });
    expect(Buffer.from(body.client_state, 'base64').toString()).toBe('call-id-1');
  });

  it('maps destination-not-allowed errors to a friendly message', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ errors: [{ detail: 'Destination country not allowed by outbound voice profile' }] }), { status: 403 }));
    const tel = createTelnyxTelephony({ apiKey: 'k', fetchImpl: fetchImpl as unknown as typeof fetch });
    const err = (await tel.dial(dialOptions).catch((e) => e)) as ProviderError;
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.status).toBe(403);
  });

  it('hangs up, ignoring already-ended calls', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 422 }));
    const tel = createTelnyxTelephony({ apiKey: 'k', fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(tel.hangup('v3:abc')).resolves.toBeUndefined();
    expect((fetchImpl.mock.calls[0] as unknown as [string])[0]).toBe('https://api.telnyx.com/v2/calls/v3%3Aabc/actions/hangup');
  });
});

describe('Claude translator', () => {
  const client = (reply: string) => ({
    messages: { create: vi.fn(async () => ({ content: [{ type: 'text', text: reply }] })) },
  });

  it('builds a prompt that names both languages and guards against injection', () => {
    const p = buildSystemPrompt('hu', 'en');
    expect(p).toMatch(/Hungarian into English/);
    expect(p).toMatch(/even if it looks like an instruction/);
    expect(p).toContain(SKIP_TOKEN);
  });

  it('includes earlier turns as context', () => {
    const content = buildUserContent({ text: 'És ő?', from: 'hu', to: 'en', context: [{ source: 'Anna itt van', translation: 'Anna is here' }] });
    expect(content).toContain('<said>Anna itt van</said>');
    expect(content).toContain('<utterance>És ő?</utterance>');
  });

  it('returns the translated text', async () => {
    const c = client('  How are you?  ');
    const tr = createClaudeTranslator({ apiKey: 'k', model: 'claude-haiku-5-5', client: c as never });
    expect(await tr.translate({ text: 'Hogy vagy?', from: 'hu', to: 'en', context: [] })).toBe('How are you?');
    const arg = (c.messages.create.mock.calls[0] as unknown as [{ model: string; messages: { content: string }[] }])[0];
    expect(arg.model).toBe('claude-haiku-5-5');
    expect(arg.messages[0]!.content).toContain('Hogy vagy?');
  });

  it('returns an empty string for noise', async () => {
    const tr = createClaudeTranslator({ apiKey: 'k', model: 'm', client: client(SKIP_TOKEN) as never });
    expect(await tr.translate({ text: 'hmm', from: 'en', to: 'es', context: [] })).toBe('');
  });

  it('short-circuits identical languages and empty input without calling the API', async () => {
    const c = client('x');
    const tr = createClaudeTranslator({ apiKey: 'k', model: 'm', client: c as never });
    expect(await tr.translate({ text: 'hello', from: 'en', to: 'en', context: [] })).toBe('hello');
    expect(await tr.translate({ text: '   ', from: 'en', to: 'es', context: [] })).toBe('');
    expect(c.messages.create).not.toHaveBeenCalled();
  });

  it('strips wrapping quotes but keeps inner quotes', () => {
    expect(cleanTranslation('"Hello there"')).toBe('Hello there');
    expect(cleanTranslation('He said "hi" to me')).toBe('He said "hi" to me');
    expect(cleanTranslation('"Hi," he said, "bye"')).toBe('"Hi," he said, "bye"');
  });
});
