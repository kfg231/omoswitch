import { invoke } from "@tauri-apps/api/core";
import type {
  ApplyResult,
  BackupInfo,
  FetchedModels,
  ImportResult,
  ModelInfo,
  NativeCatalog,
  ProbeResult,
  Profile,
  ProfileInput,
  ProviderImportResult,
  ProviderInfo,
  ProviderInput,
  ProvidersResult,
  Status,
  SwitchPreview,
} from "./types";

export type ImportSource = "opencode" | "native";

export const APPLIED_EVENT = "omoswitch://applied";
export const ERROR_EVENT = "omoswitch://error";

export const api = {
  getStatus: () => invoke<Status>("get_status"),
  listProfiles: () => invoke<Profile[]>("list_profiles"),
  saveProfile: (input: ProfileInput) => invoke<Profile>("save_profile", { input }),
  deleteProfile: (id: string) => invoke<null>("delete_profile", { id }),
  duplicateProfile: (id: string, name: string) => invoke<Profile>("duplicate_profile", { id, name }),
  importFromConfig: (source: ImportSource, name: string) =>
    invoke<ImportResult>("import_from_config", { source, name }),
  captureActiveFromConfig: () => invoke<Profile>("capture_active_from_config"),
  previewSwitch: (id: string) => invoke<SwitchPreview>("preview_switch", { id }),
  applyProfile: (id: string, expectedHash?: string) =>
    invoke<ApplyResult>("apply_profile", expectedHash === undefined ? { id } : { id, expectedHash }),
  listModels: (refresh: boolean) => invoke<ModelInfo[]>("list_models", { refresh }),
  getNativeCatalog: (refresh: boolean) => invoke<NativeCatalog>("get_native_catalog", { refresh }),
  listBackups: () => invoke<BackupInfo[]>("list_backups"),
  restoreBackup: (path: string) => invoke<ApplyResult>("restore_backup", { path }),
  listProviders: () => invoke<ProvidersResult>("list_providers"),
  saveProvider: (input: ProviderInput) => invoke<ProviderInfo>("save_provider", { input }),
  deleteProvider: (id: string) => invoke<void>("delete_provider", { id }),
  setProviderEnabled: (id: string, enabled: boolean) => invoke<ProviderInfo>("set_provider_enabled", { id, enabled }),
  setProviderKey: (id: string, key: string) => invoke<ProviderInfo>("set_provider_key", { id, key }),
  clearProviderKey: (id: string) => invoke<ProviderInfo>("clear_provider_key", { id }),
  testProvider: (id: string) => invoke<ProbeResult>("test_provider", { id }),
  fetchProviderModels: (id: string) => invoke<FetchedModels>("fetch_provider_models", { id }),
  importProvidersFromOpencode: () => invoke<ProviderImportResult>("import_providers_from_opencode"),
} as const;

export type Api = typeof api;
