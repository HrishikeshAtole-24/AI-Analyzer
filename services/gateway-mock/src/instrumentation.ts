// Loaded first by index.ts so OpenTelemetry can patch http and express before they are imported.
import { initTracing } from '@ai-analyzer/shared/tracing';

initTracing('gateway-mock', process.env.SERVICE_VERSION || '3.2.0');
