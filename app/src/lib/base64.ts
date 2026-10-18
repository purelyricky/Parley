const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const LOOKUP = new Uint8Array(256).fill(255);
for (let i = 0; i < CHARS.length; i++) LOOKUP[CHARS.charCodeAt(i)] = i;

export function bytesToBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]!, b = bytes[i + 1], c = bytes[i + 2];
    const n = (a << 16) | ((b ?? 0) << 8) | (c ?? 0);
    out += CHARS[(n >> 18) & 63]! + CHARS[(n >> 12) & 63]!;
    out += b === undefined ? '=' : CHARS[(n >> 6) & 63]!;
    out += c === undefined ? '=' : CHARS[n & 63]!;
  }
  return out;
}

export function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.replace(/[^A-Za-z0-9+/]/g, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const n =
      (LOOKUP[clean.charCodeAt(i)]! << 18) |
      (LOOKUP[clean.charCodeAt(i + 1)]! << 12) |
      ((i + 2 < clean.length ? LOOKUP[clean.charCodeAt(i + 2)]! : 0) << 6) |
      (i + 3 < clean.length ? LOOKUP[clean.charCodeAt(i + 3)]! : 0);
    if (o < out.length) out[o++] = (n >> 16) & 255;
    if (o < out.length) out[o++] = (n >> 8) & 255;
    if (o < out.length) out[o++] = n & 255;
  }
  return out;
}
