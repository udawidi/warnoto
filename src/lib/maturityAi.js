import { supabase } from "../supabaseClient.js";
import { canonicalMaturityItemId, selectedMaturityRequiredItems } from "./maturityWarehouse.js";

export const MATURITY_AI_ANALYSIS_VERSION = 2;

// djb2 cukup untuk gate cache; bukan hash kriptografis.
function djb2(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

export function hashAspectSnapshot(evidenceList, _scoreObj, context = {}) {
  const evidence = (evidenceList || []).map(e => ({
    id: e.id || "",
    itemId: canonicalMaturityItemId(e.itemId || ""),
    name: e.name || e.file_name || "",
    size: e.size || 0,
  })).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  const rubric = {
    requiredEvidence: context.requiredEvidence || [],
    levels: context.levels || [],
    manualCriteria: context.manualCriteria || [],
  };
  return djb2(`maturity-ai-v${MATURITY_AI_ANALYSIS_VERSION}::${JSON.stringify(evidence)}::${JSON.stringify(rubric)}`);
}

function filesForItem(item, aspect, files) {
  return files.filter(file => canonicalMaturityItemId(file?.itemId) === item.id || (!file?.itemId && aspect.requiredEvidence.length === 1));
}

/** Metadata checklist only. A matching upload is visible, but never proves content compliance. */
export function buildMaturityEvidenceChecklist(aspect, evidenceList = []) {
  const files = Array.isArray(evidenceList) ? evidenceList : [];
  const selected = selectedMaturityRequiredItems(aspect, files);
  return selected.map(item => {
    const matchingFiles = filesForItem(item, aspect, files);
    const terunggah = matchingFiles.length > 0;
    return {
      id: item.id,
      itemId: item.id,
      label: item.label,
      terunggah,
      // Upload presence is deliberately not proof that the rubric is fulfilled.
      terpenuhi: false,
      status: terunggah ? "TERUNGGAH_PERLU_VERIFIKASI" : "BELUM_TERUNGGAH",
      catatan: terunggah
        ? "Berkas terunggah; isi, tanda tangan, tanggal, dan kesesuaian rubrik wajib diverifikasi manual."
        : `Belum ada berkas pada slot ini. Unggah ${item.label}.`,
    };
  });
}

function localChecklistSummary(aspect, evidenceList) {
  const perEvidence = buildMaturityEvidenceChecklist(aspect, evidenceList);
  const missing = perEvidence.filter(item => !item.terunggah);
  const gap = missing.map(item => item.label);
  const rekomendasi = missing.map(item => `Unggah evidence: ${item.label}.`);
  const menujuLevelMaksimal = missing.map(item => ({ poin: item.label, aksi: `Unggah ${item.label}, lalu verifikasi manual sesuai rubrik.` }));
  return { perEvidence, gap, rekomendasi, menujuLevelMaksimal };
}

const FALLBACK_RESULT = {
  status: "UNAVAILABLE",
  analysisVersion: MATURITY_AI_ANALYSIS_VERSION,
  levelPotensial: null,
  estimasiLevel: null,
  alasanPenilaian: "Analisis AI belum tersedia. Nilai manual berdasarkan rubrik tetap berlaku.",
};

const AI_REQUEST_TIMEOUT_MS = 25000;

// Analisa metadata saja. Model hanya memberi level potensial dan satu alasan;
// checklist, gap, serta rekomendasi berasal dari data lokal.
export async function analyzeMaturityAspect(aspect, evidenceList, scoreObj, { onProgress, invoke = (name, options) => supabase.functions.invoke(name, options) } = {}) {
  const local = localChecklistSummary(aspect, evidenceList);
  onProgress?.(0, 1);
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), AI_REQUEST_TIMEOUT_MS);
    const checklist = local.perEvidence.map(item => ({ id: item.id, label: item.label, status: item.status }));
    const request = invoke("ai-proxy", {
      body: {
        temperature: 0.2,
        max_tokens: 300,
        messages: [
          { role: "system", content: "Kamu auditor maturity gudang PLN. Nilai hanya level potensial dari metadata slot evidence dan rubrik. Kamu tidak membaca isi berkas dan tidak boleh mengklaim tanda tangan, stempel, tanggal, atau isi terpenuhi. Jawab JSON valid tanpa teks lain." },
          { role: "user", content: `Aspek ${aspect.id} ${aspect.title}\nRubrik level: ${JSON.stringify(aspect.levels)}\nChecklist metadata: ${JSON.stringify(checklist)}\nKembalikan persis {\"levelPotensial\":1-5,\"alasanPenilaian\":\"satu alasan singkat\"}.` },
        ],
      },
      signal: controller.signal,
    });
    let data, error;
    try {
      ({ data, error } = await request);
    } finally {
      clearTimeout(timer);
    }
    if (error) throw error;
    const text = data.choices?.[0]?.message?.content || "";
    const jsonText = text.match(/\{[\s\S]*\}/)?.[0] || text;
    const parsed = JSON.parse(jsonText);
    const level = Number(parsed.levelPotensial ?? parsed.estimasiLevel);
    if (!Number.isInteger(level) || level < 1 || level > 5) throw new Error("Respons AI tidak memiliki level potensial yang valid");
    onProgress?.(1, 1);
    return {
      ...FALLBACK_RESULT,
      ...local,
      status: "ANSWERED",
      levelPotensial: level,
      // Compatibility for old readers; scoring never consumes this field.
      estimasiLevel: level,
      alasanPenilaian: String(parsed.alasanPenilaian || "Level potensial berdasarkan metadata evidence dan rubrik."),
    };
  } catch (err) {
    onProgress?.(1, 1);
    return {
      ...FALLBACK_RESULT,
      ...local,
      status: "ERROR",
      errorMessage: err?.message || "Edge Function gagal",
    };
  }
}
