"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Sparkles, ExternalLink } from "lucide-react";
import { units, validQuantity, productUrl, needsStockSetup, withinContainerCapacity } from "@/lib/inventory";
import type { Item, Unit } from "@/lib/types";

export type ItemDraft = { name: string; catalogueNumber: string; barcode: string; format: string; quantity: number; unit: Unit; url: string; reason: string;
  manufacturerSupplier: string; containerCount: number; containerSize: number; minimumContainers: number | null; minimumQuantity: number | null };

export function ItemEditor({ item, barcode = "", format = "", student, busy, onSave }: {
  item?: Item; barcode?: string; format?: string; student: boolean; busy: boolean;
  onSave: (draft: ItemDraft) => Promise<boolean>;
}) {
  const [name, setName] = useState(item?.name ?? "");
  const [catalogueNumber, setCatalogueNumber] = useState(item?.catalogue_number ?? "");
  const [manufacturerSupplier, setManufacturerSupplier] = useState(item?.manufacturer_supplier ?? "");
  const [containerCount, setContainerCount] = useState(item?.container_count == null ? "" : String(item.container_count));
  const [containerSize, setContainerSize] = useState(item?.container_size == null ? "" : String(item.container_size));
  const [minimumContainers, setMinimumContainers] = useState(item?.minimum_containers == null ? "" : String(item.minimum_containers));
  const [minimumQuantity, setMinimumQuantity] = useState(item?.minimum_quantity == null ? "" : String(item.minimum_quantity));
  const [code, setCode] = useState(item?.barcode ?? barcode);
  const [quantity, setQuantity] = useState(item ? String(item.quantity) : "");
  const [unit, setUnit] = useState<Unit>(item?.unit ?? "mL");
  const [url, setUrl] = useState(item?.product_url ?? productUrl(barcode) ?? "");
  const [reason, setReason] = useState("");
  const [lookupMessage, setLookupMessage] = useState("");
  const [error, setError] = useState("");
  const nameTouched = useRef(false);
  const catalogueTouched = useRef(false);
  useEffect(() => {
    const scannedUrl = productUrl(barcode);
    if (item || student || !scannedUrl) {
      if (!item && barcode) setLookupMessage("New barcode. Enter its name and catalogue number; this lab will remember them next time.");
      return;
    }
    const controller = new AbortController();
    setLookupMessage("Looking for the product name and catalogue number… You can also enter them yourself.");
    void fetch("/api/lookup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: scannedUrl }), signal: controller.signal, cache: "no-store" })
      .then(response => response.json()).then(result => {
        if (controller.signal.aborted) return;
        if (result.name && !nameTouched.current) setName(result.name);
        if (result.catalogue_number && !catalogueTouched.current) setCatalogueNumber(result.catalogue_number);
        setLookupMessage(result.name || result.catalogue_number ? `${result.source ?? "Product metadata"}. Verify suggestions against the label and enter any missing details.` : result.error ?? result.message ?? "Enter the product details manually.");
      }).catch(() => { if (!controller.signal.aborted) setLookupMessage("Lookup unavailable. Enter the name and catalogue number manually."); });
    return () => controller.abort();
  }, [barcode, item, student]);

  async function submit(event: FormEvent) {
    event.preventDefault(); setError("");
    if (!validQuantity(quantity, unit)) { setError("Enter a nonnegative amount up to 1 trillion. Counts must be whole numbers."); return; }
    if (!manufacturerSupplier.trim()) { setError("Manufacturer/Supplier is required. Ask the lab to complete this product first if you are a student."); return; }
    if (!validQuantity(containerCount, "count") || !validQuantity(containerSize, unit) || Number(containerSize) <= 0) { setError("Enter a whole, nonnegative unit count and a positive amount per unit."); return; }
    if (!withinContainerCapacity(Number(quantity), Number(containerCount), Number(containerSize))) { setError("Remaining quantity cannot exceed the combined capacity of the units. Check the count, size and measurement unit."); return; }
    if ((minimumContainers !== "" && !validQuantity(minimumContainers, "count")) || (minimumQuantity !== "" && !validQuantity(minimumQuantity, unit))) { setError("Thresholds must be nonnegative. Unit-count thresholds must be whole numbers."); return; }
    if (url && !productUrl(url)) { setError("Enter a valid HTTP or HTTPS link without a username or password."); return; }
    if (!name.trim()) { setError("A product name is required."); return; }
    await onSave({ name: name.trim(), catalogueNumber: catalogueNumber.trim(), barcode: code.trim(), format: item?.barcode_format ?? format,
      quantity: Number(quantity), unit, url: url ? productUrl(url)! : "", reason: reason.trim(),
      manufacturerSupplier: manufacturerSupplier.trim(), containerCount: Number(containerCount), containerSize: Number(containerSize),
      minimumContainers: minimumContainers === "" ? null : Number(minimumContainers), minimumQuantity: minimumQuantity === "" ? null : Number(minimumQuantity) });
  }

  return <form onSubmit={submit} className="form-stack">
    {item && needsStockSetup(item) && <p className="message info">This older product needs Manufacturer/Supplier and unit details. {student ? "Ask your lab to complete its setup before requesting a change." : "Complete these required fields before saving."}</p>}
    {student ? <div className="product-summary"><span className="eyebrow">PROPOSE A NEW TOTAL</span><h3>{name}</h3><p>Catalogue Number: {catalogueNumber || "Not recorded"}</p><p>Manufacturer/Supplier: {manufacturerSupplier || "Not recorded"}</p><p>Currently {item?.container_count ?? "Unknown"} units × {containerSize || "unknown"} {unit}; {Number(item?.quantity).toLocaleString()} {item?.unit} remaining. Your lab must approve this change.</p></div> : <>
      {lookupMessage && <p className="message info" role="status"><Sparkles size={18} />{lookupMessage}</p>}
      {item?.archived && <p className="message info">This product is archived. Saving will restore it to inventory.</p>}
      <label>Product name<input value={name} onChange={event => { nameTouched.current = true; setName(event.target.value); }} required maxLength={180} placeholder="e.g. Sodium chloride" /></label>
      <label>Manufacturer/Supplier<input value={manufacturerSupplier} onChange={event => setManufacturerSupplier(event.target.value)} required maxLength={180} placeholder="e.g. Merck / Sigma-Aldrich" /></label>
      <label>Catalogue Number<input value={catalogueNumber} onChange={event => { catalogueTouched.current = true; setCatalogueNumber(event.target.value); }} maxLength={120} placeholder="e.g. S7653-100G" autoCapitalize="none" spellCheck={false} /></label>
      <p className="field-hint">The supplier’s product identifier, not the barcode or batch number. Unique within this lab. Leave blank if unknown.</p>
      <label>Barcode / scanned value<input value={code} onChange={event => setCode(event.target.value)} maxLength={2048} placeholder="Optional if adding manually" /></label>
    </>}
    <div className="quantity-fields">
      <label>{student ? "Proposed number of units" : "Number of units"}<input value={containerCount} onChange={event => setContainerCount(event.target.value)} type="number" inputMode="numeric" min="0" max="1000000000000" step="1" required placeholder="e.g. 2" /></label>
      {!student && <label>Amount per unit ({unit})<input value={containerSize} onChange={event => setContainerSize(event.target.value)} type="number" inputMode="decimal" min={unit === "count" ? "1" : "0"} max="1000000000000" step={unit === "count" ? "1" : "any"} required placeholder="e.g. 2.5" /></label>}
    </div>
    <div className="quantity-fields"><label>{student ? "Proposed remaining quantity" : "Total remaining quantity"}<input value={quantity} onChange={event => setQuantity(event.target.value)} type="number" inputMode="decimal" min="0" max="1000000000000" step={unit === "count" ? "1" : "any"} required placeholder="0" /></label>
      <label>Unit<select value={unit} disabled={student} onChange={event => setUnit(event.target.value as Unit)}>{units.map(value => <option key={value} value={value}>{value === "L" ? "L — litre" : value === "mL" ? "mL — millilitre" : value === "µL" ? "µL — microlitre" : value === "kg" ? "kg — kilogram" : value === "g" ? "g — gram" : value === "mg" ? "mg — milligram" : "count — items"}</option>)}</select></label>
    </div>
    <p className="field-hint">Count units still in use, including partially filled ones. Enter the total remaining across all units, not the amount used. Two 2.5 L units hold up to 5 L.</p>
    {!student && <>
      <p className="field-hint">The selected unit applies to the unit size, remaining total and amount threshold. Changing it does not convert values: update all three amounts yourself.</p>
      <details className="stock-settings"><summary>Advanced stock settings</summary><div className="form-stack">
        <p className="field-hint">Yellow (Low stock) when either value is below its threshold. Leave a threshold blank to disable it. Red (Depleted) when units or remaining quantity reach zero.</p>
        <label>Minimum units<input value={minimumContainers} onChange={event => setMinimumContainers(event.target.value)} type="number" inputMode="numeric" min="0" max="1000000000000" step="1" placeholder="Disabled" /></label>
        <label>Minimum remaining quantity ({unit})<input value={minimumQuantity} onChange={event => setMinimumQuantity(event.target.value)} type="number" inputMode="decimal" min="0" max="1000000000000" step={unit === "count" ? "1" : "any"} placeholder="Disabled" /></label>
      </div></details>
    </>}
    {student ? <label>Reason <span className="muted">(optional)</span><textarea value={reason} onChange={event => setReason(event.target.value)} maxLength={1000} placeholder="e.g. Updated after this morning’s practical" /></label> : <label>Product link <span className="muted">(optional)</span><input value={url} onChange={event => setUrl(event.target.value)} type="url" maxLength={2048} placeholder="https://supplier.com/product" /></label>}
    {url && !student && <a className="text-link" href={productUrl(url) ?? undefined} target="_blank" rel="noopener noreferrer">Preview product page <ExternalLink size={14} /></a>}
    {error && <p className="message error" role="alert">{error}</p>}
    <button className="button primary full" disabled={busy || (student && !!item && needsStockSetup(item))}>{busy ? "Saving…" : student ? "Send change request" : item?.archived ? "Restore product" : item ? "Save changes" : "Add to inventory"}</button>
  </form>;
}
