import { getAutopaySettings, updateAutopaySettings } from "./autopay-settings";
import { ApiError } from "./http";

const mockGetSession = jest.fn();

jest.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ auth: { getSession: mockGetSession } }),
}));

const settings = {
  enabled: true,
  limit_amount: "500.00",
  updated_by: "user-ada",
  updated_by_name: "Ada Admin",
  updated_at: "2026-11-17T14:00:00Z",
};

function jsonResponse(body: unknown, init: { ok?: boolean; status?: number } = {}) {
  return { ok: init.ok ?? true, status: init.status ?? 200, json: async () => body };
}

const fetchMock = jest.fn();
const originalApiUrl = process.env.NEXT_PUBLIC_API_URL;

beforeEach(() => {
  process.env.NEXT_PUBLIC_API_URL = "http://api.test";
  global.fetch = fetchMock as unknown as typeof fetch;
  mockGetSession.mockReset().mockResolvedValue({
    data: { session: { access_token: "test-token" } },
    error: null,
  });
});

afterEach(() => {
  fetchMock.mockReset();
  if (originalApiUrl === undefined) {
    delete process.env.NEXT_PUBLIC_API_URL;
  } else {
    process.env.NEXT_PUBLIC_API_URL = originalApiUrl;
  }
});

describe("getAutopaySettings", () => {
  it("GETs /autopay-settings uncached with the bearer token", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(settings));

    await expect(getAutopaySettings()).resolves.toEqual(settings);
    expect(fetchMock).toHaveBeenCalledWith("http://api.test/autopay-settings", {
      method: "GET",
      cache: "no-store",
      headers: { Authorization: "Bearer test-token" },
    });
  });

  it("falls back to its own message when the error has no detail", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(null, { ok: false, status: 502 }));

    await expect(getAutopaySettings()).rejects.toThrow("Unable to load autopay (502)");
  });
});

describe("updateAutopaySettings", () => {
  it("PUTs both fields as JSON and returns the saved setting", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(settings));

    await expect(updateAutopaySettings({ enabled: true, limit_amount: "500.00" })).resolves.toEqual(
      settings,
    );
    expect(fetchMock).toHaveBeenCalledWith("http://api.test/autopay-settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
      body: JSON.stringify({ enabled: true, limit_amount: "500.00" }),
    });
  });

  it("throws an ApiError with the server detail on a 422", async () => {
    const detail = "Set a limit above $0 to turn on autopay.";
    fetchMock.mockResolvedValueOnce(jsonResponse({ detail }, { ok: false, status: 422 }));

    const error = await updateAutopaySettings({ enabled: true, limit_amount: null }).catch(
      (e: unknown) => e,
    );

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 422, message: detail });
  });

  it("asks the user to sign in when there is no session", async () => {
    mockGetSession.mockResolvedValue({ data: { session: null }, error: null });

    await expect(updateAutopaySettings({ enabled: false, limit_amount: null })).rejects.toThrow(
      "You must be signed in to change autopay.",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
