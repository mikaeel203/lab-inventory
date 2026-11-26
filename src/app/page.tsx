import { redirect } from "next/navigation";
import { FlaskConical, ArrowUpRight, ShieldCheck, ScanLine, ListFilter } from "lucide-react";
import { isConfigured } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";
import { Dashboard } from "@/components/dashboard";
import type { Profile } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function Home() {
  if (!isConfigured()) return <main className="setup-page">
    <div className="brand"><span className="brand-icon"><FlaskConical /></span><span className="brand-title">BenchMark <span className="beta-badge">beta</span></span></div>
    <section className="setup-hero"><span className="eyebrow">LESS ADMIN. MORE DISCOVERY.</span>
      <h1>Your lab.<br /><em>Accounted for.</em></h1>
      <p>A shared, up-to-date view of what’s on your shelves. Scan a label, record what’s left, and keep your team in the loop.</p>
      <div className="setup-features"><span><ScanLine /> Scan & record</span><span><ListFilter /> Find it faster</span><span><ShieldCheck /> Lab-approved changes</span></div>
    </section>
    <section className="panel setup-card"><span className="eyebrow">LET’S GET CONNECTED</span><h2>Connect your lab’s backend</h2>
      <p>The app is installed. Connect Supabase to enable real accounts and private inventories.</p>
      <ol><li>Create a Supabase project and run the included database migration.</li><li>Copy <code>.env.example</code> to <code>.env.local</code> and fill in your project URL and publishable key.</li><li>Configure authentication redirects and restart the app.</li></ol>
      <p className="muted">Full instructions are in the project’s <code>README.md</code>. No sample accounts or inventory are exposed.</p>
      <span className="setup-foot">Built for the bench. Ready for your phone. <ArrowUpRight size={18} /></span>
    </section>
  </main>;
  const client = await createClient();
  const { data: { user } } = await client.auth.getUser();
  if (!user) redirect("/auth");
  const { data: profile, error } = await client.from("profiles").select("id,role,display_name").eq("id", user.id).single();
  if (error || !profile) return <main className="narrow panel"><h1>Account setup needs attention</h1><p>We couldn’t load your profile. Confirm the database migration is installed, then try again.</p><a href="/auth">Return to sign in</a></main>;
  return <Dashboard profile={profile as Profile} />;
}
