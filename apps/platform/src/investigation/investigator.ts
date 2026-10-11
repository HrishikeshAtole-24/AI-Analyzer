import Anthropic from '@anthropic-ai/sdk';
import type { Logger } from '@ai-analyzer/shared';
import type { Investigation, Prisma } from '@prisma/client';
import { db } from '../clients/db';
import { rememberIncident, searchRunbooks } from '../knowledge/knowledge';
import { OPEN_STATUSES } from '../incidents/lifecycle';
import { CircuitBreaker } from './circuit-breaker';
import type { Findings } from './findings';
import { AgentError, hasLlmCredentials, LLM_MODEL, runLlmInvestigation, type Usage } from './llm-agent';
import { investigationWindow, runRuleBasedInvestigation, type IncidentForInvestigation } from './rule-based';
import { EvidenceLedger } from './tools';
import { verifyFindings, type VerificationResult } from './verifier';

/** One investigation may take this long in total before the playbook takes over. */
const INVESTIGATION_DEADLINE_MS = 4 * 60_000;

/** Shared by every investigation in this process. */
export const llmCircuit = new CircuitBreaker(3, 2 * 60_000);

const running = new Set<string>();

function toJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function incidentContext(incident: IncidentForInvestigation & { id: string; severity: string; events: { at: Date; type: string; message: string }[] }): string {
  const w = investigationWindow(incident);
  return [
    `Investigate incident INC-${incident.number}: ${incident.title}`,
    '',
    JSON.stringify(
      {
        severity: incident.severity,
        servicesWithAnomalies: incident.services,
        startedAt: incident.startedAt.toISOString(),
        detectedAt: incident.detectedAt.toISOString(),
        lastAnomalyAt: incident.lastAnomalyAt.toISOString(),
        suggestedWindow: { from: w.from, to: w.to },
        anomalies: incident.anomalies.map((a) => ({
          service: a.service,
          metric: a.metric,
          windowStart: a.windowStart.toISOString(),
          value: a.value,
          baseline: a.baseline,
        })),
        timeline: incident.events.map((e) => ({ at: e.at.toISOString(), type: e.type, message: e.message })),
      },
      null,
      2,
    ),
  ].join('\n');
}

/** Provider failures trip the circuit; the model doing something odd (AgentError) does not. */
function isProviderFailure(err: unknown): boolean {
  if (err instanceof Anthropic.APIConnectionError) return true; // includes timeouts
  if (err instanceof Anthropic.RateLimitError || err instanceof Anthropic.InternalServerError) return true;
  if (err instanceof Anthropic.APIError) return (err.status ?? 0) >= 500 || err.status === 529;
  return false;
}

/**
 * Investigates one incident: the LLM when it is available, otherwise (or when it fails, or
 * produces nothing verifiable) the rule-based playbook. Either way the findings pass through
 * the verifier, and only verified hypotheses are stored and shown.
 */
export async function investigateIncident(incidentId: string, logger: Logger): Promise<Investigation | null> {
  if (running.has(incidentId)) return null;
  running.add(incidentId);
  try {
    const incident = await db.incident.findUnique({
      where: { id: incidentId },
      include: { anomalies: { orderBy: { windowStart: 'asc' } }, events: { orderBy: { at: 'asc' } } },
    });
    if (!incident) return null;

    const useLlm = hasLlmCredentials() && llmCircuit.canRequest();
    let fallbackReason: string | null = useLlm ? null : hasLlmCredentials() ? 'circuit_open' : 'no_api_key';

    const investigation = await db.investigation.create({
      data: { incidentId, mode: useLlm ? 'llm' : 'rule_based', model: useLlm ? LLM_MODEL : null, fallbackReason },
    });
    if (incident.status === 'detected') {
      await db.$transaction([
        db.incident.update({ where: { id: incidentId }, data: { status: 'investigating' } }),
        db.incidentEvent.create({
          data: { incidentId, type: 'status_change', message: 'status detected -> investigating: automatic investigation started', data: { from: 'detected', to: 'investigating', auto: true } },
        }),
      ]);
    }

    const ledger = new EvidenceLedger({ incidentId });
    let usage: Usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0 };
    let mode: 'llm' | 'rule_based' = useLlm ? 'llm' : 'rule_based';
    let verification: VerificationResult | null = null;

    if (useLlm) {
      try {
        const result = await runLlmInvestigation(incidentContext(incident), ledger, logger, Date.now() + INVESTIGATION_DEADLINE_MS);
        llmCircuit.recordSuccess();
        usage = result.usage;
        verification = await verifyFindings(result.findings, ledger);
        if (verification.hypotheses.length === 0) {
          fallbackReason = 'no_verified_hypotheses';
          logger.warn(`INC-${incident.number}: no LLM hypothesis survived verification; using the playbook`);
        }
      } catch (err) {
        if (err instanceof AgentError) usage = err.usage;
        if (isProviderFailure(err)) llmCircuit.recordFailure();
        fallbackReason = `llm_error: ${(err as Error).message.slice(0, 300)}`;
        logger.error(`INC-${incident.number}: LLM investigation failed, using the playbook: ${(err as Error).message}`, {
          'llm.circuit': llmCircuit.state,
        });
      }
    }

    let llmVerification: VerificationResult | null = null;
    if (!verification || verification.hypotheses.length === 0) {
      llmVerification = verification;
      mode = 'rule_based';
      const findings: Findings = await runRuleBasedInvestigation(incident, ledger);
      // The playbook has no judgement of its own, so point the engineer at the closest runbook.
      for (const h of findings.hypotheses) {
        const [runbook] = await searchRunbooks(`${h.title} ${h.description}`, 1).catch(() => []);
        if (runbook) h.recommended_actions.push(`Runbook: ${runbook.title} (docs/runbooks/${runbook.slug}.md)`);
      }
      verification = await verifyFindings(findings, ledger);
    }

    const top = verification.hypotheses[0];
    const rejected = [...(llmVerification?.rejected ?? []), ...verification.rejected];
    const claimsTotal = verification.claimsTotal + (llmVerification?.claimsTotal ?? 0);
    const claimsRejected = verification.claimsRejected + (llmVerification?.claimsRejected ?? 0);

    const saved = await db.investigation.update({
      where: { id: investigation.id },
      data: {
        status: 'completed',
        mode,
        fallbackReason,
        summary: verification.summary,
        hypotheses: toJson(verification.hypotheses),
        rejectedClaims: toJson(rejected),
        toolCalls: toJson(ledger.list()),
        claimsTotal,
        claimsRejected,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        cacheReadTokens: usage.cacheReadTokens,
        costUsd: usage.costUsd,
        finishedAt: new Date(),
      },
    });

    const current = await db.incident.findUniqueOrThrow({ where: { id: incidentId } });
    const message = top
      ? `${mode === 'llm' ? 'AI' : 'Rule-based'} investigation: ${top.title} (${top.category} in ${top.service}); ` +
        `${verification.hypotheses.length} verified hypothesis(es), ${claimsRejected}/${claimsTotal} claims rejected`
      : `${mode} investigation found no verified cause`;
    await db.$transaction([
      db.incident.update({
        where: { id: incidentId },
        data: {
          summary: verification.summary,
          ...(top && current.status === 'investigating' ? { status: 'identified' } : {}),
        },
      }),
      db.incidentEvent.create({
        data: {
          incidentId,
          type: 'investigation',
          message,
          data: { investigationId: saved.id, mode, category: top?.category ?? null, service: top?.service ?? null, costUsd: usage.costUsd },
        },
      }),
      ...(top && current.status === 'investigating'
        ? [
            db.incidentEvent.create({
              data: { incidentId, type: 'status_change', message: `status investigating -> identified: ${top.title}`, data: { from: 'investigating', to: 'identified', auto: true } },
            }),
          ]
        : []),
    ]);
    if (top) {
      await rememberIncident({
        incidentId,
        number: incident.number,
        text: `INC-${incident.number}: ${incident.title}. Cause: ${top.title} (${top.category} in ${top.service}). ${top.description}`,
        category: top.category,
        service: top.service,
      }).catch((err: Error) => logger.warn(`could not store incident memory: ${err.message}`));
    }
    logger.info(`INC-${incident.number} investigated (${mode}): ${top ? top.title : 'no verified cause'}`, {
      'investigation.id': saved.id,
      'investigation.mode': mode,
      'investigation.cost_usd': usage.costUsd,
    });
    return saved;
  } catch (err) {
    logger.error(`investigation of ${incidentId} failed: ${(err as Error).message}`);
    await db.investigation.updateMany({
      where: { incidentId, status: 'running' },
      data: { status: 'failed', error: (err as Error).message.slice(0, 1000), finishedAt: new Date() },
    });
    return null;
  } finally {
    running.delete(incidentId);
  }
}

/** Wait this long after detection so the first minutes of the failure are in the logs. */
const INVESTIGATE_AFTER_MS = 30_000;

/** Worker loop: investigates each new incident once, one at a time. */
export function startInvestigator(logger: Logger, intervalMs = 10_000): () => void {
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      const due = await db.incident.findMany({
        where: {
          status: { in: OPEN_STATUSES },
          investigations: { none: {} },
          detectedAt: { lte: new Date(Date.now() - INVESTIGATE_AFTER_MS) },
        },
        orderBy: { detectedAt: 'asc' },
        take: 1,
      });
      for (const incident of due) await investigateIncident(incident.id, logger);
    } catch (err) {
      logger.error(`investigator pass failed: ${(err as Error).message}`);
    } finally {
      busy = false;
    }
  };
  const timer = setInterval(() => void tick(), intervalMs);
  return () => clearInterval(timer);
}
