import type { CatalogueProduct, Item } from "./types";
import { unitInfo } from "./inventory";

const normalize = (value: string | null) => (value ?? "").trim().toLowerCase();

export function localCatalogueMatches(items: Item[], catalogueNumber: string, manufacturerSupplier = ""): Item[] {
  if (!catalogueNumber.trim()) return [];
  return items.filter(item => normalize(item.catalogue_number) === normalize(catalogueNumber)
    && (!manufacturerSupplier.trim() || normalize(item.manufacturer_supplier) === normalize(manufacturerSupplier)));
}

export function sameCatalogueProduct(item: Item, product: CatalogueProduct): boolean {
  return normalize(item.catalogue_number) === normalize(product.catalogue_number)
    && normalize(item.manufacturer_supplier) === normalize(product.manufacturer_supplier)
    && item.container_size !== null
    && unitInfo[item.unit].category === unitInfo[product.unit].category
    && Number(item.container_size) * unitInfo[item.unit].factor === Number(product.container_size) * unitInfo[product.unit].factor;
}
