// Self-check untuk verifikasi asal telegram-webhook (Edge Function Deno, tidak
// bisa diimport langsung dari Node — dites mereplikasi secretCocok(), sama
// persis dengan yang di supabase/functions/telegram-webhook/index.ts).
import test from "node:test";
import assert from "node:assert/strict";

function secretCocok(headerVal, envVal) {
  if (!envVal) return true;
  return headerVal === envVal;
}

test("env kosong = fail-open, selalu lolos", () => {
  assert.equal(secretCocok(null, ""), true);
  assert.equal(secretCocok("apa saja", ""), true);
});

test("env di-set & header cocok = lolos", () => {
  assert.equal(secretCocok("rahasia-123", "rahasia-123"), true);
});

test("env di-set & header beda/kosong = ditolak", () => {
  assert.equal(secretCocok("salah", "rahasia-123"), false);
  assert.equal(secretCocok(null, "rahasia-123"), false);
  assert.equal(secretCocok("", "rahasia-123"), false);
});
