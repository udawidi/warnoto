// Samakan bentuk tombol yang masih pakai inline style dengan token sty.btn:
// radius 10, fontWeight 700. Pill (999/50%) dibiarkan — itu bentuk chip, bukan tombol.
import fs from "fs";
import path from "path";
const files = [...fs.readdirSync("src/components").filter(f => f.endsWith(".jsx")).map(f => path.join("src/components", f)), "App.jsx"];
let n = 0;
for (const f of files) {
  const src = fs.readFileSync(f, "utf8");
  const out = src.replace(/<button[\s\S]{0,600}?>/g, tag => {
    if (/sty\.btn\(/.test(tag)) return tag;
    return tag
      .replace(/borderRadius:\s*(\d+)(?![\d.])/g, (m, d) => (+d === 999 || +d === 10) ? m : (n++, "borderRadius: 10"))
      .replace(/fontWeight:\s*(\d+)(?![\d.])/g, (m, d) => (+d === 700) ? m : (n++, "fontWeight: 700"));
  });
  if (out !== src) { fs.writeFileSync(f, out); console.log(path.basename(f)); }
}
console.log("ganti:", n);
