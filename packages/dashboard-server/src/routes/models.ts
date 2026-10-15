import type { Application } from 'express';
import type { ModelCatalog } from '../lib/model-catalog.js';

type ReasoningEffort = string;

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
 * Load bundled model choices and defaults, enriching legacy Codex effort metadata.
 */
export async function bundledModels() {
  const config = await import('@agent-relay/config') as ConfigModule;
  return {
    modelOptions: enrichCodexModelOptions(config.ModelOptions as ModelOptionsResponse, config),
    defaultModels: config.DefaultModels as DefaultModelsResponse,
  };
}

/** Serve the supplied catalog at GET /api/models, returning HTTP 500 on load failure. */
export function registerModelsRoutes(app: Application, catalog: ModelCatalog = { get: bundledModels }): void {
  app.get('/api/models', async (_req, res) => {
    try {
      return res.json({
        success: true,
        ...await catalog.get(),
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
