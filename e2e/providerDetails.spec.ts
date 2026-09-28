import { expect, test, type Locator, type Page } from "@playwright/test";
import { editProvider, openApp, openProvidersView, providerDialog, providerRow } from "./helpers";

const MODEL_HEADER_SECRET = "MOCK-MODEL-HEADER-SECRET";

function modelCard(dialog: Locator, modelId: string): Locator {
  return dialog.getByTestId("model-row").filter({ has: dialog.page().getByLabel(`モデルID（${modelId}）`) });
}

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

async function openJsonTab(page: Page, dialog: Locator): Promise<Locator> {
  await dialog.getByRole("tab", { name: "JSON" }).click();
  await expect(dialog.getByRole("tab", { name: "JSON" })).toHaveAttribute("aria-selected", "true");
  const textarea = dialog.getByLabel("プロバイダ JSON");
  await expect(textarea).not.toHaveValue("");
  expect(await page.content()).not.toContain(MODEL_HEADER_SECRET);
  return textarea;
}

test("editing context window, efforts and image input persists after reopening", async ({ page }) => {
  await openApp(page);
  await openProvidersView(page);
  const dialog = await editProvider(page, "ollama");
  const card = modelCard(dialog, "llama3.3");

  const context = card.getByLabel("コンテキストウィンドウ（llama3.3）");
  await expect(context).toHaveValue("131072");
  await context.fill("1000000");
  await context.blur();
  await card.getByLabel("最大出力トークン（llama3.3）").fill("32000");
  await card.getByLabel("最大出力トークン（llama3.3）").blur();

  await card.getByRole("switch", { name: "推論（llama3.3）" }).click();
  const efforts = card.getByRole("group", { name: "推論強度（llama3.3）" });
  await efforts.getByRole("checkbox", { name: "最小", exact: true }).uncheck();
  await efforts.getByRole("checkbox", { name: "最大", exact: true }).check();

  const inputs = card.getByRole("group", { name: "入力モダリティ（llama3.3）" });
  await inputs.getByRole("checkbox", { name: "テキスト" }).check();
  await inputs.getByRole("checkbox", { name: "画像" }).check();

  await dialog.getByRole("button", { name: "保存", exact: true }).click();
  await expect(dialog).toBeHidden();

  const reopened = await editProvider(page, "ollama");
  const again = modelCard(reopened, "llama3.3");
  await expect(again.getByLabel("コンテキストウィンドウ（llama3.3）")).toHaveValue("1000000");
  await expect(again.getByLabel("最大出力トークン（llama3.3）")).toHaveValue("32000");
  const againEfforts = again.getByRole("group", { name: "推論強度（llama3.3）" });
  await expect(againEfforts.getByRole("checkbox", { name: "最小", exact: true })).not.toBeChecked();
  await expect(againEfforts.getByRole("checkbox", { name: "高", exact: true })).toBeChecked();
  await expect(againEfforts.getByRole("checkbox", { name: "最高", exact: true })).not.toBeChecked();
  await expect(againEfforts.getByRole("checkbox", { name: "最大", exact: true })).toBeChecked();
  await expect(again.getByRole("checkbox", { name: "画像" })).toBeChecked();
  await expect(again.getByRole("switch", { name: "推論（llama3.3）" })).toHaveAttribute("aria-checked", "true");

  const json = await openJsonTab(page, reopened);
  const body = JSON.parse(await json.inputValue()) as { models: Record<string, unknown>[] };
  expect(body.models[0]).toMatchObject({
    id: "llama3.3",
    contextWindow: 1000000,
    maxTokens: 32000,
    reasoning: true,
    input: ["text", "image"],
    thinkingLevelMap: { minimal: null, max: "max" },
  });
  expect(body.models[0]).not.toHaveProperty("thinking");
});

test("an invalid number blocks saving until it is fixed", async ({ page }) => {
  await openApp(page);
  await openProvidersView(page);
  const dialog = await editProvider(page, "ollama");
  const context = modelCard(dialog, "llama3.3").getByLabel("コンテキストウィンドウ（llama3.3）");

  await context.fill("-5");
  await context.blur();
  await expect(dialog.getByText("1 以上の整数を入力してください")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "保存", exact: true })).toBeDisabled();

  await context.fill("");
  await context.blur();
  await expect(dialog.getByRole("button", { name: "保存", exact: true })).toBeEnabled();
});

test("JSON tab shows redacted provider JSON, saves edits, and the form reflects them", async ({ page }) => {
  await openApp(page);
  await openProvidersView(page);
  const dialog = await editProvider(page, "deepseek");

  const json = await openJsonTab(page, dialog);
  await expect(dialog.getByText(/保存するまで models\.json には書き込まれません。/)).toBeVisible();
  const text = await json.inputValue();
  expect(text).toContain('"deepseek-coder"');
  expect(text).toContain('"cost"');
  expect(text).toContain("<redacted>");
  expect(text).not.toContain("apiKey");
  expect(text).not.toContain(MODEL_HEADER_SECRET);

  const body = JSON.parse(text) as { name: string; models: Record<string, unknown>[] };
  body.name = "DeepSeek JSON";
  body.models[0] = { ...body.models[0], contextWindow: 256000 };
  await json.fill(JSON.stringify(body, null, 2));
  await dialog.getByRole("button", { name: "保存", exact: true }).click();
  await expect(dialog.getByTestId("provider-json-status")).toHaveText("JSON を保存しました");
  expect(await page.content()).not.toContain(MODEL_HEADER_SECRET);

  await dialog.getByRole("tab", { name: "フォーム" }).click();
  await expect(dialog.getByLabel("名前", { exact: true })).toHaveValue("DeepSeek JSON");
  await expect(modelCard(dialog, "deepseek-chat").getByLabel("コンテキストウィンドウ（deepseek-chat）")).toHaveValue(
    "256000",
  );
  await expect(providerRow(page, "deepseek")).toContainText("DeepSeek JSON");

  const again = await openJsonTab(page, dialog);
  expect(await again.inputValue()).toContain("<redacted>");
});

test("the JSON tab previews unsaved form edits and does not write them until saved", async ({ page }) => {
  await openApp(page);
  await openProvidersView(page);
  const dialog = await editProvider(page, "ollama");
  const card = modelCard(dialog, "llama3.3");

  await card.getByRole("switch", { name: "推論（llama3.3）" }).click();
  const efforts = card.getByRole("group", { name: "推論強度（llama3.3）" });
  await efforts.getByRole("checkbox", { name: "最小", exact: true }).uncheck();

  const json = await openJsonTab(page, dialog);
  const preview = JSON.parse(await json.inputValue()) as { models: Record<string, unknown>[] };
  expect(preview.models[0]).toMatchObject({ reasoning: true, thinkingLevelMap: { minimal: null } });

  await dialog.getByRole("button", { name: "キャンセル" }).click();
  const reopened = await editProvider(page, "ollama");
  const saved = JSON.parse(await (await openJsonTab(page, reopened)).inputValue()) as {
    models: Record<string, unknown>[];
  };
  expect(saved.models[0]).not.toHaveProperty("thinkingLevelMap");
});

test("invalid JSON and apiKey are rejected, and unsaved JSON asks before switching tabs", async ({ page }) => {
  await openApp(page);
  await openProvidersView(page);
  const dialog = await editProvider(page, "ollama");
  const json = await openJsonTab(page, dialog);
  const original = await json.inputValue();

  await json.fill('{ "baseUrl": ');
  await dialog.getByRole("button", { name: "保存", exact: true }).click();
  await expect(dialog.getByRole("alert").filter({ hasText: "JSON として解析できません" })).toBeVisible();

  const withKey = { ...(JSON.parse(original) as Record<string, unknown>), apiKey: "TEST-NOT-A-REAL-KEY" };
  await json.fill(JSON.stringify(withKey));
  await dialog.getByRole("button", { name: "保存", exact: true }).click();
  await expect(dialog.getByRole("alert").filter({ hasText: "プロバイダの内容が不正です（apiKey）" })).toBeVisible();

  await dialog.getByRole("tab", { name: "フォーム" }).click();
  const confirm = page.getByRole("dialog", { name: "JSON の変更を破棄しますか？" });
  await expect(confirm).toBeVisible();
  await confirm.getByRole("button", { name: "キャンセル" }).click();
  await expect(confirm).toBeHidden();
  await expect(dialog.getByRole("tab", { name: "JSON" })).toHaveAttribute("aria-selected", "true");

  await dialog.getByRole("tab", { name: "フォーム" }).click();
  await confirm.getByRole("button", { name: "破棄する" }).click();
  await expect(confirm).toBeHidden();
  await expect(dialog.getByRole("tab", { name: "フォーム" })).toHaveAttribute("aria-selected", "true");
  await expect(dialog).toBeVisible();
  expect(await page.content()).not.toContain("TEST-NOT-A-REAL-KEY");
});

test("the JSON tab is unavailable for a provider that has not been saved", async ({ page }) => {
  await openApp(page);
  await openProvidersView(page);
  await page.getByRole("button", { name: "プロバイダを追加" }).click();
  const dialog = providerDialog(page, "add");
  const jsonTab = dialog.getByRole("tab", { name: "JSON" });
  await expect(jsonTab).toHaveAttribute("aria-disabled", "true");
  await expect(jsonTab).toHaveAttribute("title", "JSON 編集は保存済みのプロバイダでのみ使えます");
  await jsonTab.click({ force: true });
  await expect(dialog.getByRole("tab", { name: "フォーム" })).toHaveAttribute("aria-selected", "true");
});

test("adding and removing a custom model field round-trips through save", async ({ page }) => {
  await openApp(page);
  await openProvidersView(page);
  const dialog = await editProvider(page, "ollama");
  const card = modelCard(dialog, "llama3.3");

  await card.getByLabel("キー（llama3.3）").fill("thinkingLevelMap");
  await card.getByLabel("キー（llama3.3）").blur();
  await card.getByRole("button", { name: "項目を追加" }).click();
  await expect(card.getByText("「thinkingLevelMap」は上のフォームで編集してください")).toBeVisible();

  await card.getByLabel("キー（llama3.3）").fill("cost");
  await card.getByLabel("キー（llama3.3）").blur();
  await card.getByLabel("値（llama3.3）").fill('{"input": 0.5, "output": 1.5}');
  await card.getByLabel("値（llama3.3）").blur();
  await card.getByRole("button", { name: "項目を追加" }).click();
  await expect(card.getByTestId("model-extra-cost")).toBeVisible();
  await expect(card.getByLabel("cost（llama3.3）")).toHaveValue('{"input":0.5,"output":1.5}');

  await dialog.getByRole("button", { name: "保存", exact: true }).click();
  await expect(dialog).toBeHidden();

  const reopened = await editProvider(page, "ollama");
  const again = modelCard(reopened, "llama3.3");
  await expect(again.getByLabel("cost（llama3.3）")).toHaveValue('{"input":0.5,"output":1.5}');
  const json = await openJsonTab(page, reopened);
  expect(JSON.parse(await json.inputValue())).toMatchObject({
    models: [{ id: "llama3.3", cost: { input: 0.5, output: 1.5 } }],
  });

  await reopened.getByRole("tab", { name: "フォーム" }).click();
  await again.getByRole("button", { name: "項目「cost」を削除（llama3.3）" }).click();
  await expect(again.getByTestId("model-extra-cost")).toHaveCount(0);
  await reopened.getByRole("button", { name: "保存", exact: true }).click();
  await expect(reopened).toBeHidden();
  const last = await editProvider(page, "ollama");
  await expect(modelCard(last, "llama3.3").getByTestId("model-extra-cost")).toHaveCount(0);
});

test("Japanese IME entry into the display-name field keeps focus", async ({ page }) => {
  await openApp(page);
  await openProvidersView(page);
  const dialog = await editProvider(page, "ollama");
  const card = modelCard(dialog, "llama3.3");

  const cell = card.getByLabel("表示名（llama3.3）");
  await expect(cell).toHaveValue("Llama 3.3");
  await cell.click();
  await cell.press("Control+a");
  await cell.press("Delete");

  await dispatchComposition(cell, "compositionstart", "");
  await page.keyboard.insertText("ラマ");
  expect(await isFocused(cell)).toBe(true);
  await page.keyboard.press("Enter");
  expect(await isFocused(cell)).toBe(true);
  await dispatchComposition(cell, "compositionend", "ラマ");
  expect(await isFocused(cell)).toBe(true);
  await expect(cell).toHaveValue("ラマ");

  await page.keyboard.press("Tab");
  await expect(card.getByTestId("model-remove")).toBeFocused();
  await expect(card.getByLabel("表示名（llama3.3）")).toHaveValue("ラマ");

  await dialog.getByRole("button", { name: "保存", exact: true }).click();
  await expect(dialog).toBeHidden();
  const reopened = await editProvider(page, "ollama");
  await expect(modelCard(reopened, "llama3.3").getByLabel("表示名（llama3.3）")).toHaveValue("ラマ");
});
