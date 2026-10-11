import { readFile, writeFile } from 'node:fs/promises';
import { SCENARIOS } from './scenarios';

/**
 * Rebuilds eval rows for scenarios whose run was interrupted before the report was written, from
 * the harness log (injection times and incident numbers) and the platform API (investigations).
 *
 *   tsx src/recover.ts <eval log> <out.json>
 */

const PLATFORM = process.env.PLATFORM_URL || 'http://localhost:4000';

async function main(): Promise<void> {
  const [logPath, outPath] = process.argv.slice(2);
  if (!logPath || !outPath) throw new Error('usage: recover.ts <eval log> <out.json>');
  const log = await readFile(logPath, 'utf8');
  const day = process.env.EVAL_DATE || new Date().toISOString().slice(0, 10);

  const rows = [];
  for (const m of log.matchAll(/\[eval (\d\d:\d\d:\d\d)\] ([\w-]+): faults on/g)) {
    const [, time, id] = m;
    const scenario = SCENARIOS.find((s) => s.id === id);
    const detected = new RegExp(`${id}: INC-(\\d+) detected after ([\\d.]+)s`).exec(log);
    if (!scenario || scenario.expect === 'no_incident' || !detected) continue;
    const injectedAt = Date.parse(`${day}T${time}Z`);
    const number = Number(detected[1]);
    const res = await fetch(`${PLATFORM}/api/v1/incidents/${number}/investigations`);
    const { investigations } = (await res.json()) as {
      investigations: { status: string; mode: string; fallbackReason: string | null; hypotheses: { category: string; service: string }[] | null; claimsTotal: number; claimsRejected: number; costUsd: number; startedAt: string; finishedAt: string | null }[];
    };
    // The first investigation is the automatic one the harness scored.
    const inv = [...investigations].reverse().find((i) => i.status === 'completed');
    const top = inv?.hypotheses?.[0];
    const want = scenario.expect;
    rows.push({
      id,
      name: scenario.name,
      expected: `${want.category} @ ${want.service}`,
      got: top ? `${top.category} @ ${top.service}` : 'no verified hypothesis',
      correct: Boolean(top && top.category === want.category && top.service === want.service),
      top3: (inv?.hypotheses ?? []).slice(0, 3).some((h) => h.category === want.category && h.service === want.service),
      incident: number,
      mode: inv?.mode ?? null,
      fallbackReason: inv?.fallbackReason ?? null,
      timeToDetectS: Number(detected[2]),
      timeToRootCauseS: inv?.finishedAt ? Math.round((Date.parse(inv.finishedAt) - injectedAt) / 100) / 10 : null,
      claims: inv ? `${inv.claimsRejected}/${inv.claimsTotal}` : '-',
      costUsd: inv?.costUsd ?? 0,
    });
  }
  await writeFile(outPath, JSON.stringify(rows, null, 2));
  process.stdout.write(`recovered ${rows.length} rows -> ${outPath}\n`);
}

main().catch((err) => {
  process.stderr.write(`${(err as Error).stack}\n`);
  process.exit(1);
});
