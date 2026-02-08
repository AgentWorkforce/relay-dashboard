/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  reactStrictMode: true,
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || 'https://api.relaycast.dev',
  },
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.resolve.fallback = { net: false, tls: false, fs: false };
    }
    return config;
  },
};

export default nextConfig;
