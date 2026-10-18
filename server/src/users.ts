import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { PublicUser } from './protocol.js';
import { USERNAME_RE } from './util/misc.js';

export interface UserRecord {
  username: string;
  language: string;
  token: string;
  voiceId?: string;
  voiceName?: string;
  voiceConsentAt?: string;
  createdAt: string;
}

export class StoreError extends Error {
  constructor(
    public readonly code: 'username_taken' | 'username_invalid',
    message: string,
  ) {
    super(message);
    this.name = 'StoreError';
  }
}

/**
 * Tiny JSON-file user database. Fine for a prototype and a few dozen testers.
 * (Swap for Postgres/SQLite + proper auth before a public launch.)
 */
export class UserStore {
  private byName = new Map<string, UserRecord>();
  private byTokenMap = new Map<string, UserRecord>();

  /** @param file path to the JSON file; omit for an in-memory store (tests). */
  constructor(private readonly file?: string) {
    if (file && existsSync(file)) {
      const rows = JSON.parse(readFileSync(file, 'utf8')) as UserRecord[];
      for (const u of rows) this.index(u);
    }
  }

  private index(u: UserRecord): void {
    this.byName.set(u.username, u);
    this.byTokenMap.set(u.token, u);
  }

  private persist(): void {
    if (!this.file) return;
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify([...this.byName.values()], null, 2), { mode: 0o600 });
    renameSync(tmp, this.file);
  }

  static normalizeUsername(raw: string): string {
    return raw.trim().replace(/^@/, '').toLowerCase();
  }

  isAvailable(rawUsername: string): boolean {
    const u = UserStore.normalizeUsername(rawUsername);
    return USERNAME_RE.test(u) && !this.byName.has(u);
  }

  register(rawUsername: string, language: string): UserRecord {
    const username = UserStore.normalizeUsername(rawUsername);
    if (!USERNAME_RE.test(username)) {
      throw new StoreError('username_invalid', 'Usernames are 3-20 characters: letters, numbers and underscores.');
    }
    if (this.byName.has(username)) throw new StoreError('username_taken', 'That username is taken.');
    const user: UserRecord = {
      username,
      language,
      token: randomBytes(24).toString('hex'),
      createdAt: new Date().toISOString(),
    };
    this.index(user);
    this.persist();
    return user;
  }

  byToken(token: string | null | undefined): UserRecord | undefined {
    return token ? this.byTokenMap.get(token) : undefined;
  }

  byUsername(rawUsername: string): UserRecord | undefined {
    return this.byName.get(UserStore.normalizeUsername(rawUsername));
  }

  update(username: string, patch: Partial<Omit<UserRecord, 'username' | 'token' | 'createdAt'>>): UserRecord {
    const user = this.byName.get(username);
    if (!user) throw new Error(`Unknown user ${username}`);
    Object.assign(user, patch);
    // `undefined` in a patch means "clear this field".
    for (const key of Object.keys(patch) as (keyof typeof patch)[]) {
      if (patch[key] === undefined) delete user[key];
    }
    this.persist();
    return user;
  }

  remove(username: string): void {
    const user = this.byName.get(username);
    if (!user) return;
    this.byName.delete(username);
    this.byTokenMap.delete(user.token);
    this.persist();
  }

  toPublic(u: UserRecord): PublicUser {
    return {
      username: u.username,
      language: u.language,
      hasVoice: Boolean(u.voiceId),
      ...(u.voiceName ? { voiceName: u.voiceName } : {}),
    };
  }
}
