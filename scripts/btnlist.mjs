import fs from "fs";
import path from "path";
import { buttonTags } from "./btnscan.mjs";
const files = [...fs.readdirSync("src/components").filter(f => f.endsWith(".jsx")).map(f => path.join("src/components", f)), "App.jsx"];
for (const f of files) {
  const src = fs.readFileSync(f, "utf8");
  for (const t of buttonTags(src)) {
    if (/sty\.btn\(/.test(t.text)) continue;
    const b = t.text.match(/background(?:Color)?:\s*([^,}]+)/);
    if (!b) continue;
    const v = b[1].trim();
    if (/transparent|\?|`/.test(v)) continue;
    console.log(`${path.basename(f)}:${src.slice(0, t.start).split("\n").length}  bg=${v}`);
    console.log("    " + t.text.replace(/\s+/g, " ").slice(0, 170));
  }
}
