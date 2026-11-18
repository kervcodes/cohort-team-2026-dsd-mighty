import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useAuth } from "@/auth/AuthProvider";
import { getAutopaySettings, updateAutopaySettings } from "@/lib/api/autopay-settings";
import { ApiError } from "@/lib/api/http";
import type { AutopaySettings } from "@/types/autopay";
import AutopayCard, { limitError } from "./AutopayCard";

jest.mock("@/auth/AuthProvider", () => ({ useAuth: jest.fn() }));
jest.mock("@/lib/api/autopay-settings", () => ({
  getAutopaySettings: jest.fn(),
  updateAutopaySettings: jest.fn(),
}));

const mockUseAuth = useAuth as jest.Mock;
const mockGet = getAutopaySettings as jest.Mock;
const mockUpdate = updateAutopaySettings as jest.Mock;

const EXPLAINER =
  "Approved bills up to this amount are paid by Claude automatically. A person still approves every bill.";

function settings(overrides: Partial<AutopaySettings> = {}): AutopaySettings {
  return {
    enabled: false,
    limit_amount: null,
    updated_by: null,
    updated_by_name: null,
    updated_at: "2026-11-17T14:00:00Z",
    ...overrides,
  };
}

function signInAs(
  role: "admin" | "approver" | "analyst",
  { status = "active", loading = false }: { status?: string; loading?: boolean } = {},
) {
  mockUseAuth.mockReturnValue({
    profile: { id: "user-me", role, status, full_name: "Ada Admin", email: "ada@example.com" },
    loading,
  });
}

async function renderCard(current: AutopaySettings = settings()) {
  mockGet.mockResolvedValue(current);
  render(<AutopayCard />);
  return screen.findByRole("switch", { name: "Pay approved bills automatically" });
}

const limitField = () => screen.getByRole("textbox", { name: "Limit" });
const saveButton = () => screen.getByRole("button", { name: "Save" });

beforeEach(() => {
  jest.clearAllMocks();
  signInAs("admin");
});

describe("who sees it", () => {
  it("shows an active admin the setting with one line explaining it", async () => {
    const toggle = await renderCard();

    const card = screen.getByRole("region", { name: "Autopay" });
    expect(within(card).getByText(EXPLAINER)).toBeInTheDocument();
    expect(toggle).toHaveAttribute("aria-checked", "false");
    expect(limitField()).toHaveValue("");
  });

  it.each([
    ["an approver", () => signInAs("approver")],
    ["an analyst", () => signInAs("analyst")],
    ["an inactive admin", () => signInAs("admin", { status: "inactive" })],
    ["a profile still loading", () => signInAs("admin", { loading: true })],
  ])("renders nothing for %s and loads nothing", (_who, setUp) => {
    setUp();
    const { container } = render(<AutopayCard />);

    expect(container).toBeEmptyDOMElement();
    expect(mockGet).not.toHaveBeenCalled();
  });
});

describe("loading", () => {
  it("shows the saved setting and who last changed it", async () => {
    const toggle = await renderCard(
      settings({
        enabled: true,
        limit_amount: "750.5",
        updated_by: "user-ada",
        updated_by_name: "Ada Admin",
      }),
    );

    expect(toggle).toHaveAttribute("aria-checked", "true");
    expect(limitField()).toHaveValue("750.50");
    expect(screen.getByRole("status")).toHaveTextContent(
      /^Last changed by Ada Admin on Nov 1[67], 2026/,
    );
    // Nothing changed yet, so nothing to save.
    expect(saveButton()).toBeDisabled();
  });

  it("says nothing about a change nobody has made", async () => {
    await renderCard();

    expect(screen.queryByText(/Last changed/)).not.toBeInTheDocument();
  });

  it("shows a load error with a retry", async () => {
    mockGet.mockRejectedValueOnce(new Error("Unable to load autopay (500)"));
    render(<AutopayCard />);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Unable to load autopay (500)");

    mockGet.mockResolvedValue(settings());
    await userEvent.click(within(alert).getByRole("button", { name: "Try again" }));
    expect(
      await screen.findByRole("switch", { name: "Pay approved bills automatically" }),
    ).toBeInTheDocument();
    expect(mockGet).toHaveBeenCalledTimes(2);
  });
});

describe("saving", () => {
  it("turns autopay on with a limit and shows who changed it", async () => {
    const user = userEvent.setup();
    const toggle = await renderCard();
    mockUpdate.mockResolvedValue(
      settings({
        enabled: true,
        limit_amount: "750.50",
        updated_by: "user-me",
        updated_by_name: "Ada Admin",
        updated_at: "2026-11-17T15:30:00Z",
      }),
    );

    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-checked", "true");
    await user.type(limitField(), "$750.5");
    expect(limitField()).toHaveValue("750.5");
    await user.click(saveButton());

    expect(mockUpdate).toHaveBeenCalledWith({ enabled: true, limit_amount: "750.50" });
    const status = await screen.findByText(/^Last changed by Ada Admin/);
    expect(status.closest("[role=status]")).toHaveTextContent(/^Autopay saved\. Last changed/);
    expect(limitField()).toHaveValue("750.50");
    expect(saveButton()).toBeDisabled();
  });

  it("turns autopay off and keeps the limit", async () => {
    const user = userEvent.setup();
    const toggle = await renderCard(settings({ enabled: true, limit_amount: "500.00" }));
    mockUpdate.mockResolvedValue(settings({ enabled: false, limit_amount: "500.00" }));

    await user.click(toggle);
    await user.click(saveButton());

    expect(mockUpdate).toHaveBeenCalledWith({ enabled: false, limit_amount: "500.00" });
    expect(await screen.findByText("Autopay saved.")).toBeInTheDocument();
  });

  it("saves no limit as null", async () => {
    const user = userEvent.setup();
    await renderCard(settings({ limit_amount: "500.00" }));
    mockUpdate.mockResolvedValue(settings());

    await user.clear(limitField());
    await user.click(saveButton());

    expect(mockUpdate).toHaveBeenCalledWith({ enabled: false, limit_amount: null });
  });

  it("won't turn autopay on without a limit, and says so by the field", async () => {
    const user = userEvent.setup();
    const toggle = await renderCard();

    await user.click(toggle);
    await user.click(saveButton());

    expect(mockUpdate).not.toHaveBeenCalled();
    expect(limitField()).toHaveAttribute("aria-invalid", "true");
    expect(limitField()).toHaveAccessibleDescription("Enter a limit to turn on autopay.");

    // Typing clears the error until the next Save.
    await user.type(limitField(), "5");
    expect(limitField()).toHaveAttribute("aria-invalid", "false");
    expect(screen.queryByText("Enter a limit to turn on autopay.")).not.toBeInTheDocument();
  });

  it("refuses a limit of $0", async () => {
    const user = userEvent.setup();
    const toggle = await renderCard();

    await user.click(toggle);
    await user.type(limitField(), "0.00");
    await user.click(saveButton());

    expect(mockUpdate).not.toHaveBeenCalled();
    expect(limitField()).toHaveAccessibleDescription("The limit must be more than $0.");
  });

  it("shows the server's error inline and keeps the form as typed", async () => {
    const user = userEvent.setup();
    const toggle = await renderCard();
    mockUpdate.mockRejectedValue(new ApiError("Set a limit above $0 to turn on autopay.", 422));

    await user.click(toggle);
    await user.type(limitField(), "200");
    await user.click(saveButton());

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Set a limit above $0 to turn on autopay.",
    );
    expect(toggle).toHaveAttribute("aria-checked", "true");
    expect(limitField()).toHaveValue("200");
    expect(saveButton()).toBeEnabled();
  });

  it("disables Save while saving", async () => {
    const user = userEvent.setup();
    const toggle = await renderCard(settings({ limit_amount: "500.00" }));
    mockUpdate.mockReturnValue(new Promise(() => {}));

    await user.click(toggle);
    await user.click(saveButton());

    expect(screen.getByRole("button", { name: "Saving..." })).toBeDisabled();
  });
});

describe("limitError", () => {
  it.each([
    [true, "", "Enter a limit to turn on autopay."],
    [false, "", null],
    [true, "500", null],
    [true, "500.5", null],
    [true, "500.50", null],
    [false, "0", "The limit must be more than $0."],
    [true, ".", "Enter a dollar amount, like 500 or 500.50."],
    [true, "9999999999.99", null],
    [true, "10000000000", "The limit must be less than $10,000,000,000."],
  ])("enabled %s, limit %j -> %j", (enabled, limit, expected) => {
    expect(limitError(enabled, limit)).toBe(expected);
  });
});
