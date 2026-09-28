import { expect, type Locator, type Page } from "@playwright/test";

export const CONFIG_PATH = "C:\\Users\\tom\\.omo\\omo.jsonc";

export interface MockProbe {
  reachable: boolean;
  status: number | null;
  latencyMs: number;
  tier: "fast" | "ok" | "slow";
  errorKind: string | null;
}

export interface MockFetchedModels {
  source: string;
  ids: string[];
}

interface MockControls {
  setDrift: (drifted: boolean) => void;
  setOmoMissing: (missing: boolean) => void;
  setProviderProbe: (id: string, result: MockProbe | "fail") => void;
  setProviderFetch: (id: string, result: MockFetchedModels | "fail") => void;
  setKeyPresent: (id: string, present: boolean) => void;
}

type MockWindow = { __omoswitchMock?: MockControls };

export async function openApp(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "OmOswitch" })).toBeVisible();
  await page.waitForFunction(
    () => (globalThis as MockWindow).__omoswitchMock !== undefined,
  );
  await expect(page.getByText(CONFIG_PATH)).toBeVisible();
}

export function profileCard(page: Page, name: string): Locator {
  return page.getByRole("listitem").filter({ hasText: name }).first();
}

export async function applyProfile(page: Page, name: string): Promise<void> {
  await profileCard(page, name).getByRole("button", { name: "適用", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "切り替えプレビュー" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "このプロファイルを適用" }).click();
  await expect(dialog).toBeHidden();
}

export async function setDrift(page: Page, drifted: boolean): Promise<void> {
  await page.evaluate((value) => {
    (globalThis as MockWindow).__omoswitchMock?.setDrift(value);
  }, drifted);
}

export async function setOmoMissing(page: Page, missing: boolean): Promise<void> {
  await page.evaluate((value) => {
    (globalThis as MockWindow).__omoswitchMock?.setOmoMissing(value);
  }, missing);
}

export function acceptConfirm(page: Page): void {
  page.once("dialog", (dialog) => void dialog.accept());
}

export function dismissConfirm(page: Page): void {
  page.once("dialog", (dialog) => void dialog.dismiss());
}

export async function openProvidersView(page: Page): Promise<void> {
  await page.getByRole("tab", { name: /^プロバイダ/ }).click();
  await expect(page.getByRole("tabpanel", { name: /^プロバイダ/ })).toBeVisible();
}

export async function openProfilesView(page: Page): Promise<void> {
  await page.getByRole("tab", { name: "プロファイル" }).click();
  await expect(page.getByRole("tabpanel", { name: "プロファイル" })).toBeVisible();
}

export function providerRow(page: Page, id: string): Locator {
  return page.getByTestId(`provider-row-${id}`);
}

export function providerDialog(page: Page, mode: "add" | "edit"): Locator {
  return page.getByRole("dialog", {
    name: mode === "add" ? "プロバイダを追加" : "プロバイダを編集",
  });
}

export async function editProvider(page: Page, id: string): Promise<Locator> {
  await providerRow(page, id).getByRole("button", { name: "編集", exact: true }).click();
  const dialog = providerDialog(page, "edit");
  await expect(dialog).toBeVisible();
  return dialog;
}

export async function setProviderProbe(
  page: Page,
  id: string,
  result: MockProbe | "fail",
): Promise<void> {
  await page.evaluate(
    ([providerId, value]) => {
      (globalThis as MockWindow).__omoswitchMock?.setProviderProbe(providerId, value);
    },
    [id, result] as const,
  );
}

export async function setProviderFetch(
  page: Page,
  id: string,
  result: MockFetchedModels | "fail",
): Promise<void> {
  await page.evaluate(
    ([providerId, value]) => {
      (globalThis as MockWindow).__omoswitchMock?.setProviderFetch(providerId, value);
    },
    [id, result] as const,
  );
}

export async function setKeyPresent(page: Page, id: string, present: boolean): Promise<void> {
  await page.evaluate(
    ([providerId, value]) => {
      (globalThis as MockWindow).__omoswitchMock?.setKeyPresent(providerId, value);
    },
    [id, present] as const,
  );
}
