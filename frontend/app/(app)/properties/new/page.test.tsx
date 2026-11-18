import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useAuth } from "@/auth/AuthProvider";
import { createProperty } from "@/lib/api/properties";
import NewPropertyPage from "./page";

const push = jest.fn();

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

jest.mock("@/auth/AuthProvider", () => ({
  useAuth: jest.fn(),
}));

jest.mock("@/lib/api/properties", () => ({
  ...jest.requireActual("@/lib/api/properties"),
  createProperty: jest.fn(),
}));

const mockUseAuth = useAuth as jest.Mock;
const mockCreateProperty = createProperty as jest.Mock;

function signInAs(role: "admin" | "analyst" | "approver") {
  mockUseAuth.mockReturnValue({ profile: { role, status: "active" }, loading: false });
}

async function fillIn(values: Record<string, string>) {
  for (const [label, value] of Object.entries(values)) {
    await userEvent.type(screen.getByLabelText(label), value);
  }
}

const OAK_ROW = {
  "Property name": "Oak Row",
  Street: "40 Oak Row",
  City: "Dallas",
  State: "TX",
  "ZIP code": "75201",
};

describe("NewPropertyPage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("creates the property and returns to the list", async () => {
    signInAs("admin");
    mockCreateProperty.mockResolvedValue({ id: "property-1" });
    render(<NewPropertyPage />);

    await fillIn({ ...OAK_ROW, "Property name": "  Oak Row ", State: "tx" });
    await userEvent.click(screen.getByRole("button", { name: "Add property" }));

    // Trimmed, and the state uppercased.
    expect(mockCreateProperty).toHaveBeenCalledWith({
      property_name: "Oak Row",
      address: { street: "40 Oak Row", city: "Dallas", state: "TX", zip_code: "75201" },
    });
    expect(push).toHaveBeenCalledWith("/properties");
    expect(screen.getByLabelText("Property name")).toHaveValue("");
  });

  it("accepts a ZIP+4 code", async () => {
    signInAs("admin");
    mockCreateProperty.mockResolvedValue({ id: "property-1" });
    render(<NewPropertyPage />);

    await fillIn({ ...OAK_ROW, "ZIP code": "75201-1234" });
    await userEvent.click(screen.getByRole("button", { name: "Add property" }));

    expect(mockCreateProperty).toHaveBeenCalledWith(
      expect.objectContaining({ address: expect.objectContaining({ zip_code: "75201-1234" }) }),
    );
  });

  it("shows field errors and does not submit an invalid form", async () => {
    signInAs("admin");
    render(<NewPropertyPage />);

    await fillIn({ State: "T1", "ZIP code": "7520" });
    await userEvent.click(screen.getByRole("button", { name: "Add property" }));

    expect(await screen.findByText("Property name is required")).toBeInTheDocument();
    expect(screen.getByText("Street is required")).toBeInTheDocument();
    expect(screen.getByText("City is required")).toBeInTheDocument();
    expect(screen.getByText("Use the 2-letter state code")).toBeInTheDocument();
    expect(screen.getByText("Use a 5-digit ZIP code, or ZIP+4")).toBeInTheDocument();
    expect(mockCreateProperty).not.toHaveBeenCalled();
  });

  it("stays on the form and shows the error when the API fails", async () => {
    signInAs("admin");
    mockCreateProperty.mockRejectedValue(new Error("Your role can't do this."));
    render(<NewPropertyPage />);

    await fillIn(OAK_ROW);
    await userEvent.click(screen.getByRole("button", { name: "Add property" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Your role can't do this.");
    expect(push).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Property name")).toHaveValue("Oak Row");
  });

  it.each(["analyst", "approver"] as const)("does not show the form to the %s role", (role) => {
    signInAs(role);
    render(<NewPropertyPage />);

    expect(screen.getByText("Only admins can add properties.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to properties" })).toHaveAttribute(
      "href",
      "/properties",
    );
    expect(screen.queryByLabelText("Property name")).not.toBeInTheDocument();
  });

  it("shows a loading state while the account loads", () => {
    mockUseAuth.mockReturnValue({ profile: null, loading: true });
    render(<NewPropertyPage />);

    expect(screen.getByRole("status")).toHaveTextContent("Loading...");
    expect(screen.queryByLabelText("Property name")).not.toBeInTheDocument();
  });
});
