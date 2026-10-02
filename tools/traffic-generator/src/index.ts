import { parseArgs } from 'node:util';

/**
 * Sends steady order traffic to the order service, with optional bursts, and prints a
 * summary every few seconds. Faults only show up in the data if traffic is flowing.
 *
 *   npm run traffic -- --rps 5 --burst-every 60 --burst-rps 40 --burst-seconds 10
 */

const { values: args } = parseArgs({
  options: {
    target: { type: 'string', default: process.env.ORDER_SERVICE_URL ?? 'http://localhost:4001' },
    rps: { type: 'string', default: '5' },
    duration: { type: 'string', default: '0' },
    'burst-every': { type: 'string', default: '0' },
    'burst-rps': { type: 'string', default: '40' },
    'burst-seconds': { type: 'string', default: '10' },
    'read-ratio': { type: 'string', default: '0.2' },
    'max-in-flight': { type: 'string', default: '200' },
    'report-every': { type: 'string', default: '5' },
    help: { type: 'boolean', default: false },
  },
});

if (args.help) {
  process.stdout.write(`traffic-generator options:
  --target URL           order service base URL (default http://localhost:4001)
  --rps N                steady requests per second (default 5)
  --duration S           stop after S seconds; 0 runs until Ctrl+C (default 0)
  --burst-every S        start a burst every S seconds; 0 disables bursts (default 0)
  --burst-rps N          requests per second during a burst (default 40)
  --burst-seconds S      length of each burst (default 10)
  --read-ratio R         share of requests that are GET /orders/:id (default 0.2)
  --max-in-flight N      cap on concurrent requests (default 200)
  --report-every S       summary interval (default 5)
`);
  process.exit(0);
}

const num = (key: keyof typeof args): number => {
  const v = Number(args[key]);
  if (!Number.isFinite(v) || v < 0) throw new Error(`--${String(key)} must be a non-negative number`);
  return v;
};

const target = String(args.target).replace(/\/$/, '');
const steadyRps = num('rps');
const durationS = num('duration');
const burstEvery = num('burst-every');
const burstRps = num('burst-rps');
const burstSeconds = num('burst-seconds');
const readRatio = num('read-ratio');
const maxInFlight = num('max-in-flight');
const reportEvery = num('report-every');

const CURRENCIES = [
  { code: 'USD', weight: 0.5 },
  { code: 'EUR', weight: 0.2 },
  { code: 'INR', weight: 0.2 },
  { code: 'GBP', weight: 0.1 },
];
const SKUS = ['SKU-KEYBOARD', 'SKU-MOUSE', 'SKU-MONITOR', 'SKU-CABLE', 'SKU-HEADSET', 'SKU-WEBCAM'];

function pickCurrency(): string {
  let r = Math.random();
  for (const c of CURRENCIES) {
    if ((r -= c.weight) <= 0) return c.code;
  }
  return 'USD';
}

function randomOrder() {
  const itemCount = 1 + Math.floor(Math.random() * 3);
  return {
    customerId: `cus_${1000 + Math.floor(Math.random() * 500)}`,
    currency: pickCurrency(),
    items: Array.from({ length: itemCount }, () => ({
      sku: SKUS[Math.floor(Math.random() * SKUS.length)]!,
      quantity: 1 + Math.floor(Math.random() * 3),
      unitPrice: Math.round((5 + Math.random() * 195) * 100) / 100,
    })),
  };
}

// Stats for the current report window.
interface Window {
  sent: number;
  byClass: Record<string, number>;
  networkErrors: number;
  skipped: number;
  latencies: number[];
}
const newWindow = (): Window => ({ sent: 0, byClass: {}, networkErrors: 0, skipped: 0, latencies: [] });
let window = newWindow();
let total = 0;
let inFlight = 0;
const recentOrderIds: string[] = [];

async function fire(): Promise<void> {
  if (inFlight >= maxInFlight) {
    window.skipped++;
    return;
  }
  const isRead = recentOrderIds.length > 0 && Math.random() < readRatio;
  const start = performance.now();
  inFlight++;
  window.sent++;
  total++;
  try {
    const res = isRead
      ? await fetch(`${target}/orders/${recentOrderIds[Math.floor(Math.random() * recentOrderIds.length)]}`, {
          signal: AbortSignal.timeout(15_000),
        })
      : await fetch(`${target}/orders`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(randomOrder()),
          signal: AbortSignal.timeout(15_000),
        });
    const cls = `${Math.floor(res.status / 100)}xx`;
    window.byClass[cls] = (window.byClass[cls] ?? 0) + 1;
    if (!isRead && res.status < 500) {
      const body = (await res.json()) as { id?: string };
      if (body.id) {
        recentOrderIds.push(body.id);
        if (recentOrderIds.length > 200) recentOrderIds.shift();
      }
    } else {
      await res.arrayBuffer();
    }
  } catch {
    window.networkErrors++;
  } finally {
    inFlight--;
    window.latencies.push(performance.now() - start);
  }
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]!;
}

const startedAt = Date.now();
function currentRps(): number {
  if (burstEvery <= 0) return steadyRps;
  const elapsed = (Date.now() - startedAt) / 1000;
  const intoCycle = elapsed % burstEvery;
  return elapsed >= burstEvery && intoCycle < burstSeconds ? burstRps : steadyRps;
}

// Fire on a 100 ms tick, carrying fractional requests over so low rates stay accurate.
let carry = 0;
const tick = setInterval(() => {
  carry += currentRps() / 10;
  while (carry >= 1) {
    carry--;
    void fire();
  }
}, 100);

function printReport(): void {
  const w = window;
  window = newWindow();
  const classes = ['2xx', '4xx', '5xx'].map((c) => `${c}=${w.byClass[c] ?? 0}`).join(' ');
  const elapsed = Math.round((Date.now() - startedAt) / 1000);
  process.stdout.write(
    `[${String(elapsed).padStart(4)}s] rps=${currentRps()} sent=${w.sent} ${classes} ` +
      `net_err=${w.networkErrors} skipped=${w.skipped} in_flight=${inFlight} ` +
      `p50=${percentile(w.latencies, 50).toFixed(0)}ms p95=${percentile(w.latencies, 95).toFixed(0)}ms\n`,
  );
}
const report = setInterval(printReport, reportEvery * 1000);

function stop(): void {
  clearInterval(tick);
  clearInterval(report);
  if (window.sent > 0) printReport();
  process.stdout.write(`traffic-generator stopped after ${total} requests\n`);
  process.exit(0);
}

process.on('SIGINT', stop);
if (durationS > 0) setTimeout(stop, durationS * 1000);

process.stdout.write(
  `traffic-generator -> ${target} at ${steadyRps} rps` +
    (burstEvery > 0 ? `, bursts of ${burstRps} rps for ${burstSeconds}s every ${burstEvery}s` : '') +
    '\n',
);
