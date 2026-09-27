import { clearMocks } from "@tauri-apps/api/mocks";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { api } from "./api";
import { isNativeAgent } from "./catalog";
import { installMockIpc } from "./mockIpc";
import type { AppError } from "./types";

describe("mock IPC backend", () => {
  beforeEach(() => {
    installMockIpc();
  });

  afterEach(() => {
    clearMocks();
    delete window.__omoswitchMock;
  });

  it("seeds two profiles and 30 models", async () => {
    expect(await api.listProfiles()).toHaveLength(2);
    expect(await api.listModels(false)).toHaveLength(30);
  });

  it("starts with no active profile and no backups", async () => {
    const status = await api.getStatus();
    expect(status.activeProfileId).toBeNull();
    expect(status.drift).toBe("noActive");
    expect(await api.listBackups()).toHaveLength(0);
  });

  it("applies a profile, becomes active and in sync, and grows the backup list", async () => {
    const [first] = await api.listProfiles();
    const result = await api.applyProfile(first!.id);
    expect(result.changed).toBe(true);
    expect(result.backupPath).not.toBeNull();

    const status = await api.getStatus();
    expect(status.activeProfileId).toBe(first!.id);
    expect(status.drift).toBe("inSync");
    expect(await api.listBackups()).toHaveLength(1);
  });

  it("previews before and after native text", async () => {
    const profiles = await api.listProfiles();
    await api.applyProfile(profiles[0]!.id);
    const preview = await api.previewSwitch(profiles[1]!.id);
    expect(preview.changed).toBe(true);
    expect(preview.beforeNative).not.toBe(preview.afterNative);
    expect(preview.afterNative).toContain("categories");
  });

  it("rejects apply with a stale expectedHash as changedOnDisk", async () => {
    const [first] = await api.listProfiles();
    await expect(api.applyProfile(first!.id, "stale-hash")).rejects.toMatchObject({
      kind: "changedOnDisk",
    });
  });

  it("reports drift through the mock control and clears it on re-apply", async () => {
    const [first] = await api.listProfiles();
    await api.applyProfile(first!.id);
    window.__omoswitchMock!.setDrift(true);
    expect((await api.getStatus()).drift).toBe("drifted");
    await api.applyProfile(first!.id);
    expect((await api.getStatus()).drift).toBe("inSync");
  });

  it("surfaces omoNotFound when omo is missing and a refresh is requested", async () => {
    window.__omoswitchMock!.setOmoMissing(true);
    expect((await api.getStatus()).omoAvailable).toBe(false);
    const error: AppError = await api.listModels(true).then(
      () => {
        throw new Error("expected rejection");
      },
      (reason: AppError) => reason,
    );
    expect(error.kind).toBe("omoNotFound");
  });

  it("imports from opencode with renamed pairs", async () => {
    const result = await api.importFromConfig("opencode", "base");
    expect(result.profile.name).toBe("base");
    expect(result.renamed).toEqual([
      ["metis", "plan-consultant"],
      ["momus", "plan-reviewer"],
    ]);
    expect(result.dropped).toContain("sisyphus");
    expect(result.dropped.some((key) => isNativeAgent(key))).toBe(false);
    expect(await api.listProfiles()).toHaveLength(3);
  });

  it("duplicates, deletes, and clears the active id when the active profile is deleted", async () => {
    const [first] = await api.listProfiles();
    const copy = await api.duplicateProfile(first!.id, "Copy");
    expect(copy.agents).toEqual(first!.agents);
    await api.applyProfile(copy.id);
    await api.deleteProfile(copy.id);
    expect((await api.getStatus()).activeProfileId).toBeNull();
  });

  it("rejects an unknown profile id with profileNotFound", async () => {
    await expect(api.previewSwitch("nope")).rejects.toMatchObject({ kind: "profileNotFound" });
  });

  it("saves an edited profile and captures the active config", async () => {
    const [first] = await api.listProfiles();
    const saved = await api.saveProfile({
      id: first!.id,
      name: "Renamed",
      note: "n",
      agents: first!.agents,
      categories: first!.categories,
    });
    expect(saved.name).toBe("Renamed");
    const captured = await api.captureActiveFromConfig();
    expect((await api.getStatus()).activeProfileId).toBe(captured.id);
  });

  it("restores a backup from the list and rejects an unknown path", async () => {
    const [first] = await api.listProfiles();
    await api.applyProfile(first!.id);
    const [backup] = await api.listBackups();
    const restored = await api.restoreBackup(backup!.path);
    expect(restored.changed).toBe(true);
    await expect(api.restoreBackup("C:\\nope")).rejects.toMatchObject({ kind: "io" });
  });
});
