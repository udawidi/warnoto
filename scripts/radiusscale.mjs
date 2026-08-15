// Skala sudut: 10 (kontrol & kotak kecil), 14 (kartu/panel/modal), 999 (pill).
// Layout cetak dikecualikan.
import fs from "fs";
import path from "path";
const snap = v => v >= 999 ? v : v <= 10 ? 10 : 14;
const files = [...fs.readdirSync("src/components").filter(f => f.endsWith(".jsx")).map(f => path.join("src/components", f)), "App.jsx"];
let n = 0;
for (const f of files) {
  if (/KartuGantungModal|BarcodePrintModal/.test(f)) continue;
  const src = fs.readFileSync(f, "utf8");
  const out = src.replace(/borderRadius:\s*(\d+)(?![\d.])/g, (m, d) => {
    const to = snap(+d);
    if (to === +d) return m;
    n++; return `borderRadius: ${to}`;
  });
  if (out !== src) fs.writeFileSync(f, out);
}
console.log("ganti:", n);
