import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const mojibake = /(?:â€|â†|â”|Ã|Â|ðŸ|�)/u;

function sourceFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const fullPath = path.join(dir, entry.name);
    return entry.isDirectory() ? sourceFiles(fullPath) : [fullPath];
  });
}

test("source files contain no common mojibake", () => {
  const files = [path.join(root, "App.jsx"), ...sourceFiles(path.join(root, "src"))]
    .filter(file => /\.(?:js|jsx|mjs|cjs|ts|tsx|mts|cts|css|html|json)$/iu.test(file));
  const findings = files.flatMap(file => {
    const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
    return lines.flatMap((line, index) => mojibake.test(line) ? [`${path.relative(root, file)}:${index + 1}`] : []);
  });
  assert.deepEqual(findings, [], `Mojibake ditemukan: ${findings.join(", ")}`);
});

test("TUG-10 material sisa uses a real em dash", () => {
  const source = fs.readFileSync(path.join(root, "src/lib/supabaseSync.js"), "utf8");
  assert.match(source, /keterangan: `\$\{t\.namaPekerjaan\|\|"-"\} — \$\{si\.statusMaterial\|\|""\}`/u);
  assert.doesNotMatch(source, /keterangan: `\$\{t\.namaPekerjaan[^`]*â/u);
});
