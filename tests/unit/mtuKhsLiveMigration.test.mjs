import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildRollback, compact, inferRow272, mapRows, NON_SITE_BAYS, siteKeys } from "../../scripts/generate_mtu_khs_live_migration.mjs";

const masters = () => ({
  upt: [{ id: "UPT-1", nama: "UPT TEST" }],
  ultg: [{ id: "ULTG-1", upt_id: "UPT-1", nama: "ULTG TEST" }, { id: "ULTG-2", upt_id: "UPT-1", nama: "ULTG LAIN" }],
  gi: [{ id: "GI-1", upt_id: "UPT-1", ultg_id: "ULTG-1", nama: "GI 150KV TEST" }],
  bay: [{ id: "BAY-1", gardu_induk_id: "GI-1", nama: "PHT 150KV X #1" }],
  gudang: [{ id: "G-1", upt_id: "UPT-1", nama: "TEST" }],
  supplier: [{ id: "S-1", nama: "PT TWINK (TWINK)" }],
});

const row = (rowNumber, source) => ({ rowNumber, rawData: { rowNumber }, source: { procurementYear: 2024, provider: "TWINK", uptName: "UPT TEST", ultgName: "ULTG TEST", giName: "GI 150 kV TEST", bayName: "PHT 150 kV X #1", mtuCode: "CT150-001", materialName: "CT150", qty: 1, sifatPekerjaan: "MATERIAL", ...source } });

test("live resolver uses safe voltage/type aliases and deterministic missing masters", () => {
  assert.equal(compact("GITET 500  kV Paiton"), "GISTET 500KV PAITON");
  const result = mapRows(masters(), { rows: [row(1, { giName: "GI 150 kV NEW GI", bayName: "BAY BARU" })] }, 2024);
  assert.equal(result.rows[0].source.uptId, "UPT-1");
  assert.equal(result.missingGi.length, 1);
  assert.equal(result.missingBay.length, 1);
});

test("GIS remains distinct from GI while GITET and GISTET are aliases", () => {
  assert.notDeepEqual(siteKeys("GIS 150 kV WARU"), siteKeys("GI 150 kV WARU"));
  assert.deepEqual(siteKeys("GITET 500 kV PAITON"), siteKeys("GISTET 500 kV PAITON"));
});

test("non-site labels do not become Bay master rows", () => {
  assert.equal(NON_SITE_BAYS.has("SPARE"), true);
  const result = mapRows(masters(), { rows: [row(2, { giName: "-", bayName: "SF6 REGULATOR" })] }, 2024);
  assert.equal(result.rows[0].source.garduIndukId, null);
  assert.equal(result.rows[0].source.bayId, null);
  assert.equal(result.missingBay.length, 0);
});

test("row 272 inference requires exactly one sibling code", () => {
  const rows = [row(272, { mtuCode: "" }), row(321, { mtuCode: "CVT150-007" })];
  const result = inferRow272(rows);
  assert.equal(result.applied, true);
  assert.equal(rows[0].source.mtuCode, "CVT150-007");
  assert.throws(() => inferRow272([row(272, { mtuCode: "" }), row(321, { mtuCode: "CVT150-001" }), row(322, { mtuCode: "CVT150-002" })]), /ASSERTION_FAILED/);
});

test("wrong source ULTG resolves to the unique GI parent", () => {
  const result = mapRows(masters(), { rows: [row(87, { ultgName: "ULTG LAIN", giName: "GI 150 kV TEST" })] }, 2026);
  assert.equal(result.rows[0].source.ultgId, "ULTG-1");
  assert.equal(result.rows[0].source.garduIndukId, "GI-1");
  assert.equal(result.rows[0].source.mappingProvenance.ULTG.method, "gi-parent");
  assert.equal(result.rows[0].source.sourceHierarchyConflict.authoritativeTargetId, "ULTG-1");
});

test("inactive exact GI and Bay are reused and marked for reactivation", () => {
  const fixture = masters();
  fixture.gi[0].active = false;
  fixture.bay[0].active = false;
  const result = mapRows(fixture, { rows: [row(90)] }, 2024);
  assert.equal(result.rows[0].source.garduIndukId, "GI-1");
  assert.equal(result.rows[0].source.bayId, "BAY-1");
  assert.deepEqual(result.reactivatedGi.map(item => item.id), ["GI-1"]);
  assert.deepEqual(result.reactivatedBay.map(item => item.id), ["BAY-1"]);
});

test("generic Bay elsewhere never changes the authoritative NEWPACITAN GI", () => {
  const fixture = masters();
  fixture.gi.push({ id: "GI-NEWPACITAN", upt_id: "UPT-1", ultg_id: "ULTG-1", nama: "GI 150KV NEWPACITAN", active: true });
  fixture.gi.push({ id: "GI-OTHER", upt_id: "UPT-1", ultg_id: "ULTG-1", nama: "GI OTHER", active: true });
  fixture.bay.push({ id: "BAY-GENERIC", gardu_induk_id: "GI-OTHER", nama: "BUSBAR 150KV", active: true });
  const result = mapRows(fixture, { rows: [row(248, { giName: "GI 150 kV NEW PACITAN", bayName: "BUSBAR 150 kV" })] }, 2024);
  assert.equal(result.rows[0].source.garduIndukId, "GI-NEWPACITAN");
  assert.notEqual(result.rows[0].source.bayId, "BAY-GENERIC");
  assert.equal(result.missingBay[0].gardu_induk_id, "GI-NEWPACITAN");
  assert.equal(result.rows[0].source.sourceHierarchyConflict, undefined);
});

test("live migration has no Bay-across-UPT GI heuristic", () => {
  const source = readFileSync(new URL("../../scripts/generate_mtu_khs_live_migration.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /bayAcrossUpt|unique Bay parent/);
  assert.match(source, /sourceHierarchyConflict = \{ field: "ULTG"/);
});

test("rollback is bounded to migration provenance", () => {
  const sql = buildRollback("a".repeat(64), [2024, 2026], [{ id: "GI-X" }], [{ id: "BAY-X" }]);
  assert.match(sql, /data->'_migration'/);
  assert.match(sql, /data->>'mtuKhsMigration' = 'true'/);
  assert.match(sql, /mtuKhsReactivation/);
  assert.match(sql, /not exists/);
});
