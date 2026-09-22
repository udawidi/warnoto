import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  buildStockOpnameComparisons,
  itemNeedsStockOpnameNote,
  stockOpnameDiscrepancyNoteErrors,
} from "../../src/lib/stockOpnameReconciliation.js";

const sapItem = (overrides = {}) => ({
  id: "item-1",
  stockId: "stock-1",
  katalogId: "kat-1",
  noKatalog: "1002070769",
  qtySAP: 8,
  qtySistem: 5,
  qtsFisik: 7,
  ...overrides,
});

test("SAP, fisik, dan WARNOTO dibandingkan per material", () => {
  const [comparison] = buildStockOpnameComparisons([sapItem()], { isSap: true });
  assert.equal(comparison.sapQty, 8);
  assert.equal(comparison.physicalQty, 7);
  assert.equal(comparison.systemQty, 5);
  assert.equal(comparison.discrepant, true);
  assert.equal(comparison.recommendation, "TUG + periksa SAP");
});

test("saran membedakan tindakan TUG dan koreksi SAP", () => {
  assert.equal(buildStockOpnameComparisons([sapItem({ qtySAP: 7 })], { isSap: true })[0].recommendation, "TUG penerimaan");
  assert.equal(buildStockOpnameComparisons([sapItem({ qtySistem: 7 })], { isSap: true })[0].recommendation, "Periksa/koreksi SAP");
  assert.equal(buildStockOpnameComparisons([sapItem({ qtySAP: 7, qtySistem: 7 })], { isSap: true })[0].discrepant, false);
});

test("SAP kosong tetap selisih dan wajib keterangan", () => {
  const items = [sapItem({ qtySAP: null, qtySistem: 7 })];
  const [comparison] = buildStockOpnameComparisons(items, { isSap: true });
  assert.equal(comparison.discrepant, true);
  assert.equal(comparison.recommendation, "Periksa/koreksi SAP");
  assert.equal(stockOpnameDiscrepancyNoteErrors(items, { isSap: true }).length, 1);
});

test("lot digabung dan hanya representative material yang wajib keterangan", () => {
  const items = [
    sapItem({ qtySAP: 8, qtySistem: 3, qtsFisik: 4, keterangan: "Diselesaikan melalui TUG" }),
    sapItem({ id: "item-2", stockId: "stock-2", qtySAP: null, qtySistem: 2, qtsFisik: 3, keterangan: "" }),
  ];
  const [comparison] = buildStockOpnameComparisons(items, { isSap: true });
  assert.equal(comparison.physicalQty, 7);
  assert.equal(comparison.systemQty, 5);
  assert.equal(itemNeedsStockOpnameNote(items, 0, { isSap: true }), true);
  assert.equal(itemNeedsStockOpnameNote(items, 1, { isSap: true }), false);
  assert.equal(stockOpnameDiscrepancyNoteErrors(items, { isSap: true }).length, 0);
});

test("Non-SAP hanya membandingkan fisik dan WARNOTO", () => {
  const equal = buildStockOpnameComparisons([sapItem({ qtySAP: 99, qtySistem: 7 })], { isSap: false })[0];
  assert.equal(equal.discrepant, false);
  const shortage = buildStockOpnameComparisons([sapItem({ qtySAP: 99, qtySistem: 9 })], { isSap: false })[0];
  assert.equal(shortage.recommendation, "TUG pengeluaran");
});

test("approval RPC memakai snapshot tersimpan dan menolak perubahan qty", () => {
  const sql = fs.readFileSync("supabase/migrations/20260922_stock_opname_approval_fail_closed.sql", "utf8");
  assert.match(sql, /v_items := v_opname\.data->'items'/);
  assert.match(sql, /OPNAME_APPROVAL_NOTE_REQUIRED/);
  assert.match(sql, /OPNAME_APPROVAL_QTY_MUTATION/);
  assert.match(sql, /sapBaselineQty/);
  assert.match(sql, /update_stock_opname_tug_reference/);
  assert.doesNotMatch(sql, /set data = jsonb_set\([^;]*'\{qty\}'/s);
});

test("client approval does not replace qty with physical result", () => {
  const hook = fs.readFileSync("src/hooks/useStockOpname.js", "utf8");
  assert.match(hook, /stockOpnameDiscrepancyNoteErrors/);
  assert.match(hook, /sapBaselineQty/);
  assert.doesNotMatch(hook, /planStockOpnameStockUpdates/);
  assert.doesNotMatch(hook, /qty:\s*Number\([^\n]*qtsFisik/);
});
