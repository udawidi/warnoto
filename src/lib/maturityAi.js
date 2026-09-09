import { supabase } from "../supabaseClient.js";
import { openMaturityDriveEvidence } from "./maturityDrive.js";
import { extractPdfText } from "./pdfText.js";

const MAX_CHARS_PER_FILE = 1500;
const MAX_CHARS_TOTAL = 6000;
const MAX_DOCS = 6; // ponytail: cap dokumen dianalisa, sisanya cuma disebut nama (hemat token+waktu)
const MAX_PDF_PAGES = 8;

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
      return (await extractPdfText(blob, MAX_PDF_PAGES)).trim(); // kosong = hasil scan, tak di-OCR
    }
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

function isImageEvidence(e) {
  return (e.mimeType || e.mime_type || e.mime || "").startsWith("image/");
}
function isPdfEvidence(e) {
  const mime = e.mimeType || e.mime_type || e.mime || "";
  const name = e.name || e.file_name || "";
  return mime === "application/pdf" || name.toLowerCase().endsWith(".pdf");
}
function labelOf(e) {
  return e.itemLabel || e.label || e.name || e.file_name || "berkas";
}

export async function analyzeMaturityAspect(aspect, evidenceList, scoreObj, { onProgress } = {}) {
  const total = evidenceList.length;
  let done = 0;
  onProgress?.(0, total);

  // gambar tak pernah didownload (tak bisa dianalisa tanpa OCR); sisanya prioritas PDF, dicap MAX_DOCS
  const images = evidenceList.filter(isImageEvidence);
  const others = evidenceList.filter(e => !isImageEvidence(e));
  others.sort((a, b) => (isPdfEvidence(b) ? 1 : 0) - (isPdfEvidence(a) ? 1 : 0));
  const toProcess = others.slice(0, MAX_DOCS);
  const skipped = others.slice(MAX_DOCS);

  const processed = await Promise.all(toProcess.map(async (evidence) => {
    const raw = (await extractEvidenceText(evidence)).slice(0, MAX_CHARS_PER_FILE).trim();
    const fileName = evidence.name || evidence.file_name || "berkas";
    done++;
    onProgress?.(done, total);
    return { label: labelOf(evidence), fileName, text: raw || `(gambar/scan — isi tak dibaca otomatis)` };
  }));

  const labeledOnly = [...images, ...skipped].map(e => ({
    label: labelOf(e),
    fileName: e.name || e.file_name || "berkas",
    text: isImageEvidence(e) ? "(gambar/scan — isi tak dibaca otomatis)" : "(terupload, isi tak dibaca)",
  }));
  onProgress?.(total, total);

  const docs = [...processed, ...labeledOnly];
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
        max_tokens: 900,
        messages: [
          { role: "system", content: "Kamu adalah auditor maturity gudang PLN yang objektif. Nilai HANYA berdasarkan isi dokumen yang diberikan dibanding rubrik level. Jawab HANYA JSON valid, tanpa teks lain." },
          { role: "user", content: `Aspek: ${aspect.id} ${aspect.title}
Evidence wajib: ${JSON.stringify(aspect.requiredEvidence)}
Rubrik level:\n${aspect.levels.join(" ").slice(0, 800)}
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
