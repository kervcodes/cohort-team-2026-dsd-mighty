import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Profile, UserRole } from "@/types/user";
import Sidebar from "./sidebar";

const mockReplace = jest.fn();
const mockRefresh = jest.fn();
const mockSignOut = jest.fn();
const mockUseAuth = jest.fn();

jest.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockReplace, push: jest.fn(), refresh: mockRefresh }),
}));

jest.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: { signOut: mockSignOut },
  }),
}));

jest.mock("@/auth/AuthProvider", () => ({
  useAuth: () => mockUseAuth(),
}));

jest.mock("@/context/ThemeContext", () => ({
  useTheme: () => ({ theme: "light", toggleTheme: jest.fn() }),
}));

const signedInUser = { id: "user-1", email: "a@b.com" };

function profileWithRole(role: UserRole): Profile {
  return {
    user_id: "user-1",
    full_name: "Test User",
    email: "a@b.com",
    role,
    status: "active",
  };
}

function signIn(profile: Profile | null) {
  mockUseAuth.mockReturnValue({ user: signedInUser, profile, loading: false });
}

function signOutButton() {
  return screen.getByRole("button", { name: "Sign Out" });
}

describe("Sidebar", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseAuth.mockReturnValue({ user: null, profile: null, loading: false });
    mockSignOut.mockResolvedValue({ error: null });
  });

  it("does not show the test-only control panel", () => {
    signIn(profileWithRole("admin"));
    render(<Sidebar />);

    expect(screen.queryByText("Control Panel")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Log in" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "toggle admin" })).not.toBeInTheDocument();
    expect(screen.queryByText(/is (admin|analyst)/)).not.toBeInTheDocument();
  });

  describe("Sign Out", () => {
    it("is hidden when nobody is signed in", () => {
      render(<Sidebar />);

      expect(screen.queryByRole("button", { name: "Sign Out" })).not.toBeInTheDocument();
    });

    it("is shown when a user is signed in, even without a profile", () => {
      signIn(null);
      render(<Sidebar />);

      expect(signOutButton()).toBeInTheDocument();
    });

    it("keeps its name and tooltip when the label text is hidden on narrow screens", () => {
      signIn(null);
      render(<Sidebar />);

      // jsdom ignores the CSS that hides the visible label, so check the attributes directly.
      expect(signOutButton()).toHaveAttribute("aria-label", "Sign Out");
      expect(signOutButton()).toHaveAttribute("title", "Sign Out");
    });

    it("ends the Supabase session, then goes to the login page and refreshes", async () => {
      signIn(profileWithRole("analyst"));
      render(<Sidebar />);

      await userEvent.click(signOutButton());

      await waitFor(() => expect(mockReplace).toHaveBeenCalledWith("/login"));
      expect(mockSignOut).toHaveBeenCalledTimes(1);
      expect(mockRefresh).toHaveBeenCalled();
      expect(mockSignOut.mock.invocationCallOrder[0]).toBeLessThan(
        mockReplace.mock.invocationCallOrder[0],
      );
    });

    it("waits for the session to end before leaving the page", async () => {
      let finishSignOut: (value: { error: null }) => void = () => {};
      mockSignOut.mockReturnValue(
        new Promise((resolve) => {
          finishSignOut = resolve;
        }),
      );
      signIn(profileWithRole("analyst"));
      render(<Sidebar />);

      await userEvent.click(signOutButton());
      expect(mockSignOut).toHaveBeenCalledTimes(1);
      expect(mockReplace).not.toHaveBeenCalled();

      finishSignOut({ error: null });
      await waitFor(() => expect(mockReplace).toHaveBeenCalledWith("/login"));
    });

    it("only signs out once when clicked twice while in flight", async () => {
      let finishSignOut: (value: { error: null }) => void = () => {};
      mockSignOut.mockReturnValue(
        new Promise((resolve) => {
          finishSignOut = resolve;
        }),
      );
      signIn(profileWithRole("analyst"));
      render(<Sidebar />);

      await userEvent.dblClick(signOutButton());
      await userEvent.click(signOutButton());
      expect(signOutButton()).toBeDisabled();

      finishSignOut({ error: null });
      await waitFor(() => expect(mockReplace).toHaveBeenCalledTimes(1));
      expect(mockSignOut).toHaveBeenCalledTimes(1);
    });

    it("only signs out once when clicked twice before the button re-renders as disabled", async () => {
      let finishSignOut: (value: { error: null }) => void = () => {};
      mockSignOut.mockReturnValue(
        new Promise((resolve) => {
          finishSignOut = resolve;
        }),
      );
      signIn(profileWithRole("analyst"));
      render(<Sidebar />);

      // Both clicks land inside one act, so React cannot re-render between them.
      const button = signOutButton();
      act(() => {
        button.click();
        button.click();
      });
      expect(mockSignOut).toHaveBeenCalledTimes(1);

      finishSignOut({ error: null });
      await waitFor(() => expect(mockReplace).toHaveBeenCalledTimes(1));
    });

    it("still goes to the login page when the server call fails", async () => {
      // auth-js clears the local session before returning a network error.
      const consoleError = jest.spyOn(console, "error").mockImplementation(() => {});
      mockSignOut.mockResolvedValue({ error: { name: "AuthRetryableFetchError", status: 0 } });
      signIn(profileWithRole("analyst"));
      render(<Sidebar />);

      await userEvent.click(signOutButton());

      await waitFor(() => expect(mockReplace).toHaveBeenCalledWith("/login"));
      expect(mockRefresh).toHaveBeenCalled();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      consoleError.mockRestore();
    });

    it("stays on the page and lets the user retry when signing out throws", async () => {
      const consoleError = jest.spyOn(console, "error").mockImplementation(() => {});
      mockSignOut.mockRejectedValueOnce(new Error("lock timeout"));
      signIn(profileWithRole("analyst"));
      render(<Sidebar />);

      await userEvent.click(signOutButton());

      expect(await screen.findByRole("alert")).toHaveTextContent(/couldn't sign out/i);
      expect(mockReplace).not.toHaveBeenCalled();
      expect(signOutButton()).toBeEnabled();

      await userEvent.click(signOutButton());

      await waitFor(() => expect(mockReplace).toHaveBeenCalledWith("/login"));
      expect(mockSignOut).toHaveBeenCalledTimes(2);
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      consoleError.mockRestore();
    });
  });

  describe("admin links", () => {
    it("are shown, and Home goes to /admin, for an admin", () => {
      signIn(profileWithRole("admin"));
      render(<Sidebar />);

      expect(screen.getByRole("link", { name: "Admin Dashboard" })).toHaveAttribute(
        "href",
        "/admin",
      );
      expect(screen.getByRole("link", { name: "Users" })).toHaveAttribute("href", "/admin/users");
      expect(screen.getByRole("link", { name: "Home" })).toHaveAttribute("href", "/admin");
    });

    it.each<UserRole>(["analyst", "approver"])("are hidden for an %s", (role) => {
      signIn(profileWithRole(role));
      render(<Sidebar />);

      expect(screen.queryByRole("link", { name: "Admin Dashboard" })).not.toBeInTheDocument();
      expect(screen.queryByRole("link", { name: "Users" })).not.toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Home" })).toHaveAttribute("href", "/");
    });

    it("are hidden when the profile could not be loaded", () => {
      signIn(null);
      render(<Sidebar />);

      expect(screen.queryByRole("link", { name: "Admin Dashboard" })).not.toBeInTheDocument();
      expect(screen.queryByRole("link", { name: "Users" })).not.toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Home" })).toHaveAttribute("href", "/");
      expect(screen.getByRole("link", { name: "Invoices" })).toHaveAttribute("href", "/dashboard");
    });
  });
});
