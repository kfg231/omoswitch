import type { Reasoning } from "./types";

// Native's builtin agent registry (senpi-task/src/agents/builtin). Keys outside
// this list are accepted by the schema but dropped when native resolves them.
export const KNOWN_AGENTS = [
  "explore",
  "librarian",
  "plan-consultant",
  "plan-reviewer",
  "omo-native-code-reviewer",
  "omo-native-qa-executor",
  "omo-native-gate-reviewer",
] as const;

export const KNOWN_CATEGORIES = [
  "visual-engineering",
  "ultrabrain",
  "deep-low",
  "deep-high",
  "artistry",
  "quick",
  "architect",
  "unspecified-low",
  "unspecified-high",
  "writing",
] as const;

// Old names native still maps on read, plus the [opencode] migration renames.
export const LEGACY_AGENT_ALIASES: Readonly<Record<string, string>> = {
  "omo-senpi-code-reviewer": "omo-native-code-reviewer",
  "omo-senpi-gate-reviewer": "omo-native-gate-reviewer",
  "omo-senpi-qa-executor": "omo-native-qa-executor",
  metis: "plan-consultant",
  momus: "plan-reviewer",
};

export const LEGACY_CATEGORY_ALIASES: Readonly<Record<string, string>> = {
  deep: "deep-low",
};

// Order follows the reasoning enum in omo.schema.json. Input `none` normalizes
// to `off`, so it is not offered.
export const REASONING_LEVELS: readonly Reasoning[] = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "auto",
];

export function isReasoning(value: unknown): value is Reasoning {
  return typeof value === "string" && REASONING_LEVELS.some((level) => level === value);
}

export function isNativeAgent(key: string): boolean {
  return KNOWN_AGENTS.some((agent) => agent === key);
}

export function isNativeCategory(key: string): boolean {
  return KNOWN_CATEGORIES.some((category) => category === key);
}

export function legacyAgentTarget(key: string): string | null {
  return LEGACY_AGENT_ALIASES[key] ?? null;
}

export function legacyCategoryTarget(key: string): string | null {
  return LEGACY_CATEGORY_ALIASES[key] ?? null;
}
