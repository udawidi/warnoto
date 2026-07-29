import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const [syncSource, componentSource, permsSource, schemaSource, appSource] = await Promise.all([
  readFile(new URL("../src/lib/materialInspectionSync.js", import.meta.url), "utf8"),
  readFile(new URL("../src/components/InspeksiMaterialCadangTab.jsx", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/perms.js", import.meta.url), "utf8"),
  readFile(new URL("../supabase/schema.sql", import.meta.url), "utf8"),
  readFile(new URL("../App.jsx", import.meta.url), "utf8"),
]);

test("inspection persistence is dedicated and never routes through saveToCloud/full sync", () => {
  assert.doesNotMatch(componentSource, /saveToCloud/);
  assert.doesNotMatch(syncSource, /syncMasterTable|upsert\(/);
  assert.match(appSource, /loadMaterialInspections\(\)/);
  assert.match(appSource, /tab==="inspeksiMaterial"/);
});

test("inspection photo contract validates uploads and persists only private paths", () => {
  assert.match(syncSource, /MATERIAL_INSPECTION_MAX_PHOTOS = 2/);
  assert.match(syncSource, /image\/jpeg.*image\/png.*image\/webp/);
  assert.match(syncSource, /MATERIAL_INSPECTION_MAX_FILE_BYTES/);
  assert.match(syncSource, /compressImage\(file/);
  assert.match(syncSource, /MATERIAL_INSPECTION_BUCKET/);
  assert.match(syncSource, /delete persistedData\.photos/);
  assert.match(syncSource, /!path\.startsWith\("data:"\)/);
  assert.match(syncSource, /createSignedUrls\(paths, 3600\)/);
});

test("RBAC keeps VIEWER read-only and only ADMIN/TL receive the create action", () => {
  assert.match(permsSource, /"aksi\.buatInspeksiMaterial": true/);
  assert.match(componentSource, /\["ADMIN", "TL"\]\.includes\(currentUser\?\.role\)/);
  assert.doesNotMatch(componentSource, /hasRole\(currentUser/);
  const viewer = permsSource.match(/VIEWER: menus\(([^\n]+)\)/)?.[1] || "";
  assert.match(viewer, /"inspeksiMaterial"/);
  assert.doesNotMatch(viewer, /"maturity"/);
});

test("batch UI carries BA header fields and prints per-batch (multi-material, no bulk-print workflow)", () => {
  // Kontrak v2 (revisi 2026-07-27): satu BA multi-material. Header BA (nomor/tanggal/
  // gudang/pelaksana/manager) jadi field terpisah, bukan nested `finalBa:` v1 lagi.
  assert.match(componentSource, /nomorBa/);
  assert.match(componentSource, /printBa\(batch\)/);
  assert.match(componentSource, /pelaksaraPemeliharaan/);
  assert.doesNotMatch(componentSource, /openBaModal\(materialInspections\)/);
});

test("schema maps canonical inspection metadata, private bucket, and append-only RLS", () => {
  assert.match(schemaSource, /create table if not exists material_inspections/);
  assert.match(schemaSource, /id uuid primary key/);
  assert.match(schemaSource, /stock_id text references stocks\(id\) on delete set null/);
  assert.match(schemaSource, /katalog_id text references katalog\(id\) on delete set null/);
  assert.match(schemaSource, /lokasi_id text references lokasi\(id\) on delete set null/);
  assert.match(schemaSource, /inspector_id uuid references profiles\(id\) on delete set null/);
  assert.match(schemaSource, /data jsonb not null/);
  assert.match(schemaSource, /material-inspection-photos'.*, false/);
  assert.match(schemaSource, /profiles\.role in \('ADMIN', 'TL'\)/);
  assert.doesNotMatch(schemaSource, /create policy "Admin TL update material_inspections"/);
});

test("batch schema keeps BA numbering server-side and items insertable only via RPC", () => {
  assert.match(schemaSource, /create table if not exists material_inspection_batches/);
  assert.match(schemaSource, /nomor_ba text not null unique/);
  assert.match(schemaSource, /create table if not exists material_inspection_seq/);
  assert.match(schemaSource, /add column if not exists batch_id uuid references material_inspection_batches\(id\) on delete cascade/);
  assert.match(schemaSource, /alter table material_inspections alter column batch_id set not null/);
  // Client tidak boleh insert langsung ke item maupun batch.
  assert.match(schemaSource, /grant select on material_inspections to authenticated/);
  assert.doesNotMatch(schemaSource, /grant select, insert on material_inspections to authenticated/);
  assert.doesNotMatch(schemaSource, /create policy "Admin TL insert material_inspections"/);
  assert.doesNotMatch(schemaSource, /create policy ".*insert material_inspection_batches"/);
  assert.match(schemaSource, /create or replace function public\.create_material_inspection_batch\(p_items jsonb, p_header jsonb\)/);
  assert.match(schemaSource, /language plpgsql security definer set search_path = public/);
  assert.match(schemaSource, /grant execute on function public\.create_material_inspection_batch/);
});

test("RPC validates batch size, duplicates, unknown stock, and caller role", () => {
  const rpc = schemaSource.slice(
    schemaSource.indexOf("function public.create_material_inspection_batch"),
    schemaSource.indexOf("revoke all on function public.create_material_inspection_batch")
  );
  assert.match(rpc, /role in \('ADMIN', 'TL'\)/);
  assert.match(rpc, /v_count < 1 or v_count > 10/);
  assert.match(rpc, /count\(distinct e\.value->>'stock_id'\)[\s\S]*?\) <> v_count/);
  assert.match(rpc, /not exists \(select 1 from stocks s where s\.id = e\.value->>'stock_id'\)/);
  // Identitas material diambil dari stocks, bukan dari input client.
  assert.match(rpc, /select v_batch_id, s\.id, s\.katalog_id, s\.lokasi_id/);
  assert.match(rpc, /join stocks s on s\.id = e\.value->>'stock_id'/);
});

test("data v1 migration is idempotent and only touches unbatched rows", () => {
  const migration = schemaSource.slice(schemaSource.indexOf("-- Migrasi data v1"), schemaSource.indexOf("-- Setelah migrasi, batch_id wajib"));
  assert.match(migration, /where mi\.batch_id is null/);
  assert.match(migration, /update material_inspections set batch_id = v_batch_id where id = r\.id/);
  assert.match(migration, /on conflict \(upt_id, tahun\) do update set last_seq/);
});

test("batch client validates item count, duplicate stock, exactly two photos, and cleans up on failure", () => {
  assert.match(syncSource, /MATERIAL_INSPECTION_MAX_ITEMS_PER_BATCH = 10/);
  assert.match(syncSource, /items\.length > MATERIAL_INSPECTION_MAX_ITEMS_PER_BATCH/);
  assert.match(syncSource, /new Set\(stockIds\)\.size !== stockIds\.length/);
  assert.match(syncSource, /files\.length !== MATERIAL_INSPECTION_MAX_PHOTOS/);
  assert.match(syncSource, /supabase\.rpc\("create_material_inspection_batch"/);
  assert.match(syncSource, /uploadedPaths\.length\) await supabase\.storage/);
  // Legacy v1 tetap ada sampai UI baru siap.
  assert.match(syncSource, /\/\/ LEGACY v1 — keep until UI migration done/);
  assert.match(appSource, /loadMaterialInspectionBatches\(\)/);
});
