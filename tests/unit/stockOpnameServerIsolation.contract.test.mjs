import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const migration = await readFile(new URL("../../supabase/migrations/20260920c_stock_opname_server_isolation.sql", import.meta.url), "utf8");
const verifier = await readFile(new URL("../../supabase/verify_stock_opname_server_isolation.sql", import.meta.url), "utf8");
const masterSync = await readFile(new URL("../../src/lib/masterSync.js", import.meta.url), "utf8");
const schema = await readFile(new URL("../../supabase/schema.sql", import.meta.url), "utf8");

test("server hardening is transactional, idempotent, and aborts unresolved scope", () => {
  assert.match(migration, /begin;[\s\S]*commit;/i);
  assert.match(migration, /to_regprocedure\('public\.can_access_upt\(text\)'\)/i);
  assert.match(migration, /add column if not exists upt_id\s+text/i);
  assert.match(migration, /unresolved\/orphan/i);
  assert.match(migration, /alter table public\.stock_opname alter column upt_id set not null/i);
  assert.match(migration, /alter table public\.stock_count alter column upt_id set not null/i);
  assert.match(migration, /stock_opname_upt_id_fkey/i);
  assert.match(migration, /stock_count_upt_id_fkey/i);
  assert.match(migration, /idx_stock_opname_upt_id/i);
  assert.match(migration, /idx_stock_count_upt_id/i);
});

test("server policies are scoped and grants do not expose anon or truncate", () => {
  assert.match(migration, /from pg_policies[\s\S]*execute format\('drop policy if exists/i);
  assert.match(migration, /create policy "Scoped read stock_opname"[\s\S]*can_access_upt\(upt_id\)/i);
  assert.match(migration, /create policy "Scoped write stock_opname"[\s\S]*with check \(public\.can_access_upt\(upt_id\)\)/i);
  assert.match(migration, /create policy "Scoped read stock_count"[\s\S]*can_access_upt\(upt_id\)/i);
  assert.match(migration, /create policy "Scoped write stock_count"[\s\S]*with check \(public\.can_access_upt\(upt_id\)\)/i);
  assert.match(migration, /revoke all on table public\.stock_opname, public\.stock_count from public, anon/i);
  assert.match(migration, /grant select, insert, update, delete on table public\.stock_opname, public\.stock_count to authenticated/i);
  assert.match(migration, /grant all on table public\.stock_opname, public\.stock_count to service_role/i);
  assert.doesNotMatch(migration, /grant\s+truncate/i);
});

test("verifier is read-only and checks boundary invariants", () => {
  for (const token of ["null_upt", "orphan_upt", "pg_policies", "has_table_privilege", "stock_opname_upt_id_fkey", "stock_count_upt_id_fkey"]) {
    assert.match(verifier, new RegExp(token));
  }
  assert.doesNotMatch(verifier, /\b(insert\s+into|update\s+public\.|delete\s+from)\b/i);
});

test("generic loader exposes an optional UPT filter without changing its default", () => {
  assert.match(masterSync, /loadMasterTable\(table,\s*\{\s*uptIds\s*\}\s*=\s*\{\}\)/);
  assert.match(masterSync, /uptIds\.length === 0\) return \[\]/);
  assert.match(masterSync, /if \(Array\.isArray\(uptIds\)[\s\S]*?\.in\("upt_id", uptIds\)/);
});

test("canonical schema does not recreate broad or truncate-capable policies", () => {
  const stockSection = schema.slice(schema.indexOf("22. STOCK_OPNAME"), schema.indexOf("23. ATTB_LIST"));
  assert.match(stockSection, /create policy "Scoped read stock_opname"[\s\S]*can_access_upt\(upt_id\)/);
  assert.match(stockSection, /create policy "Scoped write stock_count"[\s\S]*with check \(public\.can_access_upt\(upt_id\)\)/);
  assert.match(stockSection, /revoke all on table stock_opname from public, anon, authenticated/);
  assert.match(stockSection, /grant select, insert, update, delete on table stock_count to authenticated/);
  assert.doesNotMatch(stockSection, /create policy "Authenticated (?:read|write) stock_/);
  assert.doesNotMatch(stockSection, /grant\s+truncate/i);
});
