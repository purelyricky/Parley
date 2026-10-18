import express, { type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import type { CallManager } from './call/manager.js';
import type { Config } from './config.js';
import { LANGUAGES, isSupportedLanguage } from './languages.js';
import { ProviderError, type Providers } from './providers/types.js';
import { StoreError, UserStore, type UserRecord } from './users.js';
import type { Logger } from './util/log.js';
import { USERNAME_RE, wavDurationSeconds } from './util/misc.js';

export interface HttpDeps {
  config: Config;
  providers: Providers;
  users: UserStore;
  manager: CallManager;
  log: Logger;
}

type AuthedHandler = (user: UserRecord, req: Request, res: Response) => Promise<void> | void;

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const PREVIEW_TEXT = 'Hi! This is my voice, speaking a language I never learned.';

export function createHttpApp(deps: HttpDeps): express.Express {
  const { config, providers, users, manager, log } = deps;
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '25mb' }));

  const auth =
    (handler: AuthedHandler) =>
    (req: Request, res: Response, next: NextFunction): void => {
      const header = req.header('authorization') ?? '';
      const user = users.byToken(header.startsWith('Bearer ') ? header.slice(7) : undefined);
      if (!user) {
        res.status(401).json({ error: { code: 'unauthorized', message: 'Please sign in again.' } });
        return;
      }
      Promise.resolve(handler(user, req, res)).catch(next);
    };

  const features = () => ({ phone: manager.phoneEnabled });

  app.get('/health', (_req, res) => {
    res.json({ ok: true, phone: manager.phoneEnabled, activeCalls: manager.activeCalls });
  });

  app.get('/api/languages', (_req, res) => {
    res.json({ languages: LANGUAGES });
  });

  app.get('/api/usernames/:username/available', (req, res) => {
    res.json({ available: users.isAvailable(String(req.params.username)) });
  });

  // Registration is lightly rate-limited per IP to keep a public tunnel from being farmed.
  const registrations = new Map<string, number[]>();
  app.post('/api/register', (req, res) => {
    const ip = req.ip ?? 'unknown';
    const now = Date.now();
    const recent = (registrations.get(ip) ?? []).filter((t) => now - t < 3_600_000);
    if (recent.length >= 20) throw new HttpError(429, 'rate_limited', 'Too many sign-ups from this network.');
    const body = z.object({ username: z.string().max(40), language: z.string().max(8) }).safeParse(req.body);
    if (!body.success) throw new HttpError(400, 'bad_request', 'Choose a username and a language.');
    if (!isSupportedLanguage(body.data.language)) throw new HttpError(400, 'unsupported_language', 'That language is not supported.');
    try {
      const user = users.register(body.data.username, body.data.language);
      recent.push(now);
      registrations.set(ip, recent);
      res.status(201).json({ token: user.token, user: users.toPublic(user), features: features() });
    } catch (err) {
      if (err instanceof StoreError) throw new HttpError(err.code === 'username_taken' ? 409 : 400, err.code, err.message);
      throw err;
    }
  });

  app.get('/api/me', auth((user, _req, res) => {
    res.json({ user: users.toPublic(user), features: features() });
  }));

  app.patch('/api/me', auth((user, req, res) => {
    const body = z.object({ language: z.string().max(8) }).safeParse(req.body);
    if (!body.success || !isSupportedLanguage(body.data.language)) throw new HttpError(400, 'unsupported_language', 'That language is not supported.');
    const updated = users.update(user.username, { language: body.data.language });
    res.json({ user: users.toPublic(updated) });
  }));

  app.delete('/api/me', auth(async (user, _req, res) => {
    if (user.voiceId) await providers.voices.remove(user.voiceId).catch((err) => log.warn('could not delete voice', err));
    users.remove(user.username);
    res.json({ ok: true });
  }));

  app.get('/api/users/:username', auth((_user, req, res) => {
    const target = users.byUsername(String(req.params.username));
    if (!target) throw new HttpError(404, 'no_such_user', 'There is no user with that username.');
    res.json({ username: target.username, language: target.language, online: manager.isOnline(target.username) });
  }));

  // --- voice cloning ---------------------------------------------------------------------------

  app.post('/api/voice', auth(async (user, req, res) => {
    const body = z
      .object({ audioBase64: z.string().min(100), mimeType: z.string().max(60).optional(), consent: z.literal(true) })
      .safeParse(req.body);
    if (!body.success) {
      throw new HttpError(400, 'consent_required', 'Please confirm this is your own voice, and include a recording.');
    }
    const audio = Buffer.from(body.data.audioBase64, 'base64');
    const mimeType = body.data.mimeType ?? 'audio/wav';
    const seconds = wavDurationSeconds(audio);
    if (seconds !== undefined && seconds < config.minVoiceSeconds) {
      throw new HttpError(422, 'too_short', `That recording is ${Math.round(seconds)}s. Please record at least ${config.minVoiceSeconds} seconds.`);
    }
    const old = user.voiceId;
    try {
      const { voiceId } = await providers.voices.clone({
        name: `Parley ${user.username}`,
        audio,
        filename: mimeType.includes('wav') ? 'sample.wav' : 'sample.m4a',
        mimeType,
      });
      const updated = users.update(user.username, {
        voiceId,
        voiceName: `Parley ${user.username}`,
        voiceConsentAt: new Date().toISOString(),
      });
      if (old) void providers.voices.remove(old).catch(() => undefined); // replace, don't accumulate
      res.json({ user: users.toPublic(updated) });
    } catch (err) {
      if (err instanceof ProviderError) throw new HttpError(422, 'clone_failed', err.userMessage ?? 'Voice cloning failed.');
      throw err;
    }
  }));

  app.delete('/api/voice', auth(async (user, _req, res) => {
    if (user.voiceId) await providers.voices.remove(user.voiceId).catch((err) => log.warn('could not delete voice', err));
    const updated = users.update(user.username, { voiceId: undefined, voiceName: undefined, voiceConsentAt: undefined });
    res.json({ user: users.toPublic(updated) });
  }));

  /** "Hear yourself in another language": translate a fixed sentence and speak it with the clone. */
  app.post('/api/voice/preview', auth(async (user, req, res) => {
    const body = z.object({ language: z.string().max(8) }).safeParse(req.body);
    if (!body.success || !isSupportedLanguage(body.data.language)) throw new HttpError(400, 'unsupported_language', 'That language is not supported.');
    if (!user.voiceId) throw new HttpError(409, 'no_voice', 'Record your voice first.');
    const text =
      body.data.language === 'en'
        ? PREVIEW_TEXT
        : await providers.translator.translate({ text: PREVIEW_TEXT, from: 'en', to: body.data.language, context: [] });
    const chunks: Buffer[] = [];
    for await (const chunk of providers.tts.synthesize({
      text,
      voiceId: user.voiceId,
      language: body.data.language,
      format: 'pcm16_16k',
    })) {
      chunks.push(chunk);
    }
    res.json({ text, language: body.data.language, audioBase64: Buffer.concat(chunks).toString('base64') });
  }));

  // --- Telnyx call status webhooks -----------------------------------------------------------------
  app.post('/telnyx/webhook', (req, res) => {
    try {
      manager.handleTelnyxWebhook(req.body);
    } catch (err) {
      log.error('webhook handling failed', err);
    }
    res.status(200).json({ ok: true }); // always 200 so Telnyx does not retry
  });

  // --- errors --------------------------------------------------------------------------------------
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: { code: err.code, message: err.message } });
      return;
    }
    if (err instanceof ProviderError) {
      log.error('provider error', err);
      res.status(502).json({ error: { code: 'provider_error', message: err.userMessage ?? 'An upstream service failed.' } });
      return;
    }
    if ((err as { type?: string }).type === 'entity.too.large') {
      res.status(413).json({ error: { code: 'too_large', message: 'That upload is too large.' } });
      return;
    }
    log.error('unhandled error', err);
    res.status(500).json({ error: { code: 'internal', message: 'Something went wrong on the server.' } });
  });

  void USERNAME_RE;
  return app;
}
