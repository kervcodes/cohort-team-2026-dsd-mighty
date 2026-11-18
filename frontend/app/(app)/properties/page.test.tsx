import { render, screen } from "@testing-library/react";
import { useAuth } from "@/auth/AuthProvider";
import { listAllProperties, type PropertyRead } from "@/lib/api/properties";
import PropertiesPage from "./page";

jest.mock("@/auth/AuthProvider", () => ({
  useAuth: jest.fn(),
}));

jest.mock("@/lib/api/properties", () => ({
  ...jest.requireActual("@/lib/api/properties"),
  listAllProperties: jest.fn(),
}));

const mockUseAuth = useAuth as jest.Mock;
const mockListAllProperties = listAllProperties as jest.Mock;

const OAK_ROW: PropertyRead = {
  id: "11111111-2222-4333-8444-555555555555",
  property_name: "Oak Row",
  address: { street: "40 Oak Row", city: "Dallas", state: "TX", zip_code: "75201" },
  status: "active",
  created_at: "2026-11-05T14:03:22Z",
};

describe("PropertiesPage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseAuth.mockReturnValue({ profile: { role: "analyst" }, loading: false });
  });

  it("loads the properties and shows them in the table", async () => {
    mockListAllProperties.mockResolvedValue([OAK_ROW]);

    render(<PropertiesPage />);

    expect(screen.getByText("Loading properties...")).toBeInTheDocument();
    expect(await screen.findByText("Oak Row")).toBeInTheDocument();
    expect(screen.getByText("40 Oak Row")).toBeInTheDocument();
    expect(screen.getByText("Dallas")).toBeInTheDocument();
    expect(screen.getByText("75201")).toBeInTheDocument();
    expect(screen.getByText("11111111")).toBeInTheDocument();
    expect(mockListAllProperties).toHaveBeenCalledTimes(1);
  });

  it("shows the error when the properties cannot be loaded", async () => {
    mockListAllProperties.mockRejectedValue(new Error("Unable to load properties"));

    render(<PropertiesPage />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Unable to load properties");
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
});
