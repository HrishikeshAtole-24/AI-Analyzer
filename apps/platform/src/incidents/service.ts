import { HttpError, type Logger } from '@ai-analyzer/shared';
import { Prisma, type Deploy, type Incident, type IncidentStatus } from '@prisma/client';
import { db } from '../clients/db';
import type { Detection, MetricName } from '../detection/ewma';
import {
  anomalyTitle,
  AUTO_RESOLVE_AFTER_MS,
  canTransition,
  formatMetric,
  GROUPING_WINDOW_MS,
  OPEN_STATUSES,
  severityFor,
} from './lifecycle';

/** How far before an incident's start a deploy still counts as related. */
const DEPLOY_LOOKBACK_MS = 30 * 60_000;

type Tx = Prisma.TransactionClient;

export interface NewAnomaly extends Detection {
  service: string;
}

/**
 * Stores an anomaly once (the detector re-reads recent windows every tick) and attaches it to
 * an incident: the open incident that had an anomaly in the last 10 minutes, or a new one.
 * Returns null when the anomaly was already recorded.
 */
export async function recordAnomaly(a: NewAnomaly, logger: Logger): Promise<Incident | null> {
  const windowStart = new Date(a.windowStart);
  try {
    return await db.$transaction(async (tx) => {
      const anomaly = await tx.anomaly.create({
        data: {
          service: a.service,
          metric: a.metric,
          windowStart,
          value: a.value,
          baseline: a.baseline,
          zScore: a.zScore,
        },
      });

      const open = await tx.incident.findFirst({
        where: {
          status: { in: OPEN_STATUSES },
          lastAnomalyAt: { gte: new Date(windowStart.getTime() - GROUPING_WINDOW_MS) },
        },
        orderBy: { lastAnomalyAt: 'desc' },
      });

      const message =
        `${a.metric} ${formatMetric(a.metric as MetricName, a.value)} on ${a.service} ` +
        `(baseline ${formatMetric(a.metric as MetricName, a.baseline)}, z=${a.zScore.toFixed(1)})`;

      let incident: Incident;
      if (open) {
        const isNewService = !open.services.includes(a.service);
        const services = isNewService ? [...open.services, a.service] : open.services;
        incident = await tx.incident.update({
          where: { id: open.id },
          data: {
            services,
            severity: severityFor(open.severity, a.metric, a.value, services.length),
            lastAnomalyAt: windowStart > open.lastAnomalyAt ? windowStart : open.lastAnomalyAt,
            startedAt: windowStart < open.startedAt ? windowStart : open.startedAt,
          },
        });
        if (isNewService) await attachDeploys(tx, incident.id, a.service, incident.startedAt);
      } else {
        incident = await tx.incident.create({
          data: {
            title: anomalyTitle(a.service, a.metric, a.value, a.baseline),
            severity: severityFor(null, a.metric, a.value, 1),
            services: [a.service],
            startedAt: windowStart,
            lastAnomalyAt: windowStart,
          },
        });
        await attachDeploys(tx, incident.id, a.service, windowStart);
        logger.warn(`incident INC-${incident.number} opened: ${incident.title}`, {
          'incident.id': incident.id,
          'incident.severity': incident.severity,
        });
      }

      await tx.anomaly.update({ where: { id: anomaly.id }, data: { incidentId: incident.id } });
      await tx.incidentEvent.create({
        data: {
          incidentId: incident.id,
          type: 'anomaly',
          message,
          at: windowStart,
          data: { service: a.service, metric: a.metric, value: a.value, baseline: a.baseline, zScore: a.zScore, std: a.std },
        },
      });
      return incident;
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return null; // already recorded
    throw err;
  }
}

/** Adds the service's recent deploys to the incident timeline: the usual first suspect. */
async function attachDeploys(tx: Tx, incidentId: string, service: string, startedAt: Date): Promise<void> {
  const deploys = await tx.deploy.findMany({
    where: { service, deployedAt: { gte: new Date(startedAt.getTime() - DEPLOY_LOOKBACK_MS) } },
    orderBy: { deployedAt: 'asc' },
  });
  for (const d of deploys) {
    await tx.incidentEvent.create({
      data: {
        incidentId,
        type: 'deploy',
        message: `${d.service} deployed version ${d.version}${d.description ? `: ${d.description}` : ''}`,
        at: d.deployedAt,
        data: { deployId: d.id, service: d.service, version: d.version, commitSha: d.commitSha },
      },
    });
  }
}

/** Puts a new deploy on the timeline of every open incident that involves its service. */
export async function attachDeployToOpenIncidents(deploy: Deploy): Promise<void> {
  const incidents = await db.incident.findMany({
    where: { status: { in: OPEN_STATUSES }, services: { has: deploy.service } },
  });
  for (const incident of incidents) {
    await db.incidentEvent.create({
      data: {
        incidentId: incident.id,
        type: 'deploy',
        message: `${deploy.service} deployed version ${deploy.version}${deploy.description ? `: ${deploy.description}` : ''}`,
        at: deploy.deployedAt,
        data: { deployId: deploy.id, service: deploy.service, version: deploy.version, commitSha: deploy.commitSha },
      },
    });
  }
}

export async function setStatus(idOrNumber: string, to: IncidentStatus, note?: string): Promise<Incident> {
  const incident = await findIncident(idOrNumber);
  if (!incident) throw new HttpError(404, 'not_found', 'incident not found');
  if (!canTransition(incident.status, to)) {
    throw new HttpError(409, 'invalid_transition', `cannot move an incident from ${incident.status} to ${to}`);
  }
  return db.$transaction(async (tx) => {
    const updated = await tx.incident.update({
      where: { id: incident.id },
      data: { status: to, resolvedAt: to === 'resolved' ? new Date() : null },
    });
    await tx.incidentEvent.create({
      data: {
        incidentId: incident.id,
        type: 'status_change',
        message: `status ${incident.status} -> ${to}${note ? `: ${note}` : ''}`,
        data: { from: incident.status, to, note: note ?? null },
      },
    });
    return updated;
  });
}

/**
 * Resolves open incidents with no anomaly for AUTO_RESOLVE_AFTER_MS of complete windows.
 * `lastCompleteWindowEnd` is the end of the newest window the detector has fully checked.
 */
export async function autoResolve(lastCompleteWindowEnd: Date, logger: Logger): Promise<number> {
  // lastAnomalyAt is a window start; that window ends one minute later.
  const cutoff = new Date(lastCompleteWindowEnd.getTime() - AUTO_RESOLVE_AFTER_MS - 60_000);
  const stale = await db.incident.findMany({
    where: { status: { in: OPEN_STATUSES }, lastAnomalyAt: { lt: cutoff } },
  });
  for (const incident of stale) {
    await db.$transaction([
      db.incident.update({ where: { id: incident.id }, data: { status: 'resolved', resolvedAt: new Date() } }),
      db.incidentEvent.create({
        data: {
          incidentId: incident.id,
          type: 'status_change',
          message: `status ${incident.status} -> resolved: auto-resolved, metrics back to baseline for ${AUTO_RESOLVE_AFTER_MS / 60_000} minutes`,
          data: { from: incident.status, to: 'resolved', auto: true },
        },
      }),
    ]);
    logger.info(`incident INC-${incident.number} auto-resolved`, { 'incident.id': incident.id });
  }
  return stale.length;
}

/** Accepts the UUID or the human number ("12" or "INC-12"). */
export async function findIncident(idOrNumber: string): Promise<Incident | null> {
  const num = /^(INC-)?(\d+)$/i.exec(idOrNumber);
  if (num) return db.incident.findUnique({ where: { number: Number(num[2]) } });
  if (!/^[0-9a-f-]{36}$/i.test(idOrNumber)) return null;
  return db.incident.findUnique({ where: { id: idOrNumber } });
}
