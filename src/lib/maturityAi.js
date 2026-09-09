import { supabase } from "../supabaseClient.js";
import { openMaturityDriveEvidence } from "./maturityDrive.js";
import { extractPdfText, renderPdfPagesToImages } from "./pdfText.js";

const MAX_CHARS_PER_FILE = 8000;
const MAX_CHARS_TOTAL = 30000;
const MAX_DOCS = 10; // ponytail: cap dokumen dianalisa, sisanya cuma disebut nama (hemat token+waktu)
const MAX_PDF_PAGES = 20;

// Whitelist di ai-proxy — HARUS sama persis dengan OPENROUTER_VISION_MODEL di env self-host.
const VISION_MODEL = "google/gemini-2.0-flash-001";
const MAX_OCR_EVIDENCE = 4; // batasi biaya: OCR vision jauh lebih mahal dari analisa teks
const MAX_OCR_IMAGES_PER_FILE = 3;

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

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

// 1 panggilan ai-proxy dgn model vision whitelist — transkripsi scan/gambar jadi teks.
async function ocrViaVision(imageDataUrls) {
  try {
    const { data, error } = await supabase.functions.invoke("ai-proxy", {
      body: {
        model: VISION_MODEL,
        max_tokens: 1500,
        messages: [{
          role: "user",
          content: [
            { type: "text", text: "Transkripsikan seluruh teks dokumen ini apa adanya, tanpa komentar." },
            ...imageDataUrls.map(url => ({ type: "image_url", image_url: { url } })),
          ],
        }],
      },
    });
    if (error) throw error;
    return data.choices?.[0]?.message?.content || "";
  } catch {
    return ""; // gagal OCR bukan fatal — evidence lain tetap dianalisa
  }
}

// ocrBudget: counter bersama antar evidence dalam 1 aspek, membatasi biaya
// OCR vision (jauh lebih mahal dari ekstrak teks biasa). undefined = tak boleh OCR.
async function extractEvidenceText(evidence, ocrBudget) {
  const mime = evidence.mimeType || evidence.mime_type || evidence.mime || "";
  const name = evidence.name || evidence.file_name || evidence.label || "berkas";
  try {
    const { url, isObjectUrl } = await openMaturityDriveEvidence(evidence.id || evidence.evidenceId);
    const blob = await fetch(url).then(r => r.blob());
    if (isObjectUrl) URL.revokeObjectURL(url);
    const isPdf = mime === "application/pdf" || name.toLowerCase().endsWith(".pdf");
    if (isPdf) {
      const text = (await extractPdfText(blob, MAX_PDF_PAGES)).trim();
      if (text) return text;
      if (!ocrBudget || ocrBudget.remaining <= 0) return "(scan — tak dibaca)";
      ocrBudget.remaining--;
      const images = await renderPdfPagesToImages(blob, MAX_OCR_IMAGES_PER_FILE);
      return (await ocrViaVision(images)) || "(scan — tak dibaca)";
    }
    if (mime.startsWith("image/")) {
      if (!ocrBudget || ocrBudget.remaining <= 0) return "(scan — tak dibaca)";
      ocrBudget.remaining--;
      return (await ocrViaVision([await blobToDataUrl(blob)])) || "(scan — tak dibaca)";
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

  // gambar & PDF scan di-OCR via model vision, dibatasi ocrBudget (MAX_OCR_EVIDENCE
  // total per aspek); sisanya prioritas PDF bertext, dicap MAX_DOCS.
  const images = evidenceList.filter(isImageEvidence);
  const others = evidenceList.filter(e => !isImageEvidence(e));
  others.sort((a, b) => (isPdfEvidence(b) ? 1 : 0) - (isPdfEvidence(a) ? 1 : 0));
  const toProcess = others.slice(0, MAX_DOCS);
  const skippedDocs = others.slice(MAX_DOCS);
  const imagesToProcess = images.slice(0, MAX_OCR_EVIDENCE);
  const skippedImages = images.slice(MAX_OCR_EVIDENCE);
  const ocrBudget = { remaining: MAX_OCR_EVIDENCE };

  const processed = await Promise.all([...toProcess, ...imagesToProcess].map(async (evidence) => {
    const raw = (await extractEvidenceText(evidence, ocrBudget)).slice(0, MAX_CHARS_PER_FILE).trim();
    const fileName = evidence.name || evidence.file_name || "berkas";
    done++;
    onProgress?.(done, total);
    return { label: labelOf(evidence), fileName, text: raw || `(gambar/scan — isi tak dibaca otomatis)` };
  }));

  const labeledOnly = [...skippedImages, ...skippedDocs].map(e => ({
    label: labelOf(e),
    fileName: e.name || e.file_name || "berkas",
    text: isImageEvidence(e) ? "(scan — tak dibaca)" : "(terupload, isi tak dibaca)",
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
        max_tokens: 1500,
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
