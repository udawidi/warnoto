import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { buildBaNonStockHTML } from "../../src/lib/docBuilders.js";
import { draftPayload, resolveBaNonStockPrintNames } from "../../src/lib/baNonStockSync.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const baseMigration = fs.readFileSync(path.join(root, "supabase/migrations/20261015_ba_non_stock.sql"), "utf8");
const migration = fs.readFileSync(path.join(root, "supabase/migrations/20261016_ba_non_stock_draft_tl_review.sql"), "utf8");
const effectiveMigrations = `${baseMigration}\n${migration}`;
const schema = fs.readFileSync(path.join(root, "supabase/schema.sql"), "utf8");
const sync = fs.readFileSync(path.join(root, "src/lib/baNonStockSync.js"), "utf8");

test("BA Non Stock has isolated typed tables and forward partial-draft relaxation", () => {
  for (const table of ["ba_non_stock", "ba_non_stock_items", "ba_non_stock_counters"]) {
    assert.match(baseMigration, new RegExp(`create table if not exists public\\.${table}\\b`, "i"));
    assert.match(schema, new RegExp(`create table if not exists public\\.${table}\\b`, "i"));
  }
  assert.match(baseMigration, /kind text not null check \(kind in \('NON_STOCK', 'PINJAM'\)\)/i);
  assert.match(baseMigration, /material_name text not null/);
  assert.match(baseMigration, /qty numeric not null check \(qty > 0\)/);
  assert.match(baseMigration, /unit text not null/);
  assert.match(migration, /alter column material_name drop not null/);
  assert.match(migration, /alter column qty drop not null/);
  assert.match(migration, /alter column unit drop not null/);
  assert.doesNotMatch(effectiveMigrations, /stock_movements|tug_transactions|tug_workflow_transactions/i);
});

test("BA RPC contract is versioned, scoped, review-first, and authenticated", () => {
  for (const fn of ["save_ba_non_stock_draft", "submit_ba_non_stock"]) {
    assert.equal((migration.match(new RegExp(`create or replace function public\\.${fn}\\s*\\(`, "gi")) || []).length, 1, fn);
  }
  assert.equal((baseMigration.match(/create or replace function public\.decide_ba_non_stock\s*\(/gi) || []).length, 1);
  for (const fn of ["save_ba_non_stock_draft", "submit_ba_non_stock", "decide_ba_non_stock"]) {
    assert.match(effectiveMigrations, new RegExp(`grant execute on function public\\.${fn}`));
    assert.match(effectiveMigrations, new RegExp(`revoke all on function public\\.${fn}`));
  }
  assert.match(effectiveMigrations, /p_expected_version integer/);
  assert.match(effectiveMigrations, /BA_VERSION_MISMATCH/);
  assert.match(effectiveMigrations, /stage = 'PENDING_TL'.*status = 'PENDING'/s);
  assert.match(effectiveMigrations, /stage = 'APPROVED'.*status = 'APPROVED'/s);
  assert.match(effectiveMigrations, /stage = 'REJECTED'.*status = 'REJECTED'/s);
  assert.match(effectiveMigrations, /BA_REJECT_REASON_REQUIRED/);
  assert.match(effectiveMigrations, /for select to authenticated/);
  assert.match(effectiveMigrations, /can_access_upt\(upt_id\)/);
});

test("approval numbering and Storage evidence are server-derived", () => {
  assert.match(effectiveMigrations, /on conflict \(upt_id, year\) do update set last_value/);
  assert.match(effectiveMigrations, /lpad\(next_seq::text, 3, '0'\).*\.BA\//s);
  assert.match(effectiveMigrations, /storage\.objects/);
  assert.match(effectiveMigrations, /BA_PHOTO_REQUIRED/);
  assert.match(effectiveMigrations, /BA_PHOTO_NOT_STORED/);
  assert.match(effectiveMigrations, /ba-non-stock\//);
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

test("partial drafts preserve blank item fields and allow TL writer scope", () => {
  assert.match(sync, /if \(!isRecord\(row\)\) return null/);
  assert.match(sync, /const materialName = typeof row\.material_name === "string" \? row\.material_name : ""/);
  assert.match(sync, /nama: materialName/);
  assert.match(migration, /actor\.role not in \('ADMIN', 'TL', 'SUPERADMIN'\)/);
  assert.match(migration, /item_qty_text := nullif\(btrim\(coalesce\(item->>'qty'/);
  assert.match(migration, /perform public\.ba_non_stock_assert_complete\(row\)/);
});

test("BA UI exposes TL creation, UPT-scoped history, and review gates", () => {
  const tab = fs.readFileSync(path.join(root, "src/components/BaNonStockTab.jsx"), "utf8");
  const form = fs.readFileSync(path.join(root, "src/components/BaNonStockFormModal.jsx"), "utf8");
  const review = fs.readFileSync(path.join(root, "src/components/BaNonStockReviewModal.jsx"), "utf8");
  const preview = fs.readFileSync(path.join(root, "src/components/StockModals.jsx"), "utf8");
  const history = fs.readFileSync(path.join(root, "src/components/ApprovalHubTab.jsx"), "utf8");
  assert.match(tab, /filterStatus/);
  assert.match(tab, /tugUptFilter/);
  assert.match(tab, /record\.uptId/);
  assert.match(form, /hasRole\(currentUser,"ADMIN","TL","SUPERADMIN"\)/);
  assert.match(form, /Pilih UPT terlebih dahulu/);
  assert.match(review, /CHECKS\.every/);
  assert.match(review, /onLoad\?\.\(data\)/);
  assert.match(history, /docType:"BA_NON_STOCK"/);
  assert.match(history, /\.filter\(h => h\.docType === "BA_NON_STOCK" \|\| h\.decidedBy === currentUser\.id\)/);
  assert.match(tab, /terminal && <button[^>]+onClick=\{\(\)=>onReview\?\.\(record\)\}>Buka detail<\/button>/);
  assert.match(tab, /Diputus oleh/);
  assert.match(review, /const readOnly=\["APPROVED","REJECTED"\]/);
  assert.match(review, /details open=\{readOnly\}/);
  assert.match(preview, /resolveBaNonStockPrintNames\(rawDp/);
  assert.match(review, /const canApprove=!loading&&!busy&&!error&&!readOnly&&CHECKS\.every\(\(\[key\]\)=>checked\[key\]\)/);
  assert.doesNotMatch(review, /canApprove[^\n]*previewed/);
  assert.match(review, /TL approver/);
  assert.match(review, /Keterangan/);
});

test("BA draft payload prefers edited form aliases over stale server fields", () => {
  const payload = draftPayload({
    kind: "NON_STOCK", jenis: "PINJAM", issueDate: "2026-01-01", tanggal: "2026-02-02",
    warehouseId: "OLD-GUDANG", gudangId: "NEW-GUDANG", securityGuardId: "OLD-SATPAM", satpamId: "NEW-SATPAM",
    sender: "Pengirim lama", sumber: "Pengirim baru", referenceDocument: "REF-LAMA", referensi: "REF-BARU",
    purpose: "Keperluan lama", keperluan: "Keperluan baru", recipientName: "Lama", penerimaNama: "Baru",
    recipientTitle: "Jabatan lama", penerimaJabatan: "Jabatan baru", recipientUnit: "Unit lama", penerimaUnit: "Unit baru",
  }, [{ materialName: "Old material", nama: "New material", unit: "OLD", satuan: "NEW", description: "Old", keterangan: "New", qty: 2 }]);
  assert.deepEqual(payload, {
    kind: "PINJAM", issueDate: "2026-02-02", warehouseId: "NEW-GUDANG", securityGuardId: "NEW-SATPAM",
    sender: "Pengirim baru", destinationUnit: null, referenceDocument: "REF-BARU", purpose: "Keperluan baru",
    recipientName: "Baru", recipientTitle: "Jabatan baru", recipientUnit: "Unit baru", driverName: null,
    vehicleNumber: null, photoLabelUrl: null, photoLoadedUrl: null,
    items: [{ materialName: "New material", qty: 2, unit: "NEW", description: "New" }],
  });
});

test("BA draft photo removal and replacement follow edited aliases", () => {
  const removed = draftPayload({ photoLabelUrl: "old-label.jpg", photoLoadedUrl: "old-loaded.jpg", foto1: null, foto2: null }, []);
  assert.equal(removed.photoLabelUrl, null);
  assert.equal(removed.photoLoadedUrl, null);
  const replaced = draftPayload({ photoLabelUrl: "old-label.jpg", foto1: "new-label.jpg", photoLoadedUrl: "old-loaded.jpg", foto2: "new-loaded.jpg" }, []);
  assert.equal(replaced.photoLabelUrl, "new-label.jpg");
  assert.equal(replaced.photoLoadedUrl, "new-loaded.jpg");
});

test("BA print names prefer approved snapshots and only use a unique UPT TL fallback", () => {
  const users = [{ id: "tl-1", role: "TL", uptId: "UPT-A", name: "TL A" }, { id: "tl-2", role: "TL", uptId: "UPT-A", name: "TL A2" }];
  const draft = resolveBaNonStockPrintNames({ uptId: "UPT-A", satpamId: "s1", securityGuardSnapshot: {}, tlSnapshot: {} }, { satpamList: [{ id: "s1", name: "Satpam A" }], users });
  assert.equal(draft.satpamNama, "Satpam A");
  assert.equal(draft.tlNama, "");
  const approved = resolveBaNonStockPrintNames({ status: "APPROVED", uptId: "UPT-A", satpamId: "s1", satpamNama: "Wrong alias", securityGuardSnapshot: { name: "Approved guard" }, tlNama: "Wrong alias", tlSnapshot: { name: "TL Approver" } }, { satpamList: [], users });
  assert.equal(approved.satpamNama, "Approved guard");
  assert.equal(approved.tlNama, "TL Approver");
});

test("BA draft uses the single TL in its UPT", () => {
  const draft = resolveBaNonStockPrintNames({ uptId: "UPT-B" }, { users: [{ role: "TL", uptId: "UPT-B", name: "TL B" }] });
  assert.equal(draft.tlNama, "TL B");
});

test("BA review gate and print actions cover all workflow states", () => {
  const draftHtml = buildBaNonStockHTML({
    id: "BA-TEST-DRAFT",
    status: "PENDING",
    items: [{ nama: "Kabel", qty: 2, satuan: "M", keterangan: "uji" }],
  });
  const approvedHtml = buildBaNonStockHTML({
    id: "BA-TEST-APPROVED",
    status: "APPROVED",
    docNumber: "001.BA/UPT-TEST/10/2026",
    items: [{ nama: "Kabel", qty: 2, satuan: "M", keterangan: "uji" }],
  });
  assert.match(draftHtml, /DRAFT \/ BELUM DISETUJUI/);
  assert.match(draftHtml, /PRATINJAU — BELUM DISETUJUI/);
  assert.doesNotMatch(approvedHtml, /DRAFT \/ BELUM DISETUJUI/);
  assert.match(approvedHtml, /001\.BA\/UPT-TEST\/10\/2026/);
});
