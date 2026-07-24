// Read-only reconciliation of the retired Supabase Cloud project and warnoto.com.
// It intentionally prints only counts and SHA-256 digests: never row identifiers,
// payload values, service keys, emails, or object paths. It has no write API calls.
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const PRIMARY_KEY = { role_permissions: "role" };
const PAGE_SIZE = 1000;
const RETRY_PAGE_SIZE = 100;
const STORAGE_BUCKETS = ["material-photos", "stock-photos", "tug-photos", "tug-docs-private"];

function envFile() {
  if (!existsSync(".env")) return {};
  return Object.fromEntries(readFileSync(".env", "utf8").split(/\r?\n/)
    .map(line => line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/))
    .filter(Boolean).map(([, key, value]) => [key, value.replace(/^['"]|['"]$/g, "")]));
}
const fileEnv = envFile();
const env = key => process.env[key] || fileEnv[key] || "";
const oldClient = createClient(env("OLD_SUPABASE_URL"), env("OLD_SUPABASE_SECRET_KEY"), { auth: { persistSession:false, autoRefreshToken:false } });
const newClient = createClient(env("NEW_SUPABASE_URL"), env("NEW_SUPABASE_SECRET_KEY"), { auth: { persistSession:false, autoRefreshToken:false } });

if (!["OLD_SUPABASE_URL", "OLD_SUPABASE_SECRET_KEY", "NEW_SUPABASE_URL", "NEW_SUPABASE_SECRET_KEY"].every(key => env(key))) {
  throw new Error("Audit membutuhkan OLD_/NEW_ SUPABASE_URL dan SECRET_KEY di environment atau .env.");
}

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
}
function digest(rows, key) {
  const hash = createHash("sha256");
  for (const row of [...rows].sort((a, b) => String(a[key] ?? "").localeCompare(String(b[key] ?? "")))) hash.update(canonical(row));
  return hash.digest("hex").slice(0, 16);
}
async function restTables(url, key) {
  const response = await fetch(`${url.replace(/\/$/, "")}/rest/v1/`, { headers:{ apikey:key, Authorization:`Bearer ${key}` } });
  if (!response.ok) throw new Error(`OpenAPI REST schema HTTP ${response.status}`);
  const spec = await response.json();
  return Object.keys(spec.paths || {}).filter(path => /^\/[^/]+$/.test(path)).map(path => path.slice(1)).sort();
}
async function fetchRange(client, table, from, to) {
  let result;
  for (let attempt = 0; attempt < 3; attempt++) {
    result = await client.from(table).select("*").range(from, to);
    if (!result.error || String(result.error.code || "").startsWith("PGRST")) return result;
    await new Promise(resolve => setTimeout(resolve, 250 * (attempt + 1)));
  }
  return result;
}
async function tableSummary(client, table) {
  const rows = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    let { data, error } = await fetchRange(client, table, from, from + PAGE_SIZE - 1);
    // Responses with embedded photos can exceed the self-host proxy's practical
    // payload limit. Retrying that page in smaller pieces is still read-only.
    if (error && !String(error.code || "").startsWith("PGRST")) {
      data = [];
      for (let cursor = from; cursor < from + PAGE_SIZE; cursor += RETRY_PAGE_SIZE) {
        const small = await fetchRange(client, table, cursor, cursor + RETRY_PAGE_SIZE - 1);
        if (small.error) return { status:"error", detail:small.error.code || "request_failed" };
        data.push(...(small.data || []));
        if (!small.data || small.data.length < RETRY_PAGE_SIZE) break;
      }
    } else if (error) return { status:"error", detail:error.code || "request_failed" };
    rows.push(...(data || []));
    if (!data || data.length < PAGE_SIZE) break;
  }
  const key = PRIMARY_KEY[table] || "id";
  return { status:"ok", count:rows.length, digest:digest(rows, key), rowDigests:new Map(rows.map(row => [String(row[key]), createHash("sha256").update(canonical(row)).digest("hex")])) };
}
async function authCount(client) {
  let count = 0;
  for (let page = 1; ; page++) {
    const { data, error } = await client.auth.admin.listUsers({ page, perPage:1000 });
    if (error) return { status:"error", detail:error.message };
    count += data.users.length;
    if (data.users.length < 1000) return { status:"ok", count };
  }
}
async function objectCount(client, bucket, prefix = "") {
  let count = 0;
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await client.storage.from(bucket).list(prefix, { limit:1000, offset });
    if (error) throw error;
    for (const item of data || []) {
      if (item.name === ".emptyFolderPlaceholder") continue;
      if (item.id == null && !item.metadata) count += await objectCount(client, bucket, prefix ? `${prefix}/${item.name}` : item.name);
      else count++;
    }
    if (!data || data.length < 1000) return count;
  }
}
async function storageSummary(client) {
  const output = {};
  for (const bucket of STORAGE_BUCKETS) {
    try { output[bucket] = { status:"ok", count:await objectCount(client, bucket) }; }
    catch (error) { output[bucket] = { status:"error", detail:error.message }; }
  }
  return output;
}
function compare(oldValue, newValue) {
  if (oldValue.status !== "ok" || newValue.status !== "ok") return "UNVERIFIABLE";
  let oldOnly = 0, selfOnly = 0, sameIdDifferentContent = 0;
  for (const [key, hash] of oldValue.rowDigests) {
    if (!newValue.rowDigests.has(key)) oldOnly++;
    else if (newValue.rowDigests.get(key) !== hash) sameIdDifferentContent++;
  }
  for (const key of newValue.rowDigests.keys()) if (!oldValue.rowDigests.has(key)) selfOnly++;
  const status = oldOnly ? "OLD_ONLY_PRESENT" : selfOnly ? "SELF_HOST_ADDITIONAL_ROWS" : sameIdDifferentContent ? "SAME_ID_DIFFERENT_CONTENT" : "MATCH";
  return { status, oldOnly, selfOnly, sameIdDifferentContent };
}

console.log("WARNOTO backend reconciliation (READ-ONLY; identifiers and keys are redacted)");
let discrepancies = 0;
const [oldTables, newTables] = await Promise.all([restTables(env("OLD_SUPABASE_URL"), env("OLD_SUPABASE_SECRET_KEY")), restTables(env("NEW_SUPABASE_URL"), env("NEW_SUPABASE_SECRET_KEY"))]);
const TABLES = [...new Set([...oldTables, ...newTables])].sort();
console.log(`REST schema: old=${oldTables.length} self-host=${newTables.length} union=${TABLES.length}`);
for (const table of TABLES) {
  const [oldValue, newValue] = await Promise.all([tableSummary(oldClient, table), tableSummary(newClient, table)]);
  const comparison = compare(oldValue, newValue);
  if (comparison.status !== "MATCH") discrepancies++;
  console.log(`TABLE ${table}: ${comparison.status} | old=${oldValue.count ?? oldValue.status} new=${newValue.count ?? newValue.status} old_only=${comparison.oldOnly ?? "-"} self_only=${comparison.selfOnly ?? "-"} same_id_diff=${comparison.sameIdDifferentContent ?? "-"}`);
}
const [oldAuth, newAuth, oldStorage, newStorage] = await Promise.all([authCount(oldClient), authCount(newClient), storageSummary(oldClient), storageSummary(newClient)]);
const authStatus = oldAuth.status !== "ok" || newAuth.status !== "ok" ? "UNVERIFIABLE"
  : oldAuth.count === newAuth.count ? "MATCH" : oldAuth.count > newAuth.count ? "OLD_ONLY_OR_DESTINATION_MISSING" : "SELF_HOST_ADDITIONAL_ROWS";
if (authStatus !== "MATCH") discrepancies++;
console.log(`AUTH users: ${authStatus} | old=${oldAuth.count ?? oldAuth.status} new=${newAuth.count ?? newAuth.status}`);
for (const bucket of STORAGE_BUCKETS) {
  const comparison = oldStorage[bucket].status !== "ok" || newStorage[bucket].status !== "ok"
    ? { status:"UNVERIFIABLE" }
    : oldStorage[bucket].count === newStorage[bucket].count ? { status:"MATCH" }
    : oldStorage[bucket].count > newStorage[bucket].count ? { status:"OLD_ONLY_OR_DESTINATION_MISSING" } : { status:"SELF_HOST_ADDITIONAL_ROWS" };
  if (comparison.status !== "MATCH") discrepancies++;
  console.log(`STORAGE ${bucket}: ${comparison.status} | old=${oldStorage[bucket].count ?? oldStorage[bucket].status} new=${newStorage[bucket].count ?? newStorage[bucket].status}`);
}
console.log(`RESULT discrepancies=${discrepancies}. No data was written.`);
if (discrepancies) process.exitCode = 2;
