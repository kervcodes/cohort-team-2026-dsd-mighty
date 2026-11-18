import { ApiError } from "./http";
import { getPaymentRun, listPaymentRuns, startPaymentRun } from "./payment-runs";

const mockGetSession = jest.fn();

jest.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ auth: { getSession: mockGetSession } }),
}));

const run = {
  id: "run-1",
  bill_id: "bill-1",
  started_by: "user-1",
  started_by_name: "Pat Lee",
  trigger: "manual",
  status: "queued",
  steps: [{ at: "2026-11-15T15:00:00Z", step: "queued", detail: "Queued by Pat Lee." }],
  flag_reason: null,
  receipt: null,
  payment_id: null,
  created_at: "2026-11-15T15:00:00Z",
  started_at: null,
  finished_at: null,
  updated_at: "2026-11-15T15:00:00Z",
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

describe("startPaymentRun", () => {
  it("POSTs to /bills/:id/payment-runs with the bearer token and returns the queued run", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(run, { status: 201 }));

    await expect(startPaymentRun("bill-1")).resolves.toEqual(run);
    expect(fetchMock).toHaveBeenCalledWith("http://api.test/bills/bill-1/payment-runs", {
      method: "POST",
      headers: { Authorization: "Bearer test-token" },
    });
  });

  it.each([
    [409, "A payment run is already in progress for this bill."],
    [422, "This bill's vendor account is inactive."],
  ])("throws an ApiError with the status and server detail on a %i", async (status, detail) => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ detail }, { ok: false, status }));

    const error = await startPaymentRun("bill-1").catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status, message: detail });
  });

  it("falls back to its own message when the error has no detail", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}, { ok: false, status: 500 }));

    await expect(startPaymentRun("bill-1")).rejects.toThrow(
      "Unable to start the payment run (500)",
    );
  });

  it("asks the user to sign in when there is no session", async () => {
    mockGetSession.mockResolvedValue({ data: { session: null }, error: null });

    await expect(startPaymentRun("bill-1")).rejects.toThrow("You must be signed in to pay a bill.");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("listPaymentRuns", () => {
  it("GETs /bills/:id/payment-runs uncached", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([run]));

    await expect(listPaymentRuns("bill-1")).resolves.toEqual([run]);
    expect(fetchMock).toHaveBeenCalledWith("http://api.test/bills/bill-1/payment-runs", {
      method: "GET",
      cache: "no-store",
      headers: { Authorization: "Bearer test-token" },
    });
  });

  it("throws the server detail, such as a bill the caller can't read", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ detail: "Bill not found." }, { ok: false, status: 404 }),
    );

    await expect(listPaymentRuns("bill-1")).rejects.toThrow("Bill not found.");
  });
});

describe("getPaymentRun", () => {
  it("GETs /payment-runs/:id uncached and passes the abort signal", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ...run, status: "running" }));
    const controller = new AbortController();

    await expect(getPaymentRun("run-1", controller.signal)).resolves.toMatchObject({
      status: "running",
    });
    expect(fetchMock).toHaveBeenCalledWith("http://api.test/payment-runs/run-1", {
      method: "GET",
      cache: "no-store",
      signal: controller.signal,
      headers: { Authorization: "Bearer test-token" },
    });
  });

  it("falls back to its own message when the error has no detail", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(null, { ok: false, status: 502 }));

    await expect(getPaymentRun("run-1")).rejects.toThrow("Unable to load the payment run (502)");
  });
});
