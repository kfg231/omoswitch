import { expect, test } from "@playwright/test";
import { CONFIG_PATH, openApp, profileCard } from "./helpers";

test("shows the config path, status badges and the seeded profiles", async ({ page }) => {
  await openApp(page);

  await expect(page.getByText(CONFIG_PATH)).toBeVisible();
  await expect(page.getByText("OmO Native プロファイル切り替え")).toBeVisible();

  await expect(page.getByRole("heading", { name: "プロファイル", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "適用", exact: true })).toHaveCount(2);

  const card = profileCard(page, "Default (imported)");
  await expect(card.getByText("エージェント 7 件")).toBeVisible();
  await expect(card.getByText("カテゴリ 10 件")).toBeVisible();

  await expect(page.getByText("未適用").first()).toBeVisible();
  await expect(page.getByText("[senpi] ブロックが残っています（編集しません）")).toBeVisible();
});
