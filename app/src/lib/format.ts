export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m % 60)}:${pad(s % 60)}` : `${pad(m)}:${pad(s % 60)}`;
}

export function timeAgo(ts: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 60) return 'Just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? 'Yesterday' : `${d} days ago`;
}

export const USERNAME_RE = /^[a-z0-9_]{3,20}$/;

export function normalizeUsername(s: string): string {
  return s.trim().replace(/^@/, '').toLowerCase();
}

export function usernameProblem(s: string): string | null {
  const u = normalizeUsername(s);
  if (u.length < 3) return 'At least 3 characters';
  if (u.length > 20) return 'At most 20 characters';
  if (!USERNAME_RE.test(u)) return 'Letters, numbers and _ only';
  return null;
}

/** Turns what the user typed into a usable http(s) server URL. */
export function normalizeServerUrl(input: string): string {
  let s = input.trim().replace(/\/+$/, '');
  if (!s) return '';
  if (!/^https?:\/\//i.test(s)) s = (/^(localhost|\d+\.\d+\.\d+\.\d+)/.test(s) ? 'http://' : 'https://') + s;
  return s;
}

export function toWsUrl(httpUrl: string): string {
  return httpUrl.replace(/^http/i, 'ws');
}

export function reasonText(reason: string | undefined, peer: string): string {
  switch (reason) {
    case 'hangup': return 'Call ended';
    case 'remote_hangup': return `${peer} hung up`;
    case 'declined': return `${peer} declined`;
    case 'no_answer': return `${peer} didn't answer`;
    case 'busy': return `${peer} is busy`;
    case 'offline': return `${peer} is offline`;
    case 'timeout': return 'Nobody picked up';
    case 'limit': return 'Time limit reached';
    case 'failed': return "Couldn't connect";
    default: return 'Call ended';
  }
}
