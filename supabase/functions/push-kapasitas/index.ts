// @ts-nocheck -- Supabase Edge Function (Deno), bukan runtime Vite.
// Push kapasitas gudang dari app -> Google Sheet operasional.
//
// ponytail:
//  - Arah RESMI ke depan: App -> Sheet (fungsi ini authoritative untuk kolom kapasitas).
//    sync-kapasitas (Sheet -> App) TIDAK dihapus, tapi JANGAN dijalankan atas kolom yang
//    sama (H..P) setelah push — bisa timpa-menimpa (last-writer-wins). Kalau nanti perlu
//    dua arah beneran, butuh lock/versi baris, bukan sekadar jalankan dua-duanya.
//  - Baris MATCH (UPT|GUDANG|SUB GUDANG ketemu di sheet) -> update HANYA kolom kapasitas
//    (H..P + S). Baris TIDAK MATCH (TL menambah gudang/area baru di app) -> APPEND baris
//    baru, isi SEMUA kolom A..X (lihat mapping.mjs buildInsertRow untuk layout).
//  - fileId/gid sheet sama persis dengan sync-kapasitas — kalau sheet pindah, ganti di
//    KEDUA fungsi (index ini + sync-kapasitas/index.ts).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildKey, buildRowMap, classifyRows, buildUpdateOps, buildInsertRow } from "./mapping.mjs";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
// Kredensial OAuth Google sama dengan maturity-drive (scope drive/spreadsheets sudah
// harus melekat di refresh token; kalau belum, sheetsFetch di bawah gagal 403 actionable).
const GOOGLE_CLIENT_ID = Deno.env.get("GOOGLE_DRIVE_CLIENT_ID") ?? "";
const GOOGLE_CLIENT_SECRET = Deno.env.get("GOOGLE_DRIVE_CLIENT_SECRET") ?? "";
const GOOGLE_REFRESH_TOKEN = Deno.env.get("GOOGLE_DRIVE_REFRESH_TOKEN") ?? "";
// Sheet sumber — sama persis dengan sync-kapasitas/index.ts.
const SHEET_ID = "1GND76s06KHIWtwLrmnmNPBmn46sDRJD9kVre5F5_sq8";
const SHEET_GID = 361941646;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

// Access token valid ~1 jam; cache di scope modul — pola sama dengan maturity-drive/index.ts.
let cachedToken = "";
let cachedTokenExpiry = 0;
async function getAccessToken() {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REFRESH_TOKEN) {
    throw Object.assign(new Error("Google OAuth belum dikonfigurasi di server (secret kosong)."), { status: 500 });
  }
  if (cachedToken && Date.now() < cachedTokenExpiry) return cachedToken;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID, client_secret: GOOGLE_CLIENT_SECRET,
      refresh_token: GOOGLE_REFRESH_TOKEN, grant_type: "refresh_token",
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    throw Object.assign(new Error("Token Google tidak dapat diperbarui — cek refresh token/scope OAuth server."), { status: 502 });
  }
  cachedToken = data.access_token;
  cachedTokenExpiry = Date.now() + (Number(data.expires_in) > 0 ? Number(data.expires_in) * 1000 : 3600000) - 60000;
  return cachedToken;
}

async function sheetsFetch(path, token, init = {}) {
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers || {}) },
  });
  if (res.status === 403) {
    throw Object.assign(new Error(
      "Google Sheets menolak akses (403). Akun OAuth server belum jadi Editor di sheet, atau token belum " +
      "punya scope spreadsheets/drive — share sheet ke akun tsb sebagai Editor lalu re-consent OAuth (scope drive/spreadsheets)."
    ), { status: 403 });
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw Object.assign(new Error(`Google Sheets API gagal (HTTP ${res.status}): ${body.slice(0, 200)}`), { status: 502 });
  }
  return res.json();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return json({ error: "server misconfigured" }, 500);

  const svc = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  // --- Otorisasi: ADMIN / TL / SUPERADMIN (TL yang biasa edit kapasitas gudang) ---
  const jwt = (req.headers.get("Authorization") || "").replace("Bearer ", "").trim();
  if (!jwt) return json({ error: "unauthorized" }, 401);
  const { data: uData, error: uErr } = await svc.auth.getUser(jwt);
  if (uErr || !uData?.user) return json({ error: "invalid token" }, 401);
  const { data: prof } = await svc.from("profiles").select("role").eq("id", uData.user.id).single();
  if (!prof || !["ADMIN", "TL", "SUPERADMIN"].includes(prof.role)) return json({ error: "forbidden" }, 403);

  let rows, dryRun;
  try {
    const body = await req.json();
    rows = Array.isArray(body?.rows) ? body.rows : null;
    dryRun = body?.dryRun === true;
  } catch {
    rows = null;
  }
  if (!rows || rows.length === 0) return json({ error: "tidak ada data kapasitas untuk dikirim" }, 422);

  try {
    const token = await getAccessToken();

    // --- Resolve nama tab dari gid (Sheets values API pakai NAMA tab, bukan gid) ---
    const meta = await sheetsFetch("?fields=sheets(properties(sheetId,title))", token);
    const sheetMeta = (meta.sheets || []).find((s) => s.properties?.sheetId === SHEET_GID);
    if (!sheetMeta) return json({ error: "tab sheet (gid) tidak ditemukan — struktur sheet mungkin sudah berubah" }, 422);
    const title = sheetMeta.properties.title;

    // --- Baca grid sekarang (A:C) untuk klasifikasi update vs insert ---
    const grid = await sheetsFetch(`/values/${encodeURIComponent(title)}!A:C`, token);
    const rowMap = buildRowMap(grid.values || []);
    const { updates, inserts } = classifyRows(rows, rowMap);

    // --- Mode preview (dipakai client sebelum konfirmasi) — tanpa tulis apa pun ---
    if (dryRun) return json({ ok: true, preview: true, toUpdate: updates.length, toInsert: inserts.length });

    const waktuUpdateLabel = new Date().toLocaleString("id-ID", { timeZone: "Asia/Jakarta" });

    if (updates.length > 0) {
      const data = updates.flatMap(({ item, rowIndex }) => buildUpdateOps(title, rowIndex, item, waktuUpdateLabel));
      await sheetsFetch("/values:batchUpdate", token, {
        method: "POST",
        body: JSON.stringify({ valueInputOption: "RAW", data }),
      });
    }

    if (inserts.length > 0) {
      const values = inserts.map(({ item }) => buildInsertRow(item, waktuUpdateLabel));
      await sheetsFetch(
        `/values/${encodeURIComponent(title)}!A:X:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
        token,
        { method: "POST", body: JSON.stringify({ values }) },
      );
    }

    return json({ ok: true, updated: updates.length, inserted: inserts.length });
  } catch (e) {
    return json({ error: e?.message || String(e) }, e?.status || 500);
  }
});
