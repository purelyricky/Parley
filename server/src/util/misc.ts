import { randomUUID } from 'node:crypto';

export const newId = (): string => randomUUID();

/** Strip spaces, dashes, parentheses; turn a leading 00 into +. */
export function normalizePhone(input: string): string {
  let s = input.trim().replace(/[\s().-]/g, '');
  if (s.startsWith('00')) s = '+' + s.slice(2);
  return s;
}

export function isE164(s: string): boolean {
  return /^\+[1-9]\d{6,14}$/.test(s);
}

export const USERNAME_RE = /^[a-z0-9_]{3,20}$/;

export function maskPhone(e164: string): string {
  if (e164.length < 7) return '***';
  return `${e164.slice(0, 3)}${'*'.repeat(Math.max(2, e164.length - 6))}${e164.slice(-3)}`;
}

/**
 * Reads the duration of a PCM WAV file from its header. Returns undefined if it is not a plain
 * RIFF/WAVE file (e.g. m4a), in which case we cannot judge the length cheaply.
 */
export function wavDurationSeconds(buf: Buffer): number | undefined {
  if (buf.length < 44 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
    return undefined;
  }
  let offset = 12;
  let byteRate = 0;
  while (offset + 8 <= buf.length) {
    const id = buf.toString('ascii', offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    if (id === 'fmt ') {
      byteRate = buf.readUInt32LE(offset + 16);
    } else if (id === 'data') {
      const dataBytes = Math.min(size, buf.length - offset - 8);
      return byteRate > 0 ? dataBytes / byteRate : undefined;
    }
    offset += 8 + size + (size % 2);
  }
  return undefined;
}

/** Small helper so tests and callers can await a timeout. */
export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
