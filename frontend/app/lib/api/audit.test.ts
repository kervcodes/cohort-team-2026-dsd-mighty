import { getBillHistory, listAuditChanges } from "./audit";
import { ApiError } from "./http";

const mockGetSession = jest.fn();

jest.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ auth: { getSession: mockGetSession } }),
}));

function jsonResponse(body: unknown, init: { ok?: boolean; status?: number } = {}) {
  return { ok: init.ok ?? true, status: init.status ?? 200, json: async () => body };
}

const fetchMock = jest.fn();
const originalApiUrl = process.env.NEXT_PUBLIC_API_URL;

beforeEach(() => {
  process.env.NEXT_PUBLIC_API_URL = "http://api.test";
  global.fetch = fetchMock as unknown as typeof fetch;
  fetchMock.mockReset();
  mockGetSession.mockReset().mockResolvedValue({
    data: { session: { access_token: "test-token" } },
    error: null,
  });
});

afterAll(() => {
  process.env.NEXT_PUBLIC_API_URL = originalApiUrl;
});

describe("listAuditChanges", () => {
  it("GETs /audit/changes with no query string by default", async () => {
    const page = { items: [], next_before_id: null };
    fetchMock.mockResolvedValue(jsonResponse(page));

    await expect(listAuditChanges()).resolves.toEqual(page);

    expect(fetchMock).toHaveBeenCalledWith(
      "http://api.test/audit/changes",
      expect.objectContaining({
        method: "GET",
        headers: { Authorization: "Bearer test-token" },
      }),
    );
  });

  it("sends every filter under the contract's parameter names and skips empty ones", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ items: [], next_before_id: null }));

    await listAuditChanges({
      table: "vendor_accounts",
      actor_id: "user-1",
      bill_id: "bill-1",
      from: "2026-11-01",
      to: "2026-11-17",
      before_id: 1184,
      limit: 25,
    });
    await listAuditChanges({ table: undefined, from: "" });

    const url = new URL(fetchMock.mock.calls[0][0]);
    expect(url.pathname).toBe("/audit/changes");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      table: "vendor_accounts",
      actor_id: "user-1",
      bill_id: "bill-1",
      from: "2026-11-01",
      to: "2026-11-17",
      before_id: "1184",
      limit: "25",
    });
    expect(fetchMock.mock.calls[1][0]).toBe("http://api.test/audit/changes");
  });

  it("throws an ApiError with the status for a 403", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ detail: "Forbidden." }, { ok: false, status: 403 }));

    await expect(listAuditChanges()).rejects.toMatchObject({
      message: "Forbidden.",
      status: 403,
    });
    await expect(listAuditChanges()).rejects.toBeInstanceOf(ApiError);
  });

  it("fails when signed out", async () => {
    mockGetSession.mockResolvedValue({ data: { session: null }, error: null });

    await expect(listAuditChanges()).rejects.toThrow("You must be signed in");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("getBillHistory", () => {
  it("GETs /bills/{id}/history", async () => {
    const history = { bill_id: "bill-1", events: [] };
    fetchMock.mockResolvedValue(jsonResponse(history));

    await expect(getBillHistory("bill-1")).resolves.toEqual(history);

    expect(fetchMock).toHaveBeenCalledWith(
      "http://api.test/bills/bill-1/history",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("surfaces the 404 detail", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ detail: "Bill not found." }, { ok: false, status: 404 }),
    );

    await expect(getBillHistory("nope")).rejects.toMatchObject({
      message: "Bill not found.",
      status: 404,
    });
  });
});
