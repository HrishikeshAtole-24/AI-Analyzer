import Link from 'next/link';
import { Pill } from '@/components/Badges';
import { ErrorState } from '@/components/ErrorState';
import { platform, PlatformError, type TraceView } from '@/lib/api';
import { formatDuration } from '@/lib/format';
import styles from './trace.module.css';

export const dynamic = 'force-dynamic';

export default async function TracePage({ params }: { params: Promise<{ traceId: string }> }) {
  const { traceId } = await params;
  let trace: TraceView;
  try {
    trace = await platform<TraceView>(`/traces/${encodeURIComponent(traceId)}`);
  } catch (err) {
    return <ErrorState title="Trace not found" message={(err as PlatformError).message} />;
  }
  const start = trace.startedAt ? Date.parse(trace.startedAt) : 0;
  const span = Math.max(trace.durationMs ?? 1, 1);

  return (
    <div className={styles.page}>
      <Link href="/logs" className={styles.back}>
        ← Log search
      </Link>
      <div>
        <h1>
          Trace <code>{trace.traceId}</code>
        </h1>
        <div className={styles.meta}>
          {trace.services.map((s) => (
            <Pill key={s}>{s}</Pill>
          ))}
          <span>
            {trace.logCount} logs · {formatDuration(trace.durationMs)} · {trace.errorCount} errors
          </span>
        </div>
      </div>
      <ol className={styles.rows}>
        {trace.logs.map((l) => {
          const offset = Date.parse(l['@timestamp']) - start;
          return (
            <li key={l.eventId} className={styles.row}>
              <span className={styles.offset}>+{offset} ms</span>
              <span className={styles.service}>{l.service}</span>
              <span className={styles.bar} aria-hidden>
                <span className={styles.tick} style={{ left: `${(offset / span) * 100}%` }} />
              </span>
              <span className={`${styles.msg} ${l.severityText === 'ERROR' || l.severityText === 'FATAL' ? styles.err : ''}`}>
                {l.severityText !== 'INFO' && <strong>{l.severityText} </strong>}
                {l.body}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
