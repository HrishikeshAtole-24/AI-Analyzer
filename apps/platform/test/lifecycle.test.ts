import { describe, expect, it } from 'vitest';
import { anomalyTitle, canTransition, severityFor } from '../src/incidents/lifecycle';

describe('incident lifecycle', () => {
  it('allows the forward path and resolving from any open state', () => {
    expect(canTransition('detected', 'investigating')).toBe(true);
    expect(canTransition('investigating', 'identified')).toBe(true);
    expect(canTransition('identified', 'resolved')).toBe(true);
    expect(canTransition('detected', 'resolved')).toBe(true);
  });

  it('treats resolved as final', () => {
    expect(canTransition('resolved', 'investigating')).toBe(false);
    expect(canTransition('resolved', 'detected')).toBe(false);
  });

  it('does not go back to detected', () => {
    expect(canTransition('investigating', 'detected')).toBe(false);
  });
});

describe('severityFor', () => {
  it('is critical for a large error rate or several services', () => {
    expect(severityFor(null, 'error_rate', 0.35, 1)).toBe('critical');
    expect(severityFor(null, 'latency_p95', 900, 2)).toBe('critical');
  });

  it('is a warning for a single-service latency or heap anomaly', () => {
    expect(severityFor(null, 'latency_p95', 900, 1)).toBe('warning');
    expect(severityFor(null, 'heap_used', 400, 1)).toBe('warning');
  });

  it('never downgrades', () => {
    expect(severityFor('critical', 'heap_used', 100, 1)).toBe('critical');
  });
});

describe('anomalyTitle', () => {
  it('formats each metric for people', () => {
    expect(anomalyTitle('payment-service', 'error_rate', 0.348, 0.004)).toBe(
      'Error rate 34.8% on payment-service (baseline 0.4%)',
    );
    expect(anomalyTitle('order-service', 'latency_p95', 2051.2, 210)).toBe(
      'p95 latency 2051 ms on order-service (baseline 210 ms)',
    );
  });
});
