// Satukan warna TEKS yang perannya sama tapi nilainya beda-beda ke token di src/theme.js.
// Hanya keluarga abu (teks sekunder) dan biru (aksen). Warna yang menempel pada latar
// bertint (amber, cyan, merah muda) dibiarkan — itu pasangan warna, bukan inkonsistensi.
import fs from "fs";
import path from "path";
const MAP = {
  "#374151": "#64748b", "#4b5563": "#64748b", "#475569": "#64748b",
  "#334155": "#64748b", "#94a3b8": "#64748b", "#9ca3af": "#64748b",
  "#6b7280": "#64748b",
  "#1e40af": "#1d4ed8", "#1e3a8a": "#1d4ed8", "#2563eb": "#1d4ed8", "#0f4c81": "#1d4ed8",
};
const files = [...fs.readdirSync("src/components").filter(f => f.endsWith(".jsx")).map(f => path.join("src/components", f)), "App.jsx"];
let n = 0;
for (const f of files) {
  if (/KartuGantungModal|BarcodePrintModal/.test(f)) continue;
  const src = fs.readFileSync(f, "utf8");
  const out = src.replace(/(?<![a-zA-Z])color:\s*"(#[0-9a-fA-F]{6})"/g, (m, hex) => {
    const to = MAP[hex.toLowerCase()];
    if (!to) return m;
    n++; return `color: "${to}"`;
  });
  if (out !== src) { fs.writeFileSync(f, out); console.log(path.basename(f)); }
}
console.log("ganti:", n);
