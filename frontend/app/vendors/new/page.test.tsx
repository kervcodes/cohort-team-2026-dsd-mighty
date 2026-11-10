import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useAuth } from "@/auth/AuthProvider";
import { createVendor } from "@/lib/api/vendors";
import NewVendorPage from "./page";

const push = jest.fn();

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

jest.mock("@/auth/AuthProvider", () => ({
  useAuth: jest.fn(),
}));

jest.mock("@/lib/api/vendors", () => ({
  ...jest.requireActual("@/lib/api/vendors"),
  createVendor: jest.fn(),
}));

const mockUseAuth = useAuth as jest.Mock;
const mockCreateVendor = createVendor as jest.Mock;

function signInAs(role: "admin" | "analyst" | "approver") {
  mockUseAuth.mockReturnValue({ profile: { role, status: "active" }, loading: false });
}

describe("NewVendorPage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("creates the vendor and returns to the list", async () => {
    signInAs("admin");
    mockCreateVendor.mockResolvedValue({ id: "vendor-1" });
    render(<NewVendorPage />);

    await userEvent.type(screen.getByLabelText("Vendor name"), "  Acme Water ");
    await userEvent.type(screen.getByLabelText("Contact email"), "ap@acme.example");
    await userEvent.selectOptions(screen.getByLabelText("Default payment method"), "ach");
    await userEvent.click(screen.getByRole("button", { name: "Add vendor" }));

    // Trimmed, and the empty phone is left out rather than sent as "".
    expect(mockCreateVendor).toHaveBeenCalledWith({
      name: "Acme Water",
      contact_email: "ap@acme.example",
      default_payment_method: "ach",
    });
    expect(push).toHaveBeenCalledWith("/vendors");
    expect(screen.getByLabelText("Vendor name")).toHaveValue("");
  });

  it("shows field errors and does not submit an invalid form", async () => {
    signInAs("admin");
    render(<NewVendorPage />);

    await userEvent.type(screen.getByLabelText("Contact email"), "not-an-email");
    await userEvent.click(screen.getByRole("button", { name: "Add vendor" }));

    expect(await screen.findByText("Vendor name is required")).toBeInTheDocument();
    expect(screen.getByText("Enter a valid email address")).toBeInTheDocument();
    expect(mockCreateVendor).not.toHaveBeenCalled();
  });

  it("stays on the form and shows the error when the API fails", async () => {
    signInAs("admin");
    mockCreateVendor.mockRejectedValue(new Error("Your role can't do this."));
    render(<NewVendorPage />);

    await userEvent.type(screen.getByLabelText("Vendor name"), "Acme Water");
    await userEvent.click(screen.getByRole("button", { name: "Add vendor" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Your role can't do this.");
    expect(push).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Vendor name")).toHaveValue("Acme Water");
  });

  it.each(["analyst", "approver"] as const)("does not show the form to the %s role", (role) => {
    signInAs(role);
    render(<NewVendorPage />);

    expect(screen.getByText("Only admins can add vendors.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to vendors" })).toHaveAttribute(
      "href",
      "/vendors",
    );
    expect(screen.queryByLabelText("Vendor name")).not.toBeInTheDocument();
  });

  it("shows a loading state while the account loads", () => {
    mockUseAuth.mockReturnValue({ profile: null, loading: true });
    render(<NewVendorPage />);

    expect(screen.getByRole("status")).toHaveTextContent("Loading...");
    expect(screen.queryByLabelText("Vendor name")).not.toBeInTheDocument();
  });
});
