import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const database = new PGlite();
await database.exec(`
  create role anon; create role authenticated; create schema auth;
  grant usage on schema auth to anon, authenticated;
  create table auth.users (id uuid primary key, raw_user_meta_data jsonb not null);
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
  $$;
`);
const migrations = new URL("../../supabase/migrations/", import.meta.url);
for (const file of readdirSync(migrations).filter(file => file.endsWith(".sql")).sort()) {
  await database.exec(readFileSync(new URL(file, migrations), "utf8"));
}

const accounts = new Map();
async function addAccount(email, password, metadata, confirmed = true) {
  const id = randomUUID();
  await database.query("insert into auth.users values($1, $2)", [id, JSON.stringify(metadata)]);
  const user = { id, email, aud: "authenticated", role: "authenticated", app_metadata: { provider: "email", providers: ["email"] }, user_metadata: metadata, created_at: new Date().toISOString(), email_confirmed_at: confirmed ? new Date().toISOString() : undefined, identities: [] };
  accounts.set(email, { user, password });
  return user;
}
async function reset() {
  accounts.clear(); await database.exec("truncate auth.users cascade; truncate public.product_catalogue cascade");
  const owner = await addAccount("lab@example.test", "test-password-123", { role: "lab", display_name: "Chemistry Lab", lab_name: "Chemistry Lab", department: "Chemistry", institution: "Example University" });
  await addAccount("other@example.test", "test-password-123", { role: "lab", display_name: "Biology Lab", lab_name: "Biology Lab", department: "Biology", institution: "Example University" });
  await addAccount("student@example.test", "test-password-123", { role: "student", display_name: "Alex Student" });
  await database.transaction(async transaction => {
    await transaction.query("select set_config('request.jwt.claim.sub', $1, true)", [owner.id]);
    await transaction.query("select public.save_inventory_item((select id from public.labs where owner_id = $1), 'Ethanol', 1000, 'mL', '1234567890123', 'EAN_13', 'https://example.com/ethanol', p_manufacturer_supplier => 'Test Supplier', p_container_count => 2, p_container_size => 1000)", [owner.id]);
  });
}
await reset();

function session(user) {
  const encode = value => Buffer.from(JSON.stringify(value)).toString("base64url");
  const access_token = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ sub: user.id, email: user.email, role: "authenticated", aud: "authenticated", exp: Math.floor(Date.now() / 1000) + 3600, iat: Math.floor(Date.now() / 1000) })}.test-signature`;
  return { access_token, token_type: "bearer", expires_in: 3600, refresh_token: user.id, user };
}
function userFrom(request) {
  try {
    const token = request.headers.authorization?.replace("Bearer ", "");
    const id = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString()).sub;
    return [...accounts.values()].find(account => account.user.id === id)?.user;
  } catch { return undefined; }
}
const tables = new Set(["profiles", "labs", "memberships", "join_requests", "inventory_items", "quantity_requests", "audit_events"]);
const rpcs = new Set(["request_membership", "membership_inbox", "decide_membership", "end_membership", "cancel_join_request", "save_inventory_item", "archive_inventory_item", "delete_inventory_item", "request_quantity_change", "decide_quantity_change", "reserve_lookup", "lookup_product_catalogue", "save_catalogued_inventory_item"]);

createServer(async (request, response) => {
  response.setHeader("Access-Control-Allow-Origin", "http://127.0.0.1:3100");
  response.setHeader("Access-Control-Allow-Headers", "authorization, apikey, content-type, content-profile, accept-profile, x-client-info, x-retry-count, prefer, range, accept, x-supabase-api-version");
  response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS, PUT");
  const send = (status, data) => { response.writeHead(status, { "Content-Type": "application/json" }); response.end(JSON.stringify(data)); };
  if (request.method === "OPTIONS") return send(200, {});
  const url = new URL(request.url, "http://127.0.0.1:54329");
  let body = {};
  try {
    let text = ""; for await (const chunk of request) text += chunk;
    if (text) body = JSON.parse(text);
    if (url.pathname === "/health") return send(200, { ready: true });
    if (url.pathname === "/reset" && request.method === "POST") { await reset(); return send(200, {}); }
    if (url.pathname === "/auth/v1/token") {
      const account = accounts.get(body.email) ?? [...accounts.values()].find(entry => entry.user.id === body.refresh_token);
      if (!account || (body.password && account.password !== body.password) || !account.user.email_confirmed_at) return send(400, { error: "invalid_grant", error_description: "Invalid login credentials", msg: "Invalid login credentials" });
      return send(200, session(account.user));
    }
    if (url.pathname === "/auth/v1/signup") {
      const user = await addAccount(body.email, body.password, body.data, false);
      return send(200, user);
    }
    if (url.pathname === "/auth/v1/recover") return send(200, {});
    if (url.pathname === "/auth/v1/resend") return send(200, {});
    if (url.pathname === "/auth/v1/logout") return send(204, null);
    const user = userFrom(request);
    if (!user) return send(401, { message: "Sign in first." });
    if (url.pathname === "/auth/v1/user") return send(200, user);
    const result = await database.transaction(async transaction => {
      await transaction.exec("set local role authenticated");
      await transaction.query("select set_config('request.jwt.claim.sub', $1, true)", [user.id]);
      if (url.pathname.startsWith("/rest/v1/rpc/")) {
        const rpc = url.pathname.split("/").at(-1);
        if (!rpcs.has(rpc)) throw new Error("Unsupported test RPC");
        const keys = Object.keys(body);
        if (keys.some(key => !/^p_[a-z_]+$/.test(key))) throw new Error("Invalid parameter");
        const args = keys.map((key, index) => `${key} => $${index + 1}`).join(",");
        if (rpc === "membership_inbox" || rpc === "lookup_product_catalogue") return (await transaction.query(`select * from public.${rpc}(${args})`, Object.values(body))).rows;
        return (await transaction.query(`select public.${rpc}(${args}) as result`, Object.values(body))).rows[0].result;
      }
      const table = url.pathname.split("/").at(-1);
      if (!tables.has(table) || request.method !== "GET") throw new Error("Unsupported test route");
      const columns = url.searchParams.get("select") ?? "*";
      if (!/^(\*|[a-z_,]+)$/.test(columns)) throw new Error("Invalid projection");
      const parameters = [];
      const conditions = [];
      for (const [key, value] of url.searchParams) {
        if (["select", "order", "limit", "offset", "or"].includes(key)) continue;
        if (!/^[a-z_]+$/.test(key)) throw new Error("Invalid filter");
        if (value.startsWith("eq.")) { parameters.push(value.slice(3)); conditions.push(`${key} = $${parameters.length}`); }
        else if (value.startsWith("in.(")) { parameters.push(value.slice(4, -1).split(",")); conditions.push(`${key} = any($${parameters.length}::uuid[])`); }
        else throw new Error("Unsupported filter");
      }
      if (url.searchParams.has("or")) {
        const match = url.searchParams.get("or").match(/name\.ilike\.(%[^,]*%)/);
        parameters.push(match?.[1] ?? "%%"); conditions.push(`(name ilike $${parameters.length} or department ilike $${parameters.length} or institution ilike $${parameters.length})`);
      }
      const ordering = (url.searchParams.get("order") ?? "id.asc").split(",").map(part => {
        const [column, direction] = part.split(".");
        if (!/^[a-z_]+$/.test(column) || !["asc", "desc"].includes(direction)) throw new Error("Invalid order");
        return `${column} ${direction}`;
      }).join(",");
      const limit = Math.min(Number(url.searchParams.get("limit") ?? 1000), 1000);
      const offset = Number(url.searchParams.get("offset") ?? 0);
      if (!Number.isInteger(limit) || !Number.isInteger(offset)) throw new Error("Invalid pagination");
      return (await transaction.query(`select ${columns} from public.${table} ${conditions.length ? `where ${conditions.join(" and ")}` : ""} order by ${ordering} limit ${limit} offset ${offset}`, parameters)).rows;
    });
    if (request.headers.accept?.includes("vnd.pgrst.object")) {
      if (!Array.isArray(result) || result.length !== 1) return send(406, { code: "PGRST116", message: "Expected a single row" });
      return send(200, result[0]);
    }
    return send(200, result);
  } catch (error) { return send(400, { message: error.message, code: error.code ?? "TEST_ERROR" }); }
}).listen(54329, "127.0.0.1");
