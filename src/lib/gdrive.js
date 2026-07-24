// Client helper untuk mengunggah file evidence audit ke Google Drive via Supabase Edge Function (gdrive-upload).
import { SUPABASE_URL, SUPABASE_KEY } from "../supabaseClient.js";

const DEFAULT_ROOT_DRIVE_FOLDER_ID = "1PdFTH0qA79v3uS7Y8WkQOkRKiNV2TyxC";

/**
 * Mengonversi File object ke Base64 string.
 */
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => {
      const result = reader.result || "";
      const base64 = typeof result === "string" && result.includes(",")
        ? result.split(",")[1]
        : result;
      resolve(base64);
    };
    reader.onerror = error => reject(error);
  });
}

/**
 * Mengunggah file ke Google Drive melalui Supabase Edge Function gdrive-upload.
 * Memiliki fallback aman jika Edge Function / secrets belum siap.
 */
export async function uploadFileToDrive({
  file,
  upt = "UPT Surabaya",
  category = "Tata Kelola",
  aspectId = "1.1",
  itemLabel = "Evidence Item",
  rootFolderId = DEFAULT_ROOT_DRIVE_FOLDER_ID
}) {
  if (!file) throw new Error("Tidak ada file yang dipilih.");

  // folderPath untuk Google Drive: diletakkan di dalam subfolder berlabel sesuai item bukti fisik
  const folderPathForDrive = [upt, category, aspectId, itemLabel];
  const fullPathString = [upt, category, `Aspek ${aspectId}`, itemLabel].join(" / ");

  try {
    const base64Data = await fileToBase64(file);

    // Panggil Supabase Edge Function gdrive-upload jika URL & Key terkonfigurasi
    if (SUPABASE_URL && SUPABASE_KEY) {
      const edgeFunctionUrl = `${SUPABASE_URL}/functions/v1/gdrive-upload`;
      const response = await fetch(edgeFunctionUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${SUPABASE_KEY}`,
          "apikey": SUPABASE_KEY
        },
        body: JSON.stringify({
          fileName: file.name,
          mimeType: file.type || "application/octet-stream",
          fileBase64: base64Data,
          folderPath: folderPathForDrive,
          rootFolderId: rootFolderId
        })
      });

      if (response.ok) {
        const result = await response.json();
        if (result.success && result.webViewLink) {
          return {
            name: file.name,
            size: file.size,
            url: result.webViewLink,
            driveFileId: result.fileId,
            folderPath: fullPathString,
            isDrive: true,
            syncedToDrive: true,
            targetFolderId: result.targetFolderId
          };
        }
      }
    }
  } catch (err) {
    console.warn("Info Sync Drive API:", err.message);
  }

  // Fallback Lokal ObjectURL jika Edge Function belum ter-deploy/set
  return {
    name: file.name,
    size: file.size,
    url: URL.createObjectURL(file),
    folderPath: fullPathString,
    driveRepositoryUrl: `https://drive.google.com/drive/folders/${rootFolderId}`,
    isDrive: false,
    syncedToDrive: false
  };
}
