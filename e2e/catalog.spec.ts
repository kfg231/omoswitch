import { expect, test, type Page } from "@playwright/test";
import { openApp, setCatalog } from "./helpers";

const BUILTIN_AGENTS = [
  "explore",
  "librarian",
  "plan-consultant",
  "plan-reviewer",
  "omo-native-code-reviewer",
  "omo-native-qa-executor",
  "omo-native-gate-reviewer",
];

// 30 omo models plus the 4 models of the seeded providers.
const TOTAL_MODEL_OPTIONS = 34;

function agentKeys(page: Page) {
  return page.getByTestId("agents-rows").locator(":scope > li input[readonly]");
}

async function startNewProfile(page: Page): Promise<void> {
  await page.getByRole("button", { name: "新規プロファイル" }).click();
  await expect(page.getByPlaceholder("プロファイル名")).toHaveValue("");
}

test("a new profile starts with one row per native agent and category", async ({ page }) => {
  await openApp(page);
  await startNewProfile(page);

  await expect(agentKeys(page)).toHaveCount(BUILTIN_AGENTS.length);
  for (const [index, key] of BUILTIN_AGENTS.entries()) {
    await expect(agentKeys(page).nth(index)).toHaveValue(key);
  }
  await expect(page.getByTestId("categories-rows").locator(":scope > li")).toHaveCount(10);
  await expect(page.getByTestId("catalog-source")).toHaveText("定義: 内蔵");

  await page.getByPlaceholder("プロファイル名").fill("Only explore");
  await page.getByLabel("モデル", { exact: true }).first().fill("openai/gpt-6-sol");
  await page.getByRole("button", { name: "保存" }).click();

  await expect(page.getByText("プロファイルを保存しました")).toBeVisible();
  await expect(agentKeys(page)).toHaveCount(1);
  await expect(agentKeys(page).first()).toHaveValue("explore");
});

test("the model picker lists every model on open, before and after a refresh", async ({ page }) => {
  await openApp(page);

  const picker = page.getByLabel("モデル", { exact: true }).first();
  await expect(picker).not.toHaveValue("");
  await picker.click();
  const listbox = page.getByRole("listbox", { name: "モデルを選択" }).first();
  await expect(listbox.getByRole("option")).toHaveCount(TOTAL_MODEL_OPTIONS);
  await expect(listbox.locator('[aria-selected="true"]')).toHaveCount(1);
  await expect(page.getByTestId("model-picker-count").first()).toContainText(String(TOTAL_MODEL_OPTIONS));

  await page.getByRole("button", { name: "一覧を再取得" }).first().click();
  await expect(page.getByRole("button", { name: "一覧を再取得" }).first()).toBeEnabled();

  await picker.click();
  await expect(listbox.getByRole("option")).toHaveCount(TOTAL_MODEL_OPTIONS);
});

test("fetching the latest definitions adds rows for newly reported agents", async ({ page }) => {
  await openApp(page);
  await setCatalog(page, { agents: [...BUILTIN_AGENTS, "future-agent"] });
  await startNewProfile(page);

  await page.getByRole("button", { name: "最新のエージェント定義を取得" }).click();

  await expect(page.getByTestId("catalog-status")).toHaveText(
    "omo 5.0.1 から取得: エージェント 8 / カテゴリ 10（1 行追加）",
  );
  await expect(agentKeys(page)).toHaveCount(BUILTIN_AGENTS.length + 1);
  await expect(agentKeys(page).last()).toHaveValue("future-agent");
  const futureRow = page.getByTestId("agents-rows").locator(":scope > li").last();
  await expect(futureRow.getByText("native では無視されます")).toHaveCount(0);
  await expect(page.getByTestId("catalog-source")).toHaveText("定義: omo 5.0.1");
});

test("a failed definitions fetch is reported and falls back to the built-in rows", async ({ page }) => {
  await openApp(page);
  await setCatalog(page, "fail");
  await startNewProfile(page);

  await page.getByRole("button", { name: "最新のエージェント定義を取得" }).click();

  await expect(page.getByText("ファイル操作に失敗しました。")).toBeVisible();
  await expect(agentKeys(page)).toHaveCount(BUILTIN_AGENTS.length);
  await expect(page.getByRole("button", { name: "最新のエージェント定義を取得" })).toBeEnabled();
});
