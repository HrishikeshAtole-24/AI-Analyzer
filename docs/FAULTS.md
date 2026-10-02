# Fault scenarios

The demo services can be broken on purpose. Each fault changes real code paths, so the symptoms in the
logs come from real behaviour (connections not released, real exceptions, real retries), not from
log lines written to look broken.

These scenarios are also the ground truth for the Week 5 eval harness: inject a fault, let the
investigator run, and check its top hypothesis against the **Root cause** column.

> Fault toggles go to the service's stderr only (purple `[fault]` lines), never to the log stream.
> If they were in the logs, the investigator could read the answer instead of working it out.

## Summary

| # | Fault | Service | Root cause the investigator should name |
|---|---|---|---|
| 1 | `db_pool_exhaustion` | payment-service (or order-service) | DB connection leak exhausts the pool |
| 2 | `gateway_timeout` | gateway-mock | Gateway latency above the payment timeout |
| 3 | `bad_deploy` | payment-service | Release 1.5.0 broke currency conversion for EUR/INR |
| 4 | `memory_leak` | order-service | Unbounded audit cache grows the heap |
| 5 | `retry_storm` + `gateway_errors` | payment-service + gateway-mock | Aggressive retries multiply gateway load |

## How to run a scenario

```bash
npm run dev:services                 # terminal 1
npm run traffic -- --rps 10          # terminal 2
# terminal 3: switch a fault on, watch, then off
curl -X PUT localhost:4002/admin/faults/bad_deploy -H 'content-type: application/json' -d '{}'
curl -X DELETE localhost:4002/admin/faults/bad_deploy
curl -X POST localhost:4002/admin/faults/reset       # all faults on one service off
```

The Postman collection has a folder per scenario with the same requests.

---

## 1. `db_pool_exhaustion`

**Mechanism.** Each DB pool has 10 connections. With the fault on, a fraction (`leakRate`, default 0.3)
of queries never return their connection, like a code path that forgets `client.release()`. The pool
drains in a few seconds. New requests wait 2 s for a connection and then fail.

**Symptoms in the logs.**

- `ERROR failed to record payment: timeout acquiring connection from pool "payments-db" after 2000ms (active=10/10, waiting=16)`
  with attributes `db.pool.active`, `db.pool.waiting`
- `process stats` samples show `db.pool.active=10`, `db.pool.waiting` > 0
- order-service logs `order payment failed: payment-service responded 503 db_unavailable`
- p95 latency jumps to about 2 s (the acquire timeout)

**Observed (10 rps, 8 s, leakRate 0.3):** 53 OK, 5 failed with 5xx, p95 2059 ms; health showed
`active 10/10, waiting 15, leaked 10`.

**Recovery.** Turning the fault off returns leaked connections, as a restart would.

## 2. `gateway_timeout`

**Mechanism.** The gateway sleeps `delayMs` (default 10 s) before answering, for a `rate` share of charges.
The payment service gives up after 2 s and retries twice.

**Symptoms.**

- `WARN gateway call failed, retrying (attempt 1/3): http://localhost:4003/v1/charges timed out after 2000ms`
- `ERROR payment failed after 3 gateway attempts: ... timed out` with `error.type=timeout`
- payment-service returns 504 `gateway_timeout`; order-service returns 502
- gateway-mock logs `POST /v1/charges client closed the connection after 2008ms` (status 499), because
  payment-service hung up at its 2 s timeout

**Detected (Oct 2, delayMs 3000, rate 0.5):** INC-2 opened in **56.7 s**. It was critical and covered both
order-service and payment-service (p95 4,571 ms vs a 195 ms baseline; 4,425 ms vs 152 ms). Before the
499 fix gateway-mock was not flagged, because its abandoned requests were never logged.

**Observed (10 rps, 10 s, delayMs 3000, rate 0.5):** 75 OK, 6 failed with 5xx, p95 5034 ms.

## 3. `bad_deploy`

**Mechanism.** Switches payment-service to version `1.5.0` (`service.version` changes on every log
record). This release reads a new currency table that is missing EUR, INR and JPY. Converting the
amount for those currencies throws a real `TypeError`.
See [services/payment-service/src/currency.ts](../services/payment-service/src/currency.ts).

**Symptoms.**

- `INFO payment-service running version 1.5.0`
- `ERROR unhandled error in POST /payments: Cannot read properties of undefined (reading 'minorUnits')`
  with `exception.type=TypeError` and a stack trace
- Errors start at the version change and affect EUR and INR orders only. With the traffic mix that
  is about 40% of orders. USD and GBP orders keep working.

**Observed (10 rps, 6 s):** 40 OK, 15 failed with 5xx.

Turning the fault on or off also calls `POST /api/v1/deploys` (when `DEPLOY_WEBHOOK_URL` is set), the way a
CI/CD pipeline would. The record says that 1.5.0 was deployed, not that it is broken.

**Detected (Oct 2, 10 orders/s, 6-minute baseline):** the fault went on at 19:40:05.656 and INC-1 opened at
19:41:20.154, a **time to detect of 74.5 s**.
- One critical incident covered both services: payment-service error rate 40.8% and order-service 32.4%,
  both against a 0% baseline (z = 20.4 and 16.2).
- The 1.5.0 deploy at 19:40:05 was on the incident timeline.
- Anomalies kept extending the incident while the fault stayed on. After the rollback it auto-resolved.

**Recovery.** Turning the fault off rolls back to 1.4.2.

## 4. `memory_leak`

**Mechanism.** The order audit cache normally keeps the last 500 entries. With the fault on it stops
evicting and keeps about `kbPerRequest` KB of extra data per order. Growth stops at `maxHeapMb`
(default 600) of measured heap, so the demo cannot crash the laptop.

**Symptoms.**

- `WARN heap usage high: 420MB (threshold 256MB)` from the 15-second process monitor, with
  `process.memory.heap_used_mb` climbing sample after sample
- `nodejs.eventloop.delay_p99_ms` rises as garbage collection works harder
- At high growth rates, latency spikes while the heap grows (observed p95 5.7 s at 2 MB per request)

**Observed (15 rps, 32 s, kbPerRequest 1024, maxHeapMb 400):** heap went from 20 MB to about 415 MB
and stayed there; no failed requests.

**Recovery.** Turning the fault off trims the cache, and garbage collection reclaims the memory.

## 5. `retry_storm` (with `gateway_errors`)

**Mechanism.** `retry_storm` simulates a bad config push: payment-service retries up to 8 times with no
backoff. `gateway_errors` makes the gateway fail a share of charges with 503. Each failed charge then
turns into up to 9 gateway calls. Under a burst, the gateway reaches its 40-request concurrency limit
and starts rejecting with `gateway_overloaded`, which causes more retries.

**Symptoms.**

- Many `WARN gateway call failed, retrying (attempt n/9)` lines per payment, with no delay between them
- gateway-mock's request rate is several times the order rate
- `WARN rejecting charge: gateway at capacity (in_flight=40/40)` under bursts
- `ERROR acquirer connection reset by peer` on gateway-mock

**Observed (10 rps steady, 6 s, gateway error rate 0.6):** retries hid the errors (55 OK, 0 failed) but
p95 went from about 200 ms to 724 ms and gateway load multiplied. Add bursts
(`--burst-every 20 --burst-rps 60`) to push the gateway past its limit.

---

## Planned scenarios

The doc targets 10 scenarios for the "8 of 10 correct" accuracy goal. Candidates for the remaining
five, to be added in Week 5:

- Slow DB queries (high latency, no errors)
- Payment-service down entirely (connection refused)
- Gateway declines spike (business errors, not system errors: a "not an incident" check)
- Order-service bad deploy that only fails a single SKU
- Two faults at once (gateway timeout and a deploy that happens at the same time but is unrelated)
