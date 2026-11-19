import { canAccessRoute } from "./auth-permissions";

describe("canAccessRoute", () => {
  describe("admin access", () => {
    it.each([
      "/",
      "/dashboard",
      "/properties",
      "/properties/123",
      "/properties/123/edit",
      "/vendors",
      "/invoices",
      "/invoices/new",
      "/invoices/drafts",
      "/approvals",
      "/admin",
      "/unknown-route",
    ])("allows admin to access %s", (path) => {
      expect(canAccessRoute(path, "admin")).toBe(true);
    });
  });

  describe("shared routes", () => {
    const sharedRoutes = [
      "/",
      "/dashboard",
      "/properties",
      "/properties/123",
      "/vendors",
      "/vendors/123",
      "/invoices",
      "/invoices/123",
    ];

    it.each(sharedRoutes)("allows analyst to access %s", (path) => {
      expect(canAccessRoute(path, "analyst")).toBe(true);
    });

    it.each(sharedRoutes)("allows approver to access %s", (path) => {
      expect(canAccessRoute(path, "approver")).toBe(true);
    });
  });

  describe("analyst routes", () => {
    const analystRoutes = [
      "/invoices/new",
      "/invoices/drafts",
      "/invoices/new/123",
      "/invoices/drafts/123",
    ];

    it.each(analystRoutes)("allows analyst to access %s", (path) => {
      expect(canAccessRoute(path, "analyst")).toBe(true);
    });

    it.each(analystRoutes)("denies approver access to %s", (path) => {
      expect(canAccessRoute(path, "approver")).toBe(false);
    });
  });

  describe("approver routes", () => {
    const approverRoutes = ["/approvals", "/approvals/123"];

    it.each(approverRoutes)("allows approver to access %s", (path) => {
      expect(canAccessRoute(path, "approver")).toBe(true);
    });

    it.each(approverRoutes)("denies analyst access to %s", (path) => {
      expect(canAccessRoute(path, "analyst")).toBe(false);
    });
  });

  describe("unconfigured routes", () => {
    const unconfiguredRoutes = ["/settings", "/profile", "/reports", "/unknown-route"];

    it.each(unconfiguredRoutes)("allows analyst access to %s by default", (path) => {
      expect(canAccessRoute(path, "analyst")).toBe(false);
    });

    it.each(unconfiguredRoutes)("allows approver access to %s by default", (path) => {
      expect(canAccessRoute(path, "approver")).toBe(false);
    });
  });

  describe("route matching", () => {
    it("does not match partial route names", () => {
      expect(canAccessRoute("/invoices/newer", "approver")).toBe(true);
      expect(canAccessRoute("/approvals-extra", "analyst")).toBe(false);
    });

    it("prioritizes the most specific route permission", () => {
      expect(canAccessRoute("/invoices/new", "analyst")).toBe(true);
      expect(canAccessRoute("/invoices/new", "approver")).toBe(false);
    });

    it("handles trailing slashes", () => {
      expect(canAccessRoute("/invoices/new/", "analyst")).toBe(true);
      expect(canAccessRoute("/approvals/", "approver")).toBe(true);
    });
  });
});
