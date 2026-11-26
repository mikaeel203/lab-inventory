"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowUpRight, Bell, Building2, FlaskConical, GraduationCap, History, LayoutGrid, LogOut, Plus, RefreshCw, ScanLine, ShieldCheck, Users } from "lucide-react";
import { createClient } from "@/lib/supabase/browser";
import type { AuditEvent, Item, JoinInbox, JoinRequest, Lab, Membership, Profile, QuantityRequest } from "@/lib/types";
import { InventoryList } from "./inventory-list";
import { ItemEditor, type ItemDraft } from "./item-editor";
import { LabDirectory } from "./lab-directory";
import { RequestInbox } from "./request-inbox";
import { Scanner } from "./scanner";
import { Modal } from "./modal";
import { InstallApp } from "./install-app";
import { stockStatus } from "@/lib/inventory";
import { ConfirmationDialog, type Confirmation } from "./confirmation-dialog";
import { startWorkspaceSync } from "@/lib/workspace-sync";
import { localCatalogueMatches } from "@/lib/catalogue";

type Snapshot = { labs: Lab[]; lab?: Lab; items: Item[]; memberships: Membership[]; joins: JoinRequest[]; inbox: JoinInbox[]; quantities: QuantityRequest[]; profiles: Profile[]; audit: AuditEvent[] };
type Editor = { item?: Item; barcode?: string; format?: string };
type Result = { error: { message: string } | null; data?: unknown };

async function readAll<T>(query: (start: number, end: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>): Promise<T[]> {
  const rows: T[] = [];
  for (let start = 0; ; start += 500) {
    const { data, error } = await query(start, start + 499);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []) as T[]);
    if (!data || data.length < 500) return rows;
  }
}

export function Dashboard({ profile }: { profile: Profile }) {
  const client = useMemo(() => createClient(), []);
  const router = useRouter();
  const owner = profile.role === "lab";
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [tab, setTab] = useState("inventory");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [notice, setNotice] = useState("");
  const [scanning, setScanning] = useState(false);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const selectedLab = useRef("");
  const generation = useRef(0);
  const lock = useRef(false);
  const refreshing = useRef(0);

  const refresh = useCallback(async (labId?: string, background = false) => {
    const current = ++generation.current;
    refreshing.current++;
    if (labId !== undefined) selectedLab.current = labId;
    setLoading(true);
    try {
      const memberships = await readAll<Membership>((start, end) => client.from("memberships").select("*").eq("active", true).order("id").range(start, end));
      const joins = owner ? [] : await readAll<JoinRequest>((start, end) => client.from("join_requests").select("*").order("created_at", { ascending: false }).order("id").range(start, end));
      const labIds = [...new Set([...memberships.map(member => member.lab_id), ...joins.map(join => join.lab_id)])];
      const labs = owner
        ? await readAll<Lab>((start, end) => client.from("labs").select("*").eq("owner_id", profile.id).order("id").range(start, end))
        : labIds.length ? await readAll<Lab>((start, end) => client.from("labs").select("*").in("id", labIds).order("name").order("id").range(start, end)) : [];
      const available = labs.filter(lab => owner || memberships.some(member => member.lab_id === lab.id));
      const lab = available.find(entry => entry.id === selectedLab.current) ?? available[0];
      const [items, quantities, profiles, audit] = await Promise.all([
        lab ? readAll<Item>((start, end) => client.from("inventory_items").select("*").eq("lab_id", lab.id).order("id").range(start, end)) : [],
        readAll<QuantityRequest>((start, end) => {
          let query = client.from("quantity_requests").select("*").order("created_at", { ascending: false }).order("id");
          if (owner && lab) query = query.eq("lab_id", lab.id);
          return query.range(start, end);
        }),
        owner ? readAll<Profile>((start, end) => client.from("profiles").select("id,role,display_name").order("id").range(start, end)) : [profile],
        owner && lab ? client.from("audit_events").select("*").eq("lab_id", lab.id).order("created_at", { ascending: false }).limit(100).then(result => { if (result.error) throw new Error(result.error.message); return result.data as AuditEvent[]; }) : [],
      ]);
      let inbox: JoinInbox[] = [];
      if (owner && lab) {
        inbox = await readAll<JoinInbox>((start, end) => client.rpc("membership_inbox", { p_lab_id: lab.id }).range(start, end));
      }
      if (current === generation.current) {
        selectedLab.current = lab?.id ?? "";
        setSnapshot({ labs, lab, items, memberships, joins, inbox, quantities, profiles, audit });
        setLoadError("");
        if (!background) setError("");
        setEditor(previous => previous?.item && !items.some(item => item.id === previous.item!.id) ? null : previous);
      }
    } catch (failure) {
      if (current === generation.current) { setSnapshot(null); setLoadError(failure instanceof Error ? failure.message : "Could not load your lab. Reconnect and try again."); }
    } finally { refreshing.current--; if (current === generation.current) setLoading(false); }
  }, [client, owner, profile]);

  useEffect(() => {
    void refresh();
    const enabled = () => document.visibilityState === "visible" && !lock.current && !refreshing.current;
    const update = () => { if (enabled()) void refresh(undefined, true); };
    const stopSync = startWorkspaceSync(client, profile.id, () => { void refresh(undefined, true); }, enabled);
    window.addEventListener("focus", update); window.addEventListener("online", update);
    document.addEventListener("visibilitychange", update);
    const { data: subscription } = client.auth.onAuthStateChange(event => {
      if (event === "SIGNED_OUT") { generation.current++; setSnapshot(null); router.replace("/auth"); router.refresh(); }
    });
    return () => {
      generation.current++; stopSync();
      window.removeEventListener("focus", update); window.removeEventListener("online", update);
      document.removeEventListener("visibilitychange", update);
      subscription.subscription.unsubscribe();
    };
  }, [client, refresh, router, profile.id]);

  async function perform(action: () => PromiseLike<Result>, message: string): Promise<boolean> {
    if (lock.current) return false;
    lock.current = true; setBusy(true); setNotice(""); setError("");
    try {
      const result = await action();
      if (result.error) throw new Error(result.error.message.includes("duplicate key") ? "There is already a matching product or pending request. Refresh and review the existing entry." : result.error.message);
      await refresh();
      setNotice(result.data === "stale" ? "The product changed. This request is now stale; the student must resubmit." : result.data === "cancelled" ? "The request is no longer eligible because membership ended." : message);
      return true;
    } catch (failure) {
      await refresh();
      setError(failure instanceof Error ? failure.message : "Something went wrong. Please try again.");
      return false;
    } finally { lock.current = false; setBusy(false); }
  }

  async function save(draft: ItemDraft) {
    if (!snapshot?.lab || !editor) return false;
    const result = await perform(() => owner
      ? client.rpc(draft.confirmProduct ? "save_catalogued_inventory_item" : "save_inventory_item", { p_lab_id: snapshot.lab!.id, p_name: draft.name, p_quantity: draft.quantity, p_unit: draft.unit,
        p_barcode: draft.barcode || null, p_barcode_format: draft.format || null, p_product_url: draft.url || null,
        p_item_id: editor.item?.id ?? null, p_version: editor.item?.version ?? null, p_catalogue_number: draft.catalogueNumber,
        p_manufacturer_supplier: draft.manufacturerSupplier, p_container_count: draft.containerCount, p_container_size: draft.containerSize,
        p_minimum_containers: draft.minimumContainers, p_minimum_quantity: draft.minimumQuantity,
        ...(draft.confirmProduct ? { p_confirm_product: true, p_confirm_code: draft.confirmCode, p_confirm_url: draft.confirmUrl } : {}) })
      : client.rpc("request_quantity_change", { p_item_id: editor.item!.id, p_quantity: draft.quantity, p_unit: draft.unit, p_version: editor.item!.version, p_reason: draft.reason || null, p_container_count: draft.containerCount }),
    owner ? draft.confirmProduct ? "Inventory updated. Confirmed product details remembered in the shared catalogue; your lab’s stock remains private." : "Inventory updated." : "Change request sent to your lab for approval.");
    if (result) setEditor(null);
    return result;
  }

  const lab = snapshot?.lab;
  const activeItems = snapshot?.items.filter(item => !item.archived) ?? [];
  const pending = (owner ? snapshot?.inbox : snapshot?.joins)?.filter(request => request.status === "pending").length ?? 0;
  const pendingTotal = pending + (snapshot?.quantities.filter(request => request.status === "pending").length ?? 0);
  const nav = [
    { id: "inventory", label: "Inventory", icon: LayoutGrid },
    { id: "requests", label: "Requests", icon: Bell },
    { id: owner ? "people" : "labs", label: owner ? "Students" : "Find a lab", icon: owner ? Users : Building2 },
    ...(owner ? [{ id: "history", label: "Activity", icon: History }] : []),
  ];

  return <div className="app-shell">
    <aside className="sidebar"><a className="brand" href="/"><span className="brand-icon"><FlaskConical /></span><span><span className="brand-title">BenchMark <span className="beta-badge">beta</span></span><small>SPACE FOR SCIENCE</small></span></a>
      <div className="workspace-label">WORKSPACE</div>
      <nav aria-label="Main navigation">{nav.map(({ id, label, icon: Icon }) => <button key={id} className={`nav-link ${tab === id ? "selected" : ""}`} onClick={() => setTab(id)} aria-current={tab === id ? "page" : undefined}><Icon size={19} /><span>{label}</span>{id === "requests" && pendingTotal > 0 && <span className="nav-count">{pendingTotal}</span>}</button>)}</nav>
      <div className="sidebar-bottom"><div className="privacy-card"><ShieldCheck size={22} /><strong>Your lab. Your data.</strong><p>Only approved members can see what’s on your shelves.</p></div></div>
    </aside>
    <div className="main-shell"><header className="topbar"><div className="workspace-title"><span className="mobile-mark"><FlaskConical size={21} /></span><span>{owner ? "Lab workspace" : "Student workspace"}</span><span className="role-pill">{owner ? "Lab admin" : "Student"}</span></div>
      <div className="account-area"><span className="avatar">{profile.display_name.slice(0, 1).toUpperCase()}</span><span className="account-name">{profile.display_name}</span><button className="icon-button" aria-label="Sign out" onClick={async () => {
        const { error: failure } = await client.auth.signOut();
        if (failure) setError(failure.message); else { generation.current++; setSnapshot(null); router.replace("/auth"); router.refresh(); }
      }}><LogOut size={18} /></button></div>
    </header>
    <main className="workspace"><div className="page-heading"><div><span className="eyebrow">{lab ? `${lab.institution} / ${lab.department}` : "WELCOME TO YOUR WORKSPACE"}</span><h1>{tab === "inventory" ? "A clearer view of your lab." : tab === "requests" ? "Keep everyone in the loop." : tab === "people" ? "Good science is a team effort." : tab === "history" ? "Every change, accounted for." : "Find where you belong."}</h1><p>{tab === "inventory" ? "Know what you have. Find what you need." : "Connected people. Clear records."}</p></div>
      <button className="button secondary refresh" onClick={() => void refresh()} disabled={loading || busy} aria-label="Refresh workspace"><RefreshCw size={16} className={loading ? "spin" : ""} /><span>Refresh</span></button></div>
      {notice && <p className="message success" role="status">{notice}</p>}
      {(error || loadError) && <p className="message error" role="alert">{error || loadError}</p>}
      {!snapshot && loading && <div className="panel empty-state" role="status">Loading your workspace…</div>}
      {snapshot && <>
        {snapshot.memberships.length > 0 && !owner && <div className="lab-switcher"><label>Current lab<select value={lab?.id ?? ""} disabled={busy || loading} onChange={event => { setEditor(null); void refresh(event.target.value); }}>{snapshot.labs.filter(entry => snapshot.memberships.some(member => member.lab_id === entry.id)).map(entry => <option key={entry.id} value={entry.id}>{entry.name} · {entry.institution}</option>)}</select></label><button className="text-button danger" disabled={busy} onClick={() => {
          if (lab) { setError(""); setConfirmation({ title: "Leave lab?", message: `Leave ${lab.name}? You will lose inventory access and pending quantity requests will be cancelled.`, label: "Leave lab", action: () => perform(() => client.rpc("end_membership", { p_lab_id: lab.id, p_student_id: profile.id }), "You have left the lab.") }); }
        }}>Leave lab</button></div>}
        {tab === "inventory" && (lab ? <>
          <section className="stats-grid"><div className="stat-card"><span className="stat-icon"><FlaskConical /></span><div><span>Products tracked</span><strong>{activeItems.length}</strong></div></div><div className="stat-card"><span className="stat-icon warm"><LayoutGrid /></span><div><span>Depleted / Low stock</span><strong>{activeItems.filter(item => stockStatus(item) === "depleted").length} / {activeItems.filter(item => stockStatus(item) === "low").length}</strong></div></div><button className="stat-card stat-button" onClick={() => setTab("requests")}><span className="stat-icon lavender"><Bell /></span><div><span>Pending requests</span><strong>{pendingTotal}</strong></div><ArrowUpRight size={18} /></button></section>
          <div className="inventory-heading"><div><h2>{lab.name}</h2><p className="muted">{owner ? "Your shared record of what’s on the shelf." : "Read-only access · Request a change to update a quantity."}</p></div>{owner && <div className="inventory-buttons"><button className="button secondary" onClick={() => { setError(""); setEditor({}); }} disabled={busy}><Plus size={17} />Add manually</button><button className="button primary" onClick={() => setScanning(true)} disabled={busy}><ScanLine size={18} />Scan product</button></div>}</div>
          <InventoryList items={snapshot.items} owner={owner} busy={busy} onEdit={item => { setError(""); setEditor({ item }); }}
            onArchive={item => { setError(""); setConfirmation({ title: "Archive product?", message: `Archive ${item.name}? It will be hidden from students. You can restore it later from archived inventory.`, label: "Archive product", action: () => perform(() => client.rpc("archive_inventory_item", { p_item_id: item.id, p_version: item.version }), "Product archived.") }); }}
            onDelete={item => { setError(""); setConfirmation({ title: "Permanently delete product?", message: `Delete ${item.name} permanently? This also removes its change requests and cannot be undone. An audit record is retained. Archive instead if you might need it again.`, label: "Delete permanently", action: () => perform(() => client.rpc("delete_inventory_item", { p_item_id: item.id, p_version: item.version }), "Product permanently deleted.") }); }} />
          <div className="inventory-note"><ShieldCheck size={17} /><span>{owner ? "Students can view inventory. Every quantity change they request needs your approval." : "Your lab reviews every quantity-change request before inventory is updated."}</span></div>
        </> : <section className="panel welcome-panel"><GraduationCap size={42} /><span className="eyebrow">YOUR NEXT STEP</span><h2>Let’s connect you with your lab.</h2><p>Search for your institution’s lab and request to join. Once approved, you can see available products and propose quantity changes.</p><button className="button primary" onClick={() => setTab("labs")}><Building2 size={18} />Find a lab</button></section>)}
        {tab === "labs" && !owner && <LabDirectory memberships={snapshot.memberships} requests={snapshot.joins} busy={busy} onRequest={target => void perform(() => client.rpc("request_membership", { p_lab_id: target.id }), "Membership request sent.")} onCancel={request => void perform(() => client.rpc("cancel_join_request", { p_request_id: request.id }), "Membership request cancelled.")} />}
        {tab === "requests" && <RequestInbox owner={owner} joins={owner ? snapshot.inbox : snapshot.joins} quantities={snapshot.quantities} items={snapshot.items} profiles={snapshot.profiles} labs={snapshot.labs} busy={busy}
          onJoinDecision={(request, approve, acknowledge, response) => void perform(() => client.rpc("decide_membership", { p_request_id: request.id, p_approve: approve, p_acknowledge: acknowledge, p_response: response }), approve ? "Student accepted into the lab." : "Membership request rejected.")}
          onQuantityDecision={(request, approve, response) => void perform(() => client.rpc("decide_quantity_change", { p_request_id: request.id, p_approve: approve, p_response: response }), approve ? "Quantity change approved." : "Quantity change rejected.")} />}
        {tab === "people" && owner && <section className="panel"><div className="section-heading"><div><h2>Lab students</h2><p className="muted">Approved students can view products and request quantity changes.</p></div><Users /></div>{snapshot.memberships.length ? snapshot.memberships.map(member => <div className="member-row" key={member.id}><span className="avatar"><GraduationCap size={19} /></span><div><h3>{snapshot.profiles.find(entry => entry.id === member.student_id)?.display_name ?? "Student"}</h3><small>Joined {new Date(member.created_at).toLocaleDateString()}</small></div><button className="button secondary danger" disabled={busy} onClick={() => {
          setError(""); setConfirmation({ title: "Remove student access?", message: `Remove ${snapshot.profiles.find(entry => entry.id === member.student_id)?.display_name ?? "this student"} from your lab? Pending quantity requests will be cancelled.`, label: "Remove access", action: () => perform(() => client.rpc("end_membership", { p_lab_id: member.lab_id, p_student_id: member.student_id }), "Student access removed.") });
        }}>Remove access</button></div>) : <div className="empty-state"><Users size={34} /><h3>No students yet</h3><p>Students can find this lab by name and request to join.</p></div>}</section>}
        {tab === "history" && owner && <section className="panel"><div className="section-heading"><div><h2>Lab activity</h2><p className="muted">The latest 100 recorded actions. Full history is retained in the database.</p></div><History /></div>{snapshot.audit.length ? <ul className="activity-list">{snapshot.audit.map(event => <li key={event.id}><span className="activity-dot" /><div><strong>{event.action.replaceAll(".", " · ").replaceAll("_", " ")}</strong>{typeof event.details.name === "string" && <p>{event.details.name}</p>}{event.details.quantity !== undefined && <small>Proposed / recorded: {String(event.details.quantity)} {String(event.details.unit)}</small>}<small>{new Date(event.created_at).toLocaleString()}</small></div></li>)}</ul> : <div className="empty-state"><History /><h3>A clean page</h3><p>Product updates and approval decisions will appear here.</p></div>}</section>}
      </>}
      <footer className="workspace-footer"><span className="brand-title">BenchMark <span className="beta-badge">beta</span></span><span>Made for the bench, not the paperwork.</span></footer>
      <InstallApp />
    </main></div>
    {scanning && <Modal title="Scan a product" onClose={() => setScanning(false)}><Scanner onScan={(barcode, format) => {
      setScanning(false); setError("");
      const local = format === "CATALOGUE_NUMBER" ? localCatalogueMatches(snapshot?.items ?? [], barcode) : (snapshot?.items ?? []).filter(item => item.barcode === barcode);
      setEditor({ item: local.length === 1 ? local[0] : undefined, barcode, format });
    }} /></Modal>}
    {editor && <Modal title={owner ? editor.item ? "Edit product" : "Add a product" : "Request a quantity change"} onClose={() => { if (!busy) setEditor(null); }}>{error && <p role="alert" className="message error">{error}</p>}<ItemEditor key={editor.item?.id ?? `${editor.format}:${editor.barcode}`} item={editor.item} barcode={editor.barcode} format={editor.format} student={!owner} busy={busy} onSave={save} items={snapshot?.items ?? []} onOpenItem={item => { setError(""); setEditor({ item }); }} /></Modal>}
    {confirmation && <ConfirmationDialog confirmation={confirmation} busy={busy} error={error} onClose={() => { setConfirmation(null); setError(""); }} onConfirm={() => { void confirmation.action().then(success => { if (success) setConfirmation(null); }); }} />}
  </div>;
}
