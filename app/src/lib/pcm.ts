/** PCM helpers. The wire format is PCM16 little-endian, 16 kHz, mono. */

export function floatToInt16(input: Float32Array): Int16Array {
  const out = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]!));
    out[i] = s < 0 ? Math.round(s * 32768) : Math.round(s * 32767);
  }
  return out;
}

export function int16ToFloat(input: Int16Array): Float32Array {
  const out = new Float32Array(input.length);
  for (let i = 0; i < input.length; i++) out[i] = input[i]! / (input[i]! < 0 ? 32768 : 32767);
  return out;
}

/** Linear-interpolation resampler (good enough for speech). */
export function resample(input: Float32Array, from: number, to: number): Float32Array {
  if (from === to || input.length === 0) return input;
  const n = Math.max(1, Math.round((input.length * to) / from));
  const out = new Float32Array(n);
  const ratio = from / to;
  for (let i = 0; i < n; i++) {
    const pos = i * ratio;
    const i0 = Math.floor(pos);
    const i1 = Math.min(i0 + 1, input.length - 1);
    const f = pos - i0;
    out[i] = input[Math.min(i0, input.length - 1)]! * (1 - f) + input[i1]! * f;
  }
  return out;
}

/** Root-mean-square level, 0..1. */
export function rms(input: Float32Array): number {
  if (input.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < input.length; i++) sum += input[i]! * input[i]!;
  return Math.sqrt(sum / input.length);
}

/** Maps an RMS value to a friendly 0..1 meter level (speech is ~0.02-0.2). */
export function meterLevel(r: number): number {
  return Math.max(0, Math.min(1, Math.sqrt(r * 6)));
}

export function int16ToBytes(samples: Int16Array): Uint8Array {
  const buf = new Uint8Array(samples.length * 2);
  const view = new DataView(buf.buffer);
  for (let i = 0; i < samples.length; i++) view.setInt16(i * 2, samples[i]!, true);
  return buf;
}

export function bytesToInt16(bytes: Uint8Array): Int16Array {
  const n = Math.floor(bytes.length / 2);
  const out = new Int16Array(n);
  const view = new DataView(bytes.buffer, bytes.byteOffset, n * 2);
  for (let i = 0; i < n; i++) out[i] = view.getInt16(i * 2, true);
  return out;
}

/** Re-joins audio that arrives split at arbitrary byte boundaries into whole samples. */
export class SampleAligner {
  private carry: number | null = null;
  push(bytes: Uint8Array): Int16Array {
    let data = bytes;
    if (this.carry !== null) {
      const joined = new Uint8Array(bytes.length + 1);
      joined[0] = this.carry;
      joined.set(bytes, 1);
      data = joined;
      this.carry = null;
    }
    if (data.length % 2 === 1) {
      this.carry = data[data.length - 1]!;
      data = data.subarray(0, data.length - 1);
    }
    return bytesToInt16(data);
  }
}
