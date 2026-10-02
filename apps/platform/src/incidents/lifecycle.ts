import type { IncidentSeverity, IncidentStatus } from '@prisma/client';
import type { MetricName } from '../detection/ewma';

/**
 * Incident lifecycle: detected -> investigating -> identified -> resolved.
 * The AI investigator moves an incident to investigating, then identified. A person can
 * resolve at any point. Resolved is final: a recurrence opens a new incident.
 */
const TRANSITIONS: Record<IncidentStatus, IncidentStatus[]> = {
  detected: ['investigating', 'identified', 'resolved'],
  investigating: ['identified', 'resolved'],
  identified: ['investigating', 'resolved'],
  resolved: [],
};

export function canTransition(from: IncidentStatus, to: IncidentStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export const OPEN_STATUSES: IncidentStatus[] = ['detected', 'investigating', 'identified'];

/** An anomaly joins an open incident whose last anomaly is at most this old. */
export const GROUPING_WINDOW_MS = 10 * 60_000;

/** An open incident resolves itself after this long with no new anomaly. */
export const AUTO_RESOLVE_AFTER_MS = 5 * 60_000;

const METRIC_LABEL: Record<MetricName, string> = {
  error_rate: 'Error rate',
  latency_p95: 'p95 latency',
  heap_used: 'Heap usage',
};

export function formatMetric(metric: MetricName, value: number): string {
  if (metric === 'error_rate') return `${(value * 100).toFixed(1)}%`;
  if (metric === 'latency_p95') return `${Math.round(value)} ms`;
  return `${Math.round(value)} MB`;
}

export function anomalyTitle(service: string, metric: MetricName, value: number, baseline: number): string {
  return `${METRIC_LABEL[metric]} ${formatMetric(metric, value)} on ${service} (baseline ${formatMetric(metric, baseline)})`;
}

/** Critical when errors are widespread or more than one service is affected. */
export function severityFor(
  current: IncidentSeverity | null,
  metric: MetricName,
  value: number,
  serviceCount: number,
): IncidentSeverity {
  if (current === 'critical') return 'critical';
  if (serviceCount >= 2) return 'critical';
  if (metric === 'error_rate' && value >= 0.2) return 'critical';
  return 'warning';
}
