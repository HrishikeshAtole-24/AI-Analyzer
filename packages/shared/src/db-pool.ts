/**
 * An in-process stand-in for a database connection pool (like `pg.Pool`). It has real
 * semantics: a fixed number of connections, a wait queue, and an acquire timeout. When
 * connections are not released, callers genuinely queue and then time out, which is the
 * failure the db_pool_exhaustion fault produces. No database server is needed.
 */

export interface DbPoolOptions {
  name: string;
  size?: number;
  acquireTimeoutMs?: number;
  /** Simulated query time range. */
  queryLatencyMs?: [number, number];
}

export interface PoolStats {
  name: string;
  size: number;
  active: number;
  idle: number;
  waiting: number;
  leaked: number;
}

export class PoolTimeoutError extends Error {
  constructor(readonly stats: PoolStats, timeoutMs: number) {
    super(
      `timeout acquiring connection from pool "${stats.name}" after ${timeoutMs}ms ` +
        `(active=${stats.active}/${stats.size}, waiting=${stats.waiting})`,
    );
    this.name = 'PoolTimeoutError';
  }
}

interface Waiter {
  resolve: () => void;
  timer: NodeJS.Timeout;
}

export class SimulatedDbPool {
  readonly name: string;
  readonly size: number;
  private readonly acquireTimeoutMs: number;
  private readonly latency: [number, number];
  private active = 0;
  private leaked = 0;
  private readonly waiters: Waiter[] = [];

  constructor(options: DbPoolOptions) {
    this.name = options.name;
    this.size = options.size ?? 10;
    this.acquireTimeoutMs = options.acquireTimeoutMs ?? 2_000;
    this.latency = options.queryLatencyMs ?? [2, 15];
  }

  /**
   * Runs a simulated query. With `leak: true` the connection is never returned to the pool,
   * like a code path that forgets `client.release()` on an early return.
   */
  async query<T>(work: () => T | Promise<T>, opts: { leak?: boolean } = {}): Promise<T> {
    await this.acquire();
    let release = true;
    try {
      const [min, max] = this.latency;
      await sleep(min + Math.random() * (max - min));
      const result = await work();
      if (opts.leak) {
        release = false;
        this.leaked++;
      }
      return result;
    } finally {
      if (release) this.release();
    }
  }

  stats(): PoolStats {
    return {
      name: this.name,
      size: this.size,
      active: this.active,
      idle: this.size - this.active,
      waiting: this.waiters.length,
      leaked: this.leaked,
    };
  }

  /** Returns leaked connections to the pool, as a process restart would. */
  reclaimLeaked(): number {
    const count = this.leaked;
    for (let i = 0; i < count; i++) this.release();
    this.leaked = 0;
    return count;
  }

  private acquire(): Promise<void> {
    if (this.active < this.size) {
      this.active++;
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      const waiter: Waiter = {
        resolve,
        timer: setTimeout(() => {
          const idx = this.waiters.indexOf(waiter);
          if (idx >= 0) this.waiters.splice(idx, 1);
          reject(new PoolTimeoutError(this.stats(), this.acquireTimeoutMs));
        }, this.acquireTimeoutMs),
      };
      this.waiters.push(waiter);
    });
  }

  private release(): void {
    const next = this.waiters.shift();
    if (next) {
      // Hand the connection straight to the next waiter; `active` stays the same.
      clearTimeout(next.timer);
      next.resolve();
    } else {
      this.active--;
    }
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
