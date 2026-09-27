import { expect, test } from "@playwright/test";
import { openApp } from "./helpers";

test("toggling the language switches visible strings between ja and en", async ({ page }) => {
  await openApp(page);

  await expect(page.getByText("OmO Native プロファイル切り替え")).toBeVisible();
  await expect(page.getByRole("heading", { name: "プロファイル", exact: true })).toBeVisible();

  const toggle = page.getByRole("button", { name: "言語を切り替える" });
  await toggle.click();

  await expect(page.getByText("OmO Native profile switcher")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Profiles" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Import from config" })).toBeVisible();
  await expect(page.getByText("OmO Native プロファイル切り替え")).toBeHidden();

  await page.getByRole("button", { name: "Switch language" }).click();

  await expect(page.getByText("OmO Native プロファイル切り替え")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Profiles" })).toBeHidden();
});
