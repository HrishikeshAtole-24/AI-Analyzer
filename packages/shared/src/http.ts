import type { Server } from 'node:http';
import express, {
  type ErrorRequestHandler,
  type Express,
  type Request as ExpressRequest,
  type RequestHandler,
  type Response as ExpressResponse,
} from 'express';
import { FaultError, type FaultRegistry } from './faults';
import type { Logger, ServiceIdentity } from './logger';

/** An error with an HTTP status and a stable machine-readable code. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export class UpstreamError extends Error {
  constructor(
    readonly kind: 'timeout' | 'network' | 'status',
    readonly target: string,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'UpstreamError';
  }
}

export interface UpstreamResponse<T> {
  status: number;
  body: T;
}

/** JSON call to another service with a hard timeout. Throws UpstreamError on timeout or network failure. */
export async function callJson<T = unknown>(
  url: string,
  init: { method?: string; body?: unknown; timeoutMs: number },
): Promise<UpstreamResponse<T>> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: init.method ?? 'GET',
      headers: init.body !== undefined ? { 'content-type': 'application/json' } : undefined,
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: AbortSignal.timeout(init.timeoutMs),
    });
  } catch (err) {
    const e = err as Error;
    if (e.name === 'TimeoutError') {
      throw new UpstreamError('timeout', url, `${url} timed out after ${init.timeoutMs}ms`);
    }
    const cause = (e.cause as Error | undefined)?.message ?? e.message;
    throw new UpstreamError('network', url, `${url} unreachable: ${cause}`);
  }
  const text = await res.text();
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    // Non-JSON body; keep the text.
  }
  return { status: res.status, body: body as T };
}

/** Status logged when the client hung up before the response was sent (nginx convention). */
export const CLIENT_CLOSED_REQUEST = 499;

/**
 * Logs one record per request. These records are what the platform derives metrics from.
 * It listens for `close`, not `finish`: when a caller times out and disconnects, `finish` never
 * fires, and the slowest requests (the ones that matter in an incident) would go unlogged.
 */
export function requestLogger(
  logger: Logger,
  options: { skip?: (req: ExpressRequest, res: ExpressResponse) => boolean } = {},
): RequestHandler {
  return (req, res, next) => {
    if (req.path === '/health' || req.path.startsWith('/admin/')) return next();
    const start = process.hrtime.bigint();
    res.once('close', () => {
      if (options.skip?.(req, res)) return;
      const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
      const aborted = !res.writableFinished;
      const status = aborted ? CLIENT_CLOSED_REQUEST : res.statusCode;
      const route = req.route ? `${req.baseUrl}${String(req.route.path)}` : 'unmatched';
      const attributes = {
        'http.request.method': req.method,
        'http.route': route,
        'url.path': req.originalUrl.split('?')[0] ?? req.originalUrl,
        'http.response.status_code': status,
        duration_ms: Math.round(durationMs * 100) / 100,
        ...(aborted ? { 'http.client_aborted': true } : {}),
      };
      const body = aborted
        ? `${req.method} ${route} client closed the connection after ${durationMs.toFixed(1)}ms`
        : `${req.method} ${route} ${status} ${durationMs.toFixed(1)}ms`;
      if (status >= 500) logger.error(body, attributes);
      else if (status >= 400) logger.warn(body, attributes);
      else logger.info(body, attributes);
    });
    next();
  };
}

export function errorHandler(logger: Logger): ErrorRequestHandler {
  return (err, req, res, _next) => {
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
      return;
    }
    if (err instanceof FaultError) {
      res.status(err.status).json({ error: { code: 'fault_error', message: err.message } });
      return;
    }
    if ((err as { type?: string }).type === 'entity.parse.failed') {
      res.status(400).json({ error: { code: 'invalid_json', message: 'request body is not valid JSON' } });
      return;
    }
    const e = err instanceof Error ? err : new Error(String(err));
    logger.error(`unhandled error in ${req.method} ${req.path}: ${e.message}`, {
      'exception.type': e.name,
      'exception.message': e.message,
      'exception.stacktrace': e.stack?.split('\n').slice(0, 6).join('\n') ?? null,
    });
    res.status(500).json({ error: { code: 'internal_error', message: 'internal server error' } });
  };
}

/** Admin routes for switching faults on and off. Changes go to stderr, never to the log stream. */
function faultRoutes(app: Express, service: ServiceIdentity, faults: FaultRegistry): void {
  const note = (msg: string) => process.stderr.write(`\x1b[35m[fault] ${service.name}: ${msg}\x1b[0m\n`);

  app.get('/admin/faults', (_req, res) => {
    res.json({ service: service.name, faults: faults.list() });
  });
  app.put('/admin/faults/:name', (req, res) => {
    const view = faults.enable(String(req.params.name), req.body ?? {});
    note(`enabled ${view.name} ${JSON.stringify(view.params)}`);
    res.json(view);
  });
  app.delete('/admin/faults/:name', (req, res) => {
    const view = faults.disable(String(req.params.name));
    note(`disabled ${view.name}`);
    res.json(view);
  });
  app.post('/admin/faults/reset', (_req, res) => {
    faults.reset();
    note('all faults disabled');
    res.json({ service: service.name, faults: faults.list() });
  });
}

export interface ServiceOptions {
  service: ServiceIdentity;
  port: number;
  logger: Logger;
  faults: FaultRegistry;
  /** Extra fields for GET /health (pool stats, etc.). */
  health?: () => Record<string, unknown>;
  routes: (app: Express) => void;
  onShutdown?: () => void | Promise<void>;
}

/** Builds and starts a demo service with the standard middleware, health, fault and error routes. */
export function startService(options: ServiceOptions): Server {
  const { service, logger, faults } = options;
  const app = express();
  const startedAt = Date.now();

  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));
  app.use(requestLogger(logger));

  app.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      service: service.name,
      version: service.version,
      uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
      activeFaults: faults.list().filter((f) => f.enabled).map((f) => f.name),
      ...options.health?.(),
    });
  });
  faultRoutes(app, service, faults);
  options.routes(app);

  app.use((req, res) => {
    res.status(404).json({ error: { code: 'not_found', message: `no route for ${req.method} ${req.path}` } });
  });
  app.use(errorHandler(logger));

  const server = app.listen(options.port, () => {
    logger.info(`${service.name} listening on port ${options.port}`, { 'server.port': options.port });
  });

  let closing = false;
  const shutdown = async (signal: string) => {
    if (closing) return;
    closing = true;
    logger.info(`${service.name} shutting down`, { signal });
    server.close();
    await options.onShutdown?.();
    await logger.flush();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  return server;
}
