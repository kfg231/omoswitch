import { invoke } from "@tauri-apps/api/core";
import type {
  ApplyResult,
  BackupInfo,
  ImportResult,
  ModelInfo,
  Profile,
  ProfileInput,
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
  listBackups: () => invoke<BackupInfo[]>("list_backups"),
  restoreBackup: (path: string) => invoke<ApplyResult>("restore_backup", { path }),
} as const;

export type Api = typeof api;
