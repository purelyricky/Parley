import { create } from 'zustand';
import type { CallKind } from '../lib/protocol';
import { getItem, setItem } from './storage';

const KEY = 'parley.recents.v1';
const MAX = 12;

export interface Recent {
  id: string;
  kind: CallKind;
  /** phone number or username (no @) */
  target: string;
  language: string;
  at: number;
  seconds: number;
  direction: 'out' | 'in';
  missed?: boolean;
}

interface RecentsState {
  items: Recent[];
  hydrate(): Promise<void>;
  add(r: Recent): void;
  clear(): void;
}

export const useRecents = create<RecentsState>((set, get) => ({
  items: [],
  async hydrate() {
    const raw = await getItem(KEY);
    if (!raw) return;
    try { set({ items: JSON.parse(raw) as Recent[] }); } catch { /* ignore */ }
  },
  add(r) {
    const items = [r, ...get().items.filter((x) => x.id !== r.id)].slice(0, MAX);
    set({ items });
    void setItem(KEY, JSON.stringify(items));
  },
  clear() {
    set({ items: [] });
    void setItem(KEY, null);
  },
}));
