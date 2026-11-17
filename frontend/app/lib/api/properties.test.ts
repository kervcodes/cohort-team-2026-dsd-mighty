import { listAllProperties, listProperties, type PropertyRead } from "./properties";

const mockGetSession = jest.fn();

jest.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ auth: { getSession: mockGetSession } }),
}));

function property(id: string): PropertyRead {
  return {
    id,
    property_name: `Property ${id}`,
    address: { street: "1 Main St", city: "Dallas", state: "TX", zip_code: "75201" },
    status: "active",
  };
}

function page(items: PropertyRead[], total: number, skip: number) {
  return { ok: true, status: 200, json: async () => ({ items, total, skip, limit: 100 }) };
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

describe("listProperties", () => {
  it("GETs one page of properties with the bearer token", async () => {
    fetchMock.mockResolvedValueOnce(page([property("1")], 1, 0));

    const result = await listProperties(25, 50);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://api.test/properties?skip=25&limit=50");
    expect(init.method).toBe("GET");
    expect(init.headers).toEqual({ Authorization: "Bearer test-token" });
    expect(result.items).toEqual([property("1")]);
  });

  it("throws the server detail", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 403,
      json: async () => ({ detail: "Your role can't do this." }),
    });

    await expect(listProperties()).rejects.toThrow("Your role can't do this.");
  });
});

describe("listAllProperties", () => {
  it("reads page after page until it has every property", async () => {
    const first = Array.from({ length: 100 }, (_, i) => property(String(i)));
    fetchMock
      .mockResolvedValueOnce(page(first, 101, 0))
      .mockResolvedValueOnce(page([property("100")], 101, 100));

    const result = await listAllProperties();

    expect(result).toHaveLength(101);
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "http://api.test/properties?skip=0&limit=100",
      "http://api.test/properties?skip=100&limit=100",
    ]);
  });

  it("makes one call when the first page has them all", async () => {
    fetchMock.mockResolvedValueOnce(page([], 0, 0));

    expect(await listAllProperties()).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("stops at an empty page even if the total says there are more", async () => {
    // A property deleted between two pages must not loop forever.
    fetchMock
      .mockResolvedValueOnce(page([property("1")], 3, 0))
      .mockResolvedValueOnce(page([], 2, 1));

    expect(await listAllProperties()).toEqual([property("1")]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
