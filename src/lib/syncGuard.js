// Signature ringan tapi content-sensitive dari data yang dikirim auto-sync (App.jsx
// useEffect L~532). Dipakai supaya sync SKIP kalau data belum berubah sejak sync
// terakhir — terutama tepat setelah hydration reload (data itu-itu saja yang baru
// dibaca dari server, re-push-nya sia-sia dan itu sumber utama beban 503).
// ponytail: hash string murni (bukan crypto) — cukup untuk deteksi "berubah/tidak",
// bukan untuk keamanan.
function cheapHash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
  return h;
}

export function syncSignature(txns, stocks, katalogList) {
  const t = (txns || []).map(x => `${x.id}:${x.stage || x.status}:${x.approvedAt || x.approvedAtAsman || ""}`).join(",");
  const s = (stocks || []).map(x => `${x.id}:${x.qty}:${x.fotoKeseluruhan ? x.fotoKeseluruhan.length : 0}`).join(",");
  const k = (katalogList || []).map(x => `${x.id}:${x.katalog}:${x.name}`).join(",");
  return `${cheapHash(t)}|${cheapHash(s)}|${cheapHash(k)}`;
}

// ponytail self-check — jalankan langsung: `node src/lib/syncGuard.js`
if (typeof process !== "undefined" && process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop())) {
  const txns = [{ id: "T1", stage: "APPROVED", approvedAt: 1 }];
  const stocks = [{ id: "S1", katalogId: "K1", qty: 5 }];
  const katalog = [{ id: "K1", katalog: "123", name: "Barang" }];
  const sig1 = syncSignature(txns, stocks, katalog);
  const sig2 = syncSignature(txns, stocks, katalog);
  console.assert(sig1 === sig2, "data sama -> signature sama (skip sync)");
  const stocksChanged = [{ id: "S1", katalogId: "K1", qty: 6 }];
  console.assert(syncSignature(txns, stocksChanged, katalog) !== sig1, "1 qty beda -> signature beda (push)");
  console.log("syncSignature self-check OK");
}
