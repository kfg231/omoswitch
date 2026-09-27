import { expect, test } from "@playwright/test";
import { openApp } from "./helpers";

test("a non-native agent key is marked but still saves", async ({ page }) => {
  await openApp(page);

  await page.getByPlaceholder("キー名").first().fill("sisyphus");
  await page.getByRole("button", { name: "エージェントを追加" }).click();

  const row = page.getByRole("listitem").filter({ hasText: "sisyphus" }).first();
  await expect(row).toBeVisible();
  await expect(row.getByText("native では無視されます")).toBeVisible();

  await row.getByLabel("モデル", { exact: true }).fill("openai/gpt-6-sol");

  await expect(page.getByText("保存されていない変更があります")).toBeVisible();
  await page.getByRole("button", { name: "保存" }).click();

  await expect(page.getByText("プロファイルを保存しました")).toBeVisible();
  await expect(page.getByText("保存されていない変更があります")).toBeHidden();
  await expect(
    page.getByRole("listitem").filter({ hasText: "sisyphus" }).first().getByText("native では無視されます"),
  ).toBeVisible();
});
