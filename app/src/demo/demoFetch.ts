// TEMPORARY demo backend (see demo.ts). A FetchLike that answers the Api's routes locally.
import { LANGUAGES } from '../lib/languages';
import { bytesToBase64 } from '../lib/base64';
import type { FetchLike } from '../lib/api';
import type { PublicUser } from '../lib/protocol';

export const DEMO_ROSTER: Record<string, { language: string; online: boolean }> = {
  anna: { language: 'es', online: true },
  bence: { language: 'hu', online: true },
  sophie: { language: 'fr', online: true },
  lukas: { language: 'de', online: false },
};

const fail = (status: number, code: string, message: string) => ({ status, body: { error: { code, message } } });

export function makeDemoFetch(getUser: () => PublicUser | null): FetchLike {
  let user: PublicUser = getUser() ?? { username: 'you', language: 'en', hasVoice: false };
  const current = () => (user = getUser() ?? user);

  function route(method: string, path: string, body: any): { status: number; body: unknown } {
    if (method === 'GET' && path === '/health') return { status: 200, body: { ok: true, phone: true } };
    if (method === 'GET' && path === '/api/languages') return { status: 200, body: { languages: LANGUAGES } };
    const avail = path.match(/^\/api\/usernames\/([^/]+)\/available$/);
    if (avail) {
      const name = decodeURIComponent(avail[1]);
      return { status: 200, body: { available: !(name in DEMO_ROSTER) && name !== 'taken' } };
    }
    if (method === 'POST' && path === '/api/register') {
      user = { username: body.username, language: body.language, hasVoice: false };
      return { status: 200, body: { token: 'demo-token', user, features: { phone: true } } };
    }
    if (path === '/api/me') {
      if (method === 'PATCH') user = { ...current(), language: body.language };
      if (method === 'DELETE') return { status: 200, body: { ok: true } };
      return { status: 200, body: { user: current(), features: { phone: true } } };
    }
    const who = path.match(/^\/api\/users\/([^/]+)$/);
    if (method === 'GET' && who) {
      const name = decodeURIComponent(who[1]);
      const u = DEMO_ROSTER[name];
      return u ? { status: 200, body: { username: name, ...u } } : fail(404, 'not_found', 'No such user');
    }
    if (path === '/api/voice') {
      user =
        method === 'POST'
          ? { ...current(), hasVoice: true, voiceName: 'My voice' }
          : { ...current(), hasVoice: false, voiceName: undefined };
      return { status: 200, body: { user } };
    }
    if (method === 'POST' && path === '/api/voice/preview') {
      return {
        status: 200,
        body: {
          text: 'Hello! This is how I sound in another language.',
          language: body.language,
          audioBase64: bytesToBase64(new Uint8Array(3200)),
        },
      };
    }
    return fail(404, 'not_found', `Demo backend has no route for ${method} ${path}`);
  }

  return async (url, init) => {
    await new Promise((r) => setTimeout(r, 300));
    const path = url.replace(/^https?:\/\/[^/]+/, '');
    const { status, body } = route(init?.method ?? 'GET', path, init?.body ? JSON.parse(init.body) : undefined);
    return { status, ok: status < 400, json: async () => body };
  };
}
