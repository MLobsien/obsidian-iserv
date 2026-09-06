import { createHash } from "crypto";

export function hashFile(data: Buffer): Promise<string> {
  return new Promise((resolve) => {
    const hash = createHash("sha256").update(data).digest("hex");
    resolve(hash);
  });
}

export function quickHash(
  name: string,
  size: number,
  mtime: number,
): string {
  return createHash("sha256")
    .update(`${name}:${size}:${mtime}`)
    .digest("hex");
}

interface CacheEntry {
  hash: string;
  timestamp: number;
}

export class DiscardCache {
  private entries: Map<string, CacheEntry> = new Map();
  private ttlMs: number;

  constructor(ttlMs: number = 48 * 60 * 60 * 1000) {
    this.ttlMs = ttlMs;
  }

  add(hash: string): void {
    this.entries.set(hash, { hash, timestamp: Date.now() });
  }

  isDiscarded(hash: string): boolean {
    const entry = this.entries.get(hash);
    if (!entry) return false;
    if (Date.now() - entry.timestamp > this.ttlMs) {
      this.entries.delete(hash);
      return false;
    }
    return true;
  }

  cleanup(): void {
    const now = Date.now();
    for (const [hash, entry] of this.entries) {
      if (now - entry.timestamp > this.ttlMs) {
        this.entries.delete(hash);
      }
    }
  }

  get size(): number {
    return this.entries.size;
  }
}
