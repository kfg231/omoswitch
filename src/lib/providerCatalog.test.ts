import { describe, expect, it } from "vitest";
import { PROVIDER_PRESETS, getPreset } from "./providerCatalog";

describe("provider catalog", () => {
  it("exports 11 presets including custom", () => {
    expect(PROVIDER_PRESETS).toHaveLength(11);
    expect(PROVIDER_PRESETS.map((p) => p.id)).toContain("custom");
  });

  it("includes all required presets", () => {
    const ids = PROVIDER_PRESETS.map((p) => p.id);
    const required = [
      "openai",
      "anthropic",
      "deepseek",
      "openrouter",
      "groq",
      "moonshot",
      "zhipu",
      "ollama",
      "lmstudio",
      "google",
      "custom",
    ];
    for (const id of required) {
      expect(ids).toContain(id);
    }
  });

  it("sets anthropic to anthropic-messages API", () => {
    const preset = getPreset("anthropic");
    expect(preset?.api).toBe("anthropic-messages");
  });

  it("sets all others except anthropic to openai-completions", () => {
    const nonAnthropic = PROVIDER_PRESETS.filter((p) => p.id !== "anthropic");
    for (const preset of nonAnthropic) {
      expect(preset.api).toBe("openai-completions");
    }
  });

  it("sets localhost baseUrl for ollama and lmstudio", () => {
    expect(getPreset("ollama")?.baseUrl).toBe("http://localhost:11434/v1");
    expect(getPreset("lmstudio")?.baseUrl).toBe("http://localhost:1234/v1");
  });

  it("marks ollama and lmstudio as not requiring keys", () => {
    expect(getPreset("ollama")?.requiresKey).toBe(false);
    expect(getPreset("ollama")?.apiKeyUrl).toBeNull();
    expect(getPreset("lmstudio")?.requiresKey).toBe(false);
    expect(getPreset("lmstudio")?.apiKeyUrl).toBeNull();
  });

  it("marks cloud providers as requiring keys", () => {
    const cloudIds = ["openai", "anthropic", "deepseek", "openrouter", "groq", "moonshot", "zhipu", "google"];
    for (const id of cloudIds) {
      const preset = getPreset(id);
      expect(preset?.requiresKey).toBe(true);
      expect(preset?.apiKeyUrl).not.toBeNull();
    }
  });

  it("provides default models for most presets", () => {
    const withDefaults = ["openai", "anthropic", "deepseek", "groq", "moonshot", "zhipu", "google", "ollama"];
    for (const id of withDefaults) {
      const preset = getPreset(id);
      expect(preset?.defaultModels.length).toBeGreaterThan(0);
    }
  });

  it("returns undefined for unknown preset id", () => {
    expect(getPreset("nonexistent")).toBeUndefined();
  });
});
