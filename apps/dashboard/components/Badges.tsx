import type { IncidentStatus } from '@/lib/api';
import styles from './Badges.module.css';

/** Status colors are reserved for state and always paired with an icon and a label. */
const STATUS: Record<IncidentStatus, { icon: string; label: string; tone: string }> = {
  detected: { icon: '●', label: 'Detected', tone: styles.critical! },
  investigating: { icon: '◐', label: 'Investigating', tone: styles.warning! },
  identified: { icon: '◆', label: 'Cause identified', tone: styles.serious! },
  resolved: { icon: '✓', label: 'Resolved', tone: styles.good! },
};

export function StatusBadge({ status }: { status: IncidentStatus }) {
  const s = STATUS[status];
  return (
    <span className={`${styles.badge} ${s.tone}`}>
      <span aria-hidden>{s.icon}</span> {s.label}
    </span>
  );
}

export function SeverityBadge({ severity }: { severity: 'warning' | 'critical' }) {
  return (
    <span className={`${styles.badge} ${severity === 'critical' ? styles.critical : styles.warning}`}>
      <span aria-hidden>{severity === 'critical' ? '▲' : '△'}</span> {severity === 'critical' ? 'Critical' : 'Warning'}
    </span>
  );
}

export function Pill({ children }: { children: React.ReactNode }) {
  return <span className={styles.pill}>{children}</span>;
}
