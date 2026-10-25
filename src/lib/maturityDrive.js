import { SUPABASE_URL, SUPABASE_KEY, fetchSupabase, supabase } from "../supabaseClient.js";
import { compressImage } from "./supabaseSync.js";

const FUNCTION_PATH = "/functions/v1/maturity-drive";
const MAX_FORM5S_BYTES = 2 * 1024 * 1024;
const MAX_FORM5S_SOURCE_BYTES = 25 * 1024 * 1024;
const FORBIDDEN_MIME = new Set(["application/zip", "application/x-zip-compressed", "multipart/x-zip", "application/vnd.rar", "application/x-rar-compressed", "application/vnd.microsoft.portable-executable", "application/x-msdownload", "application/x-msdos-program"]);
const ALLOWED_MIME = new Set(["application/pdf", "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/vnd.ms-excel", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "text/plain", "text/csv"]);
const IMAGE_EXT = /\.(jpg|jpeg|png|webp|heic|heif|gif|bmp)$/i;
const ALLOWED_EXT = /\.(jpg|jpeg|png|webp|heic|heif|gif|bmp|pdf|doc|docx|xls|xlsx|txt|csv)$/i;
const FORBIDDEN_EXT = /(?:^|\.)((?:zip|rar|exe))(?:\.|$)/i;

function allowedEvidenceFile(file) {
  const mime = String(file?.type || "").toLowerCase();
  if (FORBIDDEN_MIME.has(mime) || FORBIDDEN_EXT.test(file?.name || "")) return false;
  return file?.size > 0 && (mime.startsWith("image/") || IMAGE_EXT.test(file.name || "") || ALLOWED_MIME.has(mime) || ALLOWED_EXT.test(file.name || ""));
}

const isImageFile = file => String(file?.type || "").toLowerCase().startsWith("image/") || IMAGE_EXT.test(file?.name || "");

function imageFileFromDataUrl(dataUrl, source) {
  const match = /^data:([^;,]+)?;base64,(.*)$/i.exec(dataUrl || "");
  if (!match) throw new Error("Hasil kompresi foto tidak valid.");
  const binary = atob(match[2]);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  const sourceName = String(source?.name || "evidence").replace(/\.[^.]+$/, "") || "evidence";
  return new File([bytes], `${sourceName}.jpg`, { type: "image/jpeg", lastModified: source?.lastModified });
}

export async function prepareMaturityUpload(file) {
  if (!allowedEvidenceFile(file)) throw new Error("Format tidak didukung. Gunakan foto, PDF, DOC/DOCX, XLS/XLSX, TXT, atau CSV; ZIP, RAR, dan EXE ditolak.");
  // Evidence audit disimpan apa adanya. Batas proxy, Drive, dan Storage tetap
  // dapat menolak upload; request() meneruskan pesan infrastrukturnya.
  return file;
}

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
const withSamplingMarker = payload => {
  const value = payload || {};
  return (value.sampleId || value.sampleGroupId || value.supplementary || value.isSupplementary || value.extraFolderId || value.supplementaryFolderId)
    ? { ...value, samplingVersion: 1 }
    : value;
};
export const ensureMaturityDriveTree = payload => request("ensure-tree", withSamplingMarker(payload));
export const ensureMaturitySupplementaryFolder = payload => request("ensure-supplementary-folder", withSamplingMarker(payload));

export async function uploadMaturityDriveEvidence({ file, ...metadata }) {
  file = await prepareMaturityUpload(file);
  const formData = new FormData();
  formData.set("file", file, file.name);
  const result = await request("upload", withSamplingMarker(metadata), { formData });
  return result.evidence;
}

export async function uploadForm5SPhoto({ file, uptId, bulan, tahun }) {
  if (!isImageFile(file)) throw new Error("Foto Form 5S harus berupa gambar.");
  if (file.size > MAX_FORM5S_SOURCE_BYTES) throw new Error("Sumber foto Form 5S maksimal 25 MB.");
  file = await prepareMaturityUpload(file);
  file = imageFileFromDataUrl(await compressImage(file, { maxBytes: MAX_FORM5S_BYTES, maxDim: 2000 }), file);
  if (file.size > MAX_FORM5S_BYTES) throw new Error("Foto Form 5S tetap lebih besar dari 2 MiB setelah kompresi.");
  const result = await request("upload-5s", {
    uptId,
    bulan,
    tahun,
    fileName: file.name,
    mimeType: file.type,
    size: file.size,
  });
  if (!result.storagePath || !result.token) throw new Error("Token upload foto Form 5S tidak tersedia.");
  const { error } = await supabase.storage.from("maturity-evidence").uploadToSignedUrl(result.storagePath, result.token, file);
  if (error) throw new Error(`Upload foto Form 5S ke self-host gagal: ${error.message}`);
  return result.evidence;
}

export async function downloadForm5SPhoto(assessmentId, photoIndex) {
  const index = Number(photoIndex);
  if (!assessmentId || !Number.isInteger(index) || index < 0 || index > 14) throw new Error("Foto Form 5S tidak valid.");
  return request("download-5s-photo", { assessmentId, photoIndex: index }, { responseType: "blob" });
}

const imageMime = value => String(value || "").toLowerCase().startsWith("image/") ? String(value) : "image/jpeg";
// Keep signed URLs for one short session window. History and Print can request
// the same photo twice; sharing the in-flight request avoids another self-host
// round trip while keeping the bucket private and the URL short-lived.
const form5SPhotoCache = new Map();
const FORM5S_SIGNED_URL_TTL = 8 * 60 * 1000;
const FORM5S_PHOTO_TIMEOUT = 3 * 1000;
const timeoutPromise = (message = "Foto eviden terlalu lama dimuat.") => new Promise((_, reject) => setTimeout(() => reject(new Error(message)), FORM5S_PHOTO_TIMEOUT));
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
  if (!assessmentId || !Number.isInteger(index) || index < 0 || index > 14) throw new Error("Foto Form 5S tidak valid.");
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
  if (!assessmentId || !Number.isInteger(count) || count < 0 || count > 15) throw new Error("Foto Form 5S tidak valid.");
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
      const batch = await Promise.race([request("sign-5s-photos", { assessmentId }), timeoutPromise("Signing foto eviden timeout.")]);
      for (const signed of Array.isArray(batch.photos) ? batch.photos : []) {
        const index = Number(signed?.index);
        if (!Number.isInteger(index) || index < 0 || index >= count || !signed.url) continue;
        const result = { url: publicSignedUrl(signed.url), fileName: signed.fileName, mime: imageMime(signed.mime), isObjectUrl: false, isSigned: true };
        const promise = Promise.resolve(result);
        form5SPhotoCache.set(`${assessmentId}:${index}`, { promise, expiresAt: Date.now() + FORM5S_SIGNED_URL_TTL });
        results[index] = result;
      }
    } catch {
      // Print tetap berjalan dengan placeholder setelah batas waktu batch.
    }
  }
  // Batch signing is the only print source. Do not start one request per photo
  // after a batch timeout; that would add another 8 seconds before decode.
  misses.filter(index => !results[index]).forEach(index => {
    results[index] = { url: "", fileName: "", mime: "", isObjectUrl: false, error: new Error("Foto eviden tidak tersedia.") };
  });
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
