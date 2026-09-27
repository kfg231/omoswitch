import { mockIPC } from "@tauri-apps/api/mocks";
import type { InvokeArgs } from "@tauri-apps/api/core";
import { seedModels, seedProfiles, seedProviders } from "./mockData";
import type {
  AppError,
  AppErrorKind,
  ApplyResult,
  BackupInfo,
  FetchedModels,
  ImportResult,
  ProbeResult,
  Profile,
  ProfileInput,
  ProviderApi,
  ProviderImportResult,
  ProviderInfo,
  ProviderInput,
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

class MockBackend {
  private profiles = seedProfiles();
  private readonly models = seedModels();
  private providers = seedProviders();
  private backups: BackupInfo[] = [];
  private activeProfileId: string | null = null;
  private drifted = false;
  private omoMissing = false;
  private nextId = 3;
  private providerProbes = new Map<string, ProbeResult | "fail">();
  private providerFetches = new Map<string, FetchedModels | "fail">();

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
      drift: active === null ? "noActive" : this.drifted ? "drifted" : "inSync",
      nativeBlockPresent: active !== null,
      legacySenpiPresent: true,
      omoAvailable: !this.omoMissing,
      configHash: hashOf(nativeText(active)),
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
    return captured;
  }

  previewSwitch(id: string): SwitchPreview {
    const target = this.find(id);
    const before = nativeText(this.active());
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
    const before = nativeText(this.active());
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
    return { changed: true, backupPath, configPath: CONFIG_PATH };
  }

  private findProvider(id: string): ProviderInfo {
    const provider = this.providers.find((p) => p.id === id);
    if (provider === undefined) fail("providerNotFound", `provider ${id} not found`);
    return provider;
  }

  listProviders(): ProvidersResult {
    return {
      agentDir: AGENT_DIR,
      modelsJsonPath: MODELS_JSON_PATH,
      providers: this.providers.map((p) => structuredClone(p)),
    };
  }

  saveProvider(input: ProviderInput): ProviderInfo {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(input.id)) {
      fail("invalidProvider", "id must match ^[a-z0-9][a-z0-9-]*$", { field: "id" });
    }
    if (!/^https?:\/\/.+/.test(input.baseUrl)) {
      fail("invalidProvider", "baseUrl must start with http:// or https://", { field: "baseUrl" });
    }
    const validApis: ProviderApi[] = ["openai-completions", "openai-responses", "anthropic-messages"];
    if (!validApis.includes(input.api)) {
      fail("invalidProvider", `api must be one of: ${validApis.join(", ")}`, { field: "api" });
    }
    const existing = this.providers.find((p) => p.id === input.id);
    if (existing !== undefined) {
      const updated: ProviderInfo = {
        ...existing,
        name: input.name,
        baseUrl: input.baseUrl,
        api: input.api,
        models: input.models,
        inlineKey: input.inlineKey,
      };
      this.providers = this.providers.map((p) => (p.id === updated.id ? updated : p));
      return structuredClone(updated);
    }
    const created: ProviderInfo = {
      id: input.id,
      name: input.name,
      baseUrl: input.baseUrl,
      api: input.api,
      models: input.models,
      enabled: true,
      hasKey: false,
      keySource: "none",
      inlineKey: input.inlineKey,
      knownToOmo: false,
    };
    this.providers = [...this.providers, created];
    return structuredClone(created);
  }

  deleteProvider(id: string): void {
    this.findProvider(id);
    this.providers = this.providers.filter((p) => p.id !== id);
  }

  setProviderEnabled(id: string, enabled: boolean): ProviderInfo {
    const provider = this.findProvider(id);
    provider.enabled = enabled;
    return structuredClone(provider);
  }

  setProviderKey(id: string, key: string): ProviderInfo {
    const provider = this.findProvider(id);
    if (key.trim() === "") fail("invalidProvider", "key cannot be empty", { field: "key" });
    provider.hasKey = true;
    provider.keySource = "auth";
    return structuredClone(provider);
  }

  clearProviderKey(id: string): ProviderInfo {
    const provider = this.findProvider(id);
    provider.hasKey = false;
    provider.keySource = "none";
    return structuredClone(provider);
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
    return { imported: ["openai", "anthropic"], skipped: ["custom"], keysFound: 1 };
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
  };
  window.__omoswitchMock = controls;
  return controls;
}
