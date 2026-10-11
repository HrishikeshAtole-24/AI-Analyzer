import type { Category, Check, Evidence, Findings, Hypothesis } from './findings';
import type { EvidenceLedger } from './tools';

/**
 * Rule-based investigation: the fallback when the LLM is unavailable (no key, circuit open,
 * error, nothing verifiable). It runs a fixed playbook through the same evidence ledger and
 * produces the same Findings shape, so its claims go through the same verifier.
 */

export interface IncidentForInvestigation {
  number: number;
  title: string;
  services: string[];
  startedAt: Date;
  detectedAt: Date;
  lastAnomalyAt: Date;
  anomalies: { service: string; metric: string; value: number; baseline: number; windowStart: Date }[];
}

interface Pattern {
  service: string;
  pattern: string;
  count: number;
  example: string;
  versions: string[];
  exception?: string;
}

interface Candidate {
  /** Specificity of the failure pattern; decides the order. */
  specificity: number;
  /** How many matching logs; only breaks ties between equally specific patterns. */
  count: number;
  hypothesis: Omit<Hypothesis, 'rank'>;
}

const check = (partial: Partial<Check> & Pick<Check, 'kind'>): Check => ({
  text: null,
  service: null,
  metric: null,
  op: null,
  value: null,
  version: null,
  ...partial,
});

const textEvidence = (claim: string, queryId: string, text: string): Evidence => ({
  claim,
  query_id: queryId,
  check: check({ kind: 'log_text_present', text }),
});

/** Investigation window: 10 minutes of baseline before the start, through the last anomaly. */
export function investigationWindow(incident: IncidentForInvestigation, now = Date.now()) {
  const from = new Date(incident.startedAt.getTime() - 10 * 60_000);
  const to = new Date(Math.min(now, Math.max(incident.lastAnomalyAt.getTime() + 2 * 60_000, incident.detectedAt.getTime())));
  // Errors are only counted from just before the start, so old noise is not blamed.
  const errorsFrom = new Date(incident.startedAt.getTime() - 60_000);
  return { from: from.toISOString(), to: to.toISOString(), errorsFrom: errorsFrom.toISOString() };
}

export async function runRuleBasedInvestigation(incident: IncidentForInvestigation, ledger: EvidenceLedger): Promise<Findings> {
  const w = investigationWindow(incident);
  const errors = await ledger.call('summarize_errors', { from: w.errorsFrom, to: w.to });
  const deploys = await ledger.call('get_recent_deploys', { since: new Date(incident.startedAt.getTime() - 30 * 60_000).toISOString() });
  const metrics = await ledger.call('get_metrics', { from: w.from, to: w.to });

  const patterns: Pattern[] = errors.ok ? ((JSON.parse(errors.content) as { patterns: Pattern[] }).patterns ?? []) : [];
  const deployRows = deploys.result?.deploys ?? [];
  const find = (needle: string, service?: string) =>
    patterns.filter((p) => p.example.toLowerCase().includes(needle) && (!service || p.service === service));
  const total = (ps: Pattern[]) => ps.reduce((n, p) => n + p.count, 0);

  const candidates: Candidate[] = [];

  // 1. Deploy regression: a deploy shortly before the start, and errors with exceptions on the new version.
  const startMs = incident.startedAt.getTime();
  const recent = deployRows.filter((d) => {
    const at = Date.parse(d.deployedAt);
    return at >= startMs - 15 * 60_000 && at <= startMs + 2 * 60_000;
  });
  for (const d of recent) {
    const crashes = patterns.filter(
      (p) => p.service === d.service && p.versions.includes(d.version) && (p.exception || /unhandled error/i.test(p.example)),
    );
    if (crashes.length === 0) continue;
    const top = crashes[0]!;
    const snippet = top.exception ?? 'unhandled error';
    candidates.push({
      specificity: 100,
      count: total(crashes),
      hypothesis: {
        title: `Release ${d.version} of ${d.service} introduced ${snippet} errors`,
        category: 'deploy_regression',
        service: d.service,
        description: `${d.service} was deployed as ${d.version} just before the incident started, and the new version logs "${top.example.slice(0, 160)}".`,
        likelihood: 'high',
        supporting: [
          { claim: `${d.service} ${d.version} was deployed shortly before the incident.`, query_id: deploys.id, check: check({ kind: 'deploy_present', service: d.service, version: d.version }) },
          textEvidence(`${d.service} logs ${snippet} errors after the deploy.`, errors.id, snippet),
        ],
        contradicting: [],
        recommended_actions: [`Roll back ${d.service} to the previous version.`, 'Add a test for the failing path before re-releasing.'],
      },
    });
  }

  // 2. Connection pool exhaustion.
  const pool = find('timeout acquiring connection from pool');
  if (pool.length) {
    const svc = pool[0]!.service;
    candidates.push({
      specificity: 90,
      count: total(pool),
      hypothesis: {
        title: `Database connection pool exhausted on ${svc}`,
        category: 'db_pool_exhaustion',
        service: svc,
        description: `${svc} cannot get database connections: all are in use and requests time out waiting. Connections are likely not being released.`,
        likelihood: 'high',
        supporting: [textEvidence(`${svc} logs connection-pool acquire timeouts.`, errors.id, 'timeout acquiring connection from pool')],
        contradicting: [],
        recommended_actions: [`Find the code path in ${svc} that does not release connections.`, `Restart ${svc} to recover leaked connections.`],
      },
    });
  }

  // 3. Slow database queries.
  const slow = find('slow query');
  if (slow.length) {
    const svc = slow[0]!.service;
    candidates.push({
      specificity: 95, // above pool exhaustion: slow queries are what drain a pool
      count: total(slow),
      hypothesis: {
        title: `Slow database queries on ${svc}`,
        category: 'database_latency',
        service: svc,
        description: `${svc} logs slow queries; its latency rises without connection errors.`,
        likelihood: 'high',
        supporting: [textEvidence(`${svc} logs slow database queries.`, errors.id, 'slow query')],
        contradicting: [],
        recommended_actions: ['Check the query plan and recent schema or index changes.', 'Add a statement timeout.'],
      },
    });
  }

  // 4. Memory leak.
  const heap = find('heap usage high');
  if (heap.length) {
    const svc = heap[0]!.service;
    candidates.push({
      specificity: 80,
      count: total(heap),
      hypothesis: {
        title: `Memory leak in ${svc}`,
        category: 'memory_leak',
        service: svc,
        description: `${svc}'s heap keeps growing past the warning threshold.`,
        likelihood: 'high',
        supporting: [
          textEvidence(`${svc} reports high heap usage.`, errors.id, 'heap usage high'),
          { claim: `${svc} heap went above 256 MB.`, query_id: metrics.id, check: check({ kind: 'metric_threshold', service: svc, metric: 'heapUsedMb', op: 'above', value: 256 }) },
        ],
        contradicting: [],
        recommended_actions: [`Take a heap snapshot of ${svc} and look for an unbounded cache.`, `Restart ${svc} as a stop-gap.`],
      },
    });
  }

  // 5. Retry storm: many retries with a high attempt limit.
  const retries = find('retrying (attempt');
  const maxAttempts = Math.max(0, ...retries.map((p) => Number(/attempt \d+\/(\d+)/.exec(p.example)?.[1] ?? 0)));
  if (retries.length && maxAttempts > 3) {
    const svc = retries[0]!.service;
    candidates.push({
      specificity: 75,
      count: total(retries),
      hypothesis: {
        title: `Retry storm from ${svc} (${maxAttempts} attempts, no backoff)`,
        category: 'retry_storm',
        service: svc,
        description: `${svc} retries failed gateway calls up to ${maxAttempts} times, multiplying load on the gateway.`,
        likelihood: 'high',
        supporting: [textEvidence(`${svc} retries gateway calls up to ${maxAttempts} times.`, errors.id, `/${maxAttempts})`)],
        contradicting: [],
        recommended_actions: [`Restore ${svc}'s retry policy (2 retries, exponential backoff).`, 'Add a retry budget or circuit breaker.'],
      },
    });
  }

  // 6. Upstream timeouts.
  const timeouts = find('timed out after').filter((p) => /gateway|v1\/charges|4003/.test(p.example));
  if (timeouts.length) {
    candidates.push({
      specificity: 70,
      count: total(timeouts),
      hypothesis: {
        title: 'Card gateway responds too slowly; payment-service times out',
        category: 'upstream_timeout',
        service: 'gateway-mock',
        description: 'Calls to the card gateway exceed the payment-service timeout, so payments fail with 504 and orders with 502.',
        likelihood: 'high',
        supporting: [textEvidence('payment-service logs gateway call timeouts.', errors.id, 'timed out after')],
        contradicting: [],
        recommended_actions: ['Check gateway status with the provider.', 'Fail fast and queue payments for retry instead of holding requests.'],
      },
    });
  }

  // 7. Upstream errors.
  // Only the gateway's own errors: callers' retry warnings also mention acquirer_unavailable.
  const upstream = [...find('acquirer connection reset', 'gateway-mock'), ...find('acquirer_unavailable', 'gateway-mock')];
  if (upstream.length) {
    candidates.push({
      specificity: 65,
      count: total(upstream),
      hypothesis: {
        title: 'Card gateway is returning errors',
        category: 'upstream_errors',
        service: 'gateway-mock',
        description: 'The gateway fails charges with 5xx (acquirer connection resets).',
        likelihood: 'high',
        supporting: [textEvidence('The gateway logs acquirer connection resets.', errors.id, 'acquirer')],
        contradicting: [],
        recommended_actions: ['Check gateway status with the provider.', 'Make sure retries use backoff so the errors do not amplify.'],
      },
    });
  }

  if (candidates.length === 0) {
    const a = incident.anomalies[0];
    const svc = a?.service ?? incident.services[0] ?? 'unknown';
    const metric = a?.metric === 'latency_p95' ? 'latencyP95' : a?.metric === 'heap_used' ? 'heapUsedMb' : 'errorRate';
    candidates.push({
      specificity: 0,
      count: 0,
      hypothesis: {
        title: `Unexplained ${a?.metric ?? 'anomaly'} on ${svc}`,
        category: 'unknown' satisfies Category,
        service: svc,
        description: 'The playbook found no known failure pattern. Review the error logs and recent changes by hand.',
        likelihood: 'low',
        supporting: [
          {
            claim: `${svc} ${metric} rose above its baseline.`,
            query_id: metrics.id,
            check: check({ kind: 'metric_threshold', service: svc, metric, op: 'above', value: a ? a.baseline : 0 }),
          },
        ],
        contradicting: [],
        recommended_actions: ['Search the error logs around the start time.', 'Check recent deploys and config changes.'],
      },
    });
  }

  // Specificity first: a raw count would let the noisiest pattern win (a retry storm logs more
  // gateway errors than retries, but the retries are the cause).
  candidates.sort((a, b) => b.specificity - a.specificity || b.count - a.count);
  const hypotheses = candidates.slice(0, 3).map((c, i) => ({ ...c.hypothesis, rank: i + 1 }));
  const top = hypotheses[0]!;
  return {
    summary:
      `Rule-based analysis of INC-${incident.number}: most likely ${top.title.charAt(0).toLowerCase()}${top.title.slice(1)} ` +
      `(${top.category}).` +
      (hypotheses.length > 1 ? ` ${hypotheses.length - 1} other candidate(s) listed.` : ''),
    hypotheses,
  };
}
