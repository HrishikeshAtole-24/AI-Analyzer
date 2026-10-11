import { describe, expect, it } from 'vitest';
import { runRuleBasedInvestigation, type IncidentForInvestigation } from '../src/investigation/rule-based';
import type { EvidenceLedger } from '../src/investigation/tools';

interface Pattern {
  service: string;
  pattern: string;
  count: number;
  example: string;
  versions: string[];
  exception?: string;
}

/** A ledger that answers the playbook's three queries with fixed data. */
function ledger(patterns: Pattern[], deploys: { service: string; version: string; deployedAt: string }[] = []): EvidenceLedger {
  let n = 0;
  return {
    call: async (tool: string) => {
      const id = `q${++n}`;
      if (tool === 'summarize_errors') return { id, ok: true, content: JSON.stringify({ query_id: id, patterns }), result: { forModel: {}, texts: [] } };
      if (tool === 'get_recent_deploys') return { id, ok: true, content: '{}', result: { forModel: {}, deploys } };
      return { id, ok: true, content: '{}', result: { forModel: {}, metrics: {} } };
    },
  } as unknown as EvidenceLedger;
}

const incident: IncidentForInvestigation = {
  number: 1,
  title: 't',
  services: ['payment-service'],
  startedAt: new Date('2026-10-11T15:28:00Z'),
  detectedAt: new Date('2026-10-11T15:29:24Z'),
  lastAnomalyAt: new Date('2026-10-11T15:28:00Z'),
  anomalies: [],
};

const p = (service: string, example: string, count: number, extra: Partial<Pattern> = {}): Pattern => ({
  service,
  pattern: example,
  count,
  example,
  versions: ['1.0.0'],
  ...extra,
});

describe('rule-based playbook ranking', () => {
  it('names the retry storm even when gateway errors are far more numerous', async () => {
    const findings = await runRuleBasedInvestigation(
      incident,
      ledger([
        p('gateway-mock', 'acquirer connection reset by peer while authorising charge', 5200),
        p('payment-service', 'gateway call failed, retrying (attempt 3/9): gateway responded 503 acquirer_unavailable', 3100),
      ]),
    );
    expect(findings.hypotheses[0]).toMatchObject({ category: 'retry_storm', service: 'payment-service' });
    expect(findings.hypotheses[1]).toMatchObject({ category: 'upstream_errors', service: 'gateway-mock' });
  });

  it('does not call normal retries (3 attempts) a retry storm', async () => {
    const findings = await runRuleBasedInvestigation(
      incident,
      ledger([
        p('gateway-mock', 'acquirer connection reset by peer while authorising charge', 900),
        p('payment-service', 'gateway call failed, retrying (attempt 1/3): gateway responded 503 acquirer_unavailable', 600),
      ]),
    );
    expect(findings.hypotheses[0]).toMatchObject({ category: 'upstream_errors', service: 'gateway-mock' });
    expect(findings.hypotheses.map((h) => h.category)).not.toContain('retry_storm');
  });

  it('only counts the gateway’s own errors as upstream errors', async () => {
    // Retry warnings mention acquirer_unavailable, but they are payment-service logs.
    const findings = await runRuleBasedInvestigation(
      incident,
      ledger([p('payment-service', 'gateway call failed, retrying (attempt 1/3): gateway responded 503 acquirer_unavailable', 50)]),
    );
    expect(findings.hypotheses.map((h) => h.category)).not.toContain('upstream_errors');
  });

  it('puts a deploy with new-version exceptions first, ahead of noisier patterns', async () => {
    const findings = await runRuleBasedInvestigation(
      incident,
      ledger(
        [
          p('order-service', 'order payment failed: payment-service responded 500 internal_error', 4000),
          p('payment-service', "unhandled error in POST /payments: Cannot read properties of undefined (reading 'minorUnits')", 300, {
            versions: ['1.5.0'],
            exception: 'TypeError',
          }),
        ],
        [{ service: 'payment-service', version: '1.5.0', deployedAt: '2026-10-11T15:27:30Z' }],
      ),
    );
    expect(findings.hypotheses[0]).toMatchObject({ category: 'deploy_regression', service: 'payment-service' });
  });

  it('ignores a deploy whose service shows no new-version exceptions (red herring)', async () => {
    const findings = await runRuleBasedInvestigation(
      incident,
      ledger(
        [p('payment-service', 'gateway call failed, retrying (attempt 1/3): http://localhost:4003/v1/charges timed out after 2000ms', 800)],
        [{ service: 'order-service', version: '2.1.1', deployedAt: '2026-10-11T15:28:01Z' }],
      ),
    );
    expect(findings.hypotheses[0]).toMatchObject({ category: 'upstream_timeout', service: 'gateway-mock' });
  });
});
