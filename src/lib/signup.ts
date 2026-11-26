type SignupResult = { session?: unknown; user?: { identities?: unknown[] } | null } | null;
type SignupError = { code?: string; message?: string } | null;

export function isExistingSignup(data: SignupResult, error: SignupError): boolean {
  if (data?.session) return false;
  if (error) return error.code === "user_already_exists" || error.code === "email_exists"
    || (!error.code && error.message?.trim().toLowerCase() === "user already registered");
  return Array.isArray(data?.user?.identities) && data.user.identities.length === 0;
}
