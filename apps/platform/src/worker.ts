import { db } from './clients/db';
import { createProducer, ensureTopics } from './clients/kafka';
import { ensureLogTemplate } from './clients/opensearch';
import { platformLogger } from './config';
import { withStartupRetry } from './startup';
import { startDetector } from './detection/detector';
import { startInvestigator } from './investigation/investigator';
import { syncRunbooks } from './knowledge/knowledge';
import { hasLlmCredentials, LLM_MODEL } from './investigation/llm-agent';
import { startLogIndexer } from './worker/log-indexer';

/**
 * Worker process: consumes logs.raw into OpenSearch, runs the anomaly detector that opens and
 * resolves incidents, and investigates new incidents (LLM, or the rule-based playbook). Separate from the API so slow indexing never slows ingestion.
 */
async function main(): Promise<void> {
  const logger = platformLogger('platform-worker');
  await withStartupRetry('kafka topics', logger, ensureTopics);
  await withStartupRetry('opensearch index template', logger, ensureLogTemplate);
  const producer = createProducer(); // for the dead-letter queue
  await withStartupRetry('kafka producer', logger, () => producer.connect());

  await syncRunbooks(logger).catch((err: Error) => logger.warn(`runbook sync failed: ${err.message}`));
  const consumer = await withStartupRetry('kafka consumer', logger, () => startLogIndexer(producer, logger));
  const stopDetector = startDetector(logger);
  const stopInvestigator = startInvestigator(logger);
  logger.info(
    `worker started: log indexer, detector and investigator running (${hasLlmCredentials() ? `LLM ${LLM_MODEL}` : 'no LLM key: rule-based investigations only'})`,
  );

  const shutdown = async () => {
    stopDetector();
    stopInvestigator();
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
