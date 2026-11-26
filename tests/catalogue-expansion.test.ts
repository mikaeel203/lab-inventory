import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const seed = readFileSync(new URL("../supabase/seeds/starter_catalogue.sql", import.meta.url), "utf8");
const expansion = readFileSync(new URL("../supabase/seeds/catalogue_expansion.sql", import.meta.url), "utf8");
const user = "00000000-0000-4000-8000-000000000001";
let database: PGlite;

async function lookup(code: string | null, catalogue: string | null = null) {
  return database.transaction(async transaction => {
    await transaction.exec("set local role authenticated");
    await transaction.query("select set_config('request.jwt.claim.sub', $1, true)", [user]);
    return (await transaction.query<Record<string, unknown>>("select * from public.lookup_product_catalogue($1, $2, null)", [code, catalogue])).rows;
  });
}
async function snapshot(catalogue: boolean) {
  const { rows: tables } = await database.query<{ table_name: string }>("select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by table_name");
  const result: Record<string, unknown> = {};
  for (const { table_name: table } of tables) {
    if (["product_catalogue", "product_catalogue_aliases", "product_catalogue_codes"].includes(table) === catalogue) {
      result[table] = (await database.query(`select * from public."${table.replaceAll('"', '""')}" order by 1, 2`)).rows;
    }
  }
  return result;
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
  await database.query("insert into auth.users values($1, $2)", [user, JSON.stringify({ role: "lab", display_name: "Private Person", lab_name: "Private Lab", department: "Private Department", institution: "Private Institution" })]);
  await database.exec(seed);
});
afterAll(async () => { await database?.close(); });

describe("reviewed catalogue expansion", () => {
  it("adds 61 public product references and supports safe reimport in either seed order", async () => {
    await database.exec(expansion);
    const { rows: products } = await database.query<Record<string, unknown>>("select * from public.product_catalogue");
    expect(products).toHaveLength(86);
    const suppliers: Record<string, number> = {};
    for (const product of products) {
      expect(Object.keys(product).sort()).toEqual(["id", "name", "manufacturer_supplier", "catalogue_number", "container_size", "unit", "product_url"].sort());
      const host = new URL(product.product_url as string).hostname;
      suppliers[host] = (suppliers[host] ?? 0) + 1;
      expect(JSON.stringify(product)).not.toMatch(/Private|candidate_id|reviewed_at|workbook/);
    }
    expect(suppliers).toEqual({ "www.jacksonimmuno.com": 56, "www.sigmaaldrich.com": 27, "www.merckmillipore.com": 3 });
    expect((await database.query("select * from public.product_catalogue_aliases")).rows).toHaveLength(15);
    expect((await database.query("select * from public.product_catalogue_codes")).rows).toHaveLength(6);
    const before = await snapshot(true);
    await database.exec(expansion);
    await database.exec(seed);
    expect(await snapshot(true)).toEqual(before);
    await database.exec("truncate public.product_catalogue cascade");
    await database.exec(expansion);
    expect((await database.query("select * from public.product_catalogue")).rows).toHaveLength(61);
    await database.exec(seed);
    expect((await database.query("select * from public.product_catalogue")).rows).toHaveLength(86);
  });

  it("maps exact package aliases and GTINs, but leaves generic three-size lookups ambiguous", async () => {
    await database.exec(expansion);
    expect(await lookup(null, "N6876")).toHaveLength(3);
    expect(await lookup("https://www.sigmaaldrich.com/VE/en/product/sial/n6876")).toHaveLength(3);
    for (const [alias, code, size, unit] of [["N6876-1G", "04061835573592", "1", "g"], ["N6876-500MG", "04061835573615", "500", "mg"], ["N6876-5G", "04061835573622", "5", "g"]]) {
      const product = await lookup(code);
      expect(product).toHaveLength(1);
      expect(product[0]).toMatchObject({ catalogue_number: "N6876", container_size: size, unit });
      expect(await lookup(null, alias)).toEqual(product);
    }
    expect((await lookup(null, "Z628026-100EA"))[0]).toMatchObject({ container_size: "100", unit: "count" });
    expect((await lookup(null, "SAB5700639-100UL"))[0]).toMatchObject({ container_size: "100", unit: "µL" });
    expect(await lookup("4061835573592")).toEqual([]);
    expect(await lookup("https://www.jacksonimmuno.com/catalog/products/115-005-205?tracking=1")).toEqual([]);
  });

  it("preserves antibody identities and volume-versus-mass packages and excludes the held record", async () => {
    await database.exec(expansion);
    expect((await lookup(null, "115-035-205"))[0]).toMatchObject({ container_size: "0.5", unit: "mL" });
    expect((await lookup(null, "115-005-205"))[0]).toMatchObject({ container_size: "1", unit: "mg" });
    expect((await lookup(null, "715-165-140"))[0].name).toContain("IgM");
    expect((await lookup(null, "115-655-207"))[0]).toMatchObject({ container_size: "0.3", unit: "mg" });
    expect(await lookup(null, "115-155-207")).toEqual([]);
  });

  it("removes only the three scoped unsupported historical aliases, not products or unrelated mappings", async () => {
    for (const [alias, catalogue] of [["T-1503", "T1503"], ["E-5134", "E5134"], ["A-2383", "A2383"]]) {
      await database.query("insert into public.product_catalogue_aliases select $1, id from public.product_catalogue where catalogue_number = $2", [alias, catalogue]);
    }
    await database.exec("update public.product_catalogue set container_size = 1000, unit = 'g' where catalogue_number = 'E5134'");
    const unrelated = (await database.query<{ id: string }>("insert into public.product_catalogue(name, manufacturer_supplier, catalogue_number, container_size, unit) values('Unrelated', 'Another supplier', 'T1503', 1, 'kg') returning id")).rows[0];
    await database.query("insert into public.product_catalogue_aliases values('T-1503', $1)", [unrelated.id]);
    await database.exec(expansion);
    expect(await lookup(null, "T-1503")).toHaveLength(1);
    expect((await lookup(null, "T-1503"))[0].id).toBe(unrelated.id);
    expect(await lookup(null, "E-5134")).toEqual([]);
    expect(await lookup(null, "A-2383")).toEqual([]);
    expect(await lookup(null, "T1503")).toHaveLength(2);
    expect(await lookup("04061835544516")).toHaveLength(1);
  });

  it("preserves conflicting existing descriptions, equivalent sizes and code ownership", async () => {
    await database.exec("insert into public.product_catalogue(name, manufacturer_supplier, catalogue_number, container_size, unit) values('Existing verified variant', 'Sigma Aldrich', 'N6876', 1000, 'mg')");
    const [existing] = await lookup(null, "N6876");
    const [blocker] = await lookup(null, "T1503");
    await database.query("insert into public.product_catalogue_codes values('04061835573615', $1)", [blocker.id]);
    await database.exec(expansion);
    expect(await lookup(null, "N6876")).toHaveLength(3);
    expect((await database.query("select * from public.product_catalogue where id = $1", [existing.id])).rows).toEqual([existing]);
    expect(await lookup(null, "N6876-1G")).toEqual([]);
    expect(await lookup("04061835573592")).toEqual([]);
    expect((await lookup("04061835573615"))[0].id).toBe(blocker.id);
  });

  it("does not mutate any non-catalogue table and rolls back the whole import on failure", async () => {
    const lab = (await database.query<{ id: string }>("select id from public.labs where owner_id = $1", [user])).rows[0];
    await database.query("select set_config('request.jwt.claim.sub', $1, false)", [user]);
    await database.query("select public.save_inventory_item($1, 'Private stock', 1, 'L', p_manufacturer_supplier => 'Private supplier', p_container_count => 2, p_container_size => 1)", [lab.id]);
    const nonCatalogue = await snapshot(false);
    const catalogue = await snapshot(true);
    await expect(database.exec(expansion.replace(/commit;\s*$/, "select 1/0; commit;"))).rejects.toThrow(/division by zero/);
    await database.exec("rollback");
    expect(await snapshot(true)).toEqual(catalogue);
    expect(await snapshot(false)).toEqual(nonCatalogue);
    await database.exec(expansion);
    expect(await snapshot(false)).toEqual(nonCatalogue);
    await expect(database.transaction(async transaction => { await transaction.exec("set local role anon"); await transaction.exec("select * from public.product_catalogue"); })).rejects.toThrow(/permission denied/);
    await expect(database.transaction(async transaction => { await transaction.exec("set local role authenticated"); await transaction.exec("delete from public.product_catalogue"); })).rejects.toThrow(/permission denied/);
  });

  it("fails clearly before writing if the catalogue schema is missing", async () => {
    const empty = new PGlite();
    try {
      await expect(empty.exec(expansion)).rejects.toThrow(/Apply pending schema migrations/);
      await empty.exec("rollback");
      expect((await empty.query("select * from information_schema.tables where table_schema = 'public'")).rows).toEqual([]);
    } finally { await empty.close(); }
  });
});
