// Tandai banner/box yang isinya paragraf panjang dengan class .info-note supaya CSS bisa
// meringkasnya di HP (lihat docs/DESIGN_GUIDELINES.md bagian 12). Elemen dicari dari baris
// teks panjang, lalu naik ke tag pembuka terdekat.
import fs from "fs";
import path from "path";

const APPLY = process.argv.includes("--apply");
const SKIP = /BarcodePrintModal|KartuGantungModal|MaturityAuditSystem/;
const files = [...fs.readdirSync("src/components").filter(f => f.endsWith(".jsx")).map(f => path.join("src/components", f))];
const OPEN = /<(div|p|small|span)\b(?![^>]*\/>)/;

let n = 0;
for (const f of files) {
  if (SKIP.test(f)) continue;
  const src = fs.readFileSync(f, "utf8");
  const eol = src.includes("\r\n") ? "\r\n" : "\n";
  const lines = src.split(/\r?\n/);
  const targets = new Set();

  lines.forEach((ln, i) => {
    const t = ln.trim();
    // Baris teks murni (bukan atribut/kode): tidak diawali tag & tidak mengandung "=".
    if (/^</.test(t) || t.includes("=") || t.startsWith("//")) return;
    const txt = t.replace(/\{[^{}]*\}/g, "").replace(/<\/?[a-zA-Z][^>]*>/g, "").trim();
    if (txt.length < 100) return;
    // Naik cari tag pembuka terdekat.
    for (let j = i; j >= 0 && j > i - 3; j--) {
      const cand = lines[j];
      if (!OPEN.test(cand)) continue;
      // Tag pembuka harus benar-benar membungkus teks: tidak ada tag lain sesudahnya,
      // dan bukan potongan ekspresi kondisional.
      if (/<\/(div|p)>/.test(cand.slice(cand.search(OPEN)))) break;
      if (/&&\s*$/.test(cand) || /button|<span/.test(cand)) break;
      // Grid/label bukan paragraf.
      if (/display:\s*"grid"|textTransform/.test(cand)) break;
      targets.add(j); return;
    }
  });

  if (!targets.size) continue;
  for (const j of targets) {
    const ln = lines[j];
    if (/className=/.test(ln)) {
      lines[j] = ln.replace(/className="/, 'className="info-note ');
    } else {
      lines[j] = ln.replace(OPEN, m => `${m} className="info-note"`);
    }
    n++;
    console.log(`${path.basename(f)}:${j + 1}  ${lines[j].trim().slice(0, 95)}`);
  }
  if (APPLY) fs.writeFileSync(f, lines.join(eol));
}
console.log(APPLY ? "ditandai:" : "(dry run) calon:", n);
