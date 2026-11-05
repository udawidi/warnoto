import * as XLSX from "xlsx";
import { unzipSync, zipSync, strFromU8, strToU8 } from "fflate";
import { getScopeUptIds, ROLES } from "./roles.js";
import { getHeavyEquipmentUptId, normalizeHeavyEquipmentRecord, getEquipmentCategory } from "./heavyEquipment.js";

export function scopeHeavyEquipmentForExport(equipmentList = [], currentUser, uptList = []) {
  if (!currentUser?.role || !Object.prototype.hasOwnProperty.call(ROLES, currentUser.role)) return [];
  if (["ADMIN_UIT", "ASMAN_LOG_UIT", "MGR_LOGISTIK_UIT", "HAR_UIT"].includes(currentUser.role) && !currentUser.uitId) return [];
  const scope = getScopeUptIds(currentUser, uptList);
  return equipmentList
    .map(normalizeHeavyEquipmentRecord)
    .filter(item => {
      const ownerId = getHeavyEquipmentUptId(item, uptList);
      if (scope === null) return true;
      return !!ownerId && scope.includes(ownerId);
    });
}

function permitLabel(value) {
  if (!value) return "Tidak ada";
  if (/^data:/i.test(String(value))) return "Tersedia (file)";
  return String(value).slice(0, 32767);
}

const xmlEscape = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&apos;" }[c]));

function dataUrlBytes(value) {
  const m = String(value || "").match(/^data:([^;,]+)?(;base64)?,(.*)$/i);
  if (!m) return null;
  const body = decodeURIComponent(m[3]);
  if (!m[2]) return { bytes: new TextEncoder().encode(body), type: m[1] || "image/png" };
  const binary = atob(body);
  return { bytes: Uint8Array.from(binary, c => c.charCodeAt(0)), type: m[1] || "image/png" };
}

async function loadPhoto(value, timeoutMs = 12000) {
  if (!value) return { status: "Belum ada foto" };
  try {
    let image = dataUrlBytes(value);
    if (!image) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetch(value, { signal: controller.signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        image = { bytes: new Uint8Array(await response.arrayBuffer()), type: response.headers.get("content-type") || "image/jpeg" };
      } finally { clearTimeout(timer); }
    }
    const png = image.bytes[0] === 0x89 && image.bytes[1] === 0x50 && image.bytes[2] === 0x4e && image.bytes[3] === 0x47;
    const jpeg = image.bytes[0] === 0xff && image.bytes[1] === 0xd8 && image.bytes[2] === 0xff;
    const webp = image.bytes[0] === 0x52 && image.bytes[1] === 0x49 && image.bytes[2] === 0x46 && image.bytes[3] === 0x46 && image.bytes[8] === 0x57 && image.bytes[9] === 0x45 && image.bytes[10] === 0x42 && image.bytes[11] === 0x50;
    if (!png && !jpeg && !webp) throw new Error("Respons bukan gambar yang valid");
    image.type = png ? "image/png" : webp ? "image/webp" : "image/jpeg";
    // Decode all browser images and downscale proportionally for a compact workbook.
    if (typeof Image !== "undefined" && typeof document !== "undefined") {
      const blob = new Blob([image.bytes], { type: image.type });
      if (!blob.size) throw new Error("Foto kosong");
      const url = URL.createObjectURL(blob);
      try {
        const bitmap = await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error("Decode foto timeout")), timeoutMs); const img = new Image(); img.onload = () => { clearTimeout(timer); resolve(img); }; img.onerror = error => { clearTimeout(timer); reject(error); }; img.src = url; });
        const ratio = Math.min(1, 280 / bitmap.naturalWidth, 140 / bitmap.naturalHeight);
        const canvas = document.createElement("canvas"); canvas.width = Math.max(1, Math.round(bitmap.naturalWidth * ratio)); canvas.height = Math.max(1, Math.round(bitmap.naturalHeight * ratio));
        const context = canvas.getContext("2d"); if (!context) throw new Error("Canvas tidak tersedia"); context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        const png = await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error("Encode foto timeout")), timeoutMs); canvas.toBlob(blobValue => { clearTimeout(timer); blobValue ? resolve(blobValue) : reject(new Error("Gagal encode foto")); }, "image/png"); });
        image = { bytes: new Uint8Array(await png.arrayBuffer()), type: "image/png", width: canvas.width, height: canvas.height };
      } finally { URL.revokeObjectURL(url); }
    }
    return { status: "Foto tertanam", bytes: image.bytes, width: image.width || 280, height: image.height || 140, ext: image.type.toLowerCase().includes("png") ? "png" : image.type.toLowerCase().includes("webp") ? "webp" : "jpeg" };
  } catch (error) { return { status: "Gagal memuat foto", error: error?.message || "unknown" }; }
}

function sheetEntry(zip, name) {
  const workbook = strFromU8(zip["xl/workbook.xml"] || new Uint8Array());
  const tag = [...workbook.matchAll(/<sheet\b[^>]*\/>/g)].map(m => m[0]).find(x => x.includes(`name="${name}"`));
  const rid = tag?.match(/r:id="([^"]+)"/)?.[1];
  const rels = strFromU8(zip["xl/_rels/workbook.xml.rels"] || new Uint8Array());
  const rel = [...rels.matchAll(/<Relationship\b[^>]*\/>/g)].map(m => m[0]).find(x => x.includes(`Id="${rid}"`));
  const target = rel?.match(/Target="([^"]+)"/)?.[1]?.replace(/^\//, "");
  return target ? (target.startsWith("xl/") ? target : `xl/${target}`) : null;
}

function embedPhotos(bytes, photos) {
  const zip = unzipSync(new Uint8Array(bytes));
  const sheet = sheetEntry(zip, "Lampiran Foto");
  const media = photos.filter(p => p.bytes);
  if (!sheet || !media.length) return zipSync(zip);
  const anchors = media.map((photo, i) => {
    const row = photo.row - 1; const col = 6;
    const originalWidth = photo.width || 280; const originalHeight = photo.height || 140;
    const scale = Math.min(1, 280 / originalWidth, 140 / originalHeight);
    const width = originalWidth * scale; const height = originalHeight * scale;
    return `<xdr:oneCellAnchor><xdr:from><xdr:col>${col}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${row}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:ext cx="${Math.round(width * 9525)}" cy="${Math.round(height * 9525)}"/><xdr:pic><xdr:nvPicPr><xdr:cNvPr id="${i + 1}" name="Alat-${xmlEscape(photo.id)}"/><xdr:cNvPicPr/></xdr:nvPicPr><xdr:blipFill><a:blip r:embed="rId${i + 1}"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill><xdr:spPr><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic><xdr:clientData/></xdr:oneCellAnchor>`;
  }).join("");
  zip["xl/drawings/drawing1.xml"] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">${anchors}</xdr:wsDr>`);
  zip["xl/drawings/_rels/drawing1.xml.rels"] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${media.map((p, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image${i + 1}.${p.ext}"/>`).join("")}</Relationships>`);
  media.forEach((p, i) => { zip[`xl/media/image${i + 1}.${p.ext}`] = p.bytes; });
  const relPath = sheet.replace("xl/worksheets/", "xl/worksheets/_rels/") + ".rels";
  const rels = strFromU8(zip[relPath] || strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`)).replace("<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\"/>", "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\"></Relationships>");
  const ids = [...rels.matchAll(/Id="rId(\d+)"/g)].map(m => Number(m[1])); const drawingRid = `rId${Math.max(0, ...ids) + 1}`;
  zip[relPath] = strToU8(rels.replace("</Relationships>", `<Relationship Id="${drawingRid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/></Relationships>`));
  zip[sheet] = strToU8(strFromU8(zip[sheet]).replace("</worksheet>", `<drawing r:id="${drawingRid}"/></worksheet>`));
  const types = strFromU8(zip["[Content_Types].xml"]);
  const defaults = `${types.includes('Extension="png"') ? "" : '<Default Extension="png" ContentType="image/png"/>'}${types.includes('Extension="jpeg"') ? "" : '<Default Extension="jpeg" ContentType="image/jpeg"/>'}`;
  zip["[Content_Types].xml"] = strToU8(types.replace("</Types>", `${defaults}<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/></Types>`));
  return zipSync(zip);
}

export async function exportHeavyEquipmentXlsx({ equipmentList = [], currentUser, uptList = [], scopeLabel = "scope", onProgress, showToast } = {}) {
  const rows = scopeHeavyEquipmentForExport(equipmentList, currentUser, uptList);
  if (!rows.length) throw new Error("Tidak ada alat berat dalam cakupan role Anda.");
  const uptLabel = item => item.uptId ? (uptList.find(u => u.id === item.uptId)?.nama || item.upt || "") : (item.upt || "");
  const images = rows.map(item => ({
      ID: item.id || "", UPT: uptLabel(item), "Gudang/Lokasi": item.lokasi || "", Nama: item.nama || "",
      Jenis: item.jenis || "", Kategori: item.kategori || getEquipmentCategory(item) || "", "Jenis Aset": item.assetType || "ALAT_BERAT", "Merk/Type": item.merkType || "", Kapasitas: item.kapasitas || "",
      "No. Seri": String(item.nomorSeri || ""), Tahun: item.tahun || "", Spesifikasi: item.specification || "", Kondisi: item.kondisi || "",
      "Status Alat": item.statusAlat || "", "Status Ketersediaan": item.availabilityStatus || "", "Mode Pencatatan": item.trackingMode || "",
      Jumlah: item.quantityTotal || 1, Satuan: item.unit || "unit", "Surat Izin": permitLabel(item.suratIzinAlat), Foto: item.foto ? "Menunggu foto" : "Belum ada foto",
    }));
  const photos = [];
  for (let index = 0; index < rows.length; index += 1) {
    const item = rows[index];
    const loaded = await loadPhoto(item.foto);
    images[index].Foto = loaded.status;
    photos.push({ ...loaded, row: index + 2, id: item.id || "", UPT: uptLabel(item), Nama: item.nama || "", Kondisi: item.kondisi || "" });
    onProgress?.(Math.round(((index + 1) / rows.length) * 70));
  }
  const failed = photos.filter(p => p.status === "Gagal memuat foto").length;
  const photoRows = photos.map(p => ({ ID: p.id, UPT: p.UPT, Nama: p.Nama, Kondisi: p.Kondisi, Foto: p.status, Keterangan: p.status === "Foto tertanam" ? "Foto tertanam offline" : p.status }));
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(images);
  const photoWs = XLSX.utils.json_to_sheet(photoRows);
  ws["!cols"] = Object.keys(images[0]).map(() => ({ wch: 18 }));
  photoWs["!cols"] = [{ wch: 18 }, { wch: 18 }, { wch: 28 }, { wch: 24 }, { wch: 60 }, { wch: 28 }];
  photoWs["!rows"] = [{ hpt: 22 }, ...photos.map(() => ({ hpt: 110 }))];
  XLSX.utils.book_append_sheet(wb, ws, "Inventaris");
  XLSX.utils.book_append_sheet(wb, photoWs, "Lampiran Foto");
  onProgress?.(90);
  const raw = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  const output = embedPhotos(raw, photos);
  const safeScope = String(scopeLabel || "scope").replace(/[^\w-]+/g, "_");
  if (typeof document !== "undefined") {
    const blob = new Blob([output], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = `Alat_Berat_${safeScope}_${new Date().toISOString().slice(0, 10)}.xlsx`; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  onProgress?.(100);
  showToast?.(failed ? `Ekspor selesai, ${failed} foto gagal dimuat.` : `Ekspor ${rows.length} alat berat selesai.`, failed ? "error" : "success");
  return { count: rows.length, failedPhotos: failed, bytes: output };
}
