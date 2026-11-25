import { describe, expect, it } from "vitest";
import { filterItems, needsStockSetup, productUrl, stockStatus, validQuantity, withinContainerCapacity, type Filters } from "../src/lib/inventory";
import type { Item } from "../src/lib/types";

const stockFields = { manufacturer_supplier: "Test Supplier", container_count: 2, container_size: 1000, minimum_containers: null, minimum_quantity: null };
const items: Item[] = [
  { id: "one", lab_id: "lab", name: "Ethanol", catalogue_number: "ETH-001", barcode: "100", barcode_format: "EAN_13", quantity: 2, unit: "L", product_url: null, version: 1, archived: false, updated_at: "2026-11-20" },
  { id: "two", lab_id: "lab", name: "Acetone", catalogue_number: "AC-002", barcode: "200", barcode_format: "CODE_128", quantity: 500, unit: "mL", product_url: null, version: 1, archived: false, updated_at: "2026-11-23" },
  { id: "three", lab_id: "lab", name: "Zinc", catalogue_number: null, barcode: null, barcode_format: null, quantity: 0, unit: "g", product_url: null, version: 1, archived: false, updated_at: "2026-11-24" },
  { id: "four", lab_id: "lab", name: "Archived", catalogue_number: null, barcode: null, barcode_format: null, quantity: 1, unit: "count", product_url: null, version: 1, archived: true, updated_at: "2026-11-24" },
].map(item => ({ ...stockFields, ...item, unit: item.unit as Item["unit"] }));
const defaults: Filters = { search: "", unit: "", category: "", stock: "", sort: "name", descending: false };

describe("inventory", () => {
  it("validates remaining totals without false rejection from decimal rounding", () => {
    expect(withinContainerCapacity(2.1, 3, 0.7)).toBe(true);
    expect(withinContainerCapacity(3.8, 2, 2.5)).toBe(true);
    expect(withinContainerCapacity(5, 2, 2.5)).toBe(true);
    expect(withinContainerCapacity(5.1, 2, 2.5)).toBe(false);
    expect(withinContainerCapacity(0, 0, 2.5)).toBe(true);
    expect(withinContainerCapacity(0.000001, 0, 2.5)).toBe(false);
  });
  it("marks depleted before checking low-stock thresholds", () => {
    expect(stockStatus({ ...items[0], quantity: 0, minimum_quantity: 10 })).toBe("depleted");
    expect(stockStatus({ ...items[0], container_count: 0, minimum_containers: 3 })).toBe("depleted");
  });
  it("uses either threshold, strictly below, with blank thresholds disabled", () => {
    expect(stockStatus({ ...items[0], minimum_containers: 3 })).toBe("low");
    expect(stockStatus({ ...items[0], minimum_quantity: 3 })).toBe("low");
    expect(stockStatus({ ...items[0], minimum_quantity: 2, minimum_containers: 2 })).toBe("normal");
    expect(stockStatus({ ...items[0], minimum_quantity: 0, minimum_containers: 0 })).toBe("normal");
    expect(stockStatus(items[0])).toBe("normal");
  });
  it("does not treat missing historical container details as zero", () => {
    const legacy = { ...items[0], manufacturer_supplier: null, container_count: null, container_size: null };
    expect(stockStatus(legacy)).toBe("normal");
    expect(needsStockSetup(legacy)).toBe(true);
    expect(needsStockSetup(items[0])).toBe(false);
  });
  it("filters and sorts stock severity and searches suppliers", () => {
    const stock = items.map(item => item.id === "one" ? { ...item, minimum_containers: 3 } : item);
    for (const [status, names] of [["normal", ["Acetone"]], ["low", ["Ethanol"]], ["depleted", ["Zinc"]]] as const) {
      expect(filterItems(stock, { ...defaults, stock: status }).map(item => item.name)).toEqual(names);
    }
    expect(filterItems(stock, { ...defaults, sort: "stock" }).map(item => item.name)).toEqual(["Zinc", "Ethanol", "Acetone"]);
    expect(filterItems(stock, { ...defaults, sort: "stock", descending: true }).map(item => item.name)).toEqual(["Acetone", "Ethanol", "Zinc"]);
    expect(filterItems(stock, { ...defaults, search: " TEST SUPPLIER " })).toHaveLength(3);
  });
  it("sorts names, excludes archived items, and does not mutate inputs", () => {
    expect(filterItems(items, defaults).map(item => item.name)).toEqual(["Acetone", "Ethanol", "Zinc"]);
    expect(items[0].name).toBe("Ethanol");
  });
  it("searches names case-insensitively and searches barcodes", () => {
    expect(filterItems(items, { ...defaults, search: " ETH " })[0].name).toBe("Ethanol");
    expect(filterItems(items, { ...defaults, search: "200" })[0].name).toBe("Acetone");
  });
  it("searches catalogue numbers case-insensitively and preserves leading zeros", () => {
    expect(filterItems(items, { ...defaults, search: " ac-002 " }).map(item => item.name)).toEqual(["Acetone"]);
    expect(filterItems(items, { ...defaults, search: "eth-001" })[0].catalogue_number).toBe("ETH-001");
  });
  it("sorts normalized quantities only within a measurement category", () => {
    expect(filterItems(items, { ...defaults, category: "volume", sort: "quantity" }).map(item => item.name)).toEqual(["Acetone", "Ethanol"]);
    expect(filterItems(items, { ...defaults, sort: "quantity" }).map(item => item.name)).toEqual(["Acetone", "Ethanol", "Zinc"]);
  });
  it("filters units and stock and reverses date order", () => {
    expect(filterItems(items, { ...defaults, unit: "g", stock: "out" }).map(item => item.name)).toEqual(["Zinc"]);
    expect(filterItems(items, { ...defaults, stock: "in", sort: "updated", descending: true })[0].name).toBe("Acetone");
  });
  it.each(["", " ", "-1", "NaN", "Infinity", "1000000000001"])("rejects invalid quantity %s", value => {
    expect(validQuantity(value, "mL")).toBe(false);
  });
  it("permits zero and decimals, but requires integral counts", () => {
    expect(validQuantity("0", "g")).toBe(true);
    expect(validQuantity("0.001", "L")).toBe(true);
    expect(validQuantity("1.1", "count")).toBe(false);
    expect(validQuantity("2", "count")).toBe(true);
  });
  it("only accepts HTTP(S) links without credentials", () => {
    expect(productUrl("123456789")).toBeNull();
    expect(productUrl("javascript:alert(1)")).toBeNull();
    expect(productUrl("https://user:password@example.com")).toBeNull();
    expect(productUrl("https://example.com/product")).toBe("https://example.com/product");
  });
});
