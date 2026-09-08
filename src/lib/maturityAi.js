import { recognize as ocrRecognize } from "tesseract.js";
import { supabase } from "../supabaseClient.js";
import { openMaturityDriveEvidence } from "./maturityDrive.js";
import { extractPdfText } from "./pdfText.js";

const MAX_CHARS_PER_FILE = 4000;
const MAX_CHARS_TOTAL = 12000;

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

async function ocrText(blob) {
  // ponytail: OCR ceiling — detik per gambar, lemah untuk tanda tangan/stempel;
  // DeepSeek menilai dari teks hasil OCR, bukan tata letak dokumen.
  try {
    const { data } = await ocrRecognize(blob, "ind+eng");
    return data.text || "";
  } catch {
    const { data } = await ocrRecognize(blob, "eng");
    return data.text || "";
  }
}

async function xlsxToText(blob) {
  const XLSX = await import("xlsx");
  const buf = await blob.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  return wb.SheetNames
    .map(name => XLSX.utils.sheet_to_csv(wb.Sheets[name]))
    .join("\n");
}

async function extractEvidenceText(evidence) {
  const mime = evidence.mimeType || evidence.mime_type || evidence.mime || "";
  const name = evidence.name || evidence.file_name || evidence.label || "berkas";
  try {
    const { url } = await openMaturityDriveEvidence(evidence.id || evidence.evidenceId);
    const blob = await fetch(url).then(r => r.blob());
    URL.revokeObjectURL(url);
    if (mime === "application/pdf" || name.toLowerCase().endsWith(".pdf")) {
      const text = (await extractPdfText(blob)).trim();
      return text || await ocrText(blob); // PDF hasil scan (tanpa layer teks) → OCR
    }
    if (mime.startsWith("image/")) return await ocrText(blob);
    if (mime === "text/csv" || mime === "text/plain" || /\.(csv|txt)$/i.test(name)) return await blob.text();
    if (/\.(xlsx|xls)$/i.test(name) || mime.includes("spreadsheet")) return await xlsxToText(blob);
    return "(tak terbaca otomatis)";
  } catch (err) {
    return `(gagal dibaca: ${err.message})`;
  }
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

export async function analyzeMaturityAspect(aspect, evidenceList, scoreObj, { onProgress } = {}) {
  const total = evidenceList.length;
  const docs = [];
  for (let i = 0; i < total; i++) {
    onProgress?.(i, total);
    const evidence = evidenceList[i];
    const text = (await extractEvidenceText(evidence)).slice(0, MAX_CHARS_PER_FILE);
    docs.push({ label: evidence.itemLabel || evidence.label || evidence.name, fileName: evidence.name || evidence.file_name, text });
  }
  onProgress?.(total, total);

  let docsText = "";
  for (const d of docs) {
    const chunk = `\n### ${d.label} (${d.fileName})\n${d.text}\n`;
    if (docsText.length + chunk.length > MAX_CHARS_TOTAL) break;
    docsText += chunk;
  }

  try {
    const { data, error } = await supabase.functions.invoke("ai-proxy", {
      body: {
        temperature: 0.2,
        max_tokens: 2000,
        messages: [
          { role: "system", content: "Kamu adalah auditor maturity gudang PLN yang objektif. Nilai HANYA berdasarkan isi dokumen yang diberikan dibanding rubrik level. Jawab HANYA JSON valid, tanpa teks lain." },
          { role: "user", content: `Aspek: ${aspect.id} ${aspect.title}
Evidence wajib: ${JSON.stringify(aspect.requiredEvidence)}
Rubrik level:\n${aspect.levels.join("\n")}
Catatan: ${JSON.stringify(aspect.catatan)}
Skor UPT saat ini: ${scoreObj?.upt || 0}
Dokumen evidence yang diupload:${docsText || " (tidak ada dokumen terbaca)"}

Kembalikan JSON dengan struktur PERSIS:
{"estimasiLevel":1-5,"alasanPenilaian":"","perEvidence":[{"label":"","terpenuhi":true,"catatan":""}],"gap":["..."],"rekomendasi":["..."],"menujuLevelMaksimal":[{"poin":"","aksi":""}]}
menujuLevelMaksimal berisi poin konkret yang masih kurang dibanding rubrik Level 5 beserta aksi perbaikannya.` },
        ],
      },
    });
    if (error) throw error;
    const text = data.choices?.[0]?.message?.content || "";
    const jsonText = text.match(/\{[\s\S]*\}/)?.[0] || text;
    const parsed = JSON.parse(jsonText);
    return { ...FALLBACK_RESULT, ...parsed, status: "ANSWERED" };
  } catch (err) {
    return { ...FALLBACK_RESULT, status: "ERROR", errorMessage: err.message };
  }
}
