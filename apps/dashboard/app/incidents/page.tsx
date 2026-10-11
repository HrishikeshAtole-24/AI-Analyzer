import Link from 'next/link';
import { AutoRefresh } from '@/components/AutoRefresh';
import { Pill, SeverityBadge, StatusBadge } from '@/components/Badges';
import { Empty, ErrorState } from '@/components/ErrorState';
import { platform, PlatformError, type Incident } from '@/lib/api';
import { formatDateTime, formatDuration } from '@/lib/format';
import styles from './incidents.module.css';

export const dynamic = 'force-dynamic';

const FILTERS = [
  { value: 'open', label: 'Open' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'all', label: 'All' },
];

export default async function IncidentsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { status = 'all' } = await searchParams;
  let incidents: Incident[];
  try {
    incidents = (await platform<{ incidents: Incident[] }>(`/incidents?status=${encodeURIComponent(status)}&limit=50`)).incidents;
  } catch (err) {
    return <ErrorState title="Could not load incidents" message={(err as PlatformError).message} />;
  }
  const open = incidents.filter((i) => i.status !== 'resolved').length;

  return (
    <div className={styles.page}>
      <AutoRefresh seconds={10} />
      <div className={styles.head}>
        <div>
          <h1>Incidents</h1>
          <p className={styles.sub}>
            Opened by the anomaly detector, investigated automatically. {status === 'all' ? `${open} open now.` : ''}
          </p>
        </div>
        <div className={styles.filters} role="tablist" aria-label="Filter incidents">
          {FILTERS.map((f) => (
            <Link
              key={f.value}
              href={`/incidents?status=${f.value}`}
              role="tab"
              aria-selected={status === f.value}
              className={`${styles.filter} ${status === f.value ? styles.active : ''}`}
            >
              {f.label}
            </Link>
          ))}
        </div>
      </div>

      {incidents.length === 0 ? (
        <Empty>No incidents here. Start traffic and inject a fault (see docs/FAULTS.md) to open one.</Empty>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Incident</th>
                <th>Status</th>
                <th>Severity</th>
                <th>Services</th>
                <th>Started</th>
                <th>Duration</th>
              </tr>
            </thead>
            <tbody>
              {incidents.map((i) => {
                const end = i.resolvedAt ? Date.parse(i.resolvedAt) : Date.now();
                return (
                  <tr key={i.id}>
                    <td className={styles.titleCell}>
                      <Link href={`/incidents/${i.number}`} className={styles.title}>
                        <span className={styles.number}>INC-{i.number}</span> {i.title}
                      </Link>
                      {i.summary && <p className={styles.summary}>{i.summary}</p>}
                    </td>
                    <td>
                      <StatusBadge status={i.status} />
                    </td>
                    <td>
                      <SeverityBadge severity={i.severity} />
                    </td>
                    <td>
                      <div className={styles.services}>
                        {i.services.map((s) => (
                          <Pill key={s}>{s}</Pill>
                        ))}
                      </div>
                    </td>
                    <td className={styles.nowrap}>{formatDateTime(i.startedAt)}</td>
                    <td className={styles.nowrap}>{formatDuration(end - Date.parse(i.startedAt))}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
