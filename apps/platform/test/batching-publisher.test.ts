import { describe, expect, it } from 'vitest';
import { BatchingPublisher } from '../src/clients/batching-publisher';

function fakeProducer(delayMs = 5, failOn?: number) {
  const sends: number[] = [];
  return {
    sends,
    send: async ({ messages }: { messages: unknown[] }) => {
      sends.push(messages.length);
      await new Promise((r) => setTimeout(r, delayMs));
      if (failOn !== undefined && sends.length === failOn) throw new Error('broker down');
      return [];
    },
  };
}

const msgs = (n: number) => Array.from({ length: n }, (_, i) => ({ value: String(i) }));

describe('BatchingPublisher', () => {
  it('keeps at most `concurrency` sends in flight', async () => {
    let inFlight = 0;
    let peak = 0;
    const producer = {
      send: async () => {
        peak = Math.max(peak, ++inFlight);
        await new Promise((r) => setTimeout(r, 10));
        inFlight--;
        return [];
      },
    };
    const pub = new BatchingPublisher(producer as never, 'logs.raw', { maxMessages: 10, concurrency: 3 });
    await Promise.all(Array.from({ length: 12 }, () => pub.publish(msgs(10))));
    expect(peak).toBe(3);
  });

  it('combines concurrent publishes into few sends and resolves every caller', async () => {
    const producer = fakeProducer();
    const pub = new BatchingPublisher(producer as never, 'logs.raw');
    await Promise.all(Array.from({ length: 20 }, () => pub.publish(msgs(10))));
    expect(producer.sends.reduce((a, b) => a + b, 0)).toBe(200);
    expect(producer.sends.length).toBeLessThan(5);
  });

  it('never exceeds maxMessages per send, except for a single oversized publish', async () => {
    const producer = fakeProducer();
    const pub = new BatchingPublisher(producer as never, 'logs.raw', { maxMessages: 25, concurrency: 1 });
    await Promise.all([pub.publish(msgs(10)), pub.publish(msgs(10)), pub.publish(msgs(10)), pub.publish(msgs(40))]);
    expect(producer.sends).toEqual([20, 10, 40]);
  });

  it('rejects only the callers whose send failed', async () => {
    const producer = fakeProducer(5, 1);
    const pub = new BatchingPublisher(producer as never, 'logs.raw', { maxMessages: 10, concurrency: 1 });
    const results = await Promise.allSettled([pub.publish(msgs(10)), pub.publish(msgs(10))]);
    expect(results.map((r) => r.status)).toEqual(['rejected', 'fulfilled']);
  });
});
