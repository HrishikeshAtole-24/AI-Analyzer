/**
 * Circuit breaker for the LLM call. After `threshold` consecutive failures the circuit opens and
 * calls are refused for `coolDownMs`, so a provider outage does not make every incident wait
 * through timeouts and retries. After the cool-down one trial call is allowed (half-open): it
 * closes the circuit on success and re-opens it on failure.
 */
export class CircuitBreaker {
  private failures = 0;
  private openedAt: number | null = null;

  constructor(
    private readonly threshold = 3,
    private readonly coolDownMs = 2 * 60_000,
    private readonly now: () => number = Date.now,
  ) {}

  get state(): 'closed' | 'open' | 'half_open' {
    if (this.openedAt === null) return 'closed';
    return this.now() - this.openedAt >= this.coolDownMs ? 'half_open' : 'open';
  }

  canRequest(): boolean {
    return this.state !== 'open';
  }

  recordSuccess(): void {
    this.failures = 0;
    this.openedAt = null;
  }

  recordFailure(): void {
    this.failures++;
    if (this.state === 'half_open' || this.failures >= this.threshold) this.openedAt = this.now();
  }
}
