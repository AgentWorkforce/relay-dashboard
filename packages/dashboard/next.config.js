/** @type {import('next').NextConfig} */

// Dashboard server URL for development proxying
// Can be overridden with DEV_SERVER_URL environment variable
const DEV_SERVER_URL = process.env.DEV_SERVER_URL || 'http://localhost:3889';

const nextConfig = {
  // Static export - generates HTML/JS/CSS that can be served by any server
  output: 'export',
  // Export output goes to 'out/' by default with output: 'export'

  // Disable strict mode for now during development
  reactStrictMode: true,

  // V2 is now the default dashboard at root path
  // Legacy v1 dashboard is available at /v1

  // Proxy API requests to the dashboard server in development
  // Also handle client-side routing for /app/* dynamic routes
  async rewrites() {
    return {
      beforeFiles: [
        // Client-side routing: serve /app page for all /app/* dynamic routes
        // These are handled by the client-side router (useUrlRouting)
        {
          source: '/app/channel/:path*',
          destination: '/app',
        },
        {
          source: '/app/dm/:path*',
          destination: '/app',
        },
        {
          source: '/app/agent/:path*',
          destination: '/app',
        },
        {
          source: '/app/settings/:path*',
          destination: '/app',
        },
      ],
      afterFiles: [
        // API proxy to dashboard server
        {
          source: '/api/:path*',
          destination: `${DEV_SERVER_URL}/api/:path*`,
        },
        {
          source: '/ws',
          destination: `${DEV_SERVER_URL}/ws`,
        },
      ],
    };
  },

  // Webpack configuration for WebSocket support
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        net: false,
        tls: false,
        fs: false,
      };
    }
    return config;
  },
};

export default nextConfig;
