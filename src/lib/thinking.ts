import { REASONING_LEVELS } from "./catalog";
import type { ModelInfo, ProviderInfo, ProviderModel, Reasoning, ThinkingLevel, ThinkingLevelMap } from "./types";

export const THINKING_LEVELS: readonly ThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
const EXTENDED_LEVELS: readonly ThinkingLevel[] = ["xhigh", "max"];

// Mirrors senpi's getSupportedThinkingLevels for an explicit map: `null` hides a level, and
// `xhigh`/`max` are only offered with a non-null entry.
export function isLevelEnabled(map: ThinkingLevelMap, level: ThinkingLevel): boolean {
  const mapped = map[level];
  if (mapped === null) return false;
  if (EXTENDED_LEVELS.includes(level)) return typeof mapped === "string";
  return true;
}

export function setLevelEnabled(map: ThinkingLevelMap, level: ThinkingLevel, enabled: boolean): ThinkingLevelMap {
  const next: ThinkingLevelMap = { ...map };
  if (EXTENDED_LEVELS.includes(level)) {
    if (enabled) next[level] = typeof map[level] === "string" ? map[level] : level;
    else delete next[level];
  } else if (enabled) {
    if (next[level] === null) delete next[level];
  } else {
    next[level] = null;
  }
  return next;
}

// Returns null when senpi would infer the levels from the model id, which OmOswitch cannot reproduce.
export function supportedLevels(model: ProviderModel): ThinkingLevel[] | null {
  if (model.reasoning !== true) return ["off"];
  if (model.thinkingLevelMap === undefined) return null;
  const map = model.thinkingLevelMap;
  return THINKING_LEVELS.filter((level) => isLevelEnabled(map, level));
}

export function reasoningOptions(
  modelRef: string,
  current: Reasoning | null,
  models: readonly ModelInfo[],
  providers: readonly ProviderInfo[],
  all: readonly Reasoning[],
): Reasoning[] {
  const slash = modelRef.indexOf("/");
  let levels: readonly ThinkingLevel[] | null = null;
  if (slash > 0) {
    const provider = providers.find((candidate) => candidate.id === modelRef.slice(0, slash));
    const model = provider?.models.find((candidate) => candidate.id === modelRef.slice(slash + 1));
    if (model !== undefined) levels = supportedLevels(model);
  }
  if (levels === null) {
    const info = models.find((candidate) => candidate.id === modelRef);
    if (info !== undefined && !info.thinking) levels = ["off"];
  }
  if (levels === null) return [...all];
  const allowed = new Set<Reasoning>([...levels, "auto"]);
  if (current !== null) allowed.add(current);
  return all.filter((level) => allowed.has(level));
}

export function isSupportedReasoning(
  modelRef: string,
  level: Reasoning,
  models: readonly ModelInfo[],
  providers: readonly ProviderInfo[],
): boolean {
  return reasoningOptions(modelRef, null, models, providers, REASONING_LEVELS).includes(level);
}
