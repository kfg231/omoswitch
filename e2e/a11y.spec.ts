import { expect, test } from "@playwright/test";
import { openApp } from "./helpers";

test("Esc closes a dialog and focus returns to the trigger", async ({ page }) => {
  await openApp(page);

  const trigger = page.getByRole("button", { name: "設定から取り込む" });
  await trigger.click();

  const dialog = page.getByRole("dialog", { name: "設定から取り込む" });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator(":focus")).toHaveCount(1);

  await page.keyboard.press("Escape");

  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
});
