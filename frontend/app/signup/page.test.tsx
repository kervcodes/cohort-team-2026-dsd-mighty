import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SignupPage from "./page";

const mockPush = jest.fn();
const mockRefresh = jest.fn();
const mockSignUp = jest.fn();

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, refresh: mockRefresh }),
}));

jest.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ auth: { signUp: mockSignUp } }),
}));

async function fillForm(email: string, password: string, confirm: string) {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Email"), email);
  await user.type(screen.getByLabelText("Password"), password);
  await user.type(screen.getByLabelText("Confirm password"), confirm);
  await user.click(screen.getByRole("button", { name: "Sign up" }));
}

describe("Signup Page", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("rejects passwords shorter than 8 characters", async () => {
    render(<SignupPage />);
    await fillForm("a@b.com", "short", "short");

    expect(await screen.findByText("Password must be at least 8 characters.")).toBeInTheDocument();
    expect(mockSignUp).not.toHaveBeenCalled();
  });

  it("rejects mismatched passwords", async () => {
    render(<SignupPage />);
    await fillForm("a@b.com", "password1235", "password124");

    expect(await screen.findByText("Passwords do not match.")).toBeInTheDocument();
    expect(mockSignUp).not.toHaveBeenCalled();
  });
  it("redirects to the dashboard when a session is returned", async () => {
    mockSignUp.mockResolvedValue({
      data: { session: { access_token: "token" } },
      error: null,
    });
    render(<SignupPage />);
    await fillForm("a@b.com", "password123", "password123");

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/dashboard"));
    expect(mockRefresh).toHaveBeenCalled();
  });
  it("shows the Supabase error message", async () => {
    mockSignUp.mockResolvedValue({
      data: { session: null },
      error: { message: "Email rate limit exceeded" },
    });
    render(<SignupPage />);
    await fillForm("a@b.com", "password123", "password123");

    expect(await screen.findByText("Email rate limit exceeded")).toBeInTheDocument();
  });
});
