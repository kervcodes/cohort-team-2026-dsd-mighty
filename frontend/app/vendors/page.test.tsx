import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useAuth } from "@/auth/AuthProvider";
import { listVendors, type Vendor } from "@/lib/api/vendors";
import VendorsPage from "./page";

jest.mock("@/auth/AuthProvider", () => ({
  useAuth: jest.fn(),
}));

jest.mock("@/lib/api/vendors", () => ({
  ...jest.requireActual("@/lib/api/vendors"),
  listVendors: jest.fn(),
}));

const mockUseAuth = useAuth as jest.Mock;
const mockListVendors = listVendors as jest.Mock;

function vendor(overrides: Partial<Vendor> = {}): Vendor {
  return {
    id: "vendor-1",
    name: "Acme Water",
    contact_email: "ap@acme.example",
    contact_phone: "555-0100",
    default_payment_method: "credit_card",
    created_at: "2026-11-05T12:00:00+00:00",
    ...overrides,
  };
}

function signInAs(role: "admin" | "analyst" | "approver" | null, loading = false) {
  mockUseAuth.mockReturnValue({
    profile: role ? { role, status: "active" } : null,
    loading,
  });
}

describe("VendorsPage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockListVendors.mockResolvedValue([]);
  });

  describe("Add Vendor button", () => {
    it("is shown to admins and links to /vendors/new", async () => {
      signInAs("admin");
      render(<VendorsPage />);

      const link = screen.getByRole("link", { name: "Add Vendor" });
      expect(link).toHaveAttribute("href", "/vendors/new");
      await screen.findByText(/No vendors yet/);
    });

    it.each(["analyst", "approver"] as const)("is not shown to the %s role", async (role) => {
      signInAs(role);
      render(<VendorsPage />);

      await screen.findByText("No vendors yet.");
      expect(screen.queryByRole("link", { name: "Add Vendor" })).not.toBeInTheDocument();
    });

    it("is not shown without a profile", async () => {
      signInAs(null);
      render(<VendorsPage />);

      await screen.findByText("No vendors yet.");
      expect(screen.queryByRole("link", { name: "Add Vendor" })).not.toBeInTheDocument();
    });

    it("is not shown while the account is still loading", async () => {
      mockUseAuth.mockReturnValue({ profile: { role: "admin" }, loading: true });
      render(<VendorsPage />);

      await screen.findByText("No vendors yet.");
      expect(screen.queryByRole("link", { name: "Add Vendor" })).not.toBeInTheDocument();
    });
  });

  it("renders the heading", async () => {
    signInAs("analyst");
    render(<VendorsPage />);

    expect(screen.getByRole("heading", { level: 1, name: "Vendors" })).toBeInTheDocument();
    await screen.findByText("No vendors yet.");
  });

  it("shows a loading state until the vendors arrive", async () => {
    signInAs("analyst");
    mockListVendors.mockReturnValue(new Promise(() => {}));
    render(<VendorsPage />);

    expect(screen.getByRole("status")).toHaveTextContent("Loading vendors...");
  });

  it("lists the vendors in the table", async () => {
    signInAs("analyst");
    mockListVendors.mockResolvedValue([
      vendor(),
      vendor({
        id: "vendor-2",
        name: "Zeta Power",
        contact_email: null,
        contact_phone: null,
        default_payment_method: null,
      }),
    ]);
    render(<VendorsPage />);

    const acme = (await screen.findByRole("cell", { name: "Acme Water" })).closest("tr");
    expect(acme).not.toBeNull();
    const cells = within(acme as HTMLElement);
    expect(cells.getByText("ap@acme.example")).toBeInTheDocument();
    expect(cells.getByText("555-0100")).toBeInTheDocument();
    expect(cells.getByText("Credit card")).toBeInTheDocument();
    expect(cells.getByText("Nov 5, 2026")).toBeInTheDocument();

    const zeta = screen.getByRole("cell", { name: "Zeta Power" }).closest("tr");
    expect(within(zeta as HTMLElement).getAllByText("—")).toHaveLength(3);
  });

  it("tells admins how to add the first vendor when the list is empty", async () => {
    signInAs("admin");
    render(<VendorsPage />);

    expect(
      await screen.findByText('No vendors yet. Click "Add Vendor" to add one.'),
    ).toBeInTheDocument();
  });

  it("shows the error and loads again on retry", async () => {
    signInAs("analyst");
    mockListVendors
      .mockRejectedValueOnce(new Error("Unable to reach the server."))
      .mockResolvedValueOnce([vendor()]);
    render(<VendorsPage />);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Unable to reach the server.");

    await userEvent.click(within(alert).getByRole("button", { name: "Try again" }));

    expect(await screen.findByRole("cell", { name: "Acme Water" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(mockListVendors).toHaveBeenCalledTimes(2);
  });

  it("loads the vendors again when the page is shown again", async () => {
    // Next.js re-runs the page's effects when you come back from /vendors/new,
    // which is how a new vendor appears without a manual refresh.
    signInAs("admin");
    mockListVendors
      .mockResolvedValueOnce([vendor()])
      .mockResolvedValueOnce([vendor(), vendor({ id: "vendor-2", name: "Brand New Vendor" })]);
    const { unmount } = render(<VendorsPage />);
    await screen.findByRole("cell", { name: "Acme Water" });
    unmount();

    render(<VendorsPage />);

    expect(await screen.findByRole("cell", { name: "Brand New Vendor" })).toBeInTheDocument();
    expect(mockListVendors).toHaveBeenCalledTimes(2);
  });
});
