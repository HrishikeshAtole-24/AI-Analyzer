import { registerInstrumentations } from '@opentelemetry/instrumentation';
import { ExpressInstrumentation } from '@opentelemetry/instrumentation-express';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { UndiciInstrumentation } from '@opentelemetry/instrumentation-undici';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { BatchSpanProcessor, ConsoleSpanExporter, type SpanProcessor } from '@opentelemetry/sdk-trace-base';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';

/**
 * Starts OpenTelemetry tracing. Must run before express or http are imported, which is why
 * it lives in its own entry point (`@ai-analyzer/shared/tracing`) and not in the main index.
 *
 * The HTTP, Express and undici (fetch) instrumentations create spans and propagate the W3C
 * `traceparent` header between services, so one order keeps one trace ID across all three.
 */
export function initTracing(serviceName: string, serviceVersion: string): NodeTracerProvider {
  const spanProcessors: SpanProcessor[] = [];
  if (process.env.OTEL_TRACES_CONSOLE === 'true') {
    spanProcessors.push(new BatchSpanProcessor(new ConsoleSpanExporter()));
  }

  const provider = new NodeTracerProvider({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: serviceName,
      [ATTR_SERVICE_VERSION]: serviceVersion,
    }),
    spanProcessors,
  });
  // Registers the global tracer, the AsyncLocalStorage context manager and the W3C propagator.
  provider.register();

  registerInstrumentations({
    instrumentations: [
      new HttpInstrumentation({
        ignoreIncomingRequestHook: (req) => req.url === '/health',
      }),
      new ExpressInstrumentation(),
      new UndiciInstrumentation(),
    ],
  });

  return provider;
}
