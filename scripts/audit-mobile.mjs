// Scanner anti-pattern responsif mobile — dipakai untuk mengukur progres
// tiap fase di docs/MOBILE_AUDIT_2026-08-15.md.
//   node scripts/audit-mobile.mjs          -> ringkasan skor per file
//   node scripts/audit-mobile.mjs --lines   -> plus baris yang melanggar
//
// Skor makin tinggi = makin banyak cacat. Target tiap fase: angka TOTAL turun.
import fs from "fs";
import path from "path";

const ROOT = path.resolve(process.cwd());
const SHOW_LINES = process.argv.includes("--lines");

// Ambang: layar HP acuan 360-390px.
const PHONE = 360;

// Baris yang sudah dinetralkan tidak dihitung, supaya skor tetap berarti:
// - guard `isMobile` di baris yang sama sudah menangani layar kecil;
// - `<table>`/`<td>`/`<th>` di file yang memakai pola `.mobile-card-table`
//   sudah dipaksa `min-width:0` dan `white-space:normal` oleh CSS di HP.
const HIT = {
  GRID: ln => [...ln.matchAll(/gridTemplateColumns:\s*[`"']repeat\((\d+)/g)]
    .filter(m => +m[1] > 2 && !/isMobile/.test(ln)).length,
  MINMAX: ln => /isMobile/.test(ln) ? 0
    : [...ln.matchAll(/minmax\((\d{3,})px/g)].filter(m => +m[1] >= 260).length,
  MINW: (ln, src) => (/<table[\s>]/.test(ln) && /mobile-card-table/.test(src)) ? 0
    : [...ln.matchAll(/minWidth:\s*[`"']?(\d{3,})/g)].filter(m => +m[1] >= PHONE - 20).length,
  FIXW: ln => [...ln.matchAll(/(?<![a-zA-Z])width:\s*[`"']?(\d{3,})px/g)].filter(m => +m[1] >= PHONE - 20).length,
  FONT: ln => [...ln.matchAll(/fontSize:\s*[`"']?(\d+)/g)].filter(m => +m[1] < 12).length,
  NOWRAP: (ln, src) => {
    if (!/whiteSpace:\s*[`"']nowrap/.test(ln) || /minWidth\s*:\s*0/.test(ln)) return 0;
    if (/<th[\s>]/.test(ln)) return 0;
    if (/<td[\s>]/.test(ln) && /mobile-card-table/.test(src)) return 0;
    return 1;
  },
};
const WEIGHT = { GRID: 3, MINMAX: 2, MINW: 3, FIXW: 3, FONT: 1, NOWRAP: 1, TABLE_RAW: 4 };

const files = [];
for (const d of ["App.jsx", "src/components", "src/hooks"]) {
  const p = path.join(ROOT, d);
  if (!fs.existsSync(p)) continue;
  if (fs.statSync(p).isFile()) files.push(p);
  else for (const f of fs.readdirSync(p)) if (f.endsWith(".jsx")) files.push(path.join(p, f));
}

const rows = [];
const total = {};
for (const f of files) {
  const src = fs.readFileSync(f, "utf8");
  const lines = src.split(/\r?\n/);
  // Tabel tanpa fallback kartu = cacat terberat (scroll horizontal di HP).
  const tableRaw = Math.max(0, (src.match(/<table/g) || []).length - (src.match(/mobile-card-table["\s]/g) || []).length);
  const rec = { file: path.relative(ROOT, f).split(path.sep).join("/"), TABLE_RAW: tableRaw };
  for (const k of Object.keys(HIT)) rec[k] = 0;
  const detail = [];
  lines.forEach((ln, i) => {
    const tags = [];
    for (const [k, fn] of Object.entries(HIT)) { const n = fn(ln, src); if (n) { rec[k] += n; tags.push(k); } }
    if (tags.length && SHOW_LINES) detail.push(`  L${i + 1} [${tags.join(",")}] ${ln.trim().slice(0, 120)}`);
  });
  rec.score = Object.entries(WEIGHT).reduce((s, [k, w]) => s + rec[k] * w, 0);
  for (const k of Object.keys(WEIGHT)) total[k] = (total[k] || 0) + rec[k];
  rec.detail = detail;
  rows.push(rec);
}

rows.sort((a, b) => b.score - a.score);
console.log(["file", "score", ...Object.keys(WEIGHT)].join("\t"));
for (const r of rows) {
  if (!r.score) continue;
  console.log([r.file, r.score, ...Object.keys(WEIGHT).map(k => r[k])].join("\t"));
  if (SHOW_LINES) r.detail.forEach(d => console.log(d));
}
const grand = rows.reduce((s, r) => s + r.score, 0);
console.log("\nTOTAL SKOR", grand, JSON.stringify(total));
