// k6 load test for POST /api/v1/logs.
// Run (from the repo root, platform running):  npm run loadtest
// It sends batches of BATCH records at a rising request rate and reports events/s and latency.
import http from 'k6/http';
import { check } from 'k6';
import { Counter } from 'k6/metrics';

const TARGET = __ENV.TARGET || 'http://host.docker.internal:4000';
const BATCH = Number(__ENV.BATCH || 100);
// Requests per second at each step; events/s = rate x BATCH.
const STEPS = (__ENV.STEPS || '10,25,50,75,100').split(',').map(Number);
const STEP_SECONDS = Number(__ENV.STEP_SECONDS || 30);

const events = new Counter('events_accepted');

export const options = {
  scenarios: {
    ingest: {
      executor: 'ramping-arrival-rate',
      startRate: STEPS[0],
      timeUnit: '1s',
      preAllocatedVUs: 50,
      maxVUs: 400,
      stages: STEPS.flatMap((rate) => [
        { target: rate, duration: '5s' },
        { target: rate, duration: `${STEP_SECONDS}s` },
      ]),
    },
  },
  thresholds: {
    // The plan's target: the API answers 202 in under 50 ms at p99.
    'http_req_duration{status:202}': ['p(99)<50'],
    http_req_failed: ['rate<0.01'],
  },
  summaryTrendStats: ['avg', 'med', 'p(95)', 'p(99)', 'max'],
};

const SERVICES = ['loadtest-a', 'loadtest-b', 'loadtest-c'];

function record(i) {
  return {
    eventId: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    severityText: i % 20 === 0 ? 'ERROR' : 'INFO',
    severityNumber: i % 20 === 0 ? 17 : 9,
    body: i % 20 === 0 ? 'payment failed: gateway responded 503' : 'POST /orders 201 182.4ms',
    traceId: crypto.randomUUID().replace(/-/g, ''),
    resource: { 'service.name': SERVICES[i % SERVICES.length], 'service.version': '1.0.0', 'deployment.environment': 'loadtest' },
    attributes: { 'http.route': '/orders', 'http.response.status_code': 201, duration_ms: 182.4 },
  };
}

export default function () {
  const logs = Array.from({ length: BATCH }, (_, i) => record(i));
  const res = http.post(`${TARGET}/api/v1/logs`, JSON.stringify({ logs }), {
    headers: { 'content-type': 'application/json' },
  });
  const ok = check(res, { 'status is 202': (r) => r.status === 202 });
  if (ok) events.add(BATCH);
}
