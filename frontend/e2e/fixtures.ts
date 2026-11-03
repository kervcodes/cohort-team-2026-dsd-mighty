import { test as base, expect } from "@playwright/test";

const APP_ORIGIN = "http://localhost:3000";

const mockBill = {
  id: "00000000-0000-0000-0000-000000000001",
  invoice_number: "INV-MOCK-1",
  amount: "100.00",
};

/**
 * Every e2e test runs against mock data only. Requests to the app itself pass through;
 * the backend API and Supabase get canned responses; anything else is aborted and fails the test.
 */
export const test = base.extend<{ mockOnly: undefined }>({
  mockOnly: [
    async ({ page }, use) => {
      const blocked: string[] = [];
      await page.route("**/*", (route) => {
        const url = route.request().url();
        if (url.startsWith(APP_ORIGIN) || url.startsWith("data:") || url.startsWith("blob:")) {
          return route.continue();
        }
        if (url.startsWith("http://127.0.0.1:8000")) {
          return route.fulfill({ status: 200, json: mockBill });
        }
        if (url.startsWith("http://127.0.0.1:54321")) {
          return route.fulfill({ status: 200, json: {} });
        }
        blocked.push(url);
        return route.abort();
      });
      await use(undefined);
      expect(blocked, "e2e tests must not reach live services").toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
