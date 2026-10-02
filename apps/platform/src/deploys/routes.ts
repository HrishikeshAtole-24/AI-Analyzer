import { HttpError, type Logger } from '@ai-analyzer/shared';
import { Router } from 'express';
import { z } from 'zod';
import { db } from '../clients/db';
import { attachDeployToOpenIncidents } from '../incidents/service';

const deployBody = z.object({
  service: z.string().min(1).max(100),
  version: z.string().min(1).max(50),
  environment: z.string().max(50).default('local'),
  commitSha: z.string().max(64).optional(),
  description: z.string().max(500).optional(),
  deployedAt: z.iso.datetime({ offset: true }).optional(),
});

const listQuery = z.object({
  service: z.string().optional(),
  since: z.iso.datetime({ offset: true }).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

/** Deploy tracking: CI/CD (or the bad_deploy fault) records releases so incidents can be linked to changes. */
export function deployRouter(logger: Logger): Router {
  const router = Router();

  router.post('/api/v1/deploys', async (req, res) => {
    const body = deployBody.safeParse(req.body);
    if (!body.success) throw new HttpError(400, 'invalid_request', 'invalid deploy', z.flattenError(body.error));
    const { deployedAt, ...rest } = body.data;
    const deploy = await db.deploy.create({
      data: { ...rest, ...(deployedAt ? { deployedAt: new Date(deployedAt) } : {}) },
    });
    logger.info(`deploy recorded: ${deploy.service} ${deploy.version}`, { 'deploy.id': deploy.id });
    // A deploy during an open incident (often a rollback or hotfix) belongs on its timeline.
    await attachDeployToOpenIncidents(deploy);
    res.status(201).json(deploy);
  });

  router.get('/api/v1/deploys', async (req, res) => {
    const q = listQuery.safeParse(req.query);
    if (!q.success) throw new HttpError(400, 'invalid_request', 'invalid query', z.flattenError(q.error));
    const deploys = await db.deploy.findMany({
      where: {
        ...(q.data.service ? { service: q.data.service } : {}),
        ...(q.data.since ? { deployedAt: { gte: new Date(q.data.since) } } : {}),
      },
      orderBy: { deployedAt: 'desc' },
      take: q.data.limit,
    });
    res.json({ deploys, count: deploys.length });
  });

  return router;
}
