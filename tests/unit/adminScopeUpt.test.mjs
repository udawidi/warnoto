// Self-check untuk logika scope UPT di admin-create-user & admin-update-user
// (Edge Function jalan di runtime Deno, tidak bisa diimport langsung dari Node —
// dites mereplikasi bolehKelolaAkun(), sama persis dengan yang di kedua index.ts).
import test from "node:test";
import assert from "node:assert/strict";

function bolehKelolaAkun(callerRole, callerUptId, targetUptLama, targetUptBaru) {
  if (callerRole === "SUPERADMIN") return true;
  return targetUptLama === callerUptId && targetUptBaru === callerUptId;
}

test("ADMIN beda-UPT ditolak, baik via UPT lama maupun UPT baru", () => {
  assert.equal(bolehKelolaAkun("ADMIN", "upt-A", "upt-B", "upt-A"), false); // akun lama di UPT lain
  assert.equal(bolehKelolaAkun("ADMIN", "upt-A", "upt-A", "upt-B"), false); // dipindah ke UPT lain
  assert.equal(bolehKelolaAkun("ADMIN", "upt-A", "upt-B", "upt-B"), false); // lama & baru sama-sama UPT lain
});

test("ADMIN sama-UPT (lama & baru) diizinkan", () => {
  assert.equal(bolehKelolaAkun("ADMIN", "upt-A", "upt-A", "upt-A"), true);
});

test("SUPERADMIN selalu diizinkan lintas-UPT", () => {
  assert.equal(bolehKelolaAkun("SUPERADMIN", "upt-A", "upt-B", "upt-C"), true);
  assert.equal(bolehKelolaAkun("SUPERADMIN", null, null, "upt-X"), true);
});

test("role nasional/UIT-scoped (upt_id null) otomatis ditolak untuk ADMIN biasa", () => {
  assert.equal(bolehKelolaAkun("ADMIN", "upt-A", null, null), false);
});
