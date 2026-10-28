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
