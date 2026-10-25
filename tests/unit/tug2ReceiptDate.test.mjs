import test from "node:test";
import assert from "node:assert/strict";
import { buildKartuGantungHistory } from "../../src/lib/sap.js";

test("riwayat Kartu Gantung TUG-10 memakai tanggal penerimaan", () => {
  const history = buildKartuGantungHistory(
    { id: "K-1", name: "Material" },
    [{
      id: "T10-1",
      docType: "TUG10",
      status: "APPROVED",
      tanggalPenerimaan: "2021-10-24",
      approvedAt: "2026-10-25T12:00:00Z",
      stockItems: [{ katalogMode: "existing", katalogId: "K-1", qty: 64 }],
      docNumbers: { tug10: "235.TUG-10" },
    }],
    [{ id: "S-1", katalogId: "K-1", qty: 64 }],
    [],
    [],
    [],
  );
  assert.equal(history.at(-1).tgl, "2021-10-24");
});

test("riwayat legacy TUG-10 fallback ke tanggal approval lalu createdAt", () => {
  const base = {
    docType: "TUG10",
    status: "APPROVED",
    stockItems: [{ katalogMode: "existing", katalogId: "K-1", qty: 1 }],
  };
  const approvedHistory = buildKartuGantungHistory(
    { id: "K-1", name: "Material" },
    [{ ...base, id: "T10-approved", approvedAt: "2026-10-25" }],
    [{ id: "S-1", katalogId: "K-1", qty: 1 }], [], [], [],
  );
  assert.equal(approvedHistory.at(-1).tgl, "2026-10-25");

  const createdHistory = buildKartuGantungHistory(
    { id: "K-1", name: "Material" },
    [{ ...base, id: "T10-created", createdAt: "2026-10-24" }],
    [{ id: "S-1", katalogId: "K-1", qty: 1 }], [], [], [],
  );
  assert.equal(createdHistory.at(-1).tgl, "2026-10-24");
});
