import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isConfigured } from "@/lib/supabase/config";
import { lookupProduct, safeLookupUrl } from "@/lib/lookup";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (!host || (origin !== `https://${host}` && origin !== `http://${host}`)) return NextResponse.json({ error: "Invalid origin." }, { status: 403 });
  if (!isConfigured()) return NextResponse.json({ error: "Backend not configured." }, { status: 503 });
  const client = await createClient();
  const { data: { user } } = await client.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const { data: profile } = await client.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "lab" && profile?.role !== "student") return NextResponse.json({ error: "Lab account or approved student membership required." }, { status: 403 });
  if (!request.body) return NextResponse.json({ error: "A URL is required." }, { status: 400 });
  const reader = request.body.getReader();
  let text = "";
  let size = 0;
  const decoder = new TextDecoder();
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 4096) { await reader.cancel(); return NextResponse.json({ error: "Request too large." }, { status: 413 }); }
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
    const body = JSON.parse(text);
    if (typeof body.url !== "string") throw new Error("URL required.");
    safeLookupUrl(body.url);
    const { data: allowed, error } = await client.rpc("reserve_lookup");
    if (error?.code === "42501") return NextResponse.json({ error: "Lab account or approved student membership required." }, { status: 403 });
    if (error) return NextResponse.json({ error: "Lookup unavailable. Enter the name manually." }, { status: 503 });
    if (!allowed) return NextResponse.json({ error: "Lookup limit reached. Wait a minute or enter the name manually." }, { status: 429 });
    try {
      return NextResponse.json(await lookupProduct(body.url), { headers: { "Cache-Control": "private, no-store" } });
    } catch {
      return NextResponse.json({ name: null, catalogue_number: null, source: null, message: "No reliable details found. Enter the product name and catalogue number manually." });
    }
  } catch {
    return NextResponse.json({ error: "This URL cannot be looked up. Enter the product name manually." }, { status: 400 });
  }
}
