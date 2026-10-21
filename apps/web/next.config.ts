import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@krow/api-client', '@krow/contracts'],
  async headers() {
    return ['/auth/callback', '/rides/:path*'].map((source) => ({
      source,
      headers: [
        { key: 'Referrer-Policy', value: 'no-referrer' },
        { key: 'Cache-Control', value: 'no-store' },
        { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
      ],
    }));
  },
};

export default nextConfig;
