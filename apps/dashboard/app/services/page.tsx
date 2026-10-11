import { AutoRefresh } from '@/components/AutoRefresh';
import { Empty, ErrorState } from '@/components/ErrorState';
import { MetricChart } from '@/components/MetricChart';
import { platform, PlatformError, type MinuteMetrics, type ServiceSummary } from '@/lib/api';
import { formatPercent, formatTime } from '@/lib/format';
import styles from './services.module.css';

export const dynamic = 'force-dynamic';

export default async function ServicesPage() {
  let services: ServiceSummary[];
  let metrics: { service: string; windows: MinuteMetrics[] }[];
  try {
    [services, metrics] = await Promise.all([
      platform<{ services: ServiceSummary[] }>('/services').then((r) => r.services),
      platform<{ services: { service: string; windows: MinuteMetrics[] }[] }>('/metrics?from=now-30m').then((r) => r.services),
    ]);
  } catch (err) {
    return <ErrorState title="Could not load service health" message={(err as PlatformError).message} />;
  }
  services.sort((a, b) => a.service.localeCompare(b.service));

  return (
    <div className={styles.page}>
      <AutoRefresh seconds={15} />
      <div>
        <h1>Service health</h1>
        <p className={styles.sub}>Last 30 minutes, per minute, computed from each service&apos;s request logs.</p>
      </div>
      {services.length === 0 && <Empty>No service has sent logs in the last 15 minutes.</Empty>}
      {services.map((s) => {
        const windows = metrics.find((m) => m.service === s.service)?.windows ?? [];
        return (
          <section key={s.service} className={styles.card}>
            <div className={styles.head}>
              <h2>{s.service}</h2>
              <dl className={styles.stats}>
                <div>
                  <dt>Version</dt>
                  <dd>{s.version ?? '-'}</dd>
                </div>
                <div>
                  <dt>Requests (15 min)</dt>
                  <dd>{s.requestsLast15m.toLocaleString()}</dd>
                </div>
                <div>
                  <dt>Error rate (15 min)</dt>
                  <dd>{formatPercent(s.errorRateLast15m, 2)}</dd>
                </div>
                <div>
                  <dt>Last log</dt>
                  <dd>{formatTime(s.lastSeen)}</dd>
                </div>
              </dl>
            </div>
            <div className={styles.charts}>
              <MetricChart title="Requests per minute" unit="count" data={windows.map((w) => ({ t: w.windowStart, v: w.requests }))} />
              <MetricChart title="Error rate (5xx)" unit="percent" data={windows.map((w) => ({ t: w.windowStart, v: w.errorRate }))} />
              <MetricChart title="p95 latency" unit="ms" data={windows.map((w) => ({ t: w.windowStart, v: w.latencyP95 }))} />
              <MetricChart title="Heap used (peak)" unit="mb" data={windows.map((w) => ({ t: w.windowStart, v: w.heapUsedMb }))} />
            </div>
          </section>
        );
      })}
    </div>
  );
}
