"use client";

import { useState } from "react";
import { Archive, ArrowDownUp, ExternalLink, FlaskConical, Pencil, Search, SlidersHorizontal, Trash2 } from "lucide-react";
import { filterItems, needsStockSetup, stockLabels, stockStatus, unitInfo, units, type Filters } from "@/lib/inventory";
import type { Item } from "@/lib/types";

export function InventoryList({ items, owner, busy, onEdit, onArchive, onDelete }: {
  items: Item[]; owner: boolean; busy: boolean; onEdit: (item: Item) => void; onArchive: (item: Item) => void; onDelete: (item: Item) => void;
}) {
  const [filters, setFilters] = useState<Filters>({ search: "", unit: "", category: "", stock: "", sort: "name", descending: false });
  const [expanded, setExpanded] = useState(false);
  const [archived, setArchived] = useState(false);
  const visible = filterItems(items.map(item => archived ? { ...item, archived: !item.archived } : item), filters);
  const update = (patch: Partial<Filters>) => setFilters(current => ({ ...current, ...patch }));
  return <section className="panel inventory-panel" aria-label="Inventory">
    <div className="inventory-toolbar"><label className="search-field"><Search size={19} /><input aria-label="Search inventory" value={filters.search} onChange={event => update({ search: event.target.value })} placeholder="Search products, suppliers, catalogue numbers…" /></label>
      <button className={`button secondary filter-toggle ${expanded ? "active" : ""}`} onClick={() => setExpanded(!expanded)} aria-expanded={expanded} aria-label="Filters & sort"><SlidersHorizontal size={17} /><span>Filters & sort</span></button>
    </div>
    {expanded && <div className="filter-grid">
      <label>Measurement<select value={filters.category} onChange={event => update({ category: event.target.value, unit: "", sort: filters.sort === "quantity" && !event.target.value ? "name" : filters.sort })}><option value="">All measurements</option><option value="volume">Volume</option><option value="mass">Mass</option><option value="count">Count</option></select></label>
      <label>Unit<select value={filters.unit} onChange={event => update({ unit: event.target.value, sort: filters.sort === "quantity" && !event.target.value && !filters.category ? "name" : filters.sort })}><option value="">All units</option>{units.filter(unit => !filters.category || unitInfo[unit].category === filters.category).map(unit => <option key={unit}>{unit}</option>)}</select></label>
      <label>Availability<select value={filters.stock} onChange={event => update({ stock: event.target.value })}><option value="">All stock levels</option><option value="normal">Normal</option><option value="low">Low stock (yellow)</option><option value="depleted">Depleted (red)</option></select></label>
      <label>Sort by<select value={filters.sort} onChange={event => update({ sort: event.target.value as Filters["sort"], descending: event.target.value === "stock" ? false : filters.descending })}><option value="name">Name</option><option value="updated">Last updated</option><option value="stock">Stock status (depleted → low → normal)</option><option value="quantity" disabled={!filters.category && !filters.unit}>Quantity (choose measurement)</option></select></label>
      <button className="button secondary" onClick={() => update({ descending: !filters.descending })}><ArrowDownUp size={16} />{filters.descending ? "Descending" : "Ascending"}</button>
      {owner && <label className="checkbox-label"><input type="checkbox" checked={archived} onChange={event => setArchived(event.target.checked)} /> Show archived only</label>}
    </div>}
    <div className="list-heading"><span>PRODUCT</span><span>REMAINING</span><span>PRODUCT LINK</span></div>
    {visible.length ? <ul className="product-list">{visible.map(displayItem => {
      const item = items.find(original => original.id === displayItem.id)!;
      const status = stockStatus(item);
      return <li key={item.id} className={`product-row stock-${status}`}>
        <div className="product-identity"><span className={`chemical-icon ${status === "depleted" ? "empty" : ""}`}><FlaskConical size={21} /></span><div><h3>{item.name}</h3><p className="catalogue-number">Catalogue Number: <span>{item.catalogue_number || "Not recorded"}</span></p><p className="supplier-name">Manufacturer/Supplier: {item.manufacturer_supplier || "Not recorded"}</p><p>{item.barcode ? <span className="barcode">{item.barcode}</span> : "Manually added"}</p>{needsStockSetup(item) && <small className="setup-label">Stock setup needed</small>}<small>Updated {new Date(item.updated_at).toLocaleDateString()}</small></div></div>
        <div className="product-quantity"><strong>{Number(item.quantity).toLocaleString(undefined, { maximumFractionDigits: 12 })}</strong><span>{item.unit}</span>{item.container_count !== null && item.container_size !== null && <small className="container-summary">{Number(item.container_count).toLocaleString()} units × {Number(item.container_size).toLocaleString(undefined, { maximumFractionDigits: 12 })} {item.unit}</small>}<small className={`stock-badge ${status}`}>{stockLabels[status]}</small></div>
        <div className="product-actions"><div>{item.product_url ? <a href={item.product_url} target="_blank" rel="noopener noreferrer" className="product-link" aria-label={`Product page for ${item.name}`}>Product page <ExternalLink size={14} /></a> : <span className="muted no-link">No link</span>}</div>
          <div className="row-buttons"><button className="text-button" onClick={() => onEdit(item)} disabled={busy}><Pencil size={14} />{owner ? item.archived ? "Restore" : "Edit" : "Request change"}</button>
            {owner && !item.archived && <button className="icon-button small" aria-label={`Archive ${item.name}`} onClick={() => onArchive(item)} disabled={busy}><Archive size={15} /></button>}
            {owner && <button className="icon-button small danger" aria-label={`Delete ${item.name}`} onClick={() => onDelete(item)} disabled={busy}><Trash2 size={15} /></button>}</div>
        </div>
      </li>;
    })}</ul> : <div className="empty-state"><FlaskConical size={34} /><h3>{items.length ? "No matching products" : "A fresh start for your shelves"}</h3><p>{items.length ? "Try changing your search or filters." : owner ? "Scan a product or add one manually to start your inventory." : "Your lab hasn’t added any products yet."}</p></div>}
    <footer className="list-footer">{visible.length} {visible.length === 1 ? "product" : "products"}{archived ? " · archived" : ""}<span>Quantities reflect the last recorded total.</span></footer>
  </section>;
}
