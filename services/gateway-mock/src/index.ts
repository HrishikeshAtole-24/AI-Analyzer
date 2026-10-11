import './instrumentation';
import { randomUUID } from 'node:crypto';
import {
  createLogger,
  envInt,
  FaultRegistry,
  HttpError,
  loggerOptionsFromEnv,
  sleep,
  startProcessMonitor,
  startService,
} from '@ai-analyzer/shared';
import { z } from 'zod';
import { SERVICE } from './identity';

/**
 * Mock card gateway (a stand-in for Stripe/Razorpay). It authorises charges with realistic
 * latency, a small decline rate, and a concurrency limit; faults make it slow or failing.
 */

const logger = createLogger(loggerOptionsFromEnv(SERVICE));
const MAX_CONCURRENT = envInt('GATEWAY_MAX_CONCURRENT', 40);
const DECLINE_RATE = 0.02;

const faults = new FaultRegistry()
  .define({
    name: 'gateway_timeout',
    description: 'Charges hang for delayMs before answering, longer than the payment service waits.',
    params: z.object({
      delayMs: z.number().int().min(0).max(60_000).default(10_000),
      rate: z.number().min(0).max(1).default(1),
    }),
  })
  .define({
    name: 'decline_spike',
    description: 'More cards are declined (402). A business event, not a failure: no incident should open.',
    params: z.object({ rate: z.number().min(0).max(1).default(0.3) }),
  })
  .define({
    name: 'gateway_errors',
    description: 'A fraction of charges fail with a 5xx, as when the acquirer connection drops.',
    params: z.object({
      rate: z.number().min(0).max(1).default(0.5),
      status: z.number().int().min(500).max(599).default(503),
    }),
  });

const chargeRequest = z.object({
  paymentId: z.string().min(1),
  customerId: z.string().min(1),
  amountMinor: z.number().int().positive(),
  currency: z.string().length(3),
});

let inFlight = 0;

startService({
  service: SERVICE,
  port: envInt('GATEWAY_MOCK_PORT', 4003),
  logger,
  faults,
  health: () => ({ inFlight, maxConcurrent: MAX_CONCURRENT }),
  routes: (app) => {
    app.post('/v1/charges', async (req, res) => {
      const parsed = chargeRequest.safeParse(req.body);
      if (!parsed.success) {
        throw new HttpError(400, 'invalid_request', 'invalid charge request', z.flattenError(parsed.error));
      }
      const charge = parsed.data;

      if (inFlight >= MAX_CONCURRENT) {
        logger.warn(`rejecting charge: gateway at capacity (in_flight=${inFlight}/${MAX_CONCURRENT})`, {
          'payment.id': charge.paymentId,
          'gateway.in_flight': inFlight,
        });
        throw new HttpError(503, 'gateway_overloaded', 'gateway at capacity, retry later');
      }

      inFlight++;
      try {
        const timeout = faults.active<{ delayMs: number; rate: number }>('gateway_timeout');
        if (timeout && Math.random() < timeout.rate) {
          await sleep(timeout.delayMs);
        } else {
          await sleep(40 + Math.random() * 80);
        }

        const errors = faults.active<{ rate: number; status: number }>('gateway_errors');
        if (errors && Math.random() < errors.rate) {
          logger.error('acquirer connection reset by peer while authorising charge', {
            'payment.id': charge.paymentId,
            'error.type': 'ECONNRESET',
            'gateway.acquirer': 'visa-net-eu',
          });
          throw new HttpError(errors.status, 'acquirer_unavailable', 'acquirer unavailable');
        }

        const declines = faults.active<{ rate: number }>('decline_spike');
        if (Math.random() < (declines ? declines.rate : DECLINE_RATE)) {
          logger.info('charge declined', {
            'payment.id': charge.paymentId,
            'charge.decline_code': 'insufficient_funds',
          });
          res.status(402).json({ status: 'declined', declineCode: 'insufficient_funds' });
          return;
        }

        const chargeId = `ch_${randomUUID().replace(/-/g, '').slice(0, 20)}`;
        logger.info('charge authorised', {
          'payment.id': charge.paymentId,
          'charge.id': chargeId,
          'charge.amount_minor': charge.amountMinor,
          'charge.currency': charge.currency,
        });
        res.status(200).json({ chargeId, status: 'succeeded' });
      } finally {
        inFlight--;
      }
    });
  },
});

startProcessMonitor(logger, { extra: () => ({ 'gateway.in_flight': inFlight }) });
