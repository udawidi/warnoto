// Pass kedua: banner satu baris (<div ...>teks panjang</div>) yang belum ketangkap pass
// pertama karena baris tag dan teksnya menyatu.
import fs from "fs";
import path from "path";
const APPLY = process.argv.includes("--apply");
const SKIP = /BarcodePrintModal|KartuGantungModal|MaturityAuditSystem/;
const files = fs.readdirSync("src/components").filter(f => f.endsWith(".jsx")).map(f => path.join("src/components", f));
let n = 0;
for (const f of files) {
  if (SKIP.test(f)) continue;
  const src = fs.readFileSync(f, "utf8");
  const eol = src.includes("\r\n") ? "\r\n" : "\n";
  const lines = src.split(/\r?\n/);
  let hit = 0;
  lines.forEach((ln, i) => {
    if (/className="[^"]*info-note/.test(ln)) return;
    const m = ln.match(/<(div|p)\b([^>]*)>([^<]*(?:<b>[^<]*<\/b>[^<]*)*)<\/\1>/);
    if (!m) return;
    if (/display:\s*"?grid|textTransform/.test(m[2])) return;
    // "=>" berarti regex atribut terpotong di arrow function: bukan banner.
    if (m[2].includes("=>")) return;
    const txt = m[3].replace(/\{[^{}]*\}/g, "").replace(/<\/?b>/g, "").trim();
    if (txt.length < 100) return;
    const tag = `<${m[1]}${m[2]}>`;
    const withCls = /className="/.test(tag)
      ? tag.replace(/className="/, 'className="info-note ')
      : tag.replace(`<${m[1]}`, `<${m[1]} className="info-note"`);
    lines[i] = ln.replace(tag, withCls);
    hit++; n++;
    console.log(`${path.basename(f)}:${i + 1} ${txt.slice(0, 70)}`);
  });
  if (hit && APPLY) fs.writeFileSync(f, lines.join(eol));
}
console.log(APPLY ? "ditandai:" : "(dry run) calon:", n);
