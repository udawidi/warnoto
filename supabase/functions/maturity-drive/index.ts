// @ts-nocheck -- Supabase Edge Functions run on Deno, not the Vite runtime.
// Binary evidence is kept in Google Drive.  This function is the only bridge
// allowed to use Drive OAuth credentials; browser code receives no Drive secret.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const DRIVE_ROOT_ID = Deno.env.get("GOOGLE_DRIVE_MATURITY_ROOT_ID") ?? "13FFto2pzVRLq4LBpRaJsIyGa2Bk5gaYD";
const GOOGLE_CLIENT_ID = Deno.env.get("GOOGLE_DRIVE_CLIENT_ID") ?? "";
const GOOGLE_CLIENT_SECRET = Deno.env.get("GOOGLE_DRIVE_CLIENT_SECRET") ?? "";
const GOOGLE_REFRESH_TOKEN = Deno.env.get("GOOGLE_DRIVE_REFRESH_TOKEN") ?? "";
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const ALLOWED_MIME = new Set([
  "application/pdf", "application/zip", "application/x-rar-compressed", "application/vnd.rar",
  "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/plain", "text/csv",
]);
// Selaras hirarki resmi 2026-08-02 dan jenjang review Maturity:
// UPT menulis lewat ADMIN/TL saja (ASMAN & MANAGER read-only), peninjau UIT dan
// Pusat juga perlu menulis karena mereka mengoreksi evidence saat review.
const WRITER_ROLES = new Set([
  "ADMIN", "TL",
  "ADMIN_UIT", "ASMAN_LOG_UIT", "MGR_LOGISTIK_UIT",
  "ADMIN_LOG_PUSAT", "SUPERADMIN",
]);
// Lingkup nasional: bebas UPT dan UIT. ADMIN_LOG_PUSAT TIDAK boleh dimasukkan ke
// UIT_ROLES — branch itu mewajibkan uit_id profil cocok dengan UIT milik UPT,
// sedangkan akun Pusat tidak punya uit_id, jadi justru akan ditolak 403.
const NATIONAL_ROLES = new Set(["SUPERADMIN", "ADMIN_LOG_PUSAT"]);
const UIT_ROLES = new Set(["ADMIN_UIT", "ASMAN_LOG_UIT", "MGR_LOGISTIK_UIT"]);
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Expose-Headers": "X-File-Name, Content-Disposition",
};
const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
function nowMs() { return Date.now(); }
function text(value: unknown, max = 220) { return String(value ?? "").trim().slice(0, max); }
function safeName(value: unknown, fallback: string) {
  const result = text(value, 120).replace(/[\\/:*?"<>|]/g, "-").replace(/\s+/g, " ").trim();
  return result || fallback;
}
function parseJson(value: unknown, fallback: any = {}) {
  if (typeof value !== "string") return value ?? fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}
function quoteDrive(value: string) { return value.replace(/'/g, "\\'"); }
function periodFor(value?: unknown) {
  const date = value ? new Date(Number(value)) : new Date();
  const valid = Number.isNaN(date.getTime()) ? new Date() : date;
  const months = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit" }).formatToParts(valid);
  const year = Number(parts.find(part => part.type === "year")?.value);
  const month = Number(parts.find(part => part.type === "month")?.value) - 1;
  return { key: `${year}-${String(month + 1).padStart(2, "0")}`, label: `${String(month + 1).padStart(2, "0")} - ${months[month]} ${year}` };
}
function periodFromKey(value?: unknown) {
  const match = /^([0-9]{4})-(0[1-9]|1[0-2])$/.exec(text(value, 7));
  if (!match) return null;
  return periodFor(Date.UTC(Number(match[1]), Number(match[2]) - 1, 15));
}
function fileAllowed(file: File) {
  const mime = text(file.type, 120).toLowerCase();
  const image = mime.startsWith("image/");
  const extensionOk = /\.(pdf|doc|docx|xls|xlsx|zip|rar|txt|csv)$/i.test(file.name || "");
  return file.size > 0 && file.size <= MAX_FILE_BYTES && (image || ALLOWED_MIME.has(mime) || extensionOk);
}
// Access token valid ~1 jam; cache di scope modul (isolate) supaya tidak tukar
// refresh-token ke Google tiap driveFetch — satu sync bisa puluhan panggilan Drive.
let cachedDriveToken = "";
let cachedDriveTokenExpiry = 0;
async function driveToken() {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REFRESH_TOKEN) {
    throw new Error("Google Drive belum dikonfigurasi. Lengkapi secret OAuth server-side terlebih dahulu.");
  }
  if (cachedDriveToken && nowMs() < cachedDriveTokenExpiry) return cachedDriveToken;
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: GOOGLE_CLIENT_ID, client_secret: GOOGLE_CLIENT_SECRET, refresh_token: GOOGLE_REFRESH_TOKEN, grant_type: "refresh_token" }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) throw new Error("Token Google Drive tidak dapat diperbarui.");
  cachedDriveToken = data.access_token as string;
  cachedDriveTokenExpiry = nowMs() + (Number(data.expires_in) > 0 ? Number(data.expires_in) * 1000 : 3600000) - 60000; // buffer 60s
  return cachedDriveToken;
}
async function driveFetch(path: string, init: RequestInit = {}) {
  const token = await driveToken();
  const url = path.startsWith("http") ? path : `https://www.googleapis.com/drive/v3${path}`;
  const response = await fetch(url, {
    ...init, headers: { Authorization: `Bearer ${token}`, ...(init.headers || {}) },
  });
  if (!response.ok) {
    const error = await response.text().catch(() => "");
    throw new Error(`Google Drive menolak permintaan (${response.status}): ${error.slice(0, 180)}`);
  }
  return response;
}
async function driveJson(path: string, init: RequestInit = {}) { return (await driveFetch(path, init)).json(); }
async function authContext(req: Request) {
  const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!jwt) throw Object.assign(new Error("Tidak ada sesi login."), { status: 401 });
  const { data: userData, error } = await admin.auth.getUser(jwt);
  if (error || !userData?.user) throw Object.assign(new Error("Sesi login tidak valid."), { status: 401 });
  const { data: profile } = await admin.from("profiles").select("id,role,upt_id,uit_id").eq("id", userData.user.id).single();
  if (!profile) throw Object.assign(new Error("Profil pengguna tidak ditemukan."), { status: 403 });
  return { user: userData.user, profile };
}
async function findUptByName(name: string) {
  const { data, error } = await admin.from("upt").select("id,uit_id,data").eq("data->>nama", name).maybeSingle();
  if (error || !data) throw Object.assign(new Error("UPT target tidak ditemukan."), { status: 404 });
  return { id: data.id, uitId: data.uit_id, name: data.data?.nama || name };
}
async function findUptById(id: string) {
  const { data, error } = await admin.from("upt").select("id,uit_id,data").eq("id", id).maybeSingle();
  if (error || !data) throw Object.assign(new Error("UPT audit canonical tidak ditemukan."), { status: 404 });
  return { id: data.id, uitId: data.uit_id, name: data.data?.nama || "" };
}
async function assertUptAccess(ctx: any, upt: any, write = false) {
  if (write && !WRITER_ROLES.has(ctx.profile.role)) throw Object.assign(new Error("Role Anda tidak berwenang mengubah evidence Maturity."), { status: 403 });
  if (NATIONAL_ROLES.has(ctx.profile.role)) return;
  if (UIT_ROLES.has(ctx.profile.role)) {
    if (!ctx.profile.uit_id || ctx.profile.uit_id !== upt.uitId) throw Object.assign(new Error("Role UIT hanya dapat mengakses UPT pada UIT sendiri."), { status: 403 });
    return;
  }
  if (!ctx.profile.upt_id || upt.id !== ctx.profile.upt_id) {
    throw Object.assign(new Error("Evidence hanya dapat diakses pada UPT pengguna sendiri."), { status: 403 });
  }
}
function assertMutableAudit(audit: any) {
  if (audit?.status === "FINAL") {
    throw Object.assign(new Error("Audit FINAL tidak dapat mengubah evidence."), { status: 409 });
  }
}
async function resolveAuditContext(body: any, ctx: any, { createDraft = false } = {}) {
  const auditId = text(body.auditId, 100);
  if (!auditId) throw new Error("auditId wajib diisi.");
  const { data: existing, error } = await admin.from("maturity_audits").select("id,upt,upt_id,status,created_at,period_key,score,created_by,updated_by").eq("id", auditId).maybeSingle();
  if (error) throw new Error(`Audit Maturity tidak dapat dibaca: ${error.message}`);
  if (existing) {
    const upt = await findUptById(existing.upt_id);
    if (body.upt && text(body.upt) !== existing.upt) throw Object.assign(new Error("UPT request tidak cocok dengan audit canonical."), { status: 409 });
    return { audit: existing, upt, isDraftStub: false };
  }
  if (!createDraft) throw Object.assign(new Error("Audit Maturity tidak ditemukan."), { status: 404 });
  if (!/^MA-[A-Za-z0-9_-]{4,100}$/.test(auditId)) throw Object.assign(new Error("ID draft audit tidak valid."), { status: 400 });
  const requestedUpt = text(body.upt, 120);
  if (!requestedUpt) throw new Error("UPT wajib diisi untuk membuat draft audit.");
  const upt = await findUptByName(requestedUpt);
  await assertUptAccess(ctx, upt, true);
  const createdAt = Number(body.auditCreatedAt);
  const timestamp = Number.isFinite(createdAt) && createdAt > 0 ? createdAt : nowMs();
  const period = periodFor(timestamp);
  const { data: rows, error: rpcError } = await admin.rpc("create_maturity_drive_stub", { p_audit_id: auditId, p_upt_id: upt.id, p_period_key: period.key, p_created_at: timestamp, p_actor_id: ctx.user.id });
  if (rpcError) throw Object.assign(new Error(rpcError.code === "23505" ? `UPT ini sudah memiliki audit Maturity untuk periode ${period.key}.` : `Draft audit tidak dapat dibuat: ${rpcError.message}`), { status: rpcError.code === "23505" ? 409 : 500 });
  const audit = rows?.[0];
  if (!audit) throw new Error("Draft audit tidak dapat dibuat.");
  return { audit, upt, isDraftStub: true };
}
async function event(auditId: string, eventType: string, actorId: string, eventData: any) {
  const { error } = await admin.from("maturity_audit_events").insert({ audit_id: auditId, event_type: eventType, actor_id: actorId, event_data: eventData, created_at: nowMs() });
  if (error) throw new Error(`Audit event tidak tersimpan: ${error.message}`);
}
async function getFolder(mappingKey: string) {
  const { data } = await admin.from("maturity_audit_drive_folders").select("*").eq("mapping_key", mappingKey).maybeSingle();
  return data;
}
// Two+ folders can end up tagged with the same mapping key when concurrent
// uploads race ensureFolder's cache-miss (see consolidateFolders). Pure so it
// can be unit-tested without a Drive round-trip.
function chooseFolderMerge(foundIds: string[], dbId: string | null | undefined) {
  const keep = dbId && foundIds.includes(dbId) ? dbId : foundIds[0];
  const extras = foundIds.filter((id) => id !== keep);
  return { keep, extras };
}
// Moves every child of the extra folders into the kept folder, then trashes
// the extras. Idempotent — an empty extras list is a no-op.
async function mergeFolderGroup(keepId: string, extraIds: string[]) {
  for (const extraId of extraIds) {
    if (!extraId || extraId === keepId) continue;
    for (const child of await listChildren(extraId)) {
      await driveJson(`/files/${encodeURIComponent(child.id)}?addParents=${encodeURIComponent(keepId)}&removeParents=${encodeURIComponent(extraId)}&fields=id&supportsAllDrives=true`, { method: "PATCH" });
    }
    await driveJson(`/files/${encodeURIComponent(extraId)}?supportsAllDrives=true`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ trashed: true }) });
  }
}
// Merges duplicate Drive folders sharing a mapping key. Idempotent —
// found.length <= 1 is a no-op.
async function consolidateFolders(mappingKey: string, dbId: string | null | undefined) {
  const q = encodeURIComponent(`mimeType = 'application/vnd.google-apps.folder' and trashed = false and appProperties has { key='warnoto_maturity_key' and value='${quoteDrive(mappingKey)}' }`);
  const found = await driveJson(`/files?q=${q}&fields=files(id,name)&pageSize=100&supportsAllDrives=true&includeItemsFromAllDrives=true`);
  const ids = (found.files || []).map((f: any) => f.id);
  if (ids.length <= 1) return ids[0] || dbId;
  const { keep, extras } = chooseFolderMerge(ids, dbId);
  await mergeFolderGroup(keep, extras);
  return keep;
}
// One Drive query for every maturity folder tagged under the app root,
// grouped by mapping key, merging duplicates scoped to this UPT/period.
// Idempotent — groups with <= 1 folder are skipped.
async function healDuplicateFolders(upt: any, period: any) {
  const prefix = `maturity-v1:${period.key}:${upt.name}`;
  const q = encodeURIComponent(`mimeType = 'application/vnd.google-apps.folder' and trashed = false and appProperties has { key='warnoto_maturity_root' and value='${quoteDrive(DRIVE_ROOT_ID)}' }`);
  const groups = new Map<string, string[]>();
  let pageToken = "";
  do {
    const page = await driveJson(`/files?q=${q}&fields=nextPageToken,files(id,appProperties)&pageSize=1000&supportsAllDrives=true&includeItemsFromAllDrives=true${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`);
    for (const f of page.files || []) {
      const key = f.appProperties?.warnoto_maturity_key;
      if (!key || !key.startsWith(prefix)) continue;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(f.id);
    }
    pageToken = page.nextPageToken || "";
  } while (pageToken);
  for (const [mappingKey, ids] of groups) {
    if (ids.length <= 1) continue;
    const { data: dbRow } = await admin.from("maturity_audit_drive_folders").select("drive_folder_id").eq("mapping_key", mappingKey).maybeSingle();
    const { keep, extras } = chooseFolderMerge(ids, dbRow?.drive_folder_id);
    await mergeFolderGroup(keep, extras);
    await admin.from("maturity_audit_drive_folders").update({ drive_folder_id: keep, updated_at: nowMs() }).eq("mapping_key", mappingKey);
  }
}
async function ensureFolder(input: any) {
  const cached = await getFolder(input.mappingKey);
  if (cached?.drive_folder_id) return cached;
  const q = encodeURIComponent(`mimeType = 'application/vnd.google-apps.folder' and trashed = false and '${quoteDrive(input.parentFolderId)}' in parents and appProperties has { key='warnoto_maturity_key' and value='${quoteDrive(input.mappingKey)}' }`);
  const found = await driveJson(`/files?q=${q}&fields=files(id,name,parents)&pageSize=10&supportsAllDrives=true&includeItemsFromAllDrives=true`);
  let driveFolderId = (found.files?.length || 0) > 1
    ? await consolidateFolders(input.mappingKey, found.files[0].id)
    : found.files?.[0]?.id;
  if (!driveFolderId) {
    const metadata = { name: input.name, mimeType: "application/vnd.google-apps.folder", parents: [input.parentFolderId], appProperties: { warnoto_maturity_key: input.mappingKey, warnoto_maturity_root: DRIVE_ROOT_ID } };
    const created = await driveJson("/files?fields=id,name,parents&supportsAllDrives=true", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(metadata) });
    driveFolderId = created.id;
  }
  const row = { mapping_key: input.mappingKey, audit_id: null, period_key: input.periodKey, folder_type: input.folderType, parent_mapping_key: input.parentMappingKey || null, drive_folder_id: driveFolderId, drive_root_id: DRIVE_ROOT_ID, metadata: input.metadata || {}, created_at: nowMs(), updated_at: nowMs() };
  const { data, error } = await admin.from("maturity_audit_drive_folders").upsert(row, { onConflict: "mapping_key" }).select().single();
  if (error) throw new Error(`Metadata folder tidak tersimpan: ${error.message}`);
  return data;
}
// Tags the configured My Drive root once with the stable mapping key and
// persists its ID locally. Shared by ensureTree and the Form5S upload path
// so neither duplicates the root-init logic.
async function ensureRoot() {
  let root = await getFolder("maturity-v1:root");
  if (root) return root;
  const configuredRoot = await driveJson(`/files/${encodeURIComponent(DRIVE_ROOT_ID)}?fields=id,appProperties&supportsAllDrives=true`);
  await driveJson(`/files/${encodeURIComponent(DRIVE_ROOT_ID)}?fields=id,appProperties&supportsAllDrives=true`, {
    method: "PATCH", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ appProperties: { ...(configuredRoot.appProperties || {}), warnoto_maturity_key: "maturity-v1:root", warnoto_maturity_root: DRIVE_ROOT_ID } }),
  });
  const { data, error } = await admin.from("maturity_audit_drive_folders").upsert({ mapping_key: "maturity-v1:root", audit_id: null, period_key: null, folder_type: "ROOT", parent_mapping_key: null, drive_folder_id: DRIVE_ROOT_ID, drive_root_id: DRIVE_ROOT_ID, metadata: { configuredRootId: DRIVE_ROOT_ID }, created_at: nowMs(), updated_at: nowMs() }, { onConflict: "mapping_key" }).select().single();
  if (error) throw new Error(`Metadata root Drive tidak tersimpan: ${error.message}`);
  return data;
}
async function ensureTree(body: any) {
  const auditId = text(body.auditId, 100);
  const upt = text(body.upt, 120);
  const categoryId = text(body.categoryId, 100);
  const aspectId = text(body.aspectId, 100);
  const itemId = text(body.itemId, 160);
  if (!auditId || !upt || !categoryId || !aspectId || !itemId) throw new Error("auditId, UPT, kategori, aspek, dan item wajib diisi.");
  const period = periodFromKey(body.periodKey) || periodFor(body.auditCreatedAt);
  const base = `maturity-v1:${period.key}:${upt}`;
  const root = await ensureRoot();
  // The configured folder itself is the root. Do not create an extra visible root folder.
  const periodFolder = await ensureFolder({ mappingKey: `${base}:period`, name: period.label, parentFolderId: DRIVE_ROOT_ID, periodKey: period.key, folderType: "PERIOD", parentMappingKey: root.mapping_key, metadata: { period } });
  const uptFolder = await ensureFolder({ mappingKey: `${base}:upt`, name: safeName(upt, "UPT"), parentFolderId: periodFolder.drive_folder_id, periodKey: period.key, folderType: "UPT", parentMappingKey: periodFolder.mapping_key, metadata: { upt } });
  const categoryFolder = await ensureFolder({ mappingKey: `${base}:category:${categoryId}`, name: `${String(Math.max(1, Number(body.categoryOrder) || 1)).padStart(2, "0")} - ${safeName(body.categoryLabel, "Kategori")}`, parentFolderId: uptFolder.drive_folder_id, periodKey: period.key, folderType: "CATEGORY", parentMappingKey: uptFolder.mapping_key, metadata: { upt, categoryId, categoryLabel: text(body.categoryLabel, 160) } });
  const aspectFolder = await ensureFolder({ mappingKey: `${base}:aspect:${categoryId}:${aspectId}`, name: `${safeName(aspectId, "aspek")} - ${safeName(body.aspectTitle, "Aspek")}`, parentFolderId: categoryFolder.drive_folder_id, periodKey: period.key, folderType: "ASPECT", parentMappingKey: categoryFolder.mapping_key, metadata: { upt, categoryId, aspectId, aspectTitle: text(body.aspectTitle, 200) } });
  const itemFolder = await ensureFolder({ mappingKey: `${base}:item:${categoryId}:${aspectId}:${itemId}`, name: `${safeName(itemId, "item")} - ${safeName(body.itemLabel, "Evidence")}`, parentFolderId: aspectFolder.drive_folder_id, periodKey: period.key, folderType: "ITEM", parentMappingKey: aspectFolder.mapping_key, metadata: { upt, categoryId, categoryLabel: text(body.categoryLabel, 160), aspectId, aspectTitle: text(body.aspectTitle, 200), itemId, itemLabel: text(body.itemLabel, 240) } });
  return { period, root, periodFolder, uptFolder, categoryFolder, aspectFolder, itemFolder };
}
function evidenceDto(row: any) {
  return { id: row.id, itemId: row.item_id, itemLabel: row.item_label, aspectId: row.aspect_id, categoryId: row.category_id, category: row.category_label, upt: row.upt, name: row.file_name, size: Number(row.file_size || 0), mimeType: row.mime_type, driveFileId: row.drive_file_id, driveFolderId: row.drive_folder_id, isDrive: true, syncedToDrive: true, source: row.source };
}
async function upsertEvidence(input: any) {
  const { data: existing } = await admin.from("maturity_audit_evidence").select("audit_id").eq("drive_file_id", input.driveFile.id).maybeSingle();
  if (existing && existing.audit_id !== input.auditId) throw Object.assign(new Error("Berkas sudah terhubung ke audit lain."), { status: 409 });
  const row = { audit_id: input.auditId, aspect_id: input.aspectId, item_id: input.itemId, item_label: input.itemLabel || "", category_id: input.categoryId || "", category_label: input.categoryLabel || "", upt: input.upt.name, upt_id: input.upt.id, drive_file_id: input.driveFile.id, drive_folder_id: input.folderId || null, file_name: input.driveFile.name || "Berkas", mime_type: input.driveFile.mimeType || "application/octet-stream", file_size: Number(input.driveFile.size || 0), md5_checksum: input.driveFile.md5Checksum || null, source: input.source || "UPLOAD", assignment_state: "ACTIVE", linked_at: nowMs(), linked_by: input.actorId, unlinked_at: null, unlinked_by: null };
  const { data, error } = await admin.from("maturity_audit_evidence").upsert(row, { onConflict: "drive_file_id" }).select().single();
  if (error) throw new Error(`Metadata evidence tidak tersimpan: ${error.message}`);
  return data;
}
async function uploadDriveFile(file: File, folderId: string, mappingKey: string) {
  const boundary = `warnoto-${crypto.randomUUID()}`;
  const metadata = JSON.stringify({ name: safeName(file.name, "evidence"), parents: [folderId], appProperties: { warnoto_maturity_folder_key: mappingKey, warnoto_maturity_root: DRIVE_ROOT_ID } });
  const head = new TextEncoder().encode(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: ${file.type || "application/octet-stream"}\r\n\r\n`);
  const tail = new TextEncoder().encode(`\r\n--${boundary}--`);
  const bytes = new Uint8Array(head.length + file.size + tail.length);
  bytes.set(head); bytes.set(new Uint8Array(await file.arrayBuffer()), head.length); bytes.set(tail, head.length + file.size);
  return driveJson("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType,size,md5Checksum,webViewLink", { method: "POST", headers: { "Content-Type": `multipart/related; boundary=${boundary}` }, body: bytes });
}
// Jalankan fn untuk tiap item, maksimal `limit` berjalan bersamaan.
// Mengembalikan hasil per item sesuai urutan input.
async function mapLimit(items: any[], limit: number, fn: (item: any, index: number) => Promise<any>) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) break;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}
async function listChildren(folderId: string) {
  const q = encodeURIComponent(`'${quoteDrive(folderId)}' in parents and trashed = false`);
  const out: any[] = []; let pageToken = "";
  do {
    const page = await driveJson(`/files?q=${q}&fields=nextPageToken,files(id,name,mimeType,size,md5Checksum,parents,modifiedTime)&pageSize=1000&supportsAllDrives=true&includeItemsFromAllDrives=true${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`);
    out.push(...(page.files || [])); pageToken = page.nextPageToken || "";
  } while (pageToken);
  return out;
}
async function getEvidenceForAudit(auditId: string) {
  const { data, error } = await admin.from("maturity_audit_evidence").select("*").eq("audit_id", auditId).is("unlinked_at", null).order("linked_at", { ascending: true });
  if (error) throw new Error(`Evidence tidak dapat dibaca: ${error.message}`);
  return (data || []).map(evidenceDto);
}
function unassignedDto(row: any) {
  return { id: row.id, driveFileId: row.drive_file_id, name: row.file_name, size: Number(row.file_size || 0), mimeType: row.mime_type, parentFolderId: row.source_folder_id, assignmentState: row.assignment_state, context: { periodKey: row.period_key } };
}
async function recordUnassigned(input: any) {
  const { data: existing, error: existingError } = await admin.from("maturity_audit_drive_unassigned").select("*").eq("audit_id", input.auditId).eq("drive_file_id", input.driveFile.id).maybeSingle();
  if (existingError) throw new Error(`Berkas unassigned tidak dapat dibaca: ${existingError.message}`);
  const patch = { source_folder_id: input.sourceFolderId, file_name: input.driveFile.name || "Berkas", mime_type: input.driveFile.mimeType || "application/octet-stream", file_size: Number(input.driveFile.size || 0), md5_checksum: input.driveFile.md5Checksum || null, updated_at: nowMs() };
  if (existing) {
    if (existing.assignment_state === "ACTIVE") return existing;
    const { data, error } = await admin.from("maturity_audit_drive_unassigned").update(patch).eq("id", existing.id).select().single();
    if (error) throw new Error(`Berkas unassigned tidak dapat diperbarui: ${error.message}`);
    return data;
  }
  const { data, error } = await admin.from("maturity_audit_drive_unassigned").insert({ audit_id: input.auditId, upt_id: input.upt.id, period_key: input.periodKey, drive_root_id: DRIVE_ROOT_ID, drive_file_id: input.driveFile.id, ...patch }).select().single();
  if (error) throw new Error(`Berkas unassigned tidak dapat disimpan: ${error.message}`);
  return data;
}
async function scopedFolders(audit: any, upt: any, { includeRoot = false } = {}) {
  const period = periodFromKey(audit.period_key);
  const { data, error } = await admin.from("maturity_audit_drive_folders").select("*").eq("period_key", period.key).like("mapping_key", `maturity-v1:${period.key}:${upt.name}%`).eq("drive_root_id", DRIVE_ROOT_ID);
  if (error) throw new Error(`Folder mapping tidak dapat dibaca: ${error.message}`);
  if (!includeRoot) return data || [];
  const root = await getFolder("maturity-v1:root");
  return [root || { mapping_key: "maturity-v1:root", folder_type: "ROOT", drive_folder_id: DRIVE_ROOT_ID, drive_root_id: DRIVE_ROOT_ID, metadata: {} }, ...(data || [])];
}
async function reconcileAssignments(audit: any, upt: any, itemFolders: any[], actorId: string, { includeRoot = false } = {}) {
  const { data: rows, error } = await admin.from("maturity_audit_drive_unassigned").select("*").eq("audit_id", audit.id).in("assignment_state", ["ASSIGNING", "NEEDS_REPAIR"]);
  if (error) throw new Error(`State assignment tidak dapat dibaca: ${error.message}`);
  for (const row of rows || []) {
    // A direct-root record has no inherent UPT ownership. Never let a scoped
    // caller complete or repair a claim originally staged from that inbox.
    if (row.source_folder_id === DRIVE_ROOT_ID && !includeRoot) continue;
    try {
      const driveFile = await driveJson(`/files/${encodeURIComponent(row.drive_file_id)}?fields=id,name,mimeType,size,md5Checksum,parents&supportsAllDrives=true`);
      if (row.target_folder_id && (driveFile.parents || []).includes(row.target_folder_id)) {
        await upsertEvidence({ auditId: audit.id, upt, aspectId: row.target_aspect_id, itemId: row.target_item_id, itemLabel: row.target_item_label, categoryId: row.target_category_id, categoryLabel: row.target_category_label, folderId: row.target_folder_id, driveFile, source: "ASSIGN", actorId });
        const { error: doneError } = await admin.from("maturity_audit_drive_unassigned").update({ assignment_state: "ACTIVE", last_error: null, assigned_at: nowMs(), updated_at: nowMs() }).eq("id", row.id);
        if (doneError) throw new Error(doneError.message);
      } else if ((driveFile.parents || []).includes(row.source_folder_id)) {
        await admin.from("maturity_audit_drive_unassigned").update({ assignment_state: "UNASSIGNED", last_error: null, updated_at: nowMs() }).eq("id", row.id);
      } else {
        await admin.from("maturity_audit_drive_unassigned").update({ assignment_state: "NEEDS_REPAIR", last_error: "Parent Drive berubah di luar scope assignment.", updated_at: nowMs() }).eq("id", row.id);
      }
    } catch (error) {
      await admin.from("maturity_audit_drive_unassigned").update({ assignment_state: "NEEDS_REPAIR", last_error: error instanceof Error ? error.message.slice(0, 500) : "Gagal rekonsiliasi.", updated_at: nowMs() }).eq("id", row.id);
    }
  }
}
async function syncAudit(body: any, ctx: any) {
  const auditId = text(body.auditId, 100);
  const context = await resolveAuditContext(body, ctx, { createDraft: Boolean(body.scanDrive) });
  const audit = context.audit;
  const upt = context.upt;
  await assertUptAccess(ctx, upt, Boolean(body.scanDrive));
  if (!body.scanDrive) return { evidence: await getEvidenceForAudit(auditId), unassigned: [] };
  assertMutableAudit(audit);
  const period = periodFromKey(audit.period_key);
  // Direct-root files have no UPT ownership. Only SUPERADMIN may claim that
  // shared inbox; scoped users scan the canonical period/UPT hierarchy only.
  // Heal folder duplication (see healDuplicateFolders) with a single grouped
  // Drive query before deriving itemFolders, so scanning below hits the
  // canonical folder id. Skipped if period_key can't be parsed.
  if (period) await healDuplicateFolders(upt, period);
  const rows = await scopedFolders(audit, upt, { includeRoot: ctx.profile.role === "SUPERADMIN" });
  const itemFolders = rows.filter((row) => row.folder_type === "ITEM");
  await reconcileAssignments(audit, upt, itemFolders, ctx.user.id, { includeRoot: ctx.profile.role === "SUPERADMIN" });
  // Fetch Drive listings for all folders in parallel (bounded), then write to
  // DB serially — upsert/recordUnassigned are idempotent by drive_file_id so
  // write order doesn't matter, and serial writes keep this simple.
  const itemChildren = await mapLimit(itemFolders, 8, async (folder) => ({ folder, files: await listChildren(folder.drive_folder_id) }));
  for (const { folder, files } of itemChildren) {
    const meta = folder.metadata || {};
    for (const driveFile of files) {
      if (driveFile.mimeType === "application/vnd.google-apps.folder") continue;
      await upsertEvidence({ auditId, upt, aspectId: meta.aspectId, itemId: meta.itemId, itemLabel: meta.itemLabel, categoryId: meta.categoryId, categoryLabel: meta.categoryLabel, folderId: folder.drive_folder_id, driveFile, source: "SYNC", actorId: ctx.user.id });
      await admin.from("maturity_audit_drive_unassigned").update({ assignment_state: "ACTIVE", last_error: null, updated_at: nowMs() }).eq("audit_id", auditId).eq("drive_file_id", driveFile.id);
    }
  }
  const unassigned: any[] = [];
  const scanFolders = rows.filter((row) => ["ROOT", "PERIOD", "UPT", "CATEGORY", "ASPECT"].includes(row.folder_type));
  const scanChildren = await mapLimit(scanFolders, 8, async (folder) => ({ folder, files: await listChildren(folder.drive_folder_id) }));
  for (const { folder, files } of scanChildren) {
    for (const driveFile of files) {
      if (driveFile.mimeType === "application/vnd.google-apps.folder") continue;
      const record = await recordUnassigned({ auditId, upt, periodKey: period?.key || audit.period_key, sourceFolderId: folder.drive_folder_id, driveFile });
      if (record.assignment_state !== "ACTIVE") unassigned.push({ ...unassignedDto(record), folderType: folder.folder_type, context: folder.metadata || {} });
    }
  }
  await event(auditId, "EVIDENCE_SYNCED", ctx.user.id, { countFolders: itemFolders.length, unassigned: unassigned.length });
  return { evidence: await getEvidenceForAudit(auditId), unassigned };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);
  try {
    const ctx = await authContext(req);
    const isMultipart = (req.headers.get("content-type") || "").includes("multipart/form-data");
    const form = isMultipart ? await req.formData() : null;
    const body = form ? Object.fromEntries([...form.entries()].filter(([key]) => key !== "file").map(([key, value]) => [key, parseJson(value, value)])) : await req.json().catch(() => ({}));
    const action = text(form?.get("action") ?? body.action, 40).toLowerCase();
    if (!action) return json({ ok: false, error: "action wajib diisi." }, 400);

    if (action === "ensure-tree") {
      const context = await resolveAuditContext(body, ctx, { createDraft: true });
      await assertUptAccess(ctx, context.upt, true);
      assertMutableAudit(context.audit);
      const canonicalBody = { ...body, upt: context.upt.name, periodKey: context.audit?.period_key, auditCreatedAt: context.audit?.created_at || body.auditCreatedAt };
      const tree = await ensureTree(canonicalBody);
      await event(text(body.auditId), "TREE_ENSURED", ctx.user.id, { itemFolderId: tree.itemFolder.drive_folder_id, period: tree.period.key });
      return json({ ok: true, folderPath: `${tree.period.label}/${context.upt.name}/${body.categoryLabel}/${body.aspectId}/${body.itemLabel}`, targetFolderId: tree.itemFolder.drive_folder_id });
    }
    if (action === "upload") {
      const file = form?.get("file");
      if (!(file instanceof File) || !fileAllowed(file)) return json({ ok: false, error: "Format berkas tidak didukung atau ukurannya melebihi 25 MB." }, 400);
      const context = await resolveAuditContext(body, ctx, { createDraft: true });
      await assertUptAccess(ctx, context.upt, true);
      assertMutableAudit(context.audit);
      const canonicalBody = { ...body, upt: context.upt.name, periodKey: context.audit?.period_key, auditCreatedAt: context.audit?.created_at || body.auditCreatedAt };
      const tree = await ensureTree(canonicalBody);
      const driveFile = await uploadDriveFile(file, tree.itemFolder.drive_folder_id, tree.itemFolder.mapping_key);
      const row = await upsertEvidence({ auditId: text(body.auditId), upt: context.upt, aspectId: text(body.aspectId), itemId: text(body.itemId), itemLabel: text(body.itemLabel), categoryId: text(body.categoryId), categoryLabel: text(body.categoryLabel), folderId: tree.itemFolder.drive_folder_id, driveFile, source: "UPLOAD", actorId: ctx.user.id });
      await event(text(body.auditId), "EVIDENCE_UPLOADED", ctx.user.id, { evidenceId: row.id, driveFileId: driveFile.id, itemId: body.itemId });
      return json({ ok: true, evidence: evidenceDto(row), folderPath: `${tree.period.label}/${context.upt.name}/${body.categoryLabel}/${body.aspectId}/${body.itemLabel}`, targetFolderId: tree.itemFolder.drive_folder_id });
    }
    if (action === "upload-5s") {
      const file = form?.get("file");
      if (!(file instanceof File) || !fileAllowed(file)) return json({ ok: false, error: "Format berkas tidak didukung atau ukurannya melebihi 25 MB." }, 400);
      const upt = await findUptByName(text(body.upt, 120));
      await assertUptAccess(ctx, upt, true);
      const period = periodFor(Date.UTC(Number(body.tahun), Number(body.bulan), 1));
      await ensureRoot();
      const base = `maturity-v1:${period.key}:${upt.name}`;
      const periodFolder = await ensureFolder({ mappingKey: `${base}:period`, name: period.label, parentFolderId: DRIVE_ROOT_ID, periodKey: period.key, folderType: "PERIOD", parentMappingKey: "maturity-v1:root", metadata: { period } });
      const uptFolder = await ensureFolder({ mappingKey: `${base}:upt`, name: safeName(upt.name, "UPT"), parentFolderId: periodFolder.drive_folder_id, periodKey: period.key, folderType: "UPT", parentMappingKey: periodFolder.mapping_key, metadata: { upt: upt.name } });
      const form5sFolder = await ensureFolder({ mappingKey: `${base}:form5s`, name: "Form 5S", parentFolderId: uptFolder.drive_folder_id, periodKey: period.key, folderType: "FORM5S", parentMappingKey: uptFolder.mapping_key, metadata: { upt: upt.name } });
      const driveFile = await uploadDriveFile(file, form5sFolder.drive_folder_id, form5sFolder.mapping_key);
      return json({ ok: true, evidence: { name: driveFile.name, url: driveFile.webViewLink, size: Number(driveFile.size || 0), driveFileId: driveFile.id, isDrive: true, syncedToDrive: true } });
    }
    if (action === "sync") return json({ ok: true, ...(await syncAudit(body, ctx) ) });
    if (action === "assign") {
      const auditId = text(body.auditId); const unassignedId = text(body.unassignedId);
      if (!auditId || !unassignedId) return json({ ok: false, error: "Data assignment belum lengkap." }, 400);
      const context = await resolveAuditContext(body, ctx, { createDraft: false });
      await assertUptAccess(ctx, context.upt, true);
      assertMutableAudit(context.audit);
      const canonicalBody = { ...body, upt: context.upt.name, periodKey: context.audit?.period_key, auditCreatedAt: context.audit?.created_at || body.auditCreatedAt };
      const tree = await ensureTree(canonicalBody);
      const { data: unassigned, error: unassignedError } = await admin.from("maturity_audit_drive_unassigned").select("*").eq("id", unassignedId).eq("audit_id", auditId).eq("upt_id", context.upt.id).eq("period_key", context.audit.period_key).eq("drive_root_id", DRIVE_ROOT_ID).maybeSingle();
      if (unassignedError || !unassigned) return json({ ok: false, error: "Berkas unassigned tidak ditemukan pada scope audit ini." }, 404);
      if (!["UNASSIGNED", "NEEDS_REPAIR"].includes(unassigned.assignment_state)) return json({ ok: false, error: "Berkas sedang atau sudah diproses. Sinkronkan Drive untuk rekonsiliasi." }, 409);
      const { data: linkedElsewhere } = await admin.from("maturity_audit_evidence").select("audit_id").eq("drive_file_id", unassigned.drive_file_id).maybeSingle();
      if (linkedElsewhere && linkedElsewhere.audit_id !== auditId) return json({ ok: false, error: "Berkas sudah terhubung ke audit lain." }, 409);
      const folders = await scopedFolders(context.audit, context.upt, { includeRoot: ctx.profile.role === "SUPERADMIN" });
      const allowedParents = new Set(folders.map(folder => folder.drive_folder_id));
      if (!allowedParents.has(unassigned.source_folder_id)) return json({ ok: false, error: "Sumber berkas berada di luar hierarchy audit." }, 403);
      const file = await driveJson(`/files/${encodeURIComponent(unassigned.drive_file_id)}?fields=id,name,mimeType,size,md5Checksum,parents&supportsAllDrives=true`);
      if (!(file.parents || []).includes(unassigned.source_folder_id)) return json({ ok: false, error: "Parent berkas Drive berubah; jalankan Sinkronkan Drive untuk rekonsiliasi." }, 409);
      const { error: markingError } = await admin.from("maturity_audit_drive_unassigned").update({ assignment_state: "ASSIGNING", target_folder_id: tree.itemFolder.drive_folder_id, target_aspect_id: text(body.aspectId), target_item_id: text(body.itemId), target_item_label: text(body.itemLabel), target_category_id: text(body.categoryId), target_category_label: text(body.categoryLabel), assigned_by: ctx.user.id, assigned_at: nowMs(), last_error: null, updated_at: nowMs() }).eq("id", unassigned.id).eq("assignment_state", unassigned.assignment_state);
      if (markingError) throw new Error(`State assignment tidak dapat disimpan: ${markingError.message}`);
      try {
        await driveJson(`/files/${encodeURIComponent(unassigned.drive_file_id)}?addParents=${encodeURIComponent(tree.itemFolder.drive_folder_id)}&removeParents=${encodeURIComponent((file.parents || []).join(","))}&fields=id,name,mimeType,size,md5Checksum`, { method: "PATCH" });
        const row = await upsertEvidence({ auditId, upt: context.upt, aspectId: text(body.aspectId), itemId: text(body.itemId), itemLabel: text(body.itemLabel), categoryId: text(body.categoryId), categoryLabel: text(body.categoryLabel), folderId: tree.itemFolder.drive_folder_id, driveFile: file, source: "ASSIGN", actorId: ctx.user.id });
        const { error: activeError } = await admin.from("maturity_audit_drive_unassigned").update({ assignment_state: "ACTIVE", last_error: null, updated_at: nowMs() }).eq("id", unassigned.id);
        if (activeError) throw new Error(`State assignment tidak dapat diselesaikan: ${activeError.message}`);
        await event(auditId, "EVIDENCE_ASSIGNED", ctx.user.id, { evidenceId: row.id, driveFileId: unassigned.drive_file_id });
        return json({ ok: true, evidence: evidenceDto(row) });
      } catch (error) {
        await admin.from("maturity_audit_drive_unassigned").update({ assignment_state: "NEEDS_REPAIR", last_error: error instanceof Error ? error.message.slice(0, 500) : "Assignment gagal.", updated_at: nowMs() }).eq("id", unassigned.id);
        throw error;
      }
    }
    if (action === "unlink") {
      const evidenceId = text(body.evidenceId); if (!evidenceId) return json({ ok: false, error: "evidenceId wajib diisi." }, 400);
      const { data: evidence } = await admin.from("maturity_audit_evidence").select("*").eq("id", evidenceId).is("unlinked_at", null).maybeSingle();
      if (!evidence) return json({ ok: false, error: "Evidence tidak ditemukan atau sudah dilepas." }, 404);
      const context = await resolveAuditContext({ auditId: evidence.audit_id }, ctx);
      if (evidence.upt_id !== context.upt.id) throw Object.assign(new Error("Scope evidence tidak cocok dengan audit canonical."), { status: 409 });
      await assertUptAccess(ctx, context.upt, true);
      assertMutableAudit(context.audit);
      try {
        await driveJson(`/files/${encodeURIComponent(evidence.drive_file_id)}?supportsAllDrives=true`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ trashed: true }) });
      } catch (trashError) {
        const msg = trashError instanceof Error ? trashError.message : "";
        if (!/\(404\)|not found/i.test(msg)) throw trashError; // already gone is fine, anything else must surface
      }
      const { error } = await admin.from("maturity_audit_evidence").update({ unlinked_at: nowMs(), unlinked_by: ctx.user.id }).eq("id", evidenceId);
      if (error) throw new Error(`Evidence tidak dapat dilepas: ${error.message}`);
      // Prevent resurrection: syncAudit's listChildren(trashed=false) would
      // otherwise re-find this file in the unassigned inbox and re-link it.
      await admin.from("maturity_audit_drive_unassigned").delete().eq("audit_id", evidence.audit_id).eq("drive_file_id", evidence.drive_file_id);
      await event(evidence.audit_id, "EVIDENCE_UNLINKED", ctx.user.id, { evidenceId, driveFileId: evidence.drive_file_id });
      return json({ ok: true });
    }
    if (action === "download") {
      const evidenceId = text(body.evidenceId); const { data: evidence } = await admin.from("maturity_audit_evidence").select("*").eq("id", evidenceId).is("unlinked_at", null).maybeSingle();
      if (!evidence) return json({ ok: false, error: "Evidence tidak ditemukan." }, 404);
      const context = await resolveAuditContext({ auditId: evidence.audit_id }, ctx);
      if (evidence.upt_id !== context.upt.id) throw Object.assign(new Error("Scope evidence tidak cocok dengan audit canonical."), { status: 409 });
      await assertUptAccess(ctx, context.upt, false);
      const response = await driveFetch(`/files/${encodeURIComponent(evidence.drive_file_id)}?alt=media&supportsAllDrives=true`);
      await event(evidence.audit_id, "EVIDENCE_DOWNLOADED", ctx.user.id, { evidenceId });
      return new Response(response.body, { headers: { ...corsHeaders, "Content-Type": evidence.mime_type || "application/octet-stream", "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(evidence.file_name)}`, "X-File-Name": encodeURIComponent(evidence.file_name) } });
    }
    return json({ ok: false, error: "action tidak dikenal." }, 400);
  } catch (error) {
    const status = Number((error as any)?.status) || 500;
    return json({ ok: false, error: error instanceof Error ? error.message : "Kesalahan tak terduga." }, status);
  }
});
