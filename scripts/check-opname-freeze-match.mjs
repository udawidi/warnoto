// Mirrors collectTxnGudangIds() + findActiveFreezeSession() in
// src/hooks/useTugTransactions.js (keep in sync on change).
function collectTxnGudangIds(docType, formData, lokasiList) {
  if (docType === "TUG8" || docType === "TUG9") return formData.gudangId ? [formData.gudangId] : [];
  if (docType === "TUG3" || docType === "TUG10") {
    const lokasiIds = [formData.lokasiTujuanId, ...(formData.stockItems||[]).map(si=>si.lokasiTujuanId)].filter(Boolean);
    return lokasiIds.map(lid => (lokasiList||[]).find(l=>l.id===lid)?.gudangId).filter(Boolean);
  }
  return [];
}
function findActiveFreezeSession(gudangIds, opnameList) {
  if (!gudangIds.length) return null;
  return (opnameList||[]).find(o => o.freeze?.aktif && (o.freeze.gudangIds||[]).some(gid=>gudangIds.includes(gid)));
}

function assertEqual(actual, expected, label) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${label}: expected ${e}, got ${a}`);
  console.log(`ok - ${label}`);
}

const lokasiList = [{ id:"LOK-1", gudangId:"GD-A" }, { id:"LOK-2", gudangId:"GD-B" }];
const opnameFrozen = [{ id:"OPN-1", freeze:{ aktif:true, gudangIds:["GD-A"] } }];
const opnameOld = [{ id:"OPN-OLD" }]; // sesi lama tanpa field freeze sama sekali

// TUG3 lewat lokasiTujuanId per item -> gudang A -> ketemu freeze aktif
assertEqual(
  findActiveFreezeSession(collectTxnGudangIds("TUG3", { stockItems:[{lokasiTujuanId:"LOK-1"}] }, lokasiList), opnameFrozen)?.id,
  "OPN-1", "TUG3 item ke gudang di-freeze -> ketemu sesi"
);

// TUG10 lewat lokasiTujuanId form-level -> gudang B -> tidak ketemu (cuma A yang freeze)
assertEqual(
  findActiveFreezeSession(collectTxnGudangIds("TUG10", { lokasiTujuanId:"LOK-2" }, lokasiList), opnameFrozen),
  undefined, "TUG10 ke gudang lain -> tidak match"
);

// TUG8 lewat gudangId form-level langsung
assertEqual(
  findActiveFreezeSession(collectTxnGudangIds("TUG8", { gudangId:"GD-A" }, lokasiList), opnameFrozen)?.id,
  "OPN-1", "TUG8 gudangId langsung -> ketemu sesi"
);

// TUG5 sengaja tidak diikutkan (tidak terikat gudang spesifik)
assertEqual(collectTxnGudangIds("TUG5", { gudangId:"GD-A" }, lokasiList), [], "TUG5 diabaikan (tidak ada lokasi/gudang spesifik)");

// Sesi lama (freeze:undefined) tidak pernah dianggap freeze aktif (optional chaining aman)
assertEqual(
  findActiveFreezeSession(collectTxnGudangIds("TUG8", { gudangId:"GD-A" }, lokasiList), opnameOld),
  undefined, "sesi lama tanpa field freeze -> aman, tidak match"
);

console.log("check-opname-freeze-match: all checks passed");
