# Progress

Plan: 6-week MVP, 5 Oct to 15 Nov 2026 (see the product plan Google Doc). Update this file at the end of
every work session.

## Weeks

| Week | Dates | Goal | Status |
|---|---|---|---|
| 1 | Oct 5 to 11 | Demo services, OTel logs and traces, fault injection, docker-compose | Done early (Oct 2 to 3) |
| 2 | Oct 12 to 18 | POST /logs, Kafka, worker, OpenSearch, idempotency, DLQ, log search, trace view | Done early (Oct 3) |
| 3 | Oct 19 to 25 | 1-minute metrics, EWMA / z-score detection, deploy tracking, incident grouping and lifecycle | Done early (Oct 3) |
| 4 | Oct 26 to Nov 1 | Tool-calling AI investigator, evidence verifier, ranked hypotheses, resilience + fallback | Not started |
| 5 | Nov 2 to 8 | Eval harness over every fault scenario; runbook and past-incident search with pgvector | Not started |
| 6 | Nov 9 to 15 | Next.js dashboard (CSS Modules), k6 load test, README numbers, demo video | Not started |

## Week 1 checklist

- [x] Monorepo: npm workspaces, strict TypeScript, tsx, Vitest
- [x] Shared OTel log schema (Zod), the contract for Week 2 ingestion
- [x] Logger with automatic trace and span IDs, pretty or JSON output, batched HTTP exporter
- [x] OpenTelemetry tracing with trace propagation across services (checked: one trace ID across all three)
- [x] order-service, payment-service, gateway-mock
- [x] Fault endpoints: db_pool_exhaustion, gateway_timeout, gateway_errors, bad_deploy, memory_leak, retry_storm
- [x] Traffic generator with steady and burst modes
- [x] Process monitor (heap, RSS, event-loop delay, pool usage)
- [x] Unit tests (17 passing)
- [x] docker-compose: Redpanda + console, OpenSearch, Postgres with pgvector
- [x] Run `docker compose up` and confirm all four containers are healthy
- [x] Graphify knowledge graph (`graphify-out/`): 437 nodes, 638 edges, 32 communities

## Week 2 checklist

- [x] Platform workspace `apps/platform`: API process + worker process
- [x] `POST /api/v1/logs`: per-record validation, Kafka publish (`acks=all`, idempotent producer), 202
- [x] Kafka topics `logs.raw` (6 partitions, keyed by service) and `logs.dlq`, created on startup
- [x] Worker: consumer group `log-indexer`, bulk index to daily `logs-*` indices, commit after store
- [x] Idempotent processing: `_id = eventId` + `create` (checked: same event sent 3 times, stored once)
- [x] Dead-letter queue for invalid and rejected records, with the original payload (checked in Redpanda)
- [x] Index template: strict mapping, typed promoted fields, `flat_object` attributes
- [x] Log search: service, minimum level, time range, full text, trace ID, attribute filters, cursor paging
- [x] Trace view: one request across 3 services, in order (checked)
- [x] Pipeline stats endpoint with measured lag (p50 546 ms, p95 1.0 s)
- [ ] API key per service (should have, skipped until the end-to-end demo works)

## Week 3 checklist

- [x] Per-minute service metrics from logs: requests, 5xx rate, p50/p95/p99 latency, peak heap
- [x] `GET /api/v1/services` and `GET /api/v1/metrics`
- [x] EWMA / z-score detection with warm-up, minimum-delta guard and clean baselines (unit tested)
- [x] Stateless, idempotent detector loop in the worker (every 15 s)
- [x] Deploy tracking: `POST/GET /api/v1/deploys`; the bad_deploy fault posts its deploy like CI/CD would
- [x] Incidents in Postgres (Prisma): grouping, severity, deploy correlation on the timeline
- [x] Lifecycle `detected -> investigating -> identified -> resolved`, PATCH endpoint, auto-resolve
- [x] Injected fault opens an incident: bad deploy detected in 74.5 s (target under 2 min)
- [ ] Slack webhook alert (should have, skipped)

## Log

### 2026-10-03: Weeks 2 and 3 built

- Built the platform: ingestion through Kafka into OpenSearch, search and trace APIs, metrics,
  anomaly detection, deploys and incidents. Test count went from 17 to 40 (detection, lifecycle,
  pipeline mapping). Postman has 4 new platform folders, and newman passes them against the live stack.
- End-to-end check with 10 orders/s:
  - 6-minute baseline, then bad_deploy at 19:40:05.
  - INC-1 opened at 19:41:20 (74.5 s): critical, payment-service + order-service, with the 1.5.0 deploy on the timeline.
  - Rolled back at 19:43:00.
- Decisions (details in CODEBASE.md):
  - Prisma 6 rather than 7.
  - Idempotency is enforced at storage (`_id = eventId`).
  - Metrics are computed from logs; detection is stateless.
  - Incidents are grouped by a 10-minute window.
- Second scenario: gateway_timeout. INC-2 opened in 56.7 s (p95 latency on order + payment). A hotfix
  deploy posted while it was open appeared on its timeline.
- Resilience: OpenSearch stopped for 40 s under traffic.
  - Ingest kept returning 202.
  - The worker failed its batches without committing; Kafka redelivered them after recovery.
  - Result: 0 lost (the outage minutes had normal request counts), 5,471 redelivered duplicates
    dropped by `_id = eventId`, consumer lag back to 0, no false incident.
- Bug found and fixed: requests a caller abandoned (timeout) were never logged, because `finish` does
  not fire. `requestLogger` now listens for `close` and logs them as 499 with `http.client_aborted`.
  Covered by a new unit test.
- Bug found and fixed: deploys made while an incident was open (rollbacks, hotfixes) were not on its
  timeline. They are now attached.
- Known: during a long OpenSearch outage the worker's batch retry outlasts the Kafka session, so the
  group rebalances. It rejoins by itself and nothing is lost.
- Known noise: kafkajs prints a `TimeoutNegativeWarning` on Node 24 and a harmless topic-creation race
  error when the API and worker start together.

### 2026-10-03: Infra running

- Docker Desktop installed (Docker 29.8, Compose 5.5; 8 GB and 8 CPUs given to Docker).
- `docker compose up -d` started all four containers and they report healthy:
  - OpenSearch 2.17: cluster green, about 1.0 GB RAM
  - Postgres 16 with pgvector 0.8.7
  - Redpanda: cluster healthy, about 130 MB RAM
  - Redpanda Console at http://localhost:8080
- The whole stack uses about 1.3 GB.
- First graphify build: 437 nodes, 638 edges, 32 communities (see `graphify-out/GRAPH_REPORT.md`, open `graphify-out/graph.html`).

### 2026-10-02: Week 1 built

- Built everything in the Week 1 checklist except running the infra.
- Ran every fault under traffic; results are in [FAULTS.md](FAULTS.md).
- Bugs found and fixed while testing:
  - Memory leak did not show in `heap_used_mb`: Node keeps large strings outside the V8 heap.
    The leak now uses many small strings, and the cap uses measured heap.
  - `HttpLogExporter.shutdown()` exited early while a batch was in flight and lost logs. Caught by a unit test.
- Decision: the DB pool is simulated in-process, so Week 1 runs without Docker. See [CODEBASE.md](CODEBASE.md).
- Decision: fault toggles never reach the log stream, which keeps the AI evaluation honest.
