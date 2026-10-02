import { HttpError, SEVERITIES, SEVERITY_NUMBER } from '@ai-analyzer/shared';
import { z } from 'zod';
import { opensearch } from '../clients/opensearch';
import { config } from '../config';
import type { LogDocument } from './document';

/** Accepts ISO timestamps or OpenSearch date math such as `now-15m`. */
const timeExpr = z
  .string()
  .regex(/^(now([+-]\d+[smhd])?|\d{4}-\d{2}-\d{2}T[\d:.]+(Z|[+-]\d{2}:\d{2}))$/, 'use ISO 8601 or now-15m style');

export const logQuerySchema = z.object({
  service: z.string().optional(),
  level: z
    .string()
    .transform((s) => s.toUpperCase())
    .pipe(z.enum(SEVERITIES))
    .optional(),
  from: timeExpr.default('now-15m'),
  to: timeExpr.default('now'),
  traceId: z.string().regex(/^[0-9a-f]{32}$/).optional(),
  q: z.string().max(500).optional(),
  /** Attribute filters, `key:value`. Repeat the parameter for several. */
  attr: z.union([z.string(), z.array(z.string())]).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  cursor: z.string().optional(),
});
export type LogQuery = z.infer<typeof logQuerySchema>;

export interface LogPage {
  logs: LogDocument[];
  total: number;
  nextCursor: string | null;
}

type Clause = Record<string, unknown>;

export function buildLogFilters(query: LogQuery): Clause[] {
  const filters: Clause[] = [{ range: { '@timestamp': { gte: query.from, lte: query.to } } }];
  if (query.service) {
    filters.push({ terms: { service: query.service.split(',').map((s) => s.trim()).filter(Boolean) } });
  }
  if (query.level) filters.push({ range: { severityNumber: { gte: SEVERITY_NUMBER[query.level] } } });
  if (query.traceId) filters.push({ term: { traceId: query.traceId } });
  if (query.q) {
    filters.push({ simple_query_string: { query: query.q, fields: ['body'], default_operator: 'and' } });
  }
  const attrs = query.attr === undefined ? [] : Array.isArray(query.attr) ? query.attr : [query.attr];
  for (const pair of attrs) {
    const idx = pair.indexOf(':');
    if (idx <= 0) throw new HttpError(400, 'invalid_request', `attr must be key:value, got "${pair}"`);
    filters.push({ term: { [`attributes.${pair.slice(0, idx)}`]: pair.slice(idx + 1) } });
  }
  return filters;
}

function encodeCursor(sort: unknown[]): string {
  return Buffer.from(JSON.stringify(sort)).toString('base64url');
}

function decodeCursor(cursor: string): unknown[] {
  try {
    const value = JSON.parse(Buffer.from(cursor, 'base64url').toString()) as unknown;
    if (Array.isArray(value)) return value;
  } catch {
    // fall through
  }
  throw new HttpError(400, 'invalid_request', 'invalid cursor');
}

interface SearchHit {
  _source: LogDocument;
  sort?: unknown[];
}

/** Newest first, paged with search_after so deep pages stay cheap. */
export async function searchLogs(query: LogQuery): Promise<LogPage> {
  const res = await opensearch.search({
    index: config.logIndexPattern,
    ignore_unavailable: true,
    allow_no_indices: true,
    body: {
      size: query.limit,
      track_total_hits: 10_000,
      query: { bool: { filter: buildLogFilters(query) } },
      sort: [{ '@timestamp': 'desc' }, { eventId: 'asc' }],
      ...(query.cursor ? { search_after: decodeCursor(query.cursor) } : {}),
    },
  } as never);
  const hits = (res.body as { hits: { hits: SearchHit[]; total: { value: number } } }).hits;
  const last = hits.hits.at(-1);
  return {
    logs: hits.hits.map((h) => h._source),
    total: hits.total.value,
    nextCursor: hits.hits.length === query.limit && last?.sort ? encodeCursor(last.sort) : null,
  };
}

export interface TraceView {
  traceId: string;
  services: string[];
  startedAt: string | null;
  endedAt: string | null;
  durationMs: number | null;
  errorCount: number;
  logCount: number;
  logs: LogDocument[];
}

/** Every log line of one request across all services, oldest first. */
export async function getTrace(traceId: string): Promise<TraceView> {
  const res = await opensearch.search({
    index: config.logIndexPattern,
    ignore_unavailable: true,
    allow_no_indices: true,
    body: {
      size: 1000,
      query: { term: { traceId } },
      sort: [{ '@timestamp': 'asc' }, { eventId: 'asc' }],
    },
  } as never);
  const logs = (res.body as { hits: { hits: SearchHit[] } }).hits.hits.map((h) => h._source);
  const first = logs[0]?.['@timestamp'] ?? null;
  const last = logs.at(-1)?.['@timestamp'] ?? null;
  return {
    traceId,
    services: [...new Set(logs.map((l) => l.service))],
    startedAt: first,
    endedAt: last,
    durationMs: first && last ? new Date(last).getTime() - new Date(first).getTime() : null,
    errorCount: logs.filter((l) => l.severityNumber >= SEVERITY_NUMBER.ERROR).length,
    logCount: logs.length,
    logs,
  };
}
