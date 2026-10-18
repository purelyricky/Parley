/**
 * Telnyx documents that media frames over the WebSocket are not guaranteed to arrive in order and
 * numbers them with `chunk`. This puts them back in sequence, but never waits forever: if a frame
 * is still missing after `maxHold` newer frames have arrived, we give up on it and move on.
 */
export class ChunkReorderer<T> {
  private next: number | null = null;
  private held = new Map<number, T>();

  constructor(private readonly maxHold = 5) {}

  push(seq: number, item: T): T[] {
    if (this.next === null) this.next = seq;
    if (seq < this.next) return []; // late duplicate / already skipped
    this.held.set(seq, item);

    const out: T[] = [];
    this.drainReady(out);

    if (this.held.size > this.maxHold) {
      // Give up on the missing frame(s): jump to the oldest one we do hold.
      this.next = Math.min(...this.held.keys());
      this.drainReady(out);
    }
    return out;
  }

  private drainReady(out: T[]): void {
    while (this.next !== null && this.held.has(this.next)) {
      out.push(this.held.get(this.next)!);
      this.held.delete(this.next);
      this.next++;
    }
  }
}
