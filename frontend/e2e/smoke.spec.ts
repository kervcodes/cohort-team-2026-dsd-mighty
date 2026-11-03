import { expect, test } from "./fixtures";
import { pages } from "./pages";

for (const { name, path } of pages) {
  test(`${name} renders a heading`, async ({ page }) => {
    const response = await page.goto(path);
    expect(response?.status()).toBeLessThan(400);
    await expect(page.getByRole("heading").first()).toBeVisible();
  });
}
