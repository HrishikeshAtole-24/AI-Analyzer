import { errorHandler, requestLogger } from '@ai-analyzer/shared';
import express from 'express';
import { db } from './clients/db';
import { createProducer, ensureTopics } from './clients/kafka';
import { ensureLogTemplate, opensearch } from './clients/opensearch';
import { config, platformLogger } from './config';
import { deployRouter } from './deploys/routes';
import { incidentRouter } from './incidents/routes';
import { ingestRouter } from './logs/ingest';
import { logRouter } from './logs/routes';
import { metricsRouter } from './metrics/routes';

/**
 * Platform API: log ingestion, log search, trace view, metrics, deploys and incidents.
 * Heavy work (indexing, detection) runs in the worker process (worker.ts).
 */
async function main(): Promise<void> {
  const logger = platformLogger('platform-api');
  await ensureTopics();
  await ensureLogTemplate();
  const producer = createProducer();
  await producer.connect();

  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '20mb' }));
  // Successful ingest calls arrive several times a second; only log the interesting ones.
  app.use(requestLogger(logger, { skip: (req, res) => req.path === '/api/v1/logs' && req.method === 'POST' && res.statusCode === 202 }));

  app.get('/health', async (_req, res) => {
    const checks = await Promise.allSettled([opensearch.ping(), db.$queryRaw`SELECT 1`]);
    const [os, pg] = checks.map((c) => (c.status === 'fulfilled' ? 'ok' : 'down'));
    const ok = os === 'ok' && pg === 'ok';
    res.status(ok ? 200 : 503).json({ status: ok ? 'ok' : 'degraded', opensearch: os, postgres: pg, kafka: 'connected' });
  });

  app.use(ingestRouter(producer, logger));
  app.use(logRouter());
  app.use(metricsRouter());
  app.use(deployRouter(logger));
  app.use(incidentRouter());

  app.use((req, res) => {
    res.status(404).json({ error: { code: 'not_found', message: `no route for ${req.method} ${req.path}` } });
  });
  app.use(errorHandler(logger));

  const server = app.listen(config.port, () => {
    logger.info(`platform API listening on port ${config.port}`, { 'server.port': config.port });
  });

  const shutdown = async () => {
    server.close();
    await producer.disconnect().catch(() => undefined);
    await db.$disconnect();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

main().catch((err) => {
  process.stderr.write(`platform API failed to start: ${(err as Error).stack}\n`);
  process.exit(1);
});
