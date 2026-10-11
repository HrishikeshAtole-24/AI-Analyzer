import { HttpError, logRecordSchema, MAX_BATCH_SIZE, type Logger, type LogRecord } from '@ai-analyzer/shared';
import { Router } from 'express';
import type { Producer } from 'kafkajs';
import { z } from 'zod';
import { BatchingPublisher } from '../clients/batching-publisher';
import { sendToDlq, type DeadLetter } from '../clients/kafka';
import { config } from '../config';

const envelope = z.object({ logs: z.array(z.unknown()).min(1).max(MAX_BATCH_SIZE) });

export interface SplitResult {
  valid: LogRecord[];
  invalid: { index: number; issues: string; payload: unknown }[];
}

/** Validates each record on its own, so one bad record does not reject a whole batch. */
export function splitBatch(records: unknown[]): SplitResult {
  const result: SplitResult = { valid: [], invalid: [] };
  records.forEach((record, index) => {
    const parsed = logRecordSchema.safeParse(record);
    if (parsed.success) result.valid.push(parsed.data);
    else result.invalid.push({ index, issues: z.prettifyError(parsed.error), payload: record });
  });
  return result;
}

/**
 * POST /api/v1/logs. The API only validates and hands records to Kafka, so ingestion stays fast
 * even when indexing or analysis is slow. Invalid records are parked in the DLQ, not dropped.
 */
export function ingestRouter(producer: Producer, logger: Logger): Router {
  const router = Router();
  const publisher = new BatchingPublisher(producer, config.topics.raw);

  router.post('/api/v1/logs', async (req, res) => {
    const body = envelope.safeParse(req.body);
    if (!body.success) {
      throw new HttpError(400, 'invalid_request', `body must be { logs: [1..${MAX_BATCH_SIZE} records] }`, z.flattenError(body.error));
    }
    const { valid, invalid } = splitBatch(body.data.logs);

    try {
      if (valid.length > 0) {
        // Keyed by service: one service's logs stay ordered within a partition.
        await publisher.publish(valid.map((r) => ({ key: r.resource['service.name'], value: JSON.stringify(r) })));
      }
      const failedAt = new Date().toISOString();
      await sendToDlq(
        producer,
        invalid.map<DeadLetter>((i) => ({
          reason: `validation failed: ${i.issues}`,
          stage: 'ingest',
          payload: JSON.stringify(i.payload),
          failedAt,
        })),
      );
    } catch (err) {
      logger.error(`kafka publish failed: ${(err as Error).message}`, { 'batch.size': body.data.logs.length });
      throw new HttpError(503, 'ingest_unavailable', 'log pipeline unavailable, retry later');
    }

    if (invalid.length > 0) {
      logger.warn(`rejected ${invalid.length}/${body.data.logs.length} log records (sent to DLQ)`, {
        'batch.rejected': invalid.length,
      });
    }
    const response = {
      accepted: valid.length,
      rejected: invalid.length,
      ...(invalid.length ? { errors: invalid.slice(0, 10).map(({ index, issues }) => ({ index, issues })) } : {}),
    };
    res.status(valid.length > 0 ? 202 : 400).json(response);
  });

  return router;
}
