import { Suspense } from "react";
import { AuthForm } from "@/components/auth-form";
import { isConfigured } from "@/lib/supabase/config";
import { redirect } from "next/navigation";

export default function AuthPage() {
  if (!isConfigured()) redirect("/");
  return <Suspense fallback={<main className="narrow">Loading…</main>}><AuthForm /></Suspense>;
}
