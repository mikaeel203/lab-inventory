import type { Item, Unit } from "./types";

export const units: Unit[] = ["L", "mL", "µL", "kg", "g", "mg", "count"];
export const unitInfo: Record<Unit, { category: string; factor: number }> = {
  L: { category: "volume", factor: 1_000_000 },
  mL: { category: "volume", factor: 1_000 },
  "µL": { category: "volume", factor: 1 },
  kg: { category: "mass", factor: 1_000_000 },
  g: { category: "mass", factor: 1_000 },
  mg: { category: "mass", factor: 1 },
  count: { category: "count", factor: 1 },
};

export function validQuantity(value: string | number, unit: Unit): boolean {
  const quantity = Number(value);
  return String(value).trim() !== "" && Number.isFinite(quantity) && quantity >= 0 && quantity <= 1e12
    && (unit !== "count" || Number.isInteger(quantity)) && units.includes(unit);
}

export function withinContainerCapacity(quantity: number, count: number, size: number): boolean {
  const capacity = count * size;
  return quantity <= capacity + Number.EPSILON * Math.max(Math.abs(capacity), Math.abs(quantity)) * 4;
}

export function productUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || value.length > 2048) return null;
    return url.href;
  } catch { return null; }
}

export type StockStatus = "normal" | "low" | "depleted";
export const stockLabels: Record<StockStatus, string> = { normal: "Normal", low: "Low stock", depleted: "Depleted" };

export function stockStatus(item: Item): StockStatus {
  if (Number(item.quantity) === 0 || (item.container_count !== null && Number(item.container_count) === 0)) return "depleted";
  if ((item.minimum_containers !== null && item.container_count !== null && Number(item.container_count) < Number(item.minimum_containers))
    || (item.minimum_quantity !== null && Number(item.quantity) < Number(item.minimum_quantity))) return "low";
  return "normal";
}

export function needsStockSetup(item: Item): boolean {
  return !item.manufacturer_supplier || item.container_count === null || item.container_size === null;
}

export type Filters = {
  search: string; unit: string; category: string; stock: string; sort: "name" | "updated" | "quantity" | "stock"; descending: boolean;
};

export function filterItems(items: Item[], filters: Filters): Item[] {
  const query = filters.search.trim().toLowerCase();
  const result = items.filter(item => !item.archived
    && (!query || `${item.name} ${item.catalogue_number ?? ""} ${item.barcode ?? ""} ${item.manufacturer_supplier ?? ""}`.toLowerCase().includes(query))
    && (!filters.unit || item.unit === filters.unit)
    && (!filters.category || unitInfo[item.unit].category === filters.category)
    && (filters.stock !== "in" || stockStatus(item) !== "depleted")
    && (filters.stock !== "out" || stockStatus(item) === "depleted")
    && (!["normal", "low", "depleted"].includes(filters.stock) || stockStatus(item) === filters.stock));
  const quantityAllowed = Boolean(filters.category || filters.unit);
  return result.sort((first, second) => {
    let difference: number;
    if (filters.sort === "stock") {
      const priority = { depleted: 0, low: 1, normal: 2 };
      difference = priority[stockStatus(first)] - priority[stockStatus(second)];
    } else if (filters.sort === "quantity" && quantityAllowed) {
      difference = Number(first.quantity) * unitInfo[first.unit].factor - Number(second.quantity) * unitInfo[second.unit].factor;
    } else if (filters.sort === "updated") {
      difference = first.updated_at.localeCompare(second.updated_at);
    } else {
      difference = first.name.localeCompare(second.name, undefined, { sensitivity: "base" });
    }
    return (filters.descending ? -difference : difference) || first.id.localeCompare(second.id);
  });
}
