'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import type { LogDoc } from '@/lib/api';
import styles from './LogSearch.module.css';

interface Filters {
  service: string;
  level: string;
  q: string;
  range: string;
}

const RANGES = [
  { value: '5m', label: 'Last 5 min' },
  { value: '15m', label: 'Last 15 min' },
  { value: '1h', label: 'Last hour' },
  { value: '6h', label: 'Last 6 hours' },
];
const SERVICES = ['', 'order-service', 'payment-service', 'gateway-mock'];
const LEVELS = ['', 'INFO', 'WARN', 'ERROR'];

export function LogSearch({ initial }: { initial: Filters }) {
  const router = useRouter();
  const [filters, setFilters] = useState(initial);
  const [logs, setLogs] = useState<LogDoc[]>([]);
  const [total, setTotal] = useState(0);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    async (f: Filters, after?: string) => {
      setLoading(true);
      setError(null);
      const qs = new URLSearchParams({ from: `now-${f.range}`, limit: '100' });
      if (f.service) qs.set('service', f.service);
      if (f.level) qs.set('level', f.level);
      if (f.q) qs.set('q', f.q);
      if (after) qs.set('cursor', after);
      try {
        const res = await fetch(`/api/platform/logs?${qs}`);
        const body = (await res.json()) as { logs: LogDoc[]; total: number; nextCursor: string | null; error?: { message: string } };
        if (!res.ok) throw new Error(body.error?.message ?? `search failed (${res.status})`);
        setLogs((prev) => (after ? [...prev, ...body.logs] : body.logs));
        setTotal(body.total);
        setCursor(body.nextCursor);
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    void run(initial);
  }, [initial, run]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const qs = new URLSearchParams(Object.entries(filters).filter(([, v]) => v) as [string, string][]);
    router.replace(`/logs?${qs}`);
    void run(filters);
  }

  const set = (key: keyof Filters) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setFilters((f) => ({ ...f, [key]: e.target.value }));

  return (
    <div className={styles.page}>
      <div>
        <h1>Log search</h1>
        <p className={styles.sub}>Newest first. Click a trace to see one request across all services.</p>
      </div>

      <form className={styles.filters} onSubmit={submit}>
        <input className={styles.q} placeholder='Search messages, e.g. "timeout acquiring"' value={filters.q} onChange={set('q')} aria-label="Full-text query" />
        <select value={filters.service} onChange={set('service')} aria-label="Service">
          {SERVICES.map((s) => (
            <option key={s} value={s}>
              {s || 'All services'}
            </option>
          ))}
        </select>
        <select value={filters.level} onChange={set('level')} aria-label="Minimum level">
          {LEVELS.map((l) => (
            <option key={l} value={l}>
              {l ? `${l} and above` : 'All levels'}
            </option>
          ))}
        </select>
        <select value={filters.range} onChange={set('range')} aria-label="Time range">
          {RANGES.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>
        <button type="submit" disabled={loading}>
          {loading ? 'Searching...' : 'Search'}
        </button>
      </form>

      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      <p className={styles.count}>
        {total.toLocaleString()}
        {total >= 10_000 ? '+' : ''} matching logs, showing {logs.length}
      </p>

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Time</th>
              <th>Level</th>
              <th>Service</th>
              <th>Message</th>
              <th>Trace</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((l) => (
              <tr key={l.eventId}>
                <td className={styles.time}>{new Date(l['@timestamp']).toLocaleTimeString('en-GB', { hour12: false })}</td>
                <td>
                  <span className={`${styles.level} ${styles[l.severityText] ?? ''}`}>{l.severityText}</span>
                </td>
                <td className={styles.service}>
                  {l.service}
                  <span className={styles.version}>@{l.serviceVersion}</span>
                </td>
                <td className={styles.body}>
                  {l.body}
                  {l.exceptionType && <span className={styles.exception}> {l.exceptionType}</span>}
                </td>
                <td>
                  {l.traceId ? (
                    <Link href={`/traces/${l.traceId}`} className={styles.trace}>
                      {l.traceId.slice(0, 8)}
                    </Link>
                  ) : (
                    '-'
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {cursor && (
        <button className={styles.more} disabled={loading} onClick={() => void run(filters, cursor)}>
          Load more
        </button>
      )}
    </div>
  );
}
