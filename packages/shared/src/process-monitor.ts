import { monitorEventLoopDelay } from 'node:perf_hooks';
import type { Logger } from './logger';

export interface ProcessMonitorOptions {
  intervalMs?: number;
  /** Log at WARN once heap use passes this many MB. */
  heapWarnMb?: number;
  /** Extra attributes added to each sample, e.g. pool stats. */
  extra?: () => Record<string, string | number | boolean | null>;
}

/** Logs a runtime health sample (heap, RSS, event-loop delay) at a fixed interval. */
export function startProcessMonitor(logger: Logger, options: ProcessMonitorOptions = {}): () => void {
  const histogram = monitorEventLoopDelay({ resolution: 20 });
  histogram.enable();
  const heapWarnMb = options.heapWarnMb ?? 256;

  const timer = setInterval(() => {
    const mem = process.memoryUsage();
    const heapUsedMb = Math.round(mem.heapUsed / 1024 / 1024);
    const attributes = {
      'process.memory.heap_used_mb': heapUsedMb,
      'process.memory.heap_total_mb': Math.round(mem.heapTotal / 1024 / 1024),
      'process.memory.rss_mb': Math.round(mem.rss / 1024 / 1024),
      'nodejs.eventloop.delay_p99_ms': Math.round(histogram.percentile(99) / 1e6),
      ...options.extra?.(),
    };
    histogram.reset();
    if (heapUsedMb >= heapWarnMb) {
      logger.warn(`heap usage high: ${heapUsedMb}MB (threshold ${heapWarnMb}MB)`, attributes);
    } else {
      logger.info('process stats', attributes);
    }
  }, options.intervalMs ?? 15_000);
  timer.unref();

  return () => {
    clearInterval(timer);
    histogram.disable();
  };
}
