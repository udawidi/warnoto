import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  MTU_KHS_RECONCILIATION_STATUS,
  buildMtuTug3Draft,
  normalizeMtuReconciliationStatus,
  validateMtuStockReference,
} from "../../src/features/mtu-khs/mtuKhsModel.js";

const sql = readFileSync(new URL("../../supabase/migrations/20260913_mtu_khs_tug_lifecycle.sql", import.meta.url), "utf8");
const api = readFileSync(new URL("../../src/features/mtu-khs/mtuKhsApi.js", import.meta.url), "utf8");
const txnHook = readFileSync(new URL("../../src/hooks/useTugTransactions.js", import.meta.url), "utf8");
const detailUi = readFileSync(new URL("../../src/features/mtu-khs/MtuKhsDetail.jsx", import.meta.url), "utf8");
const tabUi = readFileSync(new URL("../../src/features/mtu-khs/MtuKhsTab.jsx", import.meta.url), "utf8");
const mtuCss = readFileSync(new URL("../../src/features/mtu-khs/mtuKhs.css", import.meta.url), "utf8");

test("MTU reconciliation contract is TL-scoped, direct, and enum-bound", () => {
  assert.deepEqual(MTU_KHS_RECONCILIATION_STATUS, ["BELUM_DICEK", "BELUM_TUG", "SEBAGIAN", "SUDAH_TUG"]);
  assert.match(sql, /create table if not exists public\.mtu_khs_reconciliations/);
  assert.match(sql, /status text not null check \(status in \('BELUM_DICEK', 'BELUM_TUG', 'SEBAGIAN', 'SUDAH_TUG'\)\)/);
  assert.match(sql, /a\.role = 'TL' and a\.upt_id = r\.upt_id/);
  assert.match(sql, /mtu_khs_set_reconciliation/);
  assert.doesNotMatch(sql.slice(sql.indexOf("create or replace function public.mtu_khs_set_reconciliation"), sql.indexOf("create or replace function public.mtu_khs_link_stock")), /mtu_khs_change_requests/);
});

test("MTU stock references require same catalog and UPT without qty mutation", () => {
  assert.match(sql, /create table if not exists public\.mtu_khs_stock_links/);
  assert.match(sql, /s\.katalog_id is distinct from r\.katalog_id/);
  assert.match(sql, /g\.upt_id = r\.upt_id/);
  assert.doesNotMatch(sql.slice(sql.indexOf("create or replace function public.mtu_khs_link_stock"), sql.indexOf("-- Keep the existing function signature")), /update public\.stocks|insert into public\.stocks/);
  assert.equal(validateMtuStockReference({ id: "R", procurementYear: 2024, uptId: "UPT-1", katalogId: "K" }, { uptId: "UPT-1", katalogId: "K" }).valid, true);
  assert.equal(validateMtuStockReference({ id: "R", procurementYear: 2024, uptId: "UPT-1", katalogId: "K" }, { uptId: "UPT-2", katalogId: "K" }).valid, false);
});

test("TUG3 transaction opener accepts an optional preset without changing other defaults", () => {
  assert.match(txnHook, /function openNewTxn\(docType = "TUG9", preset = null\)/);
  const tug3Start = txnHook.indexOf('} else if (docType === "TUG3")');
  const tug5Start = txnHook.indexOf('} else if (docType === "TUG5")', tug3Start);
  assert.ok(tug3Start >= 0 && tug5Start > tug3Start);
  const tug3Branch = txnHook.slice(tug3Start, tug5Start);
  assert.match(tug3Branch, /defaultTug3Item/);
  assert.match(tug3Branch, /tug3Preset/);
  assert.match(tug3Branch, /docType: "TUG3"/);
  assert.match(tug3Branch, /stockItems: presetItems/);
  assert.doesNotMatch(txnHook.slice(0, tug3Start), /tug3Preset/);
});

test("TUG usage is final TUG-8/9, readable, and reference-only", () => {
  const usageSql = sql.slice(sql.indexOf("-- Keep the existing function signature"), sql.indexOf("-- Apply one final MTU-linked"));
  assert.match(usageSql, /t\.doc_type not in \('TUG8','TUG9'\)/);
  assert.match(usageSql, /t\.status <> 'FINAL_APPROVED'/);
  assert.match(usageSql, /r\.sifat_pekerjaan = 'SUPERVISI'/);
  assert.match(usageSql, /docNumber/);
  assert.doesNotMatch(usageSql, /update public\.stocks|insert into public\.stocks/);
  assert.match(api, /docNumber: transaction\.doc_number/);
  assert.match(api, /docType: transaction\.doc_type/);
  assert.match(api, /finalApprovedAt: transaction\.final_approved_at/);
});

test("MTU TUG-3 draft carries provenance and final receipt is idempotent/partial-safe", () => {
  const draft = buildMtuTug3Draft({ id: "MTU-1", procurementYear: 2026, uptId: "UPT-1", katalogId: "K-1", qty: 8, vendor: "Vendor" });
  assert.equal(draft.mtuRecordId, "MTU-1");
  assert.equal(draft.stockItems[0].katalogId, "K-1");
  assert.equal(draft.stockItems[0].qty, 8);
  assert.equal(draft.stockItems[0].sapStatus, "SAP — Persediaan");
  const partialDraft = buildMtuTug3Draft({ id: "MTU-1", procurementYear: 2026, uptId: "UPT-1", katalogId: "K-1", qty: 8, receipts: [{ qty: 3 }] });
  assert.equal(partialDraft.stockItems[0].qty, 5);
  assert.match(sql, /add column if not exists mtu_record_id text references public\.mtu_khs_records/);
  assert.match(sql, /alter table public\.stocks add column if not exists upt_id/);
  assert.match(sql, /'uptId', r\.upt_id/);
  assert.match(sql, /insert into public\.stocks\(id, katalog_id, lokasi_id, upt_id, data, created_at\)/);
  assert.match(sql, /on conflict \(mtu_record_id, stock_id\) do update set qty = excluded\.qty, updated_by = excluded\.updated_by/);
  assert.match(sql, /unique \(tug3_transaction_id\)/);
  assert.match(sql, /unique \(idempotency_key\)/);
  assert.match(sql, /MTU_RECEIPT_QTY_EXCEEDED/);
  assert.match(sql, /update public\.tug3_transactions set stage = 'APPROVED', status = 'APPROVED'/);
  assert.equal(normalizeMtuReconciliationStatus("sudah_tug"), "SUDAH_TUG");
  assert.equal(normalizeMtuReconciliationStatus("unknown"), "BELUM_DICEK");
  assert.match(api, /loadMtuKhsReconciliation/);
  assert.match(api, /loadMtuKhsStockLinks/);
  assert.match(api, /loadMtuKhsReceipts/);
  assert.match(api, /loadMtuKhsLifecycle/);
});

test("ordinary TUG-3 upsert omits the optional MTU column", () => {
  const sync = readFileSync(new URL("../../src/lib/tug3Sync.js", import.meta.url), "utf8");
  assert.match(sync, /if \(txn\.mtuRecordId \|\| txn\.mtu_record_id\) row\.mtu_record_id/);
  assert.doesNotMatch(sync.slice(sync.indexOf("const row = {"), sync.indexOf("if (txn.mtuRecordId")), /mtu_record_id/);
});

test("2026 catalog change requests validate and persist the typed catalog id", () => {
  const submitStart = sql.indexOf("create or replace function public.mtu_khs_submit_change");
  const decideStart = sql.indexOf("create or replace function public.mtu_khs_decide_change", submitStart);
  assert.ok(submitStart >= 0 && decideStart > submitStart);
  const submitSql = sql.slice(submitStart, decideStart);
  const decideSql = sql.slice(decideStart);
  assert.match(submitSql, /'katalogId','reason'/);
  assert.match(submitSql, /from public\.katalog k where k\.id = nullif\(btrim\(p_patch->>'katalogId'\)/);
  assert.match(submitSql, /MTU_MAPPING_REQUIRED/);
  assert.match(submitSql, /patch->>'_idempotency_key' = p_idempotency_key/);
  assert.match(decideSql, /new_data := r\.data \|\| \(c\.patch - '_idempotency_key'\)/);
  assert.match(decideSql, /katalog_id = case when c\.patch \? 'katalogId' then nullif\(btrim\(c\.patch->>'katalogId'\)/);
  assert.match(decideSql, /mtu_khs_sheet_sync_jobs/);
  assert.match(decideSql, /on conflict \(change_request_id\) do nothing/);
});

test("MTU detail exposes the approved lifecycle controls with mobile-safe sizing", () => {
  assert.match(detailUi, /Pengeluaran TUG-8\/9/);
  assert.match(detailUi, /Rekonsiliasi TUG 2024/);
  assert.match(detailUi, /Penerimaan Material TUG-3\/4/);
  assert.match(tabUi, /canReconcile=\{currentUser\?\.role === "TL" \|\| currentUser\?\.role === "SUPERADMIN"\}/);
  assert.match(tabUi, /openNewTxn\("TUG3", draft\)/);
  assert.match(tabUi, /\["katalogId","Katalog Data Stok"\]/);
  assert.match(mtuCss, /\.mtu-khs-reconciliation select, \.mtu-khs-reconciliation input \{ width: 100%; min-width: 0; min-height: 44px/);
  assert.match(mtuCss, /@media \(max-width: 520px\)/);
});
