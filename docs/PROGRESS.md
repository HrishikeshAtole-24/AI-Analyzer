# Progress

Plan: 6-week MVP, 5 Oct to 15 Nov 2026 (see the product plan Google Doc). Update this file at the end of
every work session.

## Weeks

| Week | Dates | Goal | Status |
|---|---|---|---|
| 1 | Oct 5 to 11 | Demo services, OTel logs and traces, fault injection, docker-compose | Done early (Oct 2 to 3) |
| 2 | Oct 12 to 18 | POST /logs, Kafka, worker, OpenSearch, idempotency, DLQ, log search, trace view | Not started |
| 3 | Oct 19 to 25 | 1-minute metrics, EWMA / z-score detection, deploy tracking, incident grouping and lifecycle | Not started |
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
- [ ] Graphify knowledge graph (`graphify-out/`): graphify is installed, graph not built yet

## Log

### 2026-10-03: Infra running

- Docker Desktop installed (Docker 29.8, Compose 5.5; 8 GB and 8 CPUs given to Docker).
- `docker compose up -d` started all four containers and they report healthy:
  - OpenSearch 2.17: cluster green, about 1.0 GB RAM
  - Postgres 16 with pgvector 0.8.7
  - Redpanda: cluster healthy, about 130 MB RAM
  - Redpanda Console at http://localhost:8080
- The whole stack uses about 1.3 GB.

### 2026-10-02: Week 1 built

- Built everything in the Week 1 checklist except running the infra.
- Ran every fault under traffic; results are in [FAULTS.md](FAULTS.md).
- Bugs found and fixed while testing:
  - Memory leak did not show in `heap_used_mb`: Node keeps large strings outside the V8 heap.
    The leak now uses many small strings, and the cap uses measured heap.
  - `HttpLogExporter.shutdown()` exited early while a batch was in flight and lost logs. Caught by a unit test.
- Decision: the DB pool is simulated in-process, so Week 1 runs without Docker. See [CODEBASE.md](CODEBASE.md).
- Decision: fault toggles never reach the log stream, which keeps the AI evaluation honest.
