// RAG helpers: Cohere embed (teks+gambar), OCR.space, pencocokan nameplate,
// ringkasan transaksi utk chunk RAG. Dipindah dari App.jsx (refactor Fase 3f).
import { fmtDateOnly } from "./utils.js";
import { compressImage } from "./supabaseSync.js";
import { supabase } from "../supabaseClient.js";

// --- Util normalisasi teks nameplate (dipakai bersama semua pencocokan teks) ---
export const npNorm    = s => (s || "").toUpperCase().replace(/[^A-Z0-9]+/g, " ").replace(/\s+/g, " ").trim();

// Kata generik yang muncul di hampir semua nameplate (merek, satuan, boilerplate
// regulasi) — dibuang dari token supaya tidak dihitung sbg "kecocokan".
const NAMEPLATE_STOPWORDS = new Set([
  "PLN", "TRAFO", "TRANSFORMER", "TYPE", "TIPE", "MODEL", "NO", "NOMOR", "SN", "SERIAL",
  "MADE", "IN", "INDONESIA", "KV", "KVA", "KW", "HZ", "PHASE", "FASA", "VOLT", "VOLTAGE",
  "AMP", "AMPERE", "CLASS", "STANDARD", "IEC", "SNI", "YEAR", "TAHUN", "WEIGHT", "BERAT",
  "OIL", "MINYAK", "COOLING", "IMPEDANCE", "FREQ", "FREQUENCY",
]);

export const npTokens  = s => new Set(npNorm(s).split(" ").filter(t => t.length >= 3 && !NAMEPLATE_STOPWORDS.has(t)));

export const npNums    = s => npNorm(s).match(/\d{5,}/g) || []; // angka ≥5 digit = kandidat nomor katalog

// Jaccard similarity (inter/union) antar dua himpunan token. Butuh minimal 2 token
// bermakna yg overlap (1 kata generik gampang kebetulan sama antar barang beda) —
// kurang dari itu dianggap tak ada kecocokan teks. Di-cap 0.9: "100%" (1.0) hanya
// untuk kecocokan nomor katalog eksak (skor 0.95/0.97 di caller), bukan overlap teks murni.
function tokenSim(aTokens, bTokens) {
  if (!aTokens.size || !bTokens.size) return 0;
  let inter = 0;
  for (const t of aTokens) if (bTokens.has(t)) inter++;
  if (inter < 2) return 0;
  // Overlap coefficient (inter / himpunan terkecil), bukan Jaccard: teks OCR
  // nameplate panjang & berisik sementara teks katalog ringkas — Jaccard (inter/union)
  // menghukum ketimpangan ukuran itu & bikin match asli kesaring. Aman dari "100%
  // palsu" karena tetap butuh >=2 token BERMAKNA (stopword sudah dibuang) & di-cap 0.9.
  return Math.min(inter / Math.min(aTokens.size, bTokens.size), 0.9);
}

export const NAMEPLATE_MIN = 0.4;

// Embedding pakai Cohere (embed-multilingual-v3.0, 1024 dim) — model
// terpisah dari Groq (dipakai untuk chat), karena Groq tidak punya endpoint
// embedding. Vector disimpan di Supabase (pgvector, tabel rag_chunks, lihat
// schema.sql section 9), dicari via fungsi match_rag_chunks (cosine
// similarity) saat user bertanya ke AI Agent.
export async function cohereEmbed(texts, inputType) {
  const { data, error } = await supabase.functions.invoke("services-proxy", {
    body: { service: "cohere-embed", model: "embed-multilingual-v3.0", texts, input_type: inputType },
  });
  if (error) throw error;
  return data.embeddings; // array of vectors, sejajar urutan dengan `texts`
}

// Embedding untuk GAMBAR (visual search Data Stok) — model & dimensi sama dgn teks
// (1024), tapi input_type=image + param images (1 data-URL base64 per panggilan).
// Dipakai saat user cari barang dengan foto → dicocokkan ke stock_photo_embeddings.
export async function cohereEmbedImage(dataUri) {
  // Foto kamera full-res (base64 3-7 MB) bikin upload embed lambat. Kompres sedang
  // dulu — 1280px cukup untuk kemiripan bentuk, tidak berlebihan menurunkan kualitas.
  const compact = await compressImage(dataUri, { maxDim: 1280, maxBytes: 700_000 });
  const { data, error } = await supabase.functions.invoke("services-proxy", {
    body: { service: "cohere-embed", model: "embed-multilingual-v3.0", input_type: "image", images: [compact] },
  });
  if (error) throw error;
  const v = data.embeddings?.[0] || data.embeddings?.float?.[0];
  if (!v) throw new Error("Cohere tidak mengembalikan embedding gambar");
  return v;
}

// OCR nameplate barang (mode pencarian foto "berdasarkan nameplate") — baca teks
// yang tercetak di foto lewat OCR.space (OCREngine 2, lebih akurat utk teks cetak
// & angka). Foto dikompres dulu ke <1MB karena itu batas free tier OCR.space.
// Mengembalikan teks mentah (bisa multi-baris). Key OCR.space server-side (EF services-proxy).
export async function ocrSpaceOCR(dataUri) {
  const compact = await compressImage(dataUri, { maxBytes: 900_000, maxDim: 1600 });
  const { data, error } = await supabase.functions.invoke("services-proxy", {
    body: { service: "ocr", base64Image: compact },
  });
  if (error) throw error;
  if (data.IsErroredOnProcessing) {
    const msg = Array.isArray(data.ErrorMessage) ? data.ErrorMessage.join("; ") : (data.ErrorMessage || "OCR.space gagal memproses gambar");
    throw new Error(msg);
  }
  return (data.ParsedResults || []).map(r => r.ParsedText || "").join("\n").trim();
}

// Cocokkan teks hasil OCR nameplate ke Master Katalog. Sinyal terkuat = nomor
// katalog tercetak verbatim di foto; sinyal kedua = tumpang-tindih kata dari
// nama/type/merk. Mengembalikan {katalog, similarity} 0..1 (sejajar bentuk hasil
// visual search), disaring >= NAMEPLATE_MIN, top 10, terurut skor menurun.
export function matchNameplateToKatalog(ocrText, katalogList) {
  const ocrNorm = npNorm(ocrText);
  if (!ocrNorm) return [];
  const ocrCompact = ocrNorm.replace(/\s+/g, "");
  const ocrTokens = npTokens(ocrText);
  const results = [];
  for (const kat of katalogList) {
    let score = 0;
    // 1. Nomor katalog tercetak verbatim (>=5 digit) — sinyal paling kuat.
    const cat = String(kat.katalog || "").replace(/[^0-9]/g, "");
    if (cat.length >= 5 && ocrCompact.includes(cat)) score = Math.max(score, 0.95);
    // 2. Tumpang-tindih kata dari deskripsi katalog. Field asli katalog: name, type,
    //    merk, jenisBarang (filter Boolean lewat template + npTokens buang yang kosong).
    const katTokens = npTokens(`${kat.name || ""} ${kat.type || ""} ${kat.merk || ""} ${kat.jenisBarang || ""}`);
    score = Math.max(score, tokenSim(ocrTokens, katTokens));
    if (score >= NAMEPLATE_MIN) results.push({ katalog: kat.katalog, similarity: score });
  }
  return results.sort((a, b) => b.similarity - a.similarity).slice(0, 10);
}

// Kemiripan teks nameplate query vs teks nameplate tersimpan (dua-duanya hasil
// OCR). Angka katalog sama = sinyal kuat (0.95); selain itu overlap kata dibagi
// himpunan terkecil (lebih toleran kalau salah satu nameplate teksnya lebih panjang).
export function nameplateTextSim(qTokens, qNums, storedText) {
  const sTokens = npTokens(storedText);
  const sNums = npNums(storedText);
  let score = 0;
  if (qNums.some(n => sNums.includes(n))) score = Math.max(score, 0.95);
  score = Math.max(score, tokenSim(qTokens, sTokens));
  return score;
}

// Pencocokan mode Nameplate gabungan: (1) ke Master Katalog + (2) ke teks foto
// nameplate yang sudah di-OCR & disimpan di Data Stok (fotoNameplateOcr). Skor
// per katalog diambil yang tertinggi antar dua sumber. Top 10, terurut menurun.
export function matchNameplateAll(ocrText, katalogList, stocks) {
  const best = new Map(); // String(katalog) -> similarity tertinggi
  const put = (kat, s) => {
    if (kat == null || s < NAMEPLATE_MIN) return;
    const k = String(kat);
    if (!best.has(k) || best.get(k) < s) best.set(k, s);
  };
  for (const r of matchNameplateToKatalog(ocrText, katalogList)) put(r.katalog, r.similarity);
  const qTokens = npTokens(ocrText);
  const qNums = npNums(ocrText);
  for (const st of (stocks || [])) {
    if (st.katalog == null) continue;
    // (a) teks nameplate foto tersimpan (kalau ada) — dua-duanya hasil OCR.
    if (st.fotoNameplateOcr) put(st.katalog, nameplateTextSim(qTokens, qNums, st.fotoNameplateOcr));
    // (b) field deskripsi stok (merk/type/keterangan/jenis) — sering lebih terisi
    //     daripada katalog; cocokkan teks OCR ke situ juga, map ke katalog stok itu.
    const stTokens = npTokens(`${st.name || ""} ${st.merk || ""} ${st.type || ""} ${st.keteranganBarang || ""} ${st.jenisBarang || ""}`);
    put(st.katalog, tokenSim(qTokens, stTokens));
  }
  return [...best.entries()]
    .map(([katalog, similarity]) => ({ katalog, similarity }))
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, 10);
}

// buildKatalogRagContent (teks 1 chunk RAG katalog) + fmtNum + getSAPLabel pindah ke
// src/lib/ragShared.mjs — dipakai bersama nightly_sync.mjs supaya isi chunk selalu identik.
// Ringkasan 1 transaksi TUG (approved) — dipakai sebagai 1 "chunk" RAG.
export function buildTxnRagContent(t) {
  const namaBarang = (t.stockItems||[]).map(si=>si.namaBarang||si.name).filter(Boolean).join(", ") || "-";
  return `Transaksi ${t.docType||"-"} (${t.id}) — Pekerjaan: ${t.namaPekerjaan||t.pekerjaan||"-"}. Lokasi: ${t.lokasiPekerjaan||"-"}. Tanggal: ${fmtDateOnly(t.createdAt)}. Status: ${t.status||"-"}. Barang: ${namaBarang}.`;
}
