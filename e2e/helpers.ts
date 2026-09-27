import { expect, type Locator, type Page } from "@playwright/test";

export const CONFIG_PATH = "C:\\Users\\tom\\.omo\\omo.jsonc";

interface MockControls {
  setDrift: (drifted: boolean) => void;
  setOmoMissing: (missing: boolean) => void;
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
