import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

it("upgrades existing inventory without inventing supplier or container data", async () => {
  const database = new PGlite();
  const owner = "00000000-0000-4000-8000-000000000001";
  const student = "00000000-0000-4000-8000-000000000002";
  const migration = (name: string) => readFileSync(new URL(`../supabase/migrations/${name}.sql`, import.meta.url), "utf8");
  try {
    await database.exec(`
      create role anon; create role authenticated;
      create schema auth; grant usage on schema auth to authenticated, anon;
      create table auth.users (id uuid primary key, raw_user_meta_data jsonb not null);
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
      $$;
    `);
    await database.exec(migration("202611240001_initial"));
    await database.exec(migration("202611250001_catalogue_number"));
    await database.query("insert into auth.users values ($1, $2), ($3, $4)", [owner, JSON.stringify({ role: "lab", display_name: "Lab", lab_name: "Chemistry", institution: "University", department: "Science" }), student, JSON.stringify({ role: "student", display_name: "Student" })]);
    await database.query("select set_config('request.jwt.claim.sub', $1, false)", [owner]);
    const [{ id: lab }] = (await database.query<{ id: string }>("select id from public.labs")).rows;
    const [{ id: item }] = (await database.query<{ id: string }>("select public.save_inventory_item($1, 'Legacy alcohol', 3.8, 'L', p_catalogue_number => '001') as id", [lab])).rows;
    await database.query("insert into public.memberships(lab_id, student_id) values ($1, $2)", [lab, student]);
    await database.query("select set_config('request.jwt.claim.sub', $1, false)", [student]);
    await database.query("select public.request_quantity_change($1, 3, 'L', 1)", [item]);
    await database.exec(migration("202611250002_stock_tracking"));
    expect((await database.query("select quantity, catalogue_number, manufacturer_supplier, container_count, container_size from public.inventory_items")).rows).toEqual([{ quantity: "3.8", catalogue_number: "001", manufacturer_supplier: null, container_count: null, container_size: null }]);
    expect((await database.query("select status from public.quantity_requests")).rows).toEqual([{ status: "stale" }]);
    await expect(database.query("select public.request_quantity_change($1, 3, 'L', 1, p_container_count => 2)", [item])).rejects.toThrow(/complete Manufacturer\/Supplier/);
    await database.query("select set_config('request.jwt.claim.sub', $1, false)", [owner]);
    await database.query("select public.archive_inventory_item($1, 1)", [item]);
    await database.query("select public.save_inventory_item($1, 'Legacy alcohol', 3.8, 'L', p_item_id => $2, p_version => 2, p_manufacturer_supplier => 'Merck', p_container_count => 2, p_container_size => 2.5)", [lab, item]);
    await database.exec(migration("202611250003_live_updates_and_delete"));
    await database.exec(migration("202611260001_shared_product_catalogue"));
    expect((await database.query("select * from public.product_catalogue")).rows).toEqual([]);
    expect((await database.query("select quantity, catalogue_number, archived, manufacturer_supplier from public.inventory_items")).rows).toEqual([{ quantity: "3.8", catalogue_number: "001", archived: false, manufacturer_supplier: "Merck" }]);
  } finally {
    await database.close();
  }
});
