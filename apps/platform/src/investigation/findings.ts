import { z } from 'zod';

/**
 * The shape every investigation (LLM or rule-based) produces. Each piece of evidence names the
 * tool call it came from (`query_id`) and a machine-checkable `check`. The verifier re-runs that
 * call and applies the check; a claim that fails is dropped. There are no free-form confidence
 * numbers: likelihood is a coarse label, and ranking comes from verified evidence.
 */

export const CATEGORIES = [
  'deploy_regression',
  'db_pool_exhaustion',
  'database_latency',
  'upstream_timeout',
  'upstream_errors',
  'memory_leak',
  'retry_storm',
  'traffic_spike',
  'config_change',
  'unknown',
] as const;
export type Category = (typeof CATEGORIES)[number];

export const CATEGORY_HELP: Record<Category, string> = {
  deploy_regression: 'a release introduced the failure (bug in new code or config shipped with it)',
  db_pool_exhaustion: 'database connections are not returned, the pool drains, callers time out acquiring one',
  database_latency: 'database queries became slow; latency without connection exhaustion',
  upstream_timeout: 'a dependency answers too slowly and callers time out waiting for it',
  upstream_errors: 'a dependency returns errors (5xx, connection resets)',
  memory_leak: 'a process keeps allocating memory it never frees; heap grows steadily',
  retry_storm: 'aggressive retries multiply load on a dependency and amplify a small failure',
  traffic_spike: 'incoming load rose beyond capacity',
  config_change: 'a configuration change outside a code deploy',
  unknown: 'the evidence does not support a specific cause',
};

export const CHECK_KINDS = ['log_count_at_least', 'log_text_present', 'metric_threshold', 'deploy_present'] as const;
export const METRICS = ['errorRate', 'latencyP95', 'heapUsedMb', 'requests'] as const;

export const checkSchema = z.object({
  kind: z.enum(CHECK_KINDS),
  /** log_text_present: text that must appear (case-insensitive) in a returned log. */
  text: z.string().max(300).nullable(),
  /** metric_threshold / deploy_present: which service. */
  service: z.string().max(100).nullable(),
  metric: z.enum(METRICS).nullable(),
  op: z.enum(['above', 'below']).nullable(),
  /** log_count_at_least: minimum count. metric_threshold: the threshold. */
  value: z.number().nullable(),
  /** deploy_present: the version. */
  version: z.string().max(50).nullable(),
});
export type Check = z.infer<typeof checkSchema>;

export const evidenceSchema = z.object({
  claim: z.string().min(1).max(500),
  query_id: z.string().regex(/^q\d+$/),
  check: checkSchema,
});
export type Evidence = z.infer<typeof evidenceSchema>;

export const hypothesisSchema = z.object({
  rank: z.number().int().min(1).max(5),
  title: z.string().min(1).max(200),
  category: z.enum(CATEGORIES),
  /** The service where the cause lives (not just where symptoms show). */
  service: z.string().min(1).max(100),
  description: z.string().min(1).max(2000),
  likelihood: z.enum(['high', 'medium', 'low']),
  supporting: z.array(evidenceSchema).min(1).max(8),
  contradicting: z.array(evidenceSchema).max(5),
  recommended_actions: z.array(z.string().max(300)).max(5),
});
export type Hypothesis = z.infer<typeof hypothesisSchema>;

export const findingsSchema = z.object({
  summary: z.string().min(1).max(1500),
  hypotheses: z.array(hypothesisSchema).min(1).max(5),
});
export type Findings = z.infer<typeof findingsSchema>;

// --- JSON Schema for the submit_findings tool (kept in step with the Zod schemas above) ---

const nullable = (schema: Record<string, unknown>) => ({ anyOf: [schema, { type: 'null' }] });

const checkJson = {
  type: 'object',
  properties: {
    kind: { type: 'string', enum: [...CHECK_KINDS] },
    text: nullable({ type: 'string' }),
    service: nullable({ type: 'string' }),
    metric: nullable({ type: 'string', enum: [...METRICS] }),
    op: nullable({ type: 'string', enum: ['above', 'below'] }),
    value: nullable({ type: 'number' }),
    version: nullable({ type: 'string' }),
  },
  required: ['kind', 'text', 'service', 'metric', 'op', 'value', 'version'],
  additionalProperties: false,
};

const evidenceJson = {
  type: 'object',
  properties: {
    claim: { type: 'string', description: 'One factual sentence, e.g. "payment-service logged 412 TypeErrors after 19:40".' },
    query_id: { type: 'string', description: 'The id of the tool call this comes from, e.g. "q3".' },
    check: checkJson,
  },
  required: ['claim', 'query_id', 'check'],
  additionalProperties: false,
};

export const findingsJsonSchema = {
  type: 'object',
  properties: {
    summary: { type: 'string', description: 'Two or three sentences for the on-call engineer.' },
    hypotheses: {
      type: 'array',
      description: 'Ranked root-cause candidates, most likely first.',
      items: {
        type: 'object',
        properties: {
          rank: { type: 'integer' },
          title: { type: 'string' },
          category: { type: 'string', enum: [...CATEGORIES] },
          service: { type: 'string', description: 'Service where the cause lives.' },
          description: { type: 'string' },
          likelihood: { type: 'string', enum: ['high', 'medium', 'low'] },
          supporting: { type: 'array', items: evidenceJson },
          contradicting: { type: 'array', items: evidenceJson },
          recommended_actions: { type: 'array', items: { type: 'string' } },
        },
        required: [
          'rank',
          'title',
          'category',
          'service',
          'description',
          'likelihood',
          'supporting',
          'contradicting',
          'recommended_actions',
        ],
        additionalProperties: false,
      },
    },
  },
  required: ['summary', 'hypotheses'],
  additionalProperties: false,
} as const;
