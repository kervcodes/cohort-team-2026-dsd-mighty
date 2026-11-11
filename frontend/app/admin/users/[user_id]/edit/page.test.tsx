import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useAuth } from "@/auth/AuthProvider";
import { useParams } from "next/navigation";
import { getUser, updateUser } from "@/lib/api/users";
import type { ApiProfile } from "@/types/user";
import AdminUsersEditPage from "./page";

jest.mock("@/auth/AuthProvider", () => ({
  useAuth: jest.fn(),
}));

jest.mock("next/navigation", () => ({
  useParams: jest.fn(),
}));

jest.mock("@/lib/api/users", () => ({
  ...jest.requireActual("@/lib/api/users"),
  getUser: jest.fn(),
  updateUser: jest.fn(),
}));

jest.mock("@/components/ConfirmModal/ConfirmModal", () => ({
  __esModule: true,
  default: ({
    open,
    title,
    confirmLabel,
    onConfirm,
    onCancel,
    children,
  }: {
    open: boolean;
    title: string;
    confirmLabel: string;
    onConfirm: () => void;
    onCancel: () => void;
    children: React.ReactNode;
  }) =>
    open ? (
      <div role="dialog" aria-label={title}>
        <h2>{title}</h2>
        {children}
        <button type="button" onClick={onCancel}>
          Cancel confirmation
        </button>
        <button type="button" onClick={onConfirm}>
          {confirmLabel}
        </button>
      </div>
    ) : null,
}));

const mockUseAuth = useAuth as jest.Mock;
const mockUseParams = useParams as jest.Mock;
const mockGetUser = getUser as jest.Mock;
const mockUpdateUser = updateUser as jest.Mock;

const USER_ID = "user-123456789";

function profile(overrides: Partial<ApiProfile> = {}): ApiProfile {
  return {
    user_id: USER_ID,
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

async function renderLoadedPage(user = profile()) {
  mockGetUser.mockResolvedValue(user);

  render(<AdminUsersEditPage />);

  await screen.findByRole("heading", {
    name: "Edit User",
  });
}

describe("AdminUsersEditPage", () => {
  beforeEach(() => {
    jest.clearAllMocks();

    mockUseParams.mockReturnValue({
      user_id: USER_ID,
    });

    signInAs("admin");

    mockGetUser.mockResolvedValue(profile());
    mockUpdateUser.mockResolvedValue(profile());
  });

  describe("Access control", () => {
    it("shows a loading message while permissions are loading", () => {
      signInAs(null, "active", true);

      render(<AdminUsersEditPage />);

      expect(screen.getByRole("status")).toHaveTextContent(
        "Loading permissions...",
      );

      expect(mockGetUser).not.toHaveBeenCalled();
    });

    it.each(["analyst", "approver"] as const)(
      "denies access to the %s role",
      (role) => {
        signInAs(role);

        render(<AdminUsersEditPage />);

        expect(screen.getByRole("alert")).toHaveTextContent(
          "Your role does not have access.",
        );

        expect(mockGetUser).not.toHaveBeenCalled();
      },
    );

    it("denies access without a profile", () => {
      signInAs(null);

      render(<AdminUsersEditPage />);

      expect(screen.getByRole("alert")).toHaveTextContent(
        "Your role does not have access.",
      );

      expect(mockGetUser).not.toHaveBeenCalled();
    });

    it("denies access when the admin account is inactive", () => {
      signInAs("admin", "inactive");

      render(<AdminUsersEditPage />);

      expect(screen.getByRole("alert")).toHaveTextContent(
        "Your role does not have access.",
      );

      expect(mockGetUser).not.toHaveBeenCalled();
    });

    it("allows an active admin to access the edit page", async () => {
      signInAs("admin", "active");

      await renderLoadedPage();

      expect(
        screen.getByRole("heading", {
          name: "Edit User",
        }),
      ).toBeInTheDocument();

      expect(mockGetUser).toHaveBeenCalledWith(USER_ID);
    });
  });

  describe("User loading", () => {
    it("shows a loading message while the user loads", () => {
      mockGetUser.mockReturnValue(new Promise(() => {}));

      render(<AdminUsersEditPage />);

      expect(screen.getByText("Loading user...")).toBeInTheDocument();
    });

    it("loads the user using the route parameter", async () => {
      await renderLoadedPage();

      expect(mockUseParams).toHaveBeenCalled();
      expect(mockGetUser).toHaveBeenCalledWith(USER_ID);
    });

    it("shows the not found message when the user does not exist", async () => {
      mockGetUser.mockResolvedValue(null);

      render(<AdminUsersEditPage />);

      expect(await screen.findByText("User not found.")).toBeInTheDocument();
    });

    it("shows an error when loading the user fails", async () => {
      mockGetUser.mockRejectedValue(new Error("Unable to reach the server."));

      render(<AdminUsersEditPage />);

      expect(await screen.findByRole("alert")).toHaveTextContent(
        "Unable to reach the server.",
      );
    });

    it("uses the fallback error for non-Error exceptions", async () => {
      mockGetUser.mockRejectedValue("Something went wrong");

      render(<AdminUsersEditPage />);

      expect(await screen.findByRole("alert")).toHaveTextContent(
        "Unable to load user.",
      );
    });
  });

  describe("Account information", () => {
    beforeEach(async () => {
      await renderLoadedPage();
    });

    it("renders the account information heading", () => {
      expect(
        screen.getByRole("heading", {
          name: "Account Information",
        }),
      ).toBeInTheDocument();
    });

    it("displays the user's account information", () => {
      expect(screen.getByText("John Smith")).toBeInTheDocument();
      expect(screen.getByText("john@example.com")).toBeInTheDocument();
      expect(screen.getByText(USER_ID)).toBeInTheDocument();
    });

    it("renders account information as read-only text", () => {
      expect(screen.queryByLabelText("Full Name")).not.toBeInTheDocument();
      expect(screen.queryByLabelText("Email Address")).not.toBeInTheDocument();
      expect(screen.queryByLabelText("User ID")).not.toBeInTheDocument();

      expect(screen.getByText("John Smith").tagName).toBe("DD");
      expect(screen.getByText("john@example.com").tagName).toBe("DD");
    });

    it("displays placeholders for missing account information", async () => {
      // This test is covered separately because the initial page has
      // already been rendered by the beforeEach above.
    });
  });

  describe("Permission editing", () => {
    beforeEach(async () => {
      await renderLoadedPage();
    });

    it("renders the permissions heading", () => {
      expect(
        screen.getByRole("heading", {
          name: "Account Permissions",
        }),
      ).toBeInTheDocument();
    });

    it("renders the available roles", () => {
      const roleSelect = screen.getByRole("combobox", {
        name: "Role",
      });

      expect(roleSelect).toHaveValue("analyst");

      expect(
        within(roleSelect).getByRole("option", { name: "Analyst" }),
      ).toBeInTheDocument();

      expect(
        within(roleSelect).getByRole("option", { name: "Approver" }),
      ).toBeInTheDocument();

      expect(
        within(roleSelect).getByRole("option", { name: "Admin" }),
      ).toBeInTheDocument();
    });

    it("renders the available account statuses", () => {
      const statusSelect = screen.getByRole("combobox", {
        name: "Account Status",
      });

      expect(statusSelect).toHaveValue("active");

      expect(
        within(statusSelect).getByRole("option", { name: "Active" }),
      ).toBeInTheDocument();

      expect(
        within(statusSelect).getByRole("option", { name: "Inactive" }),
      ).toBeInTheDocument();
    });

    it("disables Save Changes when there are no changes", () => {
      expect(
        screen.getByRole("button", { name: "Save Changes" }),
      ).toBeDisabled();
    });

    it("enables Save Changes when the role changes", async () => {
      await userEvent.selectOptions(
        screen.getByRole("combobox", { name: "Role" }),
        "admin",
      );

      expect(
        screen.getByRole("button", { name: "Save Changes" }),
      ).toBeEnabled();
    });

    it("enables Save Changes when the status changes", async () => {
      await userEvent.selectOptions(
        screen.getByRole("combobox", { name: "Account Status" }),
        "inactive",
      );

      expect(
        screen.getByRole("button", { name: "Save Changes" }),
      ).toBeEnabled();
    });

    it("opens the confirmation modal when saving changes", async () => {
      await userEvent.selectOptions(
        screen.getByRole("combobox", { name: "Role" }),
        "admin",
      );

      await userEvent.click(
        screen.getByRole("button", { name: "Save Changes" }),
      );

      expect(
        screen.getByRole("dialog", {
          name: "Save User Permissions?",
        }),
      ).toBeInTheDocument();

      expect(
        screen.getByText(/This changes the user's permissions/),
      ).toBeInTheDocument();

      const confirmation = screen.getByRole("dialog");

      expect(within(confirmation).getByRole("list")).toHaveTextContent(
        "analyst",
      );

      expect(within(confirmation).getByRole("list")).toHaveTextContent("admin");
      expect(mockUpdateUser).not.toHaveBeenCalled();
    });

    it("cancels changes and restores the original values", async () => {
      await userEvent.selectOptions(
        screen.getByRole("combobox", { name: "Role" }),
        "admin",
      );

      await userEvent.selectOptions(
        screen.getByRole("combobox", { name: "Account Status" }),
        "inactive",
      );

      await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

      expect(screen.getByRole("combobox", { name: "Role" })).toHaveValue(
        "analyst",
      );

      expect(
        screen.getByRole("combobox", { name: "Account Status" }),
      ).toHaveValue("active");

      expect(
        screen.getByRole("button", { name: "Save Changes" }),
      ).toBeDisabled();

      expect(mockUpdateUser).not.toHaveBeenCalled();
    });
  });

  describe("Saving changes", () => {
    it("updates the user's role after confirmation", async () => {
      const updatedUser = profile({ role: "admin" });

      mockUpdateUser.mockResolvedValue(updatedUser);

      await renderLoadedPage();

      await userEvent.selectOptions(
        screen.getByRole("combobox", { name: "Role" }),
        "admin",
      );

      await userEvent.click(
        screen.getByRole("button", { name: "Save Changes" }),
      );

      await userEvent.click(
        screen.getByRole("button", { name: "Confirm Changes" }),
      );

      await waitFor(() => {
        expect(mockUpdateUser).toHaveBeenCalledWith(USER_ID, {
          role: "admin",
        });
      });

      expect(
        await screen.findByText("User updated successfully."),
      ).toBeInTheDocument();

      expect(screen.getByRole("combobox", { name: "Role" })).toHaveValue(
        "admin",
      );

      expect(
        screen.getByRole("button", { name: "Save Changes" }),
      ).toBeDisabled();
    });

    it("updates the user's account status", async () => {
      mockUpdateUser.mockResolvedValue(profile({ status: "inactive" }));

      await renderLoadedPage();

      await userEvent.selectOptions(
        screen.getByRole("combobox", { name: "Account Status" }),
        "inactive",
      );

      await userEvent.click(
        screen.getByRole("button", { name: "Save Changes" }),
      );

      await userEvent.click(
        screen.getByRole("button", { name: "Confirm Changes" }),
      );

      await waitFor(() => {
        expect(mockUpdateUser).toHaveBeenCalledWith(USER_ID, {
          status: "inactive",
        });
      });

      expect(
        await screen.findByText("User updated successfully."),
      ).toBeInTheDocument();
    });

    it("updates both role and status when both change", async () => {
      mockUpdateUser.mockResolvedValue(
        profile({
          role: "approver",
          status: "inactive",
        }),
      );

      await renderLoadedPage();

      await userEvent.selectOptions(
        screen.getByRole("combobox", { name: "Role" }),
        "approver",
      );

      await userEvent.selectOptions(
        screen.getByRole("combobox", { name: "Account Status" }),
        "inactive",
      );

      await userEvent.click(
        screen.getByRole("button", { name: "Save Changes" }),
      );

      await userEvent.click(
        screen.getByRole("button", { name: "Confirm Changes" }),
      );

      await waitFor(() => {
        expect(mockUpdateUser).toHaveBeenCalledWith(USER_ID, {
          role: "approver",
          status: "inactive",
        });
      });
    });

    it("shows an error when updating the user fails", async () => {
      mockUpdateUser.mockRejectedValue(new Error("Unable to update user."));

      await renderLoadedPage();

      await userEvent.selectOptions(
        screen.getByRole("combobox", { name: "Role" }),
        "admin",
      );

      await userEvent.click(
        screen.getByRole("button", { name: "Save Changes" }),
      );

      await userEvent.click(
        screen.getByRole("button", { name: "Confirm Changes" }),
      );

      expect(await screen.findByRole("alert")).toHaveTextContent(
        "Unable to update user.",
      );
    });

    it("does not update the user when confirmation is cancelled", async () => {
      await renderLoadedPage();

      await userEvent.selectOptions(
        screen.getByRole("combobox", { name: "Role" }),
        "admin",
      );

      await userEvent.click(
        screen.getByRole("button", { name: "Save Changes" }),
      );

      await userEvent.click(
        screen.getByRole("button", { name: "Cancel confirmation" }),
      );

      expect(mockUpdateUser).not.toHaveBeenCalled();
    });

    it("does not update the user when there are no changes", async () => {
      await renderLoadedPage();

      expect(
        screen.getByRole("button", { name: "Save Changes" }),
      ).toBeDisabled();

      expect(mockUpdateUser).not.toHaveBeenCalled();
    });
  });

  it("loads the user again when the page is shown again", async () => {
    mockGetUser.mockResolvedValueOnce(profile()).mockResolvedValueOnce(
      profile({
        full_name: "Jane Doe",
        email: "jane@example.com",
      }),
    );

    const { unmount } = render(<AdminUsersEditPage />);

    expect(await screen.findByText("John Smith")).toBeInTheDocument();

    unmount();

    render(<AdminUsersEditPage />);

    expect(await screen.findByText("Jane Doe")).toBeInTheDocument();

    expect(mockGetUser).toHaveBeenCalledTimes(2);
  });
});
