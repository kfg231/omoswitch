import type { Reasoning } from "./types";

export const KNOWN_AGENTS = [
  "sisyphus",
  "hephaestus",
  "prometheus",
  "atlas",
  "oracle",
  "librarian",
  "explore",
  "multimodal-looker",
  "sisyphus-junior",
  "plan-consultant",
  "plan-reviewer",
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

// Order follows the reasoning enum in omo.schema.json.
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
