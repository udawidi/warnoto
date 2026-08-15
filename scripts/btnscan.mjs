import fs from "fs";
import path from "path";

// Ambil tag <button ...> utuh: telusuri maju sambil menghitung kedalaman {} dan kutip,
// supaya "=>" di dalam onClick tidak dikira akhir tag.
export function buttonTags(src) {
  const out = [];
  for (let i = 0; i < src.length; i++) {
    if (!src.startsWith("<button", i)) continue;
    let depth = 0, q = null;
    for (let j = i + 7; j < src.length; j++) {
      const c = src[j];
      if (q) { if (c === q && src[j - 1] !== "\\") q = null; continue; }
      if (c === '"' || c === "'" || c === "`") { q = c; continue; }
      if (c === "{") depth++;
      else if (c === "}") depth--;
      else if (c === ">" && depth === 0) { out.push({ start: i, end: j + 1, text: src.slice(i, j + 1) }); i = j; break; }
    }
  }
  return out;
}

if (process.argv[1].endsWith("btnscan.mjs")) {
  const files = [...fs.readdirSync("src/components").filter(f => f.endsWith(".jsx")).map(f => path.join("src/components", f)), "App.jsx"];
  const bg = {}; let total = 0, tok = 0, cls = 0, bare = 0;
  for (const f of files) {
    for (const t of buttonTags(fs.readFileSync(f, "utf8"))) {
      total++;
      if (/sty\.btn\(/.test(t.text)) { tok++; continue; }
      const b = t.text.match(/background(?:Color)?:\s*([^,}]+)/);
      if (b) bg[b[1].trim().slice(0, 70)] = (bg[b[1].trim().slice(0, 70)] || 0) + 1;
      else if (/className=/.test(t.text)) cls++;
      else bare++;
    }
  }
  console.log("total", total, "| sty.btn", tok, "| class", cls, "| polos", bare, "| inline bg", Object.values(bg).reduce((a, b) => a + b, 0));
  for (const [k, v] of Object.entries(bg).sort((a, b) => b[1] - a[1])) console.log(String(v).padStart(3), k);
}
