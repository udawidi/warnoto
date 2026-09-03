// Fase A — helper murni dipakai commitNewTxn (useTugTransactions.js) & approveTUG3Final_Asman
// (useTugApprovals.js), dan disalin (test-only) di scripts/check-opname-freeze-match.mjs (jaga
// tetap sinkron kalau ubah logika di sini).

// Gudang mana yang tersentuh transaksi ini, dipakai buat cek freeze opname.
// TUG8/TUG9 sudah punya gudangId langsung di form (scope-gudang #4); TUG3/TUG10 baru pilih
// lokasi (blok) tujuan, jadi diturunkan lewat lokasiList (pola warehouseNameForLokasi di
// supabaseSync.js). TUG5 sengaja tidak diikutkan — permintaan level UPT, tidak terikat
// gudang/blok spesifik.
export function collectTxnGudangIds(docType, data, lokasiList) {
  if (docType === "TUG8" || docType === "TUG9") return data.gudangId ? [data.gudangId] : [];
  if (docType === "TUG3" || docType === "TUG10") {
    const lokasiIds = [data.lokasiTujuanId, ...(data.stockItems||[]).map(si=>si.lokasiTujuanId)].filter(Boolean);
    return lokasiIds.map(lid => (lokasiList||[]).find(l=>l.id===lid)?.gudangId).filter(Boolean);
  }
  return [];
}

export function findActiveFreezeSession(gudangIds, opnameList) {
  if (!gudangIds.length) return null;
  return (opnameList||[]).find(o => o.freeze?.aktif && (o.freeze.gudangIds||[]).some(gid=>gudangIds.includes(gid)));
}
