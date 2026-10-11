import { HttpError, type Logger } from '@ai-analyzer/shared';
import { Router } from 'express';
import { db } from '../clients/db';
import { findIncident } from '../incidents/service';
import { findSimilarIncidents, searchRunbooks } from '../knowledge/knowledge';
import { investigateIncident, llmCircuit } from './investigator';
import { hasLlmCredentials, LLM_MODEL } from './llm-agent';

export function investigationRouter(logger: Logger): Router {
  const router = Router();

  /** Starts a new investigation (re-investigation is allowed). Runs in the background. */
  router.post('/api/v1/incidents/:id/investigate', async (req, res) => {
    const incident = await findIncident(String(req.params.id));
    if (!incident) throw new HttpError(404, 'not_found', 'incident not found');
    void investigateIncident(incident.id, logger);
    res.status(202).json({ incidentId: incident.id, status: 'started', llmAvailable: hasLlmCredentials() && llmCircuit.canRequest() });
  });

  router.get('/api/v1/incidents/:id/investigations', async (req, res) => {
    const incident = await findIncident(String(req.params.id));
    if (!incident) throw new HttpError(404, 'not_found', 'incident not found');
    const investigations = await db.investigation.findMany({ where: { incidentId: incident.id }, orderBy: { startedAt: 'desc' } });
    res.json({ investigations, count: investigations.length });
  });

  router.get('/api/v1/investigations/:id', async (req, res) => {
    const investigation = await db.investigation.findUnique({ where: { id: String(req.params.id) } });
    if (!investigation) throw new HttpError(404, 'not_found', 'investigation not found');
    res.json(investigation);
  });

  router.get('/api/v1/runbooks', async (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (q.length < 3) throw new HttpError(400, 'invalid_request', 'q must be at least 3 characters');
    const limit = Math.min(Number(req.query.limit) || 3, 10);
    res.json({ runbooks: await searchRunbooks(q, limit) });
  });

  /** Past incidents most similar to this one (by title, services and summary). */
  router.get('/api/v1/incidents/:id/similar', async (req, res) => {
    const incident = await findIncident(String(req.params.id));
    if (!incident) throw new HttpError(404, 'not_found', 'incident not found');
    const query = `${incident.title} ${incident.services.join(' ')} ${incident.summary ?? ''}`;
    res.json({ incidents: await findSimilarIncidents(query, incident.id, 5) });
  });

  /** Totals for the README success metrics: unsupported-claim rate, cost per investigation, fallbacks. */
  router.get('/api/v1/stats/investigations', async (_req, res) => {
    const rows = await db.investigation.findMany({ where: { status: 'completed' } });
    const llm = rows.filter((r) => r.mode === 'llm');
    const claims = rows.reduce((n, r) => n + r.claimsTotal, 0);
    const rejected = rows.reduce((n, r) => n + r.claimsRejected, 0);
    res.json({
      investigations: rows.length,
      byMode: { llm: llm.length, rule_based: rows.length - llm.length },
      claimsTotal: claims,
      claimsRejected: rejected,
      unsupportedClaimRate: claims ? Math.round((rejected / claims) * 10_000) / 10_000 : null,
      avgCostUsd: llm.length ? Math.round((llm.reduce((n, r) => n + r.costUsd, 0) / llm.length) * 10_000) / 10_000 : null,
      totalCostUsd: Math.round(rows.reduce((n, r) => n + r.costUsd, 0) * 10_000) / 10_000,
      llm: { configured: hasLlmCredentials(), model: LLM_MODEL, circuit: llmCircuit.state },
    });
  });

  return router;
}
