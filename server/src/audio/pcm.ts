import { ulawDecode, ulawEncode } from './g711.js';

/**
 * The two audio formats that exist inside Parley:
 *  - pcm16_16k : app <-> server (PCM s16le, 16 kHz, mono)
 *  - ulaw_8k   : phone line (G.711 mu-law, 8 kHz, mono) as delivered by Telnyx
 */
export type AudioFormat = 'pcm16_16k' | 'ulaw_8k';

interface FormatInfo {
  sampleRate: number;
  bytesPerSample: number;
  /** ElevenLabs `output_format` for text-to-speech. */
  ttsFormat: string;
  /** ElevenLabs `audio_format` for realtime speech-to-text. */
  sttFormat: string;
}

export const FORMATS: Record<AudioFormat, FormatInfo> = {
  pcm16_16k: { sampleRate: 16000, bytesPerSample: 2, ttsFormat: 'pcm_16000', sttFormat: 'pcm_16000' },
  ulaw_8k: { sampleRate: 8000, bytesPerSample: 1, ttsFormat: 'ulaw_8000', sttFormat: 'ulaw_8000' },
};

export function bytesPerMs(format: AudioFormat): number {
  const f = FORMATS[format];
  return (f.sampleRate * f.bytesPerSample) / 1000;
}

export function bytesToMs(format: AudioFormat, bytes: number): number {
  return bytes / bytesPerMs(format);
}

/** Keeps a byte stream aligned to whole 16-bit samples (HTTP chunks can split a sample in two). */
export class PcmAligner {
  private carry: Buffer | null = null;

  push(chunk: Buffer): Buffer {
    let data = chunk;
    if (this.carry) {
      data = Buffer.concat([this.carry, chunk]);
      this.carry = null;
    }
    if (data.length % 2 === 1) {
      this.carry = data.subarray(data.length - 1);
      data = data.subarray(0, data.length - 1);
    }
    return data;
  }
}

function bufferToInt16(buf: Buffer): Int16Array {
  // Copy to guarantee alignment; Buffer slices from a pool may be at odd offsets.
  const copy = new Uint8Array(buf.length);
  copy.set(buf);
  return new Int16Array(copy.buffer, 0, copy.length >> 1);
}

function int16ToBuffer(samples: Int16Array): Buffer {
  return Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength);
}

/**
 * Streaming converter between the two formats. Stateful so chunk boundaries do not cause clicks.
 *   ulaw_8k   -> pcm16_16k : decode + 2x linear-interpolated upsample
 *   pcm16_16k -> ulaw_8k   : 2-tap average (crude low-pass) + decimate + encode
 */
export class Transcoder {
  private aligner = new PcmAligner();
  private prev = 0; // last 8 kHz sample (for interpolation)
  private pendingSample: number | null = null; // odd leftover 16 kHz sample

  constructor(
    readonly from: AudioFormat,
    readonly to: AudioFormat,
  ) {}

  push(chunk: Buffer): Buffer {
    if (this.from === this.to) return chunk;
    if (this.from === 'ulaw_8k') return this.ulawToPcm16k(chunk);
    return this.pcm16kToUlaw(chunk);
  }

  private ulawToPcm16k(chunk: Buffer): Buffer {
    const input = ulawDecode(chunk);
    const out = new Int16Array(input.length * 2);
    let prev = this.prev;
    for (let i = 0; i < input.length; i++) {
      const cur = input[i]!;
      out[2 * i] = (prev + cur) >> 1; // midpoint between previous and current
      out[2 * i + 1] = cur;
      prev = cur;
    }
    this.prev = prev;
    return int16ToBuffer(out);
  }

  private pcm16kToUlaw(chunk: Buffer): Buffer {
    const aligned = this.aligner.push(chunk);
    const samples = bufferToInt16(aligned);
    const merged: number[] = [];
    let i = 0;
    if (this.pendingSample !== null && samples.length > 0) {
      merged.push((this.pendingSample + samples[0]!) >> 1);
      this.pendingSample = null;
      i = 1;
    }
    for (; i + 1 < samples.length; i += 2) {
      merged.push((samples[i]! + samples[i + 1]!) >> 1);
    }
    if (i < samples.length) this.pendingSample = samples[i]!;
    return ulawEncode(Int16Array.from(merged));
  }
}
