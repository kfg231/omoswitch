import { KNOWN_AGENTS, KNOWN_CATEGORIES } from "./catalog";
import type { ModelInfo, Profile, ProviderInfo } from "./types";

const PROVIDERS = ["openai", "anthropic", "google", "xai", "deepseek", "wawazz-gpt"] as const;
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
      index === 0 ? ["wawazz-gpt/gpt-6-astra"] : undefined,
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

export function seedProviders(): ProviderInfo[] {
  return [
    {
      id: "deepseek",
      name: "DeepSeek",
      baseUrl: "https://api.deepseek.com/v1",
      api: "openai-completions",
      models: [
        { id: "deepseek-chat", name: "DeepSeek Chat", reasoning: false, contextWindow: 64000, maxTokens: 8192 },
        { id: "deepseek-coder", name: "DeepSeek Coder", reasoning: false, contextWindow: 64000, maxTokens: 8192 },
      ],
      enabled: true,
      hasKey: true,
      keySource: "auth",
      inlineKey: false,
      knownToOmo: true,
    },
    {
      id: "openrouter",
      name: "OpenRouter",
      baseUrl: "https://openrouter.ai/api/v1",
      api: "openai-completions",
      models: [{ id: "auto", name: "Auto (best available)", reasoning: false }],
      enabled: false,
      hasKey: false,
      keySource: "none",
      inlineKey: false,
      knownToOmo: false,
    },
    {
      id: "ollama",
      name: "Ollama",
      baseUrl: "http://localhost:11434/v1",
      api: "openai-completions",
      models: [
        { id: "llama3.3", name: "Llama 3.3", reasoning: false, contextWindow: 131072, maxTokens: 8192 },
      ],
      enabled: true,
      hasKey: false,
      keySource: "none",
      inlineKey: false,
      knownToOmo: false,
    },
  ];
}
