import { opensearch } from '../clients/opensearch';
import { config } from '../config';

/** Metrics for one service in one 1-minute window, derived from its logs. */
export interface MinuteMetrics {
  windowStart: string;
  /** Request logs (records with a duration) in the window. */
  requests: number;
  /** Requests answered with a 5xx. */
  errors: number;
  errorRate: number | null;
  latencyP50: number | null;
  latencyP95: number | null;
  latencyP99: number | null;
  /** Highest heap sample from the process monitor in the window. */
  heapUsedMb: number | null;
}

export interface ServiceMetrics {
  service: string;
  windows: MinuteMetrics[];
}

interface Bucket {
  key_as_string: string;
  requests: {
    doc_count: number;
    errors: { doc_count: number };
    latency: { values: Record<string, number | null> };
  };
  heap: { value: number | null };
}

/**
 * One aggregation query returns every service's per-minute request count, 5xx count, latency
 * percentiles and peak heap. Request metrics come from the request log each service writes
 * per request; heap comes from the 15-second process samples.
 */
export async function getServiceMetrics(opts: { from: string; to: string; services?: string[] }): Promise<ServiceMetrics[]> {
  const filter: Record<string, unknown>[] = [{ range: { '@timestamp': { gte: opts.from, lt: opts.to } } }];
  if (opts.services?.length) filter.push({ terms: { service: opts.services } });

  const res = await opensearch.search({
    index: config.logIndexPattern,
    ignore_unavailable: true,
    allow_no_indices: true,
    body: {
      size: 0,
      query: { bool: { filter } },
      aggs: {
        services: {
          terms: { field: 'service', size: 100 },
          aggs: {
            minutes: {
              date_histogram: {
                field: '@timestamp',
                fixed_interval: '1m',
                min_doc_count: 0,
                extended_bounds: { min: opts.from, max: opts.to },
              },
              aggs: {
                requests: {
                  filter: { exists: { field: 'durationMs' } },
                  aggs: {
                    errors: { filter: { range: { 'http.statusCode': { gte: 500 } } } },
                    latency: { percentiles: { field: 'durationMs', percents: [50, 95, 99] } },
                  },
                },
                heap: { max: { field: 'process.heapUsedMb' } },
              },
            },
          },
        },
      },
    },
  } as never);

  const aggs = (res.body as { aggregations?: { services: { buckets: { key: string; minutes: { buckets: Bucket[] } }[] } } })
    .aggregations;
  if (!aggs) return [];

  const round = (v: number | null | undefined, digits = 1) =>
    v === null || v === undefined || Number.isNaN(v) ? null : Math.round(v * 10 ** digits) / 10 ** digits;

  // extended_bounds can add an empty bucket starting exactly at `to`, which is outside [from, to).
  // Date math such as "now" does not parse, and then every bucket is kept.
  const toMs = Date.parse(opts.to);
  const inRange = (b: Bucket) => Number.isNaN(toMs) || Date.parse(b.key_as_string) < toMs;

  return aggs.services.buckets.map((s) => ({
    service: s.key,
    windows: s.minutes.buckets
      .filter(inRange)
      .map((b) => {
        const requests = b.requests.doc_count;
        const errors = b.requests.errors.doc_count;
        const p = b.requests.latency.values;
        return {
          windowStart: new Date(b.key_as_string).toISOString(),
          requests,
          errors,
          errorRate: requests > 0 ? round(errors / requests, 4) : null,
          latencyP50: requests > 0 ? round(p['50.0']) : null,
          latencyP95: requests > 0 ? round(p['95.0']) : null,
          latencyP99: requests > 0 ? round(p['99.0']) : null,
          heapUsedMb: round(b.heap.value),
        };
      }),
  }));
}

export interface ServiceSummary {
  service: string;
  version: string | null;
  lastSeen: string;
  logsLast15m: number;
  requestsLast15m: number;
  errorRateLast15m: number | null;
}

/** Services that logged in the last 15 minutes, with their current version and error rate. */
export async function listServices(): Promise<ServiceSummary[]> {
  const res = await opensearch.search({
    index: config.logIndexPattern,
    ignore_unavailable: true,
    allow_no_indices: true,
    body: {
      size: 0,
      query: { range: { '@timestamp': { gte: 'now-15m' } } },
      aggs: {
        services: {
          terms: { field: 'service', size: 100 },
          aggs: {
            last_seen: { max: { field: '@timestamp' } },
            latest: { top_hits: { size: 1, sort: [{ '@timestamp': 'desc' }], _source: ['serviceVersion'] } },
            requests: {
              filter: { exists: { field: 'durationMs' } },
              aggs: { errors: { filter: { range: { 'http.statusCode': { gte: 500 } } } } },
            },
          },
        },
      },
    },
  } as never);

  type SBucket = {
    key: string;
    doc_count: number;
    last_seen: { value_as_string: string };
    latest: { hits: { hits: { _source: { serviceVersion?: string } }[] } };
    requests: { doc_count: number; errors: { doc_count: number } };
  };
  const buckets = (res.body as { aggregations?: { services: { buckets: SBucket[] } } }).aggregations?.services.buckets ?? [];
  return buckets.map((b) => ({
    service: b.key,
    version: b.latest.hits.hits[0]?._source.serviceVersion ?? null,
    lastSeen: b.last_seen.value_as_string,
    logsLast15m: b.doc_count,
    requestsLast15m: b.requests.doc_count,
    errorRateLast15m:
      b.requests.doc_count > 0 ? Math.round((b.requests.errors.doc_count / b.requests.doc_count) * 10_000) / 10_000 : null,
  }));
}

export interface PipelineStats {
  windowMinutes: number;
  logsIndexed: number;
  /** Event timestamp to indexed-in-OpenSearch, in ms. Searchable about 1 s after indexing (refresh). */
  lagMs: { p50: number | null; p95: number | null; p99: number | null; max: number | null };
}

export async function getPipelineStats(windowMinutes = 5): Promise<PipelineStats> {
  const lagScript = {
    source: "doc['indexedAt'].value.toInstant().toEpochMilli() - doc['@timestamp'].value.toInstant().toEpochMilli()",
    lang: 'painless',
  };
  const res = await opensearch.search({
    index: config.logIndexPattern,
    ignore_unavailable: true,
    allow_no_indices: true,
    body: {
      size: 0,
      track_total_hits: true,
      query: { range: { indexedAt: { gte: `now-${windowMinutes}m` } } },
      aggs: {
        lag: { percentiles: { script: lagScript, percents: [50, 95, 99] } },
        lag_max: { max: { script: lagScript } },
      },
    },
  } as never);
  const body = res.body as {
    hits: { total: { value: number } };
    aggregations?: { lag: { values: Record<string, number | null> }; lag_max: { value: number | null } };
  };
  const v = body.aggregations?.lag.values ?? {};
  const r = (x: number | null | undefined) => (x === null || x === undefined ? null : Math.round(x));
  return {
    windowMinutes,
    logsIndexed: body.hits.total.value,
    lagMs: { p50: r(v['50.0']), p95: r(v['95.0']), p99: r(v['99.0']), max: r(body.aggregations?.lag_max.value) },
  };
}
