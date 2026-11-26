"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Sparkles, ExternalLink } from "lucide-react";
import { units, validQuantity, productUrl, needsStockSetup, withinContainerCapacity } from "@/lib/inventory";
import type { CatalogueProduct, Item, Unit } from "@/lib/types";
import { createClient } from "@/lib/supabase/browser";
import { localCatalogueMatches, sameCatalogueProduct } from "@/lib/catalogue";

export type ItemDraft = { name: string; catalogueNumber: string; barcode: string; format: string; quantity: number; unit: Unit; url: string; reason: string;
  manufacturerSupplier: string; containerCount: number; containerSize: number; minimumContainers: number | null; minimumQuantity: number | null;
  confirmProduct: boolean; confirmCode: boolean; confirmUrl: boolean };

export function ItemEditor({ item, barcode = "", format = "", student, busy, onSave, items = [], onOpenItem }: {
  item?: Item; barcode?: string; format?: string; student: boolean; busy: boolean;
  items?: Item[]; onOpenItem?: (item: Item) => void;
  onSave: (draft: ItemDraft) => Promise<boolean>;
}) {
  const quantityOnly = student && !!item;
  const [name, setName] = useState(item?.name ?? "");
  const catalogueScan = format === "CATALOGUE_NUMBER";
  const [catalogueNumber, setCatalogueNumber] = useState(item?.catalogue_number ?? (catalogueScan ? barcode : ""));
  const [manufacturerSupplier, setManufacturerSupplier] = useState(item?.manufacturer_supplier ?? "");
  const [containerCount, setContainerCount] = useState(item?.container_count == null ? "" : String(item.container_count));
  const [containerSize, setContainerSize] = useState(item?.container_size == null ? "" : String(item.container_size));
  const [minimumContainers, setMinimumContainers] = useState(item?.minimum_containers == null ? "" : String(item.minimum_containers));
  const [minimumQuantity, setMinimumQuantity] = useState(item?.minimum_quantity == null ? "" : String(item.minimum_quantity));
  const [code, setCode] = useState(item?.barcode ?? (catalogueScan ? "" : barcode));
  const [quantity, setQuantity] = useState(item ? String(item.quantity) : "");
  const [unit, setUnit] = useState<Unit>(item?.unit ?? "mL");
  const [url, setUrl] = useState(item?.product_url ?? (catalogueScan ? "" : productUrl(barcode)) ?? "");
  const [reason, setReason] = useState("");
  const [lookupMessage, setLookupMessage] = useState("");
  const [error, setError] = useState("");
  const [confirmProduct, setConfirmProduct] = useState(false);
  const [confirmCode, setConfirmCode] = useState(false);
  const [confirmUrl, setConfirmUrl] = useState(false);
  const [lookupBusy, setLookupBusy] = useState(false);
  const [matches, setMatches] = useState<CatalogueProduct[]>([]);
  const [localMatches, setLocalMatches] = useState<Item[]>([]);
  const edited = useRef(new Set<string>());
  const revision = useRef(0);
  const requestId = useRef(0);
  const catalogueTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const supplierFilter = useRef("");
  supplierFilter.current = edited.current.has("manufacturer") ? manufacturerSupplier.trim() : "";
  const latestItems = useRef(items);
  latestItems.current = items;
  const openItem = useRef(onOpenItem);
  openItem.current = onOpenItem;

  function touch(field: string) {
    edited.current.add(field); revision.current++;
    setConfirmProduct(false); setConfirmCode(false); setConfirmUrl(false);
    setMatches([]); setLocalMatches([]);
  }

  function changeCatalogue(value: string) {
    if (catalogueTimer.current) clearTimeout(catalogueTimer.current);
    requestId.current++;
    setLookupBusy(false); setLookupMessage("");
    touch("catalogue"); setCatalogueNumber(value);
    if (item) return;
    if (!edited.current.has("name")) setName("");
    if (!edited.current.has("manufacturer")) setManufacturerSupplier("");
    if (!edited.current.has("size")) setContainerSize("");
    if (!edited.current.has("url")) setUrl("");
    if (value.trim()) catalogueTimer.current = setTimeout(() => {
      void findProduct(value.trim(), true, supplierFilter.current);
    }, 600);
  }

  function applyProduct(product: CatalogueProduct) {
    const existing = latestItems.current.find(entry => sameCatalogueProduct(entry, product));
    if (existing && openItem.current) { openItem.current(existing); return; }
    if (!edited.current.has("name")) setName(product.name);
    if (!edited.current.has("manufacturer")) setManufacturerSupplier(product.manufacturer_supplier);
    setCatalogueNumber(product.catalogue_number);
    if (!edited.current.has("size") && !edited.current.has("unit")) { setContainerSize(String(product.container_size)); setUnit(product.unit); }
    if (!edited.current.has("url")) setUrl(product.product_url ?? "");
    setMatches([]);
    setLookupMessage("Found in the shared BenchMark product catalogue. Verify the label and enter your lab’s number of units and remaining amount. Your edits are kept.");
    setConfirmProduct(false); setConfirmCode(false); setConfirmUrl(false);
  }

  async function findProduct(value: string, byCatalogue: boolean, supplier: string, onlineFallback = false) {
    if (catalogueTimer.current) clearTimeout(catalogueTimer.current);
    const request = ++requestId.current;
    const startedAtRevision = revision.current;
    const active = () => requestId.current === request;
    const unchanged = () => active() && revision.current === startedAtRevision;
    setLookupBusy(true); setMatches([]); setLocalMatches([]);
    setLookupMessage("Checking your lab and the shared product catalogue…");
    try {
      const local = byCatalogue ? localCatalogueMatches(latestItems.current, value, supplier) : latestItems.current.filter(entry => entry.barcode === value);
      if (local.length && openItem.current) {
        if (local.length === 1) openItem.current(local[0]);
        else { setLocalMatches(local); setLookupMessage("More than one product matches in your lab. Choose the label you are scanning."); }
        return;
      }
      const { data, error: failure } = await createClient().rpc("lookup_product_catalogue", {
        p_code: byCatalogue ? null : value, p_catalogue_number: byCatalogue ? value : null,
        p_manufacturer_supplier: byCatalogue ? supplier || null : null,
      }).abortSignal(AbortSignal.timeout(8000));
      if (!active()) return;
      if (!unchanged()) { setLookupMessage("Details changed while looking up. Use Find saved product to search again."); return; }
      if (failure) throw new Error("Shared catalogue lookup is unavailable. You can still enter details manually.");
      const products = (data ?? []) as CatalogueProduct[];
      if (products.length === 1) { applyProduct(products[0]); return; }
      if (products.length > 1) {
        setMatches(products.slice(0, 20));
        setLookupMessage(products.length > 20 ? "Many matches. Enter the manufacturer/supplier and search again to narrow the results." : "Choose the matching manufacturer and pack size. Catalogue numbers alone may identify more than one product.");
        return;
      }
      const scannedUrl = !byCatalogue && onlineFallback ? productUrl(value) : null;
      if (!scannedUrl) { setLookupMessage(byCatalogue ? student ? "No saved product matches. Enter the details to submit this product for lab approval." : "No saved product matches. Enter the details and confirm them to remember this product." : "New barcode. No saved product matches. Enter the product details or search by catalogue number."); return; }
      setLookupMessage("Not in the catalogue yet. Looking for product-page metadata…");
      const response = await fetch("/api/lookup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: scannedUrl }), signal: AbortSignal.timeout(10000), cache: "no-store" });
      const result = await response.json();
      if (!active()) return;
      if (!unchanged()) { setLookupMessage("Details changed while looking up. Your edits have been kept."); return; }
      if (result.name && !edited.current.has("name")) setName(result.name);
      if (result.catalogue_number && !edited.current.has("catalogue")) setCatalogueNumber(result.catalogue_number);
      setLookupMessage(result.name || result.catalogue_number ? `${result.source ?? "Product metadata"}. Verify suggestions against the label and enter any missing details.` : result.error ?? result.message ?? "Enter the product details manually.");
    } catch (failure) {
      if (active()) setLookupMessage(failure instanceof Error ? failure.message : "Lookup unavailable. Enter the details manually.");
    } finally { if (active()) setLookupBusy(false); }
  }

  useEffect(() => {
    if (!item && barcode) void findProduct(barcode, catalogueScan, "", true);
    return () => { requestId.current++; if (catalogueTimer.current) clearTimeout(catalogueTimer.current); };
  }, [barcode, item, student, catalogueScan]);

  async function submit(event: FormEvent) {
    event.preventDefault(); setError("");
    if (!validQuantity(quantity, unit)) { setError("Enter a nonnegative amount up to 1 trillion. Counts must be whole numbers."); return; }
    if (!manufacturerSupplier.trim()) { setError(quantityOnly ? "Ask the lab to complete Manufacturer/Supplier first." : "Manufacturer/Supplier is required."); return; }
    if (!validQuantity(containerCount, "count") || !validQuantity(containerSize, unit) || Number(containerSize) <= 0) { setError("Enter a whole, nonnegative unit count and a positive amount per unit."); return; }
    if (!withinContainerCapacity(Number(quantity), Number(containerCount), Number(containerSize))) { setError("Remaining quantity cannot exceed the combined capacity of the units. Check the count, size and measurement unit."); return; }
    if ((minimumContainers !== "" && !validQuantity(minimumContainers, "count")) || (minimumQuantity !== "" && !validQuantity(minimumQuantity, unit))) { setError("Thresholds must be nonnegative. Unit-count thresholds must be whole numbers."); return; }
    if (url && !productUrl(url)) { setError("Enter a valid HTTP or HTTPS link without a username or password."); return; }
    if (!name.trim()) { setError("A product name is required."); return; }
    if (confirmProduct && !catalogueNumber.trim()) { setError("A Catalogue Number is required to remember a shared product."); return; }
    await onSave({ name: name.trim(), catalogueNumber: catalogueNumber.trim(), barcode: code.trim(), format: item?.barcode_format ?? (catalogueScan ? "" : format),
      quantity: Number(quantity), unit, url: url ? productUrl(url)! : "", reason: reason.trim(),
      manufacturerSupplier: manufacturerSupplier.trim(), containerCount: Number(containerCount), containerSize: Number(containerSize),
      minimumContainers: minimumContainers === "" ? null : Number(minimumContainers), minimumQuantity: minimumQuantity === "" ? null : Number(minimumQuantity),
      confirmProduct: !student && confirmProduct, confirmCode: confirmProduct && confirmCode, confirmUrl: confirmProduct && confirmUrl });
  }

  return <form onSubmit={submit} className="form-stack">
    {item && needsStockSetup(item) && <p className="message info">This older product needs Manufacturer/Supplier and unit details. {student ? "Ask your lab to complete its setup before requesting a change." : "Complete these required fields before saving."}</p>}
    {student && !item && <p className="message info">Submit this product for your current lab to review. It will only appear in inventory after approval.</p>}
    {quantityOnly ? <div className="product-summary"><span className="eyebrow">PROPOSE A NEW TOTAL</span><h3>{name}</h3><p>Catalogue Number: {catalogueNumber || "Not recorded"}</p><p>Manufacturer/Supplier: {manufacturerSupplier || "Not recorded"}</p><p>Currently {item?.container_count ?? "Unknown"} units × {containerSize || "unknown"} {unit}; {Number(item?.quantity).toLocaleString()} {item?.unit} remaining. Your lab must approve this change.</p></div> : <>
      {lookupMessage && <p className="message info" role="status"><Sparkles size={18} />{lookupMessage}</p>}
      {item?.archived && <p className="message info">This product is archived. Saving will restore it to inventory.</p>}
      <label>Catalogue Number<input value={catalogueNumber} onChange={event => changeCatalogue(event.target.value)} maxLength={120} placeholder="Enter catalogue number to autofill" autoCapitalize="none" spellCheck={false} /></label>
      <p className="field-hint">{item ? "The supplier’s product identifier, not a barcode or batch number. Unique within this lab." : "Enter the supplier’s product identifier to look up saved details automatically. Review the match and enter your lab’s stock amounts. Leave blank if unknown."}</p>
      {!item && <button type="button" className="button secondary" disabled={busy || lookupBusy || !catalogueNumber.trim()} onClick={() => void findProduct(catalogueNumber.trim(), true, supplierFilter.current)}>{lookupBusy ? "Looking up…" : "Find saved product"}</button>}
      {!!localMatches.length && <div className="catalogue-matches" aria-label="Matching lab products">{localMatches.map(product => <button type="button" className="button secondary catalogue-choice" key={product.id} onClick={() => openItem.current?.(product)}><strong>{product.name}</strong><span>{product.manufacturer_supplier} · {product.container_size} {product.unit}{product.archived ? " · Archived — restore" : " · Already in your lab"}</span></button>)}</div>}
      {!!matches.length && <div className="catalogue-matches" aria-label="Matching catalogue products">{matches.map(product => <button type="button" className="button secondary catalogue-choice" key={product.id} onClick={() => applyProduct(product)}><strong>{product.name}</strong><span>{product.manufacturer_supplier} · {product.catalogue_number} · {product.container_size} {product.unit}</span></button>)}</div>}
      <label>Product name<input value={name} onChange={event => { touch("name"); setName(event.target.value); }} required maxLength={180} placeholder="e.g. Sodium chloride" /></label>
      <label>Manufacturer/Supplier<input value={manufacturerSupplier} onChange={event => { touch("manufacturer"); setManufacturerSupplier(event.target.value); }} required maxLength={180} placeholder="e.g. Merck / Sigma-Aldrich" /></label>
      <label>Barcode / scanned value<input value={code} onChange={event => { touch("code"); setCode(event.target.value); }} maxLength={2048} placeholder="Optional if adding manually" /></label>
    </>}
    <div className="quantity-fields">
      <label>{quantityOnly ? "Proposed number of units" : "Number of units"}<input value={containerCount} onChange={event => setContainerCount(event.target.value)} type="number" inputMode="numeric" min="0" max="1000000000000" step="1" required placeholder="e.g. 2" /></label>
      {!quantityOnly && <label>Amount per unit ({unit})<input value={containerSize} onChange={event => { touch("size"); setContainerSize(event.target.value); }} type="number" inputMode="decimal" min={unit === "count" ? "1" : "0"} max="1000000000000" step={unit === "count" ? "1" : "any"} required placeholder="e.g. 2.5" /></label>}
    </div>
    <div className="quantity-fields"><label>{quantityOnly ? "Proposed remaining quantity" : "Total remaining quantity"}<input value={quantity} onChange={event => setQuantity(event.target.value)} type="number" inputMode="decimal" min="0" max="1000000000000" step={unit === "count" ? "1" : "any"} required placeholder="0" /></label>
      <label>Unit<select value={unit} disabled={quantityOnly} onChange={event => { touch("unit"); setUnit(event.target.value as Unit); }}>{units.map(value => <option key={value} value={value}>{value === "L" ? "L — litre" : value === "mL" ? "mL — millilitre" : value === "µL" ? "µL — microlitre" : value === "kg" ? "kg — kilogram" : value === "g" ? "g — gram" : value === "mg" ? "mg — milligram" : "count — items"}</option>)}</select></label>
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
    {student && <label>Reason <span className="muted">(optional)</span><textarea value={reason} onChange={event => setReason(event.target.value)} maxLength={1000} placeholder="Add a note for your lab" /></label>}
    {!quantityOnly && <label>Product link <span className="muted">(optional)</span><input value={url} onChange={event => { touch("url"); setUrl(event.target.value); }} type="url" maxLength={2048} placeholder="https://supplier.com/product" /></label>}
    {url && !quantityOnly && <a className="text-link" href={productUrl(url) ?? undefined} target="_blank" rel="noopener noreferrer">Preview product page <ExternalLink size={14} /></a>}
    {!student && <fieldset className="catalogue-confirmation form-stack"><legend>Remember this product for faster scanning</legend>
      <p className="field-hint">The shared BenchMark catalogue stores only the printed product name, manufacturer/supplier, catalogue number and pack size. It never stores which lab supplied it, your stock amounts, students or thresholds. Use public label details, not internal lab names or identifiers.</p>
      <label className="checkbox-label"><input type="checkbox" checked={confirmProduct} onChange={event => { setConfirmProduct(event.target.checked); setConfirmCode(false); setConfirmUrl(false); }} />I have verified these public product details against the label; remember them in the shared catalogue.</label>
      {confirmProduct && <>
        <label className="checkbox-label"><input type="checkbox" disabled={!code.trim()} checked={confirmCode} onChange={event => setConfirmCode(event.target.checked)} />This barcode/QR identifies the product for everyone, not a batch, serial number, private link or lab asset. Remember it too.</label>
        <label className="checkbox-label"><input type="checkbox" disabled={!url.trim()} checked={confirmUrl} onChange={event => setConfirmUrl(event.target.checked)} />This is a public supplier product link, without private tokens or tracking parameters. Remember it too.</label>
      </>}
    </fieldset>}
    {error && <p className="message error" role="alert">{error}</p>}
    <button className="button primary full" disabled={busy || lookupBusy || (student && !!item && needsStockSetup(item))}>{busy ? "Saving…" : student ? item ? "Send change request" : "Submit product for approval" : item?.archived ? "Restore product" : item ? "Save changes" : "Add to inventory"}</button>
  </form>;
}
