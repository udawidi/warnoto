import assert from "node:assert/strict";
import { test } from "node:test";
import { CLOUD, readTxnCache, txnCacheKey } from "../../src/lib/cloud.js";

test("legacy TUG cache is imported only for its owner and scope", async () => {
  const data = new Map();
  globalThis.window = {};
  globalThis.localStorage = { getItem: k => data.get(k) ?? null, setItem: (k, v) => data.set(k, v) };
  try {
    const owner = txnCacheKey({ id: "super", role: "SUPERADMIN" });
    const upt = txnCacheKey({ id: "upt", role: "TL", uptId: "SBY" });
    const narrowed = txnCacheKey({ id: "super", role: "TL", uptId: "SBY" });
    const docs = [{ id: "approved" }];
    await CLOUD.set("pln_txns_v3", docs);
    assert.equal(await readTxnCache(upt, owner), null);
    assert.deepEqual(await readTxnCache(owner, owner), docs);
    assert.equal(await readTxnCache(narrowed, narrowed), null);
    assert.equal(await readTxnCache(upt, upt), null);
    await CLOUD.set(upt, []);
    assert.deepEqual(await readTxnCache(upt, owner), []);
    assert.deepEqual(await readTxnCache(owner, upt), docs);
  } finally {
    delete globalThis.localStorage;
    delete globalThis.window;
  }
});
