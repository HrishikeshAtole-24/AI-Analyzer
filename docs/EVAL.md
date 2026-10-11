# Root-cause accuracy eval

How well does the platform find the real cause of a failure? The eval harness answers this by breaking
the live system in known ways and scoring the investigation's answer.

## Method

`npm run eval` (code in [tools/eval/](../tools/eval/src/index.ts)) needs the services and platform running
(`npm run dev:all`). It:

1. Starts steady traffic (10 orders/s) and waits 6 minutes so every service has a baseline.
2. For each scenario in [scenarios.ts](../tools/eval/src/scenarios.ts):
   1. Resolves any open incident, so nothing from the previous scenario can absorb the new anomalies.
   2. Injects the scenario's faults through the services' admin endpoints and records the time.
      One scenario also posts an unrelated deploy as a red herring.
   3. Waits up to 4 minutes for an incident whose first anomalous minute is at or after the injection.
   4. Waits up to 6 minutes for that incident's investigation to finish.
   5. Scores it: **correct** if the top verified hypothesis has the expected `category` *and* `service`
      (the service where the cause lives, not just where symptoms show). It also records whether the
      right answer is anywhere in the top 3.
   6. Removes the faults and cools down 6 minutes. The detector only acts on anomalies from the last
      5 minutes, so the next scenario starts clean.
3. The control scenario (a spike in card declines, which are business 402s) passes if **no** incident opens
   within 4 minutes.
4. Writes `eval/results/<time>.md` and `.json`.

The answers are never available to the investigator. Fault toggles are printed to stderr only, never
logged. The investigator sees only what an on-call engineer would: logs, metrics, traces, deploys,
runbooks and past incidents.

## Scenarios

| Scenario | What breaks | Correct answer |
|---|---|---|
| bad-deploy-payment | payment-service 1.5.0 breaks EUR/INR conversion | deploy_regression @ payment-service |
| db-pool-payment | payments-db connections leak | db_pool_exhaustion @ payment-service |
| gateway-timeout | half of gateway calls take 3 s (timeout is 2 s) | upstream_timeout @ gateway-mock |
| gateway-errors | half of gateway calls return 503 | upstream_errors @ gateway-mock |
| slow-queries | payments-db queries 25x slower | database_latency @ payment-service |
| bad-deploy-order | order-service 2.2.0 discount table missing a SKU | deploy_regression @ order-service |
| db-pool-order | orders-db connections leak | db_pool_exhaustion @ order-service |
| retry-storm | payment-service retries 8x with no backoff while the gateway fails | retry_storm @ payment-service |
| timeout-with-red-herring | gateway timeout + an unrelated order-service deploy at the same moment | upstream_timeout @ gateway-mock |
| memory-leak | order audit cache stops evicting | memory_leak @ order-service |
| control-decline-spike | 30% of cards declined (402) | no incident |

## Results
