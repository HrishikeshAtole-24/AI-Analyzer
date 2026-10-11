# Graph Report - AI Analyzer  (2026-10-11)

## Corpus Check
- 90 files · ~58,637 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 966 nodes · 1738 edges · 58 communities (53 shown, 5 thin omitted)
- Extraction: 96% EXTRACTED · 4% INFERRED · 0% AMBIGUOUS · INFERRED: 67 edges (avg confidence: 0.85)
- Token cost: 92,873 input · 0 output

## Community Hubs (Navigation)
- Detection, Deploys and Incidents
- Platform API and Ingestion
- Postman and Scripts
- Service Packages
- Root Workspace Config
- Shared Package and OTel
- Platform Package
- Traffic Generator
- CI and Architecture Docs
- Dashboard Pages and API Types
- Dashboard Package
- Eval and Playbook Design
- Dashboard Incident Pages
- Dashboard TS Config
- Order Service Logic
- Rule-Based Playbook
- Log Search
- Fault Registry
- API and Knowledge Docs
- Payment Service Logic
- Simulated DB Pool
- LLM Agent
- Findings Schema
- Infrastructure and Ingest Docs
- TypeScript Base Config
- Dashboard Layout
- Evidence Verifier
- Investigator Tools and Ledger
- Investigation Tests
- Shared HTTP Layer
- Shared Package Tests
- Log Search UI
- Gateway Mock Logic
- Log Schema
- Config and Logger
- Incident Detail UI
- Metric Chart
- Platform and Shared TS Config
- HTTP Log Exporter
- Logger Interface
- Badges and Incident Actions
- Project Docs and Rules
- k6 Load Test
- Service Identity and Env
- Eval Package
- Traffic Generator Package
- Detection and Incident Design
- Investigator Design
- Currency Conversion
- Process Monitor
- Gateway TS Config
- Order Pricing
- Order TS Config
- Payment TS Config
- Traffic TS Config
- Load Test Cleanup
- System Architecture
- Results Metrics

## God Nodes (most connected - your core abstractions)
1. `Codebase guide` - 44 edges
2. `scripts` - 23 edges
3. `investigateIncident()` - 18 edges
4. `zod` - 17 edges
5. `compilerOptions` - 16 edges
6. `CLAUDE.md project notes` - 15 edges
7. `IncidentPage()` - 14 edges
8. `vitest` - 14 edges
9. `compilerOptions` - 13 edges
10. `FaultRegistry` - 12 edges

## Surprising Connections (you probably didn't know these)
- `Knowledge base in Postgres + pgvector (HNSW)` --references--> `Postgres 16 with pgvector`  [INFERRED]
  docs/CODEBASE.md → docker-compose.yml
- `Redpanda (Kafka-compatible broker)` --conceptually_related_to--> `Infrastructure URLs use 127.0.0.1`  [INFERRED]
  docker-compose.yml → docs/CODEBASE.md
- `CLAUDE.md project notes` --references--> `API reference`  [EXTRACTED]
  CLAUDE.md → docs/API.md
- `CLAUDE.md project notes` --references--> `Codebase guide`  [EXTRACTED]
  CLAUDE.md → docs/CODEBASE.md
- `CLAUDE.md project notes` --references--> `EvidenceLedger`  [EXTRACTED]
  CLAUDE.md → docs/CODEBASE.md

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Ingestion pipeline: API -> Kafka -> worker -> OpenSearch** — docs_api_post_api_v1_logs, docs_codebase_kafka_between_ingest_and_indexing, docs_codebase_batchingpublisher, docs_codebase_idempotency_at_storage, docs_codebase_dead_letter_topic, docker_compose_redpanda, docker_compose_opensearch [EXTRACTED 1.00]
- **Evidence-first investigation with verification** — docs_codebase_evidenceledger, docs_codebase_verifier, docs_codebase_manual_tool_loop, docs_codebase_rule_based_playbook, docs_codebase_no_confidence_numbers, docs_codebase_circuit_breaker [EXTRACTED 1.00]
- **Runbooks synced into pgvector knowledge base** — docs_codebase_knowledge_in_postgres_pgvector, docs_codebase_local_feature_hashing_embeddings, docs_runbooks_bad_deploy_rollback, docs_runbooks_db_pool_exhaustion, docs_runbooks_gateway_errors, docs_runbooks_gateway_timeouts, docs_runbooks_memory_leak, docs_runbooks_retry_storm, docs_runbooks_slow_queries [INFERRED 0.85]

## Communities (58 total, 5 thin omitted)

### Community 0 - "Detection, Deploys and Incidents"
Cohesion: 0.05
Nodes (62): db, deployBody, deployRouter(), listQuery, detectOnce(), lastCompleteWindowEnd(), series(), startDetector() (+54 more)

### Community 1 - "Platform API and Ingestion"
Cohesion: 0.06
Nodes (44): main(), BatchingPublisher, Pending, createProducer(), DeadLetter, ensureTopics(), kafka, sendToDlq() (+36 more)

### Community 2 - "Postman and Scripts"
Cohesion: 0.07
Nodes (36): collection, count, disable(), enable(), environment, fs, order, orderOutcomes (+28 more)

### Community 3 - "Service Packages"
Cohesion: 0.04
Nodes (42): dependencies, @ai-analyzer/shared, express, zod, express, zod, main, name (+34 more)

### Community 4 - "Root Workspace Config"
Cohesion: 0.05
Nodes (42): description, devDependencies, concurrently, tsx, @types/express, @types/node, typescript, vitest (+34 more)

### Community 5 - "Shared Package and OTel"
Cohesion: 0.06
Nodes (34): dependencies, express, @opentelemetry/api, @opentelemetry/core, @opentelemetry/instrumentation, @opentelemetry/instrumentation-express, @opentelemetry/instrumentation-http, @opentelemetry/instrumentation-undici (+26 more)

### Community 6 - "Platform Package"
Cohesion: 0.06
Nodes (30): dependencies, @ai-analyzer/shared, @anthropic-ai/sdk, express, kafkajs, @opensearch-project/opensearch, @prisma/client, zod (+22 more)

### Community 7 - "Traffic Generator"
Cohesion: 0.09
Nodes (25): burstEvery, burstRps, burstSeconds, CURRENCIES, currentRps(), durationS, fire(), maxInFlight (+17 more)

### Community 8 - "CI and Architecture Docs"
Cohesion: 0.12
Nodes (10): CI workflow, CI check job (typecheck, tests, dashboard build), Fault admin endpoints (/admin/faults), GET /api/v1/traces/:traceId, Codebase guide, Dashboard: server components fetch, client components act, Dashboard chart rules (one measure per chart), FaultRegistry (+2 more)

### Community 9 - "Dashboard Pages and API Types"
Cohesion: 0.14
Nodes (15): dynamic, dynamic, Anomaly, Evidence, Hypothesis, Incident, IncidentDetail, IncidentEvent (+7 more)

### Community 10 - "Dashboard Package"
Cohesion: 0.10
Nodes (19): dependencies, next, react, react-dom, recharts, devDependencies, @types/react, @types/react-dom (+11 more)

### Community 11 - "Eval and Playbook Design"
Cohesion: 0.15
Nodes (18): Log fingerprints (summarize_errors), Rule-based playbook (fallback and baseline), Control scenario (no false incident), Eval harness (npm run eval), Red-herring deploy scenario, Eval scenarios (scenarios.ts ground truth), Fault: decline_spike (control), Fault: gateway_errors (+10 more)

### Community 12 - "Dashboard Incident Pages"
Cohesion: 0.23
Nodes (15): IncidentPage(), dynamic, FILTERS, IncidentsPage(), ServicesPage(), TracePage(), AutoRefresh(), Pill() (+7 more)

### Community 13 - "Dashboard TS Config"
Cohesion: 0.11
Nodes (18): compilerOptions, allowJs, esModuleInterop, incremental, isolatedModules, jsx, lib, module (+10 more)

### Community 14 - "Order Service Logic"
Cohesion: 0.12
Nodes (13): auditCache, dbError(), faults, logger, Order, orderRequest, orders, OrderStatus (+5 more)

### Community 15 - "Rule-Based Playbook"
Cohesion: 0.16
Nodes (11): Check, Hypothesis, Candidate, check(), IncidentForInvestigation, Pattern, runRuleBasedInvestigation(), textEvidence() (+3 more)

### Community 16 - "Log Search"
Cohesion: 0.18
Nodes (14): LogDocument, logRouter(), buildLogFilters(), Clause, decodeCursor(), encodeCursor(), getTrace(), LogPage (+6 more)

### Community 17 - "Fault Registry"
Cohesion: 0.19
Nodes (7): FaultDefinition, FaultError, FaultRegistry, FaultState, FaultView, registry(), zod

### Community 18 - "API and Knowledge Docs"
Cohesion: 0.18
Nodes (16): API reference, POST/GET /api/v1/deploys, GET /api/v1/runbooks, GET /api/v1/incidents/:id/similar, Knowledge base in Postgres + pgvector (HNSW), Fault: bad_deploy, Fault: db_pool_exhaustion, Fault: memory_leak (+8 more)

### Community 19 - "Payment Service Logic"
Cohesion: 0.13
Nodes (14): ChargeResult, DEFAULT_RETRY, faults, GATEWAY_TIMEOUT_MS, GATEWAY_URL, logger, Payment, paymentRequest (+6 more)

### Community 20 - "Simulated DB Pool"
Cohesion: 0.19
Nodes (6): DbPoolOptions, PoolStats, PoolTimeoutError, SimulatedDbPool, sleep(), Waiter

### Community 21 - "LLM Agent"
Cohesion: 0.16
Nodes (12): Findings, findingsJsonSchema, findingsSchema, AgentError, AgentResult, cost(), CreateMessage, EFFORT (+4 more)

### Community 22 - "Findings Schema"
Cohesion: 0.16
Nodes (11): CATEGORIES, Category, CATEGORY_HELP, CHECK_KINDS, checkJson, checkSchema, evidenceJson, evidenceSchema (+3 more)

### Community 23 - "Infrastructure and Ingest Docs"
Cohesion: 0.18
Nodes (12): docker-compose infrastructure, OpenSearch, Postgres 16 with pgvector, Redpanda (Kafka-compatible broker), Redpanda Console, POST /api/v1/logs, BatchingPublisher (micro-batching producer sends), createLogger structured logger (+4 more)

### Community 24 - "TypeScript Base Config"
Cohesion: 0.14
Nodes (13): compilerOptions, esModuleInterop, forceConsistentCasingInFileNames, module, moduleResolution, noEmit, noUncheckedIndexedAccess, resolveJsonModule (+5 more)

### Community 25 - "Dashboard Layout"
Cohesion: 0.15
Nodes (5): metadata, NAV, config, next, react

### Community 26 - "Evidence Verifier"
Cohesion: 0.18
Nodes (11): Evidence, ToolResult, CheckOutcome, evaluateCheck(), KNOWLEDGE_TOOLS, LIKELIHOOD_ORDER, RejectedClaim, VerificationResult (+3 more)

### Community 27 - "Investigator Tools and Ledger"
Cohesion: 0.19
Nodes (12): compactLog(), fingerprint(), iso, LedgerEntry, logTexts(), run(), RunContext, timeProps (+4 more)

### Community 28 - "Investigation Tests"
Cohesion: 0.15
Nodes (7): deploysResult, findings, ledgerStub, logger, logsResult, metricsResult, usage

### Community 29 - "Shared HTTP Layer"
Cohesion: 0.21
Nodes (10): callJson(), CLIENT_CLOSED_REQUEST, errorHandler(), faultRoutes(), HttpError, requestLogger(), ServiceOptions, startService() (+2 more)

### Community 30 - "Shared Package Tests"
Cohesion: 0.19
Nodes (4): captureLogger(), Line, start(), vitest

### Community 31 - "Log Search UI"
Cohesion: 0.20
Nodes (8): dynamic, LogsPage(), Filters, LEVELS, LogSearch(), RANGES, SERVICES, LogDoc

### Community 32 - "Gateway Mock Logic"
Cohesion: 0.17
Nodes (4): chargeRequest, faults, logger, MAX_CONCURRENT

### Community 33 - "Log Schema"
Cohesion: 0.20
Nodes (9): attributeValue, LogBatch, logBatchSchema, logRecordSchema, MAX_BATCH_SIZE, resourceSchema, SEVERITIES, SEVERITY_NUMBER (+1 more)

### Community 34 - "Config and Logger"
Cohesion: 0.25
Nodes (6): Severity, COLORS, createLogger(), LoggerOptions, ServiceIdentity, @opentelemetry/api

### Community 35 - "Incident Detail UI"
Cohesion: 0.31
Nodes (7): dynamic, EVENT_ICON, InvestigationPanel(), categoryLabel(), formatMetricValue(), formatPercent(), metricLabel()

### Community 36 - "Metric Chart"
Cohesion: 0.27
Nodes (8): fmt(), MetricChart(), MIN_TOP, niceMax(), Point, Props, time(), recharts

### Community 37 - "Platform and Shared TS Config"
Cohesion: 0.20
Nodes (7): extends, include, extends, include, ../../tsconfig.base.json, extends, include

### Community 38 - "HTTP Log Exporter"
Cohesion: 0.36
Nodes (3): HttpLogExporter, HttpLogExporterOptions, LogRecord

### Community 40 - "Badges and Incident Actions"
Cohesion: 0.22
Nodes (4): STATUS, IncidentActions(), NEXT, IncidentStatus

### Community 41 - "Project Docs and Rules"
Cohesion: 0.44
Nodes (7): CLAUDE.md project notes, Root-cause accuracy eval doc, Fault scenarios doc, Ingestion load test doc, Progress log, Project flow doc, README

### Community 42 - "k6 Load Test"
Cohesion: 0.22
Nodes (6): BATCH, events, options, SERVICES, STEP_SECONDS, STEPS

### Community 43 - "Service Identity and Env"
Cohesion: 0.28
Nodes (5): env(), loggerOptionsFromEnv(), SERVICE, SERVICE, SERVICE

### Community 44 - "Eval Package"
Cohesion: 0.25
Nodes (7): main, name, private, scripts, start, typecheck, version

### Community 45 - "Traffic Generator Package"
Cohesion: 0.25
Nodes (7): main, name, private, scripts, start, typecheck, version

### Community 46 - "Detection and Incident Design"
Cohesion: 0.33
Nodes (5): Incidents API (/api/v1/incidents), Incident grouping by time window, Incident lifecycle (detected -> investigating -> identified -> resolved), Stateless EWMA z-score detection, Demo script

### Community 47 - "Investigator Design"
Cohesion: 0.33
Nodes (4): POST /api/v1/incidents/:id/investigate, Claude Opus 5.5 investigator model settings, EvidenceLedger, Verifier (re-runs cited queries)

### Community 48 - "Currency Conversion"
Cohesion: 0.40
Nodes (4): CURRENCIES, CURRENCIES_V2, isSupportedCurrency(), toMinorUnits()

### Community 50 - "Gateway TS Config"
Cohesion: 0.50
Nodes (3): extends, include, ../../tsconfig.base.json

### Community 51 - "Order Pricing"
Cohesion: 0.50
Nodes (3): DISCOUNTS_V2, LineItem, orderTotal()

### Community 52 - "Order TS Config"
Cohesion: 0.50
Nodes (3): extends, include, ../../tsconfig.base.json

### Community 53 - "Payment TS Config"
Cohesion: 0.50
Nodes (3): extends, include, ../../tsconfig.base.json

### Community 54 - "Traffic TS Config"
Cohesion: 0.50
Nodes (3): extends, include, ../../tsconfig.base.json

## Knowledge Gaps
- **379 isolated node(s):** `Clause`, `LogQuery`, `ServiceOptions`, `UpstreamResponse`, `HttpLogExporterOptions` (+374 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 456 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **5 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `vitest` connect `Shared Package Tests` to `Detection, Deploys and Incidents`, `Platform API and Ingestion`, `Log Schema`, `Root Workspace Config`, `Rule-Based Playbook`, `Fault Registry`, `Simulated DB Pool`, `Investigation Tests`?**
  _High betweenness centrality (0.069) - this node is a cross-community bridge._
- **Why does `zod` connect `Fault Registry` to `Detection, Deploys and Incidents`, `Platform API and Ingestion`, `Log Schema`, `Gateway Mock Logic`, `Platform Package`, `Order Service Logic`, `Log Search`, `Payment Service Logic`, `LLM Agent`, `Findings Schema`, `Investigator Tools and Ledger`?**
  _High betweenness centrality (0.041) - this node is a cross-community bridge._
- **Why does `@opentelemetry/api` connect `Config and Logger` to `Shared Package and OTel`?**
  _High betweenness centrality (0.033) - this node is a cross-community bridge._
- **Are the 4 inferred relationships involving `investigateIncident()` (e.g. with `.canRequest()` and `.recordFailure()`) actually correct?**
  _`investigateIncident()` has 4 INFERRED edges - model-reasoned connections that need verification._
- **What connects `Clause`, `LogQuery`, `ServiceOptions` to the rest of the system?**
  _379 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Detection, Deploys and Incidents` be split into smaller, more focused modules?**
  _Cohesion score 0.0545308740978348 - nodes in this community are weakly interconnected._
- **Should `Platform API and Ingestion` be split into smaller, more focused modules?**
  _Cohesion score 0.06142410015649452 - nodes in this community are weakly interconnected._