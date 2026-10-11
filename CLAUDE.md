# AI Analyzer: notes for Claude Code

6-week MVP of an AI log analyzer and incident assistant (plan: Oct 5 to Nov 15 2026). All six weeks are built. Start with
[docs/PROGRESS.md](docs/PROGRESS.md) for where things stand and [docs/CODEBASE.md](docs/CODEBASE.md) for how the code is built.

## Keep the docs in sync (required)

The owner asked for these to stay current. Every change that adds or alters behaviour updates them
in the same piece of work, not later:

| Change | Update |
|---|---|
| New or changed endpoint | `docs/API.md` and `scripts/build-postman.cjs`, then `npm run docs:postman` |
| New module, folder, or design decision | `docs/CODEBASE.md` |
| New data path or component | `docs/PROJECT_FLOW.md` (Mermaid diagrams) |
| New or changed fault | `docs/FAULTS.md`, `docs/API.md`, Postman script, eval scenario |
| Eval or load test run | `docs/EVAL.md` / `docs/LOADTEST.md` and the README results table |
| End of every work session | `docs/PROGRESS.md`: checklist and a dated log entry |
| Code changed | Rebuild the knowledge graph with the graphify skill: `/graphify . --update` (output in `graphify-out/`) |

## Commands

- First time: `npm run setup` (install, start Docker stack, migrate DB). Copy `.env.example` to `.env`.
- `npm run dev:all` (3 services + platform API + worker), or `npm run dev:services` / `npm run dev:platform`
- `npm run traffic -- --rps 10`
- `npm run dev:dashboard` (Next.js on :3000; included in `dev:all`)
- `npm run eval` (all fault scenarios, ~100 min; `-- --only <id>,<id>` for a subset), reports in `eval/results/`
- `npm run loadtest` (k6 in Docker against `POST /api/v1/logs`)
- LLM investigator: set `ANTHROPIC_API_KEY` in `.env`; without it the rule-based playbook runs
- Schema change: edit `apps/platform/prisma/schema.prisma`, then `npm run db:migrate`
- `npm test`, `npm run typecheck`. Run both before calling work done.
- Check the Postman collection against running services:
  `npx -y newman run docs/postman/AI-Analyzer.postman_collection.json -e docs/postman/AI-Analyzer.local.postman_environment.json --folder "Order service"`
  (platform folders: "Platform: ingestion", "Platform: search and traces", "Platform: services and metrics",
  "Platform: deploys and incidents", "Platform: investigations and knowledge")

## Rules

- Each service's `index.ts` must import `./instrumentation` first (see CODEBASE.md, "Tracing is a separate entry point").
- Fault toggles must never be written to the log stream (stderr only).
- The platform must not ingest its own logs (feedback loop); it logs to stdout only.
- Detection must stay stateless and idempotent (anomalies are unique per service, metric and window).
- Investigations reach data only through the `EvidenceLedger`; every stored claim must pass the verifier.
  Runbooks and past incidents are never evidence. Never add a confidence percentage.
- The rule-based playbook must keep working with no API key: it is the fallback and the baseline.
- New fault or failure pattern: add an eval scenario in `tools/eval/src/scenarios.ts` and a runbook if useful.
- Stack is fixed by the plan: TypeScript, Express, KafkaJS, OpenSearch, Postgres + Prisma + pgvector, Zod,
  Next.js with CSS Modules (no Tailwind), Vitest.
- Only must-have features until the end-to-end demo works.
