// Loaded first by index.ts so OpenTelemetry can patch http and express before they are imported.
import { initTracing } from '@ai-analyzer/shared/tracing';

initTracing('order-service', process.env.SERVICE_VERSION || '2.1.0');
