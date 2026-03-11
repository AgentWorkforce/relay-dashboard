import { useState, useEffect } from 'react';
import type { ModelOption } from '../SpawnModal';

export interface ModelOptionsMap {
  [cli: string]: ModelOption[];
}

export interface DefaultModelsMap {
  [cli: string]: string;
}

/**
 * Fetches model options from the server (sourced from cli-registry.yaml via codegen).
 * Returns model options keyed by CLI name (e.g., Claude, Codex, Gemini, OpenCode, Droid).
 */
export function useModelOptions() {
  const [modelOptions, setModelOptions] = useState<ModelOptionsMap>({});
  const [defaultModels, setDefaultModels] = useState<DefaultModelsMap>({});
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function fetchModels() {
      try {
        const res = await fetch('/api/models');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (cancelled) return;

        if (data.success && data.modelOptions) {
          // ModelOptions from codegen uses PascalCase keys (Claude, Codex, etc.)
          // Normalize to lowercase for consistent lookup
          const normalized: ModelOptionsMap = {};
          for (const [key, options] of Object.entries(data.modelOptions)) {
            normalized[key.toLowerCase()] = options as ModelOption[];
          }
          setModelOptions(normalized);
        }

        if (data.defaultModels) {
          setDefaultModels(data.defaultModels);
        }
      } catch (err) {
        console.warn('[useModelOptions] Failed to fetch model options:', err);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    fetchModels();
    return () => { cancelled = true; };
  }, []);

  return { modelOptions, defaultModels, isLoading };
}
