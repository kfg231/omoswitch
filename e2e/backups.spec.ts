import { expect, test } from "@playwright/test";
import { acceptConfirm, applyProfile, openApp } from "./helpers";

test("a backup is listed after an apply and can be restored", async ({ page }) => {
  await openApp(page);
  await applyProfile(page, "Default (imported)");

  await page.getByRole("button", { name: "バックアップ" }).click();

  const dialog = page.getByRole("dialog", { name: "バックアップ" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("バックアップはまだありません")).toBeHidden();

  const entries = dialog.getByRole("listitem");
  await expect(entries).toHaveCount(1);
  await expect(entries.first()).toContainText("bak.omoswitch-");
  await expect(entries.first()).toContainText("作成");

  acceptConfirm(page);
  await entries.first().getByRole("button", { name: "復元" }).click();

  await expect(page.getByText("復元しました")).toBeVisible();
  await expect(dialog.getByRole("listitem")).toHaveCount(2);
  await expect(page.getByText("未適用").first()).toBeVisible();
});
