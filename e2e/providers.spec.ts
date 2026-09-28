import { expect, test, type Page } from "@playwright/test";
import {
  acceptConfirm,
  dismissConfirm,
  editProvider,
  openApp,
  openProfilesView,
  openProvidersView,
  providerDialog,
  providerRow,
  setProviderFetch,
  setProviderProbe,
} from "./helpers";

const SEEDED = ["deepseek", "openrouter", "ollama"] as const;

async function addFallback(page: Page, model: string): Promise<void> {
  const input = page.getByLabel("フォールバックモデル").first();
  await input.fill(model);
  await input.press("Enter");
}

test("provider list renders the three seeded providers", async ({ page }) => {
  await openApp(page);
  await openProvidersView(page);

  const panel = page.getByRole("tabpanel", { name: /^プロバイダ/ });
  await expect(panel.getByRole("listitem")).toHaveCount(SEEDED.length);
  await expect(panel.getByText("プロバイダ 3 件")).toBeVisible();

  for (const id of SEEDED) {
    await expect(providerRow(page, id)).toBeVisible();
  }
  await expect(providerRow(page, "deepseek")).toContainText("DeepSeek");
  await expect(providerRow(page, "deepseek")).toContainText("https://api.deepseek.com/v1");
  await expect(providerRow(page, "deepseek").getByText("OmO 認識済み")).toBeVisible();
  await expect(providerRow(page, "deepseek").getByText("設定済み (auth.json)")).toBeVisible();
  await expect(providerRow(page, "openrouter").getByText("OmO 未認識")).toBeVisible();
  await expect(providerRow(page, "openrouter").getByText("未設定")).toBeVisible();
});

test("adding a provider from a preset prefills fields and persists it", async ({ page }) => {
  await openApp(page);
  await openProvidersView(page);

  await page.getByRole("button", { name: "プロバイダを追加" }).click();
  const dialog = providerDialog(page, "add");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "保存", exact: true })).toBeDisabled();

  await dialog.getByLabel("プリセット").selectOption("groq");
  await expect(dialog.getByLabel("ID", { exact: true })).toHaveValue("groq");
  await expect(dialog.getByLabel("名前", { exact: true })).toHaveValue("Groq");
  await expect(dialog.getByLabel("ベースURL")).toHaveValue("https://api.groq.com/openai/v1");
  await expect(dialog.getByTestId("model-id-input")).toHaveCount(2);
  await expect(dialog.getByTestId("model-id-input").first()).toHaveValue("llama-3.3-70b-versatile");

  await dialog.getByRole("button", { name: "保存", exact: true }).click();

  // A newly created provider stays open in edit mode so the key can be set next.
  const editDialog = providerDialog(page, "edit");
  await expect(editDialog).toBeVisible();
  await expect(editDialog.getByLabel("ID", { exact: true })).toBeDisabled();
  await editDialog.getByRole("button", { name: "キャンセル" }).click();
  await expect(editDialog).toBeHidden();

  const row = providerRow(page, "groq");
  await expect(row).toBeVisible();
  await expect(row).toContainText("Groq");
  await expect(row.getByRole("switch", { name: "無効化" })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByRole("tab", { name: /^プロバイダ/ })).toContainText("4");
});

test("enable/disable toggle flips the provider switch", async ({ page }) => {
  await openApp(page);
  await openProvidersView(page);

  const row = providerRow(page, "openrouter");
  const toggle = row.getByRole("switch");
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await expect(toggle).toHaveAccessibleName("有効化");

  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await expect(toggle).toHaveAccessibleName("無効化");

  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await expect(toggle).toHaveAccessibleName("有効化");
});

test("delete asks for confirmation and only removes on accept", async ({ page }) => {
  await openApp(page);
  await openProvidersView(page);

  const row = providerRow(page, "ollama");
  const messages: string[] = [];
  page.on("dialog", (dialog) => messages.push(dialog.message()));

  dismissConfirm(page);
  await row.getByRole("button", { name: "削除", exact: true }).click();
  await expect(row).toBeVisible();

  acceptConfirm(page);
  await row.getByRole("button", { name: "削除", exact: true }).click();
  await expect(row).toBeHidden();
  await expect(page.getByRole("tabpanel", { name: /^プロバイダ/ }).getByRole("listitem")).toHaveCount(2);

  expect(messages).toEqual([
    "プロバイダ「ollama」を削除しますか？",
    "プロバイダ「ollama」を削除しますか？",
  ]);
});

test("connection test shows a latency tier badge", async ({ page }) => {
  await openApp(page);
  await openProvidersView(page);

  await providerRow(page, "deepseek").getByRole("button", { name: "接続テスト" }).click();
  await expect(page.getByTestId("provider-probe-deepseek")).toHaveText("高速 (120 ms)");

  await setProviderProbe(page, "ollama", {
    reachable: true,
    status: 200,
    latencyMs: 2400,
    tier: "slow",
    errorKind: null,
  });
  await providerRow(page, "ollama").getByRole("button", { name: "接続テスト" }).click();
  await expect(page.getByTestId("provider-probe-ollama")).toHaveText("低速 (2400 ms)");

  await setProviderProbe(page, "openrouter", {
    reachable: false,
    status: null,
    latencyMs: 0,
    tier: "slow",
    errorKind: "timeout",
  });
  await providerRow(page, "openrouter").getByRole("button", { name: "接続テスト" }).click();
  await expect(page.getByTestId("provider-probe-openrouter")).toHaveText("接続不可（timeout）");
});

test("fetch models lists new ids as checkboxes and merges the selection", async ({ page }) => {
  await openApp(page);
  await openProvidersView(page);
  await setProviderFetch(page, "deepseek", {
    source: "v1/models",
    ids: ["deepseek-chat", "deepseek-reasoner", "deepseek-v4"],
  });

  const dialog = await editProvider(page, "deepseek");
  const modelIds = dialog.getByTestId("model-id-input");
  await expect(modelIds).toHaveCount(2);

  await dialog.getByRole("button", { name: "モデル一覧を取得" }).click();
  await expect(dialog.getByRole("heading", { name: "追加するモデルを選択" })).toBeVisible();

  // Already-configured ids are filtered out of the fetched list.
  await expect(dialog.getByRole("checkbox", { name: "deepseek-chat" })).toHaveCount(0);
  const reasoner = dialog.getByRole("checkbox", { name: "deepseek-reasoner" });
  const v4 = dialog.getByRole("checkbox", { name: "deepseek-v4" });
  await expect(reasoner).not.toBeChecked();
  await expect(v4).not.toBeChecked();

  const addSelected = dialog.getByRole("button", { name: "選択したモデルを追加" });
  await expect(addSelected).toBeDisabled();
  await reasoner.check();
  await addSelected.click();

  await expect(modelIds).toHaveCount(3);
  await expect(modelIds.nth(2)).toHaveValue("deepseek-reasoner");
  await expect(reasoner).toHaveCount(0);
  await expect(v4).toBeVisible();

  await dialog.getByRole("button", { name: "保存", exact: true }).click();
  await expect(dialog).toBeHidden();

  const reopened = await editProvider(page, "deepseek");
  await expect(reopened.getByTestId("model-id-input")).toHaveCount(3);
  await expect(reopened.getByTestId("model-id-input").nth(2)).toHaveValue("deepseek-reasoner");
});

test("dead-reference warning appears for an unconfigured provider and clears once configured", async ({
  page,
}) => {
  await openApp(page);
  await addFallback(page, "acme-llm/sol-1");

  const warning = page.getByTestId("dead-reference-acme-llm");
  await expect(warning).toBeVisible();
  await expect(warning).toContainText(
    "プロバイダ「acme-llm」が設定されていません。この割り当ては反映されません。",
  );

  await warning.getByRole("button", { name: "このプロバイダを設定" }).click();
  const dialog = providerDialog(page, "edit");
  await expect(dialog).toBeVisible();
  await expect(page.getByRole("tab", { name: /^プロバイダ/ })).toHaveAttribute("aria-selected", "true");
  await expect(dialog.getByLabel("ID", { exact: true })).toHaveValue("acme-llm");

  await dialog.getByLabel("ベースURL").fill("https://llm.acme.test/v1");
  await dialog.getByLabel("ベースURL").blur();
  await dialog.getByRole("button", { name: "保存", exact: true }).click();
  await expect(dialog.getByRole("alert")).toHaveCount(0);
  await dialog.getByRole("button", { name: "キャンセル" }).click();
  await expect(dialog).toBeHidden();
  await expect(providerRow(page, "acme-llm")).toBeVisible();

  await openProfilesView(page);
  await expect(page.getByText("acme-llm/sol-1")).toBeVisible();
  await expect(warning).toHaveCount(0);
});

test("dead-reference configure flow prefills a known preset", async ({ page }) => {
  await openApp(page);
  await addFallback(page, "moonshot/moonshot-v1-8k");

  const warning = page.getByTestId("dead-reference-moonshot");
  await expect(warning).toBeVisible();
  await warning.getByRole("button", { name: "このプロバイダを設定" }).click();

  const dialog = providerDialog(page, "add");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("ID", { exact: true })).toHaveValue("moonshot");
  await expect(dialog.getByLabel("ベースURL")).toHaveValue("https://api.moonshot.cn/v1");
  await dialog.getByRole("button", { name: "保存", exact: true }).click();
  await expect(providerDialog(page, "edit")).toBeVisible();
  await providerDialog(page, "edit").getByRole("button", { name: "キャンセル" }).click();

  await openProfilesView(page);
  await expect(warning).toHaveCount(0);
});

test("seeded wawazz-gpt fallback shows a dead-reference warning", async ({ page }) => {
  test.fail(
    true,
    "APP BUG (mock data): src/lib/mockData.ts:4 lists 'wawazz-gpt' in the omo PROVIDERS used by " +
      "seedModels(), so findDeadProviders() treats the seeded wawazz-gpt/gpt-6-astra fallback " +
      "(mockData.ts:45) as known and never renders dead-reference-wawazz-gpt.",
  );
  await openApp(page);
  await expect(page.getByTestId("dead-reference-wawazz-gpt").first()).toBeVisible({ timeout: 5_000 });
});
