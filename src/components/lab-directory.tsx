"use client";

import { useEffect, useMemo, useState } from "react";
import { Building2, Search } from "lucide-react";
import { createClient } from "@/lib/supabase/browser";
import type { JoinRequest, Lab, Membership } from "@/lib/types";

export function LabDirectory({ memberships, requests, busy, onRequest, onCancel }: {
  memberships: Membership[]; requests: JoinRequest[]; busy: boolean;
  onRequest: (lab: Lab) => void; onCancel: (request: JoinRequest) => void;
}) {
  const [search, setSearch] = useState("");
  const [labs, setLabs] = useState<Lab[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const client = useMemo(() => createClient(), []);
  useEffect(() => {
    let disposed = false;
    const timer = setTimeout(async () => {
      setLoading(true); setError("");
      let query = client.from("labs").select("*").order("name").limit(50);
      const text = search.replace(/[%_,()."\\]/g, " ").trim().slice(0, 100);
      if (text) query = query.or(`name.ilike.%${text}%,department.ilike.%${text}%,institution.ilike.%${text}%`);
      const { data, error: failure } = await query;
      if (!disposed) { setLabs((data ?? []) as Lab[]); setError(failure?.message ?? ""); setLoading(false); }
    }, 250);
    return () => { disposed = true; clearTimeout(timer); };
  }, [search, client]);
  return <section className="panel directory-panel"><div className="section-heading"><div><h2>Find your lab</h2><p className="muted">Search by lab, department, or institution. Inventory stays private until you’re approved.</p></div></div>
    {memberships.length > 0 && <p className="message info">You already belong to a lab. Another lab must acknowledge your existing membership before accepting you. Your current access will remain unchanged.</p>}
    <label className="search-field directory-search"><Search size={19} /><input aria-label="Search labs" placeholder="Lab name, department, or institution…" value={search} onChange={event => setSearch(event.target.value)} /></label>
    {error && <p role="alert" className="message error">{error}</p>}
    {loading ? <p className="loading-note" role="status">Finding labs…</p> : <div className="directory-list">{labs.map(lab => {
      const member = memberships.some(membership => membership.lab_id === lab.id);
      const pending = requests.find(request => request.lab_id === lab.id && request.status === "pending");
      return <article className="directory-row" key={lab.id}><span className="chemical-icon"><Building2 size={22} /></span><div><h3>{lab.name}</h3><p>{lab.department}</p><small>{lab.institution}</small></div>
        {member ? <span className="status approved">Member</span> : pending ? <button className="button secondary" disabled={busy} onClick={() => onCancel(pending)}>Cancel request</button> : <button className="button primary" disabled={busy} onClick={() => onRequest(lab)}>Request to join</button>}
      </article>;
    })}{!labs.length && <div className="empty-state"><Building2 /><h3>No labs found</h3><p>Try another search or ask your lab to create an account.</p></div>}</div>}
    {labs.length === 50 && <p className="field-hint">Showing the first 50 matches. Refine your search to find more.</p>}
  </section>;
}
