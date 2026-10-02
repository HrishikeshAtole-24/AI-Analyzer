import type { LogRecord } from '@ai-analyzer/shared';

/** How a log record is stored in OpenSearch. See the index template in clients/opensearch.ts. */
export interface LogDocument {
  eventId: string;
  '@timestamp': string;
  observedTimestamp?: string;
  indexedAt: string;
  severityText: string;
  severityNumber: number;
  body: string;
  traceId?: string;
  spanId?: string;
  service: string;
  serviceVersion: string;
  environment?: string;
  host?: string;
  http?: { method?: string; route?: string; statusCode?: number };
  durationMs?: number;
  process?: { heapUsedMb?: number; eventLoopDelayP99Ms?: number };
  dbPool?: { active?: number; waiting?: number };
  exceptionType?: string;
  resource: Record<string, string>;
  attributes: Record<string, string>;
}

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

/** flat_object fields index every value as a string. */
function stringify(map: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(map)) {
    if (v !== null && v !== undefined) out[k] = String(v);
  }
  return out;
}

function compact<T extends object>(obj: T): T | undefined {
  const entries = Object.entries(obj).filter(([, v]) => v !== undefined);
  return entries.length ? (Object.fromEntries(entries) as T) : undefined;
}

/**
 * Maps a validated log record to its stored document, promoting the attributes the platform
 * filters and aggregates on (HTTP status, route, duration, heap, pool) to typed fields.
 */
export function toLogDocument(record: LogRecord, indexedAt: string): LogDocument {
  const a = record.attributes;
  const r = record.resource;
  const doc: LogDocument = {
    eventId: record.eventId,
    '@timestamp': record.timestamp,
    observedTimestamp: record.observedTimestamp,
    indexedAt,
    severityText: record.severityText,
    severityNumber: record.severityNumber,
    body: record.body,
    traceId: record.traceId,
    spanId: record.spanId,
    service: r['service.name'],
    serviceVersion: r['service.version'],
    environment: str(r['deployment.environment']),
    host: str(r['host.name']),
    http: compact({
      method: str(a['http.request.method']),
      route: str(a['http.route']),
      statusCode: num(a['http.response.status_code']),
    }),
    durationMs: num(a['duration_ms']),
    process: compact({
      heapUsedMb: num(a['process.memory.heap_used_mb']),
      eventLoopDelayP99Ms: num(a['nodejs.eventloop.delay_p99_ms']),
    }),
    dbPool: compact({ active: num(a['db.pool.active']), waiting: num(a['db.pool.waiting']) }),
    exceptionType: str(a['exception.type']),
    resource: stringify(r),
    attributes: stringify(a),
  };
  // Drop undefined keys: the index mapping is strict and OpenSearch rejects explicit nulls in objects poorly.
  return JSON.parse(JSON.stringify(doc)) as LogDocument;
}
