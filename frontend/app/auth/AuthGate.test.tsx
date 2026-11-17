import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Profile, UserStatus } from "@/types/user";
import { AuthGate } from "./AuthGate";

const mockReplace = jest.fn();
const mockRefresh = jest.fn();
const mockSignOut = jest.fn();
const mockUseAuth = jest.fn();

jest.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockReplace, push: jest.fn(), refresh: mockRefresh }),
}));

jest.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ auth: { signOut: mockSignOut } }),
}));

jest.mock("./AuthProvider", () => ({
  useAuth: () => mockUseAuth(),
}));

const user = { id: "user-1", email: "jane@example.test" };

function profileWithStatus(status: UserStatus): Profile {
  return {
    id: "user-1",
    full_name: "Jane Doe",
    email: "jane@example.test",
    role: "analyst",
    status,
  };
}

function authState(state: {
  user?: typeof user | null;
  profile?: Profile | null;
  profileError?: string | null;
  loading?: boolean;
}) {
  mockUseAuth.mockReturnValue({
    user: null,
    profile: null,
    profileError: null,
    loading: false,
    ...state,
  });
}

const APP_CONTENT = "App content";

function renderGate() {
  return render(
    <AuthGate>
      <p>{APP_CONTENT}</p>
    </AuthGate>,
  );
}

describe("AuthGate", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSignOut.mockResolvedValue({ error: null });
  });

  it("shows the app to an active user", () => {
    authState({ user, profile: profileWithStatus("active") });
    renderGate();

    expect(screen.getByText("App content")).toBeVisible();
    expect(screen.queryByText("Waiting for approval")).not.toBeInTheDocument();
  });

  it("shows the loading screen, not the app, while the account is loading", () => {
    authState({ user, loading: true });
    renderGate();

    expect(screen.getByRole("status")).toHaveTextContent("Loading your account...");
    expect(screen.getByText("App content")).not.toBeVisible();
  });

  it("shows the loading screen, not the app, before auth is known", () => {
    // AuthProvider's first state, so the server render and hydration show this too.
    authState({ user: null, loading: true });
    renderGate();

    expect(screen.getByRole("status")).toHaveTextContent("Loading your account...");
    expect(screen.getByText("App content")).not.toBeVisible();
  });

  it("shows the app once an active profile arrives", () => {
    authState({ user, loading: true });
    const { rerender } = renderGate();
    expect(screen.getByText("App content")).not.toBeVisible();

    authState({ user, profile: profileWithStatus("active") });
    rerender(
      <AuthGate>
        <p>{APP_CONTENT}</p>
      </AuthGate>,
    );

    expect(screen.getByText("App content")).toBeVisible();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("never shows the app to an inactive user, from loading to the waiting screen", () => {
    authState({ user, loading: true });
    const { rerender } = renderGate();
    expect(screen.getByText("App content")).not.toBeVisible();

    authState({ user, profile: profileWithStatus("inactive") });
    rerender(
      <AuthGate>
        <p>{APP_CONTENT}</p>
      </AuthGate>,
    );

    expect(screen.getByText("App content")).not.toBeVisible();
    expect(screen.getByRole("heading", { name: "Waiting for approval" })).toBeInTheDocument();
  });

  it("leaves a signed-out visitor to the proxy and sign-out redirects", () => {
    authState({ user: null });
    renderGate();

    expect(screen.getByText("App content")).toBeVisible();
  });

  it("shows the waiting-for-approval screen, not the app, to an inactive user", () => {
    authState({ user, profile: profileWithStatus("inactive") });
    renderGate();

    expect(screen.getByText("App content")).not.toBeVisible();
    expect(screen.getByRole("heading", { name: "Waiting for approval" })).toBeInTheDocument();
    expect(screen.getByText(/An admin needs to approve it/)).toBeInTheDocument();
    expect(screen.getByText("jane@example.test")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
  });

  it("signs an inactive user out from the waiting screen", async () => {
    authState({ user, profile: profileWithStatus("inactive") });
    renderGate();

    await userEvent.click(screen.getByRole("button", { name: "Sign Out" }));

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith("/login"));
    expect(mockSignOut).toHaveBeenCalledTimes(1);
    expect(mockRefresh).toHaveBeenCalled();
  });

  it("tells the user when signing out from the waiting screen fails", async () => {
    const consoleError = jest.spyOn(console, "error").mockImplementation(() => {});
    mockSignOut.mockRejectedValueOnce(new Error("lock timeout"));
    authState({ user, profile: profileWithStatus("inactive") });
    renderGate();

    await userEvent.click(screen.getByRole("button", { name: "Sign Out" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/couldn't sign out/i);
    expect(mockReplace).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("shows why the account could not be loaded, with a way out, instead of the app", () => {
    authState({ user, profileError: "Account not found. Contact an admin." });
    renderGate();

    expect(screen.getByText("App content")).not.toBeVisible();
    expect(
      screen.getByRole("heading", { name: "We couldn't load your account" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Account not found. Contact an admin.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign Out" })).toBeInTheDocument();
  });
});
