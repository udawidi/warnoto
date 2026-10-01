import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const modal = await readFile(new URL("../../src/components/TugFormModals.jsx", import.meta.url), "utf8");
const hook = await readFile(new URL("../../src/hooks/useTugTransactions.js", import.meta.url), "utf8");
const approval = await readFile(new URL("../../src/components/ApprovalTab.jsx", import.meta.url), "utf8");
const migration = await readFile(new URL("../../supabase/migrations/20261001_tug10_target_stock.sql", import.meta.url), "utf8");
const schema = await readFile(new URL("../../supabase/schema.sql", import.meta.url), "utf8");
const verifier = await readFile(new URL("../../supabase/verify_tug10_atomic_final_approval.sql", import.meta.url), "utf8");

test("TUG-10 form carries an explicit target stock and shows ambiguous candidates", () => {
  assert.match(modal, /stocks = \[\]/);
  assert.match(modal, /targetCandidates/);
  assert.match(modal, /dipilih otomatis/);
  assert.match(modal, /Pilih baris stok/);
  assert.match(modal, /Approval akan membuat lot baru/);
});

test("TUG-10 item target auto-selects only for one exact catalog/location candidate", () => {
  assert.match(hook, /targetStockId:""/);
  assert.match(hook, /stockHandling:""/);
  assert.match(hook, /\["katalogMode", "katalogId"\]/);
  assert.match(hook, /candidates\.length === 1/);
  assert.match(hook, /candidates\[0\]\.id/);
  assert.match(hook, /candidates\.length > 1/);
});

test("TUG-10 approval preview uses the selected lot and blocks ambiguous legacy rows", () => {
  assert.match(approval, /tug10HasAmbiguousTarget/);
  assert.match(approval, /si\.targetStockId \? stocks\.find\(s=>s\.id===si\.targetStockId\)/);
  assert.match(approval, /tug10HasAmbiguousTarget/);
});

test("TUG-10 target RPC locks and validates target, legacy ambiguity, and idempotent effects", () => {
  assert.match(migration, /v_item->>'targetStockId'/);
  assert.match(migration, /v_item->>'stockHandling'/);
  assert.match(migration, /for update;/);
  assert.match(migration, /TUG10_TARGET_STOCK_NOT_FOUND/);
  assert.match(migration, /TUG10_TARGET_STOCK_MISMATCH/);
  assert.match(migration, /TUG10_TARGET_STOCK_AMBIGUOUS/);
  assert.match(migration, /TUG10_TARGET_SOURCE_ALLOCATION_REQUIRED/);
  assert.match(migration, /NEEDS_SOURCE_ALLOCATION/);
  assert.match(migration, /'tug10ReturnEffects'/);
  assert.match(migration, /'sourceDocumentNo'/);
  assert.match(migration, /'returnStatus', v_item->>'statusMaterial'/);
  assert.match(migration, /insert into public\.stocks\(id, katalog_id, lokasi_id, upt_id, data, created_at\)/);
  assert.match(migration, /set data = v_stock_data, upt_id = coalesce\(upt_id, v_txn\.upt_id\)/);
});

test("TUG-10 RPC keeps MERGE and SEPARATE semantics distinct", () => {
  assert.match(migration, /v_handling = 'MERGE'/);
  assert.match(migration, /v_handling = 'SEPARATE'/);
  assert.match(migration, /TUG10_TARGET_STOCK_REQUIRED/);
  assert.match(migration, /v_target_stock_id := null;/);
  assert.match(migration, /'sourceLot', v_source_lot/);
  assert.match(migration, /'returnStatus', v_item->>'statusMaterial'/);
  assert.match(migration, /v_return_effects := coalesce\(v_stock_data->'tug10ReturnEffects'/);
  assert.match(migration, /v_already := coalesce\(/);
  assert.match(migration, /v_candidate_count > 1/);
  assert.match(migration, /v_candidate_count = 1/);
  assert.match(migration, /v_handling := 'SEPARATE'/);
});

test("schema mirror and read-only verifier contain the target-stock contract", () => {
  assert.match(schema, /TUG10_TARGET_STOCK_AMBIGUOUS/);
  assert.match(schema, /'tug10ReturnEffects'/);
  assert.match(verifier, /VERIFY_TUG10_TARGET_STOCK_INPUT_MISSING/);
  assert.match(verifier, /VERIFY_TUG10_TARGET_STOCK_GUARDS_MISSING/);
});
