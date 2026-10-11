import { sleep, type Logger } from '@ai-analyzer/shared';

/**
 * Retries a startup step (connecting to Kafka, creating topics, the index template) with
 * backoff. Containers report healthy a little before they accept clients, and after a Docker
 * restart the platform would otherwise exit and stay down.
 */
export async function withStartupRetry<T>(label: string, logger: Logger, fn: () => Promise<T>, maxWaitMs = 180_000): Promise<T> {
  const deadline = Date.now() + maxWaitMs;
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (Date.now() >= deadline) throw err;
      const delay = Math.min(1_000 * 2 ** (attempt - 1), 15_000);
      logger.warn(`${label} failed (attempt ${attempt}): ${(err as Error).message}; retrying in ${delay / 1000}s`);
      await sleep(delay);
    }
  }
}
