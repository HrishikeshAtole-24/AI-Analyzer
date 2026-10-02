# Codebase guide

Where things are, why they are built that way, and how to extend them. Read this before changing code.

## Layout

```text
AI Analyzer/
├── packages/
│   └── shared/                    @ai-analyzer/shared: code every service uses
│       ├── src/
│       │   ├── log-schema.ts      Zod schema for an OTel log record and a batch (the ingestion contract)
│       │   ├── logger.ts          createLogger(): structured logger, adds trace/span IDs
│       │   ├── log-exporter.ts    HttpLogExporter: batches records and POSTs them to the platform
│       │   ├── tracing.ts         initTracing(): OpenTelemetry setup (separate entry point)
│       │   ├── http.ts            startService(), requestLogger, error handler, fault routes, callJson()
│       │   ├── faults.ts          FaultRegistry: typed runtime fault switches
│       │   ├── db-pool.ts         SimulatedDbPool: connection pool with real queueing and timeouts
│       │   ├── process-monitor.ts heap / RSS / event-loop samples every 15 s
│       │   ├── config.ts          env(), envInt(), loggerOptionsFromEnv()
│       │   └── index.ts           re-exports everything except tracing
│       └── test/                  Vitest unit tests
├── services/
│   ├── order-service/             :4001 POST/GET /orders; faults: db_pool_exhaustion, memory_leak
│   ├── payment-service/           :4002 POST/GET /payments; faults: db_pool_exhaustion, bad_deploy, retry_storm
│   │   └── src/currency.ts        currency tables, including the broken v2 table of the bad deploy
│   └── gateway-mock/              :4003 POST /v1/charges; faults: gateway_timeout, gateway_errors
├── tools/
│   └── traffic-generator/         CLI: steady + burst order traffic with a live summary
├── infra/postgres/init.sql        enables pgvector on first start
├── docker-compose.yml             Redpanda (+ console), OpenSearch, Postgres/pgvector
├── docs/                          this guide, API, flow, faults, progress, Postman
└── CLAUDE.md                      rules for keeping docs in sync (for Claude Code sessions)
```

Every service has the same three files:

| File | Role |
|---|---|
| `src/instrumentation.ts` | Calls `initTracing()`. Imported first. |
| `src/identity.ts` | `SERVICE = { name, version, environment }` |
| `src/index.ts` | Logger, faults, routes, `startService()`, process monitor |

## Design decisions

**One TypeScript monorepo with npm workspaces.** Services share the log schema and middleware, so a
change to the log format is a type error everywhere at once. Packages point `main` at `src/index.ts`,
and `tsx` runs TypeScript directly, so there is no build step during development. Production builds
come in Week 6.

**CommonJS, not ESM.** OpenTelemetry patches `http` and `express` by hooking `require`. With CommonJS
this works without loader flags.

**Tracing is a separate entry point (`@ai-analyzer/shared/tracing`).** The main index imports Express.
If tracing were imported from there, Express would load before it is patched and no spans would exist.
Each service's `index.ts` therefore starts with `import './instrumentation'`.

**Traces are used for correlation, not exported.** Spans exist so the trace ID passes across services
and gets stamped on every log record. No span exporter runs by default (`OTEL_TRACES_CONSOLE=true` prints
them). The platform rebuilds a request from logs that share a trace ID.

**The DB pool is simulated in-process.** `SimulatedDbPool` behaves like `pg.Pool`: fixed size, wait
queue, acquire timeout. This means the demo needs no database, and pool exhaustion is real contention,
not a fake error. It can be swapped for real Postgres later without changing the fault.

**Faults are invisible in the logs.** Toggles print to stderr only. This keeps the AI evaluation honest:
the investigator has to reason from symptoms.

**Faults change real code paths.** For example, `bad_deploy` makes the service read a currency table
that is actually missing entries, and the `TypeError` is thrown by ordinary code. Symptoms then look
like production failures, with real stack traces and only the affected currencies failing.

**Log attribute names follow OpenTelemetry semantic conventions** where one exists
(`http.request.method`, `http.route`, `http.response.status_code`, `exception.type`, `peer.service`,
`service.version`). Project-specific names use a dotted prefix (`order.id`, `payment.attempts`,
`db.pool.active`).

**The logger is never allowed to break a service.** The exporter catches every error, bounds its buffer,
and rate-limits its own warnings.

## Conventions

- Validate every request body with Zod and return `400 invalid_request` with `z.flattenError(...)` details.
- Throw `HttpError(status, code, message)` for expected failures. Anything else becomes a logged 500.
- Calls to other services use `callJson(url, { timeoutMs })`. There is always a timeout.
- Express 5 passes rejected promises from async handlers to the error handler, so no try/catch wrapper is needed.
- Log one line per business event, with IDs in attributes, not only in the message.
- No `console.log` in services. Use the logger. (stderr is reserved for fault notes and exporter warnings.)

## How to...

**Add a fault.** In the service, call `.define({ name, description, params: z.object({...defaults}), onEnable?, onDisable? })`
on its `FaultRegistry`, then check `faults.active<Params>('name')` where the behaviour changes. Document it in
[FAULTS.md](FAULTS.md), [API.md](API.md) and the Postman collection.

**Add a service.** Copy `services/gateway-mock`, change the name, port and version in `identity.ts` and
`instrumentation.ts`, add a `dev:<name>` script in the root `package.json`, and add it to `dev:services`.

**Add a log field everywhere.** Change `logRecordSchema` in `log-schema.ts`, then `logger.ts`. TypeScript
flags anything that no longer matches.

## Environment variables

See [.env.example](../.env.example). The important ones:

| Variable | Default | Effect |
|---|---|---|
| `LOG_INGEST_URL` | empty | Platform ingest endpoint; empty means stdout only |
| `LOG_FORMAT` | `pretty` | `json` prints raw OTel records |
| `LOG_LEVEL` | `info` | Lowest severity printed and sent |
| `SERVICE_VERSION` | per service | Overrides the reported version |
| `PAYMENT_GATEWAY_TIMEOUT_MS` | 2000 | Payment to gateway timeout |
| `ORDER_PAYMENT_TIMEOUT_MS` | 5000 | Order to payment timeout |
| `GATEWAY_MAX_CONCURRENT` | 40 | Gateway concurrency limit |
| `OTEL_TRACES_CONSOLE` | unset | `true` prints spans to stdout |

## Testing

- `npm test` runs Vitest. Week 1 covers the pool, fault registry, log schema and exporter (17 tests).
- `npm run typecheck` runs `tsc --noEmit` in every workspace.
- Fault behaviour was checked by hand with the traffic generator. Results are in [FAULTS.md](FAULTS.md).
  The Week 5 eval harness will automate this.
