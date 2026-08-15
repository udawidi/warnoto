// Snap inline fontSize ke skala tipografi resmi (docs/DESIGN_GUIDELINES.md bagian 11).
// Skala: 12 13 15 17 20 24 32. Ukuran di luar skala dibulatkan ke tetangga terdekat.
// Layout cetak dikecualikan (font kecil/besar di sana disengaja).
import fs from "fs";
import path from "path";

const MAP = { 14:13, 16:15, 18:17, 19:20, 22:20, 26:24, 28:24, 30:32, 34:32, 36:32, 38:32, 40:32 };
const SKIP_FILE = /KartuGantungModal|BarcodePrintModal/;
// Blok Berita Acara di InspeksiMaterialCadangTab juga layout cetak.
const SKIP_RANGE = { "InspeksiMaterialCadangTab.jsx": [640, 720] };

const files = [...fs.readdirSync("src/components").filter(f => f.endsWith(".jsx")).map(f => path.join("src/components", f)), "App.jsx"];
let touched = 0, hits = 0;
for (const f of files) {
  const base = path.basename(f);
  if (SKIP_FILE.test(base)) continue;
  const range = SKIP_RANGE[base];
  const src = fs.readFileSync(f, "utf8");
  const eol = src.includes("\r\n") ? "\r\n" : "\n";
  const lines = src.split(/\r?\n/);
  let n = 0;
  const out = lines.map((ln, i) => {
    if (range && i + 1 >= range[0] && i + 1 <= range[1]) return ln;
    return ln.replace(/(fontSize:\s*)(\d+)(?![\d.])/g, (m, p, d) => {
      const to = MAP[+d];
      if (!to) return m;
      n++; return p + to;
    });
  });
  if (n) { fs.writeFileSync(f, out.join(eol)); touched++; hits += n; console.log(base, n); }
}
console.log("file:", touched, "ganti:", hits);
