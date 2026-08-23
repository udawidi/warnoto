// Cegah nomor dokumen TUG-3/4/10/5/SJ baru lebih kecil dari yang sudah ada
// (docSeq global bisa ketinggalan kalau ada txn diimpor/dipulihkan manual dengan
// seq lebih tinggi — bug: dok baru dapat nomor < dok lama). Hanya doc TYPE yang
// dinomori dari `docSeq` client (TUG-8/TUG-9 pakai counter server canonical
// terpisah, TIDAK disentuh di sini).
const CLIENT_NUMBERED_DOC_KEYS = ["tug3", "tug4", "tug10", "tug5", "sj"];

// Ambil angka urut di depan format "196.SI/LOG.00.02/..." (sebelum titik pertama).
function leadingSeq(docNo) {
  const m = String(docNo || "").match(/^(\d+)\./);
  return m ? Number(m[1]) : 0;
}

export function highestDocSeqInUse(txns) {
  let max = 0;
  for (const t of txns || []) {
    const nums = t?.docNumbers;
    if (!nums) continue;
    for (const key of CLIENT_NUMBERED_DOC_KEYS) {
      const seq = leadingSeq(nums[key]);
      if (seq > max) max = seq;
    }
  }
  return max;
}

// seq aman berikutnya untuk dokumen baru: tidak boleh lebih kecil dari yang
// sudah dipakai transaksi manapun, dan tidak boleh mundur dari counter docSeq.
export function nextSafeDocSeq(docSeq, txns) {
  return Math.max(Number(docSeq) || 0, highestDocSeqInUse(txns) + 1);
}

// ponytail self-check — jalankan langsung: `node src/lib/docSeqGuard.js`
if (typeof process !== "undefined" && process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop())) {
  const txns = [
    { docNumbers: { tug3: "196.SI/LOG.00.02/UPT-SBY/VII/2026" } },
    { docNumbers: { tug10: "198.SI/LOG.00.01/UPT-SBY/VII/2026" } },
    { docNumbers: { sj: "150.SI/LOG.00.01/UPT-SBY/VII/2026" } },
  ];
  console.assert(highestDocSeqInUse(txns) === 198, "ambil seq tertinggi antar semua doc key");
  console.assert(highestDocSeqInUse([]) === 0, "kosong -> 0");
  console.assert(nextSafeDocSeq(196, txns) === 199, "docSeq basi (196) dibulatkan naik ke 199, bukan dipakai apa adanya");
  console.assert(nextSafeDocSeq(250, txns) === 250, "docSeq sudah lebih tinggi -> tidak diturunkan");
  console.log("docSeqGuard self-check OK");
}
