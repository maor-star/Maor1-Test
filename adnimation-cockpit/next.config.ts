import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // This app lives in a subdirectory of a larger repo; pin tracing to itself so
  // Next does not walk up to the parent lockfile.
  outputFileTracingRoot: __dirname,
  typedRoutes: false,
  experimental: {
    // Server Actions are the primary mutation path in this app.
    serverActions: { bodySizeLimit: '2mb' },
  },
};

export default nextConfig;
