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
  startProcessMonitor,
  startService,
  UpstreamError,
} from '@ai-analyzer/shared';
import { z } from 'zod';
import { SERVICE } from './identity';
import { orderTotal } from './pricing';

/**
 * Order service: the entry point of the demo system. It creates an order, asks the payment
 * service to charge it, and stores the final status.
 */

const logger = createLogger(loggerOptionsFromEnv(SERVICE));
const PAYMENT_SERVICE_URL = env('PAYMENT_SERVICE_URL', 'http://localhost:4002');
const PAYMENT_TIMEOUT_MS = envInt('ORDER_PAYMENT_TIMEOUT_MS', 5_000);

const pool = new SimulatedDbPool({ name: 'orders-db', size: 10, acquireTimeoutMs: 2_000 });
const STABLE_VERSION = SERVICE.version;

/**
 * Snapshot cache for order audits. Normally it is trimmed to the latest entries; the
 * memory_leak fault skips the trim and stores a full payload copy, so the heap keeps growing.
 */
const auditCache: { orderId: string; snapshot: string; history?: string[] }[] = [];
const AUDIT_CACHE_LIMIT = 500;

const faults = new FaultRegistry()
  .define({
    name: 'db_pool_exhaustion',
    description: 'A code path stops releasing DB connections, so the pool drains and requests time out.',
    params: z.object({ leakRate: z.number().min(0).max(1).default(0.3) }),
    onDisable: () => pool.reclaimLeaked(),
  })
  .define({
    name: 'bad_deploy',
    description: 'Ships version 2.2.0 with per-SKU discounts from a table that is missing SKU-WEBCAM.',
    params: z.object({ version: z.string().default('2.2.0') }),
    onEnable: ({ version }) => setVersion(version),
    onDisable: () => setVersion(STABLE_VERSION),
  })
  .define({
    name: 'memory_leak',
    description: 'The audit cache stops evicting and keeps a large snapshot per order.',
    params: z.object({
      kbPerRequest: z.number().int().min(1).max(4096).default(256),
      // Safety cap on measured heap use, so the demo cannot take down the laptop.
      maxHeapMb: z.number().int().min(64).max(2048).default(600),
    }),
    onDisable: () => {
      auditCache.splice(0, Math.max(0, auditCache.length - AUDIT_CACHE_LIMIT));
    },
  });

function setVersion(version: string): void {
  SERVICE.version = version;
  logger.setServiceVersion(version);
  logger.info(`order-service running version ${version}`, { 'service.version': version });
  // Plays the CI/CD pipeline: a real deploy posts to the platform's deploy webhook.
  const url = process.env.DEPLOY_WEBHOOK_URL;
  if (!url) return;
  callJson(url, {
    method: 'POST',
    timeoutMs: 3_000,
    body: {
      service: SERVICE.name,
      version,
      environment: SERVICE.environment,
      description: version === STABLE_VERSION ? 'rollback' : 'per-SKU discounts',
    },
  }).catch((err: Error) => process.stderr.write(`[deploy] could not record deploy: ${err.message}
`));
}

function recordAudit(orderId: string, payload: unknown): void {
  const leak = faults.active<{ kbPerRequest: number; maxHeapMb: number }>('memory_leak');
  if (leak && process.memoryUsage().heapUsed < leak.maxHeapMb * 1024 * 1024) {
    // Many small strings rather than one big one: Node keeps large strings outside the V8 heap,
    // and the leak must show up in heap_used_mb. Each entry is roughly 64 bytes of heap.
    const history = Array.from({ length: leak.kbPerRequest * 16 }, () => randomUUID());
    auditCache.push({ orderId, snapshot: JSON.stringify(payload), history });
    return;
  }
  auditCache.push({ orderId, snapshot: JSON.stringify(payload) });
  if (!leak && auditCache.length > AUDIT_CACHE_LIMIT) auditCache.shift();
}

const orderRequest = z.object({
  customerId: z.string().min(1),
  currency: z.string().length(3),
  items: z
    .array(
      z.object({
        sku: z.string().min(1),
        quantity: z.number().int().positive().max(100),
        unitPrice: z.number().positive(),
      }),
    )
    .min(1)
    .max(50),
});

type OrderStatus = 'pending' | 'paid' | 'payment_declined' | 'payment_failed';
interface Order extends z.infer<typeof orderRequest> {
  id: string;
  total: number;
  status: OrderStatus;
  paymentId?: string;
  failureReason?: string;
  createdAt: string;
}

const orders = new Map<string, Order>();
const MAX_STORED = 10_000;

function dbError(err: PoolTimeoutError, action: string, orderId?: string): HttpError {
  logger.error(`failed to ${action}: ${err.message}`, {
    ...(orderId ? { 'order.id': orderId } : {}),
    'db.pool.name': err.stats.name,
    'db.pool.active': err.stats.active,
    'db.pool.size': err.stats.size,
    'db.pool.waiting': err.stats.waiting,
  });
  return new HttpError(503, 'db_unavailable', 'orders database unavailable');
}

async function persist(order: Order, action: string): Promise<void> {
  const leak = faults.active<{ leakRate: number }>('db_pool_exhaustion');
  try {
    await pool.query(
      () => {
        orders.set(order.id, order);
        if (orders.size > MAX_STORED) {
          const oldest = orders.keys().next().value;
          if (oldest) orders.delete(oldest);
        }
      },
      { leak: !!leak && Math.random() < leak.leakRate },
    );
  } catch (err) {
    if (err instanceof PoolTimeoutError) throw dbError(err, action, order.id);
    throw err;
  }
}

startService({
  service: SERVICE,
  port: envInt('ORDER_SERVICE_PORT', 4001),
  logger,
  faults,
  health: () => ({ dbPool: pool.stats(), auditCacheEntries: auditCache.length }),
  routes: (app) => {
    app.post('/orders', async (req, res) => {
      const parsed = orderRequest.safeParse(req.body);
      if (!parsed.success) {
        throw new HttpError(400, 'invalid_request', 'invalid order', z.flattenError(parsed.error));
      }
      const input = parsed.data;
      // Release 2.2.0 applies per-SKU discounts; see pricing.ts.
      const total = orderTotal(input.items, SERVICE.version !== STABLE_VERSION);
      const order: Order = {
        id: `ord_${randomUUID()}`,
        ...input,
        total,
        status: 'pending',
        createdAt: new Date().toISOString(),
      };

      await persist(order, 'create order');
      recordAudit(order.id, req.body);
      logger.info('order created', {
        'order.id': order.id,
        'order.total': total,
        'order.currency': order.currency,
        'order.item_count': input.items.length,
      });

      try {
        const payment = await callJson<{ id?: string; error?: { code: string; message: string } }>(
          `${PAYMENT_SERVICE_URL}/payments`,
          {
            method: 'POST',
            timeoutMs: PAYMENT_TIMEOUT_MS,
            body: { orderId: order.id, customerId: order.customerId, amount: total, currency: order.currency },
          },
        );
        if (payment.status === 201) {
          order.status = 'paid';
          order.paymentId = payment.body.id;
        } else if (payment.status === 402) {
          order.status = 'payment_declined';
        } else {
          order.status = 'payment_failed';
          order.failureReason = `payment-service responded ${payment.status} ${payment.body.error?.code ?? ''}`.trim();
        }
      } catch (err) {
        if (!(err instanceof UpstreamError)) throw err;
        order.status = 'payment_failed';
        order.failureReason = err.message;
      }

      await persist(order, 'update order status');

      if (order.status === 'paid') {
        logger.info('order paid', { 'order.id': order.id, 'payment.id': order.paymentId ?? null });
        res.status(201).json(order);
      } else if (order.status === 'payment_declined') {
        logger.info('order payment declined', { 'order.id': order.id });
        res.status(402).json(order);
      } else {
        logger.error(`order payment failed: ${order.failureReason}`, {
          'order.id': order.id,
          'peer.service': 'payment-service',
        });
        res.status(502).json({ ...order, error: { code: 'payment_failed', message: order.failureReason } });
      }
    });

    app.get('/orders/:id', async (req, res) => {
      try {
        const order = await pool.query(() => orders.get(String(req.params.id)));
        if (!order) throw new HttpError(404, 'not_found', 'order not found');
        res.json(order);
      } catch (err) {
        if (err instanceof PoolTimeoutError) throw dbError(err, 'read order');
        throw err;
      }
    });

    app.get('/orders', async (req, res) => {
      const limit = Math.min(Number(req.query.limit) || 20, 100);
      try {
        const recent = await pool.query(() => [...orders.values()].slice(-limit).reverse());
        res.json({ orders: recent, count: recent.length });
      } catch (err) {
        if (err instanceof PoolTimeoutError) throw dbError(err, 'list orders');
        throw err;
      }
    });
  },
});

startProcessMonitor(logger, {
  extra: () => {
    const s = pool.stats();
    return { 'db.pool.active': s.active, 'db.pool.size': s.size, 'db.pool.waiting': s.waiting };
  },
});
