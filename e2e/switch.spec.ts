import { expect, test } from "@playwright/test";
import { openApp, profileCard } from "./helpers";

test("preview shows before/after native text and confirming marks the profile active", async ({
  page,
}) => {
  await openApp(page);

  await profileCard(page, "Fast and cheap")
    .getByRole("button", { name: "適用", exact: true })
    .click();

  const dialog = page.getByRole("dialog", { name: "切り替えプレビュー" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("変更があります")).toBeVisible();

  await expect(dialog.getByRole("heading", { name: "適用前" })).toBeVisible();
  await expect(dialog.getByRole("heading", { name: "適用後" })).toBeVisible();
  await expect(dialog.getByText('"[native]": {}')).toBeVisible();
  await expect(dialog.locator("pre").nth(1)).toContainText("openai/gpt-6-mini");

  await dialog.getByRole("button", { name: "このプロファイルを適用" }).click();
  await expect(dialog).toBeHidden();

  await expect(page.getByText("適用しました", { exact: false })).toBeVisible();
  await expect(profileCard(page, "Fast and cheap").getByText("適用中")).toBeVisible();
  await expect(page.getByText("同期済み")).toBeVisible();
  await expect(page.getByText("[native] ブロックあり")).toBeVisible();
});
