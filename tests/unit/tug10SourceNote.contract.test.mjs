import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const migration = fs.readFileSync(new URL("../../supabase/migrations/20261028_tug10_return_source_note.sql", import.meta.url), "utf8");
const legacyMigration = fs.readFileSync(new URL("../../supabase/migrations/20261028b_tug10_return_note_legacy.sql", import.meta.url), "utf8");
const schema = fs.readFileSync(new URL("../../supabase/schema.sql", import.meta.url), "utf8");

test("TUG-10 source note RPC is scoped and effect-specific", () => {
  for (const text of [migration, schema]) {
    assert.match(text, /update_tug10_return_note/);
    assert.match(text, /actor\.role not in \('TL', 'SUPERADMIN'\)/);
    assert.match(text, /can_access_upt/);
    assert.match(text, /TUG10_NOTE_EFFECT_NOT_FOUND/);
    assert.match(text, /TUG10_NOTE_TOO_LONG/);
    assert.match(text, /jsonb_set/);
    assert.match(text, /audit_log/);
  }
});

test("legacy TUG-10 markers promote only after scoped approved transaction checks", () => {
  for (const text of [legacyMigration, schema]) {
    assert.match(text, /_tug10Applied/);
    assert.match(text, /TUG10_NOTE_LEGACY_MARKER_INVALID/);
    assert.match(text, /TUG10_NOTE_LEGACY_KEY_INVALID/);
    assert.match(text, /TUG10_NOTE_LEGACY_TXN_INVALID/);
    assert.match(text, /TUG10_NOTE_LEGACY_ITEM_INVALID/);
    assert.match(text, /txn_row\.status is distinct from 'APPROVED'/);
    assert.match(text, /txn_row\.upt_id is distinct from/);
    assert.match(text, /'transactionId', txn_row\.id/);
    assert.match(text, /'itemIndex', item_index/);
    assert.match(text, /jsonb_set\(stock_data, '\{tug10ReturnEffects\}'/);
    assert.match(text, /status is distinct from 'APPROVED'/);
  }
});

test("legacy note scope resolves stock, data, or location UPT and fails closed", () => {
  for (const text of [legacyMigration, schema]) {
    assert.match(text, /row_upt/);
    assert.match(text, /data_upt/);
    assert.match(text, /lokasi_upt/);
    assert.match(text, /public\.lokasi l left join public\.gudang g/);
    assert.match(text, /stock_row\.lokasi_id.*stock_data->>'lokasiId'.*TUG10_NOTE_STOCK_SCOPE_CONFLICT/s);
    assert.match(text, /coalesce\(nullif\(btrim\(stock_row\.lokasi_id\), ''\), nullif\(btrim\(stock_data->>'lokasiId'\), ''\)\)/);
    assert.match(text, /TUG10_NOTE_STOCK_SCOPE_CONFLICT/);
    assert.match(text, /TUG10_NOTE_STOCK_SCOPE_UNRESOLVED/);
    assert.match(text, /effective_upt := coalesce\(row_upt, data_upt, lokasi_upt\)/);
    assert.match(text, /txn_row\.upt_id is distinct from effective_upt/);
  }
});
