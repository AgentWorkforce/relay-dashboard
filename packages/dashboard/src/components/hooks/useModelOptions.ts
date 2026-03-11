import { useState, useEffect, useCallback } from 'react';
import type { ModelOption } from '../SpawnModal';

export interface ModelOptionsMap {
  [cli: string]: ModelOption[];
}

function isModelOption(item: unknown): item is ModelOption {
  return (
    typeof item === 'object' &&
    item !== null &&
    typeof (item as ModelOption).value === 'string' &&
    typeof (item as ModelOption).label === 'string'
  );
}

/**
 * Fetches model options from the server (sourced from cli-registry.yaml via codegen).
 * Returns model options keyed by lowercase CLI name (e.g., claude, codex, gemini, opencode, droid).
 */
export interface DefaultModelsMap {
  [cli: string]: string;
}

export function useModelOptions() {
  const [modelOptions, setModelOptions] = useState<ModelOptionsMap>({});
  const [defaultModels, setDefaultModels] = useState<DefaultModelsMap>({});
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchModels = useCallback(async (signal?: AbortSignal) => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/models', { signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      if (data.success && data.modelOptions) {
        // ModelOptions from codegen uses PascalCase keys (Claude, Codex, etc.)
        // Normalize to lowercase for consistent lookup
        const normalized: ModelOptionsMap = {};
        for (const [key, options] of Object.entries(data.modelOptions)) {
          if (Array.isArray(options) && options.every(isModelOption)) {
            normalized[key.toLowerCase()] = options;
          }
        }
        setModelOptions(normalized);
      }

      if (data.defaultModels && typeof data.defaultModels === 'object') {
        setDefaultModels(data.defaultModels as DefaultModelsMap);
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      const error = err instanceof Error ? err : new Error(String(err));
      setError(error);
      console.warn('[useModelOptions] Failed to fetch model options:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetchModels(controller.signal);
    return () => controller.abort();
  }, [fetchModels]);

  return { modelOptions, defaultModels, isLoading, error, refetch: fetchModels };
}
