import './instrumentation';
import { randomUUID } from 'node:crypto';
import {
  callJson,
  createLogger,
  env,
  envInt,
  FaultRegistry,
  HttpError,
  loggerOptionsFromEnv,
  PoolTimeoutError,
  SimulatedDbPool,
  sleep,
  startProcessMonitor,
  startService,
  UpstreamError,
} from '@ai-analyzer/shared';
import { z } from 'zod';
import { isSupportedCurrency, toMinorUnits } from './currency';
import { SERVICE } from './identity';

/**
 * Payment service: records a payment, charges the card through the gateway with retries,
 * and reports the result to the order service.
 */

const logger = createLogger(loggerOptionsFromEnv(SERVICE));
const GATEWAY_URL = env('GATEWAY_URL', 'http://localhost:4003');
const GATEWAY_TIMEOUT_MS = envInt('PAYMENT_GATEWAY_TIMEOUT_MS', 2_000);
const STABLE_VERSION = SERVICE.version;

const pool = new SimulatedDbPool({ name: 'payments-db', size: 10, acquireTimeoutMs: 2_000 });

interface RetryPolicy {
  maxRetries: number;
  backoff: boolean;
}
const DEFAULT_RETRY: RetryPolicy = { maxRetries: 2, backoff: true };

const faults = new FaultRegistry()
  .define({
    name: 'db_pool_exhaustion',
    description: 'A code path stops releasing DB connections, so the pool drains and requests time out.',
    params: z.object({ leakRate: z.number().min(0).max(1).default(0.3) }),
    onDisable: () => pool.reclaimLeaked(),
  })
  .define({
    name: 'bad_deploy',
    description: 'Ships version 1.5.0, whose new currency table is missing EUR, INR and JPY.',
    params: z.object({ version: z.string().default('1.5.0') }),
    onEnable: ({ version }) => setVersion(version),
    onDisable: () => setVersion(STABLE_VERSION),
  })
  .define({
    name: 'retry_storm',
    description: 'Retry config pushed with many immediate retries; gateway failures multiply its load.',
    params: z.object({
      maxRetries: z.number().int().min(0).max(20).default(8),
      backoff: z.boolean().default(false),
    }),
  });

function setVersion(version: string): void {
  SERVICE.version = version;
  logger.setServiceVersion(version);
  logger.info(`payment-service running version ${version}`, { 'service.version': version });
}

const paymentRequest = z.object({
  orderId: z.string().min(1),
  customerId: z.string().min(1),
  amount: z.number().positive(),
  currency: z.string().length(3),
});

type PaymentStatus = 'pending' | 'succeeded' | 'declined' | 'failed';
interface Payment {
  id: string;
  orderId: string;
  customerId: string;
  amount: number;
  currency: string;
  status: PaymentStatus;
  chargeId?: string;
  attempts: number;
  createdAt: string;
}

const payments = new Map<string, Payment>();
const MAX_STORED = 10_000;

function save(payment: Payment): void {
  payments.set(payment.id, payment);
  if (payments.size > MAX_STORED) {
    const oldest = payments.keys().next().value;
    if (oldest) payments.delete(oldest);
  }
}

type ChargeResult =
  | { outcome: 'succeeded'; chargeId: string; attempts: number }
  | { outcome: 'declined'; declineCode: string; attempts: number }
  | { outcome: 'failed'; reason: string; timedOut: boolean; attempts: number };

/** Calls the gateway, retrying 5xx responses, timeouts and network errors. */
async function chargeWithRetry(payment: Payment, amountMinor: number): Promise<ChargeResult> {
  const policy = faults.active<RetryPolicy>('retry_storm') ?? DEFAULT_RETRY;
  const maxAttempts = policy.maxRetries + 1;
  let lastReason = '';
  let timedOut = false;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await callJson<{ chargeId?: string; declineCode?: string; error?: { code: string } }>(
        `${GATEWAY_URL}/v1/charges`,
        {
          method: 'POST',
          timeoutMs: GATEWAY_TIMEOUT_MS,
          body: {
            paymentId: payment.id,
            customerId: payment.customerId,
            amountMinor,
            currency: payment.currency,
          },
        },
      );
      if (res.status === 200 && res.body.chargeId) {
        return { outcome: 'succeeded', chargeId: res.body.chargeId, attempts: attempt };
      }
      if (res.status === 402) {
        return { outcome: 'declined', declineCode: res.body.declineCode ?? 'unknown', attempts: attempt };
      }
      lastReason = `gateway responded ${res.status} ${res.body.error?.code ?? ''}`.trim();
      timedOut = false;
      if (res.status < 500) break; // 4xx other than 402 will not succeed on retry
    } catch (err) {
      if (!(err instanceof UpstreamError)) throw err;
      lastReason = err.message;
      timedOut = err.kind === 'timeout';
    }

    if (attempt < maxAttempts) {
      logger.warn(`gateway call failed, retrying (attempt ${attempt}/${maxAttempts}): ${lastReason}`, {
        'payment.id': payment.id,
        'retry.attempt': attempt,
        'retry.max_attempts': maxAttempts,
        'peer.service': 'gateway-mock',
      });
      if (policy.backoff) await sleep(100 * 2 ** (attempt - 1) + Math.random() * 50);
    }
  }
  return { outcome: 'failed', reason: lastReason, timedOut, attempts: maxAttempts };
}

startService({
  service: SERVICE,
  port: envInt('PAYMENT_SERVICE_PORT', 4002),
  logger,
  faults,
  health: () => ({ dbPool: pool.stats() }),
  routes: (app) => {
    app.post('/payments', async (req, res) => {
      const parsed = paymentRequest.safeParse(req.body);
      if (!parsed.success) {
        throw new HttpError(400, 'invalid_request', 'invalid payment request', z.flattenError(parsed.error));
      }
      const input = parsed.data;
      if (!isSupportedCurrency(input.currency)) {
        throw new HttpError(422, 'unsupported_currency', `currency ${input.currency} is not supported`);
      }

      const payment: Payment = {
        id: `pay_${randomUUID()}`,
        ...input,
        status: 'pending',
        attempts: 0,
        createdAt: new Date().toISOString(),
      };

      // Release 1.5.0 reads the new currency table; see currency.ts.
      const amountMinor = toMinorUnits(input.amount, input.currency, SERVICE.version !== STABLE_VERSION);

      const leak = faults.active<{ leakRate: number }>('db_pool_exhaustion');
      try {
        await pool.query(() => save(payment), { leak: !!leak && Math.random() < leak.leakRate });
      } catch (err) {
        if (err instanceof PoolTimeoutError) {
          logger.error(`failed to record payment: ${err.message}`, {
            'order.id': input.orderId,
            'db.pool.name': err.stats.name,
            'db.pool.active': err.stats.active,
            'db.pool.size': err.stats.size,
            'db.pool.waiting': err.stats.waiting,
          });
          throw new HttpError(503, 'db_unavailable', 'payments database unavailable');
        }
        throw err;
      }

      const result = await chargeWithRetry(payment, amountMinor);
      payment.attempts = result.attempts;

      if (result.outcome === 'succeeded') {
        payment.status = 'succeeded';
        payment.chargeId = result.chargeId;
        logger.info('payment succeeded', {
          'payment.id': payment.id,
          'order.id': payment.orderId,
          'charge.id': result.chargeId,
          'payment.attempts': result.attempts,
        });
        res.status(201).json(payment);
        return;
      }
      if (result.outcome === 'declined') {
        payment.status = 'declined';
        logger.info('payment declined by card issuer', {
          'payment.id': payment.id,
          'order.id': payment.orderId,
          'charge.decline_code': result.declineCode,
        });
        res.status(402).json({ ...payment, declineCode: result.declineCode });
        return;
      }

      payment.status = 'failed';
      logger.error(`payment failed after ${result.attempts} gateway attempts: ${result.reason}`, {
        'payment.id': payment.id,
        'order.id': payment.orderId,
        'payment.attempts': result.attempts,
        'peer.service': 'gateway-mock',
        'error.type': result.timedOut ? 'timeout' : 'upstream_error',
      });
      throw new HttpError(
        result.timedOut ? 504 : 502,
        result.timedOut ? 'gateway_timeout' : 'gateway_unavailable',
        `payment gateway failed: ${result.reason}`,
      );
    });

    app.get('/payments/:id', (req, res) => {
      const payment = payments.get(String(req.params.id));
      if (!payment) throw new HttpError(404, 'not_found', 'payment not found');
      res.json(payment);
    });
  },
});

startProcessMonitor(logger, {
  extra: () => {
    const s = pool.stats();
    return { 'db.pool.active': s.active, 'db.pool.size': s.size, 'db.pool.waiting': s.waiting };
  },
});
