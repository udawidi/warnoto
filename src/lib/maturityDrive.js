import { SUPABASE_URL, SUPABASE_KEY, fetchSupabase, supabase } from "../supabaseClient.js";

const FUNCTION_PATH = "/functions/v1/maturity-drive";

async function request(action, body = {}, { formData = null, responseType = "json" } = {}) {
  if (!supabase || !SUPABASE_URL) throw new Error("Koneksi server belum tersedia.");
  const { data: { session } = {} } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error("Sesi login berakhir. Silakan masuk kembali.");
  const headers = { Authorization: `Bearer ${session.access_token}`, apikey: SUPABASE_KEY || "" };
  let payload;
  if (formData) {
    formData.set("action", action);
    Object.entries(body).forEach(([key, value]) => formData.set(key, typeof value === "string" ? value : JSON.stringify(value)));
    payload = formData;
  } else {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify({ action, ...body });
  }
  const response = await fetchSupabase(`${SUPABASE_URL}${FUNCTION_PATH}`, { method: "POST", headers, body: payload });
  if (responseType === "blob") {
    if (!response.ok) {
      const message = await response.json().catch(() => ({}));
      throw new Error(message.error || "Berkas tidak dapat diunduh.");
    }
    const encodedName = response.headers.get("X-File-Name") || "evidence";
    return { blob: await response.blob(), fileName: decodeURIComponent(encodedName) };
  }
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.ok) throw new Error(result.error || "Permintaan Google Drive gagal.");
  return result;
}

export const exportMaturitySheet = payload => request("export-sheet", payload);
export const unlinkMaturityDriveEvidence = payload => request("unlink", payload);

export async function uploadMaturityDriveEvidence({ file, ...metadata }) {
  const formData = new FormData();
  formData.set("file", file, file.name);
  const result = await request("upload", metadata, { formData });
  return result.evidence;
}

export async function uploadForm5SPhoto({ file, uptId, bulan, tahun }) {
  const formData = new FormData();
  formData.set("file", file, file.name);
  const result = await request("upload-5s", { uptId, bulan, tahun }, { formData });
  return result.evidence;
}

export async function downloadForm5SPhoto(assessmentId, photoIndex) {
  const index = Number(photoIndex);
  if (!assessmentId || !Number.isInteger(index) || index < 0 || index > 2) throw new Error("Foto Form 5S tidak valid.");
  return request("download-5s-photo", { assessmentId, photoIndex: index }, { responseType: "blob" });
}

const imageMime = value => String(value || "").toLowerCase().startsWith("image/") ? String(value) : "image/jpeg";
// Keep signed URLs for one short session window. History and Print can request
// the same photo twice; sharing the in-flight request avoids another self-host
// round trip while keeping the bucket private and the URL short-lived.
const form5SPhotoCache = new Map();
const FORM5S_SIGNED_URL_TTL = 8 * 60 * 1000;
const publicSignedUrl = value => {
  const path = String(value || "").replace(/^https?:\/\/[^/]+/i, "");
  if (!path) return "";
  const base = typeof window !== "undefined" && window.location.hostname === "localhost"
    ? `${window.location.origin}/supabase`
    : SUPABASE_URL;
  return `${base}${path}`;
};

export async function openForm5SPhoto(assessmentId, photoIndex) {
  const index = Number(photoIndex);
  if (!assessmentId || !Number.isInteger(index) || index < 0 || index > 2) throw new Error("Foto Form 5S tidak valid.");
  const cacheKey = `${assessmentId}:${index}`;
  const cached = form5SPhotoCache.get(cacheKey);
  if (cached && (cached.expiresAt > Date.now() || cached.promise)) return cached.promise;
  const promise = (async () => {
  try {
    const signed = await request("sign-5s-photo", { assessmentId, photoIndex: index });
    if (signed.url) {
      const result = { url: publicSignedUrl(signed.url), fileName: signed.fileName, mime: imageMime(signed.mime), isObjectUrl: false, isSigned: true };
      form5SPhotoCache.set(cacheKey, { promise: Promise.resolve(result), expiresAt: Date.now() + FORM5S_SIGNED_URL_TTL });
      return result;
    }
  } catch {
    // Legacy rows may not have self-host storage yet; use the scoped proxy below.
  }
  const { blob, fileName } = await downloadForm5SPhoto(assessmentId, index);
  return { url: URL.createObjectURL(blob), fileName, mime: imageMime(blob.type), isObjectUrl: true, isSigned: false };
  })();
  form5SPhotoCache.set(cacheKey, { promise, expiresAt: 0 });
  promise.catch(() => { if (form5SPhotoCache.get(cacheKey)?.promise === promise) form5SPhotoCache.delete(cacheKey); });
  return promise;
}

export async function openForm5SPhotos(assessmentId, photoCount) {
  const count = Number(photoCount);
  if (!assessmentId || !Number.isInteger(count) || count < 0 || count > 3) throw new Error("Foto Form 5S tidak valid.");
  if (count === 0) return [];
  const results = Array(count).fill(null);
  const misses = [];
  await Promise.all(Array.from({ length: count }, async (_, index) => {
    const cached = form5SPhotoCache.get(`${assessmentId}:${index}`);
    if (cached && (cached.expiresAt > Date.now() || cached.promise)) {
      try { results[index] = await cached.promise; return; } catch { /* fallback below */ }
    }
    misses.push(index);
  }));
  if (misses.length) {
    try {
      const batch = await request("sign-5s-photos", { assessmentId });
      for (const signed of Array.isArray(batch.photos) ? batch.photos : []) {
        const index = Number(signed?.index);
        if (!Number.isInteger(index) || index < 0 || index >= count || !signed.url) continue;
        const result = { url: publicSignedUrl(signed.url), fileName: signed.fileName, mime: imageMime(signed.mime), isObjectUrl: false, isSigned: true };
        const promise = Promise.resolve(result);
        form5SPhotoCache.set(`${assessmentId}:${index}`, { promise, expiresAt: Date.now() + FORM5S_SIGNED_URL_TTL });
        results[index] = result;
      }
    } catch {
      // Legacy rows or a temporarily unavailable batch endpoint use the scoped helper below.
    }
  }
  const fallbackIndexes = misses.filter(index => !results[index]);
  await Promise.all(fallbackIndexes.map(async index => {
    try { results[index] = await openForm5SPhoto(assessmentId, index); }
    catch (error) { results[index] = { url: "", fileName: "", mime: "", isObjectUrl: false, error }; }
  }));
  return results;
}

export const loadMaturityDriveEvidence = auditId => request("sync", { auditId, scanDrive: false });
export const signMaturityDriveEvidence = evidenceId => request("sign", { evidenceId });

// Coba signed URL dulu (GET langsung ke storage, cacheable, satu hop) — jauh
// lebih cepat dari stream lewat edge function. Fallback ke download blob lama
// kalau evidence belum backfill (storage_path kosong) atau sign gagal.
// isObjectUrl memberi sinyal ke pemanggil: hanya objectURL yang perlu di-revoke.
export async function openMaturityDriveEvidence(evidenceId) {
  const signed = await signMaturityDriveEvidence(evidenceId);
  if (signed.url) {
    // EF createSignedUrl memakai SUPABASE_URL internal container (http://kong:8000);
    // ganti origin ke base publik klien supaya browser bisa fetch (same-origin warnoto.com).
    const path = signed.url.replace(/^https?:\/\/[^/]+/i, "");
    return { url: `${SUPABASE_URL}${path}`, fileName: signed.fileName, mime: signed.mime || "", isObjectUrl: false };
  }
  const { blob, fileName } = await request("download", { evidenceId }, { responseType: "blob" });
  return { url: URL.createObjectURL(blob), fileName, mime: blob.type || "", isObjectUrl: true };
}

export async function downloadMaturityDriveEvidence(evidenceId) {
  const { blob, fileName } = await request("download", { evidenceId }, { responseType: "blob" });
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}
