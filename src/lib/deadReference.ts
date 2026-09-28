import type { ModelInfo, ProviderInfo } from "./types";

export type ModelSource = "omo" | "configured";

export interface ModelOption {
  id: string;
  source: ModelSource;
  context: string | null;
}

export function providerPrefix(model: string): string | null {
  const slash = model.indexOf("/");
  if (slash <= 0) return null;
  return model.slice(0, slash).trim() || null;
}

export function mergeModelOptions(
  omoModels: readonly ModelInfo[],
  providers: readonly ProviderInfo[],
): ModelOption[] {
  const options: ModelOption[] = [];
  const seen = new Set<string>();
  for (const provider of providers) {
    for (const model of provider.models) {
      if (model.id.trim() === "") continue;
      const id = `${provider.id}/${model.id}`;
      if (seen.has(id)) continue;
      seen.add(id);
      options.push({
        id,
        source: "configured",
        context: model.contextWindow === undefined ? null : `${Math.round(model.contextWindow / 1000)}k`,
      });
    }
  }
  for (const model of omoModels) {
    if (seen.has(model.id)) continue;
    seen.add(model.id);
    options.push({ id: model.id, source: "omo", context: model.context });
  }
  return options;
}

/**
 * Provider ids referenced by `models` whose prefix is known neither to omo nor to the configured
 * providers. Returns nothing while the omo model list is unknown, to avoid flagging every row.
 */
export function findDeadProviders(
  models: readonly string[],
  omoModels: readonly ModelInfo[],
  providers: readonly ProviderInfo[],
): string[] {
  if (omoModels.length === 0) return [];
  const known = new Set<string>();
  for (const model of omoModels) known.add(model.provider);
  for (const provider of providers) known.add(provider.id);
  const dead: string[] = [];
  for (const model of models) {
    const prefix = providerPrefix(model);
    if (prefix !== null && !known.has(prefix) && !dead.includes(prefix)) dead.push(prefix);
  }
  return dead;
}
