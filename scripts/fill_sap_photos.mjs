// One-off migration: fill SAP stock photos (fotoKeseluruhan/fotoNameplate) from local
// folder into stocks.data via Supabase Storage. Mirrors migrate_material_photos.mjs.
//
// Usage:
//   node scripts/fill_sap_photos.mjs <localRoot> [--commit] [--limit N] [--upt <keyword>]
//
// Default = DRY-RUN (report only, no DB/Storage writes).

import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

function loadDotEnv() {
  const envPath = path.resolve(process.cwd(), ".env");
  if (!fs.existsSync(envPath)) return;
  const text = fs.readFileSync(envPath, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (!m) continue;
    const key = m[1];
    let val = m[2].trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
}
loadDotEnv();

const SUPABASE_URL = process.env.NEW_SUPABASE_URL;
const SUPABASE_KEY = process.env.NEW_SUPABASE_SECRET_KEY;

const args = process.argv.slice(2);
const localRoot = args.find(a => !a.startsWith("--"));
const COMMIT = args.includes("--commit");
const limitIdx = args.indexOf("--limit");
const LIMIT = limitIdx >= 0 ? parseInt(args[limitIdx + 1], 10) : null;
const uptIdx = args.indexOf("--upt");
const UPT_FILTER = uptIdx >= 0 ? args[uptIdx + 1] : null;

if (!localRoot || !fs.existsSync(localRoot)) {
  console.error("Usage: node scripts/fill_sap_photos.mjs <localRoot> [--commit] [--limit N] [--upt <keyword>]");
  process.exit(1);
}
if (COMMIT && !SUPABASE_KEY) {
  console.error("--commit butuh NEW_SUPABASE_SECRET_KEY di .env");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

const PLANT_MAP = { malang: "3612", madiun: "3613", probolinggo: "3614", bali: "3615", gresik: "GRS" };
// Catatan: "pre memory" TIDAK di-skip — folder "Material (pre) memory" di Drive cuma
// organisasi lokasi, isinya material yang tetap ada di DB (STK-SAP). Penyaringan
// akhir tetap oleh kecocokan DB (material tak ada di DB → unmatched).
const SKIP_FOLDER_RE = /(non sap|kapasitas|pid|ba tug)/i;
const IMG_RE = /\.(jpe?g|png|webp)$/i;

function normMaterial(s) {
  return String(s).replace(/^0+(?=\d)/, "");
}

function naturalCompare(a, b) {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

// --- Step 1: build DB map ${plant}|${normMaterial} -> {id, katalog_id, data}
async function fetchDbMap() {
  const { data, error } = await supabase.from("stocks").select("id,katalog_id,data").like("id", "STK-SAP-%");
  if (error) throw error;
  const map = new Map();
  for (const row of data) {
    const parts = row.id.split("-"); // STK-SAP-<plant>-<material>
    const plant = parts[2];
    const material = parts[parts.length - 1];
    map.set(`${plant}|${normMaterial(material)}`, row);
  }
  return map;
}

// Gresik: stok BUKAN STK-SAP (import lama), diidentifikasi via data->>uptId,
// dicocokkan by nomor katalog (data.katalog) bukan id.
async function fetchGresikMap() {
  const { data, error } = await supabase.from("stocks").select("id,katalog_id,data").eq("data->>uptId", "UPT-GRS");
  if (error) throw error;
  const map = new Map();
  for (const row of data) {
    if (!row.data?.katalog) continue;
    map.set(normMaterial(row.data.katalog), row);
  }
  return map;
}

// --- Step 2/3: walk local folders, detect plant from topmost UPT folder
function detectPlant(folderName) {
  const lower = folderName.toLowerCase();
  for (const [kw, plant] of Object.entries(PLANT_MAP)) {
    if (lower.includes(kw)) return plant;
  }
  return null;
}

// filename material extraction, e.g. "4160028 (947 m)" -> "4160028"
// digit run >=12 dianggap tanggal kamera (bukan material), bukan dipakai.
function extractMaterialFromToken(token) {
  const t = token.trim();
  const cut = t.search(/[\s(_]/);
  const head = cut === -1 ? t : t.slice(0, cut);
  const m = head.match(/^\d{6,}/);
  if (!m || m[0].length >= 12) return null;
  return m[0];
}

function extractMaterialsFromFilename(fileName) {
  const base = fileName.replace(IMG_RE, "");
  const tokens = base.split(",");
  const out = [];
  for (const tok of tokens) {
    const mat = extractMaterialFromToken(tok);
    if (mat) out.push(mat);
  }
  return out;
}

const CAMERA_FILE_RE = /^(IMG|TimePhoto|PXL|DSC|Screenshot|VID)/i;

// Ancestor (folder) yang namanya digit >=6 = material sah (Madiun/Bali: foto
// disimpan dalam subfolder nomor material dengan nama file dari kamera).
// Dicari dari folder TERDEKAT ke atas, berhenti di root UPT (ancestors kosong).
function findFolderMaterial(ancestors) {
  for (let i = ancestors.length - 1; i >= 0; i--) {
    const name = ancestors[i].trim();
    if (/^\d{6,}$/.test(name)) return name;
  }
  return null;
}

// walk(dir, plant, isTopLevel, ancestors, found) -> pushes matches into `found`
function walkDir(dir, plant, isTopLevel, ancestors, found) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (isTopLevel) {
        const p = detectPlant(entry.name);
        if (p) walkDir(full, p, false, [], found);
        continue;
      }
      if (SKIP_FOLDER_RE.test(entry.name)) continue;
      walkDir(full, plant, false, [...ancestors, entry.name], found);
      continue;
    }
    if (!IMG_RE.test(entry.name) || !plant) continue;
    // Aturan 1: material dari folder induk (terdekat ke atas) menang, ABAIKAN nama file.
    const folderMaterial = findFolderMaterial(ancestors);
    if (folderMaterial) {
      found.files.push({ plant, material: folderMaterial, filePath: full });
      continue;
    }
    // Aturan 2/3: tak ada folder material -> baru parse nama file. Nama file
    // kamera (IMG/TimePhoto/PXL/DSC/Screenshot/VID) tanpa folder material = unmatched.
    if (CAMERA_FILE_RE.test(entry.name)) {
      found.unmatchedCamera.push(full);
      continue;
    }
    const materials = extractMaterialsFromFilename(entry.name);
    if (materials.length === 0) {
      found.unmatchedNoName.push(full);
      continue;
    }
    for (const mat of materials) {
      found.files.push({ plant, material: mat, filePath: full });
    }
  }
}

function scanLocal(root) {
  const found = { files: [], unmatchedNoName: [], unmatchedCamera: [] };
  walkDir(root, null, true, [], found);
  return found;
}

const MAX_BYTES = 1_000_000;

// Kompres buf ke JPEG <=1MB. <=1MB & sudah jpeg -> dikembalikan apa adanya.
// sharp diimpor dinamis di sini saja, dry-run tak butuh dependency ini.
async function compressUnder1MB(buf, ext) {
  const isJpeg = /^jpe?g$/i.test(ext);
  if (buf.length <= MAX_BYTES && isJpeg) return { buf, ext: "jpg", warn: null };

  const sharp = (await import("sharp")).default;
  const qualities = [80, 70, 60, 50, 40];
  const maxDims = [2000, 1600, 1280];
  let out = buf;
  for (const maxDim of maxDims) {
    for (const quality of maxDim === 2000 ? qualities : [45]) {
      out = await sharp(buf).rotate().resize(maxDim, maxDim, { fit: "inside", withoutEnlargement: true }).jpeg({ quality }).toBuffer();
      if (out.length <= MAX_BYTES) return { buf: out, ext: "jpg", warn: null };
    }
  }
  return { buf: out, ext: "jpg", warn: `tidak turun ke <=1MB (akhir: ${(out.length / 1e6).toFixed(2)}MB), upload versi terkecil` };
}

async function main() {
  const dbMap = await fetchDbMap();
  const gresikMap = await fetchGresikMap();
  const scan = scanLocal(localRoot);

  // group by ${plant}|${normMaterial}
  const groups = new Map(); // key -> filePath[]
  const multiMaterialFiles = [];
  const fileToMaterials = new Map();
  for (const f of scan.files) {
    const list = fileToMaterials.get(f.filePath) || [];
    list.push(f.material);
    fileToMaterials.set(f.filePath, list);
  }
  for (const [filePath, materials] of fileToMaterials) {
    if (materials.length > 1) multiMaterialFiles.push({ filePath, materials });
  }
  for (const f of scan.files) {
    const key = `${f.plant}|${normMaterial(f.material)}`;
    if (!groups.has(key)) groups.set(key, []);
    if (!groups.get(key).includes(f.filePath)) groups.get(key).push(f.filePath);
  }

  const unmatched = []; // {filePath, plant, material, reason}
  const matched = new Map(); // dbKey -> { row, files: sorted[] }
  for (const [key, files] of groups) {
    const [plant, mat] = key.split("|");
    const row = plant === "GRS" ? gresikMap.get(mat) : dbMap.get(key);
    if (!row) {
      for (const filePath of files) unmatched.push({ filePath, plant, material: mat, reason: plant === "GRS" ? "tidak ada di stok Gresik (UPT-GRS)" : "tidak ada di DB (STK-SAP) utk plant ini" });
      continue;
    }
    const sorted = [...files].sort(naturalCompare);
    matched.set(key, { row, plant, material: mat, files: sorted });
  }

  // --upt filter (applies to report + commit scope)
  const uptFilterLower = UPT_FILTER ? UPT_FILTER.toLowerCase() : null;
  function plantMatchesUptFilter(plant) {
    if (!uptFilterLower) return true;
    const name = Object.keys(PLANT_MAP).find(k => PLANT_MAP[k] === plant) || "";
    return name.includes(uptFilterLower);
  }

  // --- per-UPT report
  const byPlant = {};
  for (const plant of Object.values(PLANT_MAP)) {
    if (!plantMatchesUptFilter(plant)) continue;
    const dbMaterialsForPlant = plant === "GRS"
      ? [...gresikMap.entries()].map(([mat, row]) => [`GRS|${mat}`, row])
      : [...dbMap.entries()].filter(([k]) => k.startsWith(plant + "|"));
    const withPhoto = [...matched.entries()].filter(([k]) => k.startsWith(plant + "|"));
    const withPhotoKeys = new Set(withPhoto.map(([k]) => k));
    const withoutPhoto = dbMaterialsForPlant.filter(([k]) => !withPhotoKeys.has(k)).map(([, row]) => row.id);
    const overTwoPhotos = withPhoto.filter(([, v]) => v.files.length > 2).map(([, v]) => ({ id: v.row.id, extra: v.files.slice(2) }));
    byPlant[plant] = {
      totalDbMaterials: dbMaterialsForPlant.length,
      withPhoto: withPhoto.length,
      withoutPhoto,
      overTwoPhotos,
    };
  }

  const report = {
    generatedAt: new Date().toISOString(),
    localRoot,
    byPlant,
    multiMaterialFiles,
    unmatched,
    unmatchedCamera: scan.unmatchedCamera,
    unmatchedNoName: scan.unmatchedNoName,
  };
  fs.writeFileSync(path.resolve(process.cwd(), "sap_foto_report.json"), JSON.stringify(report, null, 2));

  console.log(`\n=== SAP Foto Report (${COMMIT ? "COMMIT" : "DRY-RUN"}) ===`);
  for (const [plant, info] of Object.entries(byPlant)) {
    const name = Object.keys(PLANT_MAP).find(k => PLANT_MAP[k] === plant);
    console.log(`\n[${plant}] ${name}: ${info.withPhoto}/${info.totalDbMaterials} material dapat foto`);
    if (info.withoutPhoto.length) console.log(`  Tanpa foto (${info.withoutPhoto.length}): ${info.withoutPhoto.slice(0, 20).join(", ")}${info.withoutPhoto.length > 20 ? " ..." : ""}`);
    if (info.overTwoPhotos.length) console.log(`  >2 foto (extra diabaikan, ${info.overTwoPhotos.length}): ${info.overTwoPhotos.map(x => x.id).join(", ")}`);
  }
  if (multiMaterialFiles.length) {
    console.log(`\nFile multi-material (${multiMaterialFiles.length}):`);
    multiMaterialFiles.forEach(f => console.log(`  ${f.filePath} -> ${f.materials.join(", ")}`));
  }
  if (unmatched.length) {
    console.log(`\nUnmatched (${unmatched.length}):`);
    unmatched.slice(0, 30).forEach(u => console.log(`  ${u.filePath} [${u.plant}|${u.material}] - ${u.reason}`));
    if (unmatched.length > 30) console.log(`  ... +${unmatched.length - 30} lagi`);
  }
  if (scan.unmatchedCamera.length) {
    console.log(`\nFile kamera tanpa folder material (${scan.unmatchedCamera.length}):`);
    scan.unmatchedCamera.slice(0, 30).forEach(f => console.log(`  ${f}`));
  }
  if (scan.unmatchedNoName.length) {
    console.log(`\nFile tanpa nama material terbaca (${scan.unmatchedNoName.length}):`);
    scan.unmatchedNoName.slice(0, 30).forEach(f => console.log(`  ${f}`));
  }
  console.log(`\nReport lengkap: ./sap_foto_report.json`);

  if (!COMMIT) {
    console.log("\nDRY-RUN selesai, tidak ada perubahan DB/Storage. Jalankan ulang dengan --commit utk menerapkan.");
    return;
  }

  // --- commit mode
  let entries = [...matched.entries()].filter(([k]) => plantMatchesUptFilter(k.split("|")[0]));
  if (LIMIT) entries = entries.slice(0, LIMIT);

  let filled = 0, uploaded = 0, failed = 0;
  const updates = [];
  for (const [, { row, plant, material, files }] of entries) {
    const data = { ...(row.data || {}) };
    const slots = [
      { key: "fotoKeseluruhan", tag: "utama", file: files[0] },
      { key: "fotoNameplate", tag: "tambahan", file: files[1] },
    ];
    let rowChanged = false;
    for (const slot of slots) {
      if (!slot.file || data[slot.key]) continue; // fill-if-empty
      try {
        const rawBuf = fs.readFileSync(slot.file);
        const rawExt = path.extname(slot.file).slice(1).toLowerCase();
        const { buf, ext, warn } = await compressUnder1MB(rawBuf, rawExt);
        if (warn) console.warn(`  WARN ${row.id} ${slot.key}: ${warn}`);
        const mime = ext === "jpg" ? "image/jpeg" : `image/${ext}`;
        const objectPath = plant === "GRS" ? `gresik/${material}/${slot.tag}.${ext}` : `sap/${plant}/${material}/${slot.tag}.${ext}`;
        const res = await fetch(`${SUPABASE_URL}/storage/v1/object/stock-photos/${objectPath}`, {
          method: "POST",
          headers: {
            apikey: SUPABASE_KEY,
            Authorization: `Bearer ${SUPABASE_KEY}`,
            "Content-Type": mime,
            "x-upsert": "true",
          },
          body: buf,
        });
        if (!res.ok) throw new Error(`upload ${res.status}: ${await res.text()}`);
        data[slot.key] = `${SUPABASE_URL}/storage/v1/object/public/stock-photos/${encodeURI(objectPath)}`;
        uploaded++;
        rowChanged = true;
      } catch (err) {
        failed++;
        console.error(`  GAGAL ${row.id} ${slot.key}: ${err.message}`);
      }
    }
    if (rowChanged) {
      filled++;
      updates.push({ id: row.id, katalog_id: row.katalog_id, data });
    }
  }

  for (let i = 0; i < updates.length; i += 100) {
    const chunk = updates.slice(i, i + 100);
    const { error } = await supabase.from("stocks").upsert(chunk, { onConflict: "id" });
    if (error) { console.error("Upsert gagal:", error.message); failed += chunk.length; }
  }

  console.log(`\n=== COMMIT selesai ===\n${filled} material diisi, ${uploaded} foto diupload, ${failed} gagal.`);
}

main().catch(err => { console.error(err); process.exit(1); });
