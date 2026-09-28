import { expect, test, type Locator } from "@playwright/test";
import { editProvider, openApp, openProvidersView, providerDialog, providerRow, setKeyPresent } from "./helpers";

const TEST_KEY = "TEST-NOT-A-REAL-KEY";

async function dispatchComposition(input: Locator, type: "compositionstart" | "compositionend", data: string) {
  await input.evaluate(
    (element, [eventType, eventData]) => {
      element.dispatchEvent(new CompositionEvent(eventType, { bubbles: true, data: eventData }));
    },
    [type, data] as const,
  );
}

async function isFocused(input: Locator): Promise<boolean> {
  return input.evaluate((element) => element === document.activeElement);
}

test("setting a key shows the key-set badge and never renders the key", async ({ page }) => {
  await openApp(page);
  await openProvidersView(page);
  await expect(providerRow(page, "openrouter").getByTestId("provider-key-badge-openrouter")).toHaveText("未設定");

  const dialog = await editProvider(page, "openrouter");
  const keyInput = dialog.getByLabel("APIキー");
  await expect(keyInput).toHaveAttribute("type", "password");
  await expect(dialog.getByRole("button", { name: "キーを保存" })).toBeDisabled();
  await expect(dialog.getByRole("button", { name: "キーを消去" })).toBeDisabled();

  await keyInput.fill(TEST_KEY);
  await dialog.getByRole("button", { name: "キーを保存" }).click();

  await expect(keyInput).toHaveValue("");
  await expect(dialog.getByText("設定済み", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "キーを消去" })).toBeEnabled();
  await expect(page.getByTestId("provider-key-badge-openrouter")).toHaveText("設定済み (auth.json)");

  expect(await page.content()).not.toContain(TEST_KEY);

  await dialog.getByRole("button", { name: "キャンセル" }).click();
  await expect(dialog).toBeHidden();
  expect(await page.content()).not.toContain(TEST_KEY);

  const reopened = await editProvider(page, "openrouter");
  await expect(reopened.getByLabel("APIキー")).toHaveValue("");
  expect(await page.content()).not.toContain(TEST_KEY);
});

test("a key typed while adding a new provider is saved with the provider", async ({ page }) => {
  await openApp(page);
  await openProvidersView(page);

  await page.getByRole("button", { name: "プロバイダを追加" }).click();
  const dialog = providerDialog(page, "add");
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("ID", { exact: true }).fill("mykey-provider");
  await dialog.getByLabel("ベースURL").fill("https://api.example.com/v1");

  const keyInput = dialog.getByLabel("APIキー");
  await expect(keyInput).toBeEnabled();
  await expect(keyInput).toHaveAttribute("type", "password");
  await keyInput.fill(TEST_KEY);
  await dialog.getByRole("button", { name: "保存", exact: true }).click();

  const editDialog = providerDialog(page, "edit");
  await expect(editDialog).toBeVisible();
  await expect(editDialog.getByLabel("APIキー")).toHaveValue("");
  await expect(editDialog.getByText("設定済み", { exact: true })).toBeVisible();
  await expect(editDialog.getByRole("button", { name: "キーを消去" })).toBeEnabled();
  await expect(page.getByTestId("provider-key-badge-mykey-provider")).toHaveText("設定済み (auth.json)");
  expect(await page.content()).not.toContain(TEST_KEY);
});

test("adding a new provider without a key leaves it key-not-set", async ({ page }) => {
  await openApp(page);
  await openProvidersView(page);

  await page.getByRole("button", { name: "プロバイダを追加" }).click();
  const dialog = providerDialog(page, "add");
  await dialog.getByLabel("ID", { exact: true }).fill("nokey-provider");
  await dialog.getByLabel("ベースURL").fill("https://api.example.com/v1");
  // ImeSafeInput commits on blur; leave the field so the draft picks up the URL.
  await dialog.getByLabel("ベースURL").blur();
  await dialog.getByRole("button", { name: "保存", exact: true }).click();

  await expect(providerDialog(page, "edit")).toBeVisible();
  await expect(page.getByTestId("provider-key-badge-nokey-provider")).toHaveText("未設定");
});

test("clearing a key returns the provider to key-not-set", async ({ page }) => {
  await openApp(page);
  await openProvidersView(page);
  const badge = page.getByTestId("provider-key-badge-deepseek");
  await expect(badge).toHaveText("設定済み (auth.json)");

  const dialog = await editProvider(page, "deepseek");
  await expect(dialog.getByText("設定済み", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "キーを消去" }).click();

  await expect(dialog.getByText("設定済み", { exact: true })).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "キーを消去" })).toBeDisabled();
  await expect(badge).toHaveText("未設定");
});

test("a key added outside the app is picked up by polling", async ({ page }) => {
  await openApp(page);
  await openProvidersView(page);
  const badge = page.getByTestId("provider-key-badge-ollama");
  await expect(badge).toHaveText("未設定");

  await setKeyPresent(page, "ollama", true);
  await expect(badge).toHaveText("設定済み (auth.json)", { timeout: 10_000 });

  await setKeyPresent(page, "ollama", false);
  await expect(badge).toHaveText("未設定", { timeout: 10_000 });
});

test("Japanese IME entry into a model cell keeps focus and commits on blur", async ({ page }) => {
  await openApp(page);
  await openProvidersView(page);
  const dialog = await editProvider(page, "deepseek");

  const cell = dialog.getByTestId("model-name-input").first();
  await expect(cell).toHaveValue("DeepSeek Chat");
  await cell.click();
  await cell.press("Control+a");
  await cell.press("Delete");
  await expect(cell).toHaveValue("");

  await dispatchComposition(cell, "compositionstart", "");
  await page.keyboard.insertText("モデル");
  expect(await isFocused(cell)).toBe(true);

  // Enter while composing confirms the IME candidate; it must not commit or remount the row.
  await page.keyboard.press("Enter");
  expect(await isFocused(cell)).toBe(true);
  await expect(cell).toHaveValue("モデル");

  await dispatchComposition(cell, "compositionend", "モデル");
  expect(await isFocused(cell)).toBe(true);
  await expect(cell).toHaveValue("モデル");

  await cell.blur();
  await expect(dialog.getByTestId("model-name-input").first()).toHaveValue("モデル");

  await dialog.getByRole("button", { name: "保存", exact: true }).click();
  await expect(dialog).toBeHidden();
  const reopened = await editProvider(page, "deepseek");
  await expect(reopened.getByTestId("model-name-input").first()).toHaveValue("モデル");
});
