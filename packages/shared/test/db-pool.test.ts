import { describe, expect, it } from 'vitest';
import { PoolTimeoutError, SimulatedDbPool } from '../src/db-pool';

describe('SimulatedDbPool', () => {
  it('returns connections after each query', async () => {
    const pool = new SimulatedDbPool({ name: 't', size: 2, queryLatencyMs: [0, 1] });
    await Promise.all(Array.from({ length: 10 }, () => pool.query(() => 1)));
    expect(pool.stats()).toMatchObject({ active: 0, waiting: 0, leaked: 0 });
  });

  it('queues callers when all connections are busy', async () => {
    const pool = new SimulatedDbPool({ name: 't', size: 1, queryLatencyMs: [5, 5] });
    const results = await Promise.all([pool.query(() => 'a'), pool.query(() => 'b')]);
    expect(results).toEqual(['a', 'b']);
  });

  it('times out once leaked connections drain the pool', async () => {
    const pool = new SimulatedDbPool({ name: 't', size: 2, acquireTimeoutMs: 30, queryLatencyMs: [0, 1] });
    await pool.query(() => 1, { leak: true });
    await pool.query(() => 1, { leak: true });
    expect(pool.stats()).toMatchObject({ active: 2, leaked: 2 });

    const err = await pool.query(() => 1).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PoolTimeoutError);
    expect((err as PoolTimeoutError).message).toContain('active=2/2');
  });

  it('reclaimLeaked frees the pool again', async () => {
    const pool = new SimulatedDbPool({ name: 't', size: 1, acquireTimeoutMs: 30, queryLatencyMs: [0, 1] });
    await pool.query(() => 1, { leak: true });
    expect(pool.reclaimLeaked()).toBe(1);
    await expect(pool.query(() => 'ok')).resolves.toBe('ok');
    expect(pool.stats().active).toBe(0);
  });
});
