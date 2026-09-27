import { expect, test } from "@playwright/test";
import { openApp } from "./helpers";

test("importing from [opencode] lists renamed pairs and dropped keys", async ({ page }) => {
  await openApp(page);

  await page.getByRole("button", { name: "設定から取り込む" }).click();

  const dialog = page.getByRole("dialog", { name: "設定から取り込む" });
  await expect(dialog).toBeVisible();

  await dialog.getByRole("radio", { name: "[opencode] ブロック" }).check();
  await dialog.getByLabel("新しいプロファイル名").fill("base");
  await dialog.getByRole("button", { name: "取り込む" }).click();

  await expect(dialog.getByText('「base」を取り込みました')).toBeVisible();

  await expect(dialog.getByText("次のキーを改名しました:")).toBeVisible();
  await expect(dialog.getByText("metis → plan-consultant")).toBeVisible();
  await expect(dialog.getByText("momus → plan-reviewer")).toBeVisible();

  await expect(
    dialog.getByText("次のキーは OmO Native に存在しないため取り除きました:"),
  ).toBeVisible();
  for (const dropped of [
    "sisyphus",
    "hephaestus",
    "prometheus",
    "atlas",
    "oracle",
    "multimodal-looker",
    "sisyphus-junior",
  ]) {
    await expect(dialog.getByText(dropped, { exact: true })).toBeVisible();
  }

  await dialog.getByRole("button", { name: "閉じる", exact: true }).last().click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("listitem").filter({ hasText: "base" }).first()).toBeVisible();
});
