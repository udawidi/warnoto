import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { normalizeMtuSearch, rankMtuSearch, buildMtuSearchText, matchesMtuSearch, MTU_KHS_EVIDENCE_KINDS, MTU_KHS_TRANSFER_STATUSES } from "../../src/features/mtu-khs/mtuKhsModel.js";
import * as api from "../../src/features/mtu-khs/mtuKhsApi.js";

const migrationPath = new URL("../../supabase/migrations/20261009_mtu_khs_operations.sql", import.meta.url);
const migration = fs.readFileSync(migrationPath, "utf8");
const source = fs.readFileSync(new URL("../../src/features/mtu-khs/MtuKhsDetail.jsx", import.meta.url), "utf8");
const tab = fs.readFileSync(new URL("../../src/features/mtu-khs/MtuKhsTab.jsx", import.meta.url), "utf8");
const apiSource = fs.readFileSync(new URL("../../src/features/mtu-khs/mtuKhsApi.js", import.meta.url), "utf8");
const app = fs.readFileSync(new URL("../../App.jsx", import.meta.url), "utf8");

test("MTU operations migration has canonical schema and guarded RPCs", () => {
  for (const token of [
    "mtu_khs_record_events", "mtu_khs_record_evidence", "mtu_khs_transfer_requests",
    "search_text", "pg_trgm", "mtu_khs_update_operational", "mtu_khs_request_transfer",
    "mtu_khs_decide_transfer", "mtu_khs_register_evidence", "mtu-khs-evidence",
    "MTU_VERSION_CONFLICT", "MTU_HIERARCHY_INVALID", "MTU_TRANSFER_CROSS_UIT",
  ]) assert.match(migration, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), token);
  assert.match(migration, /create policy[^;]+mtu_khs_record_evidence/is);
  assert.match(migration, /storage\.objects/is);
  assert.match(migration, /p_idempotency_key/is);
  assert.doesNotMatch(migration, /insert\s+into\s+public\.mtu_khs_sheet_sync_jobs/i);
  assert.match(migration, /mtu_khs_transfer_destinations\(p_target_upt_id text\)/i);
  assert.match(migration, /status = 'APPROVED' and public\.mtu_khs_can_access_upt\(target_upt_id\)/i);
  assert.doesNotMatch(migration, /can_access_upt\(p_target_upt_id\)/i);
});

test("smart search normalizes token order and ranks exact identifiers", () => {
  assert.equal(normalizeMtuSearch("  CB-150/002  RFQ  01 "), "cb 150 002 rfq 01");
  const exact = rankMtuSearch({ catalogNumber: "1002015", mtuCode: "CB150-002", noKontrak: "1818.KR" }, "1818 kr");
  const weak = rankMtuSearch({ materialName: "CB150", vendor: "TWINK" }, "1818 kr");
  assert.ok(exact > weak);
  assert.match(buildMtuSearchText({ materialName: "CB150", noKontrak: "1818.KR" }), /cb150/);
  const record = { materialName: "Current Transformer", noKontrak: "1818.KR", giName: "GI Ketintang" };
  assert.equal(matchesMtuSearch(record, "ketintang transformer"), true);
  assert.equal(matchesMtuSearch(record, "ketintnag transformr"), true);
  assert.equal(matchesMtuSearch(record, "transformer absent"), false);
});

test("migration locks transfer invariants and canonical snapshots", () => {
  const decideFn = migration.slice(migration.indexOf("create or replace function public.mtu_khs_decide_transfer"), migration.indexOf("create or replace function public.mtu_khs_transfer_destinations"));
  const evidencePolicy = migration.slice(migration.indexOf('create policy "MTU KHS evidence read scoped"'), migration.indexOf("alter table public.mtu_khs_record_events"));
  assert.match(migration, /a\.uit_id is not null and a\.uit_id=b\.uit_id/i);
  assert.match(migration, /greatest\(coalesce\(\(select sum\(qty\).*mtu_khs_receipts/is);
  assert.match(migration, /p_target_ultg_id is not null or p_target_gardu_induk_id is not null or p_target_bay_id is not null/i);
  assert.match(migration, /'physicalQty',t\.qty,'remainingQty',t\.qty/i);
  assert.match(migration, /'qty',qty-t\.qty,'physicalQty',qty-t\.qty/i);
  assert.match(migration, /'TRANSFER_REQUESTED'/i);
  assert.match(migration, /'TRANSFER_REJECTED'/i);
  assert.match(migration, /'TRANSFER_SPLIT'/i);
  assert.match(migration, /word_similarity\(token, r\.search_text\) < 0\.45/i);
  assert.match(migration, /e\.object_path = storage\.objects\.name/i);
  assert.match(migration, /MTU_TARGET_HIERARCHY_REQUIRED.*MTU_HIERARCHY_INVALID/is);
  assert.match(decideFn, /a\.uit_id is not null and a\.uit_id=b\.uit_id/i);
  assert.match(decideFn, /t\.target_lokasi_id.*t\.target_gudang_id/is);
  assert.match(evidencePolicy, /mtu_khs_record_evidence e[\s\S]*e\.object_path = storage\.objects\.name/i);
  assert.match(migration, /'catalogNumber'.*'materialName'.*'materialDescription'.*'unit'.*'satuan'/is);
  assert.match(migration, /MTU_CATALOG_REQUIRED/i);
  assert.doesNotMatch(migration, /'UNIT'/);
  assert.match(migration, /katalog_snapshot->>'kode_material'/i);
  assert.match(migration, /MTU_CATALOG_LOCKED/i);
  assert.match(migration, /case when \(metadata->>'size'\) ~ '\^\[0-9\]\+\$'/i);
  assert.match(migration, /file_size_limit\s*=\s*2097152/i);
  assert.match(migration, /allowed_mime_types\s*=\s*array\['image\/\*'\]/i);
});

test("frontend exposes direct edit, evidence and transfer controls", () => {
  for (const token of ["Code Catalog", "Lifecycle status", "Foto barang", "Nameplate", "Pindah UPT", "Riwayat foto"]) assert.match(source, new RegExp(token, "i"));
  for (const token of ["Kontrak KR", "RFQ", "debounce", "searchInput", "targetLokasiId", "signedUrl", "mtu_khs_request_transfer", "mtu_khs_decide_transfer"]) assert.match(tab + source + fs.readFileSync(new URL("../../src/features/mtu-khs/mtuKhsApi.js", import.meta.url), "utf8"), new RegExp(token, "i"));
  assert.match(app, /<MtuKhsTab[\s\S]{0,800}lokasiList=\{lokasiList\}/i);
  assert.match(tab, /canOperationalEdit\s*=\s*hasRole\(currentUser,\s*"TL",\s*"SUPERADMIN"\)/i);
  assert.match(tab, /canSubmitLegacyChange\s*=\s*hasRole\(currentUser,\s*"PENGADAAN"/i);
  assert.match(source, /canSubmitLegacyChange/);
  assert.match(source, /onClick=\{saveOperationalDraft\}/);
  assert.match(source, /onClick=\{submitTransferDraft\}/);
  assert.match(source, /if \(success\) setEditMode\(false\)/);
  assert.match(source, /if \(success\) \{/);
  assert.match(tab, /const changedPatch = Object\.fromEntries/);
  assert.match(tab, /return false/);
  assert.deepEqual(MTU_KHS_EVIDENCE_KINDS, ["ITEM", "NAMEPLATE"]);
  assert.deepEqual(MTU_KHS_TRANSFER_STATUSES, ["PENDING", "APPROVED", "REJECTED"]);
});

test("API exposes operational mutation surface without Sheet sync", () => {
  for (const name of ["updateMtuKhsOperational", "requestMtuKhsTransfer", "decideMtuKhsTransfer", "loadMtuKhsEvidence", "uploadMtuKhsEvidence", "loadMtuKhsTransferDestinations"]) assert.equal(typeof api[name], "function", name);
});

test("operational update returns an unwrapped record for immediate UI refresh", () => {
  assert.match(apiSource, /updateMtuKhsOperational[\s\S]*unwrap\(Array\.isArray\(result\.data\) \? result\.data\[0\] : result\.data\)/i);
});
