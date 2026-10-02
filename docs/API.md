# API reference

Every HTTP endpoint in the project, by service. The Postman collection in
[postman/](postman/) has a ready request for each one.

| Service | Port | Base URL (local) | Status |
|---|---|---|---|
| order-service | 4001 | `http://localhost:4001` | Week 1, done |
| payment-service | 4002 | `http://localhost:4002` | Week 1, done |
| gateway-mock | 4003 | `http://localhost:4003` | Week 1, done |
| platform API | 4000 | `http://localhost:4000` | Week 2, planned |

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

---

## Platform API (Week 2, planned)

Listed here so the log format is fixed before the API exists. Services already send this format when
`LOG_INGEST_URL` is set.

### `POST /api/v1/logs` (planned)

Accepts a batch of 1 to 1000 OpenTelemetry-style log records and returns `202 Accepted` once they are on Kafka.
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
| `eventId` | UUID made by the producer; used to drop duplicates |
| `timestamp` | ISO 8601 with offset |
| `severityText` / `severityNumber` | TRACE 1, DEBUG 5, INFO 9, WARN 13, ERROR 17, FATAL 21 |
| `body` | up to 16 KB |
| `traceId` / `spanId` | 32 / 16 lowercase hex, optional |
| `resource` | `service.name` and `service.version` required |
| `attributes` | flat map of string, number, boolean or null |
