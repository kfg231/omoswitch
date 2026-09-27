import { KNOWN_AGENTS, KNOWN_CATEGORIES } from "./catalog";
import type { ModelInfo, Profile } from "./types";

const PROVIDERS = ["openai", "anthropic", "google", "xai", "deepseek", "mistral"] as const;
const MODEL_NAMES = [
  "gpt-6-sol",
  "gpt-6-mini",
  "o5-pro",
  "claude-opus-5",
  "claude-sonnet-5",
] as const;

export function seedModels(): ModelInfo[] {
  const models: ModelInfo[] = [];
  for (const provider of PROVIDERS) {
    for (const name of MODEL_NAMES) {
      const index = models.length;
      models.push({
        id: `${provider}/${name}`,
        provider,
        model: name,
        context: `${128 + index * 8}k`,
        maxOut: index % 4 === 3 ? null : `${16 + (index % 5) * 8}k`,
        thinking: index % 3 !== 2,
        images: index % 2 === 0,
      });
    }
  }
  return models;
}

function assignment(model: string, reasoning: string | null, models?: string[]) {
  const value: Record<string, unknown> = { model };
  if (reasoning !== null) value["reasoning"] = reasoning;
  if (models !== undefined) value["models"] = models;
  return value;
}

function buildProfile(id: string, name: string, note: string, primary: string, level: string): Profile {
  const agents: Record<string, Record<string, unknown>> = {};
  for (const [index, agent] of KNOWN_AGENTS.entries()) {
    agents[agent] = assignment(
      primary,
      index % 3 === 0 ? level : "medium",
      index === 0 ? ["anthropic/claude-sonnet-5"] : undefined,
    );
  }
  const categories: Record<string, Record<string, unknown>> = {};
  for (const [index, category] of KNOWN_CATEGORIES.entries()) {
    categories[category] = assignment(primary, index % 2 === 0 ? level : "low");
  }
  return {
    id,
    name,
    note,
    agents,
    categories,
    createdAt: "2026-09-20T09:00:00Z",
    updatedAt: "2026-09-26T18:30:00Z",
  };
}

export function seedProfiles(): Profile[] {
  return [
    buildProfile(
      "11111111-1111-4111-8111-111111111111",
      "Default (imported)",
      "Imported from [opencode].",
      "anthropic/claude-opus-5",
      "high",
    ),
    buildProfile(
      "22222222-2222-4222-8222-222222222222",
      "Fast and cheap",
      "Low-cost daily driver.",
      "openai/gpt-6-mini",
      "low",
    ),
  ];
}
