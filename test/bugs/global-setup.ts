/**
 * Vitest global setup - starts the dashboard server in mock mode before tests.
 */
import { startServer } from '../../packages/dashboard-server/dist/proxy-server.js';

const DASHBOARD_PORT = parseInt(process.env.DASHBOARD_PORT || '4040', 10);

let server: Awaited<ReturnType<typeof startServer>> | null = null;

export async function setup() {
  server = await startServer({
    port: DASHBOARD_PORT,
    mock: true,
  });
  console.log(`[test-setup] Dashboard mock server started on port ${DASHBOARD_PORT}`);
}

export async function teardown() {
  if (server) {
    await server.close();
    server = null;
    console.log('[test-setup] Dashboard mock server stopped');
  }
}
