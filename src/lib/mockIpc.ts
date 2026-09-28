import { mockIPC } from "@tauri-apps/api/mocks";
import type { InvokeArgs } from "@tauri-apps/api/core";
import { BUILTIN_CATALOG } from "./catalog";
import { seedModels, seedProfiles, seedProviders } from "./mockData";
import type {
  AppError,
  AppErrorKind,
  ApplyResult,
  BackupInfo,
  FetchedModels,
  ImportResult,
  ModelInput,
  NativeCatalog,
  ProbeResult,
  Profile,
  ProfileInput,
  ProviderApi,
  ProviderImportResult,
  ProviderInfo,
  ProviderInput,
  ProviderJson,
  ProviderModel,
  ProvidersResult,
  Status,
  SwitchPreview,
} from "./types";

export interface OmoswitchMockControls {
  setDrift: (drifted: boolean) => void;
  setOmoMissing: (missing: boolean) => void;
  setProviderProbe: (id: string, result: ProbeResult | "fail") => void;
  setProviderFetch: (id: string, result: FetchedModels | "fail") => void;
  setKeyPresent: (id: string, present: boolean) => void;
  setCatalog: (catalog: Partial<NativeCatalog> | "fail") => void;
}

declare global {
  interface Window {
    __omoswitchMock?: OmoswitchMockControls;
  }
}

const CONFIG_PATH = "C:\\Users\\tom\\.omo\\omo.jsonc";
const AGENT_DIR = "C:\\Users\\tom\\.omo\\agent";
const MODELS_JSON_PATH = "C:\\Users\\tom\\.omo\\agent\\models.json";

function fail(kind: AppErrorKind, message: string, extra: Partial<AppError> = {}): never {
  const error: AppError = { kind, message, ...extra };
  throw error;
}

function nativeText(profile: Profile | null): string {
  if (profile === null) return '"[native]": {}';
  return JSON.stringify({ agents: profile.agents, categories: profile.categories }, null, 2);
}

function hashOf(seed: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < seed.length; index += 1) {
    hash = Math.imul(hash ^ seed.charCodeAt(index), 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0").repeat(8);
}

function nowIso(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

const REDACTED = "<redacted>";
const SENSITIVE_HEADER = /auth|key|token|secret|cookie/i;
const VALID_APIS: readonly ProviderApi[] = ["openai-completions", "openai-responses", "anthropic-messages"];
const VALID_INPUTS: readonly ModelInput[] = ["text", "image"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function redactHeaders(headers: unknown): unknown {
  if (!isRecord(headers)) return headers;
  return Object.fromEntries(
    Object.entries(headers).map(([name, value]) => [
      name,
      SENSITIVE_HEADER.test(name) && typeof value === "string" ? REDACTED : value,
    ]),
  );
}

function restoreHeaders(incoming: unknown, previous: unknown): unknown {
  if (!isRecord(incoming)) return incoming;
  const prior = isRecord(previous) ? previous : {};
  return Object.fromEntries(
    Object.entries(incoming).map(([name, value]) => [
      name,
      value === REDACTED && typeof prior[name] === "string" ? prior[name] : value,
    ]),
  );
}

function redactModel(model: ProviderModel): ProviderModel {
  return "headers" in model ? { ...model, headers: redactHeaders(model.headers) } : { ...model };
}

function restoreModels(models: ProviderModel[], previous: ProviderModel[]): ProviderModel[] {
  return models.map((model) => {
    if (!("headers" in model)) return model;
    const prior = previous.find((candidate) => candidate.id === model.id);
    return { ...model, headers: restoreHeaders(model.headers, prior?.["headers"]) };
  });
}

function validateModels(value: unknown, requireIds: boolean): ProviderModel[] {
  if (!Array.isArray(value)) fail("invalidProvider", "models must be an array", { field: "models" });
  return value.map((entry: unknown): ProviderModel => {
    if (!isRecord(entry)) fail("invalidProvider", "each model must be an object", { field: "models" });
    const id = entry["id"];
    if (typeof id !== "string" || (requireIds && id.trim() === "")) {
      fail("invalidProvider", "each model needs a string id", { field: "models" });
    }
    const input = entry["input"];
    if (
      input !== undefined &&
      !(Array.isArray(input) && input.every((item) => VALID_INPUTS.some((valid) => valid === item)))
    ) {
      fail("invalidProvider", `input must be a list of: ${VALID_INPUTS.join(", ")}`, { field: "input" });
    }
    for (const key of ["contextWindow", "maxTokens"] as const) {
      const count = entry[key];
      if (count !== undefined && !(typeof count === "number" && Number.isInteger(count) && count > 0)) {
        fail("invalidProvider", `${key} must be a positive integer`, { field: key });
      }
    }
    return entry as ProviderModel;
  });
}

class MockBackend {
  private profiles = seedProfiles();
  private readonly models = seedModels();
  private providers = seedProviders();
  private backups: BackupInfo[] = [];
  private activeProfileId: string | null = null;
  private drifted = false;
  private fileNative = nativeText(null);
  private omoMissing = false;
  private nextId = 3;
  private providerProbes = new Map<string, ProbeResult | "fail">();
  private providerFetches = new Map<string, FetchedModels | "fail">();
  private catalogOverride: Partial<NativeCatalog> | "fail" = {};
  private providerExtras = new Map<string, Record<string, unknown>>();

  setCatalog(catalog: Partial<NativeCatalog> | "fail"): void {
    this.catalogOverride = catalog;
  }

  getNativeCatalog(refresh: boolean): NativeCatalog {
    if (!refresh) return structuredClone(BUILTIN_CATALOG);
    if (this.catalogOverride === "fail") fail("io", "failed to read the installed omo agent registry");
    return {
      agents: [...BUILTIN_CATALOG.agents],
      categories: [...BUILTIN_CATALOG.categories],
      source: "installed",
      omoVersion: "5.0.1",
      fetchedAt: nowIso(),
      ...this.catalogOverride,
    };
  }

  setDrift(drifted: boolean): void {
    this.drifted = drifted;
  }

  setOmoMissing(missing: boolean): void {
    this.omoMissing = missing;
  }

  setProviderProbe(id: string, result: ProbeResult | "fail"): void {
    this.providerProbes.set(id, result);
  }

  setProviderFetch(id: string, result: FetchedModels | "fail"): void {
    this.providerFetches.set(id, result);
  }

  setKeyPresent(id: string, present: boolean): void {
    const provider = this.providers.find((p) => p.id === id);
    if (provider !== undefined) {
      provider.hasKey = present;
      provider.keySource = present ? "auth" : "none";
    }
  }

  private find(id: string): Profile {
    const profile = this.profiles.find((candidate) => candidate.id === id);
    if (profile === undefined) fail("profileNotFound", `profile ${id} not found`);
    return profile;
  }

  private active(): Profile | null {
    return this.activeProfileId === null ? null : this.find(this.activeProfileId);
  }

  getStatus(): Status {
    const active = this.active();
    return {
      configPath: CONFIG_PATH,
      configExists: true,
      activeProfileId: this.activeProfileId,
      drift:
        active === null
          ? "noActive"
          : this.drifted || this.fileNative !== nativeText(active)
            ? "drifted"
            : "inSync",
      nativeBlockPresent: active !== null,
      legacySenpiPresent: true,
      omoAvailable: !this.omoMissing,
      configHash: hashOf(this.fileNative),
      agentDir: AGENT_DIR,
      modelsJsonPresent: true,
      providerCount: this.providers.length,
    };
  }

  listProfiles(): Profile[] {
    return this.profiles.map((profile) => structuredClone(profile));
  }

  saveProfile(input: ProfileInput): Profile {
    const name = input.name.trim();
    if (name === "") fail("invalidProfile", "name is required", { field: "name" });
    if (input.id !== undefined) {
      const existing = this.find(input.id);
      const updated: Profile = {
        ...existing,
        name,
        note: input.note ?? "",
        agents: input.agents,
        categories: input.categories,
        updatedAt: nowIso(),
      };
      this.profiles = this.profiles.map((profile) => (profile.id === updated.id ? updated : profile));
      return structuredClone(updated);
    }
    const created: Profile = {
      id: `${this.nextId}${"3".repeat(7)}-3333-4333-8333-${"3".repeat(12)}`,
      name,
      note: input.note ?? "",
      agents: input.agents,
      categories: input.categories,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    this.nextId += 1;
    this.profiles = [...this.profiles, created];
    return structuredClone(created);
  }

  deleteProfile(id: string): null {
    this.find(id);
    this.profiles = this.profiles.filter((profile) => profile.id !== id);
    if (this.activeProfileId === id) this.activeProfileId = null;
    return null;
  }

  duplicateProfile(id: string, name: string): Profile {
    const source = this.find(id);
    return this.saveProfile({
      name,
      note: source.note,
      agents: structuredClone(source.agents),
      categories: structuredClone(source.categories),
    });
  }

  importFromConfig(source: "opencode" | "native", name: string): ImportResult {
    const template = this.profiles[0];
    if (template === undefined) fail("storeCorrupt", "no seed profile");
    const profile = this.saveProfile({
      name,
      note: `Imported from [${source}].`,
      agents: structuredClone(template.agents),
      categories: structuredClone(template.categories),
    });
    const renamed: [string, string][] =
      source === "opencode"
        ? [
            ["metis", "plan-consultant"],
            ["momus", "plan-reviewer"],
          ]
        : [];
    const dropped =
      source === "opencode"
        ? [
            "sisyphus",
            "hephaestus",
            "prometheus",
            "atlas",
            "oracle",
            "multimodal-looker",
            "sisyphus-junior",
          ]
        : [];
    return { profile, renamed, dropped };
  }

  captureActiveFromConfig(): Profile {
    const captured = this.importFromConfig("native", `Captured ${nowIso()}`).profile;
    this.activeProfileId = captured.id;
    this.drifted = false;
    this.fileNative = nativeText(captured);
    return captured;
  }

  previewSwitch(id: string): SwitchPreview {
    const target = this.find(id);
    const before = this.fileNative;
    const after = nativeText(target);
    return {
      profileId: id,
      baseHash: hashOf(before),
      beforeNative: before,
      afterNative: after,
      changed: before !== after,
    };
  }

  applyProfile(id: string, expectedHash?: string): ApplyResult {
    const target = this.find(id);
    const before = this.fileNative;
    if (expectedHash !== undefined && expectedHash !== hashOf(before)) {
      fail("changedOnDisk", "omo.jsonc changed since preview");
    }
    const after = nativeText(target);
    if (before === after && !this.drifted) {
      this.activeProfileId = id;
      return { changed: false, backupPath: null, configPath: CONFIG_PATH };
    }
    const backupPath = `${CONFIG_PATH}.bak.omoswitch-${nowIso().replace(/:/g, "-")}`;
    this.backups = [
      { path: backupPath, createdAt: nowIso(), sizeBytes: 2048 + this.backups.length * 17 },
      ...this.backups,
    ];
    this.activeProfileId = id;
    this.drifted = false;
    this.fileNative = after;
    return { changed: true, backupPath, configPath: CONFIG_PATH };
  }

  listModels(refresh: boolean): typeof this.models {
    if (refresh && this.omoMissing) fail("omoNotFound", "omo executable not found");
    return this.models.map((model) => ({ ...model }));
  }

  listBackups(): BackupInfo[] {
    return this.backups.map((backup) => ({ ...backup }));
  }

  restoreBackup(path: string): ApplyResult {
    if (!this.backups.some((backup) => backup.path === path)) {
      fail("io", `backup not found: ${path}`);
    }
    const backupPath = `${CONFIG_PATH}.bak.omoswitch-${nowIso().replace(/:/g, "-")}`;
    this.backups = [{ path: backupPath, createdAt: nowIso(), sizeBytes: 2048 }, ...this.backups];
    this.activeProfileId = null;
    this.drifted = false;
    this.fileNative = nativeText(null);
    return { changed: true, backupPath, configPath: CONFIG_PATH };
  }

  private findProvider(id: string): ProviderInfo {
    const provider = this.providers.find((p) => p.id === id);
    if (provider === undefined) fail("providerNotFound", `provider ${id} not found`);
    return provider;
  }

  private present(provider: ProviderInfo): ProviderInfo {
    return structuredClone({ ...provider, models: provider.models.map(redactModel) });
  }

  private replaceProvider(updated: ProviderInfo): ProviderInfo {
    this.providers = this.providers.map((p) => (p.id === updated.id ? updated : p));
    return this.present(updated);
  }

  listProviders(): ProvidersResult {
    return {
      agentDir: AGENT_DIR,
      modelsJsonPath: MODELS_JSON_PATH,
      providers: this.providers.map((p) => this.present(p)),
    };
  }

  saveProvider(input: ProviderInput): ProviderInfo {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(input.id)) {
      fail("invalidProvider", "id must match ^[a-z0-9][a-z0-9-]*$", { field: "id" });
    }
    if (!/^https?:\/\/.+/.test(input.baseUrl)) {
      fail("invalidProvider", "baseUrl must start with http:// or https://", { field: "baseUrl" });
    }
    if (!VALID_APIS.includes(input.api)) {
      fail("invalidProvider", `api must be one of: ${VALID_APIS.join(", ")}`, { field: "api" });
    }
    const models = validateModels(structuredClone(input.models), false);
    const existing = this.providers.find((p) => p.id === input.id);
    if (existing !== undefined) {
      return this.replaceProvider({
        ...existing,
        name: input.name,
        baseUrl: input.baseUrl,
        api: input.api,
        models: restoreModels(models, existing.models),
        inlineKey: input.inlineKey,
      });
    }
    const created: ProviderInfo = {
      id: input.id,
      name: input.name,
      baseUrl: input.baseUrl,
      api: input.api,
      models,
      enabled: true,
      hasKey: false,
      keySource: "none",
      inlineKey: input.inlineKey,
      knownToOmo: false,
    };
    this.providers = [...this.providers, created];
    return this.present(created);
  }

  deleteProvider(id: string): void {
    this.findProvider(id);
    this.providers = this.providers.filter((p) => p.id !== id);
    this.providerExtras.delete(id);
  }

  getProviderJson(id: string): ProviderJson {
    const provider = this.findProvider(id);
    const extras = this.providerExtras.get(id) ?? {};
    const body: Record<string, unknown> = {
      name: provider.name,
      baseUrl: provider.baseUrl,
      api: provider.api,
      models: provider.models.map(redactModel),
    };
    for (const [key, value] of Object.entries(extras)) {
      body[key] = key === "headers" ? redactHeaders(value) : structuredClone(value);
    }
    return { json: JSON.stringify(body, null, 2) };
  }

  saveProviderJson(id: string, json: string): ProviderInfo {
    const existing = this.findProvider(id);
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch (cause) {
      fail("invalidProvider", `invalid JSON: ${cause instanceof Error ? cause.message : String(cause)}`, {
        field: "json",
      });
    }
    if (!isRecord(parsed)) fail("invalidProvider", "provider JSON must be an object", { field: "json" });
    if ("apiKey" in parsed) {
      fail("invalidProvider", "apiKey cannot be set here; use the API key field", { field: "apiKey" });
    }
    const { name, baseUrl, api: providerApi, models, ...extras } = parsed;
    if (typeof baseUrl !== "string" || !/^https?:\/\/.+/.test(baseUrl)) {
      fail("invalidProvider", "baseUrl must start with http:// or https://", { field: "baseUrl" });
    }
    if (typeof providerApi !== "string" || !VALID_APIS.some((valid) => valid === providerApi)) {
      fail("invalidProvider", `api must be one of: ${VALID_APIS.join(", ")}`, { field: "api" });
    }
    const nextModels = restoreModels(validateModels(models, true), existing.models);
    const previousExtras = this.providerExtras.get(id) ?? {};
    if ("headers" in extras) {
      extras["headers"] = restoreHeaders(extras["headers"], previousExtras["headers"]);
    }
    this.providerExtras.set(id, extras);
    return this.replaceProvider({
      ...existing,
      name: typeof name === "string" && name.trim() !== "" ? name : existing.id,
      baseUrl,
      api: providerApi as ProviderApi,
      models: nextModels,
    });
  }

  setProviderEnabled(id: string, enabled: boolean): ProviderInfo {
    const provider = this.findProvider(id);
    provider.enabled = enabled;
    return this.present(provider);
  }

  setProviderKey(id: string, key: string): ProviderInfo {
    const provider = this.findProvider(id);
    if (key.trim() === "") fail("invalidProvider", "key cannot be empty", { field: "key" });
    provider.hasKey = true;
    provider.keySource = "auth";
    return this.present(provider);
  }

  clearProviderKey(id: string): ProviderInfo {
    const provider = this.findProvider(id);
    provider.hasKey = false;
    provider.keySource = "none";
    return this.present(provider);
  }

  testProvider(id: string): ProbeResult {
    this.findProvider(id);
    const override = this.providerProbes.get(id);
    if (override === "fail") fail("networkUnreachable", `test failed for ${id}`);
    if (override !== undefined) return override;
    return { reachable: true, status: 200, latencyMs: 120, tier: "fast", errorKind: null };
  }

  fetchProviderModels(id: string): FetchedModels {
    this.findProvider(id);
    const override = this.providerFetches.get(id);
    if (override === "fail") fail("modelFetchParse", `fetch failed for ${id}`);
    if (override !== undefined) return override;
    return { source: "v1/models", ids: ["model-a", "model-b"] };
  }

  importProvidersFromOpencode(): ProviderImportResult {
    const updated: string[] = [];
    const deepseek = this.providers.find((p) => p.id === "deepseek");
    if (deepseek !== undefined && deepseek.models.some((model) => model.input === undefined)) {
      deepseek.models = deepseek.models.map((model): ProviderModel =>
        model.input === undefined ? { ...model, input: ["text"] } : model,
      );
      updated.push(deepseek.id);
    }
    return { imported: ["openai", "anthropic"], updated, skipped: ["custom"], keysFound: 1 };
  }
}

function arg<T>(payload: InvokeArgs | undefined, key: string): T {
  const record = payload as Record<string, unknown> | undefined;
  if (record === undefined || !(key in record)) fail("invalidProfile", `missing arg ${key}`, { field: key });
  return record[key] as T;
}

export function installMockIpc(): OmoswitchMockControls {
  const backend = new MockBackend();
  mockIPC((cmd, payload) => {
    switch (cmd) {
      case "get_status":
        return backend.getStatus();
      case "list_profiles":
        return backend.listProfiles();
      case "save_profile":
        return backend.saveProfile(arg<ProfileInput>(payload, "input"));
      case "delete_profile":
        return backend.deleteProfile(arg<string>(payload, "id"));
      case "duplicate_profile":
        return backend.duplicateProfile(arg<string>(payload, "id"), arg<string>(payload, "name"));
      case "import_from_config":
        return backend.importFromConfig(
          arg<"opencode" | "native">(payload, "source"),
          arg<string>(payload, "name"),
        );
      case "capture_active_from_config":
        return backend.captureActiveFromConfig();
      case "preview_switch":
        return backend.previewSwitch(arg<string>(payload, "id"));
      case "apply_profile": {
        const record = payload as Record<string, unknown> | undefined;
        const expected = record?.["expectedHash"];
        return backend.applyProfile(
          arg<string>(payload, "id"),
          typeof expected === "string" ? expected : undefined,
        );
      }
      case "list_models":
        return backend.listModels(arg<boolean>(payload, "refresh"));
      case "get_native_catalog":
        return backend.getNativeCatalog(arg<boolean>(payload, "refresh"));
      case "latest_omo_version":
        return null;
      case "list_backups":
        return backend.listBackups();
      case "restore_backup":
        return backend.restoreBackup(arg<string>(payload, "path"));
      case "list_providers":
        return backend.listProviders();
      case "save_provider":
        return backend.saveProvider(arg<ProviderInput>(payload, "input"));
      case "delete_provider":
        return backend.deleteProvider(arg<string>(payload, "id"));
      case "set_provider_enabled":
        return backend.setProviderEnabled(arg<string>(payload, "id"), arg<boolean>(payload, "enabled"));
      case "set_provider_key":
        return backend.setProviderKey(arg<string>(payload, "id"), arg<string>(payload, "key"));
      case "clear_provider_key":
        return backend.clearProviderKey(arg<string>(payload, "id"));
      case "test_provider":
        return backend.testProvider(arg<string>(payload, "id"));
      case "fetch_provider_models":
        return backend.fetchProviderModels(arg<string>(payload, "id"));
      case "import_providers_from_opencode":
        return backend.importProvidersFromOpencode();
      case "get_provider_json":
        return backend.getProviderJson(arg<string>(payload, "id"));
      case "save_provider_json":
        return backend.saveProviderJson(arg<string>(payload, "id"), arg<string>(payload, "json"));
      default:
        return fail("io", `unknown command ${cmd}`);
    }
  });

  const controls: OmoswitchMockControls = {
    setDrift: (drifted) => backend.setDrift(drifted),
    setOmoMissing: (missing) => backend.setOmoMissing(missing),
    setProviderProbe: (id, result) => backend.setProviderProbe(id, result),
    setProviderFetch: (id, result) => backend.setProviderFetch(id, result),
    setKeyPresent: (id, present) => backend.setKeyPresent(id, present),
    setCatalog: (catalog) => backend.setCatalog(catalog),
  };
  window.__omoswitchMock = controls;
  return controls;
}
