import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useParams } from "next/navigation";
import { useAuth } from "@/auth/AuthProvider";
import { ApiError } from "@/lib/api/http";
import { listAllProperties, type PropertyRead } from "@/lib/api/properties";
import {
  createVendorAccount,
  listVendorAccounts,
  updateVendorAccount,
} from "@/lib/api/vendor-accounts";
import { getVendor, type Vendor } from "@/lib/api/vendors";
import type { VendorAccount } from "@/types/vendor-account";
import VendorDetailPage from "./page";
import VendorDetail from "./VendorDetail";

jest.mock("next/navigation", () => ({
  useParams: jest.fn(),
}));

jest.mock("@/auth/AuthProvider", () => ({
  useAuth: jest.fn(),
}));

jest.mock("@/lib/api/vendors", () => ({
  ...jest.requireActual("@/lib/api/vendors"),
  getVendor: jest.fn(),
}));

jest.mock("@/lib/api/vendor-accounts", () => ({
  listVendorAccounts: jest.fn(),
  createVendorAccount: jest.fn(),
  updateVendorAccount: jest.fn(),
}));

jest.mock("@/lib/api/properties", () => ({
  ...jest.requireActual("@/lib/api/properties"),
  listAllProperties: jest.fn(),
}));

const mockUseAuth = useAuth as jest.Mock;
const mockGetVendor = getVendor as jest.Mock;
const mockListAccounts = listVendorAccounts as jest.Mock;
const mockCreateAccount = createVendorAccount as jest.Mock;
const mockUpdateAccount = updateVendorAccount as jest.Mock;
const mockListProperties = listAllProperties as jest.Mock;

const VENDOR_ID = "vendor-1";
const PASSWORD = "s3cret-portal-pass";

const vendor: Vendor = {
  id: VENDOR_ID,
  name: "Acme Water",
  contact_email: "ap@acme.example",
  contact_phone: "555-0100",
  default_payment_method: "ach",
  created_at: "2026-11-05T12:00:00+00:00",
};

function property(overrides: Partial<PropertyRead> = {}): PropertyRead {
  return {
    id: "prop-elm",
    property_name: "Elm Court",
    address: { street: "1 Main St", city: "Dallas", state: "TX", zip_code: "75201" },
    status: "active",
    ...overrides,
  };
}

const properties = [
  property(),
  property({ id: "prop-oak", property_name: "Oak Plaza" }),
  property({ id: "prop-old", property_name: "Old Mill", status: "inactive" }),
];

function account(overrides: Partial<VendorAccount> = {}): VendorAccount {
  return {
    id: "account-1",
    property_id: "prop-elm",
    vendor_id: VENDOR_ID,
    account_number: "ACC-100",
    account_type: "water",
    payment_method: "credit_card",
    portal_url: "https://portal.acme.example/",
    portal_login_email: "billing@elm.example",
    portal_password_set: true,
    status: "active",
    created_at: "2026-11-05T12:00:00+00:00",
    ...overrides,
  };
}

function signInAs(role: "admin" | "analyst" | "approver") {
  mockUseAuth.mockReturnValue({ profile: { role, status: "active" }, loading: false });
}

function row(accountNumber: string) {
  return within(screen.getByRole("cell", { name: accountNumber }).closest("tr") as HTMLElement);
}

async function renderPage() {
  render(<VendorDetail />);
  await screen.findByRole("heading", { level: 1, name: "Acme Water" });
}

async function openEdit(accountNumber: string) {
  await userEvent.click(screen.getByRole("button", { name: `Edit account ${accountNumber}` }));
  return screen.getByRole("dialog", { name: "Edit account" });
}

describe("VendorDetailPage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (useParams as jest.Mock).mockReturnValue({ vendorId: VENDOR_ID });
    mockGetVendor.mockResolvedValue(vendor);
    mockListAccounts.mockResolvedValue([account()]);
    mockListProperties.mockResolvedValue(properties);
  });

  it("shows the vendor's contact info and accounts", async () => {
    signInAs("analyst");
    mockListAccounts.mockResolvedValue([
      account(),
      account({
        id: "account-2",
        property_id: "prop-oak",
        account_number: "ACC-200",
        account_type: "sewer",
        payment_method: "check",
        portal_url: null,
        portal_login_email: null,
        portal_password_set: false,
      }),
    ]);
    await renderPage();

    expect(mockGetVendor).toHaveBeenCalledWith(VENDOR_ID);
    expect(mockListAccounts).toHaveBeenCalledWith(VENDOR_ID);
    expect(screen.getByText("ap@acme.example")).toBeInTheDocument();
    expect(screen.getByText("555-0100")).toBeInTheDocument();

    const first = row("ACC-100");
    expect(first.getByText("water")).toBeInTheDocument();
    expect(first.getByText("Elm Court")).toBeInTheDocument();
    expect(first.getByText("Credit card")).toBeInTheDocument();
    expect(first.getByText("billing@elm.example")).toBeInTheDocument();
    expect(first.getByText("Set")).toBeInTheDocument();
    const portal = first.getByRole("link", { name: "portal.acme.example" });
    expect(portal).toHaveAttribute("href", "https://portal.acme.example/");
    expect(portal).toHaveAttribute("target", "_blank");
    expect(portal).toHaveAttribute("rel", "noopener noreferrer");

    const second = row("ACC-200");
    expect(second.getByText("Oak Plaza")).toBeInTheDocument();
    expect(second.getByText("Check")).toBeInTheDocument();
    expect(second.getByText("Not set")).toBeInTheDocument();
    expect(second.getAllByText("-")).toHaveLength(2);
  });

  it("renders inside the page under a link back to the vendors", async () => {
    signInAs("analyst");
    render(<VendorDetailPage />);

    expect(screen.getByRole("link", { name: "Back to vendors" })).toHaveAttribute(
      "href",
      "/vendors",
    );
    expect(
      await screen.findByRole("heading", { level: 1, name: "Acme Water" }),
    ).toBeInTheDocument();
  });

  it("tells admins how to add the first account", async () => {
    signInAs("admin");
    mockListAccounts.mockResolvedValue([]);
    await renderPage();

    expect(
      screen.getByText('No accounts yet. Click "Add account" to add one.'),
    ).toBeInTheDocument();
  });

  it.each(["analyst", "approver"] as const)("is read-only for the %s role", async (role) => {
    signInAs(role);
    await renderPage();

    expect(screen.getByRole("cell", { name: "ACC-100" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add account" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Edit/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "Actions" })).not.toBeInTheDocument();
  });

  it("hides the admin actions while the account is still loading", async () => {
    mockUseAuth.mockReturnValue({ profile: { role: "admin" }, loading: true });
    await renderPage();

    expect(screen.queryByRole("button", { name: "Add account" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Edit/ })).not.toBeInTheDocument();
  });

  it("shows the load error and loads again on retry", async () => {
    signInAs("analyst");
    mockGetVendor
      .mockRejectedValueOnce(new ApiError("Vendor not found.", 404))
      .mockResolvedValueOnce(vendor);
    render(<VendorDetail />);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Vendor not found.");

    await userEvent.click(within(alert).getByRole("button", { name: "Try again" }));

    expect(await screen.findByRole("heading", { name: "Acme Water" })).toBeInTheDocument();
    expect(mockGetVendor).toHaveBeenCalledTimes(2);
  });

  describe("adding an account", () => {
    beforeEach(() => {
      signInAs("admin");
      mockListAccounts.mockResolvedValue([]);
    });

    async function openAdd() {
      await renderPage();
      await userEvent.click(screen.getByRole("button", { name: "Add account" }));
      return within(screen.getByRole("dialog", { name: "Add account" }));
    }

    async function fillRequired(dialog: ReturnType<typeof within>) {
      await userEvent.selectOptions(dialog.getByLabelText("Property"), "prop-oak");
      await userEvent.type(dialog.getByLabelText("Account number"), " ACC-300 ");
      await userEvent.type(dialog.getByLabelText("Account type"), "Electric");
    }

    it("offers active properties only and starts with the vendor's payment method", async () => {
      const dialog = await openAdd();

      const options = within(dialog.getByLabelText("Property")).getAllByRole("option");
      expect(options.map((option) => option.textContent)).toEqual([
        "Choose a property",
        "Elm Court",
        "Oak Plaza",
      ]);
      expect(dialog.getByLabelText("Payment method")).toHaveValue("ach");
      expect(dialog.getByLabelText("Portal password")).toHaveValue("");
    });

    it("sends the password with the new account and never shows it", async () => {
      mockCreateAccount.mockResolvedValue(
        account({
          id: "account-3",
          property_id: "prop-oak",
          account_number: "ACC-300",
          account_type: "Electric",
          payment_method: "ach",
          portal_url: "https://pay.acme.example/",
          portal_login_email: "ops@oak.example",
          portal_password_set: true,
        }),
      );
      const dialog = await openAdd();

      await fillRequired(dialog);
      await userEvent.type(dialog.getByLabelText("Portal address"), "https://pay.acme.example");
      await userEvent.type(dialog.getByLabelText("Portal login email"), "ops@oak.example");
      const password = dialog.getByLabelText("Portal password");
      expect(password).toHaveAttribute("type", "password");
      expect(password).toHaveAttribute("autocomplete", "new-password");
      await userEvent.type(password, PASSWORD);
      await userEvent.click(dialog.getByRole("button", { name: "Add account" }));

      expect(mockCreateAccount).toHaveBeenCalledWith({
        vendor_id: VENDOR_ID,
        property_id: "prop-oak",
        account_number: "ACC-300",
        account_type: "Electric",
        payment_method: "ach",
        portal_url: "https://pay.acme.example",
        portal_login_email: "ops@oak.example",
        portal_password: PASSWORD,
      });
      expect(await screen.findByRole("status")).toHaveTextContent("Account added.");
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(row("ACC-300").getByText("Set")).toBeInTheDocument();
      expect(document.body).not.toHaveTextContent(PASSWORD);
    });

    it("leaves out the empty optional fields", async () => {
      mockCreateAccount.mockResolvedValue(account({ account_number: "ACC-300" }));
      const dialog = await openAdd();

      await fillRequired(dialog);
      await userEvent.click(dialog.getByRole("button", { name: "Add account" }));

      expect(mockCreateAccount).toHaveBeenCalledWith({
        vendor_id: VENDOR_ID,
        property_id: "prop-oak",
        account_number: "ACC-300",
        account_type: "Electric",
        payment_method: "ach",
      });
    });

    it("shows and hides the typed password", async () => {
      const dialog = await openAdd();
      const password = dialog.getByLabelText("Portal password");

      await userEvent.click(dialog.getByRole("button", { name: "Show password" }));
      expect(password).toHaveAttribute("type", "text");

      await userEvent.click(dialog.getByRole("button", { name: "Hide password" }));
      expect(password).toHaveAttribute("type", "password");
    });

    it("shows field errors and does not submit an invalid form", async () => {
      const dialog = await openAdd();

      await userEvent.type(dialog.getByLabelText("Portal address"), "portal.acme.example");
      await userEvent.type(dialog.getByLabelText("Portal login email"), "not-an-email");
      await userEvent.click(dialog.getByRole("button", { name: "Add account" }));

      expect(await dialog.findByText("Account number is required")).toBeInTheDocument();
      expect(dialog.getByLabelText("Property")).toHaveAccessibleDescription("Choose a property");
      expect(dialog.getByText("Account type is required")).toBeInTheDocument();
      expect(
        dialog.getByText("Enter the full address, like https://portal.example.com"),
      ).toBeInTheDocument();
      expect(dialog.getByText("Enter a valid email address")).toBeInTheDocument();
      expect(mockCreateAccount).not.toHaveBeenCalled();
    });

    it("explains a duplicate account number on the field", async () => {
      mockCreateAccount.mockRejectedValue(
        new ApiError("This vendor account already exists for the property.", 409),
      );
      const dialog = await openAdd();

      await fillRequired(dialog);
      await userEvent.click(dialog.getByRole("button", { name: "Add account" }));

      expect(
        await dialog.findByText("This account number is already set up for this property."),
      ).toBeInTheDocument();
      expect(dialog.getByLabelText("Account number")).toHaveAttribute("aria-invalid", "true");
      expect(dialog.getByLabelText("Account number")).toHaveFocus();
    });

    it("shows what the backend did not accept", async () => {
      mockCreateAccount.mockRejectedValue(new ApiError("Property not found.", 422));
      const dialog = await openAdd();

      await fillRequired(dialog);
      await userEvent.click(dialog.getByRole("button", { name: "Add account" }));

      expect(await dialog.findByRole("alert")).toHaveTextContent(
        "Some details were not accepted: Property not found.",
      );
    });

    it("keeps the dialog open with the error when the save fails", async () => {
      mockCreateAccount.mockRejectedValue(new Error("Unable to reach the server."));
      const dialog = await openAdd();

      await fillRequired(dialog);
      await userEvent.click(dialog.getByRole("button", { name: "Add account" }));

      expect(await dialog.findByRole("alert")).toHaveTextContent("Unable to reach the server.");
      expect(dialog.getByLabelText("Account number")).toHaveValue(" ACC-300 ");
    });

    it("closes on Cancel and on Escape without saving", async () => {
      await openAdd();

      await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

      await userEvent.click(screen.getByRole("button", { name: "Add account" }));
      await userEvent.keyboard("{Escape}");
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(mockCreateAccount).not.toHaveBeenCalled();
    });
  });

  describe("editing an account", () => {
    beforeEach(() => {
      signInAs("admin");
    });

    it("starts from the account, with an empty password field", async () => {
      await renderPage();
      const dialog = within(await openEdit("ACC-100"));

      expect(dialog.getByLabelText("Property")).toBeDisabled();
      expect(dialog.getByLabelText("Property")).toHaveValue("prop-elm");
      expect(dialog.getByLabelText("Account number")).toHaveValue("ACC-100");
      expect(dialog.getByLabelText("Payment method")).toHaveValue("credit_card");
      expect(dialog.getByLabelText("Portal address")).toHaveValue("https://portal.acme.example/");
      expect(dialog.getByLabelText("Portal password")).toHaveValue("");
      expect(dialog.getByLabelText("Portal password")).toHaveAccessibleDescription(
        /Leave blank to keep the current password\./,
      );
    });

    it("leaves the password out when the field is blank", async () => {
      mockUpdateAccount.mockResolvedValue(account({ account_type: "sewer" }));
      await renderPage();
      const dialog = within(await openEdit("ACC-100"));

      await userEvent.clear(dialog.getByLabelText("Account type"));
      await userEvent.type(dialog.getByLabelText("Account type"), "sewer");
      await userEvent.clear(dialog.getByLabelText("Portal login email"));
      await userEvent.click(dialog.getByRole("button", { name: "Save changes" }));

      expect(mockUpdateAccount).toHaveBeenCalledTimes(1);
      const [accountId, payload] = mockUpdateAccount.mock.calls[0];
      expect(accountId).toBe("account-1");
      expect(payload).toEqual({
        account_number: "ACC-100",
        account_type: "sewer",
        payment_method: "credit_card",
        portal_url: "https://portal.acme.example/",
        portal_login_email: null,
      });
      expect(payload).not.toHaveProperty("portal_password");
      expect(await screen.findByRole("status")).toHaveTextContent("Account updated.");
      expect(row("ACC-100").getByText("sewer")).toBeInTheDocument();
    });

    it("replaces the password with a typed one", async () => {
      mockUpdateAccount.mockResolvedValue(account());
      await renderPage();
      const dialog = within(await openEdit("ACC-100"));

      await userEvent.type(dialog.getByLabelText("Portal password"), PASSWORD);
      await userEvent.click(dialog.getByRole("button", { name: "Save changes" }));

      expect(mockUpdateAccount.mock.calls[0][1].portal_password).toBe(PASSWORD);
      await screen.findByText("Account updated.");
      expect(document.body).not.toHaveTextContent(PASSWORD);
    });

    it("sends null to remove the password", async () => {
      mockUpdateAccount.mockResolvedValue(account({ portal_password_set: false }));
      await renderPage();
      const dialog = within(await openEdit("ACC-100"));

      await userEvent.type(dialog.getByLabelText("Portal password"), "typed-then-dropped");
      await userEvent.click(dialog.getByRole("button", { name: "Remove password" }));

      expect(dialog.getByLabelText("Portal password")).toHaveValue("");
      expect(dialog.getByText("The password will be removed when you save.")).toBeInTheDocument();
      await userEvent.click(dialog.getByRole("button", { name: "Save changes" }));

      expect(mockUpdateAccount.mock.calls[0][1].portal_password).toBeNull();
      await screen.findByText("Account updated.");
      expect(row("ACC-100").getByText("Not set")).toBeInTheDocument();
    });

    it("can take back the removal before saving", async () => {
      mockUpdateAccount.mockResolvedValue(account());
      await renderPage();
      const dialog = within(await openEdit("ACC-100"));

      await userEvent.click(dialog.getByRole("button", { name: "Remove password" }));
      await userEvent.click(dialog.getByRole("button", { name: "Keep password" }));
      await userEvent.click(dialog.getByRole("button", { name: "Save changes" }));

      expect(mockUpdateAccount.mock.calls[0][1]).not.toHaveProperty("portal_password");
    });

    it("offers no removal when no password is set", async () => {
      mockListAccounts.mockResolvedValue([account({ portal_password_set: false })]);
      await renderPage();
      const dialog = within(await openEdit("ACC-100"));

      expect(dialog.queryByRole("button", { name: "Remove password" })).not.toBeInTheDocument();
      expect(dialog.queryByText(/Leave blank/)).not.toBeInTheDocument();
    });

    it("explains a duplicate account number on the field", async () => {
      mockUpdateAccount.mockRejectedValue(
        new ApiError("This vendor account already exists for the property.", 409),
      );
      await renderPage();
      const dialog = within(await openEdit("ACC-100"));

      await userEvent.click(dialog.getByRole("button", { name: "Save changes" }));

      expect(
        await dialog.findByText("This account number is already set up for this property."),
      ).toBeInTheDocument();
    });
  });
});
