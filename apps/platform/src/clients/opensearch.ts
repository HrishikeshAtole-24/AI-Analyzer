import { Client } from '@opensearch-project/opensearch';
import { config } from '../config';

export const opensearch = new Client({ node: config.opensearchUrl, requestTimeout: 10_000 });

/**
 * Index template for the daily log indices. Fields the platform filters or aggregates on are
 * promoted to typed top-level fields; everything else stays searchable in `attributes`, a
 * flat_object field, so arbitrary attribute keys can never cause a mapping conflict.
 */
const LOG_TEMPLATE = {
  index_patterns: [config.logIndexPattern],
  template: {
    settings: { number_of_shards: 1, number_of_replicas: 0, refresh_interval: '1s' },
    mappings: {
      dynamic: 'strict',
      properties: {
        eventId: { type: 'keyword' },
        '@timestamp': { type: 'date' },
        observedTimestamp: { type: 'date' },
        indexedAt: { type: 'date' },
        severityText: { type: 'keyword' },
        severityNumber: { type: 'short' },
        body: { type: 'text', fields: { raw: { type: 'keyword', ignore_above: 512 } } },
        traceId: { type: 'keyword' },
        spanId: { type: 'keyword' },
        service: { type: 'keyword' },
        serviceVersion: { type: 'keyword' },
        environment: { type: 'keyword' },
        host: { type: 'keyword' },
        http: {
          properties: {
            method: { type: 'keyword' },
            route: { type: 'keyword' },
            statusCode: { type: 'short' },
          },
        },
        durationMs: { type: 'float' },
        process: {
          properties: {
            heapUsedMb: { type: 'float' },
            eventLoopDelayP99Ms: { type: 'float' },
          },
        },
        dbPool: {
          properties: {
            active: { type: 'short' },
            waiting: { type: 'short' },
          },
        },
        exceptionType: { type: 'keyword' },
        resource: { type: 'flat_object' },
        attributes: { type: 'flat_object' },
      },
    },
  },
};

export async function ensureLogTemplate(): Promise<void> {
  await opensearch.indices.putIndexTemplate({ name: 'logs', body: LOG_TEMPLATE as never });
}

export function dailyIndex(timestamp: string): string {
  // logs-YYYY.MM.DD from the event's own time, so late events land in the right day.
  return `${config.logIndexPrefix}${timestamp.slice(0, 10).replace(/-/g, '.')}`;
}
