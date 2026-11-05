import { render, screen, within } from "@testing-library/react";
import type { Property } from "@/types/property";
import type { UserRole } from "@/types/user";
import { PropertyTable } from "./PropertyTable";

function createProperty(overrides: Partial<Property> = {}): Property {
  return {
    property_id: "123456789012",
    property_name: "Test Property",
    street: "123 Main Street",
    city: "New York",
    state: "NY",
    zip_code: "10001",
    created_at: "2025-01-15",
    status: "active",
    ...overrides,
  } as Property;
}

describe("PropertyTable", () => {
  it("renders the table heading", () => {
    render(<PropertyTable properties={[]} userRole="admin" />);

    expect(
      screen.getByRole("heading", {
        level: 2,
        name: "Property History",
      }),
    ).toBeInTheDocument();
  });

  it("renders all table column headers", () => {
    render(<PropertyTable properties={[]} userRole="admin" />);

    const headers = [
      "Property ID",
      "Property Name",
      "Street",
      "City",
      "State",
      "Zip Code",
      "Created At",
      "Status",
    ];

    headers.forEach((header) => {
      expect(screen.getByRole("columnheader", { name: header })).toBeInTheDocument();
    });
  });

  it("renders property information correctly", () => {
    const property = createProperty();

    render(<PropertyTable properties={[property]} userRole="admin" />);

    expect(screen.getByText("12345678")).toBeInTheDocument();
    expect(screen.getByText("Test Property")).toBeInTheDocument();
    expect(screen.getByText("123 Main Street")).toBeInTheDocument();
    expect(screen.getByText("New York")).toBeInTheDocument();
    expect(screen.getByText("NY")).toBeInTheDocument();
    expect(screen.getByText("10001")).toBeInTheDocument();
  });

  it("displays the formatted creation date", () => {
    const property = createProperty({
      created_at: "2025-01-15",
    });

    render(<PropertyTable properties={[property]} userRole="admin" />);

    expect(screen.getByText("Jan 15, 2025")).toBeInTheDocument();
  });

  it("displays the property's status", () => {
    const property = createProperty({
      status: "active",
    });
    render(<PropertyTable properties={[property]} userRole="admin" />);

    const row = screen.getByRole("row", {
      name: /Test Property/,
    });

    expect(within(row).getByText("active")).toBeInTheDocument();
  });

  it("displays the admin empty state when no properties exist", () => {
    render(<PropertyTable properties={[]} userRole="admin" />);
    expect(
      screen.getByText('No properties yet. Click "New Property" to add one.'),
    ).toBeInTheDocument();
  });

  it("displays the non-admin empty state when no properties exist", () => {
    render(<PropertyTable properties={[]} userRole={"analyst" as UserRole} />);
    expect(screen.getByText("Admin needs to add a Property")).toBeInTheDocument();
  });
});
