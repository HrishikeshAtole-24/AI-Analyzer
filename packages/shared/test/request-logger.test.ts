import http, { type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { afterEach, describe, expect, it } from 'vitest';
import { requestLogger } from '../src/http';
import type { LogAttributes, Logger } from '../src/index';

interface Line {
  level: string;
  body: string;
  attributes?: LogAttributes;
}

function captureLogger(lines: Line[]): Logger {
  const push = (level: string) => (body: string, attributes?: LogAttributes) => lines.push({ level, body, attributes });
  return {
    trace: push('TRACE'),
    debug: push('DEBUG'),
    info: push('INFO'),
    warn: push('WARN'),
    error: push('ERROR'),
    fatal: push('FATAL'),
    setServiceVersion: () => undefined,
    flush: async () => undefined,
  };
}

let server: Server | undefined;
afterEach(() => server?.close());

async function start(lines: Line[]): Promise<string> {
  const app = express();
  app.use(requestLogger(captureLogger(lines)));
  app.get('/fast', (_req, res) => {
    res.status(201).json({ ok: true });
  });
  app.get('/slow', async (_req, res) => {
    // Long enough that the client has certainly gone before the handler answers.
    await new Promise((r) => setTimeout(r, 1500));
    if (!res.destroyed) res.json({ ok: true });
  });
  return new Promise((resolve) => {
    server = app.listen(0, () => resolve(`http://127.0.0.1:${(server!.address() as AddressInfo).port}`));
  });
}

const waitFor = async (check: () => boolean) => {
  // Generous: under the full parallel suite the server can notice the abort late.
  for (let i = 0; i < 200 && !check(); i++) await new Promise((r) => setTimeout(r, 20));
};

describe('requestLogger', () => {
  it('logs a completed request with route, status and duration', async () => {
    const lines: Line[] = [];
    const base = await start(lines);
    await fetch(`${base}/fast`);
    await waitFor(() => lines.length > 0);
    expect(lines[0]).toMatchObject({ level: 'INFO', attributes: { 'http.route': '/fast', 'http.response.status_code': 201 } });
  });

  it('logs a request the client abandoned as 499', async () => {
    const lines: Line[] = [];
    const base = await start(lines);
    // A raw request whose socket is destroyed after 50 ms: deterministic, unlike a fetch abort,
    // where the client library decides when the connection actually closes.
    await new Promise<void>((resolve) => {
      const req = http.get(`${base}/slow`);
      req.on('error', () => resolve());
      setTimeout(() => {
        req.destroy();
        resolve();
      }, 50);
    });
    await waitFor(() => lines.length > 0);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      level: 'WARN',
      attributes: { 'http.response.status_code': 499, 'http.client_aborted': true },
    });
    expect(lines[0]!.body).toContain('client closed the connection');
  }, 10_000);
});
