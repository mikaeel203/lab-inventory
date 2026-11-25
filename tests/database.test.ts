import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

let database: PGlite;
const owner = "00000000-0000-4000-8000-000000000001";
const secondOwner = "00000000-0000-4000-8000-000000000002";
const thirdOwner = "00000000-0000-4000-8000-000000000005";
const student = "00000000-0000-4000-8000-000000000003";
const outsider = "00000000-0000-4000-8000-000000000004";
let lab: string;
let secondLab: string;
let thirdLab: string;
let item: string;

async function asUser<T = Record<string, unknown>>(user: string, sql: string, values: unknown[] = []) {
  return database.transaction(async transaction => {
    await transaction.exec("set local role authenticated");
    await transaction.query("select set_config('request.jwt.claim.sub', $1, true)", [user]);
    return (await transaction.query<T>(sql, values)).rows;
  });
}

async function join(targetLab = lab, targetOwner = owner, acknowledge = false, targetStudent = student) {
  const [request] = await asUser<{ id: string }>(targetStudent, "select public.request_membership($1) as id", [targetLab]);
  await asUser(targetOwner, "select public.decide_membership($1, true, $2)", [request.id, acknowledge]);
  return request.id;
}

async function quantityRequest(targetStudent = student) {
  const [request] = await asUser<{ id: string }>(targetStudent, "select public.request_quantity_change($1, 750, 'mL', 1, 'Used in practical', p_container_count => 1) as id", [item]);
  return request.id;
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
  for (const file of readdirSync(directory).filter(file => file.endsWith(".sql")).sort()) {
    await database.exec(readFileSync(new URL(file, directory), "utf8"));
  }
});

beforeEach(async () => {
  await database.exec("truncate auth.users cascade");
  for (const [id, role, name] of [[owner, "lab", "Chemistry Lab"], [secondOwner, "lab", "Biology Lab"], [thirdOwner, "lab", "Physics Lab"], [student, "student", "Alex Student"], [outsider, "student", "Sam Outside"]]) {
    await database.query("insert into auth.users values($1, $2)", [id, JSON.stringify({ role, display_name: name, lab_name: name, department: "Science", institution: "Test University" })]);
  }
  const labs = (await database.query<{ id: string; owner_id: string }>("select id, owner_id from public.labs")).rows;
  lab = labs.find(entry => entry.owner_id === owner)!.id;
  secondLab = labs.find(entry => entry.owner_id === secondOwner)!.id;
  thirdLab = labs.find(entry => entry.owner_id === thirdOwner)!.id;
  const [created] = await asUser<{ id: string }>(owner, "select public.save_inventory_item($1, 'Sodium chloride', 1000, 'mL', 'CODE-100', 'CODE_128', p_manufacturer_supplier => 'Test Supplier', p_container_count => 2, p_container_size => 1000) as id", [lab]);
  item = created.id;
});

afterAll(async () => { await database?.close(); });

describe("database permissions and account creation", () => {
  it("creates profiles and lab metadata atomically", async () => {
    expect(await asUser(owner, "select role from public.profiles where id = $1", [owner])).toEqual([{ role: "lab" }]);
    expect(await asUser(student, "select name, department, institution from public.labs where id = $1", [lab])).toEqual([{ name: "Chemistry Lab", department: "Science", institution: "Test University" }]);
    await expect(database.query("insert into auth.users values(gen_random_uuid(), $1)", [JSON.stringify({ role: "lab", display_name: "Missing metadata" })])).rejects.toThrow();
  });
  it("hides inventory from outsiders, pending students, and unrelated lab owners", async () => {
    await asUser(student, "select public.request_membership($1)", [lab]);
    for (const actor of [student, outsider, secondOwner]) expect(await asUser(actor, "select * from public.inventory_items")).toHaveLength(0);
    expect(await asUser(owner, "select * from public.inventory_items")).toHaveLength(1);
  });
  it("denies anonymous table reads and RPC calls", async () => {
    await expect(database.transaction(async transaction => { await transaction.exec("set local role anon"); await transaction.query("select * from public.labs"); })).rejects.toThrow(/permission denied/);
    await expect(database.transaction(async transaction => { await transaction.exec("set local role anon"); await transaction.query("select public.request_membership($1)", [lab]); })).rejects.toThrow(/permission denied/);
  });
  it("prevents direct writes even by lab owners, and prevents role escalation", async () => {
    for (const actor of [owner, student]) await expect(asUser(actor, "update public.inventory_items set quantity = 0")).rejects.toThrow(/permission denied/);
    await expect(asUser(student, "update public.profiles set role = 'lab' where id = $1", [student])).rejects.toThrow(/permission denied/);
    await database.query("update auth.users set raw_user_meta_data = raw_user_meta_data || '{\"role\":\"lab\"}' where id = $1", [student]);
    expect(await asUser(student, "select role from public.profiles where id = $1", [student])).toEqual([{ role: "student" }]);
    await expect(asUser(student, "select public.save_inventory_item($1, 'Intrusion', 1, 'g', p_manufacturer_supplier => 'Test Supplier', p_container_count => 2, p_container_size => 1000)", [lab])).rejects.toThrow(/owner/);
    await expect(asUser(secondOwner, "select public.archive_inventory_item($1, 1)", [item])).rejects.toThrow(/owner/);
  });
});

describe("membership workflow", () => {
  it("grants first-lab access only after approval", async () => {
    await join();
    expect(await asUser(student, "select name from public.inventory_items")).toEqual([{ name: "Sodium chloride" }]);
    expect(await asUser(outsider, "select * from public.memberships")).toHaveLength(0);
    expect(await asUser(outsider, "select * from public.profiles where id = $1", [student])).toHaveLength(0);
  });
  it("requires acknowledgement for second and further labs while preserving memberships", async () => {
    await join();
    const [request] = await asUser<{ id: string }>(student, "select public.request_membership($1) as id", [secondLab]);
    const inbox = await asUser<{ existing_memberships: number }>(secondOwner, "select * from public.membership_inbox($1)", [secondLab]);
    expect(Number(inbox[0].existing_memberships)).toBe(1);
    await expect(asUser(secondOwner, "select public.decide_membership($1, true)", [request.id])).rejects.toThrow(/Acknowledge/);
    await asUser(secondOwner, "select public.decide_membership($1, true, true)", [request.id]);
    await expect(join(thirdLab, thirdOwner)).rejects.toThrow(/Acknowledge/);
    expect(await asUser(student, "select * from public.memberships where active")).toHaveLength(2);
    expect(await asUser(secondOwner, "select acknowledged_existing from public.join_requests where id = $1", [request.id])).toEqual([{ acknowledged_existing: true }]);
    expect(await asUser(secondOwner, "select * from public.memberships where lab_id = $1", [lab])).toHaveLength(0);
  });
  it("rechecks memberships at decision time for concurrently pending requests", async () => {
    const [first] = await asUser<{ id: string }>(student, "select public.request_membership($1) as id", [lab]);
    const [second] = await asUser<{ id: string }>(student, "select public.request_membership($1) as id", [secondLab]);
    const decisions = await Promise.allSettled([
      asUser(owner, "select public.decide_membership($1, true)", [first.id]),
      asUser(secondOwner, "select public.decide_membership($1, true)", [second.id]),
    ]);
    expect(decisions.filter(decision => decision.status === "fulfilled")).toHaveLength(1);
    expect(decisions.filter(decision => decision.status === "rejected")).toHaveLength(1);
  });
  it("supports rejection, cancellation, and membership removal", async () => {
    const [request] = await asUser<{ id: string }>(student, "select public.request_membership($1) as id", [lab]);
    await expect(asUser(secondOwner, "select public.decide_membership($1, true)", [request.id])).rejects.toThrow(/owner/);
    await asUser(owner, "select public.decide_membership($1, false, false, 'Contact the department first')", [request.id]);
    expect(await asUser(student, "select * from public.inventory_items")).toHaveLength(0);
    const [retry] = await asUser<{ id: string }>(student, "select public.request_membership($1) as id", [lab]);
    await asUser(student, "select public.cancel_join_request($1)", [retry.id]);
    await join();
    await asUser(student, "select public.end_membership($1, $2)", [lab, student]);
    expect(await asUser(student, "select * from public.inventory_items")).toHaveLength(0);
  });
});

describe("inventory and quantity approvals", () => {
  it("publishes only the needed workspace tables without relaxing RLS", async () => {
    expect((await database.query<{ tablename: string }>("select tablename from pg_publication_tables where pubname = 'supabase_realtime' order by tablename")).rows.map(row => row.tablename)).toEqual(["audit_events", "inventory_items", "join_requests", "memberships", "quantity_requests"]);
    expect((await database.query("select relname from pg_class where relname in ('inventory_items', 'memberships', 'join_requests', 'quantity_requests', 'audit_events') and not relrowsecurity")).rows).toHaveLength(0);
  });
  it("only allows owners to delete, with optimistic version checking", async () => {
    await join();
    for (const actor of [student, outsider, secondOwner]) {
      await expect(asUser(actor, "select public.delete_inventory_item($1, 1)", [item])).rejects.toThrow(/owner/);
    }
    await expect(database.transaction(async transaction => {
      await transaction.exec("set local role anon");
      await transaction.query("select public.delete_inventory_item($1, 1)", [item]);
    })).rejects.toThrow(/permission denied/);
    await expect(asUser(owner, "delete from public.inventory_items where id = $1", [item])).rejects.toThrow(/permission denied/);
    await expect(asUser(owner, "select public.delete_inventory_item($1, 2)", [item])).rejects.toThrow(/changed/);
    await expect(asUser(owner, "select public.delete_inventory_item($1, null)", [item])).rejects.toThrow(/changed/);
    expect(await asUser(owner, "select id from public.inventory_items where id = $1", [item])).toHaveLength(1);
  });
  it("deletes products and their requests atomically while retaining an audit snapshot", async () => {
    await join(); const request = await quantityRequest();
    await asUser(owner, "select public.delete_inventory_item($1, 1)", [item]);
    expect(await asUser(owner, "select * from public.inventory_items")).toHaveLength(0);
    expect(await asUser(student, "select * from public.quantity_requests where id = $1", [request])).toHaveLength(0);
    expect(await asUser(owner, "select details->>'name' as name, details->'product'->>'manufacturer_supplier' as supplier from public.audit_events where action = 'product.deleted'")).toEqual([{ name: "Sodium chloride", supplier: "Test Supplier" }]);
    await expect(asUser(owner, "select public.delete_inventory_item($1, 1)", [item])).rejects.toThrow(/owner/);
    await expect(asUser(owner, "select public.decide_quantity_change($1, true)", [request])).rejects.toThrow(/owner/);
  });
  it("allows deletion of archived products without accepting stale confirmation versions", async () => {
    await asUser(owner, "select public.archive_inventory_item($1, 1)", [item]);
    await expect(asUser(owner, "select public.delete_inventory_item($1, 1)", [item])).rejects.toThrow(/changed/);
    await asUser(owner, "select public.delete_inventory_item($1, 2)", [item]);
    expect(await asUser(owner, "select * from public.inventory_items")).toHaveLength(0);
  });
  it("requires Manufacturer/Supplier and container details even for older API callers", async () => {
    await expect(asUser(owner, "select public.save_inventory_item($1, 'Missing', 0, 'L')", [lab])).rejects.toThrow(/Manufacturer\/Supplier is required/);
    for (const supplier of [null, "", "   ", "X".repeat(181), "Bad\nSupplier"]) {
      await expect(asUser(owner, "select public.save_inventory_item($1, 'Invalid supplier', 1, 'L', p_manufacturer_supplier => $2, p_container_count => 2, p_container_size => 2.5)", [lab, supplier])).rejects.toThrow();
    }
    await expect(asUser(owner, "select public.save_inventory_item($1, 'Missing containers', 0, 'L', p_manufacturer_supplier => 'Merck')", [lab])).rejects.toThrow(/Container count/);
  });
  it("stores package details, partially used totals and independently nullable thresholds", async () => {
    const [saved] = await asUser<{ id: string }>(owner, "select public.save_inventory_item($1, 'Alcohol', 3.8, 'L', p_manufacturer_supplier => '  Merck  ', p_container_count => 2, p_container_size => 2.5, p_minimum_containers => 2, p_minimum_quantity => 4) as id", [lab]);
    expect(await asUser(owner, "select manufacturer_supplier, container_count, container_size, quantity, minimum_containers, minimum_quantity from public.inventory_items where id = $1", [saved.id])).toEqual([
      { manufacturer_supplier: "Merck", container_count: "2", container_size: "2.5", quantity: "3.8", minimum_containers: "2", minimum_quantity: "4" },
    ]);
    await asUser(owner, "select public.save_inventory_item($1, 'Alcohol', 3.8, 'L', p_item_id => $2, p_version => 1, p_manufacturer_supplier => 'Merck', p_container_count => 2, p_container_size => 2.5, p_minimum_quantity => 0)", [lab, saved.id]);
    expect(await asUser(owner, "select minimum_containers, minimum_quantity from public.inventory_items where id = $1", [saved.id])).toEqual([{ minimum_containers: null, minimum_quantity: "0" }]);
    expect(await asUser(owner, "select details->>'previous_minimum_quantity' as previous from public.audit_events where action = 'product.updated' and details->>'item_id' = $1", [saved.id])).toEqual([{ previous: "4" }]);
  });
  it.each([
    [-1, 2.5, null, null], [1.5, 2.5, null, null], [null, 2.5, null, null], [1e13, 2.5, null, null],
    [2, 0, null, null], [2, -1, null, null], [2, null, null, null], [2, 1e13, null, null],
    [2, 2.5, -1, null], [2, 2.5, 1.5, null], [2, 2.5, null, -1], [2, 2.5, null, 1e13],
  ])("rejects invalid stock settings %s / %s / %s / %s", async (count, size, minimumCount, minimumAmount) => {
    await expect(asUser(owner, "select public.save_inventory_item($1, 'Invalid', 0, 'L', p_manufacturer_supplier => 'Merck', p_container_count => $2, p_container_size => $3, p_minimum_containers => $4, p_minimum_quantity => $5)", [lab, count, size, minimumCount, minimumAmount])).rejects.toThrow();
  });
  it("enforces capacity, integer count measurements and permits depletion", async () => {
    await expect(asUser(owner, "select public.save_inventory_item($1, 'Over capacity', 5.1, 'L', p_manufacturer_supplier => 'Merck', p_container_count => 2, p_container_size => 2.5)", [lab])).rejects.toThrow(/capacity/);
    await expect(asUser(owner, "select public.save_inventory_item($1, 'Fractional pack', 1, 'count', p_manufacturer_supplier => 'Merck', p_container_count => 2, p_container_size => 2.5)", [lab])).rejects.toThrow(/check constraint/);
    await expect(asUser(owner, "select public.save_inventory_item($1, 'Fractional threshold', 1, 'count', p_manufacturer_supplier => 'Merck', p_container_count => 2, p_container_size => 2, p_minimum_quantity => 0.5)", [lab])).rejects.toThrow(/check constraint/);
    await asUser(owner, "select public.save_inventory_item($1, 'Depleted', 0, 'L', p_manufacturer_supplier => 'Merck', p_container_count => 0, p_container_size => 2.5)", [lab]);
  });
  it("applies student counts and remaining totals together without changing thresholds or supplier", async () => {
    await join();
    const request = await quantityRequest();
    expect(await asUser(owner, "select container_count from public.inventory_items where id = $1", [item])).toEqual([{ container_count: "2" }]);
    await asUser(owner, "select public.decide_quantity_change($1, true)", [request]);
    expect(await asUser(student, "select container_count, quantity, manufacturer_supplier, container_size from public.inventory_items where id = $1", [item])).toEqual([{ container_count: "1", quantity: "750", manufacturer_supplier: "Test Supplier", container_size: "1000" }]);
    expect(await asUser(owner, "select details->>'previous_container_count' as previous from public.audit_events where action = 'quantity.approved'")).toEqual([{ previous: "2" }]);
  });
  it("rejects student unit changes, invalid counts, over-capacity amounts and missing counts", async () => {
    await join();
    await expect(asUser(student, "select public.request_quantity_change($1, 1, 'L', 1, p_container_count => 1)", [item])).rejects.toThrow(/measurement unit/);
    for (const count of [null, -1, 1.5, 1e13, 0]) {
      await expect(asUser(student, "select public.request_quantity_change($1, 750, 'mL', 1, p_container_count => $2)", [item, count])).rejects.toThrow();
    }
    await expect(asUser(student, "select public.request_quantity_change($1, 1001, 'mL', 1, p_container_count => 1)", [item])).rejects.toThrow(/capacity/);
    await expect(asUser(student, "select public.request_quantity_change($1, 750, 'mL', 1)", [item])).rejects.toThrow(/Container count/);
  });
  it("makes proposals stale when the lab changes stock settings", async () => {
    await join(); const request = await quantityRequest();
    await asUser(owner, "select public.save_inventory_item($1, 'Sodium chloride', 1000, 'mL', p_item_id => $2, p_version => 1, p_manufacturer_supplier => 'Merck', p_container_count => 2, p_container_size => 1000, p_minimum_containers => 3)", [lab, item]);
    expect(await asUser(owner, "select public.decide_quantity_change($1, true) as status", [request])).toEqual([{ status: "stale" }]);
    expect(await asUser(owner, "select container_count, minimum_containers, quantity from public.inventory_items where id = $1", [item])).toEqual([{ container_count: "2", minimum_containers: "3", quantity: "1000" }]);
  });
  it("stores editable catalogue numbers without changing their case or leading zeros", async () => {
    await asUser(owner, "select public.save_inventory_item($1, 'Sodium chloride', 1000, 'mL', 'CODE-100', 'CODE_128', null, $2, 1, '  001-AbC  ', p_manufacturer_supplier => 'Test Supplier', p_container_count => 2, p_container_size => 1000)", [lab, item]);
    expect(await asUser(owner, "select catalogue_number, version from public.inventory_items where id = $1", [item])).toEqual([{ catalogue_number: "001-AbC", version: 2 }]);
    await join();
    expect(await asUser(student, "select catalogue_number from public.inventory_items where id = $1", [item])).toEqual([{ catalogue_number: "001-AbC" }]);
    await expect(asUser(student, "select public.save_inventory_item($1, 'Intrusion', 1, 'g', p_catalogue_number => 'FORGED', p_manufacturer_supplier => 'Test Supplier', p_container_count => 2, p_container_size => 1000)", [lab])).rejects.toThrow(/owner/);
    await asUser(owner, "select public.save_inventory_item($1, 'Sodium chloride', 1000, 'mL', 'CODE-100', 'CODE_128', null, $2, 2, '002-DEF', p_manufacturer_supplier => 'Test Supplier', p_container_count => 2, p_container_size => 1000)", [lab, item]);
    expect(await asUser(owner, "select details->>'previous_catalogue_number' as previous from public.audit_events where details->>'catalogue_number' = '002-DEF'")).toEqual([{ previous: "001-AbC" }]);
  });
  it("enforces catalogue uniqueness per lab, including archived products", async () => {
    await asUser(owner, "select public.save_inventory_item($1, 'Sodium chloride', 1000, 'mL', 'CODE-100', 'CODE_128', null, $2, 1, 'ABC-123', p_manufacturer_supplier => 'Test Supplier', p_container_count => 2, p_container_size => 1000)", [lab, item]);
    await expect(asUser(owner, "select public.save_inventory_item($1, 'Duplicate', 1, 'g', p_catalogue_number => ' abc-123 ', p_manufacturer_supplier => 'Test Supplier', p_container_count => 2, p_container_size => 1000)", [lab])).rejects.toThrow(/Catalogue Number already/);
    await asUser(secondOwner, "select public.save_inventory_item($1, 'Separate lab', 1, 'g', p_catalogue_number => 'ABC-123', p_manufacturer_supplier => 'Test Supplier', p_container_count => 2, p_container_size => 1000)", [secondLab]);
    await asUser(owner, "select public.archive_inventory_item($1, 2)", [item]);
    await expect(asUser(owner, "select public.save_inventory_item($1, 'Duplicate', 1, 'g', p_catalogue_number => 'ABC-123', p_manufacturer_supplier => 'Test Supplier', p_container_count => 2, p_container_size => 1000)", [lab])).rejects.toThrow(/Catalogue Number already/);
  });
  it("allows unknown identifiers for existing products and rejects oversized values", async () => {
    expect(await asUser(owner, "select catalogue_number from public.inventory_items where id = $1", [item])).toEqual([{ catalogue_number: null }]);
    await asUser(owner, "select public.save_inventory_item($1, 'Another unknown', 1, 'g', p_catalogue_number => '   ', p_manufacturer_supplier => 'Test Supplier', p_container_count => 2, p_container_size => 1000)", [lab]);
    await expect(asUser(owner, "select public.save_inventory_item($1, 'Bad number', 1, 'g', p_catalogue_number => $2, p_manufacturer_supplier => 'Test Supplier', p_container_count => 2, p_container_size => 1000)", [lab, "X".repeat(121)])).rejects.toThrow(/check constraint/);
  });
  it("preserves catalogue numbers for older clients and allows explicit clearing", async () => {
    await asUser(owner, "select public.save_inventory_item($1, 'Sodium chloride', 1000, 'mL', 'CODE-100', 'CODE_128', null, $2, 1, '001-ABC', p_manufacturer_supplier => 'Test Supplier', p_container_count => 2, p_container_size => 1000)", [lab, item]);
    await asUser(owner, "select public.save_inventory_item($1, 'Sodium chloride', 900, 'mL', 'CODE-100', 'CODE_128', null, $2, 2, p_manufacturer_supplier => 'Test Supplier', p_container_count => 2, p_container_size => 1000)", [lab, item]);
    expect(await asUser(owner, "select catalogue_number from public.inventory_items where id = $1", [item])).toEqual([{ catalogue_number: "001-ABC" }]);
    await asUser(owner, "select public.save_inventory_item($1, 'Sodium chloride', 900, 'mL', 'CODE-100', 'CODE_128', null, $2, 3, '', p_manufacturer_supplier => 'Test Supplier', p_container_count => 2, p_container_size => 1000)", [lab, item]);
    expect(await asUser(owner, "select catalogue_number from public.inventory_items where id = $1", [item])).toEqual([{ catalogue_number: null }]);
  });
  it("enforces valid quantities, counts, URLs and per-lab barcode uniqueness", async () => {
    for (const [quantity, unit] of [[-1, "mL"], [1.5, "count"], [1e13, "g"], [2, "unknown"]]) {
      await expect(asUser(owner, "select public.save_inventory_item($1, 'Invalid', $2, $3, p_manufacturer_supplier => 'Test Supplier', p_container_count => 2, p_container_size => 1000)", [lab, quantity, unit])).rejects.toThrow();
    }
    await expect(asUser(owner, "select public.save_inventory_item($1, 'Duplicate', 1, 'g', 'CODE-100', p_manufacturer_supplier => 'Test Supplier', p_container_count => 2, p_container_size => 1000)", [lab])).rejects.toThrow(/unique/);
    await expect(asUser(owner, "select public.save_inventory_item($1, 'Unsafe', 1, 'g', null, null, 'javascript:alert(1)', p_manufacturer_supplier => 'Test Supplier', p_container_count => 2, p_container_size => 1000)", [lab])).rejects.toThrow();
    await asUser(secondOwner, "select public.save_inventory_item($1, 'Same code, separate lab', 1, 'g', 'CODE-100', p_manufacturer_supplier => 'Test Supplier', p_container_count => 2, p_container_size => 1000)", [secondLab]);
  });
  it("does not apply a student proposal until the owning lab approves it", async () => {
    await join();
    const request = await quantityRequest();
    expect(await asUser(student, "select quantity from public.inventory_items where id = $1", [item])).toEqual([{ quantity: "1000" }]);
    await expect(asUser(student, "select public.decide_quantity_change($1, true)", [request])).rejects.toThrow(/owner/);
    await expect(asUser(secondOwner, "select public.decide_quantity_change($1, true)", [request])).rejects.toThrow(/owner/);
    await asUser(owner, "select public.decide_quantity_change($1, true)", [request]);
    expect(await asUser(student, "select quantity, version from public.inventory_items where id = $1", [item])).toEqual([{ quantity: "750", version: 2 }]);
    await expect(asUser(owner, "select public.decide_quantity_change($1, true)", [request])).rejects.toThrow(/already/);
  });
  it("keeps stock unchanged on rejection and logs the decision", async () => {
    await join(); const request = await quantityRequest();
    await asUser(owner, "select public.decide_quantity_change($1, false, 'Please recount')", [request]);
    expect(await asUser(student, "select quantity from public.inventory_items")).toEqual([{ quantity: "1000" }]);
    expect(await asUser(student, "select response from public.quantity_requests where id = $1", [request])).toEqual([{ response: "Please recount" }]);
    expect(await asUser(owner, "select action from public.audit_events where action = 'quantity.rejected'")).toHaveLength(1);
  });
  it("marks stale requests without overwriting newer values and permits resubmission", async () => {
    await join(); const request = await quantityRequest();
    await asUser(owner, "select public.save_inventory_item($1, 'Sodium chloride', 900, 'mL', 'CODE-100', 'CODE_128', null, $2, 1, p_manufacturer_supplier => 'Test Supplier', p_container_count => 2, p_container_size => 1000)", [lab, item]);
    expect(await asUser(owner, "select public.decide_quantity_change($1, true) as status", [request])).toEqual([{ status: "stale" }]);
    expect(await asUser(student, "select quantity from public.inventory_items")).toEqual([{ quantity: "900" }]);
    await asUser(student, "select public.request_quantity_change($1, 800, 'mL', 2, p_container_count => 1)", [item]);
    await expect(asUser(owner, "select public.save_inventory_item($1, 'Old edit', 1, 'mL', null, null, null, $2, 1, p_manufacturer_supplier => 'Test Supplier', p_container_count => 2, p_container_size => 1000)", [lab, item])).rejects.toThrow(/changed/);
  });
  it("revokes access and cancels pending requests atomically", async () => {
    await join(); const request = await quantityRequest();
    await asUser(owner, "select public.end_membership($1, $2)", [lab, student]);
    expect(await asUser(student, "select * from public.inventory_items")).toHaveLength(0);
    expect(await asUser(student, "select status from public.quantity_requests where id = $1", [request])).toEqual([{ status: "cancelled" }]);
    await expect(asUser(owner, "select public.decide_quantity_change($1, true)", [request])).rejects.toThrow(/already/);
    await expect(quantityRequest()).rejects.toThrow(/membership/);
  });
  it("archives without deleting history and restores the same product", async () => {
    await join(); const request = await quantityRequest();
    await asUser(owner, "select public.archive_inventory_item($1, 1)", [item]);
    expect(await asUser(student, "select * from public.inventory_items")).toHaveLength(0);
    expect(await asUser(owner, "select public.decide_quantity_change($1, true) as status", [request])).toEqual([{ status: "stale" }]);
    await asUser(owner, "select public.save_inventory_item($1, 'Sodium chloride', 10, 'mL', 'CODE-100', 'CODE_128', null, $2, 2, p_manufacturer_supplier => 'Test Supplier', p_container_count => 2, p_container_size => 1000)", [lab, item]);
    expect(await asUser(student, "select archived from public.inventory_items")).toEqual([{ archived: false }]);
  });
  it("limits URL lookups per lab account and rejects student lookups", async () => {
    await expect(asUser(student, "select public.reserve_lookup()")).rejects.toThrow(/owner/);
    for (let count = 0; count < 10; count++) expect(await asUser(owner, "select public.reserve_lookup() as allowed")).toEqual([{ allowed: true }]);
    expect(await asUser(owner, "select public.reserve_lookup() as allowed")).toEqual([{ allowed: false }]);
  });
});
