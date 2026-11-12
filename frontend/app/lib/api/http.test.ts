import { ApiError, apiRequest, NETWORK_ERROR_MESSAGE } from "./http";

const mockGetSession = jest.fn();

jest.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ auth: { getSession: mockGetSession } }),
}));

const messages = { signedOut: "You must be signed in to do this.", failed: "Unable to do this" };

function signedIn(token = "token-123") {
  mockGetSession.mockResolvedValue({ data: { session: { access_token: token } }, error: null });
}

describe("apiRequest", () => {
  const fetchMock = jest.fn();
  const originalApiUrl = process.env.NEXT_PUBLIC_API_URL;

  beforeEach(() => {
    process.env.NEXT_PUBLIC_API_URL = "http://api.test";
    global.fetch = fetchMock as unknown as typeof fetch;
    signedIn();
  });

  afterEach(() => {
    fetchMock.mockReset();
    mockGetSession.mockReset();
    process.env.NEXT_PUBLIC_API_URL = originalApiUrl;
  });

  it("sends the session's access token and returns the JSON body", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ id: "1" }) });

    const result = await apiRequest(
      "/things",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" },
      messages,
    );

    expect(result).toEqual({ id: "1" });
    expect(fetchMock).toHaveBeenCalledWith("http://api.test/things", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer token-123" },
      body: "{}",
    });
  });

  it("throws the caller's signed-out message without calling the backend", async () => {
    mockGetSession.mockResolvedValue({ data: { session: null }, error: null });

    await expect(apiRequest("/things", {}, messages)).rejects.toThrow(messages.signedOut);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("treats a session lookup error as signed out", async () => {
    mockGetSession.mockResolvedValue({ data: { session: null }, error: new Error("bad cookie") });

    await expect(apiRequest("/things", {}, messages)).rejects.toThrow(messages.signedOut);
  });

  it("reports a missing API URL instead of a network error", async () => {
    delete process.env.NEXT_PUBLIC_API_URL;

    await expect(apiRequest("/things", {}, messages)).rejects.toThrow(
      "NEXT_PUBLIC_API_URL is missing",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("turns a failed fetch into a clear network error", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));

    await expect(apiRequest("/things", {}, messages)).rejects.toThrow(NETWORK_ERROR_MESSAGE);
  });

  it("throws an ApiError carrying the response status", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 409,
      json: async () => ({ detail: "This bill has already been submitted." }),
    });

    const error = await apiRequest("/things", {}, messages).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 409, message: "This bill has already been submitted." });
  });

  it("throws a string FastAPI detail as is", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 403,
      json: async () => ({ detail: "Account not found. Contact an admin." }),
    });

    await expect(apiRequest("/things", {}, messages)).rejects.toThrow(
      "Account not found. Contact an admin.",
    );
  });

  it("joins a 422 validation detail list into one message naming each field", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 422,
      json: async () => ({
        detail: [
          { loc: ["body", "amount"], msg: "Input should be a valid decimal" },
          { loc: ["body", "due_date"], msg: "Input should be a valid date" },
        ],
      }),
    });

    await expect(apiRequest("/things", {}, messages)).rejects.toThrow(
      "amount: Input should be a valid decimal; due_date: Input should be a valid date",
    );
  });

  it("falls back to the caller's message and the status when there is no detail", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 502,
      json: async () => {
        throw new SyntaxError("not JSON");
      },
    });

    await expect(apiRequest("/things", {}, messages)).rejects.toThrow("Unable to do this (502)");
  });
});
