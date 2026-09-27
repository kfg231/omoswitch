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

  it("lists providers with 3 seeds and includes agentDir in status", async () => {
    const result = await api.listProviders();
    expect(result.providers).toHaveLength(3);
    expect(result.agentDir).toContain(".omo");
    expect(result.modelsJsonPath).toContain("models.json");
    const status = await api.getStatus();
    expect(status.providerCount).toBe(3);
    expect(status.modelsJsonPresent).toBe(true);
  });

  it("saves a new provider and updates an existing one", async () => {
    const created = await api.saveProvider({
      id: "test-provider",
      name: "Test",
      baseUrl: "https://example.com/v1",
      api: "openai-completions",
      models: [{ id: "test-model" }],
      inlineKey: false,
    });
    expect(created.id).toBe("test-provider");
    expect(created.enabled).toBe(true);
    expect((await api.listProviders()).providers).toHaveLength(4);
    const updated = await api.saveProvider({
      ...created,
      name: "Updated",
      models: [{ id: "new-model" }],
    });
    expect(updated.name).toBe("Updated");
    expect((await api.listProviders()).providers).toHaveLength(4);
  });

  it("rejects invalid provider inputs", async () => {
    await expect(
      api.saveProvider({
        id: "Bad_ID",
        name: "Bad",
        baseUrl: "https://example.com",
        api: "openai-completions",
        models: [],
        inlineKey: false,
      }),
    ).rejects.toMatchObject({ kind: "invalidProvider", field: "id" });
    await expect(
      api.saveProvider({
        id: "good-id",
        name: "Bad URL",
        baseUrl: "not-a-url",
        api: "openai-completions",
        models: [],
        inlineKey: false,
      }),
    ).rejects.toMatchObject({ kind: "invalidProvider", field: "baseUrl" });
    await expect(
      api.saveProvider({
        id: "good-id",
        name: "Bad API",
        baseUrl: "https://example.com",
        api: "invalid-api" as never,
        models: [],
        inlineKey: false,
      }),
    ).rejects.toMatchObject({ kind: "invalidProvider", field: "api" });
  });

  it("deletes a provider and rejects unknown id", async () => {
    const before = (await api.listProviders()).providers.length;
    const [first] = (await api.listProviders()).providers;
    await api.deleteProvider(first!.id);
    expect((await api.listProviders()).providers).toHaveLength(before - 1);
    await expect(api.deleteProvider("nope")).rejects.toMatchObject({ kind: "providerNotFound" });
  });

  it("toggles provider enabled state", async () => {
    const [first] = (await api.listProviders()).providers;
    const wasEnabled = first!.enabled;
    const toggled = await api.setProviderEnabled(first!.id, !wasEnabled);
    expect(toggled.enabled).toBe(!wasEnabled);
    const restored = await api.setProviderEnabled(first!.id, wasEnabled);
    expect(restored.enabled).toBe(wasEnabled);
  });

  it("sets and clears provider key", async () => {
    const [first] = (await api.listProviders()).providers;
    const withKey = await api.setProviderKey(first!.id, "TEST-NOT-A-REAL-KEY");
    expect(withKey.hasKey).toBe(true);
    expect(withKey.keySource).toBe("auth");
    const cleared = await api.clearProviderKey(first!.id);
    expect(cleared.hasKey).toBe(false);
    expect(cleared.keySource).toBe("none");
  });

  it("tests a provider with default probe result", async () => {
    const [first] = (await api.listProviders()).providers;
    const probe = await api.testProvider(first!.id);
    expect(probe.reachable).toBe(true);
    expect(probe.status).toBe(200);
    expect(probe.tier).toBe("fast");
    expect(probe.errorKind).toBeNull();
  });

  it("respects provider probe override", async () => {
    const [first] = (await api.listProviders()).providers;
    window.__omoswitchMock!.setProviderProbe(first!.id, {
      reachable: false,
      status: null,
      latencyMs: 5000,
      tier: "slow",
      errorKind: "timeout",
    });
    const probe = await api.testProvider(first!.id);
    expect(probe.reachable).toBe(false);
    expect(probe.errorKind).toBe("timeout");
    window.__omoswitchMock!.setProviderProbe(first!.id, "fail");
    await expect(api.testProvider(first!.id)).rejects.toMatchObject({ kind: "networkUnreachable" });
  });

  it("fetches provider models with default result", async () => {
    const [first] = (await api.listProviders()).providers;
    const fetched = await api.fetchProviderModels(first!.id);
    expect(fetched.source).toBe("v1/models");
    expect(fetched.ids).toContain("model-a");
  });

  it("respects provider fetch override", async () => {
    const [first] = (await api.listProviders()).providers;
    window.__omoswitchMock!.setProviderFetch(first!.id, {
      source: "models",
      ids: ["custom-model"],
    });
    const fetched = await api.fetchProviderModels(first!.id);
    expect(fetched.source).toBe("models");
    expect(fetched.ids).toEqual(["custom-model"]);
    window.__omoswitchMock!.setProviderFetch(first!.id, "fail");
    await expect(api.fetchProviderModels(first!.id)).rejects.toMatchObject({ kind: "modelFetchParse" });
  });

  it("imports providers from opencode", async () => {
    const result = await api.importProvidersFromOpencode();
    expect(result.imported).toContain("openai");
    expect(result.skipped).toContain("custom");
    expect(result.keysFound).toBeGreaterThan(0);
  });
});
