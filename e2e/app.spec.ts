import { test } from "@playwright/test";

test("scaffold loads", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("heading", { name: "OmOswitch" }).waitFor();
});
