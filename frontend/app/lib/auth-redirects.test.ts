import { accessRedirect, safeNextPath } from "./auth-redirects";

const ORIGIN = "http://localhost:3000";

describe("safeNextPath", () => {
  it("keeps a path on this site, with its query", () => {
    expect(safeNextPath("/invoices/new?vendor=7", ORIGIN)).toBe("/invoices/new?vendor=7");
  });

  it("falls back to the dashboard when there is no next", () => {
    expect(safeNextPath(null, ORIGIN)).toBe("/dashboard");
    expect(safeNextPath("", ORIGIN)).toBe("/dashboard");
  });

  it("refuses another site", () => {
    expect(safeNextPath("https://evil.com/steal", ORIGIN)).toBe("/dashboard");
  });

  it("refuses a protocol-relative URL to another site", () => {
    expect(safeNextPath("//evil.com/steal", ORIGIN)).toBe("/dashboard");
  });

  it("refuses the login and signup pages, which would bounce a signed-in user back", () => {
    expect(safeNextPath("/login?next=/vendors", ORIGIN)).toBe("/dashboard");
    expect(safeNextPath("/signup", ORIGIN)).toBe("/dashboard");
  });
});

function redirectFor(path: string, signedIn: boolean) {
  return accessRedirect(new URL(path, ORIGIN), signedIn);
}

describe("accessRedirect", () => {
  it.each([
    ["/dashboard", "/login?next=%2Fdashboard"],
    ["/", "/login?next=%2F"],
    ["/invoices/new", "/login?next=%2Finvoices%2Fnew"],
    ["/admin/users", "/login?next=%2Fadmin%2Fusers"],
    ["/vendors?page=2", "/login?next=%2Fvendors%3Fpage%3D2"],
  ])("sends a signed-out visitor on %s to login, to come back afterwards", (path, target) => {
    expect(redirectFor(path, false)).toBe(target);
  });

  it.each(["/login", "/login?next=%2Fvendors", "/signup", "/auth/callback?code=abc"])(
    "lets a signed-out visitor open %s",
    (path) => {
      expect(redirectFor(path, false)).toBeNull();
    },
  );

  it.each(["/login", "/signup"])("sends a signed-in user from %s to the dashboard", (path) => {
    expect(redirectFor(path, true)).toBe("/dashboard");
  });

  it("sends a signed-in user from login to a safe next", () => {
    expect(redirectFor("/login?next=%2Fvendors%3Fpage%3D2", true)).toBe("/vendors?page=2");
    expect(redirectFor("/login?next=https%3A%2F%2Fevil.com", true)).toBe("/dashboard");
  });

  it.each(["/dashboard", "/", "/admin/users", "/auth/callback?code=abc"])(
    "lets a signed-in user open %s",
    (path) => {
      expect(redirectFor(path, true)).toBeNull();
    },
  );
});
