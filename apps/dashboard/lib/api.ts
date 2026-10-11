/**
 * Platform API access for server components. Browser code uses the /api/platform proxy
 * (see next.config.ts) instead.
 */

export const PLATFORM_URL = process.env.PLATFORM_URL || 'http://localhost:4000';

export class PlatformError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function platform<T>(path: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${PLATFORM_URL}/api/v1${path}`, { cache: 'no-store', signal: AbortSignal.timeout(10_000) });
  } catch {
    throw new PlatformError(503, `Platform API unreachable at ${PLATFORM_URL}. Start it with npm run dev:platform.`);
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    throw new PlatformError(res.status, body?.error?.message ?? `platform responded ${res.status}`);
  }
  return (await res.json()) as T;
}

// --- Types mirroring the platform API (docs/API.md) ---

export type IncidentStatus = 'detected' | 'investigating' | 'identified' | 'resolved';

export interface Incident {
  id: string;
  number: number;
  title: string;
  status: IncidentStatus;
  severity: 'warning' | 'critical';
  services: string[];
  startedAt: string;
  detectedAt: string;
  lastAnomalyAt: string;
  resolvedAt: string | null;
  summary: string | null;
  anomalyCount?: number;
}

export interface IncidentEvent {
  id: string;
  type: 'anomaly' | 'deploy' | 'status_change' | 'note' | 'investigation';
  message: string;
  at: string;
}

export interface Anomaly {
  id: string;
  service: string;
  metric: string;
  windowStart: string;
  value: number;
  baseline: number;
  zScore: number;
}

export interface Evidence {
  claim: string;
  query_id: string;
  observed: string;
}

export interface Hypothesis {
  rank: number;
  title: string;
  category: string;
  service: string;
  description: string;
  likelihood: 'high' | 'medium' | 'low';
  supporting: Evidence[];
  contradicting: Evidence[];
  recommended_actions: string[];
}

export interface Investigation {
  id: string;
  status: 'running' | 'completed' | 'failed';
  mode: 'llm' | 'rule_based';
  fallbackReason: string | null;
  model: string | null;
  summary: string | null;
  hypotheses: Hypothesis[] | null;
  rejectedClaims: { hypothesis: string; claim: string; query_id: string; reason: string }[] | null;
  toolCalls: { id: string; tool: string; input: unknown; ok: boolean; error?: string }[] | null;
  claimsTotal: number;
  claimsRejected: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
}

export interface IncidentDetail extends Incident {
  events: IncidentEvent[];
  anomalies: Anomaly[];
  investigations: Investigation[];
}

export interface MinuteMetrics {
  windowStart: string;
  requests: number;
  errors: number;
  errorRate: number | null;
  latencyP50: number | null;
  latencyP95: number | null;
  latencyP99: number | null;
  heapUsedMb: number | null;
}

export interface ServiceSummary {
  service: string;
  version: string | null;
  lastSeen: string;
  logsLast15m: number;
  requestsLast15m: number;
  errorRateLast15m: number | null;
}

export interface LogDoc {
  eventId: string;
  '@timestamp': string;
  severityText: string;
  body: string;
  traceId?: string;
  service: string;
  serviceVersion: string;
  http?: { method?: string; route?: string; statusCode?: number };
  durationMs?: number;
  exceptionType?: string;
  attributes: Record<string, string>;
}

export interface TraceView {
  traceId: string;
  services: string[];
  startedAt: string | null;
  endedAt: string | null;
  durationMs: number | null;
  errorCount: number;
  logCount: number;
  logs: LogDoc[];
}
