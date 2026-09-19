import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { AUDIT_ASPECTS } from "../../src/data/auditAspects.js";
import {
  MATURITY_WAREHOUSE_TYPES,
  calculateMaturityDualScore,
  calculateMaturityWarehouseScore,
} from "../../src/lib/maturityWarehouse.js";
import {
  maturityEvidenceStorageStatus,
  maturityEvidenceProgress,
  maturityUptOptions,
  latestMaturityAudit,
} from "../../src/lib/maturityUit.js";

const dashboardSource = await readFile(new URL("../../src/components/MaturityDashboardTab.jsx", import.meta.url), "utf8");
const editorSource = await readFile(new URL("../../src/components/MaturityAuditSystem.jsx", import.meta.url), "utf8");
const appSource = await readFile(new URL("../../App.jsx", import.meta.url), "utf8");
const modalSource = await readFile(new URL("../../src/components/MiscModals.jsx", import.meta.url), "utf8");
const hookSource = await readFile(new URL("../../src/hooks/useMaturity.jsx", import.meta.url), "utf8");
const syncSource = await readFile(new URL("../../src/lib/maturitySync.js", import.meta.url), "utf8");
const proposalSource = await readFile(new URL("../../supabase/proposals/20260919_maturity_uit_hardening.sql", import.meta.url), "utf8");
const rollbackSource = await readFile(new URL("../../supabase/proposals/20260919_maturity_uit_hardening_rollback.sql", import.meta.url), "utf8");
const verifierSource = await readFile(new URL("../../scripts/verify_maturity_uit_scope.sql", import.meta.url), "utf8");
const driveSource = await readFile(new URL("../../supabase/functions/maturity-drive/index.ts", import.meta.url), "utf8");
const schemaSource = await readFile(new URL("../../supabase/schema.sql", import.meta.url), "utf8");

test("formula canonical 4 Persediaan + 2 ATTB/MRWI = 3.5 Level 4", () => {
  const assessments = {
    [MATURITY_WAREHOUSE_TYPES.PERSEDIAAN]: { warehouseType: MATURITY_WAREHOUSE_TYPES.PERSEDIAAN, aspekScores: Object.fromEntries(AUDIT_ASPECTS.map(a => [a.id, { pusat: 4 }])) },
    [MATURITY_WAREHOUSE_TYPES.ATTB_MRWI]: { warehouseType: MATURITY_WAREHOUSE_TYPES.ATTB_MRWI, aspekScores: Object.fromEntries(AUDIT_ASPECTS.map(a => [a.id, { pusat: 2 }])) },
  };
  const result = calculateMaturityDualScore(AUDIT_ASPECTS, assessments, () => 1);
  assert.equal(result.total, 3.5);
  assert.equal(result.level, 4);
});

test("fallback score mengikuti pusat > uit > upt > evidence", () => {
  const aspect = AUDIT_ASPECTS[0];
  const evidence = { [aspect.id]: aspect.requiredEvidence.map(item => ({ itemId: item.id })) };
  const evidenceScore = calculateMaturityWarehouseScore(AUDIT_ASPECTS, { warehouseType: MATURITY_WAREHOUSE_TYPES.PERSEDIAAN, aspekScores: {}, evidence }, () => 5);
  assert.equal(evidenceScore.aspectScores[aspect.id], 5);
  const precedence = scores => calculateMaturityWarehouseScore(AUDIT_ASPECTS, { warehouseType: MATURITY_WAREHOUSE_TYPES.PERSEDIAAN, aspekScores: { [aspect.id]: scores }, evidence: {} }, () => 1).aspectScores[aspect.id];
  assert.equal(precedence({ upt: 2 }), 2);
  assert.equal(precedence({ upt: 2, uit: 3 }), 3);
  assert.equal(precedence({ upt: 2, uit: 3, pusat: 4 }), 4);
});

test("scope UPT memakai data aktual dan role hierarchy", () => {
  const list = [{ id: "SBY", nama: "UPT Surabaya", uitId: "JBM" }, { id: "MLG", nama: "UPT Malang", uitId: "JBM" }, { id: "BDG", nama: "UPT Bandung", uitId: "JBB" }];
  assert.deepEqual(maturityUptOptions({ role: "ADMIN_UIT", uitId: "JBM" }, list).map(u => u.id), ["SBY", "MLG"]);
  assert.deepEqual(maturityUptOptions({ role: "ADMIN", uptId: "MLG" }, list).map(u => u.id), ["MLG"]);
  assert.deepEqual(maturityUptOptions({ role: "ADMIN_LOG_PUSAT" }, list).map(u => u.id), ["SBY", "MLG", "BDG"]);
});

test("latest audit terurut updatedAt lalu createdAt", () => {
  const upt = { id: "MLG", nama: "UPT Malang" };
  const latest = latestMaturityAudit([
    { id: "old", uptId: "MLG", createdAt: 20, updatedAt: 30 },
    { id: "new", uptId: "MLG", createdAt: 10, updatedAt: 40 },
  ], upt);
  assert.equal(latest.id, "new");
});

test("evidence status tidak mengklaim dual storage tanpa storagePath", () => {
  assert.equal(maturityEvidenceStorageStatus({ driveFileId: "drive-1" }), "DRIVE_ONLY");
  assert.equal(maturityEvidenceStorageStatus({ driveFileId: "drive-1", storagePath: "2026/a.pdf" }), "BACKUP_RECORDED");
  const progress = maturityEvidenceProgress({ warehouseAssessments: { PERSEDIAAN: { evidence: {} }, ATTB_MRWI: { evidence: {} } } });
  assert.equal(progress.totalAspects, 36);
  assert.equal(progress.pct, 0);
});

test("switch UPT memakai handler tunggal dan editor mengunci audit context", () => {
  assert.match(dashboardSource, /const requestUptChange = nextUpt =>/);
  assert.match(dashboardSource, /pendingUptRef\.current = nextUpt/);
  assert.match(dashboardSource, /selectedUpt=\{maturityAuditModal\?\.upt \|\| selectedMaturityUpt\}/);
  assert.match(editorSource, /const currentUptName = audit\.upt \|\| selectedUpt/);
});

test("mobile evidence viewer memakai native link dan memberi feedback untuk id kosong", () => {
  assert.match(editorSource, /<a href=\{state\.url\} target="_blank" rel="noopener noreferrer"/);
  assert.doesNotMatch(editorSource, /window\.open\(state\.url/);
  assert.match(editorSource, /else setUploadError\(/);
  assert.match(editorSource, /belum memiliki ID server dan tidak dapat dibuka/);
});

test("popup migrasi Maturity mengingat dismissal per signature kandidat", () => {
  assert.match(appSource, /warnoto_maturity_migration_dismissed_sig/);
  assert.match(appSource, /item\.label.*record\?\.id/);
  assert.match(appSource, /localStorage\.setItem\("warnoto_maturity_migration_dismissed_sig", migrationSignature\)/);
  assert.match(appSource, /onCancel: \(\) =>/);
  assert.equal((modalSource.match(/confirmDialog\.onCancel\?\./g) || []).length, 2);
  assert.doesNotMatch(appSource, /onCancel:[\s\S]{0,500}upsertAll/);
});

test("reviewer UIT/Pusat init setelah scope async dan tidak menimpa pilihan valid", () => {
  assert.match(hookSource, /if \(!maturityUptOptions\.length\) return/);
  assert.match(hookSource, /setSelectedMaturityUpt\(ownUptNama \|\| maturityUptOptions\[0\]\.nama\)/);
  assert.match(hookSource, /else if \(!selectedOption\)/);
  assert.match(hookSource, /if \(!didInitUptRef\.current\)/);
});

test("proposal RLS fail-closed dan verifier evidence read-only tersedia", () => {
  assert.match(proposalSource, /create or replace function public\.can_access_maturity_upt/);
  assert.match(proposalSource, /drop policy if exists "Authenticated write maturity_audit_history"/);
  assert.match(proposalSource, /MATURITY_REVIEW_UPT_MISMATCH/);
  assert.match(proposalSource, /MATURITY_ASSESSMENT_ORPHAN/);
  assert.match(proposalSource, /PUSAT_LEGACY_UNSCOPED/);
  assert.match(proposalSource, /p_upt_id is null and actor\.role in \('SUPERADMIN', 'ADMIN_LOG_PUSAT'\)/);
  assert.doesNotMatch(proposalSource, /actor\.role in \('ADMIN_UIT', 'ASMAN_LOG_UIT', 'MGR_LOGISTIK_UIT', 'HAR_UIT'\)/);
  assert.match(proposalSource, /grant update \(target, updated_at, updated_by\) on public\.maturity_audit_history/);
  assert.match(proposalSource, /drop policy if exists "Authenticated write maturity_audit_history"/);
  assert.match(verifierSource, /missing_storage_objects/);
  assert.match(verifierSource, /storage\.objects/);
  assert.match(verifierSource, /group by e\.upt_id, e\.upt/);
  assert.match(verifierSource, /unexpected_unscoped/);
  assert.match(verifierSource, /form5s_storage_objects_found/);
});

test("legacy assessment membawa upt_id dan target history hanya update field minimum", () => {
  assert.match(syncSource, /function assessmentRowToItem[\s\S]*?uptId: row\.upt_id/);
  assert.match(syncSource, /function assessmentItemToRow[\s\S]*?upt_id: item\.uptId/);
  assert.match(syncSource, /updateMaturityAuditHistoryTarget = \(\{ id, target/);
  assert.match(syncSource, /update\(patch\)\.eq\("id", id\)\.select\(\)\.single\(\)/);
  assert.match(hookSource, /async function saveMaturityTarget[\s\S]*?updateMaturityAuditHistoryTarget/);
  assert.doesNotMatch(hookSource, /upsertMaturityAuditHistory/);
  assert.match(dashboardSource, /backupRecorded/);
  assert.doesNotMatch(dashboardSource, /DUAL_STORAGE/);
});

test("rollback maturity tetap fail-closed dan mempertahankan scope canonical", () => {
  assert.match(rollbackSource, /can_access_maturity_upt/);
  assert.match(rollbackSource, /grant update \(target, updated_at, updated_by\)/);
  assert.doesNotMatch(rollbackSource, /drop function if exists public\.can_access_maturity_upt/);
  assert.doesNotMatch(rollbackSource, /drop column if exists upt_id/);
  assert.doesNotMatch(rollbackSource, /using \(true\)/);
  assert.doesNotMatch(rollbackSource, /create policy "Maturity assessments read"/);
  rollbackSource.split(/create policy /).filter(block => block.includes("can_review_maturity_uit()")).forEach(block => {
    assert.match(block, /can_access_maturity_upt\(upt_id\)/);
  });
});

test("Form 5S wajib punya backup self-host dan backfill idempoten", () => {
  assert.match(driveSource, /action === "backfill-5s"/);
  assert.match(driveSource, /storageKey\("form-5s", upt\.id/);
  assert.match(driveSource, /storageSyncedAt/);
  assert.match(driveSource, /storageStatus: "BACKUP_RECORDED"/);
  assert.match(driveSource, /Cleanup Drive 5S gagal/);
  assert.match(driveSource, /photo\?\.storagePath && photo\?\.storageSyncedAt/);
  assert.match(driveSource, /body: JSON\.stringify\(\{ trashed: true \}\)/);
  assert.doesNotMatch(driveSource, /method: "DELETE"/);
});

test("schema canonical mirror hardening maturity UIT", () => {
  assert.match(schemaSource, /MATURITY UIT HARDENING \(canonical bootstrap, 20260919\)/);
  assert.match(schemaSource, /alter table public\.maturity_assessments add column if not exists upt_id/);
  assert.match(schemaSource, /PUSAT_LEGACY_UNSCOPED/);
  assert.match(schemaSource, /create or replace function public\.can_access_maturity_upt/);
  assert.doesNotMatch(schemaSource, /actor\.role in \('ADMIN_UIT','ASMAN_LOG_UIT','MGR_LOGISTIK_UIT','HAR_UIT'\)/);
  assert.match(schemaSource, /MATURITY_REVIEW_UPT_MISMATCH/);
  assert.match(schemaSource, /maturity_aspect_reviews_pkey primary key \(audit_id, aspect_id, item_id\)/);
  assert.match(schemaSource, /final_score smallint/);
  assert.match(schemaSource, /alter table public\.maturity_5s_assessments alter column upt_id set not null/);
  assert.match(schemaSource, /maturity_assessments_upt_id_fkey/);
  ["maturity_audits", "maturity_audit_history", "maturity_5s_assessments", "maturity_aspect_reviews", "maturity_assessments"].forEach(table => {
    assert.match(schemaSource, new RegExp(`public\\.${table}`));
  });
  assert.match(schemaSource, /grant update \(target, updated_at, updated_by\) on public\.maturity_audit_history/);
});
