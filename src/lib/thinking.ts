import type { ThinkingLevel, ThinkingLevelMap } from "./types";

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
