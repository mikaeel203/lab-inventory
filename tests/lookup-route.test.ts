import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({ lookup: vi.fn(), role: vi.fn(), reserve: vi.fn() }));
vi.mock("@/lib/supabase/config", () => ({ isConfigured: () => true }));
vi.mock("@/lib/lookup", () => ({ safeLookupUrl: () => {}, lookupProduct: mocks.lookup }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: { id: "owner" } } }) },
  from: () => ({ select: () => ({ eq: () => ({ single: mocks.role }) }) }),
  rpc: mocks.reserve,
}) }));
import { POST } from "../src/app/api/lookup/route";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.role.mockResolvedValue({ data: { role: "lab" } });
  mocks.reserve.mockResolvedValue({ data: true, error: null });
  mocks.lookup.mockResolvedValue({ name: "Acetone", catalogue_number: "AC-001", source: "Product metadata" });
});

function request(origin = "http://localhost:3000") {
  return new NextRequest("http://0.0.0.0:3000/api/lookup", {
    method: "POST", headers: { origin, host: "localhost:3000", "Content-Type": "application/json" },
    body: JSON.stringify({ url: "https://supplier.example/product" }),
  });
}

describe("product lookup endpoint", () => {
  it("accepts the browser host when the server listens on all interfaces", async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ catalogue_number: "AC-001" });
  });
  it("rejects other origins before reserving or fetching", async () => {
    const response = await POST(request("https://other.example"));
    expect(response.status).toBe(403);
    expect(mocks.reserve).not.toHaveBeenCalled();
    expect(mocks.lookup).not.toHaveBeenCalled();
  });
  it("keeps students out of supplier lookup", async () => {
    mocks.role.mockResolvedValue({ data: { role: "student" } });
    expect((await POST(request())).status).toBe(403);
    expect(mocks.lookup).not.toHaveBeenCalled();
  });
  it("returns null catalogue numbers when lookup fails", async () => {
    mocks.lookup.mockRejectedValue(new Error("Unavailable"));
    expect(await (await POST(request())).json()).toMatchObject({ name: null, catalogue_number: null });
  });
});
