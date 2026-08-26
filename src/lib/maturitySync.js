import { supabase } from "../supabaseClient.js";
import { isDemoMode } from "./demo.js";

// Maturity memakai tabel khusus, bukan `warnoto_state` atau pola master generik.
// Kolom yang sering difilter disimpan typed; detail form tetap disimpan di `data`.
const AUDIT_STATUS = new Set(["DRAFT", "SELF_ASSESSMENT", "REVIEW_UIT", "REVISION", "REVIEW_PUSAT", "FINAL"]);
const HISTORY_STATUS = new Set(["ARSIP", "FINAL", "BERJALAN"]);
const isBinaryUrl = value => typeof value === "string" && /^(?:data|blob):/i.test(value);

// Nilai awal yang telah dikonfirmasi UPT Surabaya. Database tetap canonical;
// daftar ini hanya dipakai sebagai fallback baca saat tabel/history belum dapat
// dimuat, agar dashboard tidak kembali menampilkan angka statis di JSX.
const DEFAULT_HISTORY_UPT_ID = "UPT-SBY";
export const DEFAULT_MATURITY_AUDIT_HISTORY = Object.freeze([
  { id: "MAH-UPT-SBY-2024-S1", upt: "UPT Surabaya", uptId: DEFAULT_HISTORY_UPT_ID, tahun: 2024, semester: 1, score: 3.58, status: "ARSIP", source: "HISTORIS_TERVERIFIKASI" },
  { id: "MAH-UPT-SBY-2024-S2", upt: "UPT Surabaya", uptId: DEFAULT_HISTORY_UPT_ID, tahun: 2024, semester: 2, score: 3.74, status: "ARSIP", source: "HISTORIS_TERVERIFIKASI" },
  { id: "MAH-UPT-SBY-2025-S1", upt: "UPT Surabaya", uptId: DEFAULT_HISTORY_UPT_ID, tahun: 2025, semester: 1, score: 3.86, status: "FINAL", source: "HISTORIS_TERVERIFIKASI" },
  { id: "MAH-UPT-SBY-2025-S2", upt: "UPT Surabaya", uptId: DEFAULT_HISTORY_UPT_ID, tahun: 2025, semester: 2, score: 4.12, status: "FINAL", source: "HISTORIS_TERVERIFIKASI" },
  { id: "MAH-UPT-SBY-2026-S1", upt: "UPT Surabaya", uptId: DEFAULT_HISTORY_UPT_ID, tahun: 2026, semester: 1, score: 4.26, status: "BERJALAN", source: "HISTORIS_TERVERIFIKASI" },
]);

// Fallback ini milik SATU UPT saja. Tanpa scoping, user UPT lain akan melihat
// angka UPT Surabaya sebagai angkanya sendiri ketika load DB gagal — jadi UPT
// lain (termasuk pemanggil tanpa argumen) sengaja dapat daftar kosong.
export const getDefaultMaturityAuditHistory = uptId =>
  uptId === DEFAULT_HISTORY_UPT_ID ? DEFAULT_MATURITY_AUDIT_HISTORY.map(item => ({ ...item })) : [];
// Legacy localStorage records may carry usernames/old app IDs in fields that
// now target UUID foreign-key columns. Keep the original value in `data`, but
// only send canonical UUIDs to Postgres so one malformed record cannot abort a
// whole migration batch.
const asOptionalUuid = value => {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(normalized)
    ? normalized
    : null;
};

const asEpoch = (value, fallback = null) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};
const periodKeyFor = value => {
  const date = new Date(asEpoch(value, Date.now()));
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
};

function assessmentRowToItem(row) {
  return {
    ...(row.data || {}),
    id: row.id,
    createdAt: asEpoch(row.created_at, row.data?.createdAt),
    createdBy: row.created_by ?? row.data?.createdBy ?? null,
    tanggalAsesmen: asEpoch(row.assessment_at, row.data?.tanggalAsesmen),
    createdBy: row.created_by ?? row.data?.createdBy ?? null,
  };
}

function auditRowToItem(row) {
  return {
    ...(row.data || {}),
    id: row.id,
    upt: row.upt ?? row.data?.upt ?? "UPT Surabaya",
    uptId: row.upt_id ?? row.data?.uptId ?? null,
    status: row.status ?? row.data?.status ?? "DRAFT",
    level: row.level ?? row.data?.level ?? 1,
    score: Number(row.score ?? row.data?.score ?? 1),
    periodKey: row.period_key ?? row.data?.periodKey ?? periodKeyFor(row.created_at ?? row.data?.createdAt),
    createdAt: asEpoch(row.created_at, row.data?.createdAt),
    updatedAt: asEpoch(row.updated_at, row.data?.updatedAt),
    updatedBy: row.updated_by ?? row.data?.updatedBy ?? null,
  };
}

function auditHistoryRowToItem(row) {
  return {
    id: row.id,
    upt: row.upt || "UPT Surabaya",
    uptId: row.upt_id ?? null,
    tahun: Number(row.tahun),
    semester: Number(row.semester),
    score: Number(row.score),
    status: HISTORY_STATUS.has(row.status) ? row.status : "ARSIP",
    source: row.source || "HISTORIS_TERVERIFIKASI",
    notes: row.notes || "",
    createdAt: asEpoch(row.created_at),
    updatedAt: asEpoch(row.updated_at),
    updatedBy: row.updated_by ?? null,
  };
}

function maturity5SRowToItem(row) {
  return {
    id: row.id,
    upt: row.upt || "UPT Surabaya",
    uptId: row.upt_id ?? null,
    gudangId: row.gudang_id || "",
    gudangNama: row.gudang_nama || "",
    bulan: Number(row.bulan),
    tahun: Number(row.tahun),
    auditor: row.auditor || "",
    checklist: Array.isArray(row.checklist) ? row.checklist : [],
    samplePhotos: Array.isArray(row.sample_photos) ? row.sample_photos : [],
    totalItems: Number(row.total_items) || 0,
    totalChecked: Number(row.total_checked) || 0,
    scorePercent: Number(row.score_percent) || 0,
    catatan: row.catatan || "",
    createdAt: asEpoch(row.created_at),
    createdBy: row.created_by ?? null,
  };
}

function assessmentItemToRow(item) {
  return {
    id: item.id,
    data: item,
    created_at: asEpoch(item.createdAt, Date.now()),
    assessment_at: asEpoch(item.tanggalAsesmen, Date.now()),
    level: Math.min(5, Math.max(1, Number(item.level) || 1)),
    created_by: asOptionalUuid(item.createdBy),
  };
}

function auditItemToRow(item) {
  const status = AUDIT_STATUS.has(item.status) ? item.status : "DRAFT";
  const evidence = Object.fromEntries(Object.entries(item.evidence || {}).map(([aspectId, files]) => [
    aspectId,
    Array.isArray(files) ? files.filter(file => !isBinaryUrl(file?.url)) : [],
  ]));
  const data = { ...item, evidence, fileUrl: isBinaryUrl(item.fileUrl) ? "" : (item.fileUrl || "") };
  return {
    id: item.id,
    data,
    created_at: asEpoch(item.createdAt, Date.now()),
    updated_at: asEpoch(item.updatedAt, Date.now()),
    upt: item.upt || "UPT Surabaya",
    upt_id: item.uptId || null,
    period_key: /^\d{4}-(0[1-9]|1[0-2])$/.test(item.periodKey || "") ? item.periodKey : periodKeyFor(item.createdAt),
    status,
    level: Math.min(5, Math.max(1, Number(item.level) || 1)),
    score: Math.min(5, Math.max(0, Number(item.score) || 1)),
    updated_by: asOptionalUuid(item.updatedBy),
    created_by: asOptionalUuid(item.createdBy),
  };
}

function auditHistoryItemToRow(item) {
  return {
    id: item.id,
    upt: item.upt || "UPT Surabaya",
    // NOT NULL + FK ke upt(id) sejak GELOMBANG A. Jangan pernah dipaksa jadi
    // string kosong: biarkan server menolak baris tanpa UPT.
    upt_id: item.uptId || null,
    tahun: Number(item.tahun),
    semester: Number(item.semester),
    score: Math.min(5, Math.max(0, Number(item.score) || 0)),
    status: HISTORY_STATUS.has(item.status) ? item.status : "ARSIP",
    source: item.source || "HISTORIS_TERVERIFIKASI",
    notes: item.notes || "",
    created_at: asEpoch(item.createdAt, Date.now()),
    updated_at: asEpoch(item.updatedAt, Date.now()),
    updated_by: asOptionalUuid(item.updatedBy),
  };
}

function maturity5SItemToRow(item) {
  return {
    id: item.id,
    upt: item.upt || "UPT Surabaya",
    // Wajib terisi setelah GELOMBANG B (kolom NOT NULL + RLS per-UPT); dikirim
    // apa adanya supaya baris tanpa UPT ditolak server, bukan diam-diam masuk.
    upt_id: item.uptId || null,
    gudang_id: item.gudangId || null,
    gudang_nama: item.gudangNama || "",
    bulan: Math.min(12, Math.max(1, Number(item.bulan) || 1)),
    tahun: Math.min(2100, Math.max(2000, Number(item.tahun) || new Date().getFullYear())),
    auditor: item.auditor || "",
    checklist: Array.isArray(item.checklist) ? item.checklist : [],
    sample_photos: Array.isArray(item.samplePhotos) ? item.samplePhotos.filter(photo => !isBinaryUrl(photo?.url)) : [],
    total_items: Math.max(0, Number(item.totalItems) || 0),
    total_checked: Math.max(0, Number(item.totalChecked) || 0),
    score_percent: Math.min(100, Math.max(0, Number(item.scorePercent) || 0)),
    catatan: item.catatan || "",
    created_at: asEpoch(item.createdAt, Date.now()),
    created_by: asOptionalUuid(item.createdBy),
  };
}

async function loadRows(table, mapRow) {
  if (!supabase) return null;
  const { data, error } = await supabase.from(table).select("*");
  if (error) {
    console.error(`load ${table}: ${error.message}`, error);
    return null;
  }
  return data.map(mapRow);
}

async function upsertRow(table, row) {
  if (isDemoMode()) return true;
  if (!supabase) return false;
  const { error } = await supabase.from(table).upsert(row, { onConflict: "id" });
  if (error) {
    console.error(`upsert ${table}: ${error.message}`, error);
    return false;
  }
  return true;
}

async function upsertRows(table, rows) {
  if (isDemoMode()) return true;
  if (!supabase || rows.length === 0) return rows.length === 0;
  const { error } = await supabase.from(table).upsert(rows, { onConflict: "id" });
  if (error) {
    console.error(`upsert ${table}: ${error.message}`, error);
    return false;
  }
  return true;
}

// RLS yang tidak punya policy DELETE TIDAK melempar error: PostgREST balas 200
// dengan 0 baris terhapus. Tanpa `.select()` penghapusan yang ditolak akan
// terlihat sukses dan barisnya hilang dari UI padahal masih ada di server.
async function deleteRow(table, id) {
  if (isDemoMode()) return true;
  if (!supabase) return false;
  const { data, error } = await supabase.from(table).delete().eq("id", id).select("id");
  if (error) {
    console.error(`delete ${table}: ${error.message}`, error);
    return false;
  }
  if (!data || data.length === 0) {
    console.error(`delete ${table}: ditolak server (0 baris terhapus, id=${id})`);
    return false;
  }
  return true;
}

async function insertRow(table, row, mapRow) {
  if (isDemoMode()) return mapRow(row);
  if (!supabase) return null;
  const { data, error } = await supabase.from(table).insert(row).select().single();
  if (error) {
    console.error(`insert ${table}: ${error.message}`, error);
    return null;
  }
  return mapRow(data);
}

export const loadMaturityAssessments = () => loadRows("maturity_assessments", assessmentRowToItem);
export const loadMaturityAudits = () => loadRows("maturity_audits", auditRowToItem);
export const loadMaturityAuditHistory = () => loadRows("maturity_audit_history", auditHistoryRowToItem);
export const loadMaturity5SAssessments = () => loadRows("maturity_5s_assessments", maturity5SRowToItem);
export const upsertMaturityAssessment = item => upsertRow("maturity_assessments", assessmentItemToRow(item));
export const upsertMaturityAudit = item => upsertRow("maturity_audits", auditItemToRow(item));
// Riwayat semester tidak punya form input manual — baris terbit dari audit FINAL
// yang sudah disetujui. Writer ini disediakan untuk rantai approval itu.
export const upsertMaturityAuditHistory = item => upsertRow("maturity_audit_history", auditHistoryItemToRow(item));
export const upsertMaturityAssessments = items => upsertRows("maturity_assessments", items.map(assessmentItemToRow));
export const upsertMaturityAudits = items => upsertRows("maturity_audits", items.map(auditItemToRow));
export const deleteMaturityAssessment = id => deleteRow("maturity_assessments", id);
export const deleteMaturityAuditRow = id => deleteRow("maturity_audits", id);
// Form 5S adalah riwayat append-only: gunakan insert, bukan upsert, agar
// inspeksi berulang pada periode yang sama tetap dapat diaudit.
export const insertMaturity5SAssessment = item => insertRow("maturity_5s_assessments", maturity5SItemToRow(item), maturity5SRowToItem);

// ─── Review paralel per-aspek (UIT Check/Reject sebelum UPT selesai semua aspek) ───
function aspectReviewRowToItem(row) {
  return {
    auditId: row.audit_id,
    aspectId: row.aspect_id,
    itemId: row.item_id,
    uptId: row.upt_id,
    state: row.state || "PENDING",
    note: row.note || "",
    reviewedBy: row.reviewed_by ?? null,
    reviewedAt: asEpoch(row.reviewed_at),
  };
}

export async function loadAspectReviews(auditId) {
  if (!supabase || !auditId) return [];
  const { data, error } = await supabase.from("maturity_aspect_reviews").select("*").eq("audit_id", auditId);
  if (error) {
    console.error(`load maturity_aspect_reviews: ${error.message}`, error);
    return [];
  }
  return (data || []).map(aspectReviewRowToItem);
}

export async function upsertAspectReview({ auditId, aspectId, itemId, uptId, state, note, reviewedBy }) {
  if (isDemoMode()) return true;
  if (!supabase) return null;
  const row = {
    audit_id: auditId,
    aspect_id: aspectId,
    item_id: itemId,
    upt_id: uptId || null,
    state,
    note: note || "",
    reviewed_by: reviewedBy || null,
    reviewed_at: Date.now(),
  };
  const { data, error } = await supabase.from("maturity_aspect_reviews").upsert(row, { onConflict: "audit_id,aspect_id,item_id" }).select().single();
  if (error) {
    console.error(`upsert maturity_aspect_reviews: ${error.message}`, error);
    return null;
  }
  return aspectReviewRowToItem(data);
}
