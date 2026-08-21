import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

// maturitySync.js tidak bisa di-import di node (rantai import supabaseClient
// membaca import.meta.env), jadi kontraknya diperiksa lewat source seperti
// materialInspectionMultiUpt.contract.test.mjs.
const syncSource = await readFile(new URL("../../src/lib/maturitySync.js", import.meta.url), "utf8");
const appSource = await readFile(new URL("../../App.jsx", import.meta.url), "utf8");
// Logika tulis/guard/scope Maturity dipindah dari App.jsx ke hook ini (refactor
// Tranche-1/4). Kontrak dibaca dari lokasi kanonik barunya.
const hookSource = await readFile(new URL("../../src/hooks/useMaturity.jsx", import.meta.url), "utf8");
// Deteksi form scoped-UIT (array literal role) ikut pindah ke hook Akun.
const accountHookSource = await readFile(new URL("../../src/hooks/useAccountAdmin.js", import.meta.url), "utf8");
const dashSource = await readFile(new URL("../../src/components/MaturityDashboardTab.jsx", import.meta.url), "utf8");
const editorSource = await readFile(new URL("../../src/components/MaturityAuditSystem.jsx", import.meta.url), "utf8");
const rolesSource = await readFile(new URL("../../src/lib/roles.js", import.meta.url), "utf8");
const permsSource = await readFile(new URL("../../src/lib/perms.js", import.meta.url), "utf8");
const akunSource = await readFile(new URL("../../src/components/AkunModals.jsx", import.meta.url), "utf8");

test("fallback history maturity discope ke UPT pemilik angkanya", () => {
  assert.match(syncSource, /getDefaultMaturityAuditHistory = uptId =>/);
  assert.match(syncSource, /uptId === DEFAULT_HISTORY_UPT_ID \? DEFAULT_MATURITY_AUDIT_HISTORY\.map\(item => \(\{ \.\.\.item \}\)\) : \[\]/);
  // Semua entri default harus punya uptId, kalau tidak scoping di atas tidak berarti.
  const defaults = syncSource.match(/id: "MAH-UPT-SBY-\d{4}-S\d"[^\n]*/g) || [];
  assert.equal(defaults.length, 5);
  defaults.forEach(line => assert.match(line, /uptId: DEFAULT_HISTORY_UPT_ID/));
  // Pemanggil tanpa UPT tidak boleh ada: itu akan mengembalikan daftar kosong diam-diam.
  assert.doesNotMatch(appSource, /getDefaultMaturityAuditHistory\(\)/);
});

test("baris maturity yang ditulis selalu membawa upt_id", () => {
  assert.match(syncSource, /function auditHistoryItemToRow[\s\S]*?upt_id: item\.uptId \|\| null/);
  assert.match(syncSource, /function maturity5SItemToRow[\s\S]*?upt_id: item\.uptId \|\| null/);
  assert.match(syncSource, /upsertMaturityAuditHistory = item => upsertRow\("maturity_audit_history", auditHistoryItemToRow\(item\)\)/);
  // Row → item harus mengembalikan uptId, dipakai untuk filter UI per-UPT.
  assert.match(syncSource, /function auditHistoryRowToItem[\s\S]*?uptId: row\.upt_id/);
  assert.match(syncSource, /function maturity5SRowToItem[\s\S]*?uptId: row\.upt_id/);
});

test("delete maturity yang ditolak RLS tidak dianggap sukses", () => {
  // RLS tanpa policy DELETE balas 200 + 0 baris; tanpa .select() ini terlihat sukses.
  assert.match(syncSource, /\.delete\(\)\.eq\("id", id\)\.select\("id"\)/);
  assert.match(syncSource, /if \(!data \|\| data\.length === 0\)[\s\S]{0,160}return false/);
});

test("tulis maturity diblokir di mode demo dan digate per jenjang", () => {
  const guard = hookSource.slice(hookSource.indexOf("function guardMaturityWrite("), hookSource.indexOf("async function saveMaturityAssessment("));
  // Demo paling depan, sebelum pengecekan role apa pun.
  assert.ok(guard.indexOf("isDemoMode()") < guard.indexOf("REVIEW_UIT"));
  // hasRole() dipakai di kedua jenjang supaya SUPERADMIN ikut lolos — sama seperti
  // can_review_maturity_uit()/can_review_maturity_pusat() yang juga memuat
  // SUPERADMIN (audit macet di meja UIT/Pusat harus bisa ditolong).
  assert.match(guard, /status === "REVIEW_UIT"[\s\S]*?hasRole\(currentUser, "ADMIN_UIT", "ASMAN_LOG_UIT", "MGR_LOGISTIK_UIT"\)/);
  assert.match(guard, /status === "REVIEW_PUSAT" \|\| status === "FINAL"[\s\S]*?hasRole\(currentUser, "ADMIN_LOG_PUSAT"\)/);
  assert.match(guard, /hasRole\(currentUser, "ADMIN", "TL"\)/);
  ["saveMaturityAssessment", "saveMaturity5SAssessment", "saveMaturityAudit", "deleteMaturityAudit"].forEach(fn => {
    const body = hookSource.slice(hookSource.indexOf(`async function ${fn}(`));
    assert.match(body.slice(0, 700), /guardMaturityWrite\(/, `${fn} harus lewat guardMaturityWrite`);
  });
  // Pelaku ditentukan status LAMA (klausa USING), bukan status tujuan.
  assert.match(hookSource, /guardMaturityWrite\("menyimpan Audit Maturity", audit\?\.isNew \? "DRAFT" : \(audit\?\.status \|\| "DRAFT"\)\)/);
  // Form 5S wajib mengirim UPT user; tanpa ini insert ditolak RLS GELOMBANG B.
  assert.match(hookSource, /uptId: form\.uptId \|\| uptIdByNama\(uptNama\)/);
});

test("jenjang UPT → UIT → Pusat lengkap dan tidak ada tahap yang dilompati", () => {
  ["MATURITY_WORKFLOW_LABEL", "MATURITY_WORKFLOW_COLOR"].forEach(konst => {
    [appSource, editorSource].forEach(src => {
      const line = src.split("\n").find(l => l.includes(`${konst} =`));
      assert.match(line, /REVIEW_PUSAT/, `${konst} harus mengenal REVIEW_PUSAT`);
    });
  });
  // Transisi submit: UPT → REVIEW_UIT, UIT → REVIEW_PUSAT, Pusat → FINAL.
  assert.match(editorSource, /saveMaturityAudit\(audit, "REVIEW_UIT"\)/);
  assert.match(editorSource, /saveMaturityAudit\(audit, "REVIEW_PUSAT"\)[\s\S]{0,60}Kirim Hasil ke Pusat/);
  assert.doesNotMatch(editorSource, /saveMaturityAudit\(audit, "SELF_ASSESSMENT"\)/);
  // Matriks pelaku: ASMAN/MANAGER read-only, Pusat = SUPERADMIN saja.
  assert.match(editorSource, /const isUPT = hasRole\(currentUser, "ADMIN", "TL"\);/);
  assert.match(editorSource, /const isUIT = hasRole\(currentUser, "ADMIN_UIT", "ASMAN_LOG_UIT", "MGR_LOGISTIK_UIT"\)/);
  assert.match(editorSource, /const isPusat = hasRole\(currentUser, "ADMIN_LOG_PUSAT"\);/);
  assert.match(editorSource, /canScorePusat = isPusat && \(status === "REVIEW_PUSAT" \|\| status === "FINAL"\)/);
  assert.match(dashSource, /canEditUIT = hasRole\(currentUser, "ADMIN_UIT", "ASMAN_LOG_UIT", "MGR_LOGISTIK_UIT"\)/);
  assert.match(dashSource, /canEditPusat = hasRole\(currentUser, "ADMIN_LOG_PUSAT"\) && \(a\.status === "REVIEW_PUSAT" \|\| a\.status === "FINAL"\)/);
  assert.doesNotMatch(dashSource, /hasRole\(currentUser, "SUPERADMIN", "MANAGER"\)/);
  assert.doesNotMatch(dashSource, /hasRole\(currentUser, "ADMIN", "TL", "ASMAN", "MANAGER"\)/);
});

test("peninjau UIT/Pusat bebas pindah UPT, MANAGER terkunci di UPT-nya", () => {
  const line = hookSource.split("\n").find(l => l.includes("canSwitchMaturityUpt = "));
  ["ADMIN_UIT", "ASMAN_LOG_UIT", "MGR_LOGISTIK_UIT", "ADMIN_LOG_PUSAT", "SUPERADMIN"].forEach(r =>
    assert.match(line, new RegExp(`"${r}"`), `${r} harus bisa berpindah UPT`));
  // MANAGER terikat SATU UPT (keputusan user 2026-08-02) — bukan peninjau lintas UPT.
  assert.doesNotMatch(line, /"MANAGER"/);
});

test("role baru terdaftar utuh, tidak setengah jalan", () => {
  ["ASMAN_LOG_UIT", "ADMIN_LOG_PUSAT"].forEach(role => {
    assert.match(rolesSource, new RegExp(`${role}: "`), `${role} harus punya label di ROLES`);
    assert.match(permsSource, new RegExp(`"${role}"`), `${role} harus ada di MATRIX_ROLES`);
    // Tanpa entri DEFAULT_PERMS, can() selalu false → akun tanpa satu menu pun.
    assert.match(permsSource, new RegExp(`${role}: \\{ \\.\\.\\.FULL_MENUS \\}`), `${role} wajib punya entri DEFAULT_PERMS`);
    assert.doesNotMatch(permsSource, new RegExp(`${role}: \\{[^}]*aksi\\.`), `${role} peninjau, tidak boleh punya aksi.*`);
  });
  // Scope-UIT: ASMAN_LOG_UIT ikut, ADMIN_LOG_PUSAT (nasional) tidak.
  [accountHookSource, akunSource].forEach(src => {
    assert.match(src, /\["ADMIN_UIT","ASMAN_LOG_UIT","MGR_LOGISTIK_UIT"\]/);
  });
  assert.match(appSource, /UIT_ROLE_QUOTA = \{ ADMIN_UIT: 1, ASMAN_LOG_UIT: 1, MGR_LOGISTIK_UIT: 1, PENGADAAN: 1 \}/);
  assert.doesNotMatch(appSource.split("\n").find(l => l.includes("UIT_ROLE_QUOTA = ")), /ADMIN_LOG_PUSAT: \d/);
});

test("history dimuat ulang setelah audit FINAL (baris terbit dari trigger DB)", () => {
  assert.match(hookSource, /newStatus === "FINAL"[\s\S]{0,320}await loadMaturityAuditHistory\(\)[\s\S]{0,240}CLOUD\.set\("pln_maturity_audit_history_v1", freshHistory\)/);
});

test("UI maturity discope pakai id UPT, bukan kecocokan nama", () => {
  assert.match(dashSource, /selectedMaturityUptId/);
  assert.match(dashSource, /const isSelectedUpt = row =>/);
  assert.match(dashSource, /const uptAudits = maturityAudits\.filter\(isSelectedUpt\)/);
  assert.match(dashSource, /maturityAuditHistory\s*\n\s*\.filter\(isSelectedUpt\)/);
  // Daftar/riwayat audit tidak boleh lagi membaca koleksi mentah lintas UPT.
  assert.doesNotMatch(dashSource, /maturityAudits\.slice\(/);
  assert.doesNotMatch(dashSource, /maturityAudits\.filter\(a => a\.status === "FINAL"\)/);
});
