// TEMPORARY: lazy import for Expo Go previews. Remove before release builds; see lazyAudioApi.ts.
import type { AudioRecorder } from 'react-native-audio-api';
import { getAudioApi } from './lazyAudioApi';
import { floatToInt16, int16ToBytes, meterLevel, resample, rms } from '../lib/pcm';

export interface MicOptions {
  /** Called with ~100 ms of PCM16 16 kHz mono audio. */
  onChunk(bytes: Uint8Array): void;
  /** Called for every chunk with a 0..1 loudness value. */
  onLevel?(level: number): void;
  /** When true, audio is dropped (but levels still reported as 0). */
  isMuted?(): boolean;
}

/** Captures the microphone as PCM16 16 kHz mono. */
export class MicStream {
  private rec: AudioRecorder | null = null;

  constructor(private opts: MicOptions) {}

  start() {
    if (this.rec) return;
    const rec = new (getAudioApi().AudioRecorder)();
    rec.onAudioReady({ sampleRate: 16000, bufferLength: 1600, channelCount: 1 }, (e) => {
      if (this.opts.isMuted?.()) { this.opts.onLevel?.(0); return; }
      let data: Float32Array = e.buffer.getChannelData(0);
      if (e.buffer.sampleRate !== 16000) data = resample(data, e.buffer.sampleRate, 16000);
      this.opts.onLevel?.(meterLevel(rms(data)));
      this.opts.onChunk(int16ToBytes(floatToInt16(data)));
    });
    rec.start();
    this.rec = rec;
  }

  stop() {
    const rec = this.rec;
    this.rec = null;
    if (!rec) return;
    try { rec.clearOnAudioReady(); rec.stop(); } catch { /* already stopped */ }
  }
}
