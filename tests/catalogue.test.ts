import { describe, expect, it } from "vitest";
import { localCatalogueMatches, sameCatalogueProduct } from "../src/lib/catalogue";
import type { CatalogueProduct, Item } from "../src/lib/types";

const product: CatalogueProduct = { id: "global", name: "Alcohol", manufacturer_supplier: "Merck", catalogue_number: "001-ABC", container_size: 2.5, unit: "L", product_url: null };
const item: Item = { ...product, id: "local", lab_id: "lab", manufacturer_supplier: " MERCK ", catalogue_number: "001-abc", container_size: 2500, unit: "mL",
  quantity: 1200, container_count: 2, minimum_containers: 3, minimum_quantity: 2000, barcode: null, barcode_format: null, archived: false, version: 1, updated_at: "2026-11-26" };

describe("catalogue identity", () => {
  it("matches only exact identifiers, case-insensitively, including archived entries", () => {
    const archived = { ...item, archived: true };
    expect(localCatalogueMatches([archived], " 001-ABC ", "merck")).toEqual([archived]);
    expect(localCatalogueMatches([item], "001")).toEqual([]);
    expect(localCatalogueMatches([item], "001-abc", "Other Supplier")).toEqual([]);
    expect(localCatalogueMatches([item], "")).toEqual([]);
  });
  it("keeps leading zeros and punctuation significant", () => {
    expect(localCatalogueMatches([item], "1-ABC")).toEqual([]);
    expect(localCatalogueMatches([item], "001ABC")).toEqual([]);
  });
  it("normalizes pack units without using the name, lab stock or shared ID", () => {
    expect(sameCatalogueProduct(item, product)).toBe(true);
    expect(sameCatalogueProduct({ ...item, name: "A lab's nickname", quantity: 0, archived: true }, product)).toBe(true);
    expect(sameCatalogueProduct({ ...item, manufacturer_supplier: "Another supplier" }, product)).toBe(false);
    expect(sameCatalogueProduct({ ...item, container_size: 500 }, product)).toBe(false);
    expect(sameCatalogueProduct({ ...item, unit: "g" }, product)).toBe(false);
    expect(sameCatalogueProduct({ ...item, container_size: null }, product)).toBe(false);
  });
});
