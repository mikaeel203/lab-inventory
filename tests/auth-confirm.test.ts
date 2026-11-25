import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({ verifyOtp: vi.fn(), configured: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { verifyOtp: mocks.verifyOtp } }) }));
vi.mock("@/lib/supabase/config", () => ({ isConfigured: mocks.configured }));

import { GET } from "../src/app/auth/confirm/route";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.configured.mockReturnValue(true);
  mocks.verifyOtp.mockResolvedValue({ error: null });
});

describe("email confirmation redirects", () => {
  it.each(["http://0.0.0.0:3000", "http://localhost:3000", "https://lab.example"])("keeps redirects relative regardless of server origin %s", async origin => {
    const response = await GET(new NextRequest(`${origin}/auth/confirm?token_hash=test-token&type=signup`));
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/");
    expect(mocks.verifyOtp).toHaveBeenCalledWith({ token_hash: "test-token", type: "signup" });
  });

  it("sends password recovery to the local update form", async () => {
    const response = await GET(new NextRequest("http://0.0.0.0:3000/auth/confirm?token_hash=test-token&type=recovery"));
    expect(response.headers.get("location")).toBe("/auth?mode=update");
  });

  it("does not reflect tokens or untrusted redirect destinations", async () => {
    mocks.verifyOtp.mockResolvedValue({ error: new Error("Expired") });
    const response = await GET(new NextRequest("http://0.0.0.0:3000/auth/confirm?token_hash=test-token&type=signup&next=https://other.example"));
    expect(response.headers.get("location")).toBe("/auth?error=The+email+link+is+invalid+or+expired.+Please+try+again.");
  });

  it("rejects missing or unsupported token types without exchanging them", async () => {
    const response = await GET(new NextRequest("http://0.0.0.0:3000/auth/confirm?type=unsupported"));
    expect(response.headers.get("location")).toMatch(/^\/auth\?error=/);
    expect(mocks.verifyOtp).not.toHaveBeenCalled();
  });

  it("returns to setup when the backend is not configured", async () => {
    mocks.configured.mockReturnValue(false);
    const response = await GET(new NextRequest("http://0.0.0.0:3000/auth/confirm"));
    expect(response.headers.get("location")).toBe("/");
    expect(mocks.verifyOtp).not.toHaveBeenCalled();
  });
});
