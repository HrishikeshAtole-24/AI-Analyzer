import { Kafka, logLevel, Partitioners, type Producer } from 'kafkajs';
import { config } from '../config';

export const kafka = new Kafka({
  clientId: 'ai-analyzer-platform',
  brokers: config.kafkaBrokers,
  logLevel: logLevel.WARN,
  retry: { initialRetryTime: 200, retries: 8 },
});

/** Creates the topics if they are missing. Partitions are keyed by service name. */
export async function ensureTopics(): Promise<void> {
  const admin = kafka.admin();
  await admin.connect();
  try {
    const existing = new Set(await admin.listTopics());
    const wanted = [
      { topic: config.topics.raw, numPartitions: 6, replicationFactor: 1 },
      { topic: config.topics.dlq, numPartitions: 1, replicationFactor: 1 },
    ].filter((t) => !existing.has(t.topic));
    if (wanted.length > 0) await admin.createTopics({ topics: wanted, waitForLeaders: true });
  } finally {
    await admin.disconnect();
  }
}

/**
 * acks=all (set per send) means a 202 from the API only goes out once the batch is durable.
 *
 * The producer is deliberately NOT idempotent. Kafka's idempotent mode allows one request in
 * flight, which made the API's p99 latency the length of the queue behind it (909 ms at 5,000
 * events/s). Duplicates are already removed at storage (`_id = eventId`), and log order comes
 * from timestamps at search time, so several sends in flight lose nothing.
 */
export function createProducer(): Producer {
  return kafka.producer({
    idempotent: false,
    maxInFlightRequests: 5,
    createPartitioner: Partitioners.DefaultPartitioner,
  });
}

export interface DeadLetter {
  reason: string;
  stage: 'ingest' | 'index';
  /** The original message value, kept verbatim so it can be replayed. */
  payload: string;
  failedAt: string;
}

export async function sendToDlq(producer: Producer, letters: DeadLetter[]): Promise<void> {
  if (letters.length === 0) return;
  await producer.send({
    topic: config.topics.dlq,
    acks: -1,
    messages: letters.map((l) => ({
      value: JSON.stringify(l),
      headers: { reason: l.reason.slice(0, 200), stage: l.stage },
    })),
  });
}
