import type { LogRecord } from './log-schema';

export interface HttpLogExporterOptions {
  url: string;
  apiKey?: string;
  /** Send as soon as this many records are buffered. */
  maxBatchSize?: number;
  /** Send whatever is buffered at least this often. */
  flushIntervalMs?: number;
  /** Drop the oldest records once the buffer holds this many (platform down). */
  maxBufferSize?: number;
  requestTimeoutMs?: number;
}

/**
 * Buffers log records and POSTs them in batches to the platform ingestion API.
 * Never throws into the caller: a service must keep working when its log sink is down.
 */
export class HttpLogExporter {
  private buffer: LogRecord[] = [];
  private readonly timer: NodeJS.Timeout;
  private inFlight: Promise<void> | null = null;
  private dropped = 0;
  private lastErrorAt = 0;

  private readonly maxBatchSize: number;
  private readonly maxBufferSize: number;
  private readonly requestTimeoutMs: number;

  constructor(private readonly options: HttpLogExporterOptions) {
    this.maxBatchSize = options.maxBatchSize ?? 200;
    this.maxBufferSize = options.maxBufferSize ?? 10_000;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 3_000;
    this.timer = setInterval(() => void this.flush(), options.flushIntervalMs ?? 1_000);
    this.timer.unref();
  }

  export(record: LogRecord): void {
    this.buffer.push(record);
    if (this.buffer.length > this.maxBufferSize) {
      const overflow = this.buffer.length - this.maxBufferSize;
      this.buffer.splice(0, overflow);
      this.dropped += overflow;
    }
    if (this.buffer.length >= this.maxBatchSize) void this.flush();
  }

  get droppedCount(): number {
    return this.dropped;
  }

  /** Sends one batch at a time so a slow platform does not cause unbounded concurrent requests. */
  async flush(): Promise<void> {
    if (this.inFlight || this.buffer.length === 0) return this.inFlight ?? undefined;
    const batch = this.buffer.splice(0, this.maxBatchSize);
    this.inFlight = this.send(batch).finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  async shutdown(): Promise<void> {
    clearInterval(this.timer);
    if (this.inFlight) await this.inFlight;
    while (this.buffer.length > 0) {
      const before = this.buffer.length;
      await this.flush();
      // Stop if the platform is unreachable instead of looping forever on exit.
      if (this.buffer.length >= before) break;
    }
  }

  private async send(batch: LogRecord[]): Promise<void> {
    try {
      const res = await fetch(this.options.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(this.options.apiKey ? { 'x-api-key': this.options.apiKey } : {}),
        },
        body: JSON.stringify({ logs: batch }),
        signal: AbortSignal.timeout(this.requestTimeoutMs),
      });
      if (!res.ok) throw new Error(`ingest responded ${res.status}`);
    } catch (err) {
      // Put the batch back at the front so it is retried on the next flush.
      this.buffer.unshift(...batch);
      if (this.buffer.length > this.maxBufferSize) {
        const overflow = this.buffer.length - this.maxBufferSize;
        this.buffer.splice(0, overflow);
        this.dropped += overflow;
      }
      // Report at most once a minute; logging through the logger here would loop.
      if (Date.now() - this.lastErrorAt > 60_000) {
        this.lastErrorAt = Date.now();
        process.stderr.write(
          `[log-exporter] cannot reach ${this.options.url}: ${(err as Error).message}; buffering\n`,
        );
      }
    }
  }
}
