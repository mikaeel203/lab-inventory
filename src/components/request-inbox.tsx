"use client";

import { useState } from "react";
import { Check, Inbox, ShieldAlert, X } from "lucide-react";
import type { Item, JoinInbox, JoinRequest, Lab, ProductRequest, Profile, QuantityRequest } from "@/lib/types";
import { productUrl } from "@/lib/inventory";

export function RequestInbox({ owner, joins, quantities, products, items, profiles, labs, busy, onJoinDecision, onQuantityDecision, onProductDecision, onProductCancel }: {
  owner: boolean; joins: (JoinInbox | JoinRequest)[]; quantities: QuantityRequest[]; products: ProductRequest[]; items: Item[]; profiles: Profile[]; labs: Lab[]; busy: boolean;
  onJoinDecision: (request: JoinInbox, approve: boolean, acknowledge: boolean, response: string) => void;
  onQuantityDecision: (request: QuantityRequest, approve: boolean, response: string) => void;
  onProductDecision: (request: ProductRequest, approve: boolean, response: string) => void;
  onProductCancel: (request: ProductRequest) => void;
}) {
  return <section className="panel requests-panel"><div className="section-heading"><div><h2>{owner ? "Review requests" : "Your requests"}</h2><p className="muted">{owner ? "You decide who joins and what changes." : "Follow your membership, new-product and quantity-change requests."}</p></div><Inbox size={23} /></div>
    {!joins.length && !quantities.length && !products.length && <div className="empty-state"><Inbox size={34} /><h3>All caught up</h3><p>Membership, new-product and quantity-change requests will appear here.</p></div>}
    {joins.length > 0 && <h3 className="subheading">Lab memberships</h3>}
    {joins.map(request => <DecisionCard key={request.id} title={owner && "display_name" in request ? request.display_name : labs.find(lab => lab.id === request.lab_id)?.name ?? "Lab membership"}
      subtitle={owner ? "Wants to join your lab" : "Membership request"} status={request.status} response={request.response} date={request.created_at}
      owner={owner} busy={busy} warning={"existing_memberships" in request && request.existing_memberships > 0}
      onDecision={(approve, acknowledge, response) => onJoinDecision(request as JoinInbox, approve, acknowledge, response)} />)}
    {products.length > 0 && <h3 className="subheading">New products</h3>}
    {products.map(request => <DecisionCard key={request.id} title={request.name} status={request.status} response={request.response} date={request.created_at}
      subtitle={owner ? `New product · Requested by ${profiles.find(profile => profile.id === request.student_id)?.display_name ?? "student"}` : `New product · ${labs.find(lab => lab.id === request.lab_id)?.name ?? "Lab"}`}
      owner={owner} busy={busy} onDecision={(approve, _acknowledge, response) => onProductDecision(request, approve, response)}>
      <dl className="request-product-details">
        <div><dt>Manufacturer/Supplier</dt><dd>{request.manufacturer_supplier}</dd></div>
        <div><dt>Catalogue Number</dt><dd>{request.catalogue_number ?? "Not recorded"}</dd></div>
        <div><dt>Number of units</dt><dd>{Number(request.container_count).toLocaleString()}</dd></div>
        <div><dt>Amount per unit</dt><dd>{Number(request.container_size).toLocaleString(undefined, { maximumFractionDigits: 12 })} {request.unit}</dd></div>
        <div><dt>Total remaining quantity</dt><dd>{Number(request.quantity).toLocaleString(undefined, { maximumFractionDigits: 12 })} {request.unit}</dd></div>
        {request.barcode && <div><dt>Barcode / scanned value</dt><dd>{request.barcode}</dd></div>}
        {request.product_url && <div><dt>Product link</dt><dd>{productUrl(request.product_url) ? <a href={productUrl(request.product_url)!} target="_blank" rel="noopener noreferrer">{request.product_url}</a> : "Invalid product link"}</dd></div>}
      </dl>
      {request.reason && <p className="request-reason">{request.reason}</p>}
      {owner && request.status === "pending" && <p className="field-hint">Verify the product and amounts before approving. Approval adds a new inventory entry; it does not publish to the shared catalogue.</p>}
      {!owner && request.status === "pending" && <button className="button secondary" disabled={busy} onClick={() => onProductCancel(request)}>Withdraw request</button>}
    </DecisionCard>)}
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
