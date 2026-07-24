// Supabase Edge Function: gdrive-upload
// Menerima file base64 + folderPath, lalu membuat subfolder secara otomatis & menyimpan file di Google Drive API v3.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * Membuat Google OAuth2 Access Token dari Service Account Private Key (JWT).
 */
async function getGoogleAccessToken(serviceAccountJson: any) {
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + 3600;

  const header = { alg: "RS256", typ: "JWT" };
  const claimSet = {
    iss: serviceAccountJson.client_email,
    scope: "https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/drive",
    aud: "https://oauth2.googleapis.com/token",
    exp: exp,
    iat: iat,
  };

  const encodeBase64Url = (str: string) => {
    return btoa(str).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  };

  const encodedHeader = encodeBase64Url(JSON.stringify(header));
  const encodedClaim = encodeBase64Url(JSON.stringify(claimSet));
  const unsignedJwt = `${encodedHeader}.${encodedClaim}`;

  // Parse RSA PEM Key
  const pemHeader = "-----BEGIN PRIVATE KEY-----";
  const pemFooter = "-----END PRIVATE KEY-----";
  const pemContents = serviceAccountJson.private_key
    .replace(pemHeader, "")
    .replace(pemFooter, "")
    .replace(/\s/g, "");

  const binaryKey = Uint8Array.from(atob(pemContents), c => c.charCodeAt(0));

  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    binaryKey,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    cryptoKey,
    new TextEncoder().encode(unsignedJwt)
  );

  const encodedSignature = encodeBase64Url(
    String.fromCharCode(...new Uint8Array(signature))
  );

  const jwt = `${unsignedJwt}.${encodedSignature}`;

  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });

  const tokenData = await tokenResponse.json();
  return tokenData.access_token;
}

/**
 * Mencari atau membuat folder di Google Drive.
 */
async function getOrCreateFolder(folderName: string, parentId: string, accessToken: string) {
  const query = encodeURIComponent(`mimeType = 'application/vnd.google-apps.folder' and '${parentId}' in parents and trashed = false`);
  const searchUrl = `https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id,name)`;

  const searchRes = await fetch(searchUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const searchData = await searchRes.json();
  const files = searchData.files || [];

  const cleanFolderName = folderName.trim();

  // 1. Coba pencocokan persis (case-insensitive)
  const exactMatch = files.find(
    (f: any) => f.name.toLowerCase().trim() === cleanFolderName.toLowerCase()
  );
  if (exactMatch) return exactMatch.id;

  // 2. Cek pencocokan prefiks kategori cerdas
  let prefixToMatch = "";
  const categoryLower = cleanFolderName.toLowerCase();

  if (categoryLower.includes("tata kelola")) prefixToMatch = "1.";
  else if (categoryLower.includes("tenaga kerja") || categoryLower.includes("sdm")) prefixToMatch = "2.";
  else if (categoryLower.includes("sarana") || categoryLower.includes("prasarana")) prefixToMatch = "3.";
  else if (categoryLower.includes("k3") || categoryLower.includes("keamanan") || categoryLower.includes("keselamatan")) prefixToMatch = "4.";
  else if (categoryLower.includes("teknologi") || categoryLower.includes("sistem informasi") || categoryLower.includes("si")) prefixToMatch = "5.";

  if (prefixToMatch) {
    const prefixMatch = files.find(
      (f: any) => f.name.trim().startsWith(prefixToMatch)
    );
    if (prefixMatch) return prefixMatch.id;
  }

  // 3. Cek pencocokan prefiks aspek (misal "1.1") dengan Regex agar tidak tabrakan dengan "1.10"
  if (/^\d+\.\d+$/.test(cleanFolderName) || cleanFolderName.startsWith("Aspek ")) {
    let aspectId = cleanFolderName;
    if (cleanFolderName.startsWith("Aspek ")) {
      const match = cleanFolderName.match(/^Aspek\s+(\d+\.\d+)/);
      if (match) aspectId = match[1];
    }
    const regex = new RegExp(`^${aspectId.replace(".", "\\.")}([^\\d]|$)`);
    const prefixMatch = files.find(
      (f: any) => regex.test(f.name.trim())
    );
    if (prefixMatch) return prefixMatch.id;
  }

  // Jika tidak ditemukan, buat folder baru
  const createRes = await fetch("https://www.googleapis.com/drive/v3/files", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: folderName,
      mimeType: "application/vnd.google-apps.folder",
      parents: [parentId],
    }),
  });
  const createData = await createRes.json();
  return createData.id;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { fileName, mimeType, fileBase64, folderPath, rootFolderId } = await req.json();

    const rawServiceAccount = Deno.env.get("GOOGLE_SERVICE_ACCOUNT_KEY");
    if (!rawServiceAccount) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "GOOGLE_SERVICE_ACCOUNT_KEY belum di-set di Supabase secrets.",
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const serviceAccountJson = JSON.parse(rawServiceAccount);
    const accessToken = await getGoogleAccessToken(serviceAccountJson);

    // Navigasi & Buat Hirarki Folder Berjenjang
    let currentParentId = rootFolderId || "1PdFTH0qA79v3uS7Y8WkQOkRKiNV2TyxC";
    if (Array.isArray(folderPath)) {
      for (const folderName of folderPath) {
        if (folderName && folderName.trim()) {
          currentParentId = await getOrCreateFolder(folderName.trim(), currentParentId, accessToken);
        }
      }
    }

    // Unggah Berkas ke Subfolder Akhir
    const fileBytes = Uint8Array.from(atob(fileBase64), c => c.charCodeAt(0));
    const metadata = {
      name: fileName,
      parents: [currentParentId],
    };

    const form = new FormData();
    form.append(
      "metadata",
      new Blob([JSON.stringify(metadata)], { type: "application/json" })
    );
    form.append("file", new Blob([fileBytes], { type: mimeType || "application/octet-stream" }));

    const uploadRes = await fetch(
      "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink,webContentLink",
      {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}` },
        body: form,
      }
    );

    const uploadData = await uploadRes.json();

    return new Response(
      JSON.stringify({
        success: true,
        fileId: uploadData.id,
        webViewLink: uploadData.webViewLink || `https://drive.google.com/file/d/${uploadData.id}/view`,
        targetFolderId: currentParentId,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({ success: false, error: err.message || "Gagal mengunggah file ke Google Drive" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
