import type { PublicUser } from './protocol';
import type { Language } from './languages';

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

export type FetchLike = (url: string, init?: any) => Promise<{ status: number; ok: boolean; json(): Promise<any> }>;

export interface Features { phone: boolean }

export class Api {
  constructor(
    private baseUrl: string,
    private token: string | null = null,
    private fetchImpl: FetchLike = fetch as unknown as FetchLike,
    private timeoutMs = 20000,
  ) {}

  private async req<T>(method: string, path: string, body?: unknown, timeoutMs = this.timeoutMs): Promise<T> {
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : undefined;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : undefined;
    let res;
    try {
      res = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers: { 'content-type': 'application/json', ...(this.token ? { authorization: `Bearer ${this.token}` } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: ctrl?.signal,
      });
    } catch (e: any) {
      throw new ApiError(0, 'network', e?.name === 'AbortError'
        ? 'The server took too long to answer.'
        : "Can't reach the server. Check the address and your connection.");
    } finally {
      if (timer) clearTimeout(timer);
    }
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = json?.error ?? {};
      throw new ApiError(res.status, err.code ?? 'error', err.message ?? `Server error (${res.status})`);
    }
    return json as T;
  }

  health() { return this.req<{ ok: boolean; phone: boolean }>('GET', '/health', undefined, 8000); }
  languages() { return this.req<{ languages: Language[] }>('GET', '/api/languages'); }
  usernameAvailable(u: string) {
    return this.req<{ available: boolean }>('GET', `/api/usernames/${encodeURIComponent(u)}/available`);
  }
  register(username: string, language: string) {
    return this.req<{ token: string; user: PublicUser; features: Features }>('POST', '/api/register', { username, language });
  }
  me() { return this.req<{ user: PublicUser; features: Features }>('GET', '/api/me'); }
  setLanguage(language: string) { return this.req<{ user: PublicUser }>('PATCH', '/api/me', { language }); }
  deleteAccount() { return this.req<{ ok: true }>('DELETE', '/api/me'); }
  lookup(username: string) {
    return this.req<{ username: string; language: string; online: boolean }>('GET', `/api/users/${encodeURIComponent(username)}`);
  }
  cloneVoice(audioBase64: string, consent: boolean) {
    return this.req<{ user: PublicUser }>('POST', '/api/voice', { audioBase64, mimeType: 'audio/wav', consent }, 90000);
  }
  deleteVoice() { return this.req<{ user: PublicUser }>('DELETE', '/api/voice'); }
  previewVoice(language: string) {
    return this.req<{ text: string; language: string; audioBase64: string }>('POST', '/api/voice/preview', { language }, 60000);
  }
}
