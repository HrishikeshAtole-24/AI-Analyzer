export function formatTime(iso: string | null | undefined): string {
  if (!iso) return '-';
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '-';
  const d = new Date(iso);
  return `${d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })} ${formatTime(iso)}`;
}

export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return '-';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m} min ${s % 60} s` : `${Math.floor(m / 60)} h ${m % 60} min`;
}

export function formatPercent(v: number | null | undefined, digits = 1): string {
  return v === null || v === undefined ? '-' : `${(v * 100).toFixed(digits)}%`;
}

export function metricLabel(metric: string): string {
  return { error_rate: 'Error rate', latency_p95: 'p95 latency', heap_used: 'Heap used' }[metric] ?? metric;
}

export function formatMetricValue(metric: string, v: number): string {
  if (metric === 'error_rate') return formatPercent(v);
  if (metric === 'latency_p95') return `${Math.round(v)} ms`;
  return `${Math.round(v)} MB`;
}

export function categoryLabel(category: string): string {
  return category.replace(/_/g, ' ');
}
