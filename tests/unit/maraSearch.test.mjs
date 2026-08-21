import test from "node:test";
import assert from "node:assert/strict";
import { maraQueryGroups, matchesMaterialSearch } from "../../src/lib/sap.js";

test("per-kata: satu grup per kata, AND antar kata (dict-agnostic)", () => {
  const groups = maraQueryGroups("kabel tembaga");
  assert.equal(groups.length, 2);
  assert.ok(groups[0].includes("kabel"));
  assert.ok(groups[1].includes("tembaga"));
});

test("normalisasi: spasi berlebih + kapital tidak menambah/mengurangi grup", () => {
  const groups = maraQueryGroups("KABEL   Tembaga");
  assert.equal(groups.length, 2);
  assert.ok(groups[0].includes("kabel"));
  assert.ok(groups[1].includes("tembaga"));
});

test("tiap grup non-kosong dan memuat kata aslinya", () => {
  const groups = maraQueryGroups("pemutus tegangan");
  groups.forEach((alts, i) => {
    assert.ok(Array.isArray(alts) && alts.length > 0);
  });
  const words = "pemutus tegangan".split(" ");
  groups.forEach((alts, i) => assert.ok(alts.includes(words[i])));
});

test("fuzzy typo 1-huruf pada kata >=4 tetap ketemu (Levenshtein <=1)", () => {
  assert.ok(matchesMaterialSearch(["TRANSFORMATOR DISTRIBUSI"], "transformatr"));
  assert.ok(matchesMaterialSearch(["TRANSFORMATOR DISTRIBUSI"], "transformastor"));
});

test("fuzzy tidak over-match: beda >1 edit pada kata >=4 tetap ditolak", () => {
  assert.equal(matchesMaterialSearch(["TRANSFORMATOR DISTRIBUSI"], "transformerXX"), false);
  assert.equal(matchesMaterialSearch(["KABEL TEMBAGA"], "tembakau"), false);
});

test("fuzzy tidak berlaku untuk kata <4 huruf (tetap prefix/exact lama)", () => {
  assert.equal(matchesMaterialSearch(["ROD PENTANAHAN"], "rad"), false);
});
