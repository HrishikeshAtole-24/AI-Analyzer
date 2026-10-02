# Graph Report - AI Analyzer  (2026-10-03)

## Corpus Check
- Corpus is ~16,625 words - fits in a single context window. You may not need a graph.

## Summary
- 437 nodes · 638 edges · 32 communities (29 shown, 3 thin omitted)
- Extraction: 95% EXTRACTED · 5% INFERRED · 0% AMBIGUOUS · INFERRED: 31 edges (avg confidence: 0.86)
- Token cost: 81,334 input · 0 output

## Community Hubs (Navigation)
- Config and Log Export
- Fault Registry
- Root Workspace Config
- Traffic Generator
- Shared Package and Tracing
- Payment Service Logic
- Order Service Logic
- Simulated DB Pool
- Gateway Mock Package
- Order Service Package
- Payment Service Package
- Postman Builder
- TypeScript Base Config
- Platform Architecture Plan
- OpenTelemetry Dependencies
- Gateway Mock Logic
- Payment Flow and Faults
- Docs and Fault Admin
- Log Ingestion Contract
- Order Flow and Faults
- Service Identity and Env
- Traffic Generator Package
- Tracing Design Decisions
- Infra and Incident Pipeline
- Process Monitor
- Shared TS Config
- Gateway TS Config
- Order TS Config
- Payment TS Config
- Traffic TS Config
- Upstream HTTP Calls
- Error Response Shape

## God Nodes (most connected - your core abstractions)
1. `FaultRegistry` - 16 edges
2. `compilerOptions` - 13 edges
3. `scripts` - 12 edges
4. `Logger` - 12 edges
5. `HttpLogExporter` - 11 edges
6. `Fault scenarios` - 11 edges
7. `SimulatedDbPool` - 10 edges
8. `@ai-analyzer/shared package` - 9 edges
9. `startService()` - 8 edges
10. `LogAttributes` - 8 edges

## Surprising Connections (you probably didn't know these)
- `System architecture (demo system -> platform API -> Kafka -> worker -> OpenSearch -> detector -> Postgres -> AI -> dashboard)` --semantically_similar_to--> `Ingestion pipeline (API -> logs.raw -> log worker -> OpenSearch logs-*, logs.dlq)`  [INFERRED] [semantically similar]
  README.md → docs/PROJECT_FLOW.md
- `Ingestion pipeline (API -> logs.raw -> log worker -> OpenSearch logs-*, logs.dlq)` --references--> `redpanda (Kafka-compatible broker)`  [INFERRED]
  docs/PROJECT_FLOW.md → docker-compose.yml
- `2026-10-03: Infra running (all four containers healthy)` --references--> `opensearch (single node, :9200)`  [INFERRED]
  docs/PROGRESS.md → docker-compose.yml
- `chargeWithRetry()` --calls--> `sleep()`  [EXTRACTED]
  services/payment-service/src/index.ts → packages/shared/src/db-pool.ts
- `Keep the docs in sync rule` --references--> `Fault scenarios`  [EXTRACTED]
  CLAUDE.md → docs/FAULTS.md

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Demo order -> payment -> gateway call chain** — docs_api_post_orders, docs_api_post_payments, docs_api_post_v1_charges, docs_codebase_traffic_generator, docs_api_traceparent_propagation [EXTRACTED 1.00]
- **Detection, investigation and verification pipeline** — docs_project_flow_anomaly_detector, docs_project_flow_incident_flow, docs_project_flow_ai_investigator, docs_project_flow_evidence_verifier, docker_compose_opensearch, docker_compose_postgres [EXTRACTED 1.00]
- **Injected fault scenarios (eval ground truth)** — docs_faults_db_pool_exhaustion, docs_faults_gateway_timeout, docs_faults_bad_deploy, docs_faults_memory_leak, docs_faults_retry_storm, docs_faults_gateway_errors, docs_faults_eval_harness [EXTRACTED 1.00]

## Communities (32 total, 3 thin omitted)

### Community 0 - "Config and Log Export"
Cohesion: 0.09
Nodes (18): envInt(), HttpLogExporter, HttpLogExporterOptions, attributeValue, LogBatch, logBatchSchema, LogRecord, logRecordSchema (+10 more)

### Community 1 - "Fault Registry"
Cohesion: 0.10
Nodes (15): FaultDefinition, FaultError, FaultRegistry, FaultState, FaultView, errorHandler(), faultRoutes(), requestLogger() (+7 more)

### Community 2 - "Root Workspace Config"
Cohesion: 0.06
Nodes (31): description, devDependencies, concurrently, tsx, @types/express, @types/node, typescript, vitest (+23 more)

### Community 3 - "Traffic Generator"
Cohesion: 0.09
Nodes (25): burstEvery, burstRps, burstSeconds, CURRENCIES, currentRps(), durationS, fire(), maxInFlight (+17 more)

### Community 4 - "Shared Package and Tracing"
Cohesion: 0.10
Nodes (22): exports, ./tracing, express, zod, main, name, private, scripts (+14 more)

### Community 5 - "Payment Service Logic"
Cohesion: 0.12
Nodes (17): CURRENCIES, CURRENCIES_V2, isSupportedCurrency(), toMinorUnits(), ChargeResult, DEFAULT_RETRY, faults, GATEWAY_TIMEOUT_MS (+9 more)

### Community 6 - "Order Service Logic"
Cohesion: 0.12
Nodes (12): HttpError, auditCache, dbError(), logger, Order, orderRequest, orders, OrderStatus (+4 more)

### Community 7 - "Simulated DB Pool"
Cohesion: 0.18
Nodes (8): DbPoolOptions, PoolStats, PoolTimeoutError, SimulatedDbPool, sleep(), Waiter, faults, chargeWithRetry()

### Community 8 - "Gateway Mock Package"
Cohesion: 0.12
Nodes (15): dependencies, @ai-analyzer/shared, express, zod, @ai-analyzer/shared, express, zod, main (+7 more)

### Community 9 - "Order Service Package"
Cohesion: 0.12
Nodes (15): dependencies, @ai-analyzer/shared, express, zod, @ai-analyzer/shared, express, zod, main (+7 more)

### Community 10 - "Payment Service Package"
Cohesion: 0.12
Nodes (15): dependencies, @ai-analyzer/shared, express, zod, @ai-analyzer/shared, express, zod, main (+7 more)

### Community 11 - "Postman Builder"
Cohesion: 0.15
Nodes (11): collection, count, disable(), enable(), environment, fs, order, orderOutcomes (+3 more)

### Community 12 - "TypeScript Base Config"
Cohesion: 0.14
Nodes (13): compilerOptions, esModuleInterop, forceConsistentCasingInFileNames, module, moduleResolution, noEmit, noUncheckedIndexedAccess, resolveJsonModule (+5 more)

### Community 13 - "Platform Architecture Plan"
Cohesion: 0.22
Nodes (12): Postman collection (AI-Analyzer.postman_collection.json, build-postman.cjs), opensearch (single node, :9200), API reference, Week 5 eval harness (8 of 10 correct goal), Project flow, AI investigator (tools: search_logs, get_metrics, get_recent_deploys, get_trace), Evidence verifier (re-runs every cited query), Ingestion pipeline (API -> logs.raw -> log worker -> OpenSearch logs-*, logs.dlq) (+4 more)

### Community 14 - "OpenTelemetry Dependencies"
Cohesion: 0.15
Nodes (13): dependencies, express, @opentelemetry/api, @opentelemetry/core, @opentelemetry/instrumentation, @opentelemetry/instrumentation-express, @opentelemetry/instrumentation-http, @opentelemetry/instrumentation-undici (+5 more)

### Community 15 - "Gateway Mock Logic"
Cohesion: 0.15
Nodes (4): chargeRequest, faults, logger, MAX_CONCURRENT

### Community 16 - "Payment Flow and Faults"
Cohesion: 0.23
Nodes (11): gateway-mock (port 4003), Payment model, payment-service (port 4002), POST /payments, POST /v1/charges, payment-service currency.ts (broken v2 table), bad_deploy fault (v1.5.0), gateway_errors fault (+3 more)

### Community 17 - "Docs and Fault Admin"
Cohesion: 0.20
Nodes (10): AI Analyzer: notes for Claude Code, Graphify knowledge graph rebuild (graphify-out/), Fault admin endpoints (/admin/faults), FaultView, FaultRegistry, Codebase guide, OpenTelemetry semantic conventions for log attributes, traffic-generator CLI (+2 more)

### Community 18 - "Log Ingestion Contract"
Cohesion: 0.27
Nodes (10): OTel log record format (eventId, severity, traceId, resource, attributes), Platform API (port 4000, planned), POST /api/v1/logs, createLogger(), http.ts (startService, requestLogger, callJson, error handler), HttpLogExporter, log-schema.ts (logRecordSchema, ingestion contract), @ai-analyzer/shared package (+2 more)

### Community 19 - "Order Flow and Faults"
Cohesion: 0.22
Nodes (9): GET /health, Order model, order-service (port 4001), POST /orders, Process monitor (startProcessMonitor, 15 s samples), SimulatedDbPool, db_pool_exhaustion fault, memory_leak fault (+1 more)

### Community 20 - "Service Identity and Env"
Cohesion: 0.28
Nodes (5): env(), loggerOptionsFromEnv(), SERVICE, SERVICE, SERVICE

### Community 21 - "Traffic Generator Package"
Cohesion: 0.25
Nodes (7): main, name, private, scripts, start, typecheck, version

### Community 22 - "Tracing Design Decisions"
Cohesion: 0.29
Nodes (4): Fixed tech stack (TypeScript, Express, KafkaJS, OpenSearch, Postgres+Prisma+pgvector, Zod, Next.js CSS Modules, Vitest), W3C traceparent propagation, initTracing() (separate tracing entry point), One order end to end (sequence)

### Community 23 - "Infra and Incident Pipeline"
Cohesion: 0.29
Nodes (7): postgres (pgvector pg16, :5432), redpanda (Kafka-compatible broker), redpanda-console (web UI :8080), 2026-10-03: Infra running (all four containers healthy), Metrics + anomaly detector (EWMA / z-score), Incident flow (detected -> identified), Next.js dashboard (Week 6)

### Community 25 - "Shared TS Config"
Cohesion: 0.50
Nodes (3): extends, include, ../../tsconfig.base.json

### Community 26 - "Gateway TS Config"
Cohesion: 0.50
Nodes (3): extends, include, ../../tsconfig.base.json

### Community 27 - "Order TS Config"
Cohesion: 0.50
Nodes (3): extends, include, ../../tsconfig.base.json

### Community 28 - "Payment TS Config"
Cohesion: 0.50
Nodes (3): extends, include, ../../tsconfig.base.json

### Community 29 - "Traffic TS Config"
Cohesion: 0.50
Nodes (3): extends, include, ../../tsconfig.base.json

## Knowledge Gaps
- **206 isolated node(s):** `name`, `version`, `private`, `description`, `workspaces` (+201 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 234 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **3 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `vitest` connect `Config and Log Export` to `Fault Registry`, `Root Workspace Config`, `Simulated DB Pool`?**
  _High betweenness centrality (0.071) - this node is a cross-community bridge._
- **Why does `@opentelemetry/api` connect `Shared Package and Tracing` to `Config and Log Export`?**
  _High betweenness centrality (0.045) - this node is a cross-community bridge._
- **Why does `FaultRegistry` connect `Fault Registry` to `Payment Service Logic`, `Order Service Logic`, `Gateway Mock Logic`?**
  _High betweenness centrality (0.030) - this node is a cross-community bridge._
- **What connects `name`, `version`, `private` to the rest of the system?**
  _206 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Config and Log Export` be split into smaller, more focused modules?**
  _Cohesion score 0.09041835357624832 - nodes in this community are weakly interconnected._
- **Should `Fault Registry` be split into smaller, more focused modules?**
  _Cohesion score 0.0990990990990991 - nodes in this community are weakly interconnected._
- **Should `Root Workspace Config` be split into smaller, more focused modules?**
  _Cohesion score 0.0625 - nodes in this community are weakly interconnected._