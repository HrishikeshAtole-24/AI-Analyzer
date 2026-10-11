/**
 * Eval scenarios: the ground truth for root-cause accuracy. Each one injects real faults,
 * and says which root cause (category + service) a correct investigation names. The control
 * scenario expects no incident at all.
 */

export const SERVICE_URLS = {
  'order-service': process.env.ORDER_SERVICE_URL || 'http://localhost:4001',
  'payment-service': process.env.PAYMENT_SERVICE_URL || 'http://localhost:4002',
  'gateway-mock': process.env.GATEWAY_URL || 'http://localhost:4003',
} as const;
export type ServiceName = keyof typeof SERVICE_URLS;

export interface FaultStep {
  service: ServiceName;
  fault: string;
  params?: Record<string, unknown>;
}

export interface Scenario {
  id: string;
  name: string;
  faults: FaultStep[];
  /** A deploy posted at injection time that has nothing to do with the failure (a red herring). */
  unrelatedDeploy?: { service: ServiceName; version: string; description: string };
  expect: { category: string; service: ServiceName } | 'no_incident';
}

export const SCENARIOS: Scenario[] = [
  {
    id: 'bad-deploy-payment',
    name: 'payment-service 1.5.0 breaks EUR/INR conversion',
    faults: [{ service: 'payment-service', fault: 'bad_deploy' }],
    expect: { category: 'deploy_regression', service: 'payment-service' },
  },
  {
    id: 'db-pool-payment',
    name: 'payments-db connection leak',
    faults: [{ service: 'payment-service', fault: 'db_pool_exhaustion', params: { leakRate: 0.3 } }],
    expect: { category: 'db_pool_exhaustion', service: 'payment-service' },
  },
  {
    id: 'gateway-timeout',
    name: 'card gateway slower than the payment timeout',
    faults: [{ service: 'gateway-mock', fault: 'gateway_timeout', params: { delayMs: 3000, rate: 0.5 } }],
    expect: { category: 'upstream_timeout', service: 'gateway-mock' },
  },
  {
    id: 'gateway-errors',
    name: 'card gateway returns 503s',
    faults: [{ service: 'gateway-mock', fault: 'gateway_errors', params: { rate: 0.5 } }],
    expect: { category: 'upstream_errors', service: 'gateway-mock' },
  },
  {
    id: 'slow-queries',
    name: 'payments-db queries 25x slower',
    faults: [{ service: 'payment-service', fault: 'slow_queries', params: { multiplier: 25 } }],
    expect: { category: 'database_latency', service: 'payment-service' },
  },
  {
    id: 'bad-deploy-order',
    name: 'order-service 2.2.0 discount table missing a SKU',
    faults: [{ service: 'order-service', fault: 'bad_deploy' }],
    expect: { category: 'deploy_regression', service: 'order-service' },
  },
  {
    id: 'db-pool-order',
    name: 'orders-db connection leak',
    faults: [{ service: 'order-service', fault: 'db_pool_exhaustion', params: { leakRate: 0.3 } }],
    expect: { category: 'db_pool_exhaustion', service: 'order-service' },
  },
  {
    id: 'retry-storm',
    name: 'payment-service retries 8x without backoff while the gateway fails',
    faults: [
      { service: 'gateway-mock', fault: 'gateway_errors', params: { rate: 0.6 } },
      { service: 'payment-service', fault: 'retry_storm', params: { maxRetries: 8, backoff: false } },
    ],
    expect: { category: 'retry_storm', service: 'payment-service' },
  },
  {
    id: 'timeout-with-red-herring',
    name: 'gateway timeout while an unrelated order-service deploy goes out',
    faults: [{ service: 'gateway-mock', fault: 'gateway_timeout', params: { delayMs: 3000, rate: 0.5 } }],
    unrelatedDeploy: { service: 'order-service', version: '2.1.1', description: 'copy changes on the receipt email' },
    expect: { category: 'upstream_timeout', service: 'gateway-mock' },
  },
  {
    id: 'memory-leak',
    name: 'order audit cache stops evicting',
    faults: [{ service: 'order-service', fault: 'memory_leak', params: { kbPerRequest: 512, maxHeapMb: 600 } }],
    expect: { category: 'memory_leak', service: 'order-service' },
  },
  {
    id: 'control-decline-spike',
    name: 'control: card declines rise to 30% (business 402s, not a failure)',
    faults: [{ service: 'gateway-mock', fault: 'decline_spike', params: { rate: 0.3 } }],
    expect: 'no_incident',
  },
];
