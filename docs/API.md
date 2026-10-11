# API reference

Every HTTP endpoint in the project, by service. The Postman collection in
[postman/](postman/) has a ready request for each one.

| Service | Port | Base URL (local) | Status |
|---|---|---|---|
| order-service | 4001 | `http://localhost:4001` | Week 1, done |
| payment-service | 4002 | `http://localhost:4002` | Week 1, done |
| gateway-mock | 4003 | `http://localhost:4003` | Week 1, done |
| platform API | 4000 | `http://localhost:4000` | Weeks 2 to 5, done |
| dashboard | 3000 | `http://localhost:3000` | Week 6, done (UI, calls the platform API through `/api/platform/*`) |

## Conventions

- Request and response bodies are JSON (`content-type: application/json`).
- Errors share one shape:

  ```json
  { "error": { "code": "invalid_request", "message": "invalid order", "details": { } } }
  ```

  `code` is stable and meant for programs. `message` is for people. `details` is present on validation
  errors and holds Zod's `fieldErrors`.
- Every service propagates the W3C `traceparent` header, so a request keeps one trace ID across services.
- Common error codes:

  | Status | Code | Meaning |
  |---|---|---|
  | 400 | `invalid_request` | Body failed validation; see `details` |
  | 400 | `invalid_json` | Body is not valid JSON |
  | 404 | `not_found` | Unknown resource or route |
  | 500 | `internal_error` | Unhandled exception (logged with stack trace) |
  | 499 | (log only) | The caller disconnected before the response. Never sent; logged with `http.client_aborted: true` |
  | 503 | `db_unavailable` | Could not get a DB connection within 2 s |

---

## Endpoints on every demo service

### `GET /health`

Liveness and a few runtime numbers. Not logged and not traced.

```json
{
  "status": "ok",
  "service": "payment-service",
  "version": "1.4.2",
  "uptimeSeconds": 58,
  "activeFaults": ["db_pool_exhaustion"],
  "dbPool": { "name": "payments-db", "size": 10, "active": 10, "idle": 0, "waiting": 15, "leaked": 10 }
}
```

The extra fields differ per service: `dbPool` (order, payment), `auditCacheEntries` (order),
`inFlight` and `maxConcurrent` (gateway).

### Fault admin

Faults are switched at runtime. Changes are printed to the service's stderr and are **not** sent to the
log stream, so the AI investigator cannot read the answer from the logs. See [FAULTS.md](FAULTS.md) for
what each fault does and what it looks like.

| Method | Path | Body | Response |
|---|---|---|---|
| `GET` | `/admin/faults` | | `{ service, faults: FaultView[] }` |
| `PUT` | `/admin/faults/:name` | fault params (optional; defaults apply) | `FaultView` |
| `DELETE` | `/admin/faults/:name` | | `FaultView` |
| `POST` | `/admin/faults/reset` | | `{ service, faults: FaultView[] }` |

```json
// FaultView
{
  "name": "gateway_timeout",
  "description": "Charges hang for delayMs before answering, longer than the payment service waits.",
  "enabled": true,
  "enabledAt": "2026-10-02T14:15:45.120Z",
  "params": { "delayMs": 3000, "rate": 0.5 }
}
```

Errors: `404 fault_error` for an unknown fault name, `400 fault_error` for invalid params.

---

## order-service (port 4001)

### `POST /orders`

Creates an order and charges it through the payment service (5 s timeout).

Request:

```json
{
  "customerId": "cus_1042",
  "currency": "EUR",
  "items": [{ "sku": "SKU-KEYBOARD", "quantity": 2, "unitPrice": 19.99 }]
}
```

| Field | Rule |
|---|---|
| `customerId` | non-empty string |
| `currency` | 3 letters; payment-service accepts USD, EUR, GBP, INR, JPY |
| `items` | 1 to 50 items; `quantity` 1 to 100; `unitPrice` > 0 |

Responses:

| Status | When | Body |
|---|---|---|
| 201 | Payment succeeded | `Order` with `status: "paid"` and `paymentId` |
| 400 | Validation failed | error |
| 402 | Card declined | `Order` with `status: "payment_declined"` |
| 502 | Payment service failed or timed out | `Order` with `status: "payment_failed"`, `failureReason`, and `error` |
| 503 | Orders DB pool exhausted | error `db_unavailable` |

```json
// Order
{
  "id": "ord_98f27140-e078-43b4-9cc7-582e936e5c42",
  "customerId": "cus_1",
  "currency": "EUR",
  "items": [{ "sku": "SKU-A", "quantity": 2, "unitPrice": 19.99 }],
  "total": 39.98,
  "status": "paid",
  "createdAt": "2026-10-02T14:15:18.852Z",
  "paymentId": "pay_a963c78f-c189-4e34-8389-c95d84766030"
}
```

### `GET /orders/:id`

Returns one `Order`, or `404 not_found`.

### `GET /orders?limit=20`

Most recent orders first. `limit` defaults to 20, maximum 100. Response: `{ "orders": Order[], "count": n }`.

### Faults

| Name | Params (defaults) |
|---|---|
| `db_pool_exhaustion` | `leakRate` 0.3 (0 to 1) |
| `bad_deploy` | `version` "2.2.0" |
| `memory_leak` | `kbPerRequest` 256 (1 to 4096), `maxHeapMb` 600 (64 to 2048) |

---

## payment-service (port 4002)

### `POST /payments`

Records a payment and charges the card through the gateway. The gateway call has a 2 s timeout and
2 retries with exponential backoff (100 ms, 200 ms, plus jitter) on 5xx responses, timeouts and network errors.

Request:

```json
{ "orderId": "ord_...", "customerId": "cus_1042", "amount": 39.98, "currency": "EUR" }
```

Responses:

| Status | When | Body |
|---|---|---|
| 201 | Charge succeeded | `Payment` with `status: "succeeded"`, `chargeId`, `attempts` |
| 400 | Validation failed | error |
| 402 | Card declined | `Payment` with `status: "declined"` and `declineCode` |
| 422 | Currency not supported | error `unsupported_currency` |
| 500 | Unhandled exception (the `bad_deploy` bug) | error `internal_error` |
| 502 | Gateway kept failing | error `gateway_unavailable` |
| 503 | Payments DB pool exhausted | error `db_unavailable` |
| 504 | Gateway kept timing out | error `gateway_timeout` |

```json
// Payment
{
  "id": "pay_a963c78f-c189-4e34-8389-c95d84766030",
  "orderId": "ord_98f27140-e078-43b4-9cc7-582e936e5c42",
  "customerId": "cus_1",
  "amount": 39.98,
  "currency": "EUR",
  "status": "succeeded",
  "chargeId": "ch_007bca84241b4ee3bd2a",
  "attempts": 1,
  "createdAt": "2026-10-02T14:15:18.870Z"
}
```

### `GET /payments/:id`

Returns one `Payment`, or `404 not_found`.

### Faults

| Name | Params (defaults) |
|---|---|
| `db_pool_exhaustion` | `leakRate` 0.3 |
| `bad_deploy` | `version` "1.5.0" |
| `slow_queries` | `multiplier` 25 (1 to 100) |
| `retry_storm` | `maxRetries` 8 (0 to 20), `backoff` false |

---

## gateway-mock (port 4003)

A stand-in for a card gateway such as Stripe or Razorpay. It answers in 40 to 120 ms and declines 2% of
charges. It handles at most 40 charges at once (`GATEWAY_MAX_CONCURRENT`) and rejects the rest with 503.

### `POST /v1/charges`

Request:

```json
{ "paymentId": "pay_...", "customerId": "cus_1042", "amountMinor": 3998, "currency": "EUR" }
```

`amountMinor` is an integer in minor units (cents, paise).

| Status | When | Body |
|---|---|---|
| 200 | Authorised | `{ "chargeId": "ch_...", "status": "succeeded" }` |
| 400 | Validation failed | error |
| 402 | Declined | `{ "status": "declined", "declineCode": "insufficient_funds" }` |
| 503 | Over capacity | error `gateway_overloaded` |
| 5xx | `gateway_errors` fault | error `acquirer_unavailable` |

### Faults

| Name | Params (defaults) |
|---|---|
| `gateway_timeout` | `delayMs` 10000 (0 to 60000), `rate` 1 (0 to 1) |
| `gateway_errors` | `rate` 0.5, `status` 503 (500 to 599) |
| `decline_spike` | `rate` 0.3 (0 to 1); more 402 declines, a business event that must not open an incident |

---

## Platform API (port 4000)

Started with `npm run dev:platform` (API + worker) or `npm run dev:all` (everything). Needs the Docker
stack (`npm run infra:up`) and the database migrated (`npm run db:deploy`).

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/health` | OpenSearch and Postgres reachability |
| `POST` | `/api/v1/logs` | Ingest a batch of log records |
| `GET` | `/api/v1/logs` | Search logs |
| `GET` | `/api/v1/traces/:traceId` | All logs of one request, across services |
| `GET` | `/api/v1/services` | Services seen in the last 15 minutes |
| `GET` | `/api/v1/metrics` | Per-minute request rate, error rate, latency, heap |
| `GET` | `/api/v1/stats/pipeline` | Logs indexed and end-to-end lag |
| `POST` | `/api/v1/deploys` | Record a deploy |
| `GET` | `/api/v1/deploys` | List deploys |
| `GET` | `/api/v1/incidents` | List incidents |
| `GET` | `/api/v1/incidents/:id` | One incident with timeline and anomalies |
| `PATCH` | `/api/v1/incidents/:id` | Change incident status |
| `POST` | `/api/v1/incidents/:id/investigate` | Start another root-cause investigation |
| `GET` | `/api/v1/incidents/:id/investigations` | Investigations of an incident |
| `GET` | `/api/v1/investigations/:id` | One investigation: hypotheses, evidence, queries, cost |
| `GET` | `/api/v1/stats/investigations` | Unsupported-claim rate, cost, modes |
| `GET` | `/api/v1/runbooks?q=` | Runbooks most similar to a query (pgvector) |
| `GET` | `/api/v1/incidents/:id/similar` | Past incidents similar to this one |

Platform-specific error codes:

| Status | Code | Meaning |
|---|---|---|
| 409 | `invalid_transition` | Incident status change not allowed |
| 503 | `ingest_unavailable` | Kafka did not accept the batch; retry |

### `GET /health`

```json
{ "status": "ok", "opensearch": "ok", "postgres": "ok", "kafka": "connected" }
```

Returns 503 with `"status": "degraded"` if OpenSearch or Postgres is down.

### `POST /api/v1/logs`

Accepts 1 to 1000 OpenTelemetry-style log records. It returns `202 Accepted` once the valid records
are on Kafka (`acks=all`). Indexing happens later in the worker, so a record is searchable about
1 second after the 202.

Each record is validated on its own. Invalid records go to the `logs.dlq` topic and are not dropped.
The response lists the first 10 with their index in the batch. If no record in the batch is valid,
the status is 400.

The schema lives in [packages/shared/src/log-schema.ts](../packages/shared/src/log-schema.ts).

```json
{
  "logs": [
    {
      "eventId": "0b8a3f0e-3c1d-4f5e-9a51-2b7c6d8e9f10",
      "timestamp": "2026-10-02T14:15:41.954Z",
      "observedTimestamp": "2026-10-02T14:15:41.954Z",
      "severityText": "ERROR",
      "severityNumber": 17,
      "body": "unhandled error in POST /payments: Cannot read properties of undefined (reading 'minorUnits')",
      "traceId": "c2ab3c5a0f1e4d2b9a8c7d6e5f4a3b2c",
      "spanId": "0f1e4d2b9a8c7d6e",
      "resource": {
        "service.name": "payment-service",
        "service.version": "1.5.0",
        "deployment.environment": "local",
        "host.name": "laptop"
      },
      "attributes": {
        "exception.type": "TypeError",
        "exception.message": "Cannot read properties of undefined (reading 'minorUnits')"
      }
    }
  ]
}
```

| Field | Rule |
|---|---|
| `eventId` | UUID made by the producer. The worker stores it as the document ID, so a resent event is stored once. |
| `timestamp` | ISO 8601 with offset |
| `severityText` / `severityNumber` | TRACE 1, DEBUG 5, INFO 9, WARN 13, ERROR 17, FATAL 21 |
| `body` | up to 16 KB |
| `traceId` / `spanId` | 32 / 16 lowercase hex, optional |
| `resource` | `service.name` and `service.version` required |
| `attributes` | flat map of string, number, boolean or null |

Response when some or all records are accepted (202):

```json
{ "accepted": 1, "rejected": 1, "errors": [{ "index": 1, "issues": "✖ Invalid input: expected string, received undefined\n  → at eventId" }] }
```

| Status | When |
|---|---|
| 202 | At least one record accepted |
| 400 | Body is not `{ logs: [1..1000] }`, or every record is invalid |
| 503 | `ingest_unavailable`: Kafka is down. The services' exporters keep the batch and retry. |

### `GET /api/v1/logs`

Newest first.

| Query | Default | Meaning |
|---|---|---|
| `service` | all | One service, or several separated by commas |
| `level` | all | Minimum severity: `warn` returns WARN, ERROR and FATAL |
| `from` / `to` | `now-15m` / `now` | ISO 8601, or date math such as `now-1h` |
| `q` | | Full-text search on the message (all words must match) |
| `traceId` | | Logs of one trace |
| `attr` | | Attribute filter `key:value`; repeat for several, e.g. `attr=http.route:/payments` |
| `limit` | 100 | 1 to 500 |
| `cursor` | | `nextCursor` from the previous page |

```json
{
  "logs": [
    {
      "eventId": "489ecdcf-77af-45a8-8366-567a7e58ac5c",
      "@timestamp": "2026-10-02T19:33:49.308Z",
      "indexedAt": "2026-10-02T19:33:50.275Z",
      "severityText": "WARN",
      "severityNumber": 13,
      "body": "POST /orders 402 193.1ms",
      "traceId": "9cb065596f31c3cb857d44ede8d55205",
      "spanId": "264b2f3c1649f887",
      "service": "order-service",
      "serviceVersion": "2.1.0",
      "environment": "local",
      "host": "LAPTOP-D30O7FRT",
      "http": { "method": "POST", "route": "/orders", "statusCode": 402 },
      "durationMs": 193.13,
      "resource": { "service.name": "order-service", "service.version": "2.1.0" },
      "attributes": { "http.route": "/orders", "http.response.status_code": "402", "duration_ms": "193.13" }
    }
  ],
  "total": 156,
  "nextCursor": "WzE3OTA5..."
}
```

`total` stops counting at 10,000. In `attributes` every value is a string, because OpenSearch stores
them as a `flat_object`. The typed copies are in `http`, `durationMs`, `process`, `dbPool` and
`exceptionType`.

### `GET /api/v1/traces/:traceId`

Every log of one request across all services, oldest first. Returns 404 if no logs have this trace ID.

```json
{
  "traceId": "0c9a483c1bb0437603b89c29cc671ba8",
  "services": ["order-service", "gateway-mock", "payment-service"],
  "startedAt": "2026-10-02T19:33:54.890Z",
  "endedAt": "2026-10-02T19:33:55.023Z",
  "durationMs": 133,
  "errorCount": 0,
  "logCount": 6,
  "logs": []
}
```

### `GET /api/v1/services`

```json
{
  "services": [
    {
      "service": "payment-service",
      "version": "1.4.2",
      "lastSeen": "2026-10-02T19:33:55.004Z",
      "logsLast15m": 316,
      "requestsLast15m": 156,
      "errorRateLast15m": 0
    }
  ],
  "count": 3
}
```

### `GET /api/v1/metrics`

Per-service, per-minute metrics derived from the logs. These are the series the anomaly detector uses.

| Query | Default |
|---|---|
| `service` | all (comma-separated list allowed) |
| `from` / `to` | `now-30m` / `now` |

```json
{
  "from": "now-30m",
  "to": "now",
  "intervalSeconds": 60,
  "services": [
    {
      "service": "payment-service",
      "windows": [
        {
          "windowStart": "2026-10-02T19:34:00.000Z",
          "requests": 203,
          "errors": 0,
          "errorRate": 0,
          "latencyP50": 112.4,
          "latencyP95": 147.9,
          "latencyP99": 171.2,
          "heapUsedMb": 33
        }
      ]
    }
  ]
}
```

- `requests` counts request logs, the records that have `duration_ms`.
- `errors` counts the 5xx responses among them.
- `errorRate` and the latency fields are `null` in a minute with no requests.
- `heapUsedMb` is the highest heap sample from the process monitor in that minute.

### `GET /api/v1/stats/pipeline?minutes=5`

How much was indexed, and the lag from an event's timestamp to when it was indexed.

```json
{ "windowMinutes": 5, "logsIndexed": 1138, "lagMs": { "p50": 546, "p95": 1007, "p99": 1115, "max": 25846 } }
```

### `POST /api/v1/deploys`

Records a release. CI/CD calls this; locally the `bad_deploy` fault does (through `DEPLOY_WEBHOOK_URL`).

```json
{ "service": "payment-service", "version": "1.5.0", "environment": "local", "commitSha": "a1b2c3d", "description": "currency config refresh" }
```

Only `service` and `version` are required. `deployedAt` (ISO 8601) defaults to now. Returns 201 with the stored deploy.

### `GET /api/v1/deploys?service=&since=&limit=50`

Newest first. Response: `{ "deploys": Deploy[], "count": n }`.

### `GET /api/v1/incidents?status=open&service=&limit=20`

`status` is one of `open` (anything not resolved), `resolved`, `all` (default), `detected`,
`investigating` or `identified`. Newest first.

```json
{
  "incidents": [
    {
      "id": "6c1e...",
      "number": 1,
      "title": "Error rate 34.8% on payment-service (baseline 0.4%)",
      "status": "detected",
      "severity": "critical",
      "services": ["payment-service", "order-service"],
      "startedAt": "2026-10-02T19:41:00.000Z",
      "detectedAt": "2026-10-02T19:42:16.000Z",
      "lastAnomalyAt": "2026-10-02T19:43:00.000Z",
      "resolvedAt": null,
      "summary": null,
      "anomalyCount": 4
    }
  ],
  "count": 1
}
```

### `GET /api/v1/incidents/:id`

`:id` is the UUID, the number (`1`), or `INC-1`. The response is the incident plus:

- `events`: the timeline, oldest first. `type` is `anomaly`, `deploy`, `status_change` or `note`.
- `anomalies`: every anomalous window grouped into this incident, with `metric`, `value`, `baseline` and `zScore`.

### `PATCH /api/v1/incidents/:id`

```json
{ "status": "investigating", "note": "looking at the 1.5.0 deploy" }
```

Allowed moves:

| From | To |
|---|---|
| `detected` | `investigating`, `identified`, `resolved` |
| `investigating` | `identified`, `resolved` |
| `identified` | `investigating`, `resolved` |

`resolved` is final; a recurrence opens a new incident. Other moves return `409 invalid_transition`.

### Investigations (Week 4)

Every new incident is investigated automatically about 30 s after detection, by the worker.

- **With an LLM key** (`ANTHROPIC_API_KEY` in `.env`), a tool-calling Claude agent investigates.
- **Without a key, or when the LLM fails or its circuit is open,** a rule-based playbook runs.

Either way, a verifier re-runs every cited query, and only verified claims are stored. See
[PROJECT_FLOW.md](PROJECT_FLOW.md#7-investigation-flow-built).

#### `POST /api/v1/incidents/:id/investigate`

Starts another investigation in the background and returns at once.

```json
{ "incidentId": "6c1e...", "status": "started", "llmAvailable": false }
```

#### `GET /api/v1/incidents/:id/investigations`

All investigations of an incident, newest first: `{ "investigations": Investigation[], "count": n }`.
`GET /api/v1/incidents/:id` also includes the latest one as `investigations[0]`.

#### `GET /api/v1/investigations/:id`

```json
{
  "id": "0f3a...",
  "incidentId": "6c1e...",
  "status": "completed",
  "mode": "rule_based",
  "fallbackReason": "no_api_key",
  "model": null,
  "summary": "Rule-based analysis of INC-3: most likely slow database queries on payment-service (database_latency).",
  "hypotheses": [
    {
      "rank": 1,
      "title": "Slow database queries on payment-service",
      "category": "database_latency",
      "service": "payment-service",
      "description": "payment-service logs slow queries; its latency rises without connection errors.",
      "likelihood": "high",
      "supporting": [
        {
          "claim": "payment-service logs slow database queries.",
          "query_id": "q1",
          "check": { "kind": "log_text_present", "text": "slow query", "service": null, "metric": null, "op": null, "value": null, "version": null },
          "verified": true,
          "observed": "found in: \"slow query on payments-db took 205ms (threshold 200ms)\""
        }
      ],
      "contradicting": [],
      "recommended_actions": ["Check the query plan and recent schema or index changes.", "Runbook: Slow database queries (docs/runbooks/slow-queries.md)"]
    }
  ],
  "rejectedClaims": [],
  "toolCalls": [{ "id": "q1", "tool": "summarize_errors", "input": { "from": "...", "to": "..." }, "at": "...", "ok": true }],
  "claimsTotal": 1,
  "claimsRejected": 0,
  "inputTokens": 0,
  "outputTokens": 0,
  "cacheReadTokens": 0,
  "costUsd": 0,
  "startedAt": "2026-10-11T10:14:50.000Z",
  "finishedAt": "2026-10-11T10:14:52.000Z"
}
```

| Field | Meaning |
|---|---|
| `mode` | `llm` or `rule_based` |
| `fallbackReason` | Why the playbook ran: `no_api_key`, `circuit_open`, `llm_error: ...`, `no_verified_hypotheses` |
| `hypotheses` | Ranked, verified only. `category` is one of `deploy_regression`, `db_pool_exhaustion`, `database_latency`, `upstream_timeout`, `upstream_errors`, `memory_leak`, `retry_storm`, `traffic_spike`, `config_change`, `unknown` |
| `check.kind` | `log_count_at_least`, `log_text_present`, `metric_threshold`, `deploy_present` |
| `rejectedClaims` | Claims the verifier dropped, with the reason |
| `toolCalls` | The evidence ledger: every query, with its exact parameters (`q1`, `q2`, ...) |
| `costUsd` | LLM tokens x price (Claude Opus 5.5: $4 / $20 per million input / output) |

#### `GET /api/v1/stats/investigations`

Totals behind the success metrics.

```json
{
  "investigations": 12,
  "byMode": { "llm": 0, "rule_based": 12 },
  "claimsTotal": 19,
  "claimsRejected": 0,
  "unsupportedClaimRate": 0,
  "avgCostUsd": null,
  "totalCostUsd": 0,
  "llm": { "configured": false, "model": "claude-opus-5-5", "circuit": "closed" }
}
```

### Knowledge base (Week 5)

Runbooks from `docs/runbooks/*.md` and the conclusions of past incidents are stored in Postgres with
pgvector embeddings and searched by cosine similarity.

#### `GET /api/v1/runbooks?q=timeout acquiring connection&limit=3`

```json
{ "runbooks": [{ "slug": "db-pool-exhaustion", "title": "Database connection pool exhausted", "similarity": 0.369, "excerpt": "...", "body": "..." }] }
```

`q` must be at least 3 characters; `limit` is at most 10.

#### `GET /api/v1/incidents/:id/similar`

Past incidents whose stored conclusion is closest to this incident's title, services and summary.

```json
{ "incidents": [{ "number": 3, "text": "INC-3: ... Cause: Slow database queries on payment-service (database_latency in payment-service). ...", "category": "database_latency", "service": "payment-service", "similarity": 0.41 }] }
```
