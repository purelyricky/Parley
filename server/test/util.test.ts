import { describe, expect, it } from 'vitest';
import { EchoFilter } from '../src/util/echoFilter.js';
import { isE164, maskPhone, normalizePhone, wavDurationSeconds } from '../src/util/misc.js';
import { ChunkReorderer } from '../src/util/reorder.js';
import { SerialQueue } from '../src/util/serialQueue.js';
import { sleep } from './helpers.js';

describe('EchoFilter', () => {
  it('flags a near-copy of something we just played', () => {
    let now = 1000;
    const f = new EchoFilter(20_000, 0.8, () => now);
    f.remember('Szia, örülök hogy beszélhetünk ma este');
    expect(f.isEcho('szia örülök hogy beszélhetünk ma este')).toBe(true);
    expect(f.isEcho('Szia örülök hogy beszélhetünk')).toBe(true); // truncated echo
  });

  it('lets genuinely different speech through', () => {
    const f = new EchoFilter();
    f.remember('Hello, nice to talk to you tonight');
    expect(f.isEcho('What time does the train leave tomorrow')).toBe(false);
  });

  it('never blocks very short replies like "yes"', () => {
    const f = new EchoFilter();
    f.remember('yes');
    expect(f.isEcho('yes')).toBe(false);
  });

  it('forgets after the TTL', () => {
    let now = 0;
    const f = new EchoFilter(1000, 0.8, () => now);
    f.remember('good morning how are you today');
    expect(f.isEcho('good morning how are you today')).toBe(true);
    now = 5000;
    expect(f.isEcho('good morning how are you today')).toBe(false);
  });

  it('handles non-latin scripts', () => {
    const f = new EchoFilter();
    f.remember('你好 很高兴 认识 你');
    expect(f.isEcho('你好 很高兴 认识 你')).toBe(true);
  });
});

describe('SerialQueue', () => {
  it('runs tasks strictly one after another', async () => {
    const q = new SerialQueue();
    const log: string[] = [];
    q.enqueue(async () => {
      log.push('a-start');
      await sleep(20);
      log.push('a-end');
    });
    q.enqueue(async () => {
      log.push('b-start');
      log.push('b-end');
    });
    await q.onIdle();
    expect(log).toEqual(['a-start', 'a-end', 'b-start', 'b-end']);
  });

  it('clear() aborts the running task and drops the rest', async () => {
    const q = new SerialQueue();
    const log: string[] = [];
    q.enqueue(async (signal) => {
      log.push('a-start');
      await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve()));
      log.push(signal.aborted ? 'a-aborted' : 'a-end');
    });
    q.enqueue(async () => {
      log.push('b');
    });
    await sleep(5);
    q.clear();
    await q.onIdle();
    expect(log).toEqual(['a-start', 'a-aborted']);
  });

  it('keeps going after a task throws', async () => {
    const q = new SerialQueue();
    let ran = false;
    q.enqueue(async () => {
      throw new Error('boom');
    });
    q.enqueue(async () => {
      ran = true;
    });
    await q.onIdle();
    expect(ran).toBe(true);
  });

  it('accepts new work after being cleared', async () => {
    const q = new SerialQueue();
    q.clear();
    let ran = false;
    q.enqueue(async (signal) => {
      ran = !signal.aborted;
    });
    await q.onIdle();
    expect(ran).toBe(true);
  });
});

describe('ChunkReorderer', () => {
  it('passes in-order frames straight through', () => {
    const r = new ChunkReorderer<string>();
    expect(r.push(1, 'a')).toEqual(['a']);
    expect(r.push(2, 'b')).toEqual(['b']);
  });

  it('puts out-of-order frames back in sequence', () => {
    const r = new ChunkReorderer<string>();
    expect(r.push(1, 'a')).toEqual(['a']);
    expect(r.push(3, 'c')).toEqual([]);
    expect(r.push(2, 'b')).toEqual(['b', 'c']);
  });

  it('does not wait forever for a lost frame', () => {
    const r = new ChunkReorderer<number>(3);
    r.push(1, 1);
    const out: number[] = [];
    for (let i = 3; i <= 7; i++) out.push(...r.push(i, i)); // frame 2 never arrives
    expect(out).toEqual([3, 4, 5, 6, 7]);
  });

  it('ignores late duplicates', () => {
    const r = new ChunkReorderer<string>();
    r.push(5, 'x');
    expect(r.push(4, 'late')).toEqual([]);
  });
});

describe('phone helpers', () => {
  it('normalizes pasted numbers', () => {
    expect(normalizePhone(' +36 (30) 123-4567 ')).toBe('+36301234567');
    expect(normalizePhone('0036301234567')).toBe('+36301234567');
  });
  it('validates E.164', () => {
    expect(isE164('+36301234567')).toBe(true);
    expect(isE164('06301234567')).toBe(false);
    expect(isE164('+0123456789')).toBe(false);
    expect(isE164('+123')).toBe(false);
  });
  it('masks numbers for logs', () => {
    const masked = maskPhone('+36301234567');
    expect(masked).not.toContain('1234');
    expect(masked.startsWith('+36')).toBe(true);
    expect(masked.endsWith('567')).toBe(true);
  });
});

describe('wavDurationSeconds', () => {
  function wav(seconds: number, rate = 16000): Buffer {
    const data = Buffer.alloc(seconds * rate * 2);
    const h = Buffer.alloc(44);
    h.write('RIFF', 0);
    h.writeUInt32LE(36 + data.length, 4);
    h.write('WAVE', 8);
    h.write('fmt ', 12);
    h.writeUInt32LE(16, 16);
    h.writeUInt16LE(1, 20);
    h.writeUInt16LE(1, 22);
    h.writeUInt32LE(rate, 24);
    h.writeUInt32LE(rate * 2, 28);
    h.writeUInt16LE(2, 32);
    h.writeUInt16LE(16, 34);
    h.write('data', 36);
    h.writeUInt32LE(data.length, 40);
    return Buffer.concat([h, data]);
  }
  it('reads the duration from the header', () => {
    expect(wavDurationSeconds(wav(30))).toBeCloseTo(30, 3);
    expect(wavDurationSeconds(wav(12, 8000))).toBeCloseTo(12, 3);
  });
  it('returns undefined for other formats', () => {
    expect(wavDurationSeconds(Buffer.from('not a wav file at all, just some bytes that are long enough......'))).toBeUndefined();
  });
});
