import type { Logger } from '@ai-analyzer/shared';
import { config } from '../config';
import { autoResolve, recordAnomaly } from '../incidents/service';
import { getServiceMetrics, type MinuteMetrics } from '../metrics/metrics';
import { detectSeries, RULES, type MetricName, type SeriesPoint } from './ewma';

/** Windows with fewer requests than this are too noisy to judge error rate or latency. */
const MIN_REQUESTS = 10;
/** Baseline history the detector reads every tick. */
const HISTORY_MINUTES = 40;
/** Only anomalies this recent can open or extend an incident (old history is context only). */
const ACT_ON_LAST_MINUTES = 5;
/** Time allowed for late logs before a minute counts as complete. */
const SETTLE_MS = 15_000;

function series(windows: MinuteMetrics[], metric: MetricName): SeriesPoint[] {
  return windows.map((w) => {
    let value: number | null;
    if (metric === 'error_rate') value = w.requests >= MIN_REQUESTS ? w.errorRate : null;
    else if (metric === 'latency_p95') value = w.requests >= MIN_REQUESTS ? w.latencyP95 : null;
    else value = w.heapUsedMb;
    return { windowStart: w.windowStart, value };
  });
}

/** End of the newest minute whose logs have settled. */
export function lastCompleteWindowEnd(now: number): Date {
  return new Date(Math.floor((now - SETTLE_MS) / 60_000) * 60_000);
}

/**
 * One detector pass. It is stateless: every tick re-reads the last 40 complete minutes, rebuilds
 * each baseline, and records anomalies idempotently, so a restart loses nothing.
 */
export async function detectOnce(logger: Logger, now = Date.now()): Promise<{ anomalies: number; resolved: number }> {
  const end = lastCompleteWindowEnd(now);
  const from = new Date(end.getTime() - HISTORY_MINUTES * 60_000);
  const actAfter = end.getTime() - ACT_ON_LAST_MINUTES * 60_000;

  const services = await getServiceMetrics({ from: from.toISOString(), to: end.toISOString() });
  let anomalies = 0;
  for (const { service, windows } of services) {
    for (const metric of Object.keys(RULES) as MetricName[]) {
      for (const d of detectSeries(series(windows, metric), RULES[metric])) {
        if (new Date(d.windowStart).getTime() < actAfter) continue;
        const incident = await recordAnomaly({ ...d, service }, logger);
        if (incident) {
          anomalies++;
          logger.warn(`anomaly: ${metric}=${d.value} on ${service} (baseline ${d.baseline}, z=${d.zScore})`, {
            'anomaly.service': service,
            'anomaly.metric': metric,
            'incident.number': incident.number,
          });
        }
      }
    }
  }
  const resolved = await autoResolve(end, logger);
  return { anomalies, resolved };
}

export function startDetector(logger: Logger): () => void {
  let running = false;
  const tick = async () => {
    if (running) return; // a slow pass must not overlap the next
    running = true;
    try {
      await detectOnce(logger);
    } catch (err) {
      logger.error(`detector pass failed: ${(err as Error).message}`);
    } finally {
      running = false;
    }
  };
  void tick();
  const timer = setInterval(() => void tick(), config.detectIntervalMs);
  return () => clearInterval(timer);
}
