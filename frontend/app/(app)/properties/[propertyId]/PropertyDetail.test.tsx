import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useAuth } from "@/auth/AuthProvider";
import { getProperty, type PropertyRead, updateProperty } from "@/lib/api/properties";
import { lookUpVendorAccounts } from "@/lib/api/vendor-account-lookup";
import PropertyDetail from "./PropertyDetail";

jest.mock("next/navigation", () => ({
  useParams: () => ({ propertyId: "property-1" }),
}));

jest.mock("@/auth/AuthProvider", () => ({
  useAuth: jest.fn(),
}));

jest.mock("@/lib/api/properties", () => ({
  getProperty: jest.fn(),
  updateProperty: jest.fn(),
}));

jest.mock("@/lib/api/vendor-account-lookup", () => ({
  lookUpVendorAccounts: jest.fn(),
}));

const mockUseAuth = useAuth as jest.Mock;
const mockGetProperty = getProperty as jest.Mock;
const mockUpdateProperty = updateProperty as jest.Mock;
const mockLookUp = lookUpVendorAccounts as jest.Mock;

function signInAs(role: "admin" | "analyst" | "approver") {
  mockUseAuth.mockReturnValue({ profile: { role, status: "active" }, loading: false });
}

const OAK: PropertyRead = {
  id: "property-1",
  property_name: "Oak Row",
  address: { street: "40 Oak Row", city: "Dallas", state: "TX", zip_code: "75201" },
  status: "active",
  created_at: "2026-11-05T14:03:22Z",
};

function account(id: string, propertyId: string) {
  return {
    id,
    account_number: id,
    vendor_id: "vendor-1",
    vendor_name: "Acme",
    property_id: propertyId,
    property_name: "x",
  };
}

describe("PropertyDetail", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetProperty.mockResolvedValue(OAK);
    mockLookUp.mockResolvedValue([]);
  });

  it("shows the property's name, address, status and date", async () => {
    signInAs("analyst");
    render(<PropertyDetail />);

    expect(await screen.findByRole("heading", { level: 1, name: "Oak Row" })).toBeInTheDocument();
    expect(mockGetProperty).toHaveBeenCalledWith("property-1");
    expect(screen.getByText("40 Oak Row")).toBeInTheDocument();
    expect(screen.getByText("Dallas, TX 75201")).toBeInTheDocument();
    expect(screen.getByText("active")).toBeInTheDocument();
    expect(screen.getByText("Nov 5, 2026")).toBeInTheDocument();
  });

  it("gives analysts and approvers no edit or status controls", async () => {
    signInAs("approver");
    render(<PropertyDetail />);

    await screen.findByRole("heading", { level: 1, name: "Oak Row" });
    expect(screen.queryByRole("link", { name: "Edit" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Deactivate" })).not.toBeInTheDocument();
  });

  it("gives admins an edit link", async () => {
    signInAs("admin");
    render(<PropertyDetail />);

    expect(await screen.findByRole("link", { name: "Edit" })).toHaveAttribute(
      "href",
      "/properties/property-1/edit",
    );
  });

  it("asks before deactivating, naming the active accounts that use it", async () => {
    signInAs("admin");
    mockLookUp.mockResolvedValue([
      account("a1", "property-1"),
      account("a2", "property-1"),
      account("a3", "property-2"),
    ]);
    mockUpdateProperty.mockResolvedValue({ ...OAK, status: "inactive" });
    render(<PropertyDetail />);

    await userEvent.click(await screen.findByRole("button", { name: "Deactivate" }));

    expect(screen.getByRole("heading", { name: "Deactivate Oak Row?" })).toBeInTheDocument();
    expect(screen.getByText("2 active vendor accounts use this property.")).toBeInTheDocument();
    expect(mockUpdateProperty).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "Deactivate property" }));

    expect(mockUpdateProperty).toHaveBeenCalledWith("property-1", { status: "inactive" });
    expect(await screen.findByRole("status")).toHaveTextContent("Property deactivated.");
    expect(screen.getByText("inactive")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reactivate" })).toBeInTheDocument();
  });

  it("leaves the property active when the admin cancels", async () => {
    signInAs("admin");
    render(<PropertyDetail />);

    await userEvent.click(await screen.findByRole("button", { name: "Deactivate" }));
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(mockUpdateProperty).not.toHaveBeenCalled();
    expect(screen.queryByRole("heading", { name: "Deactivate Oak Row?" })).not.toBeInTheDocument();
  });

  it("still lets an admin deactivate when the accounts can't be counted", async () => {
    signInAs("admin");
    mockLookUp.mockRejectedValue(new Error("offline"));
    render(<PropertyDetail />);

    await userEvent.click(await screen.findByRole("button", { name: "Deactivate" }));

    expect(screen.queryByText(/active vendor account/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Deactivate property" })).toBeEnabled();
  });

  it("reactivates an inactive property", async () => {
    signInAs("admin");
    mockGetProperty.mockResolvedValue({ ...OAK, status: "inactive" });
    mockUpdateProperty.mockResolvedValue(OAK);
    render(<PropertyDetail />);

    await userEvent.click(await screen.findByRole("button", { name: "Reactivate" }));

    expect(mockUpdateProperty).toHaveBeenCalledWith("property-1", { status: "active" });
    expect(await screen.findByRole("status")).toHaveTextContent("Property reactivated.");
  });

  it("shows the server's reason when the status change fails", async () => {
    signInAs("admin");
    mockUpdateProperty.mockRejectedValue(new Error("Your role can't do this."));
    render(<PropertyDetail />);

    await userEvent.click(await screen.findByRole("button", { name: "Deactivate" }));
    await userEvent.click(screen.getByRole("button", { name: "Deactivate property" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Your role can't do this.");
    expect(screen.getByText("active")).toBeInTheDocument();
  });

  it("shows a load error and retries", async () => {
    signInAs("analyst");
    mockGetProperty.mockRejectedValueOnce(new Error("Property not found."));
    render(<PropertyDetail />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Property not found.");

    await userEvent.click(screen.getByRole("button", { name: "Try again" }));

    await waitFor(() => expect(mockGetProperty).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole("heading", { level: 1, name: "Oak Row" })).toBeInTheDocument();
  });
});
