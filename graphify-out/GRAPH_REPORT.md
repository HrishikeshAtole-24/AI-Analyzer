# Graph Report - AI Analyzer  (2026-10-03)

## Corpus Check
- 42 files · ~29,986 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 612 nodes · 988 edges · 40 communities (28 shown, 12 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 21 edges (avg confidence: 0.88)
- Token cost: 86,482 input · 0 output

## Community Hubs (Navigation)
- Platform Clients and Ingest
- Shared HTTP Layer
- Detection, Deploys and Incidents
- Service Packages
- Shared Package and OTel
- Root Workspace Config
- Docs and Conventions
- Platform Package
- Traffic Generator
- Payment Service Logic
- Fault Registry
- Order Service Logic
- Ingestion Design Decisions
- Simulated DB Pool
- Postman Builder
- Logger and Gateway Mock
- TypeScript Base Config
- Metrics Aggregation
- Logger Interface
- Service Identity and Env
- Traffic Generator Package
- Platform and Shared TS Config
- Detection and Incident Design
- Trace Correlation
- Process Monitor
- Gateway TS Config
- Order TS Config
- Payment TS Config
- Traffic TS Config
- Demo Service Endpoints
- Redpanda Containers
- Log Search Mapping
- Retry Storm Faults
- OpenSearch Container
- Postgres Container
- Pipeline Stats Endpoint
- OTel Attribute Conventions
- Memory Leak Fault
- System Architecture
- Dashboard (Planned)

## God Nodes (most connected - your core abstractions)
1. `scripts` - 19 edges
2. `FaultRegistry` - 14 edges
3. `compilerOptions` - 13 edges
4. `HttpLogExporter` - 11 edges
5. `Logger` - 11 edges
6. `scripts` - 10 edges
7. `main()` - 10 edges
8. `vitest` - 10 edges
9. `SimulatedDbPool` - 9 edges
10. `config` - 9 edges

## Surprising Connections (you probably didn't know these)
- `Results Metrics (lag, time to detect, throughput, accuracy)` --references--> `Week 5 Eval Harness (ground truth)`  [INFERRED]
  README.md → docs/FAULTS.md
- `Results Metrics (lag, time to detect, throughput, accuracy)` --references--> `INC-1 Bad Deploy Detected in 74.5 s`  [INFERRED]
  README.md → docs/PROGRESS.md
- `CLAUDE.md (Claude Code notes)` --references--> `Faults Invisible in Logs (stderr only)`  [INFERRED]
  CLAUDE.md → docs/CODEBASE.md
- `Fixed Tech Stack Rule` --conceptually_related_to--> `6-Week MVP Plan (Oct 5 to Nov 15 2026)`  [INFERRED]
  CLAUDE.md → docs/PROGRESS.md
- `AI Investigator` --conceptually_related_to--> `Evidence Verifier`  [INFERRED]
  README.md → docs/PROJECT_FLOW.md

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **At-least-once delivery with exactly-once storage** — docs_codebase_kafka_between_ingest_indexing, docs_codebase_idempotency_at_storage, docs_codebase_dead_letter_queue, docs_project_flow_ingestion_pipeline, docs_progress_opensearch_outage_test [EXTRACTED 1.00]
- **Metrics -> EWMA detection -> incident grouping -> lifecycle** — docs_codebase_metrics_from_logs, docs_codebase_stateless_detection, docs_codebase_incident_grouping, docs_codebase_incident_lifecycle, docs_project_flow_detection_flow [EXTRACTED 1.00]
- **Fault scenarios as eval ground truth** — docs_faults_db_pool_exhaustion, docs_faults_gateway_timeout, docs_faults_bad_deploy, docs_faults_memory_leak, docs_faults_retry_storm, docs_faults_gateway_errors, docs_faults_eval_harness [EXTRACTED 1.00]

## Communities (40 total, 12 thin omitted)

### Community 0 - "Platform Clients and Ingest"
Cohesion: 0.07
Nodes (43): main(), createProducer(), DeadLetter, ensureTopics(), kafka, sendToDlq(), dailyIndex(), ensureLogTemplate() (+35 more)

### Community 1 - "Shared HTTP Layer"
Cohesion: 0.07
Nodes (29): callJson(), CLIENT_CLOSED_REQUEST, errorHandler(), faultRoutes(), requestLogger(), ServiceOptions, startService(), UpstreamError (+21 more)

### Community 2 - "Detection, Deploys and Incidents"
Cohesion: 0.08
Nodes (39): db, deployBody, deployRouter(), listQuery, detectOnce(), lastCompleteWindowEnd(), series(), startDetector() (+31 more)

### Community 3 - "Service Packages"
Cohesion: 0.04
Nodes (43): @ai-analyzer/shared, dependencies, @ai-analyzer/shared, express, zod, express, zod, main (+35 more)

### Community 4 - "Shared Package and OTel"
Cohesion: 0.06
Nodes (35): dependencies, express, @opentelemetry/api, @opentelemetry/core, @opentelemetry/instrumentation, @opentelemetry/instrumentation-express, @opentelemetry/instrumentation-http, @opentelemetry/instrumentation-undici (+27 more)

### Community 5 - "Root Workspace Config"
Cohesion: 0.05
Nodes (38): description, devDependencies, concurrently, tsx, @types/express, @types/node, typescript, vitest (+30 more)

### Community 6 - "Docs and Conventions"
Cohesion: 0.08
Nodes (24): CLAUDE.md (Claude Code notes), Deploys Endpoints (/api/v1/deploys), API Reference, Shared Error Response Shape, Fault Admin Endpoints (/admin/faults), Code Conventions (Zod validation, HttpError, callJson timeouts), Codebase Guide, FaultRegistry (+16 more)

### Community 7 - "Platform Package"
Cohesion: 0.07
Nodes (29): dependencies, @ai-analyzer/shared, express, kafkajs, @opensearch-project/opensearch, @prisma/client, zod, devDependencies (+21 more)

### Community 8 - "Traffic Generator"
Cohesion: 0.09
Nodes (25): burstEvery, burstRps, burstSeconds, CURRENCIES, currentRps(), durationS, fire(), maxInFlight (+17 more)

### Community 9 - "Payment Service Logic"
Cohesion: 0.10
Nodes (18): CURRENCIES, CURRENCIES_V2, isSupportedCurrency(), toMinorUnits(), ChargeResult, DEFAULT_RETRY, faults, GATEWAY_TIMEOUT_MS (+10 more)

### Community 10 - "Fault Registry"
Cohesion: 0.19
Nodes (6): FaultDefinition, FaultError, FaultRegistry, FaultState, FaultView, registry()

### Community 11 - "Order Service Logic"
Cohesion: 0.12
Nodes (12): HttpError, auditCache, dbError(), logger, Order, orderRequest, orders, OrderStatus (+4 more)

### Community 12 - "Ingestion Design Decisions"
Cohesion: 0.13
Nodes (11): POST /api/v1/logs (ingest), Dead-Letter Queue logs.dlq, HttpLogExporter, Kafka Between Ingest and Indexing, OTel Log Record Schema (Zod ingestion contract), requestLogger Middleware, Fault: gateway_timeout, Client-Abort 499 Logging Fix (+3 more)

### Community 13 - "Simulated DB Pool"
Cohesion: 0.19
Nodes (7): DbPoolOptions, PoolStats, PoolTimeoutError, SimulatedDbPool, sleep(), Waiter, faults

### Community 14 - "Postman Builder"
Cohesion: 0.14
Nodes (11): collection, count, disable(), enable(), environment, fs, order, orderOutcomes (+3 more)

### Community 15 - "Logger and Gateway Mock"
Cohesion: 0.14
Nodes (6): envInt(), createLogger(), chargeRequest, faults, logger, MAX_CONCURRENT

### Community 16 - "TypeScript Base Config"
Cohesion: 0.14
Nodes (13): compilerOptions, esModuleInterop, forceConsistentCasingInFileNames, module, moduleResolution, noEmit, noUncheckedIndexedAccess, resolveJsonModule (+5 more)

### Community 17 - "Metrics Aggregation"
Cohesion: 0.26
Nodes (10): Bucket, getPipelineStats(), getServiceMetrics(), listServices(), MinuteMetrics, PipelineStats, ServiceMetrics, ServiceSummary (+2 more)

### Community 19 - "Service Identity and Env"
Cohesion: 0.28
Nodes (5): env(), loggerOptionsFromEnv(), SERVICE, SERVICE, SERVICE

### Community 20 - "Traffic Generator Package"
Cohesion: 0.25
Nodes (7): main, name, private, scripts, start, typecheck, version

### Community 21 - "Platform and Shared TS Config"
Cohesion: 0.29
Nodes (5): extends, include, extends, include, ../../tsconfig.base.json

### Community 22 - "Detection and Incident Design"
Cohesion: 0.38
Nodes (4): GET /api/v1/metrics, Incidents Endpoints (/api/v1/incidents), Incident Lifecycle (detected->investigating->identified->resolved), Detection and Incidents Flow

### Community 23 - "Trace Correlation"
Cohesion: 0.67
Nodes (3): GET /api/v1/traces/:traceId, W3C traceparent Propagation, One Order End-to-End Flow

### Community 25 - "Gateway TS Config"
Cohesion: 0.50
Nodes (3): extends, include, ../../tsconfig.base.json

### Community 26 - "Order TS Config"
Cohesion: 0.50
Nodes (3): extends, include, ../../tsconfig.base.json

### Community 27 - "Payment TS Config"
Cohesion: 0.50
Nodes (3): extends, include, ../../tsconfig.base.json

### Community 28 - "Traffic TS Config"
Cohesion: 0.50
Nodes (3): extends, include, ../../tsconfig.base.json

### Community 29 - "Demo Service Endpoints"
Cohesion: 0.67
Nodes (3): POST /v1/charges (gateway-mock), POST /orders, POST /payments

## Ambiguous Edges - Review These
- `Shared Error Response Shape` → `SimulatedDbPool (in-process DB pool)`  [AMBIGUOUS]
  docs/CODEBASE.md · relation: conceptually_related_to

## Knowledge Gaps
- **266 isolated node(s):** `HttpLogExporterOptions`, `LogBatch`, `FaultDefinition`, `FaultState`, `FaultView` (+261 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 311 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **12 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What is the exact relationship between `Shared Error Response Shape` and `SimulatedDbPool (in-process DB pool)`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **Why does `@ai-analyzer/shared` connect `Service Packages` to `Platform Package`?**
  _High betweenness centrality (0.101) - this node is a cross-community bridge._
- **Why does `vitest` connect `Shared HTTP Layer` to `Platform Clients and Ingest`, `Detection, Deploys and Incidents`, `Root Workspace Config`, `Fault Registry`, `Simulated DB Pool`?**
  _High betweenness centrality (0.097) - this node is a cross-community bridge._
- **Why does `kafkajs` connect `Platform Clients and Ingest` to `Platform Package`?**
  _High betweenness centrality (0.086) - this node is a cross-community bridge._
- **What connects `HttpLogExporterOptions`, `LogBatch`, `FaultDefinition` to the rest of the system?**
  _266 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Platform Clients and Ingest` be split into smaller, more focused modules?**
  _Cohesion score 0.07390873015873016 - nodes in this community are weakly interconnected._
- **Should `Shared HTTP Layer` be split into smaller, more focused modules?**
  _Cohesion score 0.06708595387840671 - nodes in this community are weakly interconnected._