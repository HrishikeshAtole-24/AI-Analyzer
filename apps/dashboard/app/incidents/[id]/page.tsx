import Link from 'next/link';
import { AutoRefresh } from '@/components/AutoRefresh';
import { Pill, SeverityBadge, StatusBadge } from '@/components/Badges';
import { ErrorState } from '@/components/ErrorState';
import { IncidentActions } from '@/components/IncidentActions';
import { MetricChart } from '@/components/MetricChart';
import { platform, PlatformError, type IncidentDetail, type Investigation, type MinuteMetrics } from '@/lib/api';
import { categoryLabel, formatDateTime, formatDuration, formatMetricValue, formatTime, metricLabel } from '@/lib/format';
import styles from './detail.module.css';

export const dynamic = 'force-dynamic';

const EVENT_ICON: Record<string, string> = {
  anomaly: '⚠',
  deploy: '⇪',
  status_change: '●',
  investigation: '✦',
  note: '✎',
};

export default async function IncidentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let incident: IncidentDetail;
  try {
    incident = await platform<IncidentDetail>(`/incidents/${encodeURIComponent(id)}`);
  } catch (err) {
    return <ErrorState title={`Could not load incident ${id}`} message={(err as PlatformError).message} />;
  }

  const start = Date.parse(incident.startedAt);
  const end = incident.resolvedAt ? Date.parse(incident.resolvedAt) + 5 * 60_000 : Date.now();
  const from = new Date(start - 15 * 60_000).toISOString();
  const to = new Date(Math.min(Date.now(), end)).toISOString();
  const metrics = await platform<{ services: { service: string; windows: MinuteMetrics[] }[] }>(
    `/metrics?service=${encodeURIComponent(incident.services.join(','))}&from=${from}&to=${to}`,
  ).catch(() => ({ services: [] }));
  const heapAnomaly = incident.anomalies.some((a) => a.metric === 'heap_used');
  const investigation: Investigation | undefined = incident.investigations[0];
  const marker = { t: new Date(Math.floor(start / 60_000) * 60_000).toISOString(), label: 'start' };

  return (
    <div className={styles.page}>
      {incident.status !== 'resolved' && <AutoRefresh seconds={8} />}
      <Link href="/incidents" className={styles.back}>
        ← Incidents
      </Link>

      <header className={styles.header}>
        <div className={styles.titleRow}>
          <span className={styles.number}>INC-{incident.number}</span>
          <h1>{incident.title}</h1>
        </div>
        <div className={styles.meta}>
          <StatusBadge status={incident.status} />
          <SeverityBadge severity={incident.severity} />
          {incident.services.map((s) => (
            <Pill key={s}>{s}</Pill>
          ))}
          <span className={styles.metaText}>
            Started {formatDateTime(incident.startedAt)} · detected {formatTime(incident.detectedAt)}
            {incident.resolvedAt
              ? ` · resolved after ${formatDuration(Date.parse(incident.resolvedAt) - start)}`
              : ` · open for ${formatDuration(Date.now() - start)}`}
          </span>
        </div>
        <IncidentActions id={incident.id} status={incident.status} />
      </header>

      <div className={styles.grid}>
        <div className={styles.mainCol}>
          <InvestigationPanel investigation={investigation} />

          <section className={styles.card}>
            <h2>Metrics around the start</h2>
            <p className={styles.hint}>Dashed line: first anomalous minute. One measure per chart.</p>
            {metrics.services.map((s) => (
              <div key={s.service} className={styles.serviceBlock}>
                <h3>{s.service}</h3>
                <div className={styles.charts}>
                  <MetricChart title="Error rate (5xx)" unit="percent" marker={marker} data={s.windows.map((w) => ({ t: w.windowStart, v: w.errorRate }))} />
                  <MetricChart title="p95 latency" unit="ms" marker={marker} data={s.windows.map((w) => ({ t: w.windowStart, v: w.latencyP95 }))} />
                  {heapAnomaly && (
                    <MetricChart title="Heap used (peak)" unit="mb" marker={marker} data={s.windows.map((w) => ({ t: w.windowStart, v: w.heapUsedMb }))} />
                  )}
                </div>
              </div>
            ))}
          </section>
        </div>

        <aside className={styles.sideCol}>
          <section className={styles.card}>
            <h2>Timeline</h2>
            <ol className={styles.timeline}>
              {incident.events.map((e) => (
                <li key={e.id} className={`${styles.event} ${styles[e.type] ?? ''}`}>
                  <span className={styles.eventIcon} aria-hidden>
                    {EVENT_ICON[e.type] ?? '•'}
                  </span>
                  <div>
                    <time className={styles.eventTime}>{formatTime(e.at)}</time>
                    <p className={styles.eventText}>{e.message}</p>
                  </div>
                </li>
              ))}
            </ol>
          </section>

          <section className={styles.card}>
            <h2>Anomalies</h2>
            <table className={styles.miniTable}>
              <thead>
                <tr>
                  <th>Minute</th>
                  <th>Service</th>
                  <th>Metric</th>
                  <th>Value</th>
                </tr>
              </thead>
              <tbody>
                {incident.anomalies.map((a) => (
                  <tr key={a.id}>
                    <td>{formatTime(a.windowStart).slice(0, 5)}</td>
                    <td>{a.service}</td>
                    <td>{metricLabel(a.metric)}</td>
                    <td title={`baseline ${formatMetricValue(a.metric, a.baseline)}, z=${a.zScore.toFixed(1)}`}>
                      {formatMetricValue(a.metric, a.value)}
                      <span className={styles.baseline}> vs {formatMetricValue(a.metric, a.baseline)}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </aside>
      </div>
    </div>
  );
}

function InvestigationPanel({ investigation }: { investigation: Investigation | undefined }) {
  if (!investigation) {
    return (
      <section className={styles.card}>
        <h2>Root cause</h2>
        <p className={styles.hint}>The investigator starts about 30 seconds after detection.</p>
      </section>
    );
  }
  if (investigation.status === 'running') {
    return (
      <section className={styles.card}>
        <h2>Root cause</h2>
        <p className={styles.running}>
          <span className={styles.spinner} aria-hidden /> Investigating ({investigation.mode === 'llm' ? 'AI' : 'rule-based playbook'})...
        </p>
      </section>
    );
  }
  const hyps = investigation.hypotheses ?? [];
  return (
    <section className={styles.card}>
      <div className={styles.cardHead}>
        <h2>Root cause</h2>
        <span className={styles.modeTag}>
          {investigation.mode === 'llm' ? `AI · ${investigation.model}` : 'Rule-based playbook'}
          {investigation.fallbackReason ? ` (fallback: ${investigation.fallbackReason.split(':')[0]})` : ''}
        </span>
      </div>
      {investigation.summary && <p className={styles.summary}>{investigation.summary}</p>}
      <p className={styles.verifyLine}>
        Every claim below was re-checked by re-running its query. {investigation.claimsRejected} of {investigation.claimsTotal} claims were
        rejected as unsupported.
        {investigation.costUsd > 0 && ` Cost $${investigation.costUsd.toFixed(4)}.`}
      </p>

      <ol className={styles.hypotheses}>
        {hyps.map((h) => (
          <li key={h.rank} className={`${styles.hypothesis} ${h.rank === 1 ? styles.top : ''}`}>
            <div className={styles.hypHead}>
              <span className={styles.rank}>#{h.rank}</span>
              <strong>{h.title}</strong>
            </div>
            <div className={styles.hypMeta}>
              <Pill>{categoryLabel(h.category)}</Pill>
              <Pill>{h.service}</Pill>
              <span className={styles.likelihood}>likelihood: {h.likelihood}</span>
            </div>
            <p className={styles.hypText}>{h.description}</p>
            <h4>Verified evidence</h4>
            <ul className={styles.evidence}>
              {h.supporting.map((e, i) => (
                <li key={i}>
                  <span className={styles.check} aria-label="verified">
                    ✓
                  </span>{' '}
                  {e.claim} <code className={styles.query}>{e.query_id}</code>
                  <div className={styles.observed}>{e.observed}</div>
                </li>
              ))}
            </ul>
            {h.contradicting.length > 0 && (
              <>
                <h4>Against</h4>
                <ul className={styles.evidence}>
                  {h.contradicting.map((e, i) => (
                    <li key={i}>
                      <span aria-hidden>✗</span> {e.claim} <code className={styles.query}>{e.query_id}</code>
                    </li>
                  ))}
                </ul>
              </>
            )}
            {h.recommended_actions.length > 0 && (
              <>
                <h4>Next steps</h4>
                <ul className={styles.actionsList}>
                  {h.recommended_actions.map((a, i) => (
                    <li key={i}>{a}</li>
                  ))}
                </ul>
              </>
            )}
          </li>
        ))}
      </ol>

      {(investigation.rejectedClaims?.length ?? 0) > 0 && (
        <details className={styles.details}>
          <summary>Rejected claims ({investigation.rejectedClaims!.length})</summary>
          <ul>
            {investigation.rejectedClaims!.map((r, i) => (
              <li key={i}>
                <strong>{r.claim}</strong> <code>{r.query_id}</code>: {r.reason}
              </li>
            ))}
          </ul>
        </details>
      )}
      {(investigation.toolCalls?.length ?? 0) > 0 && (
        <details className={styles.details}>
          <summary>Queries run ({investigation.toolCalls!.length})</summary>
          <ul>
            {investigation.toolCalls!.map((c) => (
              <li key={c.id}>
                <code>{c.id}</code> {c.tool} <code className={styles.input}>{JSON.stringify(c.input)}</code>
                {!c.ok && <span className={styles.failed}> failed: {c.error}</span>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
