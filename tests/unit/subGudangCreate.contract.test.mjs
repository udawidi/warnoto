import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { hasRole } from "../../src/lib/roles.js";

const hook = await readFile(new URL("../../src/hooks/useWarehouseConfig.jsx", import.meta.url), "utf8");
const masterTab = await readFile(new URL("../../src/components/MasterDataTab.jsx", import.meta.url), "utf8");

test("manual Sub Gudang creation is limited to TL and SUPERADMIN", () => {
  assert.equal(hasRole({ role: "TL" }, "TL", "SUPERADMIN"), true);
  assert.equal(hasRole({ role: "SUPERADMIN" }, "TL", "SUPERADMIN"), true);
  assert.equal(hasRole({ role: "ASMAN" }, "TL", "SUPERADMIN"), false);
  assert.match(masterTab, /hasRole\(currentUser, "TL", "SUPERADMIN"\).*Tambah Sub Gudang/);
  assert.match(hook, /if \(!hasRole\(currentUser, "TL", "SUPERADMIN"\)\)/);
});

test("manual Sub Gudang creation writes one self-host row and rolls back failed sync", () => {
  assert.match(hook, /normalizeGudangName\(s\.nama\) === norm/);
  assert.match(hook, /syncMasterTableRows\("sub_gudang", \[baru\], sg => \(\{ gudang_id: sg\.gudangId \|\| null \}\)\)/);
  assert.match(hook, /if \(!ok\) \{ setSubGudangList\(prev\)/);
  assert.match(hook, /CLOUD\.set\("pln_sub_gudang_v1", next\)/);
});
