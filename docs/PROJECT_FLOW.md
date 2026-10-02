# Project flow

How data moves through the system: what exists today and what each week adds.
Diagrams use Mermaid, which renders on GitHub and in VS Code's Markdown preview.

**Built so far:** Week 1 (demo services, fault injection, traffic generator, infra definition).

## 1. The big picture

```mermaid
flowchart LR
  subgraph demo["Demo system (Week 1, built)"]
    TG[traffic-generator] --> OS[order-service :4001]
    OS --> PS[payment-service :4002]
    PS --> GW[gateway-mock :4003]
  end

  subgraph ingest["Ingestion (Week 2)"]
    API[platform API :4000<br/>POST /api/v1/logs] --> K[(Kafka / Redpanda<br/>topic: logs.raw)]
    K --> W[log worker]
    W --> OSR[(OpenSearch<br/>logs-*)]
    W -. bad events .-> DLQ[(logs.dlq)]
  end

  subgraph analysis["Detection and AI (Weeks 3 to 5)"]
    DET[metrics + anomaly detector] --> INC[(Postgres<br/>incidents, deploys)]
    INC --> AI[AI investigator]
    AI -- tools: search_logs, get_metrics,<br/>get_recent_deploys, get_trace --> OSR
    AI --> INC
  end

  OS & PS & GW -- batched OTel log records --> API
  OSR --> DET
  INC --> UI[Next.js dashboard<br/>Week 6]
  OSR --> UI
```

The API only validates logs and hands them to Kafka, so ingestion stays fast even when analysis is slow.

## 2. One order, end to end (built)

```mermaid
sequenceDiagram
  autonumber
  participant C as Client / traffic-generator
  participant O as order-service
  participant ODB as orders-db pool
  participant P as payment-service
  participant PDB as payments-db pool
  participant G as gateway-mock

  C->>O: POST /orders
  O->>O: validate (Zod)
  O->>ODB: insert order (pending)
  O->>P: POST /payments (timeout 5s, traceparent header)
  P->>P: validate, convert amount to minor units
  P->>PDB: insert payment (pending)
  loop up to 3 attempts (2 retries, backoff 100/200ms)
    P->>G: POST /v1/charges (timeout 2s)
    G-->>P: 200 charge / 402 declined / 5xx
  end
  P-->>O: 201 paid / 402 declined / 502, 504 failed
  O->>ODB: update order status
  O-->>C: 201 / 402 / 502
```

Every step writes a log record. All records from one order share a trace ID, because OpenTelemetry's
HTTP and fetch instrumentation passes the `traceparent` header between services. In Week 2 the trace view
uses this ID to put one order's logs from three services in order.

Example from a real run (trace `c2ab3c5a`):

```text
[order-service@2.1.0]   order created order.id=ord_98f2... order.total=39.98 order.currency=EUR
[gateway-mock@3.2.0]    charge authorised payment.id=pay_a963... charge.amount_minor=3998
[gateway-mock@3.2.0]    POST /v1/charges 200 97.6ms
[payment-service@1.4.2] payment succeeded payment.id=pay_a963... payment.attempts=1
[payment-service@1.4.2] POST /payments 201 209.6ms
[order-service@2.1.0]   order paid order.id=ord_98f2...
[order-service@2.1.0]   POST /orders 201 322.2ms
```

## 3. How a log record is produced (built)

```mermaid
flowchart LR
  CODE["logger.info('order created', attrs)"] --> REC[build OTel record<br/>+ eventId, traceId, spanId,<br/>service.name, service.version]
  REC --> OUT{LOG_FORMAT}
  OUT -- pretty --> STDOUT1[readable line on stdout]
  OUT -- json --> STDOUT2[one JSON record per line]
  REC --> Q{LOG_INGEST_URL set?}
  Q -- no --> DROP[stdout only]
  Q -- yes --> BUF[HttpLogExporter buffer]
  BUF -- every 1s or 200 records --> POST[POST /api/v1/logs]
  POST -- fails --> BUF
```

Three kinds of records reach the platform:

| Record | Written by | Used for |
|---|---|---|
| Request log: `POST /orders 201 322.2ms` with `http.route`, `http.response.status_code`, `duration_ms` | `requestLogger` middleware, once per request | Request rate, error rate, p95 latency (Week 3) |
| Business and error events: `payment failed after 3 gateway attempts` | Service code | Root-cause evidence |
| Process stats every 15 s: heap, RSS, event-loop delay, DB pool usage | `startProcessMonitor` | Resource signals (leaks, pool exhaustion) |

The exporter never throws into the service. If the platform is down it keeps up to 10,000 records,
drops the oldest beyond that, and prints one warning a minute to stderr.

## 4. Fault injection (built)

```mermaid
flowchart LR
  YOU[you / Postman / eval harness] -- PUT /admin/faults/:name --> REG[FaultRegistry<br/>in each service]
  REG -- stderr only --> NOTE["[fault] enabled ..."]
  REG --> CODE[service code checks<br/>faults.active name]
  CODE --> BEHAV[real behaviour changes:<br/>leaked connections, slow gateway,<br/>TypeError, heap growth, retries]
  BEHAV --> LOGS[symptoms in the normal logs]
```

Fault changes are never written to the log stream, so the investigator only sees symptoms.
Details for each fault are in [FAULTS.md](FAULTS.md).

## 5. Incident flow (Weeks 3 to 4, planned)

```mermaid
sequenceDiagram
  participant W as log worker
  participant D as detector
  participant DB as Postgres
  participant AI as AI investigator
  participant V as evidence verifier
  participant S as OpenSearch

  W->>S: index logs
  loop every minute
    D->>S: aggregate rate, error rate, p95 per service
    D->>D: EWMA / z-score against baseline
  end
  D->>DB: open incident (status: detected), group related anomalies
  DB->>AI: incident opened
  AI->>S: search_logs / get_metrics / get_trace
  AI->>DB: get_recent_deploys
  AI->>V: ranked hypotheses + cited queries
  V->>S: re-run every cited query
  V->>DB: keep supported claims only (status: identified)
```

If the LLM call fails (timeout, retries used up, circuit open), a rule-based summary is stored instead.
