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

Run on 2026-10-11, rule-based mode: no `ANTHROPIC_API_KEY` was set, so every investigation used the
playbook. The run was done in four parts:
- Parts 1 and 2 were interrupted when the working session ended. Their rows were rebuilt from the
  harness logs and the platform API with `tools/eval/src/recover.ts`.
- Part 3 finished normally.
- Part 4 re-ran retry-storm after a ranking fix.

The raw reports are in [eval/results/](../eval/results/).

| Scenario | Expected | Top hypothesis | Correct | Top 3 | INC | Detect (s) | Root cause (s) | Claims rejected |
|---|---|---|---|---|---|---|---|---|
| bad-deploy-payment | deploy_regression @ payment-service | deploy_regression @ payment-service | yes | yes | 6 | 67.9 | 103.2 | 0/2 |
| db-pool-payment | db_pool_exhaustion @ payment-service | db_pool_exhaustion @ payment-service | yes | yes | 7 | 82.7 | 118.8 | 0/1 |
| gateway-timeout | upstream_timeout @ gateway-mock | upstream_timeout @ gateway-mock | yes | yes | 8 | 82.4 | 117.8 | 0/1 |
| gateway-errors | upstream_errors @ gateway-mock | upstream_errors @ gateway-mock | yes | yes | 9 | 22.2 | 58.0 | 0/1 |
| slow-queries | database_latency @ payment-service | database_latency @ payment-service | yes | yes | 10 | 22.1 | 58.2 | 0/1 |
| bad-deploy-order | deploy_regression @ order-service | deploy_regression @ order-service | yes | yes | 11 | 94.8 | 130.7 | 0/2 |
| db-pool-order | db_pool_exhaustion @ order-service | db_pool_exhaustion @ order-service | yes | yes | 12 | 59.8 | 95.8 | 0/1 |
| retry-storm (first run) | retry_storm @ payment-service | upstream_errors @ gateway-mock | **no** | yes | 13 | 79.4 | 115.3 | 0/2 |
| timeout-with-red-herring | upstream_timeout @ gateway-mock | upstream_timeout @ gateway-mock | yes | yes | 14 | 82.5 | 112.8 | 0/1 |
| memory-leak | memory_leak @ order-service | memory_leak @ order-service | yes | yes | 15 | 87.0 | 117.2 | 0/2 |
| control-decline-spike | no incident | no incident | yes | yes | - | - | - | - |
| retry-storm (after fix) | retry_storm @ payment-service | retry_storm @ payment-service | yes | yes | 16 | 68.3 | 124.5 | 0/2 |

**Summary**

| Measure | Result |
|---|---|
| Root-cause accuracy, first pass | **9 of 10** (target 8 of 10) |
| Root-cause accuracy, after the ranking fix | **10 of 10** |
| Correct cause anywhere in the top 3 | 10 of 10 |
| Control (no false incident) | passed |
| Time to detect | median 81 s, range 22 to 95 s (target under 2 min) |
| Fault to verified root cause | median 114 s, range 58 to 131 s |
| Claims rejected by the verifier | 0 of 14 |
| LLM cost | $0 (rule-based) |

**The one miss.** In retry-storm the playbook found the retry storm but ranked it second, behind "the
gateway is returning errors". Two bugs caused it:
- Candidates were scored as `specificity + log count`, so the noisiest pattern won.
- The gateway-error count also included payment-service's retry warnings, because their text mentions
  `acquirer_unavailable`.

Fix: rank by specificity first and use count only to break ties, and count only gateway-mock's own logs
as gateway errors. Five unit tests now cover the ranking (`apps/platform/test/rule-based.test.ts`). The
first-run miss stays in the table.

**What these numbers do and do not show.**
- They measure the rule-based playbook: the fallback, and the baseline the LLM has to beat. The playbook
  knows these failure patterns, so high accuracy on them is expected. Its value is that an incident
  always gets a verified answer, even with no LLM.
- "0 claims rejected" is trivially true for the playbook, which only cites its own queries. The
  verifier matters for the LLM path. Its rejection logic is unit-tested (invented query ids, failed
  checks, runbook citations) but has not been measured live.
- To measure the LLM investigator, add `ANTHROPIC_API_KEY` to `.env` and run `npm run eval`. The report
  then shows mode `llm`, cost per investigation, and the claims the verifier rejected.
