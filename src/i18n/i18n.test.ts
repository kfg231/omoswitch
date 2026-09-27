import { describe, expect, it } from "vitest";
import {
  KNOWN_AGENTS,
  KNOWN_CATEGORIES,
  LEGACY_AGENT_ALIASES,
  LEGACY_CATEGORY_ALIASES,
  REASONING_LEVELS,
  isNativeAgent,
  isNativeCategory,
} from "../lib/catalog";
import en from "./en.json";
import ja from "./ja.json";

function flatten(value: unknown, prefix = ""): string[] {
  if (typeof value !== "object" || value === null) return [prefix];
  return Object.entries(value).flatMap(([key, child]) =>
    flatten(child, prefix === "" ? key : `${prefix}.${key}`),
  );
}

describe("locale parity", () => {
  const jaKeys = flatten(ja).sort();
  const enKeys = flatten(en).sort();

  it("ja and en have identical key sets", () => {
    expect(jaKeys).toEqual(enKeys);
  });

  it("has a message for every AppError kind", () => {
    const kinds = [
      "configMissing",
      "malformedJsonc",
      "duplicateKey",
      "changedOnDisk",
      "verifyFailed",
      "omoNotFound",
      "omoListParse",
      "io",
      "storeCorrupt",
      "profileNotFound",
      "invalidProfile",
      "notAnObject",
    ];
    for (const kind of kinds) {
      expect(jaKeys).toContain(`error.${kind}`);
      expect(enKeys).toContain(`error.${kind}`);
    }
  });

  it("has a label for every reasoning level", () => {
    for (const level of REASONING_LEVELS) {
      expect(jaKeys).toContain(`reasoning.${level}`);
      expect(enKeys).toContain(`reasoning.${level}`);
    }
  });

  it("has keys for the T7 screen sections", () => {
    for (const section of [
      "status.title",
      "drift.reapply",
      "drift.capture",
      "profileList.title",
      "editor.title",
      "modelPicker.title",
      "preview.title",
      "import.renamedNotice",
      "import.droppedNotice",
      "editor.unknownKeyBadge",
      "editor.unknownAgentHint",
      "editor.unknownCategoryHint",
      "editor.legacyKeyBadge",
      "editor.legacyKeyHint",
      "backups.title",
      "lang.toggle",
      "common.save",
    ]) {
      expect(jaKeys).toContain(section);
    }
  });

  it("has no empty translation strings", () => {
    const values = (locale: unknown): string[] =>
      typeof locale === "string"
        ? [locale]
        : Object.values(locale as Record<string, unknown>).flatMap(values);
    expect(values(ja).filter((value) => value.trim() === "")).toEqual([]);
    expect(values(en).filter((value) => value.trim() === "")).toEqual([]);
  });
});

describe("catalog", () => {
  it("lists the seven native agents and 10 categories with unique names", () => {
    expect(KNOWN_AGENTS).toEqual([
      "explore",
      "librarian",
      "plan-consultant",
      "plan-reviewer",
      "omo-native-code-reviewer",
      "omo-native-qa-executor",
      "omo-native-gate-reviewer",
    ]);
    expect(KNOWN_CATEGORIES).toHaveLength(10);
    expect(new Set(KNOWN_AGENTS).size).toBe(7);
    expect(new Set(KNOWN_CATEGORIES).size).toBe(10);
  });

  it("excludes the OpenCode-only agent names native cannot resolve", () => {
    for (const opencodeOnly of [
      "sisyphus",
      "hephaestus",
      "prometheus",
      "atlas",
      "oracle",
      "multimodal-looker",
      "sisyphus-junior",
    ]) {
      expect(isNativeAgent(opencodeOnly)).toBe(false);
    }
  });

  it("maps legacy names to their canonical native keys", () => {
    expect(LEGACY_AGENT_ALIASES["omo-senpi-qa-executor"]).toBe("omo-native-qa-executor");
    expect(LEGACY_AGENT_ALIASES["metis"]).toBe("plan-consultant");
    expect(LEGACY_AGENT_ALIASES["momus"]).toBe("plan-reviewer");
    expect(LEGACY_CATEGORY_ALIASES["deep"]).toBe("deep-low");
    for (const target of Object.values(LEGACY_AGENT_ALIASES)) {
      expect(isNativeAgent(target)).toBe(true);
    }
    for (const target of Object.values(LEGACY_CATEGORY_ALIASES)) {
      expect(isNativeCategory(target)).toBe(true);
    }
  });

  it("lists the eight schema reasoning levels in order", () => {
    expect(REASONING_LEVELS).toEqual(["off", "minimal", "low", "medium", "high", "xhigh", "max", "auto"]);
  });
});
