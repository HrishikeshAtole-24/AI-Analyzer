import { z } from 'zod';

/**
 * Log record format shared by every producer (demo services) and consumer (platform API, workers).
 * It follows the OpenTelemetry log data model, flattened to plain JSON:
 * https://opentelemetry.io/docs/specs/otel/logs/data-model/
 */

export const SEVERITIES = ['TRACE', 'DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL'] as const;
export type Severity = (typeof SEVERITIES)[number];

/** OTel SeverityNumber for the first value of each range. */
export const SEVERITY_NUMBER: Record<Severity, number> = {
  TRACE: 1,
  DEBUG: 5,
  INFO: 9,
  WARN: 13,
  ERROR: 17,
  FATAL: 21,
};

const attributeValue = z.union([z.string(), z.number(), z.boolean(), z.null()]);

export const resourceSchema = z
  .object({
    'service.name': z.string().min(1).max(100),
    'service.version': z.string().min(1).max(50),
    'deployment.environment': z.string().max(50).optional(),
    'host.name': z.string().max(255).optional(),
  })
  .catchall(attributeValue);

export const logRecordSchema = z.object({
  /** Producer-generated UUID; the platform uses it to drop duplicates. */
  eventId: z.uuid(),
  timestamp: z.iso.datetime({ offset: true }),
  observedTimestamp: z.iso.datetime({ offset: true }).optional(),
  severityText: z.enum(SEVERITIES),
  severityNumber: z.number().int().min(1).max(24),
  body: z.string().max(16_384),
  traceId: z
    .string()
    .regex(/^[0-9a-f]{32}$/)
    .optional(),
  spanId: z
    .string()
    .regex(/^[0-9a-f]{16}$/)
    .optional(),
  resource: resourceSchema,
  attributes: z.record(z.string(), attributeValue).default({}),
});

export const MAX_BATCH_SIZE = 1000;

export const logBatchSchema = z.object({
  logs: z.array(logRecordSchema).min(1).max(MAX_BATCH_SIZE),
});

export type LogRecord = z.infer<typeof logRecordSchema>;
export type LogBatch = z.infer<typeof logBatchSchema>;
export type LogAttributes = Record<string, string | number | boolean | null>;
