import Constants from 'expo-constants';
import { create } from 'zustand';
// TEMPORARY demo mode (Expo Go preview): remove before release builds; see AGENTS.md.
import { DEMO, DEMO_SERVER_URL } from '../demo/demo';
import { makeDemoFetch } from '../demo/demoFetch';
import { Api, ApiError } from '../lib/api';
import { normalizeServerUrl } from '../lib/format';
import type { PublicUser } from '../lib/protocol';
import { getItem, setItem } from './storage';

const KEY = 'parley.session.v1';

interface Persisted {
  serverUrl: string;
  token: string | null;
  user: PublicUser | null;
  phoneEnabled: boolean;
  onboardingDone: boolean;
}

interface AuthState extends Persisted {
  ready: boolean;
  hydrate(): Promise<void>;
  setServerUrl(url: string): Promise<void>;
  api(): Api;
  register(username: string, language: string): Promise<void>;
  setUser(user: PublicUser): void;
  setPhoneEnabled(v: boolean): void;
  finishOnboarding(): Promise<void>;
  refresh(): Promise<void>;
  signOut(): Promise<void>;
}

export const DEFAULT_SERVER_URL: string = DEMO ? DEMO_SERVER_URL :
  process.env.EXPO_PUBLIC_SERVER_URL ?? ((Constants.expoConfig?.extra as any)?.serverUrl as string | undefined) ?? '';

export const useAuth = create<AuthState>((set, get) => {
  const persist = () => {
    const { serverUrl, token, user, phoneEnabled, onboardingDone } = get();
    void setItem(KEY, JSON.stringify({ serverUrl, token, user, phoneEnabled, onboardingDone } satisfies Persisted));
  };
  const makeApi = (token: string | null) =>
    new Api(get().serverUrl, token, DEMO ? makeDemoFetch(() => get().user) : undefined);
  return {
    serverUrl: DEFAULT_SERVER_URL,
    token: null,
    user: null,
    phoneEnabled: false,
    onboardingDone: false,
    ready: false,

    async hydrate() {
      const raw = await getItem(KEY);
      if (raw) {
        try {
          const p = JSON.parse(raw) as Partial<Persisted>;
          set({
            serverUrl: p.serverUrl || get().serverUrl,
            token: p.token ?? null,
            user: p.user ?? null,
            phoneEnabled: !!p.phoneEnabled,
            onboardingDone: !!p.onboardingDone,
          });
        } catch { /* corrupted: start fresh */ }
      }
      set({ ready: true });
      if (get().token) get().refresh().catch(() => undefined);
    },

    async setServerUrl(url) {
      set({ serverUrl: normalizeServerUrl(url) });
      persist();
    },

    api() {
      return makeApi(get().token);
    },

    async register(username, language) {
      const r = await makeApi(null).register(username, language);
      set({ token: r.token, user: r.user, phoneEnabled: r.features.phone });
      persist();
    },

    setUser(user) { set({ user }); persist(); },
    setPhoneEnabled(v) { set({ phoneEnabled: v }); persist(); },

    async finishOnboarding() { set({ onboardingDone: true }); persist(); },

    async refresh() {
      if (DEMO) return; // nothing to refresh: the demo backend is local
      try {
        const r = await get().api().me();
        set({ user: r.user, phoneEnabled: r.features.phone });
        persist();
      } catch (e) {
        // Token no longer valid (server reset or account deleted): back to onboarding.
        if (e instanceof ApiError && e.status === 401) await get().signOut();
      }
    },

    async signOut() {
      set({ token: null, user: null, onboardingDone: false });
      persist();
    },
  };
});
