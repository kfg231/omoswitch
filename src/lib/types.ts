export type Reasoning = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | "auto";
export type Assignment = Record<string, unknown>;
export interface Profile { id: string; name: string; note: string; agents: Record<string, Assignment>; categories: Record<string, Assignment>; createdAt: string; updatedAt: string; }
export interface ProfileInput { id?: string; name: string; note?: string; agents: Record<string, Assignment>; categories: Record<string, Assignment>; }
export type Drift = "inSync" | "drifted" | "noActive" | "configMissing" | "configInvalid";
export interface Status { configPath: string; configExists: boolean; activeProfileId: string | null; drift: Drift; nativeBlockPresent: boolean; legacySenpiPresent: boolean; omoAvailable: boolean; configHash: string | null; }
export interface SwitchPreview { profileId: string; baseHash: string; beforeNative: string; afterNative: string; changed: boolean; }
export interface ApplyResult { changed: boolean; backupPath: string | null; configPath: string; }
export interface ImportResult { profile: Profile; renamed: [string, string][]; dropped: string[]; }
export interface ModelInfo { id: string; provider: string; model: string; context: string | null; maxOut: string | null; thinking: boolean; images: boolean; }
export interface BackupInfo { path: string; createdAt: string; sizeBytes: number; }
export type AppErrorKind = "configMissing" | "malformedJsonc" | "duplicateKey" | "changedOnDisk" | "verifyFailed" | "omoNotFound" | "omoListParse" | "io" | "storeCorrupt" | "profileNotFound" | "invalidProfile" | "notAnObject";
export interface AppError { kind: AppErrorKind; message: string; line?: number; col?: number; key?: string; field?: string; }
