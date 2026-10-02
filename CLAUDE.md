# AI Analyzer: notes for Claude Code

6-week MVP of an AI log analyzer and incident assistant (plan: Oct 5 to Nov 15 2026). Start with
[docs/PROGRESS.md](docs/PROGRESS.md) for where things stand and [docs/CODEBASE.md](docs/CODEBASE.md) for how the code is built.

## Keep the docs in sync (required)

The owner asked for these to stay current. Every change that adds or alters behaviour updates them
in the same piece of work, not later:

| Change | Update |
|---|---|
| New or changed endpoint | `docs/API.md` and `scripts/build-postman.cjs`, then `npm run docs:postman` |
| New module, folder, or design decision | `docs/CODEBASE.md` |
| New data path or component | `docs/PROJECT_FLOW.md` (Mermaid diagrams) |
| New or changed fault | `docs/FAULTS.md`, `docs/API.md`, Postman script |
| End of every work session | `docs/PROGRESS.md`: checklist and a dated log entry |
| Code changed | Rebuild the knowledge graph with the graphify skill: `/graphify . --update` (output in `graphify-out/`) |

## Commands

- `npm run dev:services`, `npm run traffic -- --rps 10`
- `npm test`, `npm run typecheck`. Run both before calling work done.
- Check the Postman collection against running services:
  `npx -y newman run docs/postman/AI-Analyzer.postman_collection.json -e docs/postman/AI-Analyzer.local.postman_environment.json --folder "Order service"`

## Rules

- Each service's `index.ts` must import `./instrumentation` first (see CODEBASE.md, "Tracing is a separate entry point").
- Fault toggles must never be written to the log stream (stderr only).
- Stack is fixed by the plan: TypeScript, Express, KafkaJS, OpenSearch, Postgres + Prisma + pgvector, Zod,
  Next.js with CSS Modules (no Tailwind), Vitest.
- Only must-have features until the end-to-end demo works.
