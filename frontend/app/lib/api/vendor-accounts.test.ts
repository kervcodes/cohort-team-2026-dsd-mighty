import type { VendorAccount } from "@/types/vendor-account";
import { ApiError } from "./http";
import { createVendorAccount, listVendorAccounts, updateVendorAccount } from "./vendor-accounts";

const mockGetSession = jest.fn();

jest.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ auth: { getSession: mockGetSession } }),
}));

const account: VendorAccount = {
  id: "account-1",
  property_id: "prop-1",
  vendor_id: "vendor-1",
  account_number: "ACC-100",
  account_type: "water",
  payment_method: "ach",
  portal_url: null,
  portal_login_email: null,
  portal_password_set: true,
  status: "active",
  created_at: "2026-11-05T12:00:00Z",
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

describe("listVendorAccounts", () => {
  it("GETs the vendor's accounts with the bearer token", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([account]));

    const result = await listVendorAccounts("vendor-1");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://api.test/vendors/vendor-1/accounts");
    expect(init.method).toBe("GET");
    expect(init.headers).toEqual({ Authorization: "Bearer test-token" });
    expect(result).toEqual([account]);
  });

  it("escapes the vendor id in the path", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([]));

    await listVendorAccounts("a/b?c");

    expect(fetchMock.mock.calls[0][0]).toBe("http://api.test/vendors/a%2Fb%3Fc/accounts");
  });

  it("asks the user to sign in when there is no session", async () => {
    mockGetSession.mockResolvedValue({ data: { session: null }, error: null });

    await expect(listVendorAccounts("vendor-1")).rejects.toThrow(
      "You must be signed in to view vendor accounts.",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("createVendorAccount", () => {
  const payload = {
    vendor_id: "vendor-1",
    property_id: "prop-1",
    account_number: "ACC-100",
    account_type: "water",
    payment_method: "ach" as const,
    portal_password: "s3cret",
  };

  it("POSTs the account, password included, as JSON", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(account, { status: 201 }));

    const result = await createVendorAccount(payload);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://api.test/vendor-accounts");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({
      "Content-Type": "application/json",
      Authorization: "Bearer test-token",
    });
    expect(JSON.parse(init.body)).toEqual(payload);
    expect(result).toEqual(account);
  });

  it("throws an ApiError with the status and detail of a duplicate", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        { detail: "This vendor account already exists for the property." },
        { ok: false, status: 409 },
      ),
    );

    const error = await createVendorAccount(payload).catch((err: unknown) => err);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 409,
      message: "This vendor account already exists for the property.",
    });
  });

  it("turns validation errors into one message", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        { detail: [{ loc: ["body", "portal_url"], msg: "Input should be a valid URL" }] },
        { ok: false, status: 422 },
      ),
    );

    await expect(createVendorAccount(payload)).rejects.toMatchObject({
      status: 422,
      message: "portal_url: Input should be a valid URL",
    });
  });

  it("falls back to its own message with the status", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(null, { ok: false, status: 502 }));

    await expect(createVendorAccount(payload)).rejects.toThrow("Unable to add the account (502)");
  });
});

describe("updateVendorAccount", () => {
  it("PATCHes the changes, with null to remove the password", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ...account, portal_password_set: false }));

    await updateVendorAccount("account-1", { account_type: "sewer", portal_password: null });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://api.test/vendor-accounts/account-1");
    expect(init.method).toBe("PATCH");
    expect(init.body).toBe('{"account_type":"sewer","portal_password":null}');
  });

  it("leaves out a password that is not given", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(account));

    await updateVendorAccount("account-1", { account_type: "sewer" });

    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).not.toHaveProperty("portal_password");
  });
});
