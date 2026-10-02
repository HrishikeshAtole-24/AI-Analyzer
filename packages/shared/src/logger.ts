import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { trace } from '@opentelemetry/api';
import { HttpLogExporter } from './log-exporter';
import { SEVERITY_NUMBER, type LogAttributes, type LogRecord, type Severity } from './log-schema';

export interface ServiceIdentity {
  name: string;
  version: string;
  environment?: string;
}

export interface LoggerOptions {
  service: ServiceIdentity;
  /** Lowest severity that is emitted. */
  level?: Severity;
  /** 'json' prints one OTel record per line; 'pretty' prints a short readable line. */
  format?: 'json' | 'pretty';
  /** Platform ingestion endpoint. When unset, logs only go to stdout. */
  ingestUrl?: string;
  apiKey?: string;
}

export interface Logger {
  trace(body: string, attributes?: LogAttributes): void;
  debug(body: string, attributes?: LogAttributes): void;
  info(body: string, attributes?: LogAttributes): void;
  warn(body: string, attributes?: LogAttributes): void;
  error(body: string, attributes?: LogAttributes): void;
  fatal(body: string, attributes?: LogAttributes): void;
  /** Version can change at runtime (the bad_deploy fault). */
  setServiceVersion(version: string): void;
  flush(): Promise<void>;
}

const COLORS: Record<Severity, string> = {
  TRACE: '\x1b[90m',
  DEBUG: '\x1b[90m',
  INFO: '\x1b[32m',
  WARN: '\x1b[33m',
  ERROR: '\x1b[31m',
  FATAL: '\x1b[35m',
};

/**
 * Structured logger that emits OpenTelemetry log records. The active span's trace and span IDs
 * are attached automatically, which is what lets the platform rebuild a request across services.
 */
export function createLogger(options: LoggerOptions): Logger {
  const minLevel = SEVERITY_NUMBER[options.level ?? 'INFO'];
  const format = options.format ?? 'pretty';
  const host = hostname();
  let version = options.service.version;
  const exporter = options.ingestUrl
    ? new HttpLogExporter({ url: options.ingestUrl, apiKey: options.apiKey })
    : null;

  function emit(severity: Severity, body: string, attributes: LogAttributes = {}): void {
    const severityNumber = SEVERITY_NUMBER[severity];
    if (severityNumber < minLevel) return;

    const spanContext = trace.getActiveSpan()?.spanContext();
    const now = new Date().toISOString();
    const record: LogRecord = {
      eventId: randomUUID(),
      timestamp: now,
      observedTimestamp: now,
      severityText: severity,
      severityNumber,
      body,
      ...(spanContext ? { traceId: spanContext.traceId, spanId: spanContext.spanId } : {}),
      resource: {
        'service.name': options.service.name,
        'service.version': version,
        'deployment.environment': options.service.environment ?? 'local',
        'host.name': host,
      },
      attributes,
    };

    if (format === 'json') {
      process.stdout.write(JSON.stringify(record) + '\n');
    } else {
      const attrs = Object.entries(attributes)
        .map(([k, v]) => `${k}=${v}`)
        .join(' ');
      const traceSuffix = record.traceId ? ` \x1b[90mtrace=${record.traceId.slice(0, 8)}\x1b[0m` : '';
      process.stdout.write(
        `${now.slice(11, 23)} ${COLORS[severity]}${severity.padEnd(5)}\x1b[0m ` +
          `[${options.service.name}@${version}] ${body}${attrs ? ' ' + attrs : ''}${traceSuffix}\n`,
      );
    }
    exporter?.export(record);
  }

  return {
    trace: (b, a) => emit('TRACE', b, a),
    debug: (b, a) => emit('DEBUG', b, a),
    info: (b, a) => emit('INFO', b, a),
    warn: (b, a) => emit('WARN', b, a),
    error: (b, a) => emit('ERROR', b, a),
    fatal: (b, a) => emit('FATAL', b, a),
    setServiceVersion: (v) => {
      version = v;
    },
    flush: async () => {
      await exporter?.shutdown();
    },
  };
}
