import test from "node:test";
import assert from "node:assert/strict";
import { formatKontrakSumber, normalizeSourceSnapshot } from "../../src/lib/sap.js";

test("source contracts are deduped and newest-first", () => {
  const source = normalizeSourceSnapshot({ contracts: [
    { docNo: "D-OLD", noKontrak: "Kontrak lama", supplier: "Vendor", tglMasuk: 1000 },
    { docNo: "D-NEW", noKontrak: "Kontrak baru", supplier: "Vendor", tglMasuk: 3000 },
    { docNo: "D-OLD", noKontrak: "Kontrak lama", supplier: "Vendor lain", tglMasuk: 2000 },
  ], provenance: "HISTORICAL_BACKFILL" });
  assert.equal(source.sourceKind, "TUG3_CONTRACT");
  assert.deepEqual(source.contracts.map(x => x.docNo), ["D-NEW", "D-OLD"]);
  assert.equal(source.contracts[1].supplier, "Vendor lain");
  assert.equal(source.contracts[1].tglMasuk, 2000);
  assert.equal(source.provenance, "HISTORICAL_BACKFILL");
});

test("formatter shows every contract and explicit fallback classes", () => {
  assert.equal(
    formatKontrakSumber({ sourceKind: "TUG3_CONTRACT", contracts: [
      { supplier: "PT A", noKontrak: "K Baru", docNo: "D2", tglMasuk: 2 },
      { supplier: "PT B", noKontrak: "K Lama", docNo: "D1", tglMasuk: 1 },
    ] }),
    "PT A — K Baru — D2 · PT B — K Lama — D1",
  );
  assert.equal(formatKontrakSumber({ sourceKind: "SAP_MIGRATION", contracts: [] }), "Migrasi SAP");
  assert.equal(formatKontrakSumber({ sourceKind: "TUG10_RETURN", contracts: [] }), "Retur TUG-10");
  assert.equal(formatKontrakSumber({ sourceKind: "INITIAL_STOCK", contracts: [] }), "Stok awal — kontrak tidak tersedia");
});

test("legacy stock refs remain display-compatible", () => {
  assert.equal(formatKontrakSumber([{ supplier: "PT A", noKontrak: "K", docNo: "D", tglMasuk: 1 }]), "PT A — K — D");
  assert.equal(formatKontrakSumber(null), "Stok awal — kontrak tidak tersedia");
});

test("an explicit immutable snapshot never falls back to live stock refs", () => {
  assert.equal(
    formatKontrakSumber({ sourceKind: "SAP_MIGRATION", contracts: [] }, [
      { supplier: "PT Lama", noKontrak: "Kontrak Lama", docNo: "D-LIVE", tglMasuk: 99 },
    ]),
    "Migrasi SAP",
  );
  assert.equal(
    formatKontrakSumber(null, [{ supplier: "PT Live", noKontrak: "Kontrak Live", docNo: "D-LIVE", tglMasuk: 99 }]),
    "PT Live — Kontrak Live — D-LIVE",
  );
});
