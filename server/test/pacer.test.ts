import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PacedSender } from '../src/audio/pacer.js';

describe('PacedSender', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const make = (leadMs = 200) => {
    const frames: { at: number; frame: Buffer }[] = [];
    const t0 = Date.now();
    const sender = new PacedSender({
      frameBytes: 320,
      frameMs: 40,
      leadMs,
      padByte: 0xff,
      send: (frame) => frames.push({ at: Date.now() - t0, frame }),
    });
    return { sender, frames };
  };

  it('releases at most `leadMs` ahead of real time, then paces', async () => {
    const { sender, frames } = make(200);
    sender.push(Buffer.alloc(320 * 50, 0x11)); // 2 seconds of audio arrives at once
    await vi.advanceTimersByTimeAsync(0);
    // lead 200ms / 40ms per frame => about 5-6 frames immediately, definitely not all 50
    expect(frames.length).toBeGreaterThanOrEqual(5);
    expect(frames.length).toBeLessThanOrEqual(7);

    await vi.advanceTimersByTimeAsync(1000);
    // after 1s of wall time we should have sent about (1000+200)/40 = 30 frames
    expect(frames.length).toBeGreaterThanOrEqual(28);
    expect(frames.length).toBeLessThanOrEqual(32);

    await vi.advanceTimersByTimeAsync(2000);
    expect(frames.length).toBe(50);
    expect(frames.every((f) => f.frame.length === 320)).toBe(true);
  });

  it('sends audio in order and does not lose bytes', async () => {
    const { sender, frames } = make();
    const a = Buffer.alloc(500, 1);
    const b = Buffer.alloc(500, 2);
    sender.push(a);
    sender.push(b);
    await vi.advanceTimersByTimeAsync(2000);
    const joined = Buffer.concat(frames.map((f) => f.frame));
    // 1000 bytes of data -> 4 frames (1280 bytes), the last padded with 0xff
    expect(frames.length).toBe(4);
    expect(joined.subarray(0, 500).every((v) => v === 1)).toBe(true);
    expect(joined.subarray(500, 1000).every((v) => v === 2)).toBe(true);
    expect(joined.subarray(1000).every((v) => v === 0xff)).toBe(true);
  });

  it('pads and flushes a short trailing fragment after a moment of silence', async () => {
    const { sender, frames } = make();
    sender.push(Buffer.alloc(100, 7));
    await vi.advanceTimersByTimeAsync(500);
    expect(frames.length).toBe(1);
    expect(frames[0]!.frame.subarray(0, 100).every((v) => v === 7)).toBe(true);
    expect(frames[0]!.frame[100]).toBe(0xff);
  });

  it('clear() drops queued audio immediately', async () => {
    const { sender, frames } = make();
    sender.push(Buffer.alloc(320 * 100, 3));
    await vi.advanceTimersByTimeAsync(0);
    const before = frames.length;
    sender.clear();
    await vi.advanceTimersByTimeAsync(5000);
    expect(frames.length).toBe(before);
    expect(sender.queuedMs).toBe(0);
  });

  it('restarts its clock after a gap so the next sentence is not delayed', async () => {
    const { sender, frames } = make(200);
    sender.push(Buffer.alloc(320 * 5, 1));
    await vi.advanceTimersByTimeAsync(1000);
    const first = frames.length;
    expect(first).toBe(5);
    await vi.advanceTimersByTimeAsync(10_000); // long silence
    sender.push(Buffer.alloc(320 * 5, 2));
    await vi.advanceTimersByTimeAsync(0);
    expect(frames.length - first).toBeGreaterThanOrEqual(5); // lead cushion available again, sent instantly
  });
});
