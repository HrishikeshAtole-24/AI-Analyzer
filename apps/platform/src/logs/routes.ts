import { HttpError } from '@ai-analyzer/shared';
import { Router } from 'express';
import { z } from 'zod';
import { getTrace, logQuerySchema, searchLogs } from './search';

export function logRouter(): Router {
  const router = Router();

  router.get('/api/v1/logs', async (req, res) => {
    const query = logQuerySchema.safeParse(req.query);
    if (!query.success) {
      throw new HttpError(400, 'invalid_request', 'invalid log query', z.flattenError(query.error));
    }
    res.json(await searchLogs(query.data));
  });

  router.get('/api/v1/traces/:traceId', async (req, res) => {
    const traceId = String(req.params.traceId);
    if (!/^[0-9a-f]{32}$/.test(traceId)) {
      throw new HttpError(400, 'invalid_request', 'traceId must be 32 lowercase hex characters');
    }
    const trace = await getTrace(traceId);
    if (trace.logCount === 0) throw new HttpError(404, 'not_found', 'no logs for this trace');
    res.json(trace);
  });

  return router;
}
