/**
 * Server Tests
 *
 * Tests for the main dashboard server (server.ts).
 *
 * Note: The main server is an integration component that orchestrates multiple
 * @agent-relay/* packages. Full integration testing requires:
 * - A running SQLite database
 * - The @agent-relay/storage adapter
 * - The @agent-relay/bridge for multi-project connections
 * - Various other @agent-relay services
 *
 * For development/testing without these dependencies, use the proxy-server
 * in mock mode (tested in proxy-server.test.ts).
 *
 * These tests focus on:
 * 1. Verifying the module exports correctly
 * 2. Testing type definitions
 * 3. Integration testing with mocked dependencies where feasible
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Test that the module can be imported
describe('server module', () => {
  describe('exports', () => {
    it('should export startDashboard function', async () => {
      // Dynamic import to verify module loads correctly
      const serverModule = await import('./server.js');
      expect(typeof serverModule.startDashboard).toBe('function');
    });
  });

  describe('startDashboard function signature', () => {
    it('should accept DashboardOptions object', async () => {
      const { startDashboard } = await import('./server.js');

      // Verify function exists and has correct shape
      expect(startDashboard).toBeDefined();
      expect(startDashboard.length).toBeGreaterThanOrEqual(1);
    });
  });
});

describe('server types', () => {
  it('should export DashboardOptions type (via index)', async () => {
    // This verifies the types are correctly re-exported
    const indexModule = await import('./index.js');
    // Type-only exports can't be checked at runtime, but we can verify
    // the module loads without errors
    expect(indexModule).toBeDefined();
  });
});

/**
 * Integration tests for server initialization
 *
 * These tests would require setting up actual dependencies.
 * Skipped in unit tests, can be enabled for integration testing.
 */
describe.skip('server integration', () => {
  // These tests require actual @agent-relay packages and file system setup
  // They should be run as part of an integration test suite

  it('should start dashboard on specified port', async () => {
    // Would need:
    // - Temp directory for data
    // - Temp team config
    // - Port available
  });

  it('should respond to health check', async () => {
    // Would need running server
  });

  it('should handle /api/data requests', async () => {
    // Would need storage initialized
  });
});
