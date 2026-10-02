import { SEVERITIES, type Severity } from './log-schema';
import type { LoggerOptions, ServiceIdentity } from './logger';

export function env(name: string, fallback: string): string {
  const value = process.env[name];
  return value === undefined || value === '' ? fallback : value;
}

export function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number.parseInt(raw, 10);
  if (Number.isNaN(value)) throw new Error(`env ${name} must be an integer, got "${raw}"`);
  return value;
}

/** Logger settings shared by all services, read from LOG_* environment variables. */
export function loggerOptionsFromEnv(service: ServiceIdentity): LoggerOptions {
  const level = env('LOG_LEVEL', 'info').toUpperCase();
  return {
    service,
    level: (SEVERITIES as readonly string[]).includes(level) ? (level as Severity) : 'INFO',
    format: env('LOG_FORMAT', 'pretty') === 'json' ? 'json' : 'pretty',
    ingestUrl: process.env.LOG_INGEST_URL || undefined,
    apiKey: process.env.LOG_INGEST_API_KEY || undefined,
  };
}
