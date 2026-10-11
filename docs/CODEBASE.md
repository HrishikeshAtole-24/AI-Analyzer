# Codebase guide

Where things are, why they are built that way, and how to extend them. Read this before changing code.

## Layout

```text
AI Analyzer/
├── apps/
│   └── platform/                  @ai-analyzer/platform: the analyzer (API process + worker process)
│       ├── prisma/schema.prisma   Deploy, Incident, Anomaly, IncidentEvent (+ migrations/)
│       ├── src/
│       │   ├── api.ts             API process entry: ingest, search, traces, metrics, deploys, incidents
│       │   ├── worker.ts          worker process entry: log indexer + anomaly detector
│       │   ├── config.ts          env settings, platform logger (stdout only)
│       │   ├── clients/           kafka.ts (topics, producer, DLQ), opensearch.ts (index template), db.ts (Prisma)
│       │   ├── logs/              ingest.ts (POST /logs), document.ts (record -> stored doc), search.ts, routes.ts
│       │   ├── worker/            log-indexer.ts: Kafka consumer -> OpenSearch bulk, idempotent, DLQ
│       │   ├── metrics/           metrics.ts: per-minute service metrics, services list, pipeline lag
│       │   ├── detection/         ewma.ts (pure EWMA/z-score), detector.ts (loop that records anomalies)
│       │   ├── incidents/         lifecycle.ts (pure rules), service.ts (grouping, deploys, auto-resolve), routes.ts
│       │   ├── deploys/           routes.ts: POST/GET /deploys
│       │   ├── investigation/     the root-cause investigator (Week 4)
│       │   │   ├── findings.ts    Findings schema (Zod + JSON Schema for submit_findings), categories, checks
│       │   │   ├── tools.ts       investigator tools + EvidenceLedger (records and re-runs every query)
│       │   │   ├── llm-agent.ts   manual tool-calling loop on Claude, cost accounting
│       │   │   ├── prompt.ts      byte-stable system prompt (prompt-cached)
│       │   │   ├── rule-based.ts  fallback playbook: fixed queries + failure-pattern rules
│       │   │   ├── verifier.ts    re-runs cited queries, applies checks, drops unsupported claims
│       │   │   ├── circuit-breaker.ts
│       │   │   ├── investigator.ts orchestration, persistence, worker loop
│       │   │   └── routes.ts      investigate, investigations, runbooks, similar incidents, stats
│       │   └── knowledge/         embedder.ts (feature hashing), knowledge.ts (runbooks + incident memory, pgvector)
│       └── test/                  Vitest unit tests (detection, lifecycle, pipeline, investigation, embedder)
├── apps/
│   └── dashboard/                 @ai-analyzer/dashboard: Next.js 16 (App Router) + CSS Modules + Recharts, :3000
│       ├── app/                   incidents list + detail, services (health charts), logs (search), traces
│       ├── components/            MetricChart, badges, IncidentActions, LogSearch, AutoRefresh
│       └── lib/                   api.ts (server-side platform client + types), format.ts
├── packages/
│   └── shared/                    @ai-analyzer/shared: code every service uses
│       ├── src/
│       │   ├── log-schema.ts      Zod schema for an OTel log record and a batch (the ingestion contract)
│       │   ├── logger.ts          createLogger(): structured logger, adds trace/span IDs
│       │   ├── log-exporter.ts    HttpLogExporter: batches records and POSTs them to the platform
│       │   ├── tracing.ts         initTracing(): OpenTelemetry setup (separate entry point)
│       │   ├── http.ts            startService(), requestLogger, error handler, fault routes, callJson()
│       │   ├── faults.ts          FaultRegistry: typed runtime fault switches
│       │   ├── db-pool.ts         SimulatedDbPool: connection pool with real queueing and timeouts
│       │   ├── process-monitor.ts heap / RSS / event-loop samples every 15 s
│       │   ├── config.ts          env(), envInt(), loggerOptionsFromEnv()
│       │   └── index.ts           re-exports everything except tracing
│       └── test/                  Vitest unit tests
├── services/
│   ├── order-service/             :4001 POST/GET /orders; faults: db_pool_exhaustion, memory_leak
│   ├── payment-service/           :4002 POST/GET /payments; faults: db_pool_exhaustion, bad_deploy, retry_storm
│   │   └── src/currency.ts        currency tables, including the broken v2 table of the bad deploy
│   └── gateway-mock/              :4003 POST /v1/charges; faults: gateway_timeout, gateway_errors
├── tools/
│   ├── traffic-generator/         CLI: steady + burst order traffic with a live summary
│   └── eval/                      eval harness: scenarios.ts (ground truth) + index.ts (runner, report)
├── loadtest/ingest.js             k6 script for POST /api/v1/logs (run in Docker by scripts/loadtest.cjs)
├── eval/results/                  eval reports (.md + .json per run)
├── docs/runbooks/                 runbooks, synced into Postgres with embeddings at worker start
├── .github/workflows/ci.yml       typecheck, unit tests, dashboard build on every push
├── infra/postgres/init.sql        enables pgvector on first start
├── docker-compose.yml             Redpanda (+ console), OpenSearch, Postgres/pgvector
├── scripts/build-postman.cjs      generates the Postman collection
├── docs/                          this guide, API, flow, faults, progress, Postman
├── graphify-out/                  knowledge graph of the repo (graph.html, GRAPH_REPORT.md)
├── .env.example                   copy to .env; loaded by every dev script
└── CLAUDE.md                      rules for keeping docs in sync (for Claude Code sessions)
```

Every service has the same three files:

| File | Role |
|---|---|
| `src/instrumentation.ts` | Calls `initTracing()`. Imported first. |
| `src/identity.ts` | `SERVICE = { name, version, environment }` |
| `src/index.ts` | Logger, faults, routes, `startService()`, process monitor |

## Design decisions

**One TypeScript monorepo with npm workspaces.** Services share the log schema and middleware, so a
change to the log format is a type error everywhere at once. Packages point `main` at `src/index.ts`,
and `tsx` runs TypeScript directly, so there is no build step during development. Production builds
come in Week 6.

**CommonJS, not ESM.** OpenTelemetry patches `http` and `express` by hooking `require`. With CommonJS
this works without loader flags.

**Tracing is a separate entry point (`@ai-analyzer/shared/tracing`).** The main index imports Express.
If tracing were imported from there, Express would load before it is patched and no spans would exist.
Each service's `index.ts` therefore starts with `import './instrumentation'`.

**Traces are used for correlation, not exported.** Spans exist so the trace ID passes across services
and gets stamped on every log record. No span exporter runs by default (`OTEL_TRACES_CONSOLE=true` prints
them). The platform rebuilds a request from logs that share a trace ID.

**The DB pool is simulated in-process.** `SimulatedDbPool` behaves like `pg.Pool`: fixed size, wait
queue, acquire timeout. This means the demo needs no database, and pool exhaustion is real contention,
not a fake error. It can be swapped for real Postgres later without changing the fault.

**Faults are invisible in the logs.** Toggles print to stderr only. This keeps the AI evaluation honest:
the investigator has to reason from symptoms.

**Faults change real code paths.** For example, `bad_deploy` makes the service read a currency table
that is actually missing entries, and the `TypeError` is thrown by ordinary code. Symptoms then look
like production failures, with real stack traces and only the affected currencies failing.

**Log attribute names follow OpenTelemetry semantic conventions** where one exists
(`http.request.method`, `http.route`, `http.response.status_code`, `exception.type`, `peer.service`,
`service.version`). Project-specific names use a dotted prefix (`order.id`, `payment.attempts`,
`db.pool.active`).

**The logger is never allowed to break a service.** The exporter catches every error, bounds its buffer,
and rate-limits its own warnings.

### Platform (Weeks 2 and 3)

**Two processes, one codebase.** `api.ts` only validates and publishes to Kafka, so ingestion stays fast
when OpenSearch is slow. `worker.ts` does the slow work: indexing and detection. The plan calls this a
modular monolith plus one worker. The folders under `src/` are the module boundaries, so they can be
split into services later.

**Kafka between ingest and indexing.** The API returns 202 only after Kafka acknowledges the batch
(`acks=all`). Concurrent requests share producer sends through `BatchingPublisher` (micro-batching,
up to 4 sends in flight). The producer is not idempotent: Kafka's idempotent mode allows one request
in flight, which made p99 latency 24 s under load. Duplicates are removed at storage instead (see
below), and log order comes from timestamps. Measured effect in [LOADTEST.md](LOADTEST.md). Messages are keyed by `service.name`, so each service's logs stay in
order within one partition. The topic has 6 partitions; with 3 services, 3 are in use.

**Idempotency is enforced at storage.** Each record carries a producer-made `eventId`. The worker writes
with `create` and `_id = eventId`, so a redelivered or resent event gets a 409 from OpenSearch and is counted
as a duplicate. Offsets are committed only after a batch is indexed or dead-lettered. That gives at-least-once
delivery with exactly-once storage.

**Nothing is silently dropped.** Invalid records (at the API or in the worker) and records OpenSearch
rejects after 3 attempts go to `logs.dlq`, with the original payload and a reason. If OpenSearch is
unreachable the worker throws, does not commit, and Kafka redelivers.

**Typed fields are promoted; the rest is a `flat_object`.** Attribute keys are arbitrary. With dynamic
mapping, `a.b` and `a.b.c` would conflict. The index mapping is `strict`. Fields used for filters and
aggregations get typed copies (`http.statusCode`, `durationMs`, `process.heapUsedMb`, `dbPool.waiting`,
`exceptionType`). All attributes are kept in `attributes` (`flat_object`), so any key is still searchable.
Daily indices (`logs-YYYY.MM.DD`) come from one index template.

**Metrics are computed from logs, not stored.** One OpenSearch aggregation per tick gives every service's
per-minute requests, 5xx count, latency percentiles and peak heap. There is no separate metrics store to
keep in sync.

**Detection is stateless.** Every 15 s the detector re-reads the last 40 complete minutes and rebuilds
each EWMA baseline (alpha 0.3, warm-up 5 minutes). A window is anomalous when z >= 3 *and* the increase
passes a minimum absolute delta (5 points of error rate, 100 ms or 50% p95, 64 MB heap). The delta rule
stops a 0% to 1% blip on a flat line from firing. Anomalous points do not update the baseline, so a
sustained failure keeps firing instead of becoming normal. Anomalies are unique on
(service, metric, window), so restarts and repeated passes never duplicate them. Only anomalies from
the last 5 minutes can open or extend an incident.

**Grouping by time.** An anomaly joins the open incident that had an anomaly in the last 10 minutes,
otherwise it opens a new one. A failing payment-service and the order-service errors it causes become
one incident with two services. When a service joins an incident, its deploys from the 30 minutes before
the start go on the timeline. A deploy is the usual first suspect, but it is recorded as context, not as a cause.

**Lifecycle.** `detected -> investigating -> identified -> resolved`. Resolved is final. An open incident
auto-resolves after 5 complete minutes with no anomaly. The rules live in `incidents/lifecycle.ts`
as pure functions.

**The platform logs to stdout only.** Sending its own logs through its own ingest would create a
feedback loop.

### Investigation (Weeks 4 and 5)

**Evidence first, then the model.** The investigator only reaches data through the `EvidenceLedger`.
Every query gets an id (`q1`, `q2`, ...) and its exact parameters are recorded, with absolute times only.
Findings must cite those ids with a machine-checkable `check`. The verifier re-runs each cited query and
keeps a claim only if the check holds on the fresh result. That is what "every claim backed by a real
log or metric query" means in code. Runbooks and past incidents are rejected as evidence: they describe
what usually happens, not what happened.

**A manual tool loop, not the SDK tool runner.** The loop must route every call through the ledger,
enforce a 14-turn and 4-minute budget, and handle `submit_findings` validation errors by asking again.
`submit_findings` uses `strict: true`, because forced `tool_choice` is not available on Claude Opus 5.5;
the prompt asks for it, and the loop nudges once if the model stops without it. Data tools in one turn run
in parallel, and all their results go back in one user message.

**Model and settings.** `claude-opus-5-5` by default (`LLM_MODEL`), effort `medium` (`LLM_EFFORT`).
Thinking is adaptive (the default). The top-level `cache_control` caches tools + system prompt + earlier
turns. `fallbacks: "default"` (beta `server-side-fallback-2026-07-01`) re-runs a request on a fallback
model if a safety classifier declines it. Cost is computed from `usage` per investigation and stored.

**No made-up confidence numbers.** Hypotheses carry `likelihood` (high, medium, low) and a rank. The
verifier reorders them: verified contradicting evidence pushes a hypothesis down.

**The rule-based playbook is a real fallback, and the baseline.** It runs three fixed queries
(`summarize_errors`, `get_recent_deploys`, `get_metrics`) and matches known failure patterns, ranked by
specificity: a deploy with new-version exceptions, slow queries, pool timeouts, heap warnings, retries
with a high attempt limit, gateway timeouts, gateway errors. Its findings go through the same verifier.
It is what runs without an API key, and what the LLM should beat on hard cases.

**Log fingerprints.** `summarize_errors` groups WARN+ logs by service and message with numbers and ids
masked, so 400 pool timeouts with different `waiting=` counts show up as one pattern with a count.

**Circuit breaker counts provider failures only.** Timeouts, connection errors, 429 and 5xx trip it.
A model that misbehaves (no submission, invalid findings) does not, because that is not an outage.

**Knowledge in Postgres.** Runbooks and incident memories are rows with a `vector(512)` column and an
HNSW index (`vector_cosine_ops`), queried with the `<=>` cosine-distance operator. Prisma cannot model
the vector type, so it is `Unsupported("vector(512)")`, writes and searches use `$executeRaw` /
`$queryRaw`, and the HNSW indexes are added by hand in the migration. The migration also runs
`CREATE EXTENSION IF NOT EXISTS vector`, so it works on any Postgres with pgvector, including Prisma's
shadow database.

**Local embeddings.** Anthropic has no embeddings endpoint, and adding an embedding provider or a 100 MB
local model for seven runbooks was not worth it. `embed()` hashes words and word pairs into 512 signed
buckets: deterministic, offline, lexical. The interface allows a neural embedder later.

### Dashboard (Week 6)

**Server components fetch, client components act.** Pages are server components that call the platform
API directly (`lib/api.ts`, `cache: 'no-store'`) and re-render every 8 to 15 s through `AutoRefresh`
(`router.refresh()`). Interactive parts (status changes, re-investigate, log search) are client
components that call `/api/platform/*`. `next.config.ts` rewrites that path to the platform API, so
there is no CORS setup.

**Charts follow the dataviz rules.**
- One measure per chart, never a second y-axis.
- One series per chart, so the title names it and no legend is needed.
- 2 px lines, a recessive grid, a crosshair tooltip.
- A dashed marker at the incident's first anomalous minute.
- A minimum y-axis top per unit, so a flat zero line is not drawn on a 0 to 400% scale.

Colors are CSS tokens in `globals.css` with light and dark values. Status colors are reserved for
state badges and always appear with an icon and a label.

### Operations

**Startup waits for its dependencies.** Containers report healthy a little before they accept clients,
especially after Docker Desktop restarts. The API and worker wrap each infrastructure step (Kafka topics,
producer, consumer, OpenSearch index template) in `withStartupRetry` (`src/startup.ts`): exponential
backoff up to 15 s, for up to 3 minutes. They do not exit and wait for a file change to restart.

**Infrastructure URLs use `127.0.0.1`, not `localhost`.** On the development laptop another Windows
process (`dllhost.exe`) listened on `[::1]` for every port Docker published. Node resolves `localhost`
to `::1` first, so the platform reached that process instead of Kafka, OpenSearch and Postgres, and
timed out. Redpanda also advertises `127.0.0.1:19092`, because Kafka clients reconnect to the
advertised address. Service-to-service HTTP (ports 4000 to 4003) is served by Node itself on both
stacks, so `localhost` is fine there.

**The eval saves after every scenario.** A full run takes about 100 minutes. If it is interrupted,
nothing measured is lost: the report and JSON are rewritten after each scenario. `tools/eval/src/recover.ts`
rebuilds rows from a harness log plus the platform API for runs from before that change.

**Prisma 6, not 7.** Prisma 7 requires driver adapters and a config file. Prisma 6.19 is stable and
needs neither. `npm audit` reports `deepmerge-ts` inside the Prisma CLI. That is a dev-time tool that
never sees untrusted input.

## Conventions

- Validate every request body with Zod and return `400 invalid_request` with `z.flattenError(...)` details.
- Throw `HttpError(status, code, message)` for expected failures. Anything else becomes a logged 500.
- Calls to other services use `callJson(url, { timeoutMs })`. There is always a timeout.
- Express 5 passes rejected promises from async handlers to the error handler, so no try/catch wrapper is needed.
- Log one line per business event, with IDs in attributes, not only in the message.
- No `console.log` in services. Use the logger. (stderr is reserved for fault notes and exporter warnings.)

## How to...

**Add a fault.** In the service, call `.define({ name, description, params: z.object({...defaults}), onEnable?, onDisable? })`
on its `FaultRegistry`, then check `faults.active<Params>('name')` where the behaviour changes. Document it in
[FAULTS.md](FAULTS.md), [API.md](API.md) and the Postman collection.

**Add a service.** Copy `services/gateway-mock`, change the name, port and version in `identity.ts` and
`instrumentation.ts`, add a `dev:<name>` script in the root `package.json`, and add it to `dev:services`.

**Change the database schema.** Edit `apps/platform/prisma/schema.prisma`, then run `npm run db:migrate`.
The migration is created under `prisma/migrations/`; commit it.

**Promote a new attribute for aggregation.** Add the typed field to the index template in
`clients/opensearch.ts` and to `toLogDocument()` in `logs/document.ts`. Existing daily indices keep the
old mapping; the field appears from the next index.

**Add an investigator tool.** Add its Zod input to `toolInputs`, its definition to `TOOL_DEFINITIONS` and a
case to `run()` in `investigation/tools.ts`. Fill the `ToolResult` fields (`count`, `texts`, `metrics`,
`deploys`) that checks can evaluate, or the verifier will reject claims that cite it.

**Add a failure pattern to the playbook.** Add a rule in `investigation/rule-based.ts` with a score
that places it correctly against the others, plus a scenario in `tools/eval/src/scenarios.ts` to measure it.

**Add a runbook.** Drop a Markdown file in `docs/runbooks/`. The worker syncs it at its next start.

**Add an eval scenario.** Append to `SCENARIOS` in `tools/eval/src/scenarios.ts` (faults, an optional red-herring
deploy, the expected category and service), then run `npm run eval -- --only <id>`.

**Add a log field everywhere.** Change `logRecordSchema` in `log-schema.ts`, then `logger.ts`. TypeScript
flags anything that no longer matches.

## Environment variables

See [.env.example](../.env.example). The important ones:

| Variable | Default | Effect |
|---|---|---|
| `LOG_INGEST_URL` | empty | Platform ingest endpoint; empty means stdout only |
| `LOG_FORMAT` | `pretty` | `json` prints raw OTel records |
| `LOG_LEVEL` | `info` | Lowest severity printed and sent |
| `SERVICE_VERSION` | per service | Overrides the reported version |
| `PAYMENT_GATEWAY_TIMEOUT_MS` | 2000 | Payment to gateway timeout |
| `ORDER_PAYMENT_TIMEOUT_MS` | 5000 | Order to payment timeout |
| `GATEWAY_MAX_CONCURRENT` | 40 | Gateway concurrency limit |
| `OTEL_TRACES_CONSOLE` | unset | `true` prints spans to stdout |
| `DEPLOY_WEBHOOK_URL` | empty | Where `bad_deploy` records its deploy |
| `PLATFORM_PORT` | 4000 | Platform API port |
| `DATABASE_URL` | local compose DB | Postgres for Prisma |
| `OPENSEARCH_URL` | `http://localhost:9200` | Log store |
| `KAFKA_BROKERS` | `localhost:19092` | Redpanda |
| `DETECT_INTERVAL_MS` | 15000 | How often the detector runs |
| `ANTHROPIC_API_KEY` | unset | Enables the LLM investigator; without it the rule-based playbook runs |
| `LLM_MODEL` | `claude-opus-5-5` | Model for investigations |
| `LLM_EFFORT` | `medium` | `low` / `medium` / `high` / `xhigh` / `max` |
| `RUNBOOK_DIR` | `docs/runbooks` | Where runbooks are synced from |
| `PLATFORM_URL` | `http://localhost:4000` | Used by the dashboard and the eval harness |

## Testing

- `npm test` runs Vitest (68 tests). Week 1: pool, fault registry, log schema, exporter. Weeks 2 and 3:
  EWMA detection, incident lifecycle, log-to-document mapping, batch splitting, worker message parsing,
  and the request logger, including requests the client abandons (499). Weeks 4 and 5: every verifier
  check, verification end to end with a fake ledger (invented ids, runbook citations, re-ranking), the
  circuit breaker, log fingerprints, the embedder, and the agent loop against a scripted fake model
  (tool calls through the ledger, parallel results in one message, invalid submissions, nudge, refusal).
- `npm run eval` measures root-cause accuracy end to end on the live system; see [EVAL.md](EVAL.md).
- `npm run loadtest` measures ingestion throughput and latency; see [LOADTEST.md](LOADTEST.md).
- CI (`.github/workflows/ci.yml`) runs typecheck, unit tests and the dashboard build on every push.
- `npm run typecheck` runs `tsc --noEmit` in every workspace.
- Fault behaviour was checked by hand with the traffic generator. Results are in [FAULTS.md](FAULTS.md).
  The Week 5 eval harness will automate this.
