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

export const ensureMaturityDriveTree = payload => request("ensure-tree", payload);
export const exportMaturitySheet = payload => request("export-sheet", payload);
export const syncMaturityDrive = payload => request("sync", payload);
export const loadMaturityDriveEvidence = auditId => request("sync", { auditId, scanDrive: false });
export const assignMaturityDriveEvidence = payload => request("assign", payload);
export const unlinkMaturityDriveEvidence = payload => request("unlink", payload);

export async function uploadMaturityDriveEvidence({ file, ...metadata }) {
  const formData = new FormData();
  formData.set("file", file, file.name);
  const result = await request("upload", metadata, { formData });
  return result.evidence;
}

export async function uploadForm5SPhoto({ file, upt, bulan, tahun }) {
  const formData = new FormData();
  formData.set("file", file, file.name);
  const result = await request("upload-5s", { upt, bulan, tahun }, { formData });
  return result.evidence;
}

export async function openMaturityDriveEvidence(evidenceId) {
  const { blob, fileName } = await request("download", { evidenceId }, { responseType: "blob" });
  return { url: URL.createObjectURL(blob), fileName, mime: blob.type || "" };
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
