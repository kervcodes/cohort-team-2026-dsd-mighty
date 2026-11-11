import {
  type BillCreatePayload,
  createBill,
  getDashboardBills,
  saveBillDraft,
  uploadInvoicePdf,
  withPdfType,
} from "./bills";

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

const fetchMock = jest.fn();
const originalApiUrl = process.env.NEXT_PUBLIC_API_URL;

beforeEach(() => {
  process.env.NEXT_PUBLIC_API_URL = "http://api.test";
  global.fetch = fetchMock as unknown as typeof fetch;
  mockGetSession.mockResolvedValue({
    data: { session: { access_token: "token-123" } },
    error: null,
  });
});

afterEach(() => {
  fetchMock.mockReset();
  mockGetSession.mockReset();
  process.env.NEXT_PUBLIC_API_URL = originalApiUrl;
});

function signedOut() {
  mockGetSession.mockResolvedValue({ data: { session: null }, error: null });
}

describe("createBill", () => {
  it("POSTs the payload to /bills and returs successful", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: async () => savedBill,
    });
    const result = await createBill(payload);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("http://api.test/bills");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual(payload);
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

describe("uploadInvoicePdf", () => {
  it("POSTs the PDF as form data with the user's token", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ bill_id: "b1", document_path: "b1/bill.pdf", status: "draft" }),
    });
    const file = new File(["%PDF-1.4"], "bill.pdf", { type: "application/pdf" });

    await uploadInvoicePdf(file, "b1");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://api.test/bills/b1/document");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ Authorization: "Bearer token-123" });
    expect((init.body as FormData).get("file")).toBeInstanceOf(File);
  });

  it("asks the user to sign in when there is no session", async () => {
    signedOut();
    const file = new File(["%PDF-1.4"], "bill.pdf", { type: "application/pdf" });

    await expect(uploadInvoicePdf(file, "b1")).rejects.toThrow(
      "You must be signed in to upload a PDF.",
    );
  });
});

describe("saveBillDraft", () => {
  it("POSTs the draft as JSON with the user's token", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: async () => ({ bill_id: "b1", status: "draft", document_path: null }),
    });

    await saveBillDraft({ invoice_number: "INV-1" });

    expect(fetchMock).toHaveBeenCalledWith("http://api.test/bills/drafts", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer token-123" },
      body: JSON.stringify({ invoice_number: "INV-1" }),
    });
  });

  it("falls back to its own message when the error has no detail", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) });

    await expect(saveBillDraft({})).rejects.toThrow("Unable to save draft (500)");
  });
});

describe("getDashboardBills", () => {
  it("GETs /bills/dashboard uncached with the user's token", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => [] });

    await expect(getDashboardBills()).resolves.toEqual([]);
    expect(fetchMock).toHaveBeenCalledWith("http://api.test/bills/dashboard", {
      method: "GET",
      cache: "no-store",
      headers: { Authorization: "Bearer token-123" },
    });
  });

  it("asks the user to sign in when there is no session", async () => {
    signedOut();

    await expect(getDashboardBills()).rejects.toThrow("You must be signed in to view invoices.");
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
    const file = new File(["%PDF-1.4"], "bill.pdf", { type: "application/pdf" });

    expect(withPdfType(file)).toBe(file);
  });
});
