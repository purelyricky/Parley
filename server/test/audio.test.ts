import { describe, expect, it } from 'vitest';
import { linearToUlaw, ulawDecode, ulawEncode, ulawToLinear, ULAW_SILENCE } from '../src/audio/g711.js';
import { PcmAligner, Transcoder, bytesPerMs, bytesToMs } from '../src/audio/pcm.js';

const pcm = (samples: number[]): Buffer => Buffer.from(Int16Array.from(samples).buffer);
const toSamples = (buf: Buffer): number[] => Array.from(new Int16Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length)));

describe('g711 mu-law', () => {
  it('encodes digital silence as 0xff and decodes it back to ~0', () => {
    expect(linearToUlaw(0)).toBe(ULAW_SILENCE);
    expect(Math.abs(ulawToLinear(0xff))).toBeLessThan(8);
  });

  it('matches known reference values', () => {
    expect(linearToUlaw(32767)).toBe(0x80);
    expect(linearToUlaw(-32768)).toBe(0x00);
    expect(ulawToLinear(0x80)).toBe(32124);
    expect(ulawToLinear(0x00)).toBe(-32124);
  });

  it('round-trips within companding error across the whole range', () => {
    for (let s = -32000; s <= 32000; s += 97) {
      const back = ulawToLinear(linearToUlaw(s));
      // mu-law step size grows with amplitude; relative error stays under ~4%, absolute under 16 near zero.
      expect(Math.abs(back - s)).toBeLessThanOrEqual(Math.max(16, Math.abs(s) * 0.04));
    }
  });

  it('keeps the sign', () => {
    expect(ulawToLinear(linearToUlaw(1000))).toBeGreaterThan(0);
    expect(ulawToLinear(linearToUlaw(-1000))).toBeLessThan(0);
  });

  it('encodes/decodes whole buffers', () => {
    const samples = Int16Array.from([0, 100, -100, 5000, -5000, 20000, -20000]);
    const encoded = ulawEncode(samples);
    expect(encoded.length).toBe(samples.length);
    const decoded = ulawDecode(encoded);
    expect(decoded.length).toBe(samples.length);
    decoded.forEach((v, i) => expect(Math.abs(v - samples[i]!)).toBeLessThanOrEqual(Math.max(16, Math.abs(samples[i]!) * 0.04)));
  });
});

describe('format helpers', () => {
  it('computes durations', () => {
    expect(bytesPerMs('ulaw_8k')).toBe(8);
    expect(bytesPerMs('pcm16_16k')).toBe(32);
    expect(bytesToMs('ulaw_8k', 160)).toBe(20);
    expect(bytesToMs('pcm16_16k', 640)).toBe(20);
  });
});

describe('PcmAligner', () => {
  it('re-aligns chunks that split a 16-bit sample', () => {
    const a = new PcmAligner();
    const out1 = a.push(Buffer.from([1, 2, 3])); // 3 bytes -> emit 2, hold 1
    expect([...out1]).toEqual([1, 2]);
    const out2 = a.push(Buffer.from([4, 5, 6])); // held 3 + 4,5,6 -> 4 bytes
    expect([...out2]).toEqual([3, 4, 5, 6]);
    expect(a.push(Buffer.from([7])).length).toBe(0);
    expect([...a.push(Buffer.from([8]))]).toEqual([7, 8]);
  });
});

describe('Transcoder', () => {
  it('is the identity for matching formats', () => {
    const t = new Transcoder('pcm16_16k', 'pcm16_16k');
    const chunk = Buffer.from([1, 2, 3, 4]);
    expect(t.push(chunk)).toBe(chunk);
  });

  it('ulaw 8k -> pcm 16k doubles the sample count and preserves the signal', () => {
    const t = new Transcoder('ulaw_8k', 'pcm16_16k');
    const ulaw = ulawEncode(Int16Array.from([1000, 1000, 1000, 1000]));
    const out = t.push(ulaw);
    expect(out.length).toBe(ulaw.length * 4); // 2x samples, 2 bytes each
    const samples = toSamples(out);
    // after the first (ramp-in) sample every value is ~1000
    for (const v of samples.slice(2)) expect(Math.abs(v - 1000)).toBeLessThan(60);
  });

  it('pcm 16k -> ulaw 8k halves the sample count', () => {
    const t = new Transcoder('pcm16_16k', 'ulaw_8k');
    const out = t.push(pcm([2000, 2000, 2000, 2000, 2000, 2000]));
    expect(out.length).toBe(3);
    for (const v of ulawDecode(out)) expect(Math.abs(v - 2000)).toBeLessThan(100);
  });

  it('copes with chunks split at odd byte and odd sample boundaries', () => {
    const whole = pcm(Array.from({ length: 160 }, (_, i) => Math.round(8000 * Math.sin(i / 5))));
    const reference = new Transcoder('pcm16_16k', 'ulaw_8k').push(whole);

    const t = new Transcoder('pcm16_16k', 'ulaw_8k');
    const parts: Buffer[] = [];
    // deliberately awkward slicing: 7 bytes, 101 bytes, rest
    parts.push(t.push(whole.subarray(0, 7)));
    parts.push(t.push(whole.subarray(7, 108)));
    parts.push(t.push(whole.subarray(108)));
    expect(Buffer.concat(parts).equals(reference)).toBe(true);
  });

  it('ulaw -> pcm is continuous across chunk boundaries', () => {
    const ulaw = ulawEncode(Int16Array.from(Array.from({ length: 80 }, (_, i) => Math.round(6000 * Math.sin(i / 4)))));
    const ref = new Transcoder('ulaw_8k', 'pcm16_16k').push(ulaw);
    const t = new Transcoder('ulaw_8k', 'pcm16_16k');
    const joined = Buffer.concat([t.push(ulaw.subarray(0, 33)), t.push(ulaw.subarray(33))]);
    expect(joined.equals(ref)).toBe(true);
  });
});
