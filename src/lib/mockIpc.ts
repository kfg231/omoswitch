import { mockIPC } from "@tauri-apps/api/mocks";
import type { InvokeArgs } from "@tauri-apps/api/core";
import { seedModels, seedProfiles } from "./mockData";
import type {
  AppError,
  AppErrorKind,
  ApplyResult,
  BackupInfo,
  ImportResult,
  Profile,
  ProfileInput,
  Status,
  SwitchPreview,
} from "./types";

export interface OmoswitchMockControls {
  setDrift: (drifted: boolean) => void;
  setOmoMissing: (missing: boolean) => void;
}

declare global {
  interface Window {
    __omoswitchMock?: OmoswitchMockControls;
  }
}

const CONFIG_PATH = "C:\\Users\\tom\\.omo\\omo.jsonc";

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
  private backups: BackupInfo[] = [];
  private activeProfileId: string | null = null;
  private drifted = false;
  private omoMissing = false;
  private nextId = 3;

  setDrift(drifted: boolean): void {
    this.drifted = drifted;
  }

  setOmoMissing(missing: boolean): void {
    this.omoMissing = missing;
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
      default:
        return fail("io", `unknown command ${cmd}`);
    }
  });

  const controls: OmoswitchMockControls = {
    setDrift: (drifted) => backend.setDrift(drifted),
    setOmoMissing: (missing) => backend.setOmoMissing(missing),
  };
  window.__omoswitchMock = controls;
  return controls;
}
