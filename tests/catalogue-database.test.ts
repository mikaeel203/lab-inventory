import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

let database: PGlite;
const owner = "00000000-0000-4000-8000-000000000001";
const otherOwner = "00000000-0000-4000-8000-000000000002";
const student = "00000000-0000-4000-8000-000000000003";
let lab: string;
let otherLab: string;

async function asUser(user: string, sql: string, values: unknown[] = []) {
  return database.transaction(async transaction => {
    await transaction.exec("set local role authenticated");
    await transaction.query("select set_config('request.jwt.claim.sub', $1, true)", [user]);
    return (await transaction.query<Record<string, unknown>>(sql, values)).rows;
  });
}

async function save(options: Record<string, unknown> = {}, user = owner) {
  const parameters = {
    p_lab_id: user === otherOwner ? otherLab : lab, p_name: "Ethanol absolute", p_quantity: 3.8, p_unit: "L",
    p_manufacturer_supplier: "Merck", p_container_count: 2, p_container_size: 2.5, p_catalogue_number: "001-ETH",
    p_barcode: "PRODUCT-CODE", p_barcode_format: "CODE_128", p_product_url: "https://supplier.example/ethanol",
    p_minimum_quantity: 4, p_minimum_containers: 3, p_confirm_product: true,
    ...options,
  };
  const argumentsSql = Object.keys(parameters).map((key, index) => `${key} => $${index + 1}`).join(", ");
  const [result] = await asUser(user, `select public.save_catalogued_inventory_item(${argumentsSql}) as id`, Object.values(parameters));
  return result.id as string;
}

beforeAll(async () => {
  database = new PGlite();
  await database.exec(`
    create role anon; create role authenticated;
    create schema auth; grant usage on schema auth to authenticated, anon;
    create table auth.users (id uuid primary key, raw_user_meta_data jsonb not null);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
    $$;
  `);
  const directory = new URL("../supabase/migrations/", import.meta.url);
  for (const filename of readdirSync(directory).filter(file => file.endsWith(".sql")).sort()) {
    await database.exec(readFileSync(new URL(filename, directory), "utf8"));
  }
});

beforeEach(async () => {
  await database.exec("truncate auth.users cascade; truncate public.product_catalogue cascade");
  for (const [id, role] of [[owner, "lab"], [otherOwner, "lab"], [student, "student"]]) {
    await database.query("insert into auth.users values($1, $2)", [id, JSON.stringify({ role, display_name: "Private Person", lab_name: "Private Lab", department: "Private Department", institution: "Private Institution" })]);
  }
  const labs = (await database.query<{ id: string; owner_id: string }>("select id, owner_id from public.labs")).rows;
  lab = labs.find(entry => entry.owner_id === owner)!.id;
  otherLab = labs.find(entry => entry.owner_id === otherOwner)!.id;
});

afterAll(async () => { await database?.close(); });

describe("shared product catalogue", () => {
  it("exposes only product identity and pack details, never provenance or lab stock", async () => {
    const item = await save();
    const products = await asUser(otherOwner, "select * from public.lookup_product_catalogue(p_catalogue_number => '001-ETH')");
    expect(products).toHaveLength(1);
    expect(Object.keys(products[0]).sort()).toEqual(["id", "name", "manufacturer_supplier", "catalogue_number", "container_size", "unit", "product_url"].sort());
    expect(products[0]).toMatchObject({ name: "Ethanol absolute", manufacturer_supplier: "Merck", catalogue_number: "001-ETH", container_size: "2.5", unit: "L", product_url: null });
    expect(products[0].id).not.toBe(item);
    expect(JSON.stringify(products)).not.toContain("Private");
    expect(await asUser(otherOwner, "select * from public.inventory_items")).toEqual([]);
    expect(await asUser(otherOwner, "select * from public.audit_events")).toEqual([]);
    expect(await asUser(student, "select * from public.inventory_items")).toEqual([]);
    expect(await asUser(student, "select * from public.lookup_product_catalogue(p_catalogue_number => '001-ETH')")).toHaveLength(1);
  });

  it("never remembers local stock, URLs or codes without confirmation", async () => {
    await asUser(owner, "select public.save_inventory_item($1, 'Private sample', 1, 'L', p_manufacturer_supplier => 'Merck', p_container_count => 1, p_container_size => 1, p_catalogue_number => 'PRIVATE')", [lab]);
    expect(await asUser(owner, "select * from public.product_catalogue")).toEqual([]);
    await save({ p_product_url: "https://supplier.example/private?token=secret", p_barcode: "private asset code" });
    expect(await asUser(owner, "select * from public.lookup_product_catalogue(p_code => 'private asset code')")).toEqual([]);
    expect(await asUser(owner, "select product_url from public.product_catalogue")).toEqual([{ product_url: null }]);
  });

  it("requires explicit confirmation and a real catalogue identifier", async () => {
    for (const value of [false, null]) await expect(save({ p_confirm_product: value })).rejects.toThrow(/Confirm the printed/);
    for (const value of [null, "", "   "]) await expect(save({ p_catalogue_number: value })).rejects.toThrow(/Catalogue Number is required/);
    await expect(save({ p_confirm_code: true, p_barcode: null })).rejects.toThrow(/reusable product/);
    await expect(save({ p_confirm_url: true, p_product_url: null })).rejects.toThrow(/public product link/);
    expect(await asUser(owner, "select * from public.inventory_items")).toEqual([]);
  });

  it("blocks student/other-lab contributions and all direct catalogue writes", async () => {
    await expect(save({}, student)).rejects.toThrow(/owner/);
    await expect(save({ p_lab_id: lab }, otherOwner)).rejects.toThrow(/owner/);
    await save();
    for (const actor of [owner, otherOwner, student]) {
      for (const query of ["delete from public.product_catalogue", "update public.product_catalogue set name = 'forged'", "insert into public.product_catalogue(name) values ('forged')", "select * from public.product_catalogue_codes"]) {
        await expect(asUser(actor, query)).rejects.toThrow(/permission denied/);
      }
    }
  });

  it("rejects anonymous lookups and contributions", async () => {
    for (const sql of ["select * from public.product_catalogue", "select * from public.lookup_product_catalogue(p_code => 'PRODUCT-CODE')", "select public.save_catalogued_inventory_item(null, 'Forged', 1, 'L')"]) {
      await expect(database.transaction(async transaction => { await transaction.exec("set local role anon"); await transaction.exec(sql); })).rejects.toThrow(/permission denied/);
    }
  });

  it("allows many reusable barcode/QR values for the same confirmed product", async () => {
    await save({ p_confirm_code: true, p_confirm_url: true });
    await save({ p_barcode: "https://supplier.example/ethanol", p_confirm_code: true, p_quantity: 1, p_container_count: 1 }, otherOwner);
    const first = await asUser(owner, "select * from public.lookup_product_catalogue(p_code => 'PRODUCT-CODE')");
    expect(await asUser(otherOwner, "select * from public.lookup_product_catalogue(p_code => 'https://supplier.example/ethanol')")).toEqual(first);
    expect(first[0].product_url).toBe("https://supplier.example/ethanol");
    expect(await asUser(owner, "select * from public.product_catalogue")).toHaveLength(1);
    expect(await asUser(owner, "select quantity from public.inventory_items")).toEqual([{ quantity: "3.8" }]);
    expect(await asUser(otherOwner, "select quantity from public.inventory_items")).toEqual([{ quantity: "1" }]);
  });

  it("normalizes equivalent pack measurements and case without merging different suppliers or sizes", async () => {
    await save();
    await save({ p_manufacturer_supplier: " merck ", p_catalogue_number: "001-eth", p_unit: "mL", p_container_size: 2500 }, otherOwner);
    expect(await asUser(owner, "select * from public.product_catalogue")).toHaveLength(1);
    await database.exec("delete from public.inventory_items");
    await save({ p_manufacturer_supplier: "Other Supplier" });
    await save({ p_container_size: 5 }, otherOwner);
    expect(await asUser(student, "select * from public.lookup_product_catalogue(p_catalogue_number => ' 001-ETH ')")).toHaveLength(3);
    expect(await asUser(student, "select * from public.lookup_product_catalogue(p_catalogue_number => '001-eth', p_manufacturer_supplier => 'MERCK')")).toHaveLength(2);
    expect(await asUser(student, "select * from public.lookup_product_catalogue(p_catalogue_number => '1-ETH')")).toEqual([]);
    expect(await asUser(student, "select * from public.lookup_product_catalogue(p_catalogue_number => '%')")).toEqual([]);
    expect(await asUser(student, "select * from public.lookup_product_catalogue()")).toEqual([]);
  });

  it("does not overwrite conflicts and rolls back local writes with them", async () => {
    await save({ p_confirm_url: true });
    await expect(save({ p_name: "Different grade" }, otherOwner)).rejects.toThrow(/Nothing was saved/);
    await expect(save({ p_confirm_url: true, p_product_url: "https://other.example/product" }, otherOwner)).rejects.toThrow(/Nothing was saved/);
    expect(await asUser(otherOwner, "select * from public.inventory_items")).toEqual([]);
    expect(await asUser(otherOwner, "select * from public.audit_events")).toEqual([]);
    expect(await asUser(owner, "select name, product_url from public.product_catalogue")).toEqual([{ name: "Ethanol absolute", product_url: "https://supplier.example/ethanol" }]);
  });

  it("rejects a code attached to a different product without leaving an orphan catalogue row", async () => {
    await save({ p_confirm_code: true });
    await expect(save({ p_catalogue_number: "OTHER", p_confirm_code: true }, otherOwner)).rejects.toThrow(/different catalogue product/);
    expect(await asUser(owner, "select * from public.product_catalogue")).toHaveLength(1);
    expect(await asUser(otherOwner, "select * from public.inventory_items")).toEqual([]);
  });

  it("does not silently change confirmed products when a lab edits or deletes its inventory", async () => {
    const item = await save({ p_confirm_code: true });
    await asUser(owner, "select public.save_inventory_item($1, 'Local custom name', 1, 'L', p_item_id => $2, p_version => 1, p_manufacturer_supplier => 'Merck', p_container_count => 1, p_container_size => 2.5)", [lab, item]);
    expect(await asUser(otherOwner, "select name from public.product_catalogue")).toEqual([{ name: "Ethanol absolute" }]);
    await asUser(owner, "select public.delete_inventory_item($1, 2)", [item]);
    await database.query("delete from auth.users where id = $1", [owner]);
    expect(await asUser(otherOwner, "select * from public.lookup_product_catalogue(p_code => 'PRODUCT-CODE')")).toHaveLength(1);
  });

  it("checks version before publishing edits", async () => {
    const item = await save();
    await expect(save({ p_item_id: item, p_version: 9, p_catalogue_number: "FORGED" })).rejects.toThrow(/changed/);
    expect(await asUser(owner, "select * from public.lookup_product_catalogue(p_catalogue_number => 'FORGED')")).toEqual([]);
  });

  it.each(["https://supplier.example/product?token=secret", "https://supplier.example/product#private", "https://user:password@supplier.example/product", "http://supplier.example/product", "https://localhost/product", "javascript:alert(1)"])("does not publish unsafe or token-bearing URLs: %s", async url => {
    await expect(save({ p_confirm_url: true, p_product_url: url })).rejects.toThrow();
    expect(await asUser(owner, "select * from public.inventory_items")).toEqual([]);
  });

  it("keeps token-bearing QR links private", async () => {
    await expect(save({ p_barcode: "https://supplier.example/product?token=secret", p_confirm_code: true })).rejects.toThrow(/without query strings/);
    expect(await asUser(owner, "select * from public.product_catalogue")).toEqual([]);
  });
});
