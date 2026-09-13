import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const migration = await readFile(
  new URL("../../supabase/migrations/20260913c_material_inspection_drafts.sql", import.meta.url),
  "utf8",
);
const schema = await readFile(new URL("../../supabase/schema.sql", import.meta.url), "utf8");
const sync = await readFile(new URL("../../src/lib/materialInspectionSync.js", import.meta.url), "utf8");

test("inspection drafts are owner-only rows with UPT and allowed-gudang validation", () => {
  assert.match(migration, /create table if not exists public\.material_inspection_drafts/);
  assert.match(migration, /owner_id uuid not null references public\.profiles\(id\)/);
  assert.match(migration, /photo_paths text\[\] not null/);
  assert.match(migration, /updated_at timestamptz not null/);
  assert.match(migration, /actor\.id = auth\.uid\(\)/);
  assert.match(migration, /actor\.id = p_owner_id/);
  assert.match(migration, /actor\.role in \('ADMIN', 'TL'\)/);
  assert.match(migration, /actor\.upt_id = p_upt_id/);
  assert.match(migration, /g\.id = p_gudang_id and g\.upt_id = actor\.upt_id/);
  assert.match(migration, /create policy "Owner select material_inspection_drafts"|create policy "Owner read material_inspection_drafts"/);
  assert.match(migration, /for insert to authenticated/);
  assert.match(migration, /for update to authenticated/);
  assert.match(migration, /for delete to authenticated/);
});

test("draft photo reads require owner prefix and a path listed by the row", () => {
  assert.match(migration, /Owner read material-inspection-draft-photos/);
  assert.match(migration, /name like \(auth\.uid\(\)::text \|\| '\/drafts\/%'/);
  assert.match(migration, /name = any\(d\.photo_paths\)/);
  assert.match(migration, /Existing ADMIN\/TL prefix policies intentionally remain/);
});

test("v2 final RPC validates tri-state checklist, exactly two existing actor photos, and keeps v1", () => {
  assert.match(migration, /if p_header->>'inspectionFormVersion' = '2'/);
  for (const key of ["kebersihan", "bebasKarat", "bebasBocor", "kemasanBaik"]) {
    assert.match(migration, new RegExp(`checklist.*${key}`));
  }
  assert.match(migration, /jsonb_array_length\(e\.value->'photoPaths'\) <> 2/);
  assert.match(migration, /not \(photo\.path like \(v_inspector::text \|\| '\/%'/);
  assert.match(migration, /object_row\.bucket_id = 'material-inspection-photos'/);
  assert.match(migration, /object_row\.name = photo\.path/);
  assert.match(migration, /v1 clients may still send boolean checklist values/);
});

test("schema mirrors draft table, policies, trigger, and v2 checks", () => {
  assert.match(schema, /create table if not exists material_inspection_drafts/);
  assert.match(schema, /can_manage_material_inspection_draft/);
  assert.match(schema, /material_inspection_drafts_touch_updated_at/);
  assert.match(schema, /Owner read material-inspection-draft-photos/);
  assert.match(schema, /inspectionFormVersion.*2/);
});

test("sync exposes durable draft lifecycle and keeps existing photo paths", () => {
  assert.match(sync, /export async function loadMaterialInspectionDrafts/);
  assert.match(sync, /export async function saveMaterialInspectionDraft/);
  assert.match(sync, /export async function deleteMaterialInspectionDraft/);
  assert.match(sync, /ownerId\}\/drafts\/\$\{draftId\}/);
  assert.match(sync, /uploadedPaths\.length\) await supabase\.storage/);
  assert.match(sync, /removedPaths = previousPaths\.filter/);
  assert.match(sync, /retainPaths = false/);
  assert.match(sync, /if \(isPhotoPath\(photo\)\)/);
  assert.match(sync, /Path foto inspeksi tidak dimiliki akun ini/);
});
