import { spawn, type ChildProcess } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { SCENARIOS, SERVICE_URLS, type Scenario } from './scenarios';

/**
 * Eval harness: runs every fault scenario end to end against the live system and scores the
 * investigation's top hypothesis against the scenario's known root cause.
 *
 *   npm run eval                       # all scenarios (about 10 min each)
 *   npm run eval -- --only gateway-timeout,bad-deploy-payment
 *
 * Needs the platform and services running (npm run dev:all). It starts its own traffic unless
 * --no-traffic is passed.
 */

const { values: args } = parseArgs({
  options: {
    only: { type: 'string' },
    'warmup-min': { type: 'string', default: '6' },
    'cooldown-min': { type: 'string', default: '7' },
    'no-traffic': { type: 'boolean', default: false },
    rps: { type: 'string', default: '10' },
  },
});

const PLATFORM = process.env.PLATFORM_URL || 'http://localhost:4000';
const DETECT_TIMEOUT_MS = 4 * 60_000;
const INVESTIGATE_TIMEOUT_MS = 6 * 60_000;
const CONTROL_WATCH_MS = 4 * 60_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const log = (msg: string) => process.stdout.write(`[eval ${new Date().toISOString().slice(11, 19)}] ${msg}\n`);

async function api<T>(url: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const res = await fetch(url, {
    method: init?.method ?? 'GET',
    headers: init?.body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
    signal: AbortSignal.timeout(15_000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${init?.method ?? 'GET'} ${url} -> ${res.status} ${text.slice(0, 200)}`);
  return (text ? JSON.parse(text) : null) as T;
}

interface Incident {
  id: string;
  number: number;
  status: string;
  services: string[];
  startedAt: string;
  detectedAt: string;
}
interface Hypothesis {
  rank: number;
  title: string;
  category: string;
  service: string;
}
interface Investigation {
  id: string;
  status: string;
  mode: string;
  fallbackReason: string | null;
  hypotheses: Hypothesis[] | null;
  claimsTotal: number;
  claimsRejected: number;
  costUsd: number;
  finishedAt: string | null;
}

interface ScenarioResult {
  id: string;
  name: string;
  expected: string;
  got: string;
  correct: boolean;
  top3: boolean;
  incident: number | null;
  mode: string | null;
  fallbackReason: string | null;
  timeToDetectS: number | null;
  timeToRootCauseS: number | null;
  claims: string;
  costUsd: number;
  note?: string;
}

async function resetAll(): Promise<void> {
  for (const url of Object.values(SERVICE_URLS)) await api(`${url}/admin/faults/reset`, { method: 'POST' });
}

async function resolveOpenIncidents(note: string): Promise<void> {
  const open = await api<{ incidents: Incident[] }>(`${PLATFORM}/api/v1/incidents?status=open&limit=50`);
  for (const i of open.incidents) {
    await api(`${PLATFORM}/api/v1/incidents/${i.id}`, { method: 'PATCH', body: { status: 'resolved', note } }).catch(() => undefined);
  }
}

async function waitFor<T>(what: string, timeoutMs: number, probe: () => Promise<T | null>): Promise<T | null> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const value = await probe().catch(() => null);
    if (value) return value;
    await sleep(5_000);
  }
  log(`timed out waiting for ${what}`);
  return null;
}

async function runScenario(s: Scenario): Promise<ScenarioResult> {
  const expected = s.expect === 'no_incident' ? 'no incident' : `${s.expect.category} @ ${s.expect.service}`;
  const base = { id: s.id, name: s.name, expected, costUsd: 0, mode: null, fallbackReason: null, claims: '-' };

  await resolveOpenIncidents('eval: cleanup before scenario');
  const injectedAt = Date.now();
  // An incident counts for this scenario only if its anomalies start in or after this minute.
  const injectedMinute = Math.floor(injectedAt / 60_000) * 60_000;
  for (const f of s.faults) {
    await api(`${SERVICE_URLS[f.service]}/admin/faults/${f.fault}`, { method: 'PUT', body: f.params ?? {} });
  }
  if (s.unrelatedDeploy) {
    await api(`${PLATFORM}/api/v1/deploys`, { method: 'POST', body: s.unrelatedDeploy });
  }
  log(`${s.id}: faults on (${s.faults.map((f) => `${f.service}/${f.fault}`).join(', ')})`);

  const findIncident = async () => {
    const list = await api<{ incidents: Incident[] }>(`${PLATFORM}/api/v1/incidents?status=all&limit=20`);
    return list.incidents.find((i) => Date.parse(i.startedAt) >= injectedMinute) ?? null;
  };

  try {
    if (s.expect === 'no_incident') {
      await sleep(CONTROL_WATCH_MS);
      const incident = await findIncident();
      return {
        ...base,
        got: incident ? `incident INC-${incident.number}` : 'no incident',
        correct: !incident,
        top3: !incident,
        incident: incident?.number ?? null,
        timeToDetectS: null,
        timeToRootCauseS: null,
      };
    }

    const incident = await waitFor('incident', DETECT_TIMEOUT_MS, findIncident);
    if (!incident) {
      return { ...base, got: 'not detected', correct: false, top3: false, incident: null, timeToDetectS: null, timeToRootCauseS: null };
    }
    const timeToDetectS = Math.round((Date.parse(incident.detectedAt) - injectedAt) / 100) / 10;
    log(`${s.id}: INC-${incident.number} detected after ${timeToDetectS}s (${incident.services.join(', ')})`);

    const investigation = await waitFor('investigation', INVESTIGATE_TIMEOUT_MS, async () => {
      const r = await api<{ investigations: Investigation[] }>(`${PLATFORM}/api/v1/incidents/${incident.id}/investigations`);
      return r.investigations.find((i) => i.status !== 'running') ?? null;
    });
    if (!investigation) {
      return { ...base, got: 'no investigation', correct: false, top3: false, incident: incident.number, timeToDetectS, timeToRootCauseS: null };
    }

    const hyps = investigation.hypotheses ?? [];
    const top = hyps[0];
    const want = s.expect;
    const matches = (h: Hypothesis) => h.category === want.category && h.service === want.service;
    return {
      ...base,
      got: top ? `${top.category} @ ${top.service}` : 'no verified hypothesis',
      correct: Boolean(top && matches(top)),
      top3: hyps.slice(0, 3).some(matches),
      incident: incident.number,
      mode: investigation.mode,
      fallbackReason: investigation.fallbackReason,
      timeToDetectS,
      timeToRootCauseS: investigation.finishedAt ? Math.round((Date.parse(investigation.finishedAt) - injectedAt) / 100) / 10 : null,
      claims: `${investigation.claimsRejected}/${investigation.claimsTotal}`,
      costUsd: investigation.costUsd,
    };
  } finally {
    await resetAll();
    log(`${s.id}: faults off`);
  }
}

function report(results: ScenarioResult[], startedAt: Date, cooldownMin: number): string {
  const graded = results.filter((r) => r.expected !== 'no incident');
  const correct = graded.filter((r) => r.correct).length;
  const top3 = graded.filter((r) => r.top3).length;
  const control = results.filter((r) => r.expected === 'no incident');
  const ttd = graded.map((r) => r.timeToDetectS).filter((x): x is number => x !== null);
  const ttr = graded.map((r) => r.timeToRootCauseS).filter((x): x is number => x !== null);
  const claimTotals = graded.reduce(
    (acc, r) => {
      const [rej, tot] = r.claims.split('/').map(Number);
      return Number.isFinite(rej) && Number.isFinite(tot) ? { rej: acc.rej + rej!, tot: acc.tot + tot! } : acc;
    },
    { rej: 0, tot: 0 },
  );
  const median = (xs: number[]) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]! : null);
  const modes = [...new Set(results.map((r) => r.mode).filter(Boolean))].join(', ') || '-';

  const lines = [
    `# Eval run ${startedAt.toISOString().slice(0, 16).replace('T', ' ')} UTC`,
    '',
    `- **Root-cause accuracy (top hypothesis): ${correct} of ${graded.length}**`,
    `- Correct cause in the top 3: ${top3} of ${graded.length}`,
    `- Control scenarios passed (no false incident): ${control.filter((r) => r.correct).length} of ${control.length}`,
    `- Median time to detect: ${median(ttd) ?? '-'} s; median time from fault to verified root cause: ${median(ttr) ?? '-'} s`,
    `- Unsupported claims rejected by the verifier: ${claimTotals.rej} of ${claimTotals.tot}` +
      (claimTotals.tot ? ` (${((claimTotals.rej / claimTotals.tot) * 100).toFixed(1)}%)` : ''),
    `- Investigation mode: ${modes}; total LLM cost $${results.reduce((n, r) => n + r.costUsd, 0).toFixed(4)}`,
    `- Settings: ${args.rps} orders/s traffic, ${cooldownMin}-minute cooldown between scenarios`,
    '',
    '| Scenario | Expected | Top hypothesis | Correct | Top 3 | INC | Mode | Detect (s) | Root cause (s) | Claims rejected | Cost |',
    '|---|---|---|---|---|---|---|---|---|---|---|',
    ...results.map(
      (r) =>
        `| ${r.id} | ${r.expected} | ${r.got} | ${r.correct ? 'yes' : '**no**'} | ${r.top3 ? 'yes' : 'no'} | ${r.incident ?? '-'} | ` +
        `${r.mode ?? '-'}${r.fallbackReason ? ` (${r.fallbackReason.split(':')[0]})` : ''} | ${r.timeToDetectS ?? '-'} | ${r.timeToRootCauseS ?? '-'} | ${r.claims} | $${r.costUsd.toFixed(4)} |`,
    ),
  ];
  return lines.join('\n') + '\n';
}

async function main(): Promise<void> {
  const only = args.only?.split(',').map((s) => s.trim());
  const scenarios = only ? SCENARIOS.filter((s) => only.includes(s.id)) : SCENARIOS;
  if (scenarios.length === 0) throw new Error(`no scenarios match --only ${args.only}`);
  const warmupMs = Number(args['warmup-min']) * 60_000;
  const cooldownMs = Number(args['cooldown-min']) * 60_000;

  await api(`${PLATFORM}/health`);
  for (const url of Object.values(SERVICE_URLS)) await api(`${url}/health`);
  await resetAll();

  let traffic: ChildProcess | null = null;
  if (!args['no-traffic']) {
    const root = path.resolve(__dirname, '../../..');
    traffic = spawn(process.execPath, [path.join(root, 'node_modules/tsx/dist/cli.mjs'), 'tools/traffic-generator/src/index.ts', '--rps', String(args.rps), '--report-every', '60'], {
      cwd: root,
      stdio: 'ignore',
    });
    log(`traffic started at ${args.rps} orders/s; warming up the baseline for ${args['warmup-min']} min`);
    await sleep(warmupMs);
  }

  const startedAt = new Date();
  const results: ScenarioResult[] = [];
  try {
    for (const [i, s] of scenarios.entries()) {
      log(`scenario ${i + 1}/${scenarios.length}: ${s.id}`);
      const result = await runScenario(s);
      results.push(result);
      log(`${s.id}: ${result.correct ? 'CORRECT' : 'WRONG'} (expected ${result.expected}, got ${result.got})`);
      if (i < scenarios.length - 1) {
        log(`cooling down ${args['cooldown-min']} min`);
        await sleep(cooldownMs);
      }
    }
  } finally {
    traffic?.kill();
    await resetAll().catch(() => undefined);
    await resolveOpenIncidents('eval: finished').catch(() => undefined);
  }

  const md = report(results, startedAt, Number(args['cooldown-min']));
  const dir = path.resolve(__dirname, '../../../eval/results');
  await mkdir(dir, { recursive: true });
  const stamp = startedAt.toISOString().slice(0, 16).replace(/[:T]/g, '-');
  await writeFile(path.join(dir, `${stamp}.md`), md);
  await writeFile(path.join(dir, `${stamp}.json`), JSON.stringify(results, null, 2));
  process.stdout.write(`\n${md}\nSaved to eval/results/${stamp}.md\n`);
}

main().catch((err) => {
  process.stderr.write(`eval failed: ${(err as Error).stack}\n`);
  process.exit(1);
});
