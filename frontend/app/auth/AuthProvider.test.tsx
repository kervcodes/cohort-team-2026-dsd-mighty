import { AuthSessionMissingError } from "@supabase/supabase-js";
import { act, render, screen, waitFor } from "@testing-library/react";
import type { Profile } from "@/types/user";
import { AuthProvider, useAuth } from "./AuthProvider";

type AuthCallback = (event: string, session: { user: { id: string } } | null) => void;

const mockGetUser = jest.fn();
const mockGetSession = jest.fn();
const mockFrom = jest.fn();
const mockUnsubscribe = jest.fn();
let authCallback: AuthCallback = () => {};

jest.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      getUser: mockGetUser,
      getSession: mockGetSession,
      onAuthStateChange: (callback: AuthCallback) => {
        authCallback = callback;
        return { data: { subscription: { unsubscribe: mockUnsubscribe } } };
      },
    },
    from: mockFrom,
  }),
}));

const fetchMock = jest.fn();
const originalApiUrl = process.env.NEXT_PUBLIC_API_URL;

const jane: Profile = {
  id: "user-1",
  full_name: "Jane Doe",
  email: "jane@example.test",
  role: "analyst",
  status: "active",
};

function Probe() {
  const { user, profile, profileError, loading } = useAuth();
  return (
    <div>
      <p data-testid="loading">{String(loading)}</p>
      <p data-testid="user">{user?.id ?? "none"}</p>
      <p data-testid="profile">{profile ? JSON.stringify(profile) : "none"}</p>
      <p data-testid="error">{profileError ?? "none"}</p>
    </div>
  );
}

function signedInAs(id: string) {
  mockGetUser.mockResolvedValue({ data: { user: { id } }, error: null });
  mockGetSession.mockResolvedValue({
    data: { session: { access_token: `token-${id}` } },
    error: null,
  });
}

function signedOut() {
  mockGetUser.mockResolvedValue({ data: { user: null }, error: new AuthSessionMissingError() });
  mockGetSession.mockResolvedValue({ data: { session: null }, error: null });
}

function meReturns(status: number, body: unknown) {
  fetchMock.mockResolvedValueOnce({ ok: status < 400, status, json: async () => body });
}

function renderProvider() {
  return render(
    <AuthProvider>
      <Probe />
    </AuthProvider>,
  );
}

async function settled() {
  await waitFor(() => expect(screen.getByTestId("loading")).toHaveTextContent("false"));
}

function shownProfile() {
  const text = screen.getByTestId("profile").textContent ?? "none";
  return text === "none" ? null : JSON.parse(text);
}

describe("AuthProvider", () => {
  let consoleError: jest.SpyInstance;
  let consoleWarn: jest.SpyInstance;

  beforeEach(() => {
    process.env.NEXT_PUBLIC_API_URL = "http://api.test";
    global.fetch = fetchMock as unknown as typeof fetch;
    consoleError = jest.spyOn(console, "error").mockImplementation(() => {});
    consoleWarn = jest.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    jest.resetAllMocks();
    consoleError.mockRestore();
    consoleWarn.mockRestore();
    process.env.NEXT_PUBLIC_API_URL = originalApiUrl;
  });

  it("loads the profile from GET /me with the user's token, never from app_users", async () => {
    signedInAs("user-1");
    meReturns(200, jane);

    renderProvider();
    await settled();

    expect(shownProfile()).toEqual(jane);
    expect(screen.getByTestId("error")).toHaveTextContent("none");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://api.test/me");
    expect(init.headers.Authorization).toBe("Bearer token-user-1");
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("stays loading until /me answers", async () => {
    signedInAs("user-1");
    let answer: (value: unknown) => void = () => {};
    fetchMock.mockReturnValueOnce(
      new Promise((resolve) => {
        answer = resolve;
      }),
    );

    renderProvider();
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(screen.getByTestId("loading")).toHaveTextContent("true");

    answer({ ok: true, status: 200, json: async () => jane });
    await settled();
    expect(shownProfile()).toEqual(jane);
  });

  it("exposes an inactive status as is", async () => {
    signedInAs("user-1");
    meReturns(200, { ...jane, status: "inactive" });

    renderProvider();
    await settled();

    expect(shownProfile()).toMatchObject({ status: "inactive" });
  });

  it("reports a missing profile (403) as a message, not a blank profile", async () => {
    signedInAs("user-1");
    meReturns(403, { detail: "Account not found. Contact an admin." });

    renderProvider();
    await settled();

    expect(shownProfile()).toBeNull();
    expect(screen.getByTestId("user")).toHaveTextContent("user-1");
    expect(screen.getByTestId("error")).toHaveTextContent("Account not found. Contact an admin.");
  });

  it("stops loading with a clear message when the backend is unreachable", async () => {
    signedInAs("user-1");
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));

    renderProvider();
    await settled();

    expect(screen.getByTestId("error")).toHaveTextContent(/Unable to reach the server/);
  });

  it("does not call /me, or log an error, for a signed-out visitor", async () => {
    signedOut();

    renderProvider();
    await settled();

    expect(screen.getByTestId("user")).toHaveTextContent("none");
    expect(shownProfile()).toBeNull();
    expect(screen.getByTestId("error")).toHaveTextContent("none");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("loads the new user's profile on sign-in", async () => {
    signedOut();
    renderProvider();
    await settled();

    signedInAs("user-2");
    meReturns(200, { ...jane, id: "user-2", full_name: "Sam Lee" });
    act(() => authCallback("SIGNED_IN", { user: { id: "user-2" } }));

    // Loading again until the new user's profile is known.
    expect(screen.getByTestId("loading")).toHaveTextContent("true");
    await settled();
    expect(screen.getByTestId("user")).toHaveTextContent("user-2");
    expect(shownProfile()).toMatchObject({ id: "user-2", full_name: "Sam Lee" });
  });

  it("asks /me once when the restored session is also reported as SIGNED_IN", async () => {
    signedInAs("user-1");
    meReturns(200, jane);
    renderProvider();

    act(() => authCallback("SIGNED_IN", { user: { id: "user-1" } }));
    await settled();

    expect(shownProfile()).toEqual(jane);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reloads the profile in place when the user is updated", async () => {
    signedInAs("user-1");
    meReturns(200, jane);
    renderProvider();
    await settled();

    meReturns(200, { ...jane, full_name: "Jane Smith" });
    act(() => authCallback("USER_UPDATED", { user: { id: "user-1" } }));

    expect(screen.getByTestId("loading")).toHaveTextContent("false");
    await waitFor(() => expect(shownProfile()).toMatchObject({ full_name: "Jane Smith" }));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("clears the profile and any error on sign-out", async () => {
    signedInAs("user-1");
    meReturns(403, { detail: "Account not found. Contact an admin." });
    renderProvider();
    await settled();

    act(() => authCallback("SIGNED_OUT", null));

    expect(screen.getByTestId("user")).toHaveTextContent("none");
    expect(shownProfile()).toBeNull();
    expect(screen.getByTestId("error")).toHaveTextContent("none");
  });

  it("ignores a slow /me answer for a user who has since signed out", async () => {
    signedInAs("user-1");
    let answer: (value: unknown) => void = () => {};
    fetchMock.mockReturnValueOnce(
      new Promise((resolve) => {
        answer = resolve;
      }),
    );
    renderProvider();
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    act(() => authCallback("SIGNED_OUT", null));
    await act(async () => answer({ ok: true, status: 200, json: async () => jane }));

    expect(shownProfile()).toBeNull();
    expect(screen.getByTestId("loading")).toHaveTextContent("false");
  });

  it("unsubscribes from auth changes on unmount", async () => {
    signedOut();
    const { unmount } = renderProvider();
    await settled();
    // The previous test's provider is unmounted after the mocks were reset.
    mockUnsubscribe.mockClear();

    unmount();

    expect(mockUnsubscribe).toHaveBeenCalledTimes(1);
  });
});
