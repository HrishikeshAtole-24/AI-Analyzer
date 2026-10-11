'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { IncidentStatus } from '@/lib/api';
import styles from './IncidentActions.module.css';

const NEXT: Record<IncidentStatus, { to: IncidentStatus; label: string }[]> = {
  detected: [
    { to: 'investigating', label: 'Start investigating' },
    { to: 'resolved', label: 'Resolve' },
  ],
  investigating: [
    { to: 'identified', label: 'Mark cause identified' },
    { to: 'resolved', label: 'Resolve' },
  ],
  identified: [{ to: 'resolved', label: 'Resolve' }],
  resolved: [],
};

export function IncidentActions({ id, status }: { id: string; status: IncidentStatus }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function call(label: string, url: string, init: RequestInit) {
    setBusy(label);
    setError(null);
    try {
      const res = await fetch(url, { ...init, headers: { 'content-type': 'application/json' } });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        throw new Error(body?.error?.message ?? `request failed (${res.status})`);
      }
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className={styles.actions}>
      {NEXT[status].map((n) => (
        <button
          key={n.to}
          className={n.to === 'resolved' ? styles.primary : styles.button}
          disabled={busy !== null}
          onClick={() =>
            call(n.label, `/api/platform/incidents/${id}`, { method: 'PATCH', body: JSON.stringify({ status: n.to, note: 'from dashboard' }) })
          }
        >
          {busy === n.label ? 'Saving...' : n.label}
        </button>
      ))}
      <button
        className={styles.button}
        disabled={busy !== null}
        onClick={() => call('investigate', `/api/platform/incidents/${id}/investigate`, { method: 'POST' })}
      >
        {busy === 'investigate' ? 'Starting...' : 'Re-run investigation'}
      </button>
      {error && (
        <span className={styles.error} role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
