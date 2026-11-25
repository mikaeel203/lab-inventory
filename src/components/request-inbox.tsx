"use client";

import { useState } from "react";
import { Check, Inbox, ShieldAlert, X } from "lucide-react";
import type { Item, JoinInbox, JoinRequest, Lab, Profile, QuantityRequest } from "@/lib/types";

export function RequestInbox({ owner, joins, quantities, items, profiles, labs, busy, onJoinDecision, onQuantityDecision }: {
  owner: boolean; joins: (JoinInbox | JoinRequest)[]; quantities: QuantityRequest[]; items: Item[]; profiles: Profile[]; labs: Lab[]; busy: boolean;
  onJoinDecision: (request: JoinInbox, approve: boolean, acknowledge: boolean, response: string) => void;
  onQuantityDecision: (request: QuantityRequest, approve: boolean, response: string) => void;
}) {
  return <section className="panel requests-panel"><div className="section-heading"><div><h2>{owner ? "Review requests" : "Your requests"}</h2><p className="muted">{owner ? "You decide who joins and what changes." : "Follow your membership and quantity-change requests."}</p></div><Inbox size={23} /></div>
    {!joins.length && !quantities.length && <div className="empty-state"><Inbox size={34} /><h3>All caught up</h3><p>Membership and quantity-change requests will appear here.</p></div>}
    {joins.length > 0 && <h3 className="subheading">Lab memberships</h3>}
    {joins.map(request => <DecisionCard key={request.id} title={owner && "display_name" in request ? request.display_name : labs.find(lab => lab.id === request.lab_id)?.name ?? "Lab membership"}
      subtitle={owner ? "Wants to join your lab" : "Membership request"} status={request.status} response={request.response} date={request.created_at}
      owner={owner} busy={busy} warning={"existing_memberships" in request && request.existing_memberships > 0}
      onDecision={(approve, acknowledge, response) => onJoinDecision(request as JoinInbox, approve, acknowledge, response)} />)}
    {quantities.length > 0 && <h3 className="subheading">Quantity changes</h3>}
    {quantities.map(request => {
      const item = items.find(entry => entry.id === request.item_id);
      const stale = request.status === "pending" && item && (item.archived || item.version !== request.base_version);
      return <DecisionCard key={request.id} title={request.item_name} status={request.status} response={request.response} date={request.created_at}
        subtitle={owner ? `Requested by ${profiles.find(profile => profile.id === request.student_id)?.display_name ?? "student"}` : labs.find(lab => lab.id === request.lab_id)?.name ?? "Quantity request"}
        owner={owner} busy={busy} onDecision={(approve, _acknowledge, response) => onQuantityDecision(request, approve, response)}>
        <div className="change-comparison">{item && <span>Current <strong>{Number(item.quantity).toLocaleString()} {item.unit}</strong><small>{item.container_count ?? "Unknown"} units</small></span>}<span>Proposed <strong>{Number(request.quantity).toLocaleString()} {request.unit}</strong><small>{request.container_count ?? "Not recorded"} units</small></span></div>
        {request.reason && <p className="request-reason">{request.reason}</p>}
        {stale && <p className="message info">This product changed since the request. Reviewing it will mark it stale without changing inventory; the student must resubmit.</p>}
      </DecisionCard>;
    })}
  </section>;
}

function DecisionCard({ title, subtitle, status, response, date, owner, busy, warning = false, children, onDecision }: {
  title: string; subtitle: string; status: string; response: string | null; date: string; owner: boolean; busy: boolean;
  warning?: boolean; children?: React.ReactNode; onDecision: (approve: boolean, acknowledge: boolean, response: string) => void;
}) {
  const [acknowledge, setAcknowledge] = useState(false);
  const [reply, setReply] = useState("");
  return <article className="request-card"><div className="request-heading"><div><h3>{title}</h3><p>{subtitle}</p><small>{new Date(date).toLocaleString()}</small></div><span className={`status ${status}`}>{status}</span></div>
    {children}
    {response && <p className="request-reason">Lab response: {response}</p>}
    {owner && status === "pending" && <>
      {warning && <div className="membership-warning"><p><ShieldAlert size={20} /><strong>This student already belongs to another lab.</strong></p><label className="checkbox-label"><input type="checkbox" checked={acknowledge} onChange={event => setAcknowledge(event.target.checked)} /> I acknowledge their existing membership and allow an additional membership in this lab.</label></div>}
      <label>Response <span className="muted">(optional)</span><input maxLength={1000} value={reply} onChange={event => setReply(event.target.value)} placeholder="Add a note for the student" /></label>
      <div className="decision-actions"><button className="button secondary" disabled={busy} onClick={() => onDecision(false, acknowledge, reply)}><X size={16} />Reject</button><button className="button primary" disabled={busy || (warning && !acknowledge)} onClick={() => onDecision(true, acknowledge, reply)}><Check size={16} />Approve</button></div>
    </>}
  </article>;
}
