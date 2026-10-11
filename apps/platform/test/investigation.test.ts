import type Anthropic from '@anthropic-ai/sdk';
import type { Logger } from '@ai-analyzer/shared';
import { describe, expect, it } from 'vitest';
import { CircuitBreaker } from '../src/investigation/circuit-breaker';
import type { Check, Findings } from '../src/investigation/findings';
import { AgentError, runLlmInvestigation, type CreateMessage } from '../src/investigation/llm-agent';
import { fingerprint, type EvidenceLedger, type ToolResult } from '../src/investigation/tools';
import { evaluateCheck, verifyFindings } from '../src/investigation/verifier';

const noop = () => undefined;
const logger: Logger = { trace: noop, debug: noop, info: noop, warn: noop, error: noop, fatal: noop, setServiceVersion: noop, flush: async () => undefined };

const check = (c: Partial<Check> & Pick<Check, 'kind'>): Check => ({ text: null, service: null, metric: null, op: null, value: null, version: null, ...c });

const logsResult: ToolResult = {
  forModel: {},
  count: 412,
  texts: ["unhandled error in POST /payments: Cannot read properties of undefined (reading 'minorUnits')", 'TypeError'],
};
const metricsResult: ToolResult = {
  forModel: {},
  metrics: {
    'payment-service': [
      { windowStart: '2026-10-02T19:39:00.000Z', requests: 440, errorRate: 0, latencyP95: 150, heapUsedMb: 40 },
      { windowStart: '2026-10-02T19:40:00.000Z', requests: 438, errorRate: 0.41, latencyP95: 140, heapUsedMb: 41 },
    ],
  },
};
const deploysResult: ToolResult = { forModel: {}, deploys: [{ service: 'payment-service', version: '1.5.0', deployedAt: '2026-10-02T19:40:05.000Z' }] };

describe('evaluateCheck', () => {
  it('checks counts', () => {
    expect(evaluateCheck(check({ kind: 'log_count_at_least', value: 400 }), logsResult).ok).toBe(true);
    expect(evaluateCheck(check({ kind: 'log_count_at_least', value: 5000 }), logsResult).ok).toBe(false);
  });

  it('checks text case-insensitively', () => {
    expect(evaluateCheck(check({ kind: 'log_text_present', text: 'typeerror' }), logsResult).ok).toBe(true);
    expect(evaluateCheck(check({ kind: 'log_text_present', text: 'connection pool' }), logsResult).ok).toBe(false);
  });

  it('checks metric thresholds in any window', () => {
    const above = check({ kind: 'metric_threshold', service: 'payment-service', metric: 'errorRate', op: 'above', value: 0.3 });
    expect(evaluateCheck(above, metricsResult)).toMatchObject({ ok: true });
    expect(evaluateCheck({ ...above, value: 0.5 }, metricsResult).ok).toBe(false);
    expect(evaluateCheck({ ...above, service: 'order-service' }, metricsResult).ok).toBe(false);
  });

  it('checks deploys', () => {
    expect(evaluateCheck(check({ kind: 'deploy_present', service: 'payment-service', version: '1.5.0' }), deploysResult).ok).toBe(true);
    expect(evaluateCheck(check({ kind: 'deploy_present', service: 'payment-service', version: '9.9.9' }), deploysResult).ok).toBe(false);
  });

  it('rejects a check that does not fit the cited query', () => {
    expect(evaluateCheck(check({ kind: 'deploy_present', service: 'x', version: '1' }), logsResult).ok).toBe(false);
  });
});

/** A ledger whose queries return fixed results, so verification needs no OpenSearch. */
function fakeLedger(results: Record<string, ToolResult>): EvidenceLedger {
  return {
    rerun: async (id: string) =>
      results[id] ? { tool: id === 'q7' ? 'search_runbooks' : 'search_logs', result: results[id]! } : null,
  } as unknown as EvidenceLedger;
}

const findings: Findings = {
  summary: 'payment-service 1.5.0 broke EUR and INR payments.',
  hypotheses: [
    {
      rank: 1,
      title: 'Bad deploy',
      category: 'deploy_regression',
      service: 'payment-service',
      description: 'd',
      likelihood: 'high',
      supporting: [
        { claim: '1.5.0 deployed', query_id: 'q2', check: check({ kind: 'deploy_present', service: 'payment-service', version: '1.5.0' }) },
        { claim: 'TypeErrors', query_id: 'q1', check: check({ kind: 'log_text_present', text: 'TypeError' }) },
        { claim: 'invented', query_id: 'q9', check: check({ kind: 'log_count_at_least', value: 1 }) },
      ],
      contradicting: [],
      recommended_actions: ['roll back'],
    },
    {
      rank: 2,
      title: 'Pool exhaustion',
      category: 'db_pool_exhaustion',
      service: 'payment-service',
      description: 'd',
      likelihood: 'medium',
      supporting: [{ claim: 'pool timeouts', query_id: 'q1', check: check({ kind: 'log_text_present', text: 'acquiring connection' }) }],
      contradicting: [],
      recommended_actions: [],
    },
  ],
};

describe('verifyFindings', () => {
  it('keeps verified claims, drops invented ones and unsupported hypotheses', async () => {
    const result = await verifyFindings(findings, fakeLedger({ q1: logsResult, q2: deploysResult }));
    expect(result.hypotheses).toHaveLength(1);
    expect(result.hypotheses[0]!.supporting.map((e) => e.claim)).toEqual(['1.5.0 deployed', 'TypeErrors']);
    expect(result.claimsTotal).toBe(4);
    expect(result.claimsRejected).toBe(2);
    expect(result.rejected.map((r) => r.reason)).toContain('cited query did not run or failed on re-run');
  });

  it('never accepts a runbook as evidence', async () => {
    const viaRunbook: Findings = {
      ...findings,
      hypotheses: [{ ...findings.hypotheses[1]!, supporting: [{ claim: 'runbook says pools leak', query_id: 'q7', check: check({ kind: 'log_text_present', text: 'TypeError' }) }] }],
    };
    const result = await verifyFindings(viaRunbook, fakeLedger({ q7: logsResult }));
    expect(result.hypotheses).toHaveLength(0);
    expect(result.rejected[0]!.reason).toContain('not evidence');
  });

  it('ranks a hypothesis with verified contradicting evidence lower', async () => {
    const twoGood: Findings = {
      ...findings,
      hypotheses: [
        { ...findings.hypotheses[0]!, contradicting: [{ claim: 'c', query_id: 'q1', check: check({ kind: 'log_text_present', text: 'minorUnits' }) }] },
        { ...findings.hypotheses[1]!, supporting: [{ claim: 's', query_id: 'q1', check: check({ kind: 'log_text_present', text: 'TypeError' }) }] },
      ],
    };
    const result = await verifyFindings(twoGood, fakeLedger({ q1: logsResult, q2: deploysResult }));
    expect(result.hypotheses.map((h) => h.title)).toEqual(['Pool exhaustion', 'Bad deploy']);
    expect(result.hypotheses.map((h) => h.rank)).toEqual([1, 2]);
  });
});

describe('CircuitBreaker', () => {
  it('opens after the threshold, half-opens after the cool-down, closes on success', () => {
    let now = 0;
    const cb = new CircuitBreaker(3, 1000, () => now);
    cb.recordFailure();
    cb.recordFailure();
    expect(cb.state).toBe('closed');
    cb.recordFailure();
    expect(cb.canRequest()).toBe(false);
    now = 1000;
    expect(cb.state).toBe('half_open');
    cb.recordFailure(); // trial call failed
    expect(cb.state).toBe('open');
    now = 2000;
    cb.recordSuccess();
    expect(cb.state).toBe('closed');
  });
});

describe('fingerprint', () => {
  it('masks ids and numbers so the same failure groups together', () => {
    const a = fingerprint('failed to record payment: timeout acquiring connection from pool "payments-db" after 2000ms (active=10/10, waiting=16)');
    const b = fingerprint('failed to record payment: timeout acquiring connection from pool "payments-db" after 2000ms (active=10/10, waiting=3)');
    expect(a).toBe(b);
    expect(fingerprint('order ord_98f27140-e078 failed')).toBe('order ord_<id> failed');
  });
});

// --- The agent loop, against a scripted fake model ---------------------------------------------

const usage = { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };

function message(content: unknown[], stop_reason: string): Anthropic.Beta.BetaMessage {
  return { id: 'm', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content, stop_reason, usage } as unknown as Anthropic.Beta.BetaMessage;
}

function scripted(responses: Anthropic.Beta.BetaMessage[]): { create: CreateMessage; calls: Anthropic.Beta.MessageCreateParamsNonStreaming[] } {
  const calls: Anthropic.Beta.MessageCreateParamsNonStreaming[] = [];
  return {
    calls,
    create: async (params) => {
      calls.push(structuredClone(params));
      const next = responses.shift();
      if (!next) throw new Error('script exhausted');
      return next;
    },
  };
}

const ledgerStub = {
  calls: [] as string[],
  async call(tool: string) {
    this.calls.push(tool);
    return { id: `q${this.calls.length}`, ok: true, content: JSON.stringify({ query_id: `q${this.calls.length}`, total: 412 }) };
  },
};

describe('runLlmInvestigation', () => {
  it('runs tools through the ledger, then returns validated findings', async () => {
    ledgerStub.calls = [];
    const fake = scripted([
      message([{ type: 'tool_use', id: 't1', name: 'summarize_errors', input: { from: 'a', to: 'b' } }, { type: 'tool_use', id: 't2', name: 'get_recent_deploys', input: { since: 'a' } }], 'tool_use'),
      message([{ type: 'tool_use', id: 't3', name: 'submit_findings', input: findings }], 'tool_use'),
    ]);
    const result = await runLlmInvestigation('incident', ledgerStub, logger, Date.now() + 60_000, fake.create);
    expect(ledgerStub.calls).toEqual(['summarize_errors', 'get_recent_deploys']);
    expect(result.findings.hypotheses[0]!.category).toBe('deploy_regression');
    expect(result.turns).toBe(2);
    expect(result.usage.inputTokens).toBe(2000);
    expect(result.usage.costUsd).toBeCloseTo((2000 * 4 + 400 * 20) / 1e6);
    // Both tool results go back in one user message, as tool_result blocks.
    const second = fake.calls[1]!.messages.at(-1)!;
    expect((second.content as { type: string }[]).map((b) => b.type)).toEqual(['tool_result', 'tool_result']);
    expect(fake.calls[0]!.fallbacks).toBe('default');
  });

  it('asks again when submit_findings input is invalid', async () => {
    const fake = scripted([
      message([{ type: 'tool_use', id: 't1', name: 'submit_findings', input: { summary: 'x', hypotheses: [] } }], 'tool_use'),
      message([{ type: 'tool_use', id: 't2', name: 'submit_findings', input: findings }], 'tool_use'),
    ]);
    const result = await runLlmInvestigation('incident', ledgerStub, logger, Date.now() + 60_000, fake.create);
    const retry = fake.calls[1]!.messages.at(-1)!.content as { is_error?: boolean }[];
    expect(retry[0]!.is_error).toBe(true);
    expect(result.turns).toBe(2);
  });

  it('nudges once when the model stops without submitting, then gives up', async () => {
    const fake = scripted([message([{ type: 'text', text: 'done' }], 'end_turn'), message([{ type: 'text', text: 'still done' }], 'end_turn')]);
    await expect(runLlmInvestigation('incident', ledgerStub, logger, Date.now() + 60_000, fake.create)).rejects.toBeInstanceOf(AgentError);
    expect(fake.calls).toHaveLength(2);
  });

  it('stops on a refusal', async () => {
    const fake = scripted([message([], 'refusal')]);
    await expect(runLlmInvestigation('incident', ledgerStub, logger, Date.now() + 60_000, fake.create)).rejects.toThrow('declined');
  });
});
