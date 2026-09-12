// @ts-nocheck -- Supabase Edge Function (Deno).
// DB is canonical. This function mirrors approved, allowlisted cells only.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SHEET_ID, SHEET_NAMES, buildCellChanges, columnLetter, detectHeaderRow, findSourceRow } from "./mapping.mjs";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const GOOGLE_CLIENT_ID = Deno.env.get("GOOGLE_DRIVE_CLIENT_ID") ?? "";
const GOOGLE_CLIENT_SECRET = Deno.env.get("GOOGLE_DRIVE_CLIENT_SECRET") ?? "";
const GOOGLE_REFRESH_TOKEN = Deno.env.get("GOOGLE_DRIVE_REFRESH_TOKEN") ?? "";
const ENABLED = Deno.env.get("MTU_KHS_SHEET_SYNC_ENABLED") !== "false";
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

let tokenCache = "";
let tokenExpiry = 0;
async function accessToken() {
  if (tokenCache && Date.now() < tokenExpiry) return tokenCache;
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REFRESH_TOKEN) throw Object.assign(new Error("Google OAuth belum dikonfigurasi di server."), { status: 500 });
  const response = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: GOOGLE_CLIENT_ID, client_secret: GOOGLE_CLIENT_SECRET, refresh_token: GOOGLE_REFRESH_TOKEN, grant_type: "refresh_token" }) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) throw Object.assign(new Error("Token Google tidak dapat diperbarui."), { status: 502 });
  tokenCache = data.access_token; tokenExpiry = Date.now() + Math.max(Number(data.expires_in || 3600) * 1000 - 60000, 60000); return tokenCache;
}

async function sheetsFetch(path, token, init = {}) {
  const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers || {}) } });
  if (!response.ok) { const text = await response.text().catch(() => ""); throw Object.assign(new Error(`Google Sheets API gagal (HTTP ${response.status}): ${text.slice(0, 180)}`), { status: response.status === 403 ? 403 : 502 }); }
  return response.json();
}

function canProcess(profile, record) {
  if (["SUPERADMIN", "ADMIN_LOG_PUSAT", "PENGADAAN"].includes(profile?.role)) return true;
  if (profile?.role === "ASMAN" && profile.upt_id === record.upt_id) return true;
  return profile?.role === "ASMAN_LOG_UIT" && profile.uit_id && record?.upt?.uit_id === profile.uit_id;
}

async function authorize(svc, req) {
  const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!jwt) throw Object.assign(new Error("unauthorized"), { status: 401 });
  const { data, error } = await svc.auth.getUser(jwt);
  if (error || !data?.user) throw Object.assign(new Error("invalid token"), { status: 401 });
  const { data: profile } = await svc.from("profiles").select("id,role,upt_id,uit_id").eq("id", data.user.id).single();
  if (!profile || !["SUPERADMIN", "ADMIN_LOG_PUSAT", "PENGADAAN", "ASMAN", "ASMAN_LOG_UIT"].includes(profile.role)) throw Object.assign(new Error("forbidden"), { status: 403 });
  return profile;
}

async function loadJobs(svc, body) {
  let query = svc.from("mtu_khs_sheet_sync_jobs").select("*, record:mtu_khs_records!inner(id,upt_id,procurement_year,data,sifat_pekerjaan,version,upt:upt!inner(uit_id))").in("status", ["PENDING", "FAILED", "CONFLICT"]).order("created_at", { ascending: true }).limit(Math.min(Math.max(Number(body.maxJobs || 10), 1), 50));
  if (body.jobId) query = query.eq("id", body.jobId);
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

async function validateAccess(token) {
  const meta = await sheetsFetch("?fields=sheets(properties(title))", token);
  const available = new Set((meta.sheets || []).map(item => item.properties?.title));
  const tabs = [];
  for (const title of SHEET_NAMES) {
    if (!available.has(title)) throw Object.assign(new Error(`Tab ${title} tidak ditemukan.`), { status: 422 });
    const grid = await sheetsFetch(`/values/${encodeURIComponent(title)}!A1:ZZ10?majorDimension=ROWS`, token);
    const detected = detectHeaderRow(grid.values || []);
    if (!detected.rowNumber) throw Object.assign(new Error(`Header bisnis ${title} tidak ditemukan atau ambigu (${detected.error}).`), { status: 422 });
    tabs.push({ title, headerRow: detected.rowNumber, headerCount: detected.headers.length });
  }
  return { sheetId: SHEET_ID, tabs };
}

async function inspectJob(job, token) {
  if (!SHEET_NAMES.has(job.sheet_name)) return { conflict: true, error: "Nama tab MTU tidak diizinkan." };
  const meta = await sheetsFetch("?fields=sheets(properties(title))", token);
  if (!(meta.sheets || []).some((item) => item.properties?.title === job.sheet_name)) return { conflict: true, error: `Tab ${job.sheet_name} tidak ditemukan.` };
  const range = encodeURIComponent(job.sheet_name);
  const grid = await sheetsFetch(`/values/${range}!A:ZZ?majorDimension=ROWS`, token);
  const rows = grid.values || [];
  const detected = detectHeaderRow(rows);
  if (!detected.rowNumber) return { conflict: true, error: `Header bisnis ${job.sheet_name} tidak ditemukan atau ambigu (${detected.error}).` };
  const source = findSourceRow(detected.headers, rows, job.before_data, job.source_row, job.after_data);
  if (!source.rowNumber) return { conflict: true, error: `Baris sumber ${source.method}; tidak menimpa Sheet.` };
  const row = rows[source.rowNumber - 1] || [];
  const mapped = buildCellChanges(detected.headers, row, job.before_data, job.after_data, job.patch);
  if (mapped.conflict) return { conflict: true, error: `Konflik kolom ${mapped.field}: Sheet berisi nilai berbeda.`, source, beforeSheet: { rowNumber: source.rowNumber, values: row } };
  const updates = mapped.changes.map((change) => ({ range: `${job.sheet_name}!${columnLetter(change.columnIndex)}${source.rowNumber}`, values: [[change.after]] }));
  return { conflict: false, source, updates, beforeSheet: { rowNumber: source.rowNumber, values: row }, afterSheet: { rowNumber: source.rowNumber, values: row.map((value, index) => mapped.changes.find((change) => change.columnIndex === index)?.after ?? value) } };
}

async function processJob(svc, job, dryRun) {
  const token = await accessToken();
  const inspection = await inspectJob(job, token);
  if (dryRun || inspection.conflict) return { jobId: job.id, ...inspection, dryRun: Boolean(dryRun) };
  if (!ENABLED) return { jobId: job.id, skipped: true, reason: "MTU_KHS_SHEET_SYNC_ENABLED=false" };
  const { data: claimed } = await svc.from("mtu_khs_sheet_sync_jobs").update({ status: "SYNCING", attempts: Number(job.attempts || 0) + 1, started_at: new Date().toISOString(), updated_at: new Date().toISOString(), last_error: null }).eq("id", job.id).in("status", ["PENDING", "FAILED", "CONFLICT"]).select("id").maybeSingle();
  if (!claimed) return { jobId: job.id, skipped: true, reason: "already claimed" };
  if (inspection.updates.length) await sheetsFetch("/values:batchUpdate", token, { method: "POST", body: JSON.stringify({ valueInputOption: "RAW", data: inspection.updates }) });
  await svc.from("mtu_khs_sheet_sync_jobs").update({ status: "SYNCED", before_sheet: inspection.beforeSheet, after_sheet: inspection.afterSheet, synced_at: new Date().toISOString(), updated_at: new Date().toISOString(), last_error: null }).eq("id", job.id);
  return { jobId: job.id, status: "SYNCED", updated: inspection.updates.length, source: inspection.source };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return json({ error: "server misconfigured" }, 500);
  const svc = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  try {
    const profile = await authorize(svc, req);
    const body = await req.json().catch(() => ({}));
    if (body.dryRun === true && !body.jobId) {
      const access = await validateAccess(await accessToken());
      return json({ ok: true, dryRun: true, access, jobs: [] });
    }
    const jobs = await loadJobs(svc, body);
    const allowed = jobs.filter((job) => canProcess(profile, job.record));
    if (body.jobId && !allowed.length) return json({ error: "job tidak ditemukan atau scope ditolak" }, 404);
    const result = [];
    for (const job of allowed) {
      try {
        const item = await processJob(svc, job, body.dryRun === true);
        if (item.conflict && body.dryRun !== true) await svc.from("mtu_khs_sheet_sync_jobs").update({ status: "CONFLICT", last_error: item.error, before_sheet: item.beforeSheet || {}, updated_at: new Date().toISOString() }).eq("id", job.id).in("status", ["PENDING", "FAILED", "CONFLICT"]);
        if (item.skipped && body.dryRun !== true) await svc.from("mtu_khs_sheet_sync_jobs").update({ status: "SKIPPED", last_error: item.reason, updated_at: new Date().toISOString() }).eq("id", job.id).in("status", ["PENDING", "FAILED", "CONFLICT"]);
        result.push(item);
      } catch (error) {
        const message = String(error?.message || error).slice(0, 500);
        if (body.dryRun !== true) await svc.from("mtu_khs_sheet_sync_jobs").update({ status: "FAILED", last_error: message, updated_at: new Date().toISOString() }).eq("id", job.id).in("status", ["PENDING", "FAILED", "CONFLICT", "SYNCING"]);
        result.push({ jobId: job.id, status: "FAILED", error: message });
      }
    }
    return json({ ok: true, dryRun: body.dryRun === true, jobs: result });
  } catch (error) { return json({ error: error?.message || String(error) }, error?.status || 500); }
});
