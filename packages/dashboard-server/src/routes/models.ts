import type { Application } from 'express';

/**
 * Model options route.
 * Serves model options from @agent-relay/config (generated from cli-registry.yaml).
 */
export function registerModelsRoutes(app: Application): void {
  app.get('/api/models', async (_req, res) => {
    try {
      const { ModelOptions, DefaultModels } = await import('@agent-relay/config');
      return res.json({
        success: true,
        modelOptions: ModelOptions,
        defaultModels: DefaultModels,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[api] Models error:', message);
      return res.status(500).json({
        success: false,
        error: message,
      });
    }
  });
}
