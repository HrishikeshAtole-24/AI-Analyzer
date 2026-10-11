import { SEVERITIES } from '@ai-analyzer/shared';
import type Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { db } from '../clients/db';
import type { LogDocument } from '../logs/document';
import { getTrace, searchLogs } from '../logs/search';
import { getServiceMetrics } from '../metrics/metrics';
import { findSimilarIncidents, searchRunbooks } from '../knowledge/knowledge';

/**
 * The investigator's tools. Every call is recorded in an EvidenceLedger with its exact, resolved
 * parameters (absolute times only), so the verifier can run the same query again later and
 * check what the investigator claimed about it.
 */

const iso = z.iso.datetime({ offset: true });
const MAX_WINDOW_MS = 6 * 60 * 60_000;

const window = z
  .object({ from: iso, to: iso })
  .refine((w) => Date.parse(w.to) > Date.parse(w.from), 'to must be after from')
  .refine((w) => Date.parse(w.to) - Date.parse(w.from) <= MAX_WINDOW_MS, 'window must be 6 hours or less');

export const toolInputs = {
  search_logs: z
    .object({
      from: iso,
      to: iso,
      service: z.string().max(100).optional(),
      level: z.enum(SEVERITIES).optional(),
      q: z.string().max(300).optional(),
      trace_id: z.string().regex(/^[0-9a-f]{32}$/).optional(),
      attr: z.array(z.string().max(200)).max(5).optional(),
      limit: z.number().int().min(1).max(50).default(20),
    })
    .and(window),
  summarize_errors: z.object({ from: iso, to: iso, service: z.string().max(100).optional() }).and(window),
  get_metrics: z.object({ from: iso, to: iso, service: z.string().max(100).optional() }).and(window),
  get_recent_deploys: z.object({ since: iso, service: z.string().max(100).optional() }),
  get_trace: z.object({ trace_id: z.string().regex(/^[0-9a-f]{32}$/) }),
  search_runbooks: z.object({ query: z.string().min(3).max(500) }),
  find_similar_incidents: z.object({ query: z.string().min(3).max(500) }),
} as const;
export type ToolName = keyof typeof toolInputs;
export const TOOL_NAMES = Object.keys(toolInputs) as ToolName[];

const timeProps = {
  from: { type: 'string', description: 'ISO 8601 start, e.g. 2026-10-02T19:30:00.000Z' },
  to: { type: 'string', description: 'ISO 8601 end (exclusive)' },
};

export const TOOL_DEFINITIONS: Anthropic.Tool[] = [
  {
    name: 'search_logs',
    description:
      'Search log records, newest first. Returns the total match count and up to `limit` records ' +
      '(time, service, version, severity, message, HTTP status, duration, exception type, trace id, attributes). ' +
      'Use level=ERROR for errors only (level is a minimum). `q` is full-text on the message (all words must match). ' +
      '`attr` filters attributes exactly, as "key:value" (e.g. "http.route:/payments").',
    input_schema: {
      type: 'object',
      properties: {
        ...timeProps,
        service: { type: 'string' },
        level: { type: 'string', enum: [...SEVERITIES] },
        q: { type: 'string' },
        trace_id: { type: 'string' },
        attr: { type: 'array', items: { type: 'string' } },
        limit: { type: 'integer', minimum: 1, maximum: 50 },
      },
      required: ['from', 'to'],
    },
  },
  {
    name: 'summarize_errors',
    description:
      'Group WARN/ERROR/FATAL logs in a window by service and message pattern (numbers and ids masked). ' +
      'Returns each pattern with its count, an example message, versions and first/last time. Start here.',
    input_schema: { type: 'object', properties: { ...timeProps, service: { type: 'string' } }, required: ['from', 'to'] },
  },
  {
    name: 'get_metrics',
    description:
      'Per-service, per-minute metrics derived from request logs: requests, errors (5xx), errorRate, ' +
      'latencyP50/P95/P99 (ms) and peak heapUsedMb. Compare windows before and after the incident started.',
    input_schema: { type: 'object', properties: { ...timeProps, service: { type: 'string' } }, required: ['from', 'to'] },
  },
  {
    name: 'get_recent_deploys',
    description: 'Deploys recorded since a time, newest first: service, version, time, description.',
    input_schema: {
      type: 'object',
      properties: { since: { type: 'string', description: 'ISO 8601' }, service: { type: 'string' } },
      required: ['since'],
    },
  },
  {
    name: 'get_trace',
    description: 'Every log of one request across all services, oldest first. Use a trace_id from search_logs.',
    input_schema: { type: 'object', properties: { trace_id: { type: 'string' } }, required: ['trace_id'] },
  },
  {
    name: 'search_runbooks',
    description:
      "Search the team's runbooks by symptoms (e.g. an error message). Returns the closest runbooks with their steps. " +
      'Use once you have a lead, to check the symptoms match and to pick recommended actions.',
    input_schema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
  },
  {
    name: 'find_similar_incidents',
    description: 'Search past incidents by symptoms. Returns their conclusions (category, service). A past cause is a lead, not proof.',
    input_schema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
  },
];

// --- Results ---------------------------------------------------------------------------------

/** What a check can be evaluated against: the fields the verifier needs, for any tool. */
export interface ToolResult {
  /** Sent to the model (compact). */
  forModel: unknown;
  /** search_logs: total matches. summarize_errors: total WARN+ logs. */
  count?: number;
  /** Text a log_text_present check searches (messages, exception types, attributes). */
  texts?: string[];
  /** get_metrics: windows per service. */
  metrics?: Record<string, { windowStart: string; errorRate: number | null; latencyP95: number | null; heapUsedMb: number | null; requests: number }[]>;
  /** get_recent_deploys. */
  deploys?: { service: string; version: string; deployedAt: string }[];
}

function compactLog(l: LogDocument) {
  const extra: Record<string, string> = {};
  for (const [k, v] of Object.entries(l.attributes)) {
    if (!['http.request.method', 'http.route', 'url.path', 'http.response.status_code', 'duration_ms'].includes(k)) {
      extra[k] = v.length > 200 ? `${v.slice(0, 200)}...` : v;
    }
  }
  return {
    time: l['@timestamp'],
    service: l.service,
    version: l.serviceVersion,
    level: l.severityText,
    message: l.body.length > 500 ? `${l.body.slice(0, 500)}...` : l.body,
    ...(l.http?.statusCode ? { status: l.http.statusCode } : {}),
    ...(l.durationMs !== undefined ? { durationMs: l.durationMs } : {}),
    ...(l.exceptionType ? { exception: l.exceptionType } : {}),
    ...(l.traceId ? { traceId: l.traceId } : {}),
    ...(Object.keys(extra).length ? { attributes: extra } : {}),
  };
}

function logTexts(logs: LogDocument[]): string[] {
  return logs.flatMap((l) => [l.body, l.exceptionType ?? '', ...Object.values(l.attributes)]).filter(Boolean);
}

/** Masks the variable parts of a message so identical failures group together. */
export function fingerprint(message: string): string {
  return message
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '<id>')
    .replace(/\b(ord|pay|ch|cus)_[0-9a-z-]+/gi, '$1_<id>')
    .replace(/\d+(\.\d+)?/g, '#')
    .slice(0, 300);
}

interface RunContext {
  incidentId?: string;
}

async function run(tool: ToolName, input: unknown, ctx: RunContext): Promise<ToolResult> {
  switch (tool) {
    case 'search_logs': {
      const p = toolInputs.search_logs.parse(input);
      const page = await searchLogs({
        from: p.from,
        to: p.to,
        service: p.service,
        level: p.level,
        q: p.q,
        traceId: p.trace_id,
        attr: p.attr,
        limit: p.limit,
      });
      return {
        forModel: { total: page.total, returned: page.logs.length, logs: page.logs.map(compactLog) },
        count: page.total,
        texts: logTexts(page.logs),
      };
    }
    case 'summarize_errors': {
      const p = toolInputs.summarize_errors.parse(input);
      const page = await searchLogs({ from: p.from, to: p.to, service: p.service, level: 'WARN', limit: 500 });
      // searchLogs caps at 500 per page; walk a few pages so counts are meaningful.
      const logs = [...page.logs];
      let cursor = page.nextCursor;
      for (let i = 0; i < 5 && cursor; i++) {
        const next = await searchLogs({ from: p.from, to: p.to, service: p.service, level: 'WARN', limit: 500, cursor });
        logs.push(...next.logs);
        cursor = next.nextCursor;
      }
      const groups = new Map<string, { service: string; pattern: string; count: number; example: string; level: string; versions: Set<string>; exception?: string; first: string; last: string }>();
      for (const l of logs) {
        const pattern = fingerprint(l.body);
        const key = `${l.service}|${pattern}`;
        const g = groups.get(key);
        if (g) {
          g.count++;
          g.versions.add(l.serviceVersion);
          if (l['@timestamp'] < g.first) g.first = l['@timestamp'];
          if (l['@timestamp'] > g.last) g.last = l['@timestamp'];
        } else {
          groups.set(key, {
            service: l.service,
            pattern,
            count: 1,
            example: l.body.slice(0, 400),
            level: l.severityText,
            versions: new Set([l.serviceVersion]),
            exception: l.exceptionType,
            first: l['@timestamp'],
            last: l['@timestamp'],
          });
        }
      }
      const top = [...groups.values()].sort((a, b) => b.count - a.count).slice(0, 25);
      return {
        forModel: {
          totalWarnOrWorse: page.total,
          sampled: logs.length,
          patterns: top.map((g) => ({ ...g, versions: [...g.versions] })),
        },
        count: page.total,
        texts: [...top.map((g) => g.example), ...top.map((g) => g.exception ?? '')].filter(Boolean),
      };
    }
    case 'get_metrics': {
      const p = toolInputs.get_metrics.parse(input);
      const services = await getServiceMetrics({ from: p.from, to: p.to, services: p.service ? [p.service] : undefined });
      const metrics: NonNullable<ToolResult['metrics']> = {};
      for (const s of services) {
        metrics[s.service] = s.windows.map((w) => ({
          windowStart: w.windowStart,
          requests: w.requests,
          errorRate: w.errorRate,
          latencyP95: w.latencyP95,
          heapUsedMb: w.heapUsedMb,
        }));
      }
      return { forModel: { services: metrics }, metrics };
    }
    case 'get_recent_deploys': {
      const p = toolInputs.get_recent_deploys.parse(input);
      const deploys = await db.deploy.findMany({
        where: { deployedAt: { gte: new Date(p.since) }, ...(p.service ? { service: p.service } : {}) },
        orderBy: { deployedAt: 'desc' },
        take: 50,
      });
      const rows = deploys.map((d) => ({
        service: d.service,
        version: d.version,
        deployedAt: d.deployedAt.toISOString(),
        description: d.description,
        commitSha: d.commitSha,
      }));
      return { forModel: { deploys: rows }, deploys: rows };
    }
    case 'get_trace': {
      const p = toolInputs.get_trace.parse(input);
      const trace = await getTrace(p.trace_id);
      return {
        forModel: { ...trace, logs: trace.logs.map(compactLog) },
        count: trace.logCount,
        texts: logTexts(trace.logs),
      };
    }
    case 'search_runbooks': {
      const p = toolInputs.search_runbooks.parse(input);
      const hits = await searchRunbooks(p.query, 3);
      return {
        forModel: { runbooks: hits.map((h) => ({ slug: h.slug, title: h.title, similarity: h.similarity, body: h.body })) },
        texts: hits.flatMap((h) => [h.title, h.body]),
      };
    }
    case 'find_similar_incidents': {
      const p = toolInputs.find_similar_incidents.parse(input);
      const hits = await findSimilarIncidents(p.query, ctx.incidentId ?? null, 3);
      return { forModel: { incidents: hits }, texts: hits.map((h) => h.text) };
    }
  }
}

export interface LedgerEntry {
  id: string;
  tool: ToolName;
  input: unknown;
  at: string;
  ok: boolean;
  error?: string;
}

/**
 * Records every tool call. The investigator only ever sees results through the ledger, and the
 * verifier re-runs ledger entries, so a claim can only be backed by a query that really ran.
 */
export class EvidenceLedger {
  private readonly entries: LedgerEntry[] = [];
  private readonly inputs = new Map<string, { tool: ToolName; input: unknown }>();

  constructor(private readonly ctx: RunContext = {}) {}

  async call(tool: string, rawInput: unknown): Promise<{ id: string; ok: boolean; content: string; result?: ToolResult }> {
    const id = `q${this.entries.length + 1}`;
    const at = new Date().toISOString();
    if (!(TOOL_NAMES as string[]).includes(tool)) {
      this.entries.push({ id, tool: tool as ToolName, input: rawInput, at, ok: false, error: 'unknown tool' });
      return { id, ok: false, content: JSON.stringify({ query_id: id, error: `unknown tool ${tool}` }) };
    }
    const name = tool as ToolName;
    const parsed = toolInputs[name].safeParse(rawInput);
    if (!parsed.success) {
      const error = z.prettifyError(parsed.error);
      this.entries.push({ id, tool: name, input: rawInput, at, ok: false, error });
      return { id, ok: false, content: JSON.stringify({ query_id: id, error: `invalid input: ${error}` }) };
    }
    try {
      const result = await run(name, parsed.data, this.ctx);
      this.entries.push({ id, tool: name, input: parsed.data, at, ok: true });
      this.inputs.set(id, { tool: name, input: parsed.data });
      return { id, ok: true, content: JSON.stringify({ query_id: id, ...(result.forModel as object) }), result };
    } catch (err) {
      const error = (err as Error).message;
      this.entries.push({ id, tool: name, input: parsed.data, at, ok: false, error });
      return { id, ok: false, content: JSON.stringify({ query_id: id, error }) };
    }
  }

  /** Runs a recorded query again with exactly the same parameters. */
  async rerun(id: string): Promise<{ tool: ToolName; result: ToolResult } | null> {
    const recorded = this.inputs.get(id);
    if (!recorded) return null;
    return { tool: recorded.tool, result: await run(recorded.tool, recorded.input, this.ctx) };
  }

  list(): LedgerEntry[] {
    return [...this.entries];
  }
}
