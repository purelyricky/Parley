type Task = (signal: AbortSignal) => Promise<void>;

/**
 * Runs async tasks one after another (so two translated sentences never overlap) and lets the
 * caller cancel everything - including the task currently running.
 */
export class SerialQueue {
  private tasks: Task[] = [];
  private running = false;
  private controller = new AbortController();
  private idleWaiters: (() => void)[] = [];

  get size(): number {
    return this.tasks.length + (this.running ? 1 : 0);
  }

  enqueue(task: Task): void {
    this.tasks.push(task);
    void this.drain();
  }

  /** Drop queued tasks and abort the running one. */
  clear(): void {
    this.tasks = [];
    this.controller.abort();
    this.controller = new AbortController();
  }

  onIdle(): Promise<void> {
    if (!this.running && this.tasks.length === 0) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }

  private async drain(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      while (this.tasks.length > 0) {
        const task = this.tasks.shift()!;
        const signal = this.controller.signal;
        try {
          await task(signal);
        } catch {
          // Tasks report their own errors; one failing sentence must not stall the queue.
        }
      }
    } finally {
      this.running = false;
      for (const w of this.idleWaiters.splice(0)) w();
    }
  }
}
