import { logRecordSchema, sleep, type Logger } from '@ai-analyzer/shared';
import type { Consumer, Producer } from 'kafkajs';
import { z } from 'zod';
import { kafka, sendToDlq, type DeadLetter } from '../clients/kafka';
import { dailyIndex, opensearch } from '../clients/opensearch';
import { config } from '../config';
import { toLogDocument, type LogDocument } from '../logs/document';

const MAX_INDEX_ATTEMPTS = 3;

interface Pending {
  doc: LogDocument;
  raw: string;
}

export interface BulkOutcome {
  indexed: number;
  duplicates: number;
  failed: { raw: string; reason: string }[];
}

interface BulkItem {
  create?: { status: number; error?: { type: string; reason?: string } };
}

/**
 * Writes documents with `create` and `_id = eventId`. A second copy of the same event (Kafka
 * redelivery, producer retry, client resend) gets a 409 and is counted as a duplicate, so
 * processing the same event twice never creates a second document.
 *
 * Throws if OpenSearch is unreachable, so the consumer does not commit and Kafka redelivers.
 */
export async function bulkIndex(items: Pending[], attempt = 1): Promise<BulkOutcome> {
  const outcome: BulkOutcome = { indexed: 0, duplicates: 0, failed: [] };
  if (items.length === 0) return outcome;

  const body = items.flatMap(({ doc }) => [{ create: { _index: dailyIndex(doc['@timestamp']), _id: doc.eventId } }, doc]);
  const res = await opensearch.bulk({ body } as never);
  const results = (res.body as { items: BulkItem[] }).items;

  const retry: Pending[] = [];
  results.forEach((result, i) => {
    const item = items[i]!;
    const status = result.create?.status ?? 500;
    if (status === 201 || status === 200) outcome.indexed++;
    else if (status === 409) outcome.duplicates++;
    else if (status === 429 || status >= 500) retry.push(item);
    else {
      // 4xx other than 409 (e.g. mapping error): retrying will not help.
      const err = result.create?.error;
      outcome.failed.push({ raw: item.raw, reason: `index rejected (${status}): ${err?.type ?? ''} ${err?.reason ?? ''}`.trim() });
    }
  });

  if (retry.length > 0) {
    if (attempt >= MAX_INDEX_ATTEMPTS) {
      outcome.failed.push(...retry.map((r) => ({ raw: r.raw, reason: `index failed after ${attempt} attempts` })));
    } else {
      await sleep(200 * 2 ** attempt);
      const next = await bulkIndex(retry, attempt + 1);
      outcome.indexed += next.indexed;
      outcome.duplicates += next.duplicates;
      outcome.failed.push(...next.failed);
    }
  }
  return outcome;
}

/** Parses Kafka message values; anything that is not a valid record becomes a dead letter. */
export function parseMessages(values: string[], indexedAt: string): { pending: Pending[]; dead: DeadLetter[] } {
  const pending: Pending[] = [];
  const dead: DeadLetter[] = [];
  for (const raw of values) {
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      dead.push({ reason: 'invalid JSON', stage: 'index', payload: raw, failedAt: indexedAt });
      continue;
    }
    const parsed = logRecordSchema.safeParse(json);
    if (!parsed.success) {
      dead.push({ reason: `schema: ${z.prettifyError(parsed.error)}`, stage: 'index', payload: raw, failedAt: indexedAt });
      continue;
    }
    pending.push({ doc: toLogDocument(parsed.data, indexedAt), raw });
  }
  return { pending, dead };
}

export interface IndexerStats {
  indexed: number;
  duplicates: number;
  deadLettered: number;
  lagMs: number[];
}

export async function startLogIndexer(producer: Producer, logger: Logger): Promise<Consumer> {
  const consumer = kafka.consumer({
    groupId: 'log-indexer',
    maxBytesPerPartition: 2 * 1024 * 1024,
    maxWaitTimeInMs: 250,
  });
  await consumer.connect();
  await consumer.subscribe({ topic: config.topics.raw, fromBeginning: true });

  let stats: IndexerStats = { indexed: 0, duplicates: 0, deadLettered: 0, lagMs: [] };
  const report = setInterval(() => {
    const s = stats;
    stats = { indexed: 0, duplicates: 0, deadLettered: 0, lagMs: [] };
    if (s.indexed + s.duplicates + s.deadLettered === 0) return;
    const sorted = s.lagMs.sort((a, b) => a - b);
    const pct = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] ?? 0;
    logger.info(
      `indexed ${s.indexed}, duplicates ${s.duplicates}, dead-lettered ${s.deadLettered} in the last 30s; ` +
        `event-to-indexed lag p50 ${pct(0.5)}ms p95 ${pct(0.95)}ms`,
      {
        'indexer.indexed': s.indexed,
        'indexer.duplicates': s.duplicates,
        'indexer.dead_lettered': s.deadLettered,
        'indexer.lag_p50_ms': pct(0.5),
        'indexer.lag_p95_ms': pct(0.95),
      },
    );
  }, 30_000);
  report.unref();

  await consumer.run({
    eachBatchAutoResolve: false,
    eachBatch: async ({ batch, resolveOffset, heartbeat, commitOffsetsIfNecessary, isRunning, isStale }) => {
      if (!isRunning() || isStale() || batch.messages.length === 0) return;
      const indexedAt = new Date().toISOString();
      const { pending, dead } = parseMessages(
        batch.messages.map((m) => m.value?.toString() ?? ''),
        indexedAt,
      );

      const outcome = await bulkIndex(pending);
      const letters = [
        ...dead,
        ...outcome.failed.map<DeadLetter>((f) => ({ reason: f.reason, stage: 'index', payload: f.raw, failedAt: indexedAt })),
      ];
      await sendToDlq(producer, letters);

      // Only now is the batch safely stored or parked; commit it.
      resolveOffset(batch.lastOffset());
      await commitOffsetsIfNecessary();
      await heartbeat();

      stats.indexed += outcome.indexed;
      stats.duplicates += outcome.duplicates;
      stats.deadLettered += letters.length;
      const now = Date.now();
      for (const p of pending) stats.lagMs.push(now - new Date(p.doc['@timestamp']).getTime());
      if (letters.length > 0) {
        logger.warn(`sent ${letters.length} records to ${config.topics.dlq}: ${letters[0]!.reason.slice(0, 200)}`, {
          'dlq.count': letters.length,
        });
      }
    },
  });

  return consumer;
}
