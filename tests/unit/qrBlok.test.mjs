import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { lokasiScanUrlFor } from "../../src/lib/utils.js";

const migration = fs.readFileSync(new URL("../../supabase/migrations/20260918_lokasi_public_qr.sql", import.meta.url), "utf8");
const schema = fs.readFileSync(new URL("../../supabase/schema.sql", import.meta.url), "utf8");
const labelsMigration = fs.readFileSync(new URL("../../supabase/migrations/20260921_public_block_material_labels.sql", import.meta.url), "utf8");
const verifier = fs.readFileSync(new URL("../../supabase/verify_lokasi_public_qr.sql", import.meta.url), "utf8");
const builder = fs.readFileSync(new URL("../../src/lib/docBuilders.js", import.meta.url), "utf8");
const utils = fs.readFileSync(new URL("../../src/lib/utils.js", import.meta.url), "utf8");

test("QR blok memakai token di fragment dan domain produksi saat offline/local", () => {
  const url = lokasiScanUrlFor("BLOK-TEST", "123e4567-e89b-42d3-a456-426614174000");
  assert.match(utils, /https:\/\/pln\.warnoto\.com/);
  assert.match(url, /\/?loc=BLOK-TEST#t=/);
  assert.equal(url.includes("token="), false);
});

test("verifier QR blok memeriksa label payload tanpa mutasi", () => {
  assert.match(verifier, /labels_present/);
  assert.match(verifier, /candidate_found/);
  assert.match(verifier, /coalesce\(\(select labels_present from label_check\), false\)/);
  assert.match(verifier, /nullif\(item->>'sapLabel'/);
  assert.match(verifier, /nullif\(item->>'jenisBarang'/);
  assert.doesNotMatch(verifier, /\b(insert|update|delete|alter|drop|create)\b/i);
});

test("kontrak QR blok mengembalikan scope lokasi dan qty positif", () => {
  for (const source of [migration, schema, labelsMigration]) {
    if (source !== labelsMigration) assert.match(source, /public_token uuid/);
    assert.match(source, /create or replace function public\.public_block_stock/);
    assert.match(source, /set search_path = pg_catalog/);
    assert.doesNotMatch(source, /set search_path = pg_catalog, public/);
    assert.match(source, /'upt'/);
    assert.match(source, /'subgudang'/);
    if (source === schema || source === labelsMigration) {
      assert.match(source, /'sapLabel'/);
      assert.match(source, /'jenisBarang'/);
    }
    if (source === labelsMigration) {
      assert.match(source, /begin;/i);
      assert.match(source, /commit;/i);
      assert.doesNotMatch(source, /end end as sap_label/i);
    }
    assert.match(source, /where q\.qty > 0/);
    assert.match(source, /grant execute on function public\.public_block_stock\(text, uuid\) to anon, authenticated/);
  }
  for (const source of [schema, labelsMigration]) {
    assert.match(source, /select classified\.katalog_id, classified\.sap_label, classified\.jenis_barang, sum\(classified\.qty\)/);
    assert.match(source, /group by classified\.katalog_id, classified\.sap_label, classified\.jenis_barang/);
    assert.match(source, /s\.id like 'STK-PREMEM-%'/);
    assert.doesNotMatch(source, /group by s\.katalog_id[^\n]*s\.data->>'sapStatus'/i);
  }
});

test("kartu QR blok dicetak A6 dengan QR besar dan instruksi Mode Lapangan", () => {
  assert.match(builder, /@page \{ size: A6 portrait; margin: 0; \}/);
  assert.match(builder, /\.label \.qr \{ width: 48mm; height: 48mm;/);
  assert.match(builder, /class="pln-logo" src="\$\{PLN_LOGO_DATA_URI\}" alt="Logo PLN"/);
  assert.match(builder, /\.pln-logo \{ position: absolute; top: 7mm; left: 8mm;/);
  assert.match(builder, /\.label \{ border: 1px solid #cbd5e1;/);
  assert.match(builder, /\.label \{ border: 1px solid #cbd5e1; border-radius: 5mm; \} \}/);
  assert.match(builder, /Stock Opname Mode Lapangan/);
});
