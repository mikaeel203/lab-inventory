import { type EmailOtpType } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isConfigured } from "@/lib/supabase/config";

export async function GET(request: NextRequest) {
  if (!isConfigured()) return new NextResponse(null, { status: 303, headers: { Location: "/" } });
  const tokenHash = request.nextUrl.searchParams.get("token_hash");
  const type = request.nextUrl.searchParams.get("type");
  if (tokenHash && ["signup", "email", "recovery"].includes(type ?? "")) {
    const client = await createClient();
    const { error } = await client.auth.verifyOtp({ token_hash: tokenHash, type: type as EmailOtpType });
    if (!error) return new NextResponse(null, { status: 303, headers: { Location: type === "recovery" ? "/auth?mode=update" : "/" } });
  }
  return new NextResponse(null, { status: 303, headers: { Location: "/auth?error=The+email+link+is+invalid+or+expired.+Please+try+again." } });
}
