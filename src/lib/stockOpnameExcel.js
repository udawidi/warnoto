import * as XLSX from "xlsx";
import { buildStockOpnameComparisons } from "./stockOpnameReconciliation.js";

const safeText = value => String(value ?? "").trim();
const qty = value => value === null || value === undefined ? "—" : value;

export function stockOpnameExportRows(opn = {}) {
  const items = Array.isArray(opn.items) ? opn.items : [];
  const isSap = opn.jenisAlur === "SAP";
  return buildStockOpnameComparisons(items, { isSap }).map(comparison => {
    const item = items[comparison.representativeIndex] || {};
    const physical = comparison.physicalQty;
    const system = comparison.systemQty;
    const sap = isSap ? comparison.sapQty : null;
    const status = physical === null ? "Belum lengkap" : comparison.discrepant ? "Selisih" : "Sesuai";
    return {
      "No Katalog": safeText(item.katalogId || item.noKatalog || comparison.key),
      "Nama Material": safeText(item.namaBarang || item.nama || item.deskripsi || "—"),
      "Satuan": safeText(item.satuan || item.unit || "—"),
      "Qty SAP": qty(sap),
      "Qty System/WARNOTO": system,
      "Qty Fisik": qty(physical),
      "Selisih Fisik–System": physical === null ? "—" : physical - system,
      "Selisih Fisik–SAP": !isSap || physical === null || sap === null ? "—" : physical - sap,
      "Status Rekonsiliasi": status,
      "Keterangan": safeText(item.keterangan || comparison.recommendation || "—"),
    };
  });
}

export function buildStockOpnameWorkbook(opn = {}) {
  const rows = stockOpnameExportRows(opn);
  const discrepant = rows.filter(row => row["Status Rekonsiliasi"] === "Selisih");
  const matching = rows.filter(row => row["Status Rekonsiliasi"] === "Sesuai");
  const summary = [
    ["Stock Opname", opn.id || "—"],
    ["Semester", opn.semester || "—"],
    ["Jenis Alur", opn.jenisAlur || "—"],
    ["Kategori", opn.kategori || "—"],
    ["Status", opn.status || "—"],
    ["Approval Asman", opn.approvedAtAsman ? new Date(opn.approvedAtAsman).toLocaleString("id-ID") : "—"],
    [],
    ["Total Material", rows.length],
    ["Total Selisih", discrepant.length],
    ["Total Sesuai", matching.length],
  ];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(summary), "Ringkasan");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(discrepant), "Selisih");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(matching), "Sesuai");
  return workbook;
}

export function sanitizeStockOpnameFilename(value) {
  return safeText(value).replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/^_+|_+$/g, "") || "opname";
}

export function downloadStockOpnameExcel(opn) {
  const filename = ["Stock_Opname", opn.semester, opn.jenisAlur, opn.id]
    .map(sanitizeStockOpnameFilename).join("_") + ".xlsx";
  XLSX.writeFile(buildStockOpnameWorkbook(opn), filename);
  return filename;
}
