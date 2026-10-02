import { randomUUID } from 'node:crypto';
import type { LogRecord } from '@ai-analyzer/shared';
import { describe, expect, it } from 'vitest';
import { dailyIndex } from '../src/clients/opensearch';
import { toLogDocument } from '../src/logs/document';
import { splitBatch } from '../src/logs/ingest';
import { parseMessages } from '../src/worker/log-indexer';

function record(overrides: Partial<LogRecord> = {}): LogRecord {
  return {
    eventId: randomUUID(),
    timestamp: '2026-10-05T10:00:00.000Z',
    severityText: 'INFO',
    severityNumber: 9,
    body: 'POST /payments 201 111.0ms',
    traceId: '0c9a483c1bb0437603b89c29cc671ba8',
    spanId: '264b2f3c1649f887',
    resource: { 'service.name': 'payment-service', 'service.version': '1.4.2', 'deployment.environment': 'local' },
    attributes: {
      'http.request.method': 'POST',
      'http.route': '/payments',
      'http.response.status_code': 201,
      duration_ms: 111.04,
    },
    ...overrides,
  };
}

describe('toLogDocument', () => {
  it('promotes the fields used for metrics to typed fields', () => {
    const doc = toLogDocument(record(), '2026-10-05T10:00:01.000Z');
    expect(doc).toMatchObject({
      '@timestamp': '2026-10-05T10:00:00.000Z',
      service: 'payment-service',
      serviceVersion: '1.4.2',
      http: { method: 'POST', route: '/payments', statusCode: 201 },
      durationMs: 111.04,
    });
    // flat_object fields hold strings
    expect(doc.attributes['http.response.status_code']).toBe('201');
  });

  it('omits promoted groups that have no values', () => {
    const doc = toLogDocument(record({ attributes: { 'order.id': 'ord_1' } }), '2026-10-05T10:00:01.000Z');
    expect(doc.http).toBeUndefined();
    expect(doc.durationMs).toBeUndefined();
    expect(doc.process).toBeUndefined();
  });

  it('promotes process and pool samples', () => {
    const doc = toLogDocument(
      record({ attributes: { 'process.memory.heap_used_mb': 412, 'db.pool.waiting': 15, 'exception.type': 'TypeError' } }),
      '2026-10-05T10:00:01.000Z',
    );
    expect(doc.process).toEqual({ heapUsedMb: 412 });
    expect(doc.dbPool).toEqual({ waiting: 15 });
    expect(doc.exceptionType).toBe('TypeError');
  });
});

describe('dailyIndex', () => {
  it('uses the event date', () => {
    expect(dailyIndex('2026-10-05T23:59:59.000Z')).toBe('logs-2026.10.05');
  });
});

describe('splitBatch', () => {
  it('keeps valid records and reports invalid ones by index', () => {
    const { valid, invalid } = splitBatch([record(), { body: 'broken' }, record()]);
    expect(valid).toHaveLength(2);
    expect(invalid).toHaveLength(1);
    expect(invalid[0]!.index).toBe(1);
  });
});

describe('parseMessages', () => {
  it('turns bad JSON and schema failures into dead letters', () => {
    const { pending, dead } = parseMessages(
      [JSON.stringify(record()), '{not json', JSON.stringify({ body: 'x' })],
      '2026-10-05T10:00:01.000Z',
    );
    expect(pending).toHaveLength(1);
    expect(dead.map((d) => d.reason.split(':')[0])).toEqual(['invalid JSON', 'schema']);
    expect(dead[0]!.payload).toBe('{not json');
  });
});
