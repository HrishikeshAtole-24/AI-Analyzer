'use client';

import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import styles from './MetricChart.module.css';

export interface Point {
  t: string;
  v: number | null;
}

interface Props {
  title: string;
  data: Point[];
  unit: 'percent' | 'ms' | 'mb' | 'count';
  /** Draws a vertical marker, e.g. the incident start. */
  marker?: { t: string; label: string };
  height?: number;
}

function fmt(unit: Props['unit'], v: number): string {
  if (unit === 'percent') return `${(v * 100).toFixed(v < 0.1 ? 1 : 0)}%`;
  if (unit === 'ms') return v >= 1000 ? `${(v / 1000).toFixed(1)} s` : `${Math.round(v)} ms`;
  if (unit === 'count') return Math.round(v).toLocaleString();
  return `${Math.round(v)} MB`;
}

/** Smallest y-axis top per unit, so a flat zero line does not get an absurd scale (e.g. 0 to 400%). */
const MIN_TOP: Record<Props['unit'], number> = { percent: 0.05, ms: 100, mb: 50, count: 10 };

/** Rounds an axis top up to 1, 1.5, 2, 2.5, 3, 4, 5, 6, 8 or 10 x a power of ten, so ticks land on round values. */
export function niceMax(x: number): number {
  if (x <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(x));
  const step = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].find((s) => s * p >= x) ?? 10;
  return step * p;
}

const time = (t: string) => new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

/**
 * One series per chart (no legend needed: the title names it). Thin 2px line, recessive grid,
 * crosshair tooltip. Different measures go in separate charts, never on a second y-axis.
 */
export function MetricChart({ title, data: raw, unit, marker, height = 160 }: Props) {
  // The current minute is still filling up; plotting it draws a false dip at the end.
  const currentMinute = Math.floor(Date.now() / 60_000) * 60_000;
  const data = raw.filter((d) => Date.parse(d.t) < currentMinute);
  const hasData = data.some((d) => d.v !== null);
  const latest = [...data].reverse().find((d) => d.v !== null);
  return (
    <figure className={styles.figure}>
      <figcaption className={styles.caption}>
        <span>{title}</span>
        <span className={styles.latest}>{latest?.v !== null && latest ? fmt(unit, latest.v!) : '-'}</span>
      </figcaption>
      {hasData ? (
        <div style={{ height }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid stroke="var(--grid)" strokeWidth={1} vertical={false} />
              <XAxis
                dataKey="t"
                tickFormatter={time}
                tick={{ fill: 'var(--ink-muted)', fontSize: 11 }}
                axisLine={{ stroke: 'var(--axis)' }}
                tickLine={false}
                minTickGap={40}
              />
              <YAxis
                tickFormatter={(v: number) => fmt(unit, v)}
                tick={{ fill: 'var(--ink-muted)', fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                width={52}
                domain={[0, (dataMax: number) => niceMax(Math.max(dataMax * 1.05, MIN_TOP[unit]))]}
                tickCount={5}
              />
              {marker && (
                <ReferenceLine
                  x={marker.t}
                  stroke="var(--mark-incident)"
                  strokeDasharray="4 3"
                  label={{ value: marker.label, position: 'insideTopLeft', fill: 'var(--ink-2)', fontSize: 11 }}
                />
              )}
              <Tooltip
                cursor={{ stroke: 'var(--axis)', strokeWidth: 1 }}
                content={({ active, payload, label }) =>
                  active && payload?.length ? (
                    <div className={styles.tooltip}>
                      <strong>{payload[0]!.value === null ? '-' : fmt(unit, Number(payload[0]!.value))}</strong>
                      <span>{time(String(label))}</span>
                    </div>
                  ) : null
                }
              />
              <Line
                type="monotone"
                dataKey="v"
                stroke="var(--series-1)"
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4, stroke: 'var(--surface)', strokeWidth: 2 }}
                connectNulls={false}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div className={styles.empty} style={{ height }}>
          No data in this window
        </div>
      )}
    </figure>
  );
}
