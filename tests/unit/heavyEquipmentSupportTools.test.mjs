import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  getHeavyEquipmentUptId,
  getHeavyEquipmentLoanOwnerUptId,
  getHeavyEquipmentBorrowerLabel,
  isHeavyEquipmentVisibleToUpt,
  normalizeHeavyEquipmentRecord,
  normalizeHeavyEquipmentLoan,
} from "../../src/lib/heavyEquipment.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const migration = fs.readFileSync(path.join(root, "supabase/migrations/20260920_heavy_equipment_upt_id_loans.sql"), "utf8");
const harMigration = fs.readFileSync(path.join(root, "supabase/migrations/20260921_har_uit_heavy_equipment_loans.sql"), "utf8");
const optionalLetterMigration = fs.readFileSync(path.join(root, "supabase/migrations/20260921b_har_uit_optional_loan_letter.sql"), "utf8");
const schema = fs.readFileSync(path.join(root, "supabase/schema.sql"), "utf8");
const appSource = fs.readFileSync(path.join(root, "App.jsx"), "utf8");

test("support-tools migration exposes typed scope, private evidence, and batch RPCs", () => {
  assert.match(migration, /add column if not exists upt_id text/i);
  assert.match(migration, /owner_upt_id text/i);
  assert.match(migration, /foreign key \(upt_id\) references public\.upt\(id\)/i);
  assert.match(migration, /heavy-equipment-evidence/);
  assert.match(migration, /checkout_heavy_equipment_batch/);
  assert.match(migration, /approve_heavy_equipment_batch/);
  assert.match(migration, /complete_heavy_equipment_batch/);
  assert.match(migration, /grant execute on function public\.checkout_heavy_equipment_batch.*authenticated/is);
  assert.match(migration, /no authenticated direct\s+insert\/update\/delete policy/i);
  assert.match(migration, /drop policy if exists "Read heavy_equipment authenticated"/i);
  assert.match(migration, /drop policy if exists "Scoped write heavy_equipment"/i);
  assert.match(migration, /drop policy if exists "Scoped all heavy_equipment_loans"/i);
  assert.match(migration, /create policy "Heavy equipment evidence update"/i);
  assert.match(migration, /v_actor\.role <> 'TL'/i);
  assert.match(migration, /v_actor\.role <> 'ASMAN'/i);
  assert.match(migration, /revoke execute on function public\.complete_heavy_equipment_loan\(text\) from authenticated/i);
});

test("registry and visibility helpers prefer typed upt_id", () => {
  const uptList = [{ id: "UPT-SBY", nama: "UPT Surabaya" }, { id: "UPT-GSK", nama: "UPT Gresik" }];
  const item = normalizeHeavyEquipmentRecord({ id: "PB-SBY-01", uptId: "UPT-SBY", upt: "Gresik", kategori: "Pendukung" });
  assert.equal(getHeavyEquipmentUptId(item, uptList), "UPT-SBY");
  assert.equal(isHeavyEquipmentVisibleToUpt(item, "UPT-GSK", false), false);
  assert.equal(isHeavyEquipmentVisibleToUpt({ ...item, isCrossUptBorrowable: true }, "UPT-GSK", false), true);
  assert.equal(getHeavyEquipmentLoanOwnerUptId({ ownerUptId: "UPT-SBY", ownerUpt: "Gresik" }, uptList), "UPT-SBY");
});

test("external borrower label never falls back to an unrelated UPT", () => {
  assert.equal(getHeavyEquipmentBorrowerLabel({ borrowerType: "VENDOR", borrowerName: "PT Contoh" }), "VENDOR: PT Contoh");
  assert.equal(getHeavyEquipmentBorrowerLabel({ borrowerType: "UNIT_LAIN", borrowerName: "GI Sukolilo" }), "UNIT_LAIN: GI Sukolilo");
});

test("HAR_UIT migration keeps requester UIT typed and server-authoritative", () => {
  assert.match(harMigration, /add column if not exists requester_uit_id text/i);
  assert.match(harMigration, /requester_uit_id.*references public\.uit\(id\)/is);
  assert.match(harMigration, /idx_heavy_equipment_loans_requester_uit_id/i);
  assert.match(harMigration, /actor\.role = 'HAR_UIT'/i);
  assert.match(harMigration, /v_actor\.role = 'HAR_UIT' and v_type <> 'HAR_UIT'/i);
  assert.match(harMigration, /v_actor\.role = 'TL' and v_type = 'HAR_UIT'/i);
  assert.match(harMigration, /borrowerUitId.*v_actor\.uit_id/is);
  assert.match(harMigration, /v_type = 'HAR_UIT'.*borrowerPic.*borrowerContact/is);
  assert.match(harMigration, /v_type in \('UPT','HAR_UIT'\).*is_cross_upt_borrowable/is);
  assert.match(harMigration, /requester_upt_id, requester_uit_id/is);
  assert.match(harMigration, /requester_uit_id = actor\.uit_id/i);
  assert.match(harMigration, /not exists \(select 1 from public\.heavy_equipment_loans l/is);
  assert.match(harMigration, /checkout_heavy_equipment_batch_v2/i);
  assert.match(harMigration, /grant execute on function public\.checkout_heavy_equipment_batch_v2.*authenticated/is);
  assert.match(harMigration, /owner_id = auth\.uid\(\)/i);
  assert.match(schema, /requester_uit_id.*references public\.uit\(id\)/is);
  assert.match(schema, /checkout_heavy_equipment_batch_v2/i);
});

test("HAR_UIT loan normalizer preserves typed requester UIT", () => {
  const normalized = normalizeHeavyEquipmentLoan({ requester_uit_id: "UIT-JBM" });
  assert.equal(normalized.requesterUitId, "UIT-JBM");
});

test("HAR_UIT bootstrap exits before full-domain loader and keeps stock realtime", () => {
  const start = appSource.indexOf('if (currentUser?.role === "HAR_UIT") {');
  const end = appSource.indexOf('if (currentUser?.role === "OPERATOR") {', start);
  assert.ok(start >= 0 && end > start);
  const branch = appSource.slice(start, end);
  assert.match(branch, /loadMasterTable\("stocks"\)/);
  assert.match(branch, /loadMasterTable\("heavy_equipment_loans"\)/);
  assert.doesNotMatch(branch, /loadWarehouseCapacity|loadMasterTable\("(stock_opname|stock_count|attb_list|supplier|maturity|material_cadang|tug)/i);
  assert.match(branch, /setTxns\(\[\]\).*setRencanaKedatanganList\(\[\]\).*setOpnameList\(\[\]\)/s);
  assert.match(branch, /setApprovalHistoryList\(\[\]\).*setAttbList\(\[\]\)/s);
  assert.match(branch, /stocksBootstrapUserIdRef\.current = currentUser\.id/);
  assert.match(appSource, /useState\(\(\) => currentUser\?\.role === "HAR_UIT" \|\|/);
  assert.match(appSource, /currentUser\?\.role === "HAR_UIT"\) return;/);
});

test("evidence upload uses create-only semantics", () => {
  const sync = fs.readFileSync(path.join(root, "src/lib/supabaseSync.js"), "utf8");
  const hook = fs.readFileSync(path.join(root, "src/hooks/useHeavyEquipment.js"), "utf8");
  assert.match(sync, /uploadPhotoToStorage\(dataUrl, bucket, path, \{ upsert = true \} = \{\}\)/);
  assert.match(sync, /upload\(path, blob, \{ upsert, contentType: blob\.type \}\)/);
  assert.match(hook, /heavy-equipment-evidence", evidencePath, \{ upsert:false \}/);
});

test("HAR_UIT loan letter is optional while return evidence stays required", () => {
  assert.match(optionalLetterMigration, /v_type <> 'HAR_UIT'.*p_pickup_evidence_path/is);
  assert.match(optionalLetterMigration, /v_type = 'HAR_UIT'.*loan-letter.*pdf\|jpg\|jpeg\|png\|webp/is);
  assert.match(optionalLetterMigration, /Path bukti tidak sesuai UPT pemilik/i);
  assert.match(optionalLetterMigration, /checkout_heavy_equipment_batch_v2/i);
  assert.match(schema, /loan-letter\.ext.*return evidence stays required|loan-letter\.ext.*return evidence tetap required/is);
  const hook = fs.readFileSync(path.join(root, "src/hooks/useHeavyEquipment.js"), "utf8");
  const component = fs.readFileSync(path.join(root, "src/components/HeavyEquipmentTabV2.jsx"), "utf8");
  assert.match(hook, /form\.loanLetter \|\| form\.suratPeminjaman/);
  assert.match(hook, /if \(!isHarUit && !evidence\)/);
  assert.match(hook, /loan-letter/);
  assert.match(component, /Surat Peminjaman \(opsional\)/);
  assert.match(component, /application\/pdf/);
  assert.match(hook, /Foto pengembalian wajib diunggah/);
  assert.match(component, /handleImg\(e,[\s\S]*?\);\s*e\.target\.value="";/);
  assert.equal((optionalLetterMigration.match(/v_before := v_sql;/g) || []).length, 4);
  assert.equal((optionalLetterMigration.match(/if v_sql = v_before then raise exception/g) || []).length, 4);
  assert.equal((schema.match(/v_before := v_sql;/g) || []).length, 4);
  assert.equal((schema.match(/if v_sql = v_before then raise exception/g) || []).length, 4);
});

test("HAR_UIT borrower fields are editable and contact prefills from profile", () => {
  const component = fs.readFileSync(path.join(root, "src/components/HeavyEquipmentTabV2.jsx"), "utf8");
  assert.match(component, /currentUser\?\.officialPhone \|\| harProfile\?\.officialPhone/);
  assert.match(component, /value=\{loanForm\.borrowerName\} onChange/);
  assert.match(component, /value=\{loanForm\.borrowerPic\} onChange/);
  assert.match(component, /value=\{loanForm\.borrowerContact\} onChange/);
});
