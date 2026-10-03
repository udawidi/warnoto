import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const files = [
  "src/lib/roles.js",
  "src/lib/perms.js",
  "supabase/functions/admin-create-user/index.ts",
  "supabase/functions/admin-update-user/index.ts",
  "scripts/bulk_create_users.mjs",
];

test("RENEV/Perencanaan terdaftar konsisten di seluruh jalur akun", () => {
  const sources = Object.fromEntries(files.map((file) => [file, fs.readFileSync(file, "utf8")]));
  assert.match(sources["src/lib/roles.js"], /RENEV\s*:\s*["']Perencanaan["']/);
  assert.match(sources["src/lib/perms.js"], /RENEV\s*:/);
  for (const file of files.slice(2)) assert.match(sources[file], /RENEV/);
});

test("RENEV tetap UPT-scoped dan tidak mendapat kuota struktural", () => {
  for (const file of files.slice(2, 4)) {
    const source = fs.readFileSync(file, "utf8");
    assert.doesNotMatch(source, /UIT_SCOPED_ROLES\s*=.*RENEV/);
    assert.doesNotMatch(source, /UPT_ROLE_QUOTA\s*=.*RENEV/);
  }
});
