import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const migration = fs.readFileSync(new URL("../../supabase/migrations/20261028_tug10_return_source_note.sql", import.meta.url), "utf8");
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
