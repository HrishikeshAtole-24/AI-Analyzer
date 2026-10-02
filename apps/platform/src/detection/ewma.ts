/**
 * Anomaly detection on 1-minute metric series with an exponentially weighted moving average
 * (EWMA) baseline and a z-score test. Pure functions, no I/O, so they are easy to unit test.
 *
 * For each point after a warm-up, the point is anomalous when
 *   z = (value - baseline) / std  >= Z_THRESHOLD   and   value - baseline >= minDelta
 * The second rule stops tiny absolute changes on a very flat baseline (0% to 1% errors) from firing.
 * Anomalous points do not update the baseline, so a sustained failure keeps firing instead of
 * becoming the new normal.
 */

export type MetricName = 'error_rate' | 'latency_p95' | 'heap_used';

export interface SeriesPoint {
  windowStart: string;
  /** null when the window has too little data to judge (it is skipped). */
  value: number | null;
}

export interface MetricRule {
  metric: MetricName;
  /** Lower bound on the standard deviation, given the baseline. Avoids division by ~0. */
  minStd: (baseline: number) => number;
  /** Smallest increase over the baseline that can count as an anomaly. */
  minDelta: (baseline: number) => number;
}

export interface Detection {
  metric: MetricName;
  windowStart: string;
  value: number;
  baseline: number;
  std: number;
  zScore: number;
}

export interface EwmaOptions {
  alpha: number;
  zThreshold: number;
  /** Valid points needed before anything can be flagged. */
  warmup: number;
}

export const DEFAULT_EWMA: EwmaOptions = { alpha: 0.3, zThreshold: 3, warmup: 5 };

export const RULES: Record<MetricName, MetricRule> = {
  error_rate: {
    metric: 'error_rate',
    minStd: () => 0.02,
    minDelta: () => 0.05,
  },
  latency_p95: {
    metric: 'latency_p95',
    minStd: (b) => Math.max(20, 0.15 * b),
    minDelta: (b) => Math.max(100, 0.5 * b),
  },
  heap_used: {
    metric: 'heap_used',
    minStd: (b) => Math.max(5, 0.05 * b),
    minDelta: (b) => Math.max(64, 0.3 * b),
  },
};

export function detectSeries(points: SeriesPoint[], rule: MetricRule, opts: EwmaOptions = DEFAULT_EWMA): Detection[] {
  const detections: Detection[] = [];
  let mean: number | null = null;
  let variance = 0;
  let n = 0;

  for (const point of points) {
    const v = point.value;
    if (v === null) continue;
    if (mean === null) {
      mean = v;
      n = 1;
      continue;
    }
    if (n >= opts.warmup) {
      const std = Math.max(Math.sqrt(variance), rule.minStd(mean));
      const z = (v - mean) / std;
      if (z >= opts.zThreshold && v - mean >= rule.minDelta(mean)) {
        detections.push({
          metric: rule.metric,
          windowStart: point.windowStart,
          value: v,
          baseline: round(mean),
          std: round(std),
          zScore: round(z),
        });
        continue; // keep the baseline clean
      }
    }
    // Incremental EWMA mean and variance (West, 1979).
    const diff = v - mean;
    const incr = opts.alpha * diff;
    mean += incr;
    variance = (1 - opts.alpha) * (variance + diff * incr);
    n++;
  }
  return detections;
}

function round(v: number): number {
  return Math.round(v * 10_000) / 10_000;
}
