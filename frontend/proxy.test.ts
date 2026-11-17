/** @jest-environment node */
import type { CookieMethodsServer } from "@supabase/ssr";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { NextRequest } from "next/server";
import { config, proxy } from "./proxy";

const mockGetUser = jest.fn();
// The cookie methods the proxy hands to Supabase, so a test can play a token refresh.
const mockSupabase: { cookies?: CookieMethodsServer } = {};

jest.mock("@supabase/ssr", () => ({
  createServerClient: (_url: string, _key: string, options: { cookies: CookieMethodsServer }) => {
    mockSupabase.cookies = options.cookies;
    return { auth: { getUser: mockGetUser } };
  },
}));

const ORIGIN = "http://localhost:3000";

function visit(path: string) {
  return proxy(new NextRequest(`${ORIGIN}${path}`, { headers: { cookie: "sb-auth=old" } }));
}

function signedIn() {
  mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
}

function signedOut() {
  mockGetUser.mockResolvedValue({
    data: { user: null },
    error: { name: "AuthSessionMissingError", message: "Auth session missing!" },
  });
}

// NextResponse.next({ request }) hands the request's cookies on to the page render in this header.
function forwardedCookie(response: Response) {
  return response.headers.get("x-middleware-request-cookie");
}

describe("proxy", () => {
  const env = process.env;

  beforeEach(() => {
    jest.resetAllMocks();
    process.env = {
      ...env,
      NEXT_PUBLIC_SUPABASE_URL: "http://supabase.test",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key",
    };
  });
  afterAll(() => {
    process.env = env;
  });

  it.each([
    ["/dashboard", "/login?next=%2Fdashboard"],
    ["/", "/login?next=%2F"],
    ["/invoices/new", "/login?next=%2Finvoices%2Fnew"],
    ["/admin/users", "/login?next=%2Fadmin%2Fusers"],
  ])("redirects a signed-out visitor on %s to login", async (path, target) => {
    signedOut();
    const response = await visit(path);
    expect(response.headers.get("location")).toBe(`${ORIGIN}${target}`);
  });

  it.each(["/login", "/signup", "/auth/callback?code=abc"])(
    "lets a signed-out visitor open %s",
    async (path) => {
      signedOut();
      const response = await visit(path);
      expect(response.headers.get("location")).toBeNull();
      expect(response.headers.get("x-middleware-next")).toBe("1");
    },
  );

  it.each(["/login", "/signup"])(
    "redirects a signed-in user on %s to the dashboard",
    async (path) => {
      signedIn();
      const response = await visit(path);
      expect(response.headers.get("location")).toBe(`${ORIGIN}/dashboard`);
    },
  );

  it.each(["/dashboard", "/auth/callback?code=abc"])(
    "lets a signed-in user open %s",
    async (path) => {
      signedIn();
      const response = await visit(path);
      expect(response.headers.get("location")).toBeNull();
    },
  );

  it("treats a user Supabase could not confirm as signed out", async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: "user-1" } },
      error: { name: "AuthApiError", message: "invalid JWT" },
    });
    const response = await visit("/dashboard");
    expect(response.headers.get("location")).toBe(`${ORIGIN}/login?next=%2Fdashboard`);
  });

  it("treats a network failure as signed out", async () => {
    const consoleError = jest.spyOn(console, "error").mockImplementation(() => {});
    mockGetUser.mockRejectedValue(new TypeError("fetch failed"));
    const response = await visit("/dashboard");
    expect(response.headers.get("location")).toBe(`${ORIGIN}/login?next=%2Fdashboard`);
    consoleError.mockRestore();
  });

  it("keeps the refreshed session cookies and cache headers Supabase sets", async () => {
    mockGetUser.mockImplementation(async () => {
      await mockSupabase.cookies?.setAll?.(
        [{ name: "sb-auth", value: "new", options: { path: "/", httpOnly: true } }],
        { "Cache-Control": "private, no-store" },
      );
      return { data: { user: { id: "user-1" } }, error: null };
    });

    const response = await visit("/dashboard");

    expect(response.cookies.get("sb-auth")?.value).toBe("new");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    // The page renders with the refreshed session, not the expired one.
    expect(forwardedCookie(response)).toContain("sb-auth=new");
  });

  it("keeps the cookies Supabase sets on a redirect too", async () => {
    mockGetUser.mockImplementation(async () => {
      // A refresh token that no longer works: Supabase clears the session.
      await mockSupabase.cookies?.setAll?.(
        [{ name: "sb-auth", value: "", options: { path: "/", maxAge: 0 } }],
        {},
      );
      return { data: { user: null }, error: { name: "AuthApiError", message: "expired" } };
    });

    const response = await visit("/dashboard");

    expect(response.headers.get("location")).toBe(`${ORIGIN}/login?next=%2Fdashboard`);
    expect(response.headers.get("set-cookie")).toMatch(/sb-auth=;.*Max-Age=0/);
  });

  it.each(["/dashboard", "/", "/auth/callback", "/login"])("runs on %s", (url) => {
    expect(unstable_doesMiddlewareMatch({ config, url })).toBe(true);
  });

  it.each(["/_next/static/chunks/app.js", "/_next/image?url=x", "/favicon.ico", "/next.svg"])(
    "skips the static file %s",
    (url) => {
      expect(unstable_doesMiddlewareMatch({ config, url })).toBe(false);
    },
  );
});
