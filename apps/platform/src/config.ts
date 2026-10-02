import { createLogger, env, envInt } from '@ai-analyzer/shared';

export const config = {
  port: envInt('PLATFORM_PORT', 4000),
  kafkaBrokers: env('KAFKA_BROKERS', 'localhost:19092').split(','),
  opensearchUrl: env('OPENSEARCH_URL', 'http://localhost:9200'),
  topics: {
    raw: env('KAFKA_TOPIC_LOGS', 'logs.raw'),
    dlq: env('KAFKA_TOPIC_DLQ', 'logs.dlq'),
  },
  /** Daily indices: logs-2026.10.03. The alias pattern below covers them all. */
  logIndexPrefix: 'logs-',
  logIndexPattern: 'logs-*',
  detectIntervalMs: envInt('DETECT_INTERVAL_MS', 15_000),
};

/**
 * The platform logs to stdout only. Sending its own logs through its own ingestion path
 * would create a feedback loop (every ingested batch produces more logs to ingest).
 */
export function platformLogger(component: 'platform-api' | 'platform-worker') {
  return createLogger({
    service: { name: component, version: '0.2.0', environment: env('DEPLOY_ENV', 'local') },
    level: env('LOG_LEVEL', 'info').toUpperCase() === 'DEBUG' ? 'DEBUG' : 'INFO',
    format: env('LOG_FORMAT', 'pretty') === 'json' ? 'json' : 'pretty',
  });
}
