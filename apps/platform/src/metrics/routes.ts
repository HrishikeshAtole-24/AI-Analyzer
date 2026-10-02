import { HttpError } from '@ai-analyzer/shared';
import { Router } from 'express';
import { z } from 'zod';
import { getPipelineStats, getServiceMetrics, listServices } from './metrics';

const metricsQuery = z.object({
  service: z.string().optional(),
  from: z.string().default('now-30m'),
  to: z.string().default('now'),
});

export function metricsRouter(): Router {
  const router = Router();

  router.get('/api/v1/services', async (_req, res) => {
    const services = await listServices();
    res.json({ services, count: services.length });
  });

  router.get('/api/v1/metrics', async (req, res) => {
    const q = metricsQuery.safeParse(req.query);
    if (!q.success) throw new HttpError(400, 'invalid_request', 'invalid query', z.flattenError(q.error));
    const services = q.data.service?.split(',').map((s) => s.trim()).filter(Boolean);
    res.json({
      from: q.data.from,
      to: q.data.to,
      intervalSeconds: 60,
      services: await getServiceMetrics({ from: q.data.from, to: q.data.to, services }),
    });
  });

  router.get('/api/v1/stats/pipeline', async (req, res) => {
    const minutes = z.coerce.number().int().min(1).max(1440).default(5).safeParse(req.query.minutes);
    if (!minutes.success) throw new HttpError(400, 'invalid_request', 'minutes must be 1 to 1440');
    res.json(await getPipelineStats(minutes.data));
  });

  return router;
}
