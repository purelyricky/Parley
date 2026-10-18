function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * Stops translation feedback loops.
 *
 * If the person on the phone has us on speakerphone, the translation we just played to them is
 * picked up by their microphone and comes back to us as "speech". We remember what we recently
 * spoke *to* a person and drop incoming transcripts that are near-copies of it.
 */
export class EchoFilter {
  private recent: { tokens: Set<string>; at: number }[] = [];

  constructor(
    private readonly ttlMs = 20_000,
    /** Share of the incoming words that must also appear in something we recently played. */
    private readonly threshold = 0.8,
    private readonly now: () => number = Date.now,
  ) {}

  remember(text: string): void {
    const t = tokens(text);
    if (t.length === 0) return;
    this.prune();
    this.recent.push({ tokens: new Set(t), at: this.now() });
  }

  isEcho(text: string): boolean {
    const t = tokens(text);
    // Very short utterances ("yes", "ok") are too ambiguous to judge; let them through.
    if (t.length < 3) return false;
    this.prune();
    const incoming = new Set(t);
    for (const { tokens: spoken } of this.recent) {
      let shared = 0;
      for (const w of incoming) if (spoken.has(w)) shared++;
      // Containment, not symmetric overlap: a speakerphone echo is often only a fragment of what we played.
      if (shared / incoming.size >= this.threshold) return true;
    }
    return false;
  }

  private prune(): void {
    const cutoff = this.now() - this.ttlMs;
    this.recent = this.recent.filter((r) => r.at >= cutoff);
  }
}
