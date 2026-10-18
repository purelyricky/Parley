/** ITU-T G.711 mu-law codec (the codec of ordinary phone calls, 8 kHz). */

const BIAS = 0x84;
const CLIP = 32635;

export function linearToUlaw(sample: number): number {
  let s = sample;
  const sign = (s >> 8) & 0x80;
  if (sign !== 0) s = -s;
  if (s > CLIP) s = CLIP;
  s += BIAS;
  let exponent = 7;
  for (let mask = 0x4000; (s & mask) === 0 && exponent > 0; exponent--, mask >>= 1) {
    /* find the highest set bit */
  }
  const mantissa = (s >> (exponent + 3)) & 0x0f;
  return ~(sign | (exponent << 4) | mantissa) & 0xff;
}

export function ulawToLinear(byte: number): number {
  const u = ~byte & 0xff;
  const sign = u & 0x80;
  const exponent = (u >> 4) & 0x07;
  const mantissa = u & 0x0f;
  const sample = (((mantissa << 3) + BIAS) << exponent) - BIAS;
  return sign !== 0 ? -sample : sample;
}

const DECODE_TABLE = new Int16Array(256);
for (let i = 0; i < 256; i++) DECODE_TABLE[i] = ulawToLinear(i);

export function ulawDecode(buf: Uint8Array): Int16Array {
  const out = new Int16Array(buf.length);
  for (let i = 0; i < buf.length; i++) out[i] = DECODE_TABLE[buf[i]!]!;
  return out;
}

export function ulawEncode(samples: Int16Array): Buffer {
  const out = Buffer.alloc(samples.length);
  for (let i = 0; i < samples.length; i++) out[i] = linearToUlaw(samples[i]!);
  return out;
}

/** mu-law byte for digital silence. */
export const ULAW_SILENCE = 0xff;
