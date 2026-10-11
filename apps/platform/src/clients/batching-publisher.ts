import type { Message, Producer } from 'kafkajs';

interface Pending {
  messages: Message[];
  resolve: () => void;
  reject: (err: Error) => void;
}

/**
 * Combines the messages of concurrent requests into shared producer sends (Kafka's "linger").
 *
 * One `send` per HTTP request costs a broker round trip each, and requests queue behind each
 * other. Here up to `concurrency` sends are in flight; while they are, new requests join the
 * queue and the next send carries all of them. Each caller's promise resolves only when the send
 * containing its messages is acknowledged (acks=all), so the API's 202 still means "durable on Kafka".
 */
export class BatchingPublisher {
  private queue: Pending[] = [];
  private inFlight = 0;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly producer: Pick<Producer, 'send'>,
    private readonly topic: string,
    private readonly options: { maxMessages?: number; lingerMs?: number; concurrency?: number } = {},
  ) {}

  publish(messages: Message[]): Promise<void> {
    if (messages.length === 0) return Promise.resolve();
    return new Promise((resolve, reject) => {
      this.queue.push({ messages, resolve, reject });
      this.schedule();
    });
  }

  private get concurrency(): number {
    return this.options.concurrency ?? 4;
  }

  private schedule(): void {
    if (this.inFlight >= this.concurrency || this.timer) return;
    // A short linger when idle lets requests arriving together share the first send.
    this.timer = setTimeout(() => {
      this.timer = null;
      this.drain();
    }, this.options.lingerMs ?? 2);
  }

  /** Starts sends until the queue is empty or `concurrency` sends are in flight. */
  private drain(): void {
    // Redpanda rejects record batches over about 1 MB; ~2,000 log records stay well under it.
    const max = this.options.maxMessages ?? 2_000;
    while (this.queue.length > 0 && this.inFlight < this.concurrency) {
      const batch: Pending[] = [];
      let count = 0;
      while (this.queue.length > 0 && (count === 0 || count + this.queue[0]!.messages.length <= max)) {
        const next = this.queue.shift()!;
        batch.push(next);
        count += next.messages.length;
      }
      this.inFlight++;
      this.producer
        .send({ topic: this.topic, acks: -1, messages: batch.flatMap((b) => b.messages) })
        .then(
          () => batch.forEach((b) => b.resolve()),
          (err: Error) => batch.forEach((b) => b.reject(err)),
        )
        .finally(() => {
          this.inFlight--;
          this.drain();
        });
    }
  }
}
