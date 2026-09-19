// Staged backfill for legacy Stock Opname data URLs.
// Dry-run is the default. Use --write only after reviewing the dry-run output.
import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
if (!url || !key) throw new Error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY; no secret is stored in this repository.");

const write = process.argv.includes("--write");
const PAGE_SIZE = 100;
const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

function walk(value, visit, path = []) {
  if (Array.isArray(value)) return value.map((entry, index) => walk(entry, visit, [...path, index]));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, walk(entry, visit, [...path, key])]));
  return visit(value, path);
}

function dataUrlParts(value) {
  const match = typeof value === "string" && value.match(/^data:([^;,]+);base64,(.+)$/s);
  return match ? { contentType: match[1], bytes: Buffer.from(match[2], "base64") } : null;
}

async function main() {
  let found = 0;
  let changed = 0;
  let lastId = "";
  for (;;) {
    let query = supabase.from("stock_opname").select("id,upt_id,data").order("id", { ascending: true }).limit(PAGE_SIZE);
    if (lastId) query = query.gt("id", lastId);
    const { data: rows, error } = await query;
    if (error) throw error;
    if (!rows?.length) break;
    for (const row of rows) {
      if (!row?.data || !row.upt_id) continue;
      const uploads = [];
      const next = walk(row.data, (value, path) => {
        const parts = dataUrlParts(value);
        const field = path.at(-1);
        const isOpnameItemPhoto = path.length >= 3 && path[path.length - 3] === "items" && Number.isInteger(path[path.length - 2]);
        if (!parts || !isOpnameItemPhoto || !["fotoKeseluruhan", "fotoNameplate"].includes(field)) return value;
        found++;
        const item = path.length > 1 ? path[path.length - 2] : "item";
        const digest = crypto.createHash("sha256").update(parts.bytes).digest("hex").slice(0, 20);
        const kind = field === "fotoNameplate" ? "tambahan" : "utama";
        const objectPath = `${row.upt_id}/${String(item).replace(/[^a-zA-Z0-9_-]/g, "_")}/${kind}-legacy-${digest}.jpg`;
        uploads.push({ objectPath, parts });
        return `__STOCK_PHOTO_UPLOAD__${objectPath}`;
      });
      if (!uploads.length) continue;
      changed++;
      if (!write) {
        console.log(`[dry-run] ${row.id}: ${uploads.length} foto`);
        continue;
      }
      for (const upload of uploads) {
        const uploadResult = await supabase.storage.from("stock-photos").upload(upload.objectPath, upload.parts.bytes, {
          contentType: upload.parts.contentType,
          upsert: true,
        });
        if (uploadResult.error) throw uploadResult.error;
      }
      const publicUrl = objectPath => `${url.replace(/\/$/, "")}/storage/v1/object/public/stock-photos/${objectPath}`;
      const replaced = walk(next, value => typeof value === "string" && value.startsWith("__STOCK_PHOTO_UPLOAD__") ? publicUrl(value.slice("__STOCK_PHOTO_UPLOAD__".length)) : value);
      const update = await supabase.from("stock_opname").update({ data: replaced }).eq("id", row.id);
      if (update.error) throw update.error;
      console.log(`[write] ${row.id}: ${uploads.length} foto`);
    }
    lastId = rows[rows.length - 1].id;
    if (rows.length < PAGE_SIZE) break;
  }
  console.log(JSON.stringify({ write, rowsWithLegacyPhotos: changed, legacyPhotos: found }));
}

await main();
