import { test } from "./fixtures";
import { pages } from "./pages";

for (const { name, path } of pages) {
  test(`screenshot ${name}`, async ({ page }) => {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    await page.screenshot({ path: `test-results/screens/${name}.png`, fullPage: true });
  });
}
