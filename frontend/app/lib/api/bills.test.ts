import { create } from "domain";
import { type BillCreatePayload, createBill } from "./bills";

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

describe("createBill", () => {
  const fetchMock = jest.fn();

  beforeEach(() => {
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    fetchMock.mockReset();
  });

  it("POSTs the payload to /bills and returs successful", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: async () => savedBill,
    });
    const result = await createBill(payload);

    expect(fetchMock).toHaveBeenCalledTimes(1);
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
});
