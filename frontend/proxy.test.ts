/** @jest-environment node */
import type { CookieMethodsServer } from "@supabase/ssr";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { NextRequest } from "next/server";
import { HOME_PATH } from "@/lib/auth-redirects";
import { config, proxy } from "./proxy";

const mockGetUser = jest.fn();
const mockGetSession = jest.fn();
const mockFetch = jest.fn();

// The cookie methods the proxy hands to Supabase, so a test can play a token refresh.
const mockSupabase: { cookies?: CookieMethodsServer } = {};

jest.mock("@supabase/ssr", () => ({
  createServerClient: (_url: string, _key: string, options: { cookies: CookieMethodsServer }) => {
    mockSupabase.cookies = options.cookies;

    return {
      auth: {
        getUser: mockGetUser,
        getSession: mockGetSession,
      },
    };
  },
}));

const ORIGIN = "http://localhost:3000";

const PROFILE = {
  role: "admin",
};

function visit(path: string) {
  return proxy(
    new NextRequest(`${ORIGIN}${path}`, {
      headers: { cookie: "sb-auth=old" },
    }),
  );
}

function signedIn() {
  mockGetUser.mockResolvedValue({
    data: { user: { id: "user-1" } },
    error: null,
  });
}

function signedOut() {
  mockGetUser.mockResolvedValue({
    data: { user: null },
    error: {
      name: "AuthSessionMissingError",
      message: "Auth session missing!",
    },
  });
}

function mockSession() {
  mockGetSession.mockResolvedValue({
    data: {
      session: {
        access_token: "test-access-token",
      },
    },
    error: null,
  });
}

function mockProfile(role = "admin") {
  mockFetch.mockResolvedValue(
    new Response(JSON.stringify({ role }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  );
}

// NextResponse.next({ request }) hands the request's cookies
// on to the page render in this header.
function forwardedCookie(response: Response) {
  return response.headers.get("x-middleware-request-cookie");
}

describe("proxy", () => {
  const env = process.env;
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.resetAllMocks();
    mockSupabase.cookies = undefined;

    process.env = {
      ...env,
      NEXT_PUBLIC_SUPABASE_URL: "http://supabase.test",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key",
      NEXT_PUBLIC_API_URL: "http://api.test",
    };

    global.fetch = mockFetch;

    // Default authenticated user has admin permissions.
    mockSession();
    mockProfile();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  afterAll(() => {
    process.env = env;
  });

  describe("authentication redirects", () => {
    it.each([
      ["/dashboard", "/login?next=%2Fdashboard"],
      ["/", "/login?next=%2F"],
      ["/invoices/new", "/login?next=%2Finvoices%2Fnew"],
      ["/admin/users", "/login?next=%2Fadmin%2Fusers"],
    ])("redirects a signed-out visitor on %s to login", async (path, target) => {
      signedOut();

      const response = await visit(path);

      expect(response.headers.get("location")).toBe(`${ORIGIN}${target}`);
      expect(mockFetch).not.toHaveBeenCalled();
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
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("treats a network failure as signed out", async () => {
      const consoleError = jest.spyOn(console, "error").mockImplementation(() => {});

      mockGetUser.mockRejectedValue(new TypeError("fetch failed"));

      const response = await visit("/dashboard");

      expect(response.headers.get("location")).toBe(`${ORIGIN}/login?next=%2Fdashboard`);
      expect(mockFetch).not.toHaveBeenCalled();

      consoleError.mockRestore();
    });
  });

  describe("session handling", () => {
    it("keeps the refreshed session cookies and cache headers Supabase sets", async () => {
      mockGetUser.mockImplementation(async () => {
        await mockSupabase.cookies?.setAll?.(
          [
            {
              name: "sb-auth",
              value: "new",
              options: { path: "/", httpOnly: true },
            },
          ],
          { "Cache-Control": "private, no-store" },
        );

        return {
          data: { user: { id: "user-1" } },
          error: null,
        };
      });

      const response = await visit("/dashboard");

      expect(response.cookies.get("sb-auth")?.value).toBe("new");
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(forwardedCookie(response)).toContain("sb-auth=new");
    });

    it("keeps the cookies Supabase sets on a redirect too", async () => {
      mockGetUser.mockImplementation(async () => {
        // A refresh token that no longer works: Supabase clears the session.
        await mockSupabase.cookies?.setAll?.(
          [
            {
              name: "sb-auth",
              value: "",
              options: { path: "/", maxAge: 0 },
            },
          ],
          {},
        );

        return {
          data: { user: null },
          error: { name: "AuthApiError", message: "expired" },
        };
      });

      const response = await visit("/dashboard");

      expect(response.headers.get("location")).toBe(`${ORIGIN}/login?next=%2Fdashboard`);
      expect(response.headers.get("set-cookie")).toMatch(/sb-auth=;.*Max-Age=0/);
    });

    it("denies access when getSession returns an error", async () => {
      signedIn();

      mockGetSession.mockResolvedValue({
        data: { session: null },
        error: { message: "Session unavailable" },
      });

      const response = await visit("/dashboard");

      expect(response.headers.get("location")).toBe(`${ORIGIN}${HOME_PATH}`);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("denies access when the session has no access token", async () => {
      signedIn();

      mockGetSession.mockResolvedValue({
        data: { session: { access_token: null } },
        error: null,
      });

      const response = await visit("/dashboard");

      expect(response.headers.get("location")).toBe(`${ORIGIN}${HOME_PATH}`);
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe("profile authorization", () => {
    it("requests the profile from /me using the session access token", async () => {
      signedIn();

      await visit("/dashboard");

      expect(mockFetch).toHaveBeenCalledWith("http://api.test/me", {
        method: "GET",
        headers: {
          Authorization: "Bearer test-access-token",
        },
        cache: "no-store",
      });
    });

    it("allows an admin to access restricted routes", async () => {
      signedIn();
      mockProfile("admin");

      const response = await visit("/admin/users");

      expect(response.headers.get("location")).toBeNull();
      expect(response.headers.get("x-middleware-next")).toBe("1");
    });

    it.each([
      ["/dashboard", "approver"],
      ["/approvals", "approver"],
      ["/vendors", "approver"],
      ["/properties", "approver"],
      ["/dashboard", "analyst"],
      ["/invoices/new", "analyst"],
      ["/invoices/drafts", "analyst"],
    ])("allows a %s-compatible route for role %s", async (path, role) => {
      signedIn();
      mockProfile(role);

      const response = await visit(path);

      expect(response.headers.get("location")).toBeNull();
      expect(response.headers.get("x-middleware-next")).toBe("1");
    });

    it.each([
      ["/admin/users", "approver"],
      ["/admin/users", "analyst"],
      ["/approvals", "analyst"],
      ["/invoices/new", "approver"],
      ["/invoices/drafts", "approver"],
    ])("denies role %s access to %s", async (path, role) => {
      signedIn();
      mockProfile(role);

      const response = await visit(path);

      expect(response.headers.get("location")).toBe(`${ORIGIN}${HOME_PATH}`);
    });

    it("denies access when the profile role is unauthorized", async () => {
      signedIn();
      mockProfile("unauthorized");

      const response = await visit("/dashboard");

      expect(response.headers.get("location")).toBe(`${ORIGIN}${HOME_PATH}`);
    });

    it("denies access when the profile request fails", async () => {
      signedIn();

      mockFetch.mockResolvedValue(new Response("Internal Server Error", { status: 500 }));

      const consoleError = jest.spyOn(console, "error").mockImplementation(() => {});

      const response = await visit("/dashboard");

      expect(response.headers.get("location")).toBe(`${ORIGIN}${HOME_PATH}`);

      consoleError.mockRestore();
    });

    it("denies access when the profile request throws a network error", async () => {
      signedIn();

      mockFetch.mockRejectedValue(new TypeError("fetch failed"));

      const consoleError = jest.spyOn(console, "error").mockImplementation(() => {});

      const response = await visit("/dashboard");

      expect(response.headers.get("location")).toBe(`${ORIGIN}${HOME_PATH}`);

      consoleError.mockRestore();
    });
  });

  describe("matcher configuration", () => {
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
});
