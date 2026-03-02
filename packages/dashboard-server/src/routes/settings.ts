import fs from 'fs';
import path from 'path';
import type { Application } from 'express';

/**
 * Workspace settings and trajectory settings routes.
 */
export function registerSettingsRoutes(app: Application): void {
  // GET /api/settings - Get all workspace settings with documentation.
  app.get('/api/settings', async (_req, res) => {
    try {
      const { readRelayConfig, shouldStoreInRepo, getTrajectoriesStorageDescription } = await import('@agent-relay/config/trajectory-config');
      const config = readRelayConfig();

      return res.json({
        success: true,
        settings: {
          trajectories: {
            storeInRepo: shouldStoreInRepo(),
            storageLocation: getTrajectoriesStorageDescription(),
            description: 'Trajectories record the journey of agent work using the PDERO paradigm (Plan, Design, Execute, Review, Observe). They capture decisions, phase transitions, and retrospectives.',
            benefits: [
              'Track why decisions were made, not just what was built',
              'Enable session recovery when agents crash or context is lost',
              'Provide learning data for future agents working on similar tasks',
              'Create an audit trail of agent work for review',
            ],
            learnMore: 'https://pdero.com',
            optInReason: 'Enable "Store in repo" to version-control your trajectories alongside your code. This is useful for teams who want to review agent decision-making processes.',
          },
        },
        config,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[api] Settings error:', err);
      return res.status(500).json({
        success: false,
        error: message,
      });
    }
  });

  // GET /api/settings/trajectory - Get trajectory storage settings.
  app.get('/api/settings/trajectory', async (_req, res) => {
    try {
      const { readRelayConfig, shouldStoreInRepo, getTrajectoriesStorageDescription } = await import('@agent-relay/config/trajectory-config');
      const config = readRelayConfig();

      return res.json({
        success: true,
        settings: {
          storeInRepo: shouldStoreInRepo(),
          storageLocation: getTrajectoriesStorageDescription(),
        },
        config: config.trajectories || {},
        documentation: {
          title: 'Trajectory Storage',
          description: 'Trajectories record the journey of agent work using the PDERO paradigm (Plan, Design, Execute, Review, Observe).',
          whatIsIt: 'A trajectory captures not just what an agent built, but WHY it made specific decisions. This includes phase transitions, key decisions with reasoning, and retrospective summaries.',
          benefits: [
            'Understand agent decision-making for code review',
            'Enable session recovery if agents crash',
            'Train future agents on your codebase patterns',
            'Create audit trails of AI work',
          ],
          storeInRepoExplanation: 'When enabled, trajectories are stored in .trajectories/ in your repo and can be committed to source control. When disabled (default), they are stored in your user directory (~/.config/agent-relay/trajectories/).',
          learnMore: 'https://pdero.com',
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[api] Settings trajectory error:', err);
      return res.status(500).json({
        success: false,
        error: message,
      });
    }
  });

  // PUT /api/settings/trajectory - Update trajectory storage settings.
  app.put('/api/settings/trajectory', async (req, res) => {
    try {
      const { storeInRepo } = req.body;

      if (typeof storeInRepo !== 'boolean') {
        return res.status(400).json({
          success: false,
          error: 'storeInRepo must be a boolean',
        });
      }

      const { getRelayConfigPath, readRelayConfig } = await import('@agent-relay/config/trajectory-config');
      const { getProjectPaths } = await import('@agent-relay/config');
      const { projectRoot: _projectRoot } = getProjectPaths();

      const config = readRelayConfig();
      config.trajectories = {
        ...config.trajectories,
        storeInRepo,
      };

      const configPath = getRelayConfigPath();
      const configDir = path.dirname(configPath);
      if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true });
      }

      fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

      return res.json({
        success: true,
        settings: {
          storeInRepo,
          storageLocation: storeInRepo ? 'repo (.trajectories/)' : 'user (~/.config/agent-relay/trajectories/)',
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[api] Settings trajectory update error:', err);
      return res.status(500).json({
        success: false,
        error: message,
      });
    }
  });
}
