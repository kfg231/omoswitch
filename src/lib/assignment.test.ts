import { describe, expect, it } from "vitest";
import {
  formatModelString,
  mergeAssignment,
  parseModelString,
  splitAssignment,
  validateProfileInput,
} from "./assignment";
import type { Profile, ProfileInput } from "./types";

function profile(id: string, name: string): Profile {
  return {
    id,
    name,
    note: "",
    agents: {},
    categories: {},
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  };
}

function input(overrides: Partial<ProfileInput> = {}): ProfileInput {
  return { name: "Valid", agents: {}, categories: {}, ...overrides };
}

describe("splitAssignment", () => {
  it("separates managed keys from extra keys", () => {
    const parts = splitAssignment({
      model: "anthropic/claude-opus-5",
      reasoning: "high",
      models: ["openai/gpt-6-mini", 42],
      temperature: 0.4,
    });
    expect(parts).toEqual({
      model: "anthropic/claude-opus-5",
      reasoning: "high",
      models: ["openai/gpt-6-mini"],
      extra: { temperature: 0.4 },
    });
  });

  it("returns null reasoning for an unknown level", () => {
    expect(splitAssignment({ model: "p/m", reasoning: "turbo" }).reasoning).toBeNull();
  });
});

describe("mergeAssignment", () => {
  it("omits empty managed values", () => {
    const merged = mergeAssignment({ model: "p/m", reasoning: null, models: [], extra: {} });
    expect(Object.keys(merged)).toEqual(["model"]);
  });

  it("preserves the original key order and appends new keys", () => {
    const original = { reasoning: "low", temperature: 0.2, model: "p/old" };
    const parts = splitAssignment(original);
    parts.model = "p/new";
    parts.models = ["p/fallback"];
    const merged = mergeAssignment(parts, Object.keys(original));
    expect(Object.keys(merged)).toEqual(["reasoning", "temperature", "model", "models"]);
    expect(merged["model"]).toBe("p/new");
  });

  it("round-trips an assignment without changing key order", () => {
    const original = { model: "p/m", reasoning: "max", models: ["p/x"], extra: { a: 1 } };
    const merged = mergeAssignment(splitAssignment(original), Object.keys(original));
    expect(merged).toEqual(original);
    expect(Object.keys(merged)).toEqual(Object.keys(original));
  });
});

describe("parseModelString", () => {
  it("splits a valid reasoning suffix", () => {
    expect(parseModelString("provider/model:high")).toEqual({ model: "provider/model", reasoning: "high" });
  });

  it("keeps the whole string when the suffix is not a level", () => {
    expect(parseModelString("provider/model:turbo")).toEqual({ model: "provider/model:turbo", reasoning: null });
  });

  it("keeps a plain model untouched", () => {
    expect(parseModelString("provider/model")).toEqual({ model: "provider/model", reasoning: null });
  });

  it("formats back to the suffixed form", () => {
    expect(formatModelString("p/m", "xhigh")).toBe("p/m:xhigh");
    expect(formatModelString("p/m", null)).toBe("p/m");
  });
});

describe("validateProfileInput", () => {
  const existing = [profile("a", "Default"), profile("b", "Fast")];

  it("accepts a valid profile", () => {
    expect(validateProfileInput(input({ agents: { explore: { model: "p/m" } } }), existing)).toEqual({});
  });

  it("rejects an empty name", () => {
    expect(validateProfileInput(input({ name: "  " }), existing)["name"]).toBe("validation.nameRequired");
  });

  it("rejects a name longer than 64 characters", () => {
    expect(validateProfileInput(input({ name: "x".repeat(65) }), existing)["name"]).toBe("validation.nameTooLong");
  });

  it("rejects a case-insensitive duplicate name but allows renaming itself", () => {
    expect(validateProfileInput(input({ name: "default" }), existing)["name"]).toBe("validation.nameDuplicate");
    expect(validateProfileInput(input({ id: "a", name: "Default" }), existing)["name"]).toBeUndefined();
  });

  it("reports bad keys, empty models and bad reasoning per field", () => {
    const errors = validateProfileInput(
      input({
        agents: { "Bad_Key": { model: "p/m" }, librarian: { model: "" } },
        categories: { quick: { model: "p/m", reasoning: "turbo" } },
      }),
      existing,
    );
    expect(errors["agents.Bad_Key"]).toBe("validation.keyPattern");
    expect(errors["agents.librarian.model"]).toBe("validation.modelRequired");
    expect(errors["categories.quick.reasoning"]).toBe("validation.reasoningInvalid");
  });
});
