import type { Payment, PaymentCreatePayload } from "@/types/payment";
import { ApiError } from "./http";
import { listPayments, recordPayment } from "./payments";

const mockGetSession = jest.fn();

jest.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ auth: { getSession: mockGetSession } }),
}));

const completed: PaymentCreatePayload = {
  amount: "1250.00",
  payment_method: "ach",
  paid_on: "2026-11-15",
  reference: "CONF-1",
  outcome: "completed",
};

const payment: Payment = {
  id: "pay-1",
  bill_id: "bill-1",
  amount: "1250.00",
  payment_method: "ach",
  payment_status: "completed",
  paid_on: "2026-11-15",
  reference: "CONF-1",
  failure_reason: null,
  attempt_number: 1,
  recorded_by: "user-1",
  created_at: "2026-11-15T18:00:00Z",
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

describe("recordPayment", () => {
  it("POSTs the payment to /bills/:id/payments with the bearer token", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(payment, { status: 201 }));

    const result = await recordPayment("bill-1", completed);

    expect(fetchMock).toHaveBeenCalledWith("http://api.test/bills/bill-1/payments", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
      body: JSON.stringify(completed),
    });
    expect(result).toEqual(payment);
  });

  it("sends a failed attempt with its reason", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ...payment, payment_status: "failed" }));
    const failed: PaymentCreatePayload = {
      ...completed,
      reference: null,
      outcome: "failed",
      failure_reason: "Bank returned it",
    };

    await recordPayment("bill-1", failed);

    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      amount: "1250.00",
      payment_method: "ach",
      paid_on: "2026-11-15",
      reference: null,
      outcome: "failed",
      failure_reason: "Bank returned it",
    });
  });

  it.each([
    [409, "This bill has already been paid."],
    [422, "A completed payment must be for the full bill amount (1250.00)."],
  ])("throws an ApiError with status %i and the server's message", async (status, detail) => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ detail }, { ok: false, status }));

    const error = await recordPayment("bill-1", completed).catch((err: unknown) => err);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status, message: detail });
  });

  it("asks the user to sign in when there is no session", async () => {
    mockGetSession.mockResolvedValue({ data: { session: null }, error: null });

    await expect(recordPayment("bill-1", completed)).rejects.toThrow(
      "You must be signed in to record a payment.",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("falls back to its own message when the error has no detail", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}, { ok: false, status: 500 }));

    await expect(recordPayment("bill-1", completed)).rejects.toThrow(
      "Unable to record the payment (500)",
    );
  });
});

describe("listPayments", () => {
  it("GETs /bills/:id/payments uncached with the bearer token", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([payment]));

    await expect(listPayments("bill-1")).resolves.toEqual([payment]);
    expect(fetchMock).toHaveBeenCalledWith("http://api.test/bills/bill-1/payments", {
      method: "GET",
      cache: "no-store",
      headers: { Authorization: "Bearer test-token" },
    });
  });

  it("throws the server detail, such as a bill the user can't read", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ detail: "Bill not found." }, { ok: false, status: 404 }),
    );

    await expect(listPayments("bill-1")).rejects.toThrow("Bill not found.");
  });

  it("asks the user to sign in when there is no session", async () => {
    mockGetSession.mockResolvedValue({ data: { session: null }, error: null });

    await expect(listPayments("bill-1")).rejects.toThrow("You must be signed in to view payments.");
  });
});
