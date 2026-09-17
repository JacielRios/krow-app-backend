import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@krow/api-client', '@krow/contracts'],
};

export default nextConfig;
