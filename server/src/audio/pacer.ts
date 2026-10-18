export interface PacerOptions {
  /** Bytes in one frame that is sent to the line (e.g. 320 = 40 ms of 8 kHz mu-law). */
  frameBytes: number;
  frameMs: number;
  /** How far ahead of real time we are allowed to run (jitter cushion on the carrier side). */
  leadMs: number;
  send: (frame: Buffer) => void;
  /** Byte used to pad a trailing partial frame (mu-law silence = 0xff). */
  padByte?: number;
  now?: () => number;
}

/**
 * Releases audio to the phone line at (about) real-time speed.
 *
 * TTS streams arrive much faster than real time. Rather than rely on the carrier to buffer an
 * unbounded burst, we hand frames over just ahead of playback. Also gives us a cheap, exact
 * `clear()` for barge-in or when translation is switched off mid-sentence.
 */
export class PacedSender {
  private queue: Buffer[] = [];
  private queuedBytes = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private baseTime = 0;
  private sentMs = 0;
  private lastPush = 0;
  private readonly now: () => number;
  private readonly pad: number;

  constructor(private readonly opts: PacerOptions) {
    this.now = opts.now ?? Date.now;
    this.pad = opts.padByte ?? 0;
  }

  get queuedMs(): number {
    return (this.queuedBytes / this.opts.frameBytes) * this.opts.frameMs;
  }

  push(chunk: Buffer): void {
    if (chunk.length === 0) return;
    const t = this.now();
    // Playback clock ran dry (silence in between utterances): restart the clock.
    if (this.queuedBytes === 0 && t - this.baseTime >= this.sentMs) {
      this.baseTime = t;
      this.sentMs = 0;
    }
    this.queue.push(chunk);
    this.queuedBytes += chunk.length;
    this.lastPush = t;
    this.schedule(0);
  }

  clear(): void {
    this.queue = [];
    this.queuedBytes = 0;
    this.sentMs = 0;
    this.baseTime = this.now();
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  stop(): void {
    this.clear();
  }

  private schedule(delay: number): void {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.tick();
    }, delay);
  }

  private tick(): void {
    const { frameBytes, frameMs, leadMs } = this.opts;
    while (this.queuedBytes > 0) {
      const elapsed = this.now() - this.baseTime;
      if (this.sentMs - elapsed >= leadMs) break; // far enough ahead; wait
      if (this.queuedBytes < frameBytes && this.now() - this.lastPush < frameMs) break; // wait for more data
      this.opts.send(this.takeFrame());
      this.sentMs += frameMs;
    }
    if (this.queuedBytes > 0) {
      const elapsed = this.now() - this.baseTime;
      const wait = Math.max(5, this.sentMs - elapsed - leadMs + 1);
      this.schedule(Math.min(wait, frameMs));
    }
  }

  private takeFrame(): Buffer {
    const { frameBytes } = this.opts;
    const out = Buffer.alloc(frameBytes, this.pad);
    let filled = 0;
    while (filled < frameBytes && this.queue.length > 0) {
      const head = this.queue[0]!;
      const need = frameBytes - filled;
      if (head.length <= need) {
        head.copy(out, filled);
        filled += head.length;
        this.queue.shift();
      } else {
        head.copy(out, filled, 0, need);
        this.queue[0] = head.subarray(need);
        filled += need;
      }
    }
    this.queuedBytes -= filled;
    return out;
  }
}
