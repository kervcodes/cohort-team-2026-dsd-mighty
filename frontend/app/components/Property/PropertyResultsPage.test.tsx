import { render, screen } from "@testing-library/react";
import { useAuth } from "@/auth/AuthProvider";
import type { Property } from "@/types/property";
import PropertyResultsPage from "./PropertyResultsPage";

jest.mock("@/auth/AuthProvider", () => ({
  useAuth: jest.fn(),
}));

const mockUseAuth = useAuth as jest.Mock;

function createProperty(overrides: Partial<Property> = {}): Property {
  return {
    property_id: "123456789011",
    property_name: "Test Property",
    street: "123 Main Street",
    city: "New York",
    state: "NY",
    zip_code: "10001",
    created_at: "2026-11-05T14:03:22+00:00",
    status: "active",
    ...overrides,
  } as Property;
}

describe("PropertyResultsPage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders the Properties page heading", () => {
    mockUseAuth.mockReturnValue({
      profile: { role: "admin" },
      loading: false,
    });

    render(<PropertyResultsPage properties={[]} />);

    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "Properties",
      }),
    ).toBeInTheDocument();
  });

  it("displays the Add Property CTA for admins", () => {
    mockUseAuth.mockReturnValue({
      profile: { role: "admin" },
      loading: false,
    });

    render(<PropertyResultsPage properties={[]} />);

    const link = screen.getByRole("link", {
      name: "Add Property",
    });

    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute("href", "/properties/new");
  });

  it("does not display the Add Property CTA for analysts", () => {
    mockUseAuth.mockReturnValue({
      profile: { role: "analyst" },
      loading: false,
    });

    render(<PropertyResultsPage properties={[]} />);

    expect(screen.queryByRole("link", { name: "Add Property" })).not.toBeInTheDocument();
  });

  it("does not display the Add Property CTA for approvers", () => {
    mockUseAuth.mockReturnValue({
      profile: { role: "approver" },
      loading: false,
    });

    render(<PropertyResultsPage properties={[]} />);

    expect(screen.queryByRole("link", { name: "Add Property" })).not.toBeInTheDocument();
  });

  it("displays a loading message while authentication is loading", () => {
    mockUseAuth.mockReturnValue({
      profile: null,
      loading: true,
    });

    render(<PropertyResultsPage properties={[]} />);

    expect(screen.getByText("Loading properties...")).toBeInTheDocument();
  });

  it("does not display the Add Property CTA while authentication is loading", () => {
    mockUseAuth.mockReturnValue({
      profile: { role: "admin" },
      loading: true,
    });

    render(<PropertyResultsPage properties={[]} />);

    expect(screen.queryByRole("link", { name: "Add Property" })).not.toBeInTheDocument();
  });

  it("does not render the property table while authentication is loading", () => {
    mockUseAuth.mockReturnValue({
      profile: null,
      loading: true,
    });

    render(<PropertyResultsPage properties={[]} />);

    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("renders the property table after authentication finishes loading", () => {
    mockUseAuth.mockReturnValue({
      profile: { role: "admin" },
      loading: false,
    });

    render(<PropertyResultsPage properties={[]} />);

    expect(screen.getByRole("table")).toBeInTheDocument();
  });

  it("passes and displays the supplied properties", () => {
    mockUseAuth.mockReturnValue({
      profile: { role: "admin" },
      loading: false,
    });

    const properties = [
      createProperty({
        property_name: "Office Building",
      }),
      createProperty({
        property_id: "123456789012",
        property_name: "Apartment Complex",
      }),
    ];

    render(<PropertyResultsPage properties={properties} />);

    expect(screen.getByText("Office Building")).toBeInTheDocument();
    expect(screen.getByText("Apartment Complex")).toBeInTheDocument();
  });

  it("displays the admin empty state for an admin user", () => {
    mockUseAuth.mockReturnValue({
      profile: { role: "admin" },
      loading: false,
    });

    render(<PropertyResultsPage properties={[]} />);

    expect(
      screen.getByText('No properties yet. Click "Add Property" to add one.'),
    ).toBeInTheDocument();
  });

  it("displays the non-admin empty state for users without a profile", () => {
    mockUseAuth.mockReturnValue({
      profile: null,
      loading: false,
    });

    render(<PropertyResultsPage properties={[]} />);

    expect(screen.getByText("Admin needs to add a Property")).toBeInTheDocument();
  });
});
