import type { Check, Evidence, Findings, Hypothesis } from './findings';
import type { EvidenceLedger, ToolResult } from './tools';

/**
 * Evidence verifier. For every claim it re-runs the cited query (same tool, same parameters)
 * and evaluates the claim's check against the fresh result. Claims that cite a query that
 * never ran, or whose check fails, are dropped. A hypothesis with no verified supporting
 * evidence is dropped entirely.
 */

export interface VerifiedEvidence extends Evidence {
  verified: true;
  /** What the re-run actually observed, for display. */
  observed: string;
}

export interface RejectedClaim {
  hypothesis: string;
  role: 'supporting' | 'contradicting';
  claim: string;
  query_id: string;
  reason: string;
}

export interface VerifiedHypothesis extends Omit<Hypothesis, 'supporting' | 'contradicting'> {
  supporting: VerifiedEvidence[];
  contradicting: VerifiedEvidence[];
}

export interface VerificationResult {
  summary: string;
  hypotheses: VerifiedHypothesis[];
  rejected: RejectedClaim[];
  claimsTotal: number;
  claimsRejected: number;
}

type CheckOutcome = { ok: true; observed: string } | { ok: false; reason: string };

const LIKELIHOOD_ORDER = { high: 0, medium: 1, low: 2 } as const;
const KNOWLEDGE_TOOLS = new Set(['search_runbooks', 'find_similar_incidents']);

/** Applies one check to a tool result. Pure, so it is unit-tested directly. */
export function evaluateCheck(check: Check, result: ToolResult): CheckOutcome {
  switch (check.kind) {
    case 'log_count_at_least': {
      if (result.count === undefined) return { ok: false, reason: 'cited query does not return a count' };
      if (check.value === null) return { ok: false, reason: 'log_count_at_least needs value' };
      return result.count >= check.value
        ? { ok: true, observed: `count ${result.count} >= ${check.value}` }
        : { ok: false, reason: `count is ${result.count}, claimed at least ${check.value}` };
    }
    case 'log_text_present': {
      if (!result.texts) return { ok: false, reason: 'cited query does not return log text' };
      if (!check.text) return { ok: false, reason: 'log_text_present needs text' };
      const needle = check.text.toLowerCase();
      const hit = result.texts.find((t) => t.toLowerCase().includes(needle));
      return hit
        ? { ok: true, observed: `found in: "${hit.slice(0, 160)}"` }
        : { ok: false, reason: `text "${check.text}" not found in the query result` };
    }
    case 'metric_threshold': {
      if (!result.metrics) return { ok: false, reason: 'cited query does not return metrics' };
      if (!check.service || !check.metric || !check.op || check.value === null) {
        return { ok: false, reason: 'metric_threshold needs service, metric, op and value' };
      }
      const windows = result.metrics[check.service];
      if (!windows) return { ok: false, reason: `no metrics for ${check.service} in the cited query` };
      const metric = check.metric;
      const values = windows.map((w) => ({ at: w.windowStart, v: w[metric] })).filter((x): x is { at: string; v: number } => x.v !== null);
      const match = values.find((x) => (check.op === 'above' ? x.v > check.value! : x.v < check.value!));
      return match
        ? { ok: true, observed: `${check.service} ${metric}=${match.v} at ${match.at.slice(11, 16)} (${check.op} ${check.value})` }
        : { ok: false, reason: `no window where ${check.service} ${metric} is ${check.op} ${check.value}` };
    }
    case 'deploy_present': {
      if (!result.deploys) return { ok: false, reason: 'cited query does not return deploys' };
      if (!check.service || !check.version) return { ok: false, reason: 'deploy_present needs service and version' };
      const hit = result.deploys.find((d) => d.service === check.service && d.version === check.version);
      return hit
        ? { ok: true, observed: `${hit.service} ${hit.version} deployed` }
        : { ok: false, reason: `no deploy of ${check.service} ${check.version} in the cited query` };
    }
  }
}

export async function verifyFindings(findings: Findings, ledger: EvidenceLedger): Promise<VerificationResult> {
  // Re-run each cited query once, however many claims cite it.
  const cache = new Map<string, Promise<{ tool: string; result: ToolResult } | null>>();
  const rerun = (id: string) => {
    let p = cache.get(id);
    if (!p) {
      p = ledger.rerun(id).catch(() => null);
      cache.set(id, p);
    }
    return p;
  };

  const rejected: RejectedClaim[] = [];
  let claimsTotal = 0;

  const verifyList = async (h: Hypothesis, role: 'supporting' | 'contradicting', list: Evidence[]) => {
    const kept: VerifiedEvidence[] = [];
    for (const e of list) {
      claimsTotal++;
      const rerunResult = await rerun(e.query_id);
      if (!rerunResult) {
        rejected.push({ hypothesis: h.title, role, claim: e.claim, query_id: e.query_id, reason: 'cited query did not run or failed on re-run' });
        continue;
      }
      if (KNOWLEDGE_TOOLS.has(rerunResult.tool)) {
        // A runbook or a past incident says what usually happens, not what happened here.
        rejected.push({ hypothesis: h.title, role, claim: e.claim, query_id: e.query_id, reason: 'runbooks and past incidents are not evidence about this incident' });
        continue;
      }
      const outcome = evaluateCheck(e.check, rerunResult.result);
      if (outcome.ok) kept.push({ ...e, verified: true, observed: outcome.observed });
      else rejected.push({ hypothesis: h.title, role, claim: e.claim, query_id: e.query_id, reason: outcome.reason });
    }
    return kept;
  };

  const verified: VerifiedHypothesis[] = [];
  for (const h of findings.hypotheses) {
    const supporting = await verifyList(h, 'supporting', h.supporting);
    const contradicting = await verifyList(h, 'contradicting', h.contradicting);
    if (supporting.length === 0) {
      rejected.push({ hypothesis: h.title, role: 'supporting', claim: '(whole hypothesis)', query_id: '-', reason: 'no supporting evidence survived verification' });
      continue;
    }
    verified.push({ ...h, supporting, contradicting });
  }

  // Keep the investigator's order, but a hypothesis with verified contradicting evidence
  // ranks below one without, and likelihood breaks ties.
  verified.sort(
    (a, b) =>
      Number(a.contradicting.length > 0) - Number(b.contradicting.length > 0) ||
      a.rank - b.rank ||
      LIKELIHOOD_ORDER[a.likelihood] - LIKELIHOOD_ORDER[b.likelihood],
  );
  verified.forEach((h, i) => (h.rank = i + 1));

  return {
    summary: findings.summary,
    hypotheses: verified,
    rejected,
    claimsTotal,
    claimsRejected: rejected.filter((r) => r.claim !== '(whole hypothesis)').length,
  };
}
