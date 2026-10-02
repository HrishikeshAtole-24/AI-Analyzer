import { env } from '@ai-analyzer/shared';

export const SERVICE = {
  name: 'gateway-mock',
  version: env('SERVICE_VERSION', '3.2.0'),
  environment: env('DEPLOY_ENV', 'local'),
};
