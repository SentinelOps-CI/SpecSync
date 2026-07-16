/**
 * In-process rate limiter for mutating `/specsync` comment commands.
 * Single-instance only; pair with AuthZ. Not a substitute for GitHub secondary rate limits.
 */

export interface RateLimitDecision {
  allowed: boolean;
  retryAfterMs?: number;
  remaining: number;
}

export class CommandRateLimiter {
  private readonly hits = new Map<string, number[]>();
  private readonly max: number;
  private readonly windowMs: number;

  constructor(options?: { max?: number; windowMs?: number }) {
    this.max = options?.max ?? Number(process.env.SPECSYNC_COMMAND_RATE_LIMIT || 10);
    this.windowMs =
      options?.windowMs ?? Number(process.env.SPECSYNC_COMMAND_RATE_WINDOW_MS || 60_000);
  }

  /**
   * @param actor GitHub login
   * @param scope e.g. `acme/app#42` (owner/repo#pr)
   */
  allow(actor: string, scope: string): RateLimitDecision {
    const key = `${scope}:${actor}`;
    const now = Date.now();
    const windowStart = now - this.windowMs;
    const times = (this.hits.get(key) || []).filter((t) => t > windowStart);

    if (times.length >= this.max) {
      const oldest = times[0] ?? now;
      const retryAfterMs = Math.max(0, oldest + this.windowMs - now);
      this.hits.set(key, times);
      return { allowed: false, retryAfterMs, remaining: 0 };
    }

    times.push(now);
    this.hits.set(key, times);
    return { allowed: true, remaining: Math.max(0, this.max - times.length) };
  }

  clearForTests(): void {
    this.hits.clear();
  }
}

/** Shared limiter for the Probot process. */
export const commandRateLimiter = new CommandRateLimiter();
