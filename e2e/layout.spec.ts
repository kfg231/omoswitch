import { expect, test } from "@playwright/test";
import { openApp } from "./helpers";

test("document does not scroll beyond the viewport", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 600 });
  await openApp(page);
  const metrics = await page.evaluate(() => ({
    doc: document.documentElement.scrollHeight,
    view: window.innerHeight,
  }));
  expect(metrics.doc).toBeLessThanOrEqual(metrics.view);
});
