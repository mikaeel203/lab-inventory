import { describe, expect, it } from "vitest";
import { isExistingSignup } from "../src/lib/signup";

describe("existing-account signup responses", () => {
  it("recognizes a successful obfuscated user with no identities", () => {
    expect(isExistingSignup({ session: null, user: { identities: [] } }, null)).toBe(true);
  });
  it.each(["user_already_exists", "email_exists"])("recognizes the explicit %s error", code => {
    expect(isExistingSignup(null, { code, message: "Already registered" })).toBe(true);
  });
  it("recognizes the legacy duplicate message only when no error code is supplied", () => {
    expect(isExistingSignup(null, { message: "User already registered" })).toBe(true);
    expect(isExistingSignup(null, { code: "unexpected_failure", message: "User already registered" })).toBe(false);
  });
  it("keeps new and unverified accounts on the confirmation flow", () => {
    expect(isExistingSignup({ session: null, user: { identities: [{ provider: "email" }] } }, null)).toBe(false);
  });
  it("does not interpret missing data or missing identities as an existing account", () => {
    expect(isExistingSignup(null, null)).toBe(false);
    expect(isExistingSignup({ user: null }, null)).toBe(false);
    expect(isExistingSignup({ user: {} }, null)).toBe(false);
  });
  it("does not replace an authenticated signup or mask another error", () => {
    expect(isExistingSignup({ session: { access_token: "test" }, user: { identities: [] } }, null)).toBe(false);
    expect(isExistingSignup({ user: { identities: [] } }, { code: "over_email_send_rate_limit", message: "Slow down" })).toBe(false);
  });
});
