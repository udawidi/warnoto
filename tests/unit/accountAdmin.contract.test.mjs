import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const hook = fs.readFileSync("src/hooks/useAccountAdmin.js", "utf8");
const master = fs.readFileSync("src/components/MasterDataTab.jsx", "utf8");

test("ganti password memverifikasi password baru lewat jalur login", () => {
  const updateAt = hook.indexOf("auth.updateUser({ password: f.newPassword })");
  const verifyAt = hook.indexOf("password: f.newPassword", updateAt);
  const successAt = hook.indexOf("setGantiPasswordModal(false)", verifyAt);
  assert.ok(updateAt > -1, "password harus diubah lewat Supabase Auth");
  assert.ok(verifyAt > updateAt, "password baru harus diverifikasi setelah update");
  assert.ok(successAt > verifyAt, "pesan sukses hanya boleh muncul setelah verifikasi login");
});

test("filter Kelola Akun mencakup UIT dan UPT turunannya", () => {
  assert.match(master, /aria-label="Filter UIT"/);
  assert.doesNotMatch(master, /showUnitFilters && uitList\.length > 1/);
  assert.match(master, /u\.uitId \|\| uptList\.find\(x => x\.id === u\.uptId\)\?\.uitId/);
  assert.match(master, /visibleUptOptions = akunUitFilter \? uptList\.filter\(u => u\.uitId === akunUitFilter\)/);
});
