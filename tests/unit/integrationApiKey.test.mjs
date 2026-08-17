// Self-check untuk logika hash+scope Edge Function supabase/functions/integration-api
// (Fase 1 "Integrasi API"). Function-nya jalan di runtime Deno jadi tidak bisa
// diimport langsung dari Node — dites mereplikasi 2 fungsi murni (sha256Hex,
// cek scope) yang jadi jantung trust boundary API-key.
import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";

async function sha256Hex(text) {
  const buf = await webcrypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

const SCOPE_BY_ENDPOINT = { stock: "read:stock", catalog: "read:catalog", tug: "read:tug" };
function hasScope(scopes, endpoint) {
  const required = SCOPE_BY_ENDPOINT[endpoint];
  return !required || (scopes || []).includes(required);
}

// Replika cek expiry + IP allowlist dari requireApiKey (Fase 1.5 hardening).
function isExpired(expiresAt) {
  return !!expiresAt && new Date(expiresAt) < new Date();
}
function isIpAllowed(allowedIps, ip) {
  return !(Array.isArray(allowedIps) && allowedIps.length > 0 && !allowedIps.includes(ip));
}

test("sha256Hex deterministik & sensitif terhadap perubahan key", async () => {
  const h1 = await sha256Hex("wrn_live_abc123");
  const h2 = await sha256Hex("wrn_live_abc123");
  const h3 = await sha256Hex("wrn_live_abc124");
  assert.equal(h1, h2);
  assert.notEqual(h1, h3);
  assert.equal(h1.length, 64);
});

test("hasScope menolak key tanpa scope endpoint, terima kalau ada", () => {
  assert.equal(hasScope(["read:catalog"], "stock"), false);
  assert.equal(hasScope(["read:stock"], "stock"), true);
  assert.equal(hasScope(["read:stock", "read:catalog"], "catalog"), true);
  assert.equal(hasScope([], "tug"), false);
});

test("isExpired menolak key lewat tanggal, terima yang belum/tanpa expiry", () => {
  assert.equal(isExpired("2020-01-01T00:00:00Z"), true);
  assert.equal(isExpired(new Date(Date.now() + 3600_000).toISOString()), false);
  assert.equal(isExpired(null), false);
});

test("isIpAllowed menolak IP di luar allowlist, terima IP dalam & allowlist kosong", () => {
  assert.equal(isIpAllowed(["10.91.21.5"], "203.0.113.10"), false);
  assert.equal(isIpAllowed(["10.91.21.5"], "10.91.21.5"), true);
  assert.equal(isIpAllowed([], "203.0.113.10"), true);
  assert.equal(isIpAllowed(null, "203.0.113.10"), true);
});
