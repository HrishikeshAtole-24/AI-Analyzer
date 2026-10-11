# Ingestion load test

How much log traffic can the platform take, and how fast does `POST /api/v1/logs` answer?

## Method

`npm run loadtest` runs [loadtest/ingest.js](../loadtest/ingest.js) with k6 in Docker (no local install).

- Each request carries a batch of 100 valid log records (unique `eventId`s, 3 services, 5% ERROR).
- The `ramping-arrival-rate` executor holds a fixed request rate: events/s = requests/s x 100.
- k6 reports the latency of 202 responses and the events accepted.
- During and after each run the indexer's Kafka consumer lag was sampled with `rpk group describe log-indexer`.

Options: `npm run loadtest -- -e STEPS=10,25,50 -e STEP_SECONDS=60 -e BATCH=100`.

**Clean up afterwards: `npm run loadtest:clean`.** The synthetic records (environment `loadtest`)
land in the same indices as the real service logs. After a 5,000 events/s run, 3.2 million of them
made the detector's 40-minute aggregation time out on every pass, and `GET /api/v1/metrics` returned
500, until they were deleted. Better still, load-test a separate stack.

**Environment.** One laptop runs everything: 8 CPUs and 8 GB given to Docker Desktop. That covers k6,
the API and worker (Node 24 under `tsx`), Redpanda, OpenSearch (512 MB heap) and Postgres. k6 reaches the
API through Docker's host gateway. The numbers are a floor for this setup, not a capacity plan.

## Results (2026-10-11)

### API: `POST /api/v1/logs` (acks=all, so a 202 means the batch is durable on Kafka)

| Rate | Events accepted | Errors | p50 | p95 | p99 |
|---|---|---|---|---|---|
| 1,000 events/s (10 req/s) | 998/s | 0 | 26 ms | 38 ms | 53 ms |
| 2,500 events/s (25 req/s) | 2,499/s | 0 | 27 ms | 61 ms | 153 ms |
| **5,000 events/s (50 req/s)** | **4,998/s** | 0 | 29 ms | 105 ms | 273 ms |

- **Throughput target (5,000 events/s): met.** 324,900 events in 65 s, no failed request, 0 dropped iterations.
- **p99 target (under 50 ms): not met.** The median is ~27 ms at every rate. That is a fixed per-request
  cost: the network hop through Docker Desktop plus a Kafka round trip with `acks=all`. At 1,000
  events/s p99 is 53 ms; under load the tail grows as the API shares the CPU with the indexer,
  OpenSearch and k6.

### Indexing: Kafka to OpenSearch (worker)

| Rate | Consumer lag during the run | After the run |
|---|---|---|
| 2,500 events/s for 60 s | grew to 54,000 events (indexing about 1,700/s while the API was loaded) | 0 within 25 s |
| 5,000 events/s for 60 s | 262,000 events at the end | drained at about 2,900 events/s, 0 after about 100 s |

The API accepts traffic faster than the laptop can index it. Kafka absorbs the difference, so **no event
was lost in any run**; searchability is delayed until the backlog drains. At normal demo traffic (10
orders/s, about 60 events/s) the event-to-indexed lag is about 1 s (p95), well under the 5 s target.

## What changed because of these runs

| Run | Change | Effect at 5,000 events/s |
|---|---|---|
| 1 | Baseline: one Kafka `send` per HTTP request, idempotent producer (one request in flight) | 2,088 events/s, p99 24 s, 4,944 iterations dropped |
| 2 | **Micro-batching** (`BatchingPublisher`): concurrent requests share producer sends | 4,989 events/s, p99 909 ms |
| 3 | **Non-idempotent producer, up to 4 sends in flight.** Duplicates are already removed at storage (`_id = eventId`) | 4,998 events/s, p99 268 ms |
| 4 | Tried: the indexer consumes 6 partitions in parallel | Indexing not faster (OpenSearch is the limit), API p99 rose to 3.8 s. **Reverted.** |

## Found during the runs: aggregations do not scale with raw volume

Metrics and detection aggregate raw logs at query time (per service, per minute, with percentiles).
That is fine at demo volume (the 30-minute query takes about 50 ms). With 3.2 million extra records
in the window it took over 10 s and failed. Two changes were made:
- Aggregations now get a 30 s timeout (other searches keep 10 s), so heavier data slows them down
  instead of failing them.
- `npm run loadtest:clean` removes the synthetic data.

At real scale the fix is pre-aggregation: the indexer would write per-minute rollups, and the detector
would read those instead of raw logs.

## Next steps if more throughput is needed

- Per-minute rollups written at index time, so detection cost does not grow with log volume.
- Run the API compiled (`node`, not `tsx`) and as several processes behind a load balancer.
- Give OpenSearch more heap and use more primary shards, or run the indexer on separate hardware;
  indexing is the ceiling.
- Larger client batches (the services send at most 200 records per request) amortise the fixed per-request cost.
