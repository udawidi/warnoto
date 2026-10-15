import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const migration = fs.readFileSync(path.join(root, "supabase/migrations/20261015_ba_non_stock.sql"), "utf8");
const schema = fs.readFileSync(path.join(root, "supabase/schema.sql"), "utf8");
const sync = fs.readFileSync(path.join(root, "src/lib/baNonStockSync.js"), "utf8");

test("BA Non Stock has isolated typed tables and no stock mutation dependency", () => {
  for (const table of ["ba_non_stock", "ba_non_stock_items", "ba_non_stock_counters"]) {
    assert.match(migration, new RegExp(`create table if not exists public\\.${table}\\b`, "i"));
    assert.match(schema, new RegExp(`create table if not exists public\\.${table}\\b`, "i"));
  }
  assert.match(migration, /kind text not null check \(kind in \('NON_STOCK', 'PINJAM'\)\)/i);
  assert.match(migration, /material_name text not null/);
  assert.match(migration, /qty numeric not null check \(qty > 0\)/);
  assert.match(migration, /unit text not null/);
  assert.doesNotMatch(migration, /stock_movements|tug_transactions|tug_workflow_transactions/i);
});

test("BA RPC contract is versioned, scoped, review-first, and granted only to authenticated", () => {
  for (const fn of ["save_ba_non_stock_draft", "submit_ba_non_stock", "decide_ba_non_stock"]) {
    assert.equal((migration.match(new RegExp(`create or replace function public\\.${fn}\\s*\\(`, "gi")) || []).length, 1, fn);
    assert.match(migration, new RegExp(`grant execute on function public\\.${fn}`));
    assert.match(migration, new RegExp(`revoke all on function public\\.${fn}`));
  }
  assert.match(migration, /p_expected_version integer/);
  assert.match(migration, /BA_VERSION_MISMATCH/);
  assert.match(migration, /stage = 'PENDING_TL'.*status = 'PENDING'/s);
  assert.match(migration, /stage = 'APPROVED'.*status = 'APPROVED'/s);
  assert.match(migration, /stage = 'REJECTED'.*status = 'REJECTED'/s);
  assert.match(migration, /BA_REJECT_REASON_REQUIRED/);
  assert.match(migration, /for select to authenticated/);
  assert.match(migration, /can_access_upt\(upt_id\)/);
});

test("approval numbering and Storage evidence are server-derived", () => {
  assert.match(migration, /on conflict \(upt_id, year\) do update set last_value/);
  assert.match(migration, /lpad\(next_seq::text, 3, '0'\).*\.BA\//s);
  assert.match(migration, /storage\.objects/);
  assert.match(migration, /BA_PHOTO_REQUIRED/);
  assert.match(migration, /BA_PHOTO_NOT_STORED/);
  assert.match(migration, /ba-non-stock\//);
  assert.match(sync, /BA_NON_STOCK_BUCKET = "tug-photos"/);
  assert.match(sync, /BA_NON_STOCK_PHOTO_PREFIX = "ba-non-stock"/);
  assert.match(sync, /save_ba_non_stock_draft/);
  assert.match(sync, /submit_ba_non_stock/);
  assert.match(sync, /decide_ba_non_stock/);
  assert.match(sync, /BA_PHOTO_NOT_STORED/);
});

test("schema mirrors all BA RPC definitions exactly once", () => {
  for (const fn of ["save_ba_non_stock_draft", "submit_ba_non_stock", "decide_ba_non_stock"]) {
    assert.equal((schema.match(new RegExp(`create or replace function public\\.${fn}\\s*\\(`, "gi")) || []).length, 1, `${fn} schema`);
  }
});
