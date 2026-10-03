import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { normalizeVersion, nextVersion } from "../../scripts/bump.mjs";

test("version normalization and carry use base 100", () => {
  assert.equal(normalizeVersion("2.0.154"), "2.1.54");
  assert.equal(normalizeVersion("2.100.0"), "3.0.0");
  assert.equal(nextVersion("2.0.99"), "2.1.0");
  assert.equal(nextVersion("2.99.99"), "3.0.0");
});

test("bump hook and lock stay synchronized", () => {
  const hook = readFileSync(new URL("../../utils/hooks/pre-commit", import.meta.url), "utf8");
  const script = readFileSync(new URL("../../scripts/bump.mjs", import.meta.url), "utf8");
  const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
  const lock = JSON.parse(readFileSync(new URL("../../package-lock.json", import.meta.url), "utf8"));
  assert.match(hook, /node scripts\/bump\.mjs/);
  assert.match(script, /lock\.version = next/);
  assert.match(script, /lock\.packages\[""\]\.version = next/);
  assert.equal(pkg.version, lock.version);
  assert.equal(pkg.version, lock.packages[""].version);
});
