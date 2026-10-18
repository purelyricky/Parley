import { AudioContext } from 'react-native-audio-api';
import { SampleAligner, int16ToFloat } from '../lib/pcm';

const RATE = 16000;

/** Plays a stream of PCM16 16 kHz mono chunks gaplessly; `clear()` flushes (barge-in). */
export class PcmPlayer {
  private ctx: AudioContext | null = null;
  private source: ReturnType<AudioContext['createBufferQueueSource']> | null = null;
  private aligner = new SampleAligner();

  start() {
    if (this.ctx) return;
    this.ctx = new AudioContext({ sampleRate: RATE });
    this.source = this.ctx.createBufferQueueSource();
    this.source.connect(this.ctx.destination);
    this.source.start();
  }

  push(bytes: Uint8Array) {
    if (!this.ctx || !this.source) return;
    const samples = this.aligner.push(bytes);
    if (samples.length === 0) return;
    const floats = int16ToFloat(samples);
    const buffer = this.ctx.createBuffer(1, floats.length, RATE);
    buffer.copyToChannel(floats as Float32Array<ArrayBuffer>, 0);
    this.source.enqueueBuffer(buffer);
  }

  clear() {
    this.source?.clearBuffers();
    this.aligner = new SampleAligner();
  }

  stop() {
    try { this.source?.stop(); } catch { /* not started */ }
    this.source = null;
    const ctx = this.ctx;
    this.ctx = null;
    ctx?.close().catch(() => undefined);
  }
}
