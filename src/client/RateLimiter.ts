/**
 * RateLimiter - geteilter Client-Limiter (ADR-0005: ~2 req/s gegen IServ).
 *
 * Review-Fund "Magic Number 200/pro Instanz": das Intervall lebt hier als
 * benannte Konstante, und die Limiter-Instanz wird über `sharedRateLimiter()`
 * prozessweit geteilt (JobRunner erzeugt mehrere Client-Instanzen, aber IServ
 * sieht einen globalen Rate).
 */

/** Abstand zwischen zwei Requests in ms: 1000/5 = 200 (IServ-Limit ~5 req/s,
 *  ADR-0005 will als Obergrenze pro geteilter Instanz). */
export const RATE_LIMIT_INTERVAL_MS = 200;

export class RateLimiter {
  private lastCall = 0;
  private readonly minInterval: number;

  constructor(minIntervalMs: number = RATE_LIMIT_INTERVAL_MS) {
    this.minInterval = minIntervalMs;
  }

  async wait(): Promise<void> {
    const now = Date.now();
    const elapsed = now - this.lastCall;
    if (elapsed < this.minInterval) {
      await new Promise((r) => setTimeout(r, this.minInterval - elapsed));
    }
    this.lastCall = Date.now();
  }
}

let shared: RateLimiter | null = null;

/** Prozessweit geteilter Limiter (Spec: geteilt ~2-5 req/s, nicht pro Instanz). */
export function sharedRateLimiter(): RateLimiter {
  if (!shared) shared = new RateLimiter();
  return shared;
}
