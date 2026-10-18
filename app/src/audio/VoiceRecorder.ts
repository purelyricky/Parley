import { MicStream } from './MicStream';
import { bytesToInt16 } from '../lib/pcm';
import { encodeWav } from '../lib/wav';

/** Records a voice sample for cloning, exposing elapsed time and a level meter. */
export class VoiceRecorder {
  private chunks: Uint8Array[] = [];
  private samples = 0;
  private mic: MicStream;

  constructor(private onLevel: (l: number) => void) {
    this.mic = new MicStream({
      onChunk: (b) => { this.chunks.push(b); this.samples += b.length / 2; },
      onLevel: (l) => this.onLevel(l),
    });
  }

  get seconds() { return this.samples / 16000; }

  start() { this.reset(); this.mic.start(); }
  pause() { this.mic.stop(); }
  resume() { this.mic.start(); }
  stop() { this.mic.stop(); }

  reset() { this.chunks = []; this.samples = 0; }

  /** WAV bytes of everything recorded so far. */
  toWav(): Uint8Array {
    const all = new Int16Array(this.samples);
    let o = 0;
    for (const c of this.chunks) { const s = bytesToInt16(c); all.set(s, o); o += s.length; }
    return encodeWav(all, 16000);
  }
}
