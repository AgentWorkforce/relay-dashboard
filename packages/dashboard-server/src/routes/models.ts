import type { Application } from 'express';

type ReasoningEffort = 'low' | 'medium' | 'high' | 'xhigh';

type ModelOption = {
  value: string;
  label: string;
  reasoningEfforts?: ReasoningEffort[];
  defaultReasoningEffort?: ReasoningEffort;
};

type ModelOptionsResponse = Record<string, ModelOption[]>;
type DefaultModelsResponse = Record<string, string>;
type ConfigModule = typeof import('@agent-relay/config') & {
  getDefaultReasoningEffort?: (cli: string, model: string) => ReasoningEffort | undefined;
  getSupportedReasoningEfforts?: (cli: string, model: string) => ReasoningEffort[] | undefined;
};

function inferCodexReasoningEfforts(model: string): ReasoningEffort[] | undefined {
  if (model === 'gpt-5.1-codex-mini') {
    return ['medium', 'high'];
  }

  if (model.startsWith('gpt-5')) {
    return ['low', 'medium', 'high', 'xhigh'];
  }

  return undefined;
}

function enrichCodexModelOptions(
  modelOptions: ModelOptionsResponse,
  config: ConfigModule,
): ModelOptionsResponse {
  const codexOptions = Array.isArray(modelOptions.Codex) ? modelOptions.Codex : null;
  if (!codexOptions) {
    return modelOptions;
  }

  const enrichedCodexOptions = codexOptions.map((option) => {
    const reasoningEfforts =
      option.reasoningEfforts
      ?? config.getSupportedReasoningEfforts?.('codex', option.value)
      ?? inferCodexReasoningEfforts(option.value);

    if (!reasoningEfforts || reasoningEfforts.length === 0) {
      return option;
    }

    const defaultReasoningEffort =
      option.defaultReasoningEffort
      ?? config.getDefaultReasoningEffort?.('codex', option.value)
      ?? reasoningEfforts[reasoningEfforts.length - 1];

    return {
      ...option,
      reasoningEfforts,
      defaultReasoningEffort,
    };
  });

  return {
    ...modelOptions,
    Codex: enrichedCodexOptions,
  };
}

/**
 * Model options route.
 * Serves model options from @agent-relay/config (generated from cli-registry.yaml).
 */
export function registerModelsRoutes(app: Application): void {
  app.get('/api/models', async (_req, res) => {
    try {
      const config = await import('@agent-relay/config') as ConfigModule;
      const modelOptions = enrichCodexModelOptions(
        config.ModelOptions as ModelOptionsResponse,
        config,
      );
      return res.json({
        success: true,
        modelOptions,
        defaultModels: config.DefaultModels as DefaultModelsResponse,
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
