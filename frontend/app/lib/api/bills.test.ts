import type { BillCreatePayload, BillDraftPayload } from "@/types/bill";
import { createBill, getBillDraft, saveBillDraft, updateBillDraft, withPdfType } from "./bills";

const mockGetSession = jest.fn();

jest.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ auth: { getSession: mockGetSession } }),
}));

const payload: BillCreatePayload = {
  account_number_raw: "ACC-123",
  invoice_number: "INV-001",
  invoice_date: "2026-10-01",
  due_date: "2026-10-31",
  amount: "125.50",
};

const savedBill = {
  id: "abc-123",
  ...payload,
  vendor_name_raw: null,
  prev_payments: null,
  description: null,
  processing_notes: null,
  vendor_account_id: null,
  submitted_by: { id: "user-1", full_name: "Demo User" },
  status: "draft",
  exception_reason: null,
  document_path: null,
  created_at: "2026-10-27T12:00:00Z",
};

const draftPayload: BillDraftPayload = {
  account_number_raw: "ACC-123",
  invoice_number: null,
  vendor_name_raw: null,
  invoice_date: null,
  due_date: null,
  amount: "250.00",
  prev_payments: null,
  description: null,
  processing_notes: null,
  property_address: null,
  account_status: null,
  website_name: null,
};

const savedDraft = {
  bill_id: "bill-1",
  status: "draft" as const,
  document_path: null,
};

function jsonResponse(body: unknown, init: { ok?: boolean; status?: number } = {}) {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: async () => body,
  };
}

// A response whose body is not JSON (for example an HTML 502 page).
function nonJsonResponse(status: number) {
  return {
    ok: false,
    status,
    json: async () => {
      throw new Error("not json");
    },
  };
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

  // Assigning undefined to process.env stores the string "undefined".
  if (originalApiUrl === undefined) {
    delete process.env.NEXT_PUBLIC_API_URL;
  } else {
    process.env.NEXT_PUBLIC_API_URL = originalApiUrl;
  }
});

describe("createBill", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_API_URL = "http://api.test";
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    fetchMock.mockReset();
    process.env.NEXT_PUBLIC_API_URL = originalApiUrl;
  });

  it("POSTs the payload to /bills and returs successful", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: async () => savedBill,
    });
    const result = await createBill(payload);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("http://api.test/bills");
    expect(result).toEqual(savedBill);
  });
  it("throws the server detail message on an HTTP Error", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => ({ detail: "Bill not found." }),
    });
    await expect(createBill(payload)).rejects.toThrow("Bill not found.");
  });

  it("reports a missing API URL instead of a network error", async () => {
    delete process.env.NEXT_PUBLIC_API_URL;

    await expect(createBill(payload)).rejects.toThrow("NEXT_PUBLIC_API_URL is missing");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("withPdfType", () => {
  it("gives a dropped file with an empty MIME type the PDF type", () => {
    const dropped = new File(["%PDF-1.4"], "scan.pdf", { type: "" });

    const sent = withPdfType(dropped);

    expect(sent.type).toBe("application/pdf");
    expect(sent.name).toBe("scan.pdf");
    expect(sent.size).toBe(dropped.size);
  });

  it("leaves a file that already has a type unchanged", () => {
    const file = new File(["%PDF-1.4"], "bill.pdf", {
      type: "application/pdf",
    });

    expect(withPdfType(file)).toBe(file);
  });
});

describe("saveBillDraft", () => {
  it("POSTs the payload to /bills/drafts with the bearer token", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(savedDraft, { status: 201 }));

    const result = await saveBillDraft(draftPayload);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("http://api.test/bills/drafts", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer test-token",
      },
      body: JSON.stringify(draftPayload),
    });
    expect(result).toEqual(savedDraft);
  });

  it("keeps blank fields as null in the request body", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(savedDraft));

    await saveBillDraft(draftPayload);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.amount).toBe("250.00");
    expect(body).toHaveProperty("due_date", null);
    expect(body).toHaveProperty("prev_payments", null);
    expect(body).toHaveProperty("website_name", null);
  });
});

describe("updateBillDraft", () => {
  it("PATCHes /bills/:id/draft with the bearer token", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(savedDraft));

    const result = await updateBillDraft("bill-1", draftPayload);

    expect(fetchMock).toHaveBeenCalledWith("http://api.test/bills/bill-1/draft", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer test-token",
      },
      body: JSON.stringify(draftPayload),
    });
    expect(result).toEqual(savedDraft);
  });
});

// saveBillDraft and updateBillDraft share sendDraft, so they share error handling.
describe.each([
  ["saveBillDraft", () => saveBillDraft(draftPayload)],
  ["updateBillDraft", () => updateBillDraft("bill-1", draftPayload)],
] as const)("%s error handling", (_name, call) => {
  it("requires a session and never calls the backend without one", async () => {
    mockGetSession.mockResolvedValue({ data: { session: null }, error: null });

    await expect(call()).rejects.toThrow("You must be signed in to save a draft.");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("requires an access token on the session", async () => {
    mockGetSession.mockResolvedValue({
      data: { session: { access_token: "" } },
      error: null,
    });

    await expect(call()).rejects.toThrow("You must be signed in to save a draft.");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("treats a session error as signed out", async () => {
    mockGetSession.mockResolvedValue({
      data: { session: { access_token: "test-token" } },
      error: new Error("session expired"),
    });

    await expect(call()).rejects.toThrow("You must be signed in to save a draft.");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports an unreachable backend when fetch rejects", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));

    await expect(call()).rejects.toThrow("Unable to reach the backend");
  });

  it("throws a string detail from the server as-is", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ detail: "Draft not found." }, { ok: false, status: 404 }),
    );

    await expect(call()).rejects.toThrow("Draft not found.");
  });

  it("joins FastAPI 422 field errors into one message", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        {
          detail: [
            { loc: ["body", "amount"], msg: "Invalid amount" },
            { loc: ["body", "due_date"], msg: "Field required" },
          ],
        },
        { ok: false, status: 422 },
      ),
    );

    await expect(call()).rejects.toThrow(
      new Error("amount: Invalid amount; due_date: Field required"),
    );
  });

  it("uses just the message when a 422 error has no field location", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ detail: [{ msg: "Something is wrong" }] }, { ok: false, status: 422 }),
    );

    await expect(call()).rejects.toThrow(new Error("Something is wrong"));
  });

  it("falls back to the status code when the detail list has no messages", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ detail: [{ loc: ["body", "amount"] }] }, { ok: false, status: 422 }),
    );

    await expect(call()).rejects.toThrow("Unable to save draft (422)");
  });

  it("falls back to the status code when the error body is not JSON", async () => {
    fetchMock.mockResolvedValueOnce(nonJsonResponse(502));

    await expect(call()).rejects.toThrow("Unable to save draft (502)");
  });
});

describe("getBillDraft", () => {
  it("GETs /bills/:id/draft with the bearer token and no caching", async () => {
    const detail = { ...savedDraft, amount: "250.00", account_number_raw: "ACC-123" };
    fetchMock.mockResolvedValueOnce(jsonResponse(detail));

    const result = await getBillDraft("bill-1");

    expect(fetchMock).toHaveBeenCalledWith("http://api.test/bills/bill-1/draft", {
      method: "GET",
      headers: { Authorization: "Bearer test-token" },
      cache: "no-store",
    });
    expect(result).toEqual(detail);
  });

  it("requires a session", async () => {
    mockGetSession.mockResolvedValue({ data: { session: null }, error: null });

    await expect(getBillDraft("bill-1")).rejects.toThrow("You must be signed in to view a draft.");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports an unreachable backend when fetch rejects", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));

    await expect(getBillDraft("bill-1")).rejects.toThrow("Unable to reach the backend");
  });

  it("throws the server detail on a 404", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ detail: "Draft not found." }, { ok: false, status: 404 }),
    );

    await expect(getBillDraft("bill-1")).rejects.toThrow("Draft not found.");
  });

  it("falls back to the status code when the error body is not JSON", async () => {
    fetchMock.mockResolvedValueOnce(nonJsonResponse(500));

    await expect(getBillDraft("bill-1")).rejects.toThrow("Unable to load draft (500)");
  });
});
