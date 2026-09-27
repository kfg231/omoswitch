import { isReasoning } from "./catalog";
import type { Assignment, Profile, ProfileInput, Reasoning } from "./types";

export interface AssignmentParts {
  model: string;
  reasoning: Reasoning | null;
  models: string[];
  extra: Record<string, unknown>;
}

const MANAGED_KEYS = ["model", "reasoning", "models"] as const;
const KEY_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const NAME_MAX = 64;

export function splitAssignment(assignment: Assignment): AssignmentParts {
  const extra: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(assignment)) {
    if (!MANAGED_KEYS.some((managed) => managed === key)) extra[key] = value;
  }
  const rawModels = assignment["models"];
  return {
    model: typeof assignment["model"] === "string" ? assignment["model"] : "",
    reasoning: isReasoning(assignment["reasoning"]) ? assignment["reasoning"] : null,
    models: Array.isArray(rawModels) ? rawModels.filter((entry): entry is string => typeof entry === "string") : [],
    extra,
  };
}

export function mergeAssignment(parts: AssignmentParts, originalKeyOrder?: readonly string[]): Assignment {
  const next = new Map<string, unknown>();
  if (parts.model !== "") next.set("model", parts.model);
  if (parts.reasoning !== null) next.set("reasoning", parts.reasoning);
  if (parts.models.length > 0) next.set("models", [...parts.models]);
  for (const [key, value] of Object.entries(parts.extra)) next.set(key, value);

  const result: Assignment = {};
  for (const key of originalKeyOrder ?? []) {
    if (next.has(key)) {
      result[key] = next.get(key);
      next.delete(key);
    }
  }
  for (const [key, value] of next) result[key] = value;
  return result;
}

export function parseModelString(raw: string): { model: string; reasoning: Reasoning | null } {
  const separator = raw.lastIndexOf(":");
  if (separator > 0) {
    const suffix = raw.slice(separator + 1);
    if (isReasoning(suffix)) return { model: raw.slice(0, separator), reasoning: suffix };
  }
  return { model: raw, reasoning: null };
}

export function formatModelString(model: string, reasoning: Reasoning | null): string {
  return reasoning === null ? model : `${model}:${reasoning}`;
}

export type ValidationErrors = Record<string, string>;

function validateAssignments(
  section: "agents" | "categories",
  entries: Record<string, Assignment>,
  errors: ValidationErrors,
): void {
  for (const [key, assignment] of Object.entries(entries)) {
    const field = `${section}.${key}`;
    if (!KEY_PATTERN.test(key)) errors[field] = "validation.keyPattern";
    const parts = splitAssignment(assignment);
    if (parts.model.trim() === "") errors[`${field}.model`] = "validation.modelRequired";
    const reasoning = assignment["reasoning"];
    if (reasoning !== undefined && !isReasoning(reasoning)) {
      errors[`${field}.reasoning`] = "validation.reasoningInvalid";
    }
  }
}

export function validateProfileInput(
  input: ProfileInput,
  existingProfiles: readonly Profile[],
): ValidationErrors {
  const errors: ValidationErrors = {};
  const name = input.name.trim();
  if (name.length < 1) errors["name"] = "validation.nameRequired";
  else if (name.length > NAME_MAX) errors["name"] = "validation.nameTooLong";
  else if (
    existingProfiles.some(
      (profile) => profile.id !== input.id && profile.name.trim().toLowerCase() === name.toLowerCase(),
    )
  ) {
    errors["name"] = "validation.nameDuplicate";
  }
  validateAssignments("agents", input.agents, errors);
  validateAssignments("categories", input.categories, errors);
  return errors;
}
