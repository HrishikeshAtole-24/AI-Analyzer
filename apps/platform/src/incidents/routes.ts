import { HttpError } from '@ai-analyzer/shared';
import { Router } from 'express';
import { z } from 'zod';
import { db } from '../clients/db';
import { OPEN_STATUSES } from './lifecycle';
import { findIncident, setStatus } from './service';

const listQuery = z.object({
  status: z.enum(['open', 'resolved', 'all', 'detected', 'investigating', 'identified']).default('all'),
  service: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const statusBody = z.object({
  status: z.enum(['investigating', 'identified', 'resolved']),
  note: z.string().max(2000).optional(),
});

export function incidentRouter(): Router {
  const router = Router();

  router.get('/api/v1/incidents', async (req, res) => {
    const q = listQuery.safeParse(req.query);
    if (!q.success) throw new HttpError(400, 'invalid_request', 'invalid query', z.flattenError(q.error));
    const { status, service, limit } = q.data;
    const incidents = await db.incident.findMany({
      where: {
        ...(status === 'open'
          ? { status: { in: OPEN_STATUSES } }
          : status === 'all'
            ? {}
            : { status }),
        ...(service ? { services: { has: service } } : {}),
      },
      orderBy: { detectedAt: 'desc' },
      take: limit,
      include: { _count: { select: { anomalies: true } } },
    });
    res.json({
      incidents: incidents.map(({ _count, ...i }) => ({ ...i, anomalyCount: _count.anomalies })),
      count: incidents.length,
    });
  });

  router.get('/api/v1/incidents/:id', async (req, res) => {
    const found = await findIncident(String(req.params.id));
    if (!found) throw new HttpError(404, 'not_found', 'incident not found');
    const incident = await db.incident.findUniqueOrThrow({
      where: { id: found.id },
      include: {
        events: { orderBy: { at: 'asc' } },
        anomalies: { orderBy: { windowStart: 'asc' } },
        investigations: { orderBy: { startedAt: 'desc' }, take: 1 },
      },
    });
    res.json(incident);
  });

  router.patch('/api/v1/incidents/:id', async (req, res) => {
    const body = statusBody.safeParse(req.body);
    if (!body.success) throw new HttpError(400, 'invalid_request', 'invalid status change', z.flattenError(body.error));
    res.json(await setStatus(String(req.params.id), body.data.status, body.data.note));
  });

  return router;
}
