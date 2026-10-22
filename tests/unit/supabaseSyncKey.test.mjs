import assert from "node:assert/strict";
import test from "node:test";
import {
  findLegacyHistoryDocuments,
  historySyncDocumentKey,
  historySyncKey,
  isCanonicalHistorySyncKey,
} from "../../src/lib/supabaseSync.js";

test("history key is stable across timestamp drift and separates identical items", () => {
  const first = { source: "BARU", transactionId: "TUG10-1", itemIndex: 0, katalogId: "KAT-1", masuk: 21, ts: 1000 };
  const later = { ...first, ts: 2000 };
  const secondItem = { ...first, itemIndex: 1 };
  assert.equal(historySyncKey(first), historySyncKey(later));
  assert.notEqual(historySyncKey(first), historySyncKey(secondItem));
  assert.equal(historySyncKey(first, "MASUK"), "TUG10-1|0|KAT-1|MASUK");
});

test("legacy document guard blocks rows with NULL location and leaves V2-only documents eligible", async () => {
  const rows = [
    { docType: "TUG10", tugBaDoc: "BON-LEGACY" },
    { docType: "TUG10", tugBaDoc: "BON-V2" },
  ];
  let requestUrl = "";
  const skipped = await findLegacyHistoryDocuments(rows, { Authorization: "Bearer test" }, async (url) => {
    requestUrl = url;
    return {
      ok: true,
      json: async () => [
        { doc_type: "TUG10", no_bon: "BON-LEGACY", lokasi_id: null, sync_key: "KAT-1_2026-01-01_TUG10_MASUK" },
        { doc_type: "TUG10", no_bon: "BON-V2", lokasi_id: "lok-1", sync_key: "TX-1|0|KAT-1|MASUK" },
      ],
    };
  }, "https://example.test");

  assert.deepEqual(skipped.map(({ docType, noBon }) => ({ docType, noBon })), [
    { docType: "TUG10", noBon: "BON-LEGACY" },
  ]);
  assert.equal(historySyncDocumentKey("TUG10", "BON-LEGACY"), skipped[0].key);
  assert.match(new URL(requestUrl).searchParams.get("or"), /doc_type\.eq\.\"TUG10\"/);
  assert.match(new URL(requestUrl).searchParams.get("or"), /no_bon\.eq\.\"BON-LEGACY\"/);
  assert.doesNotMatch(requestUrl, /lokasi_id/);
  assert.equal(isCanonicalHistorySyncKey("TX-1|0|KAT-1|MASUK"), true);
});

test("legacy document guard fails closed when history read fails", async () => {
  await assert.rejects(
    findLegacyHistoryDocuments(
      [{ docType: "TUG10", tugBaDoc: "BON-RETRY" }],
      {},
      async () => { throw new Error("network down"); },
      "https://example.test",
    ),
    /network down/,
  );
});
