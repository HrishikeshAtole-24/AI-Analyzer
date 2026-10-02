import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { logBatchSchema, logRecordSchema } from '../src/log-schema';

const valid = {
  eventId: randomUUID(),
  timestamp: '2026-10-05T10:00:00.000Z',
  severityText: 'ERROR',
  severityNumber: 17,
  body: 'payment failed',
  traceId: 'c2ab3c5a0f1e4d2b9a8c7d6e5f4a3b2c',
  spanId: '0f1e4d2b9a8c7d6e',
  resource: { 'service.name': 'payment-service', 'service.version': '1.4.2' },
  attributes: { 'payment.attempts': 3 },
};

describe('logRecordSchema', () => {
  it('accepts a valid record', () => {
    expect(logRecordSchema.parse(valid)).toMatchObject({ body: 'payment failed' });
  });

  it('defaults attributes to an empty object', () => {
    const { attributes: _a, ...rest } = valid;
    expect(logRecordSchema.parse(rest).attributes).toEqual({});
  });

  it.each([
    ['bad trace id', { traceId: 'xyz' }],
    ['unknown severity', { severityText: 'LOUD' }],
    ['missing service name', { resource: { 'service.version': '1' } }],
    ['nested attribute', { attributes: { a: { b: 1 } } }],
  ])('rejects %s', (_name, patch) => {
    expect(logRecordSchema.safeParse({ ...valid, ...patch }).success).toBe(false);
  });

  it('rejects empty batches', () => {
    expect(logBatchSchema.safeParse({ logs: [] }).success).toBe(false);
  });
});
