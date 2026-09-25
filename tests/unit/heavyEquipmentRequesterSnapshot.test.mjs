import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const migration = fs.readFileSync(path.join(root, "supabase/migrations/20260925c_heavy_equipment_requester_name_snapshot.sql"), "utf8");
const schema = fs.readFileSync(path.join(root, "supabase/schema.sql"), "utf8");
const component = fs.readFileSync(path.join(root, "src/components/HeavyEquipmentTabV2.jsx"), "utf8");

test("requester name snapshot is server-authoritative for new loans", () => {
  assert.match(migration, /create or replace function public\.snapshot_heavy_equipment_requester_name\(\)/i);
  assert.match(migration, /security definer/i);
  assert.match(migration, /set search_path = public, pg_catalog/i);
  assert.match(migration, /before insert on public\.heavy_equipment_loans/i);
  assert.match(migration, /p\.id::text = nullif\(trim\(new\.data->>'requestedBy'\), ''\)/i);
  assert.match(migration, /new\.data := coalesce\(new\.data, '\{\}'::jsonb\) - 'requestedByName'/i);
  assert.match(migration, /jsonb_build_object\('requestedByName', v_name\)/i);
  assert.match(migration, /if v_name is null then[\s\S]*raise exception 'Nama pemohon wajib berasal dari profil yang valid\.'/i);
  assert.doesNotMatch(migration, /update public\.heavy_equipment_loans/i);
  assert.match(migration, /revoke all on function public\.snapshot_heavy_equipment_requester_name\(\) from public/i);
});

test("canonical schema contains the requester snapshot migration", () => {
  assert.ok(schema.replace(/\r\n/g, "\n").includes(migration.replace(/\r\n/g, "\n").trim()));
});

test("history requester display prefers the server snapshot before profile lookup", () => {
  assert.match(component, /const getRequesterName = loan => loan\?\.requestedByName \|\| loan\?\.data\?\.requestedByName/);
  assert.match(component, /getRequesterName\(l\)/);
  assert.match(component, /getRequesterName\(loan\)/);
});
