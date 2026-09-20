// Bump versi WARNOTO dengan carry-at-100: patch 0-99, saat mencapai 100 → minor +1, patch 00.
// Contoh: 2.0.99 → 2.1.0 (tampil V2.1.00), 2.1.99 → 2.2.0 (tampil V2.2.00). Major tetap.
// npm version bawaan TIDAK carry di batas 100 (2.0.99 → 2.0.100), makanya skrip sendiri.
// Simpan semver valid (tanpa leading zero) di package.json; padding 2-digit hanya di tampilan.
// ponytail: minor→major carry tak ditangani (YAGNI, minor masih jauh dari 100).
import { readFileSync, writeFileSync } from "node:fs";

export function nextVersion(v) {
  const [major, minor, patch] = v.split(".").map(Number);
  const c = minor * 100 + patch + 1;
  return `${major}.${Math.floor(c / 100)}.${c % 100}`;
}

// Self-check: batas carry harus benar.
console.assert(nextVersion("2.0.96") === "2.0.97", "bump 96→97");
console.assert(nextVersion("2.0.99") === "2.1.0", "carry 99→2.1.0");
console.assert(nextVersion("2.1.99") === "2.2.0", "carry 199→2.2.0");

const isMain = import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("bump.mjs");
if (isMain) {
  const path = new URL("../package.json", import.meta.url);
  const pkg = JSON.parse(readFileSync(path, "utf8"));
  const next = nextVersion(pkg.version);
  pkg.version = next;
  writeFileSync(path, JSON.stringify(pkg, null, 2) + "\n");
  console.log(`versi: ${next}`);
}
