import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import LoginPage from "./page";

const mockPush = jest.fn();
const mockRefresh = jest.fn();
const mockSignInWithPassword = jest.fn();

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, refresh: mockRefresh }),
}));

jest.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: { signInWithPassword: mockSignInWithPassword },
  }),
}));

async function fillForm(email: string, password: string) {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Email"), email);
  await user.type(screen.getByLabelText("Password"), password);
  await user.click(screen.getByRole("button", { name: "Log in" }));
}

describe("Log in", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("shows an error and stays on the page when credentials are wrong", async () => {
    mockSignInWithPassword.mockResolvedValue({
      data: { session: null },
      error: { message: "Invalid login credentials" },
    });

    render(<LoginPage />);
    await fillForm("a@b.com", "password1235");
    expect(await screen.findByText("Invalid login credentials")).toBeInTheDocument();
    expect(mockSignInWithPassword).toHaveBeenCalledWith({
      email: "a@b.com",
      password: "password1235",
    });
    expect(mockPush).not.toHaveBeenCalled();
  });
  it("redirects to dashboard when login succeeds", async () => {
    mockSignInWithPassword.mockResolvedValue({
      data: { session: { access_token: "token" } },
      error: null,
    });

    render(<LoginPage />);
    await fillForm("a@b.com", "password1234");

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/dashboard"));
    expect(mockRefresh).toHaveBeenCalled();
  });
});
