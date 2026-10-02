import { env } from '@ai-analyzer/shared';

export const SERVICE = {
  name: 'order-service',
  version: env('SERVICE_VERSION', '2.1.0'),
  environment: env('DEPLOY_ENV', 'local'),
};
