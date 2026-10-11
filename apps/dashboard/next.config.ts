import type { NextConfig } from 'next';

const PLATFORM_URL = process.env.PLATFORM_URL || 'http://localhost:4000';

const config: NextConfig = {
  // Browser calls go to /api/platform/* and are proxied to the platform API, so no CORS is needed.
  async rewrites() {
    return [{ source: '/api/platform/:path*', destination: `${PLATFORM_URL}/api/v1/:path*` }];
  },
};

export default config;
