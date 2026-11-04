/** @jest-environment node */
import { GET } from "./route";

const mockExchange = jest.fn();

jest.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { exchangeCodeForSession: mockExchange },
  }),
}));

function callback(query: string) {
  return GET(new Request(`http://localhost:3000/auth/callback${query}`));
}

const LOGIN_ERROR = "http://localhost:3000/login?error=auth_callback_failed";

describe("GET /auth/callback", () => {
  beforeEach(() => {
    jest.resetAllMocks();
    jest.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("exchanges the code and redirects to the dashboard", async () => {
    mockExchange.mockResolvedValue({ error: null });
    const res = await callback("?code=abc123");
    expect(mockExchange).toHaveBeenCalledWith("abc123");
    expect(res.headers.get("location")).toBe("http://localhost:3000/dashboard");
  });

  it("redirects to login when the exchange fails", async () => {
    mockExchange.mockResolvedValue({ error: { message: "invalid code" } });
    const res = await callback("?code=bad");
    expect(mockExchange).toHaveBeenCalledWith("bad");
    expect(res.headers.get("location")).toBe(LOGIN_ERROR);
  });
  it("redirects to login when the exchange throws", async () => {
    mockExchange.mockRejectedValue(new Error("network"));
    const res = await callback("?code=abc123");
    expect(res.headers.get("location")).toBe(LOGIN_ERROR);
  });
});
