import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';
import styles from './layout.module.css';

export const metadata: Metadata = {
  title: 'AI Analyzer',
  description: 'Incidents, logs and service health with an AI root-cause investigator',
};

const NAV = [
  { href: '/incidents', label: 'Incidents' },
  { href: '/services', label: 'Service health' },
  { href: '/logs', label: 'Log search' },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className={styles.header}>
          <Link href="/incidents" className={styles.brand}>
            <span className={styles.logo} aria-hidden>
              ◆
            </span>
            AI Analyzer
          </Link>
          <nav className={styles.nav} aria-label="Main">
            {NAV.map((item) => (
              <Link key={item.href} href={item.href} className={styles.navLink}>
                {item.label}
              </Link>
            ))}
          </nav>
        </header>
        <main className={styles.main}>{children}</main>
      </body>
    </html>
  );
}
