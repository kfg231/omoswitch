import { describe, expect, it } from "vitest";
import { KNOWN_AGENTS, KNOWN_CATEGORIES, REASONING_LEVELS } from "../lib/catalog";
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
  it("lists 11 agents and 10 categories with unique names", () => {
    expect(KNOWN_AGENTS).toHaveLength(11);
    expect(KNOWN_CATEGORIES).toHaveLength(10);
    expect(new Set(KNOWN_AGENTS).size).toBe(11);
    expect(new Set(KNOWN_CATEGORIES).size).toBe(10);
  });

  it("lists the eight schema reasoning levels in order", () => {
    expect(REASONING_LEVELS).toEqual(["off", "minimal", "low", "medium", "high", "xhigh", "max", "auto"]);
  });
});
