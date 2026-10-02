import { env } from '@ai-analyzer/shared';

export const SERVICE = {
  name: 'payment-service',
  version: env('SERVICE_VERSION', '1.4.2'),
  environment: env('DEPLOY_ENV', 'local'),
};
