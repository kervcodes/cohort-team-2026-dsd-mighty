import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useAuth } from "@/auth/AuthProvider";
import { getProperty, type PropertyRead, updateProperty } from "@/lib/api/properties";
import EditProperty from "./EditProperty";

const push = jest.fn();

jest.mock("next/navigation", () => ({
  useParams: () => ({ propertyId: "property-1" }),
  useRouter: () => ({ push }),
}));

jest.mock("@/auth/AuthProvider", () => ({
  useAuth: jest.fn(),
}));

jest.mock("@/lib/api/properties", () => ({
  getProperty: jest.fn(),
  updateProperty: jest.fn(),
}));

const mockUseAuth = useAuth as jest.Mock;
const mockGetProperty = getProperty as jest.Mock;
const mockUpdateProperty = updateProperty as jest.Mock;

function signInAs(role: "admin" | "analyst" | "approver") {
  mockUseAuth.mockReturnValue({ profile: { role, status: "active" }, loading: false });
}

const OAK: PropertyRead = {
  id: "property-1",
  property_name: "Oak Row",
  address: { street: "40 Oak Row", city: "Dallas", state: "TX", zip_code: "75201" },
  status: "inactive",
  created_at: "2026-11-05T14:03:22Z",
};

describe("EditProperty", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetProperty.mockResolvedValue(OAK);
  });

  it("fills the form in with the saved property", async () => {
    signInAs("admin");
    render(<EditProperty />);

    expect(await screen.findByLabelText("Property name")).toHaveValue("Oak Row");
    expect(screen.getByLabelText("Street")).toHaveValue("40 Oak Row");
    expect(screen.getByLabelText("City")).toHaveValue("Dallas");
    expect(screen.getByLabelText("State")).toHaveValue("TX");
    expect(screen.getByLabelText("ZIP code")).toHaveValue("75201");
  });

  it("saves the name and whole address, never the status, then returns to the property", async () => {
    signInAs("admin");
    mockUpdateProperty.mockResolvedValue(OAK);
    render(<EditProperty />);

    const street = await screen.findByLabelText("Street");
    await userEvent.clear(street);
    await userEvent.type(street, " 12 Elm St ");
    await userEvent.clear(screen.getByLabelText("State"));
    await userEvent.type(screen.getByLabelText("State"), "ok");
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));

    expect(mockUpdateProperty).toHaveBeenCalledWith("property-1", {
      property_name: "Oak Row",
      address: { street: "12 Elm St", city: "Dallas", state: "OK", zip_code: "75201" },
    });
    expect(push).toHaveBeenCalledWith("/properties/property-1");
  });

  it("shows field errors and does not save an invalid form", async () => {
    signInAs("admin");
    render(<EditProperty />);

    const zip = await screen.findByLabelText("ZIP code");
    await userEvent.clear(zip);
    await userEvent.type(zip, "7520");
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));

    expect(await screen.findByText("Use a 5-digit ZIP code, or ZIP+4")).toBeInTheDocument();
    expect(mockUpdateProperty).not.toHaveBeenCalled();
  });

  it("shows the server's reason and stays on the form when the save fails", async () => {
    signInAs("admin");
    mockUpdateProperty.mockRejectedValue(new Error("Property not found."));
    render(<EditProperty />);

    await screen.findByLabelText("Property name");
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Property not found.");
    expect(push).not.toHaveBeenCalled();
  });

  it("links back to the property", async () => {
    signInAs("admin");
    render(<EditProperty />);

    expect(await screen.findByRole("link", { name: "Cancel" })).toHaveAttribute(
      "href",
      "/properties/property-1",
    );
  });

  it("tells other roles only admins can change properties, and loads nothing", () => {
    signInAs("analyst");
    render(<EditProperty />);

    expect(screen.getByText("Only admins can change properties.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Property name")).not.toBeInTheDocument();
    expect(mockGetProperty).not.toHaveBeenCalled();
  });

  it("shows a load error", async () => {
    signInAs("admin");
    mockGetProperty.mockRejectedValue(new Error("Property not found."));
    render(<EditProperty />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Property not found.");
    expect(screen.queryByLabelText("Property name")).not.toBeInTheDocument();
  });
});
