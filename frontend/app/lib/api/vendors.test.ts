import { getVendor } from "./vendors";

const mockGetSession = jest.fn();

jest.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ auth: { getSession: mockGetSession } }),
}));

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

describe("getVendor", () => {
  it("GETs one vendor with the bearer token", async () => {
    const vendor = { id: "vendor-1", name: "Acme Water" };
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => vendor });

    const result = await getVendor("vendor-1");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://api.test/vendors/vendor-1");
    expect(init.method).toBe("GET");
    expect(init.headers).toEqual({ Authorization: "Bearer test-token" });
    expect(result).toEqual(vendor);
  });

  it("throws the 404 detail for an unknown vendor", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => ({ detail: "Vendor not found." }),
    });

    await expect(getVendor("missing")).rejects.toMatchObject({
      status: 404,
      message: "Vendor not found.",
    });
  });
});
