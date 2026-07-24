import { supabase } from "../supabaseClient.js";
import { isDemoMode } from "./demo.js";

// Maturity memakai tabel khusus, bukan `warnoto_state` atau pola master generik.
// Kolom yang sering difilter disimpan typed; detail form tetap disimpan di `data`.
const AUDIT_STATUS = new Set(["DRAFT", "SELF_ASSESSMENT", "REVIEW_UIT", "REVISION", "FINAL"]);
const isBinaryUrl = value => typeof value === "string" && /^(?:data|blob):/i.test(value);
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

function assessmentRowToItem(row) {
  return {
    ...(row.data || {}),
    id: row.id,
    createdAt: asEpoch(row.created_at, row.data?.createdAt),
    tanggalAsesmen: asEpoch(row.assessment_at, row.data?.tanggalAsesmen),
    createdBy: row.created_by ?? row.data?.createdBy ?? null,
  };
}

function auditRowToItem(row) {
  return {
    ...(row.data || {}),
    id: row.id,
    upt: row.upt ?? row.data?.upt ?? "UPT Surabaya",
    status: row.status ?? row.data?.status ?? "DRAFT",
    level: row.level ?? row.data?.level ?? 1,
    createdAt: asEpoch(row.created_at, row.data?.createdAt),
    updatedAt: asEpoch(row.updated_at, row.data?.updatedAt),
    updatedBy: row.updated_by ?? row.data?.updatedBy ?? null,
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
    status,
    level: Math.min(5, Math.max(1, Number(item.level) || 1)),
    updated_by: asOptionalUuid(item.updatedBy),
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

async function deleteRow(table, id) {
  if (isDemoMode()) return true;
  if (!supabase) return false;
  const { error } = await supabase.from(table).delete().eq("id", id);
  if (error) {
    console.error(`delete ${table}: ${error.message}`, error);
    return false;
  }
  return true;
}

export const loadMaturityAssessments = () => loadRows("maturity_assessments", assessmentRowToItem);
export const loadMaturityAudits = () => loadRows("maturity_audits", auditRowToItem);
export const upsertMaturityAssessment = item => upsertRow("maturity_assessments", assessmentItemToRow(item));
export const upsertMaturityAudit = item => upsertRow("maturity_audits", auditItemToRow(item));
export const upsertMaturityAssessments = items => upsertRows("maturity_assessments", items.map(assessmentItemToRow));
export const upsertMaturityAudits = items => upsertRows("maturity_audits", items.map(auditItemToRow));
export const deleteMaturityAssessment = id => deleteRow("maturity_assessments", id);
export const deleteMaturityAuditRow = id => deleteRow("maturity_audits", id);
