// Security fix P1-katalog (opsi B, 2026-08-18): klien tidak boleh memicu write katalog
// untuk VIEWER (RLS "Operational write katalog" akan menolaknya). Test ini menjaga
// predikat bolehTulisKatalog() tetap sinkron dengan predikat RLS di migration 20260818b.
import test from "node:test";
import assert from "node:assert";
import { bolehTulisKatalog } from "../../src/lib/roles.js";

test("bolehTulisKatalog: VIEWER ditolak", () => {
  assert.strictEqual(bolehTulisKatalog("VIEWER"), false);
});

test("bolehTulisKatalog: role kosong/null ditolak", () => {
  assert.strictEqual(bolehTulisKatalog(""), false);
  assert.strictEqual(bolehTulisKatalog(null), false);
  assert.strictEqual(bolehTulisKatalog(undefined), false);
});

test("bolehTulisKatalog: role operasional diizinkan", () => {
  for (const role of ["ADMIN", "TL", "ASMAN", "MANAGER", "PENGADAAN", "SUPERADMIN", "ADMIN_UIT", "ASMAN_LOG_UIT", "MGR_LOGISTIK_UIT", "ADMIN_LOG_PUSAT", "ADMIN_ULTG", "MGR_ULTG"]) {
    assert.strictEqual(bolehTulisKatalog(role), true, `${role} harus diizinkan`);
  }
});
