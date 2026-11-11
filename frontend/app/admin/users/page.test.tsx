/*
/admin/users/
if analyst or approver, should not see table
only admin can see table

it is not shown without profile
it is not shown while accoutn loading
it is not shown while account status inactive

what shows on no profiles

render heading
show loading state while profiles load

lists user int table

shows the error and loads again on retry

loads user again when page is shown again



*/

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useAuth } from "@/auth/AuthProvider";
import { listUsers } from "@/lib/api/users";
import type { ApiProfile } from "@/types/user";
import AdminUsersPage from "./page";

jest.mock("@/auth/AuthProvider", () => ({
  useAuth: jest.fn(),
}));

jest.mock("@/lib/api/users", () => ({
  ...jest.requireActual("@/lib/api/users"),
  listUsers: jest.fn(),
}));

const mockUseAuth = useAuth as jest.Mock;
const mockListUsers = listUsers as jest.Mock;

function profile(overrides: Partial<ApiProfile> = {}): ApiProfile {
  return {
    user_id: "user-123456789",
    full_name: "John Smith",
    email: "john@example.com",
    role: "analyst",
    status: "active",
    ...overrides,
  };
}

function signInAs(
  role: "admin" | "analyst" | "approver" | null,
  status: "active" | "inactive" = "active",
  loading = false,
) {
  mockUseAuth.mockReturnValue({
    profile: role ? { role, status } : null,
    loading,
  });
}

describe("AdminUsersPage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockListUsers.mockResolvedValue([]);
  });

  describe("Access control", () => {
    it.each(["analyst", "approver"] as const)(
      "shows an access message for the %s role",
      (role) => {
        signInAs(role);

        render(<AdminUsersPage />);

        expect(
          screen.getByText("Your role does not have access"),
        ).toBeInTheDocument();

        expect(screen.queryByRole("table")).not.toBeInTheDocument();
        expect(mockListUsers).not.toHaveBeenCalled();
      },
    );

    it("shows an access message without a profile", () => {
      mockUseAuth.mockReturnValue({
        profile: null,
        loading: false,
      });

      render(<AdminUsersPage />);

      expect(
        screen.getByText("Your role does not have access"),
      ).toBeInTheDocument();

      expect(screen.queryByRole("table")).not.toBeInTheDocument();
      expect(mockListUsers).not.toHaveBeenCalled();
    });

    it("shows a loading message while permissions are loading", () => {
      mockUseAuth.mockReturnValue({
        profile: null,
        loading: true,
      });

      render(<AdminUsersPage />);

      expect(screen.getByText("loading permissions...")).toBeInTheDocument();
      expect(screen.queryByRole("table")).not.toBeInTheDocument();
      expect(mockListUsers).not.toHaveBeenCalled();
    });

    it("shows an access message when the account is inactive", () => {
      signInAs("admin", "inactive");

      render(<AdminUsersPage />);

      expect(
        screen.getByText("Your role does not have access"),
      ).toBeInTheDocument();

      expect(screen.queryByRole("table")).not.toBeInTheDocument();
      expect(mockListUsers).not.toHaveBeenCalled();
    });

    it("allows an active admin to see the users table", async () => {
      signInAs("admin", "active");

      mockListUsers.mockResolvedValue([]);

      render(<AdminUsersPage />);

      expect(await screen.findByRole("table")).toBeInTheDocument();
      expect(mockListUsers).toHaveBeenCalledTimes(1);
    });
  });

  describe("User table", () => {
    beforeEach(() => {
      signInAs("admin");
    });

    it("renders the heading", async () => {
      render(<AdminUsersPage />);

      expect(
        screen.getByRole("heading", {
          level: 2,
          name: "All Users",
        }),
      ).toBeInTheDocument();

      await screen.findByText("No profiles yet.");
    });

    it("renders all table column headers", async () => {
      render(<AdminUsersPage />);

      const headers = ["id", "Name", "Email", "Role", "Status"];

      for (const header of headers) {
        expect(
          await screen.findByRole("columnheader", {
            name: header,
          }),
        ).toBeInTheDocument();
      }
    });

    it("shows a loading state until the users arrive", () => {
      mockListUsers.mockReturnValue(new Promise(() => {}));

      render(<AdminUsersPage />);

      expect(screen.getByRole("status")).toHaveTextContent(
        "Loading profiles...",
      );
    });

    it("lists users in the table", async () => {
      mockListUsers.mockResolvedValue([
        profile(),
        profile({
          user_id: "user-987654321",
          full_name: "Jane Doe",
          email: "jane@example.com",
          role: "approver",
          status: "inactive",
        }),
      ]);

      render(<AdminUsersPage />);

      const john = await screen.findByRole("cell", {
        name: "John Smith",
      });

      const johnRow = john.closest("tr");
      expect(johnRow).not.toBeNull();

      const johnCells = within(johnRow as HTMLElement);

      expect(johnCells.getByText("john@example.com")).toBeInTheDocument();

      expect(johnCells.getByText("analyst")).toBeInTheDocument();

      expect(johnCells.getByText("active")).toBeInTheDocument();

      const jane = screen.getByRole("cell", {
        name: "Jane Doe",
      });

      const janeRow = jane.closest("tr");
      expect(janeRow).not.toBeNull();

      const janeCells = within(janeRow as HTMLElement);

      expect(janeCells.getByText("jane@example.com")).toBeInTheDocument();

      expect(janeCells.getByText("approver")).toBeInTheDocument();

      expect(janeCells.getByText("inactive")).toBeInTheDocument();
    });

    it("links user IDs to their edit pages", async () => {
      mockListUsers.mockResolvedValue([profile()]);

      render(<AdminUsersPage />);

      const link = await screen.findByRole("link", {
        name: "user-123",
      });

      expect(link).toHaveAttribute("href", "/admin/users/user-123456789/edit");
    });

    it("displays a placeholder for missing user information", async () => {
      mockListUsers.mockResolvedValue([
        profile({
          full_name: undefined,
          email: undefined,
        }),
      ]);

      render(<AdminUsersPage />);

      const row = await screen.findByRole("row", {
        name: /user-123/,
      });

      expect(within(row).getAllByText("—")).toHaveLength(2);
    });

    it("shows the empty state when no profiles exist", async () => {
      mockListUsers.mockResolvedValue([]);

      render(<AdminUsersPage />);

      expect(await screen.findByText("No profiles yet.")).toBeInTheDocument();

      expect(mockListUsers).toHaveBeenCalledTimes(1);
    });
  });

  describe("Error handling", () => {
    beforeEach(() => {
      signInAs("admin");
    });

    it("shows the error and loads users again on retry", async () => {
      mockListUsers
        .mockRejectedValueOnce(new Error("Unable to reach the server."))
        .mockResolvedValueOnce([profile()]);

      render(<AdminUsersPage />);

      const alert = await screen.findByRole("alert");

      expect(alert).toHaveTextContent("Unable to reach the server.");

      await userEvent.click(
        within(alert).getByRole("button", {
          name: "Try again",
        }),
      );

      expect(
        await screen.findByRole("cell", {
          name: "John Smith",
        }),
      ).toBeInTheDocument();

      expect(screen.queryByRole("alert")).not.toBeInTheDocument();

      expect(mockListUsers).toHaveBeenCalledTimes(2);
    });

    it("uses the fallback error message for non-Error exceptions", async () => {
      mockListUsers.mockRejectedValueOnce("Something went wrong");

      render(<AdminUsersPage />);

      expect(await screen.findByRole("alert")).toHaveTextContent(
        "Unable to load profiles.",
      );
    });
  });

  it("loads users again when the page is shown again", async () => {
    signInAs("admin");

    mockListUsers.mockResolvedValueOnce([profile()]).mockResolvedValueOnce([
      profile(),
      profile({
        user_id: "user-456789123",
        full_name: "New User",
        email: "new@example.com",
      }),
    ]);

    const { unmount } = render(<AdminUsersPage />);

    await screen.findByRole("cell", {
      name: "John Smith",
    });

    unmount();

    render(<AdminUsersPage />);

    expect(
      await screen.findByRole("cell", {
        name: "New User",
      }),
    ).toBeInTheDocument();

    expect(mockListUsers).toHaveBeenCalledTimes(2);
  });
});
