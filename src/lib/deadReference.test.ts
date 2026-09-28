import { describe, expect, it } from "vitest";
import { findDeadProviders, mergeModelOptions, providerPrefix } from "./deadReference";
import type { ModelInfo, ProviderInfo } from "./types";

function omo(id: string): ModelInfo {
  const [provider = "", model = ""] = id.split("/");
  return { id, provider, model, context: "128k", maxOut: null, thinking: false, images: false };
}

function provider(id: string, models: string[]): ProviderInfo {
  return {
    id,
    name: id,
    baseUrl: "https://example.test/v1",
    api: "openai-completions",
    models: models.map((modelId) => ({ id: modelId })),
    enabled: true,
    hasKey: false,
    keySource: "none",
    inlineKey: false,
    knownToOmo: false,
  };
}

describe("providerPrefix", () => {
  it("extracts the provider part", () => {
    expect(providerPrefix("wawazz-gpt/gpt-6-sol")).toBe("wawazz-gpt");
  });
  it("returns null without a provider", () => {
    expect(providerPrefix("gpt-6-sol")).toBeNull();
    expect(providerPrefix("/gpt-6-sol")).toBeNull();
    expect(providerPrefix("")).toBeNull();
  });
});

describe("findDeadProviders", () => {
  const omoModels = [omo("openai/gpt-6-mini"), omo("anthropic/claude-opus-5")];

  it("flags a prefix unknown to omo and not configured", () => {
    expect(findDeadProviders(["wawazz-gpt/gpt-6-sol"], omoModels, [])).toEqual(["wawazz-gpt"]);
  });

  it("clears once the provider is configured", () => {
    expect(
      findDeadProviders(["wawazz-gpt/gpt-6-sol"], omoModels, [provider("wawazz-gpt", [])]),
    ).toEqual([]);
  });

  it("accepts providers omo knows and ignores bare or empty ids", () => {
    expect(findDeadProviders(["openai/gpt-6-mini", "bare", ""], omoModels, [])).toEqual([]);
  });

  it("reports each dead provider once across primary and fallbacks", () => {
    expect(
      findDeadProviders(
        ["wawazz-gpt/a", "wawazz-gpt/b", "wawazz-gemini/c"],
        omoModels,
        [],
      ),
    ).toEqual(["wawazz-gpt", "wawazz-gemini"]);
  });

  it("stays silent while the omo list is unknown", () => {
    expect(findDeadProviders(["wawazz-gpt/gpt-6-sol"], [], [])).toEqual([]);
  });
});

describe("mergeModelOptions", () => {
  it("tags configured models and omo models and dedupes by id", () => {
    const options = mergeModelOptions(
      [omo("openai/gpt-6-mini"), omo("ollama/llama3.3")],
      [provider("ollama", ["llama3.3", ""]), provider("wawazz-gpt", ["gpt-6-sol"])],
    );
    expect(options.map((option) => [option.id, option.source])).toEqual([
      ["ollama/llama3.3", "configured"],
      ["wawazz-gpt/gpt-6-sol", "configured"],
      ["openai/gpt-6-mini", "omo"],
    ]);
  });
});
