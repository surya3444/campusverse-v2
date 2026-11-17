import { securityHeaders } from '@campusverse/config/headers';
import type { NextConfig } from 'next';

// Local development values. Every other environment sets variables directly and has no file.
try {
  process.loadEnvFile('../../.env.development');
} catch {
  // no file: rely on the environment
}

const config: NextConfig = {
  reactStrictMode: true,
  // A self-contained server for the container image; files traced from the monorepo root.
  output: 'standalone',
  outputFileTracingRoot: new URL('../../', import.meta.url).pathname,
  devIndicators: false,
  transpilePackages: ['@campusverse/ui', '@campusverse/config'],
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: '/:path*',
        // next dev runs with NODE_ENV=development; built servers never do.
        headers: [
          ...securityHeaders(process.env.NODE_ENV === 'development').filter(
            (h) => h.key !== 'Referrer-Policy',
          ),
          { key: 'Referrer-Policy', value: 'same-origin' },
          { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
        ],
      },
    ];
  },
};

export default config;
