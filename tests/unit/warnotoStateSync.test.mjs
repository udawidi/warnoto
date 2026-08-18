// Self-check untuk gate role di supabase/functions/sync-warnoto-state/index.ts
// (Edge Function jalan di runtime Deno, tidak bisa diimport langsung dari Node —
// dites mereplikasi bolehSyncState(), sama persis dengan yang di index.ts).
import test from "node:test";
import assert from "node:assert/strict";

function bolehSyncState(role) {
  if (!role || role === "VIEWER") return false;
  return true;
}

test("VIEWER ditolak", () => {
  assert.equal(bolehSyncState("VIEWER"), false);
});

test("role kosong/null ditolak", () => {
  assert.equal(bolehSyncState(""), false);
  assert.equal(bolehSyncState(null), false);
  assert.equal(bolehSyncState(undefined), false);
});

test("ADMIN, PENGADAAN, SUPERADMIN diizinkan", () => {
  assert.equal(bolehSyncState("ADMIN"), true);
  assert.equal(bolehSyncState("PENGADAAN"), true);
  assert.equal(bolehSyncState("SUPERADMIN"), true);
});
