import { db } from './clients/db';
import { createProducer, ensureTopics } from './clients/kafka';
import { ensureLogTemplate } from './clients/opensearch';
import { platformLogger } from './config';
import { startDetector } from './detection/detector';
import { startLogIndexer } from './worker/log-indexer';

/**
 * Worker process: consumes logs.raw into OpenSearch, and runs the anomaly detector that opens
 * and resolves incidents. Separate from the API so slow indexing never slows ingestion.
 */
async function main(): Promise<void> {
  const logger = platformLogger('platform-worker');
  await ensureTopics();
  await ensureLogTemplate();
  const producer = createProducer(); // for the dead-letter queue
  await producer.connect();

  const consumer = await startLogIndexer(producer, logger);
  const stopDetector = startDetector(logger);
  logger.info('worker started: log indexer and detector running');

  const shutdown = async () => {
    stopDetector();
    await consumer.disconnect().catch(() => undefined);
    await producer.disconnect().catch(() => undefined);
    await db.$disconnect();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

main().catch((err) => {
  process.stderr.write(`worker failed to start: ${(err as Error).stack}\n`);
  process.exit(1);
});
