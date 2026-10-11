# Demo script

A 5-minute walkthrough for a recording or an interview. It shows a real failure being detected,
investigated and explained with verified evidence.

## Before you record (10 minutes)

```bash
npm run infra:up
npm run dev:all                    # services, platform API, worker, dashboard
npm run traffic -- --rps 10        # second terminal; leave it running
```

Open http://localhost:3000/services. Wait 6 minutes so the detector has a baseline (the charts fill in).
To use the LLM investigator, set `ANTHROPIC_API_KEY` in `.env` before starting. Without it, the
rule-based playbook investigates instead, and the page says so.

## Script

1. **The system (30 s).** Show the services page: three services, request rate, error rate, p95
   latency, heap. "These numbers are computed from the services' logs. There is no separate metrics
   agent."
2. **Break it (15 s).** In a terminal:
   ```bash
   curl -X PUT localhost:4002/admin/faults/bad_deploy -H 'content-type: application/json' -d '{}'
   ```
   "This ships payment-service 1.5.0. Its new currency table is missing EUR and INR. That is a
   real bug, and the fault switch itself never appears in the logs."
3. **Detection (about 75 s).** Open the incidents page. While it refreshes, explain the pipeline:
   - The services send logs to the API.
   - The API puts them on Kafka.
   - A worker indexes them into OpenSearch.
   - Every 15 s the detector compares each service's per-minute error rate and latency with an
     EWMA baseline.

   The incident appears: critical, payment-service and order-service grouped together.
4. **Investigation (30 s).** Open the incident. Point out:
   - The timeline: error anomalies, plus the 1.5.0 deploy 5 seconds after the start.
   - The root cause: "Release 1.5.0 of payment-service introduced TypeError errors", category
     `deploy_regression`.
   - The verified evidence: each claim has a query id (`q1`, `q2`), and the backend re-ran that
     query to check the claim before showing it.
   - "Queries run" lists exactly what the investigator looked at.
   - "Rejected claims" shows anything the verifier threw out.
5. **The proof (30 s).** Click a trace in Log search for a failing EUR order. One request shows
   across three services, and the TypeError appears only on 1.5.0.
6. **Recovery (30 s).** Roll back:
   ```bash
   curl -X POST localhost:4002/admin/faults/reset
   ```
   The rollback appears on the timeline. Five clean minutes later the incident auto-resolves.
7. **The numbers (30 s).** Show the README results table: eval accuracy over 10 fault scenarios,
   time to detect, ingestion throughput and latency from k6.

## Good follow-up questions to be ready for

- *Why Kafka?* Ingestion returns 202 as soon as the batch is durable; indexing and analysis can
  fall behind without slowing the services. Shown live: OpenSearch was stopped for 40 s and no log was lost.
- *How do you stop the LLM from making things up?* Claims must cite a recorded query and a checkable
  condition; the verifier re-runs it. Unsupported claims are dropped and counted.
- *What if the LLM is down?* Timeout, retries and a circuit breaker, then a rule-based playbook whose
  claims go through the same verifier.
- *What would you do next?* The roadmap is in the product plan: chat about an incident, postmortem
  drafts, multi-tenancy, Kubernetes.
