import { expect, test } from "@playwright/test";
import { openApp, setOmoMissing } from "./helpers";

test("model picker filters, accepts free text and warns when omo is missing", async ({ page }) => {
  await openApp(page);

  const picker = page.getByLabel("モデル", { exact: true }).first();
  await picker.click();

  const listbox = page.getByRole("listbox", { name: "モデルを選択" }).first();
  await expect(listbox).toBeVisible();

  await picker.fill("openai/gpt-6-mini");
  await expect(listbox.getByRole("option")).toHaveCount(1);
  await expect(listbox.getByRole("option").first()).toContainText("openai/gpt-6-mini");

  await listbox.getByRole("option", { name: /openai\/gpt-6-mini/ }).click();
  await expect(picker).toHaveValue("openai/gpt-6-mini");
  await expect(listbox).toBeHidden();

  await picker.fill("acme/private-model");
  await expect(picker).toHaveValue("acme/private-model");
  await expect(page.getByRole("listbox", { name: "モデルを選択" }).first()).toContainText(
    "一致するモデルがありません",
  );

  await expect(page.getByText("provider/model 形式で入力します").first()).toBeVisible();

  await setOmoMissing(page, true);
  await expect(
    page
      .getByText("omo コマンドが見つかりません。キャッシュまたは自由入力を利用してください。")
      .first(),
  ).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText("omo コマンドが見つかりません", { exact: true })).toBeVisible();
});
