import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const edge = readFileSync(new URL("../../supabase/functions/maturity-drive/index.ts", import.meta.url), "utf8");
const client = readFileSync(new URL("../../src/lib/maturityDrive.js", import.meta.url), "utf8");
const editor = readFileSync(new URL("../../src/components/MaturityAuditSystem.jsx", import.meta.url), "utf8");
const hook = readFileSync(new URL("../../src/hooks/useMaturity.jsx", import.meta.url), "utf8");
const delta = readFileSync(new URL("../../supabase/migrations/20260802_maturity_drive_security_delta.sql", import.meta.url), "utf8");

test("maturity Drive derives scope canonically and assigns only recorded unassigned files", () => {
  assert.match(edge, /resolveAuditContext\(body, ctx/);
  assert.match(edge, /findUptById\(existing\.upt_id\)/);
  assert.ok(edge.includes("profile.uit_id !== upt.uitId"));
  assert.ok(edge.includes("const unassignedId = text(body.unassignedId)"));
  assert.ok(!edge.includes("const driveFileId = text(body.driveFileId)"));
  assert.ok(edge.includes('.eq("id", unassignedId).eq("audit_id", auditId).eq("upt_id", context.upt.id)'));
  assert.ok(edge.includes('eq("drive_file_id", unassigned.drive_file_id)'));
  assert.match(edge, /assignment_state: "ASSIGNING"/);
  assert.match(edge, /assignment_state: "NEEDS_REPAIR"/);
  assert.match(edge, /includeRoot: ctx\.profile\.role === "SUPERADMIN"/);
  assert.match(edge, /row\.source_folder_id === DRIVE_ROOT_ID && !includeRoot/);
  assert.match(edge, /function assertMutableAudit/);
  assert.match(edge, /audit\?\.status === "FINAL"/);
  assert.match(edge, /reconcileAssignments/);
});

test("maturity evidence allows supported formats and rejects ZIP/RAR/EXE", () => {
  assert.match(client, /ALLOWED_MIME = new Set\(\["application\/pdf"/);
  assert.match(client, /IMAGE_EXT = \/\\\.\(jpg\|jpeg\|png\|webp\|heic\|heif\|gif\|bmp\)\$\/i/);
  assert.match(client, /FORBIDDEN_MIME = new Set\(\["application\/zip"/);
  assert.match(client, /FORBIDDEN_EXT = \/\(\?:\^\|\\\.\).*zip\|rar\|exe/);
  assert.match(edge, /IMAGE_EXT = \/\\\.\(jpg\|jpeg\|png\|webp\|heic\|heif\|gif\|bmp\)\$\/i/);
  assert.match(edge, /FORBIDDEN_MIME = new Set\(\[[\s\S]*application\/zip/);
  assert.match(edge, /FORBIDDEN_EXT = \/\(\?:\^\|\\\.\).*zip\|rar\|exe/);
  assert.doesNotMatch(editor, /accept="[^"]*\\.(zip|rar|exe)/i);
});

test("audit evidence keeps its original bytes while Form 5S stays compressed", () => {
  assert.match(client, /uploadMaturityDriveEvidence[\s\S]*file = await prepareMaturityUpload\(file\)/);
  assert.match(client, /uploadForm5SPhoto[\s\S]*file = await prepareMaturityUpload\(file\)/);
  assert.doesNotMatch(client, /MAX_EVIDENCE_BYTES|compressPdf/);
  assert.match(client, /return file;\s*}\s*async function request/);
  assert.match(client, /imageFileFromDataUrl/);
  assert.match(client, /MAX_FORM5S_BYTES = 2 \* 1024 \* 1024/);
  assert.match(client, /MAX_FORM5S_SOURCE_BYTES = 25 \* 1024 \* 1024/);
});

test("server has no audit upload size cap and keeps Sheet export limit", () => {
  assert.doesNotMatch(edge, /MAX_UPLOAD_BYTES|file\.size <=/);
  assert.match(edge, /const MAX_EXPORT_BYTES = 25 \* 1024 \* 1024/);
  assert.match(edge, /approxBytes > MAX_EXPORT_BYTES/);
});

test("viewer memuat ulang evidence canonical dan tidak fallback setelah sign error", () => {
  assert.match(client, /export const loadMaturityDriveEvidence = auditId => request\("sync", \{ auditId, scanDrive: false \}\)/);
  assert.match(client, /const signed = await signMaturityDriveEvidence\(evidenceId\)/);
  assert.doesNotMatch(client, /catch \{ \/\* fallback ke download di bawah \*\//);
  assert.match(hook, /reconcileMaturityAuditEvidence\(assessments, result\?\.evidence \|\| \[\]\)/);
  assert.match(hook, /const evidenceRequestId = \+\+maturityEvidenceRequestRef\.current/);
  assert.match(hook, /if \(evidenceRequestId !== maturityEvidenceRequestRef\.current\) return/);
  assert.match(hook, /Gagal memuat evidence aktif\. Buka ulang audit/);
  assert.doesNotMatch(hook, /_maturityEvidenceLoading: false \}\)\);\n        \}\);/);
  assert.match(editor, /maturityEvidenceLoading/);
  assert.match(editor, /disabled=\{maturityEvidenceLoading \|\| maturityAuditSaving/);
});

test("maturity Drive security delta makes audit stub and ownership canonical", () => {
  assert.match(delta, /add column if not exists upt_id/);
  assert.match(delta, /add column if not exists created_by/);
  assert.match(delta, /idx_maturity_audits_upt_id_period_key/);
  assert.match(delta, /create_maturity_drive_stub/);
  assert.match(delta, /security definer/);
  assert.match(delta, /maturity_audit_drive_unassigned/);
  assert.match(delta, /ASSIGNING', 'ACTIVE', 'NEEDS_REPAIR/);
});
