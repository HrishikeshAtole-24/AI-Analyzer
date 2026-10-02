import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { HttpLogExporter } from '../src/log-exporter';
import type { LogRecord } from '../src/log-schema';

const record = (body: string) => ({ body }) as unknown as LogRecord;

let server: Server | undefined;
afterEach(() => server?.close());

function sink(status: number): Promise<{ url: string; batches: unknown[][] }> {
  const batches: unknown[][] = [];
  server = createServer((req, res) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => {
      batches.push((JSON.parse(data) as { logs: unknown[] }).logs);
      res.writeHead(status).end();
    });
  });
  return new Promise((resolve) =>
    server!.listen(0, () => {
      const { port } = server!.address() as AddressInfo;
      resolve({ url: `http://127.0.0.1:${port}/api/v1/logs`, batches });
    }),
  );
}

describe('HttpLogExporter', () => {
  it('sends buffered records in batches', async () => {
    const { url, batches } = await sink(202);
    const exporter = new HttpLogExporter({ url, maxBatchSize: 2, flushIntervalMs: 10_000 });
    ['a', 'b', 'c'].forEach((b) => exporter.export(record(b)));
    await exporter.shutdown();
    expect(batches.flat()).toHaveLength(3);
    expect(batches[0]).toHaveLength(2);
  });

  it('keeps records when the platform fails, and drops the oldest past the buffer cap', async () => {
    const { url } = await sink(500);
    const exporter = new HttpLogExporter({ url, maxBatchSize: 10, maxBufferSize: 3, flushIntervalMs: 10_000 });
    const stderr = process.stderr.write;
    process.stderr.write = () => true;
    try {
      ['a', 'b', 'c', 'd', 'e'].forEach((b) => exporter.export(record(b)));
      await exporter.flush();
    } finally {
      process.stderr.write = stderr;
    }
    expect(exporter.droppedCount).toBe(2);
    await exporter.shutdown();
  });
});
