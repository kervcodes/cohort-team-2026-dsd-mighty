import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "./fixtures";
import { pages } from "./pages";

for (const { name, path } of pages) {
  test(`${name} has no serious accessibility violations @a11y`, async ({ page }) => {
    await page.goto(path);
    const { violations } = await new AxeBuilder({ page })
      .disableRules(["color-contrast"])
      .analyze();
    const serious = violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    expect(serious.map((v) => v.id)).toEqual([]);
  });
}
