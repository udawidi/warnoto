// Pencocokan nameplate OCR -> Master Katalog. Jaga metrik Jaccard + stopword +
// lantai token supaya overlap kata generik tidak lagi disalahartikan "mirip 100%"
// (bug asal: field type/merk yg tak ada di katalog + denominator kecil).
import test from "node:test";
import assert from "node:assert";
import { matchNameplateToKatalog, nameplateTextSim, matchNameplateAll, npTokens, npNums, NAMEPLATE_MIN } from "../../src/lib/rag.js";

test("OCR yg cuma berbagi kata generik dgn katalog -> skor rendah, bukan 1.0", () => {
  const ocr = "PLN TRAFO TYPE 3 PHASE VOLT KV";
  const katalogList = [{ katalog: "99999", name: "Isolator Keramik", category: "Isolator" }];
  const res = matchNameplateToKatalog(ocr, katalogList);
  // semua token OCR adalah stopword -> tak ada token bermakna sama sekali, tak lolos NAMEPLATE_MIN
  assert.strictEqual(res.length, 0);
});

test("OCR mengandung nomor katalog verbatim -> katalog itu ranking teratas skor tinggi", () => {
  const ocr = "PLN TRAFO NO SERI 123456789 KVA 100";
  const katalogList = [
    { katalog: "123456789", name: "Trafo Distribusi", category: "Trafo" },
    { katalog: "55555", name: "Kabel NYY", category: "Kabel" },
  ];
  const res = matchNameplateToKatalog(ocr, katalogList);
  assert.strictEqual(res[0].katalog, "123456789");
  assert.ok(res[0].similarity >= 0.9, `expected high score, got ${res[0].similarity}`);
});

test("dua nameplate beda yg cuma berbagi 1-2 kata generik tidak 100%", () => {
  const qTokens = npTokens("PLN TRAFO TYPE ISOLATOR KERAMIK COKLAT");
  const qNums = npNums("PLN TRAFO TYPE ISOLATOR KERAMIK COKLAT");
  const sim = nameplateTextSim(qTokens, qNums, "PLN TRAFO TYPE ARRESTER LOGAM PUTIH");
  assert.ok(sim < 1, `expected < 1, got ${sim}`);
  assert.ok(sim < NAMEPLATE_MIN, `expected below threshold (noise), got ${sim}`);
});

test("nameplateTextSim: nomor katalog sama antar dua OCR -> skor tinggi (>=0.9)", () => {
  const qTokens = npTokens("KABEL NYY 24KV");
  const qNums = npNums("KABEL NYY 24KV SERIAL 88888");
  const sim = nameplateTextSim(qTokens, qNums, "KABEL NYY SERIAL 88888");
  assert.ok(sim >= 0.9, `expected >= 0.9, got ${sim}`);
});

test("matchNameplateAll dedup: skor tertinggi antar sumber katalog & stock dipakai, tanpa duplikat katalog", () => {
  const ocr = "TRAFO NO SERI 111112222 KVA 100";
  const katalogList = [{ katalog: "111112222", name: "Trafo Distribusi", category: "Trafo" }];
  const stocks = [
    { katalog: "111112222", fotoNameplateOcr: "TRAFO SERI 111112222 KVA 100" },
    { katalog: "111112222", fotoNameplateOcr: "TRAFO SERI 111112222 KVA 100" }, // duplikat entri stok, katalog sama
  ];
  const res = matchNameplateAll(ocr, katalogList, stocks);
  const matches = res.filter(r => r.katalog === "111112222");
  assert.strictEqual(matches.length, 1, "harus dedup per katalog, bukan muncul berkali-kali");
  assert.ok(matches[0].similarity >= 0.9);
});
