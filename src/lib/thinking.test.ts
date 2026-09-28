import { describe, expect, it } from "vitest";
import { REASONING_LEVELS } from "./catalog";
import { isLevelEnabled, reasoningOptions, setLevelEnabled, supportedLevels } from "./thinking";
import type { ModelInfo, ProviderInfo } from "./types";

function provider(models: ProviderInfo["models"]): ProviderInfo {
  return {
    id: "custom",
    name: "custom",
    baseUrl: "https://custom.test/v1",
    api: "openai-completions",
    models,
    enabled: true,
    hasKey: true,
    keySource: "auth",
    inlineKey: false,
    knownToOmo: true,
  };
}

function info(id: string, thinking: boolean): ModelInfo {
  return { id, provider: id.split("/")[0]!, model: id.split("/")[1]!, context: null, maxOut: null, thinking, images: false };
}

describe("thinkingLevelMap helpers", () => {
  it("treats base levels as enabled unless null and extended levels only when mapped", () => {
    const map = { minimal: null, max: "max" };
    expect(isLevelEnabled(map, "low")).toBe(true);
    expect(isLevelEnabled(map, "minimal")).toBe(false);
    expect(isLevelEnabled(map, "xhigh")).toBe(false);
    expect(isLevelEnabled(map, "max")).toBe(true);
  });

  it("toggles levels using null for base levels and the level name for extended ones", () => {
    let map = setLevelEnabled({}, "minimal", false);
    expect(map).toEqual({ minimal: null });
    map = setLevelEnabled(map, "xhigh", true);
    expect(map).toEqual({ minimal: null, xhigh: "xhigh" });
    map = setLevelEnabled(map, "minimal", true);
    map = setLevelEnabled(map, "xhigh", false);
    expect(map).toEqual({});
  });

  it("matches senpi supported levels", () => {
    expect(supportedLevels({ id: "m" })).toEqual(["off"]);
    expect(supportedLevels({ id: "m", reasoning: true })).toBeNull();
    expect(
      supportedLevels({ id: "m", reasoning: true, thinkingLevelMap: { off: null, minimal: null, max: "max" } }),
    ).toEqual(["low", "medium", "high", "max"]);
  });
});

describe("reasoningOptions", () => {
  const providers = [
    provider([{ id: "mid", reasoning: true, thinkingLevelMap: { off: null, minimal: null, low: null, high: null } }]),
  ];

  it("limits choices to the provider map plus auto", () => {
    expect(reasoningOptions("custom/mid", null, [], providers, REASONING_LEVELS)).toEqual(["medium", "auto"]);
  });

  it("keeps the current value visible even when unsupported", () => {
    expect(reasoningOptions("custom/mid", "high", [], providers, REASONING_LEVELS)).toEqual(["medium", "high", "auto"]);
  });

  it("offers only off and auto for non-thinking omo models", () => {
    expect(reasoningOptions("openai/x", null, [info("openai/x", false)], [], REASONING_LEVELS)).toEqual(["off", "auto"]);
  });

  it("offers everything when support cannot be determined", () => {
    expect(reasoningOptions("openai/y", null, [info("openai/y", true)], [], REASONING_LEVELS)).toEqual([...REASONING_LEVELS]);
    expect(reasoningOptions("unknown/z", null, [], [], REASONING_LEVELS)).toEqual([...REASONING_LEVELS]);
  });
});
