import { expect, test } from "@playwright/test";
import { applyProfile, openApp, setDrift } from "./helpers";

test("drift badge appears from the poll and Capture clears it", async ({ page }) => {
  await openApp(page);
  await applyProfile(page, "Default (imported)");
  await expect(page.getByText("同期済み")).toBeVisible();

  await setDrift(page, true);

  await expect(page.getByText("ファイルが変更されています")).toBeVisible({ timeout: 10_000 });
  await expect(
    page.getByText("ファイルの内容と適用中のプロファイルが一致していません。"),
  ).toBeVisible();

  await page.getByRole("button", { name: "現在の内容を取り込む" }).click();

  await expect(page.getByText("ファイルが変更されています")).toBeHidden({ timeout: 10_000 });
  await expect(page.getByText("同期済み")).toBeVisible();
});
