import { supabase } from "../supabaseClient.js";

// djb2, cukup untuk deteksi perubahan (bukan kriptografis) — dipakai gate cache
// "jangan analisa ulang kalau evidence & skor tak berubah".
function djb2(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

export function hashAspectSnapshot(evidenceList, scoreObj) {
  const evPart = (evidenceList || [])
    .map(e => `${e.id}:${e.name || ""}:${e.size || 0}`)
    .sort()
    .join("|");
  return djb2(`${evPart}::${scoreObj?.upt || 0}`);
}

const FALLBACK_RESULT = {
  status: "UNAVAILABLE",
  estimasiLevel: 1,
  alasanPenilaian: "Analisis AI belum tersedia (layanan gagal/kosong). Nilai manual berdasarkan skor yang sudah diisi.",
  perEvidence: [],
  gap: ["Analisis otomatis tidak dapat dijalankan saat ini."],
  rekomendasi: ["Periksa evidence secara manual sesuai rubrik level di panel kiri."],
  menujuLevelMaksimal: [],
};

function labelOf(e) {
  return e.itemLabel || e.label || e.name || e.file_name || "berkas";
}

// Analisa berbasis metadata SAJA (nama & kelengkapan evidence), TANPA fetch/OCR isi
// berkas — cepat & tak bisa gagal "gagal dibaca" karena tak ada fetch.
export async function analyzeMaturityAspect(aspect, evidenceList, scoreObj, { onProgress } = {}) {
  onProgress?.(0, evidenceList.length);
  const namaEvidence = evidenceList.map(labelOf);

  try {
    const { data, error } = await supabase.functions.invoke("ai-proxy", {
      body: {
        temperature: 0.2,
        max_tokens: 1500,
        messages: [
          { role: "system", content: "Kamu adalah auditor maturity gudang PLN yang objektif. Nilai HANYA berdasarkan KELENGKAPAN & kesesuaian NAMA dokumen evidence yang terupload dibanding evidence wajib & rubrik level — kamu TIDAK membaca isi dokumen. Karena tak bisa melihat isi, kamu DILARANG menyatakan ada/tidaknya tanda tangan, stempel, tanggal, atau isi dokumen — jangan pernah bilang dokumen 'tidak bertanda tangan' maupun 'sudah bertanda tangan'. Jawab HANYA JSON valid, tanpa teks lain." },
          { role: "user", content: `Aspek: ${aspect.id} ${aspect.title}
Evidence wajib: ${JSON.stringify(aspect.requiredEvidence)}
Rubrik level:\n${aspect.levels.join(" ").slice(0, 800)}
Catatan: ${JSON.stringify(aspect.catatan)}
Skor UPT saat ini: ${scoreObj?.upt || 0}
Nama evidence yang terupload (isi TIDAK dibaca, nilai dari kelengkapan & nama saja): ${namaEvidence.length ? JSON.stringify(namaEvidence) : "(tidak ada evidence terupload)"}

Kembalikan JSON dengan struktur PERSIS:
{"estimasiLevel":1-5,"alasanPenilaian":"","perEvidence":[{"label":"","terpenuhi":true,"catatan":""}],"gap":["..."],"rekomendasi":["..."],"menujuLevelMaksimal":[{"poin":"","aksi":""}]}
perEvidence dibuat dari daftar Evidence wajib, terpenuhi=true kalau tampak ada evidence terupload yang namanya cocok (berdasar NAMA & kelengkapan saja, BUKAN isi/tanda tangan). Untuk kriteria rubrik yang menuntut tanda tangan/stempel/tanggal (mis. tanda tangan GM), JANGAN menyimpulkan tidak terpenuhi hanya karena kamu tak bisa melihatnya — tulis di catatan 'perlu verifikasi manual tanda tangan/stempel' dan JANGAN turunkan estimasiLevel semata karena tanda tangan tak terlihat. Untuk setiap perEvidence dengan terpenuhi=false, catatan WAJIB sebut singkat apa yang belum ada DAN aksi yang harus dilakukan (contoh: "belum ada — unggah Probis Stock Opname bertanda tangan GM"), jangan hanya "belum lengkap". gap WAJIB berisi daftar NAMA evidence wajib yang belum tampak terupload (selisih Evidence wajib vs nama evidence terupload), BUKAN kalimat umum seperti "kurang dari 2 dokumen". rekomendasi berisi langkah konkret untuk melengkapi tiap evidence yang kurang. menujuLevelMaksimal berisi poin konkret yang masih kurang dibanding rubrik Level 5 beserta aksi perbaikannya.` },
        ],
      },
    });
    onProgress?.(evidenceList.length, evidenceList.length);
    if (error) throw error;
    const text = data.choices?.[0]?.message?.content || "";
    const jsonText = text.match(/\{[\s\S]*\}/)?.[0] || text;
    const parsed = JSON.parse(jsonText);
    return { ...FALLBACK_RESULT, ...parsed, status: "ANSWERED" };
  } catch (err) {
    onProgress?.(evidenceList.length, evidenceList.length);
    return { ...FALLBACK_RESULT, status: "ERROR", errorMessage: err.message };
  }
}
