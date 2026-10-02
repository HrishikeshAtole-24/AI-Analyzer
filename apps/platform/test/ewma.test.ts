import { describe, expect, it } from 'vitest';
import { detectSeries, RULES, type SeriesPoint } from '../src/detection/ewma';

const minute = (i: number) => new Date(Date.UTC(2026, 9, 5, 10, i)).toISOString();
const seriesOf = (values: (number | null)[]): SeriesPoint[] => values.map((value, i) => ({ windowStart: minute(i), value }));

describe('detectSeries', () => {
  it('flags an error-rate spike after a steady baseline', () => {
    const points = seriesOf([0, 0.01, 0, 0.01, 0, 0.01, 0, 0.35]);
    const found = detectSeries(points, RULES.error_rate);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ metric: 'error_rate', windowStart: minute(7), value: 0.35 });
    expect(found[0]!.zScore).toBeGreaterThan(3);
  });

  it('does not flag before the warm-up is complete', () => {
    expect(detectSeries(seriesOf([0, 0, 0.5]), RULES.error_rate)).toEqual([]);
  });

  it('ignores small absolute changes on a flat baseline', () => {
    // 0% -> 3% is many standard deviations on a flat line, but under the 5-point minimum delta.
    expect(detectSeries(seriesOf([0, 0, 0, 0, 0, 0, 0.03]), RULES.error_rate)).toEqual([]);
  });

  it('keeps flagging a sustained failure instead of learning it as normal', () => {
    const found = detectSeries(seriesOf([0, 0, 0, 0, 0, 0, 0.4, 0.42, 0.38, 0.41]), RULES.error_rate);
    expect(found.map((d) => d.windowStart)).toEqual([minute(6), minute(7), minute(8), minute(9)]);
  });

  it('stops flagging once the metric is back to baseline', () => {
    const found = detectSeries(seriesOf([0, 0, 0, 0, 0, 0, 0.4, 0.4, 0, 0, 0]), RULES.error_rate);
    expect(found).toHaveLength(2);
  });

  it('skips windows with no data', () => {
    const found = detectSeries(seriesOf([0, null, 0, 0, null, 0, 0, 0.5]), RULES.error_rate);
    expect(found).toHaveLength(1);
  });

  it('flags latency only for a large relative jump', () => {
    const base = [200, 210, 190, 205, 195, 200];
    expect(detectSeries(seriesOf([...base, 260]), RULES.latency_p95)).toEqual([]);
    expect(detectSeries(seriesOf([...base, 2100]), RULES.latency_p95)).toHaveLength(1);
  });

  it('flags heap growth', () => {
    const found = detectSeries(seriesOf([30, 32, 31, 30, 33, 31, 180]), RULES.heap_used);
    expect(found).toHaveLength(1);
    expect(found[0]!.baseline).toBeLessThan(35);
  });
});
