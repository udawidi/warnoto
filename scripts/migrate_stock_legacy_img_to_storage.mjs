// Migrasi legacy `stocks.data.img` (data URL) ke Storage.
// Default DRY-RUN. Tulis hanya dengan --apply.
import crypto from "node:crypto";
import { pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";

export const PAGE_SIZE = 50;
export const BUCKET = "stock-photos";

const MIME_EXT = { "image/jpeg": "jpg", "image/jpg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif", "image/avif": "avif" };

export function decodeDataUrl(value) {
  const match = typeof value === "string" && value.match(/^data:([^;,]+);base64,([\s\S]+)$/);
  if (!match) return null;
  const bytes = Buffer.from(match[2].replace(/\s/g, ""), "base64");
  if (!bytes.length) return null;
  const mime = match[1].toLowerCase();
  return { mime, bytes, hash: crypto.createHash("sha256").update(bytes).digest("hex"), extension: MIME_EXT[mime] || "bin" };
}

export function legacyImage(value) {
  const parsed = decodeDataUrl(value);
  return parsed && parsed.mime.startsWith("image/") ? parsed : null;
}

export function storagePath(hash, extension) {
  return `legacy/${hash}.${extension}`;
}

export function inspectRows(rows) {
  const unique = new Map();
  let references = 0;
  let bytes = 0;
  const affected = [];
  for (const row of rows || []) {
    const image = legacyImage(row?.data?.img);
    if (!image) continue;
    references++;
    bytes += image.bytes.length;
    affected.push({ id: row.id, hash: image.hash, bytes: image.bytes.length, mime: image.mime, extension: image.extension });
    if (!unique.has(image.hash)) unique.set(image.hash, { ...image, path: storagePath(image.hash, image.extension) });
  }
  return { references, bytes, affected, unique: [...unique.values()] };
}

function env(name) {
  return process.env[name];
}

async function fetchPage(supabase, lastId) {
  let query = supabase.from("stocks").select("id,data").order("id", { ascending: true }).limit(PAGE_SIZE);
  if (lastId) query = query.gt("id", lastId);
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

async function applyRow(supabase, url, row, image) {
  const path = storagePath(image.hash, image.extension);
  const { data: current, error: readError } = await supabase.from("stocks").select("id,data").eq("id", row.id).maybeSingle();
  if (readError) throw readError;
  const currentImage = legacyImage(current?.data?.img);
  if (!current || !currentImage || currentImage.hash !== image.hash || current.data.img !== row.data.img) return "stale";

  const publicUrl = `${url.replace(/\/$/, "")}/storage/v1/object/public/${BUCKET}/${path}`;
  const nextData = { ...current.data, img: publicUrl };
  // ponytail: PostgREST tidak menyediakan compare-and-swap JSONB tanpa RPC tambahan.
  // Jalankan --apply pada traffic rendah; re-read memperkecil, tetapi tidak menghapus,
  // race window antara pemeriksaan ini dan PATCH.
  const { data: updated, error: updateError } = await supabase.from("stocks").update({ data: nextData }).eq("id", row.id).select("id");
  if (updateError) throw updateError;
  return updated?.length ? "updated" : "stale";
}

export async function run({ supabase, url, apply = false, log = console.log } = {}) {
  if (!supabase || !url) throw new Error("supabase dan url wajib diisi");
  const allRows = [];
  let lastId = "";
  for (;;) {
    const rows = await fetchPage(supabase, lastId);
    if (!rows.length) break;
    allRows.push(...rows);
    lastId = rows.at(-1).id;
    if (rows.length < PAGE_SIZE) break;
  }
  const report = inspectRows(allRows);
  log(`stocks: ${allRows.length} | affected refs: ${report.references} | unique SHA-256: ${report.unique.length} | bytes: ${report.bytes}`);
  if (!apply) return { ...report, applied: false, updated: 0, stale: 0, failed: 0 };

  let updated = 0, stale = 0, failed = 0;
  for (const image of report.unique) {
    try {
      const upload = await supabase.storage.from(BUCKET).upload(image.path, image.bytes, { contentType: image.mime, upsert: true });
      if (upload.error) throw upload.error;
    } catch (error) {
      failed += report.affected.filter((item) => item.hash === image.hash).length;
      log(`FAIL upload ${image.path}: ${error.message}`);
      continue;
    }
    for (const item of report.affected.filter((candidate) => candidate.hash === image.hash)) {
      const row = allRows.find((candidate) => candidate.id === item.id);
      try {
        const result = await applyRow(supabase, url, row, legacyImage(row.data.img));
        if (result === "updated") updated++;
        else stale++;
      } catch (error) {
        failed++;
        log(`FAIL ${item.id}: ${error.message}`);
      }
    }
  }
  return { ...report, applied: true, updated, stale, failed };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const url = env("SUPABASE_URL") || env("VITE_SUPABASE_URL");
  const key = env("SUPABASE_SERVICE_ROLE_KEY") || env("SUPABASE_SECRET_KEY");
  if (!url || !key) throw new Error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY/SUPABASE_SECRET_KEY");
  const apply = process.argv.includes("--apply");
  const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const result = await run({ supabase, url, apply });
  console.log(JSON.stringify(result));
  if (!apply) console.log("DRY-RUN: tidak ada upload atau update. Gunakan --apply setelah review.");
}
