import * as pdfjsLib from "pdfjs-dist";
import pdfjsWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

// Diangkat dari App.jsx (extractPdfText lokal) supaya reusable di luar PLNWarehouse()
// (dipakai maturityAi.js). Perilaku sama, hanya input diperluas: base64 string
// (pemakaian lama, aiExtractKontrak) ATAU Blob/Uint8Array (pemakaian baru).
export async function extractPdfText(input, maxPages) {
  const bytes = await toBytes(input);
  const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
  let text = "";
  const pages = maxPages ? Math.min(pdf.numPages, maxPages) : pdf.numPages;
  for (let i = 1; i <= pages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    text += content.items.map(it => it.str).join(" ") + "\n";
  }
  return text;
}

async function toBytes(input) {
  if (input instanceof Uint8Array) return input;
  if (input instanceof Blob) return new Uint8Array(await input.arrayBuffer());
  if (typeof input === "string") {
    const binary = atob(input);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }
  throw new Error("extractPdfText: input harus base64 string, Blob, atau Uint8Array.");
}
