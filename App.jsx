// PT. PLN UPT Surabaya - Gudang Ketintang
// Sistem Tata Usaha Gudang (TUG) Digital - v3.0
// TUG-9: Bon Pemakaian + Surat Jalan + BAST

import { useState, useEffect, useRef, useCallback } from "react";
import { createClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";
import * as pdfjsLib from "pdfjs-dist";
import pdfjsWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;
import { recognize as ocrRecognize } from "tesseract.js";
import { PLN_LOGO_DATA_URI } from "./src/assets/plnLogoBase64.js";
import { decode as olcDecode, isFull as olcIsFull, recoverNearest as olcRecoverNearest } from "./src/lib/openLocationCode.js";

// ─── CONSTANTS ──────────────────────────────────────────────────────
const COMPANY = "PT. PLN (Persero)";
const UIT = "Unit Induk Transmisi Jawa Bagian Timur dan Bali";
const UPT = "UPT Surabaya";
const WAREHOUSE = "Gudang Ketintang";
const DOC_CODE = "LOG.00.02";
const APP_VERSION = "v3.0.0";

// ─── SUPABASE CLIENT ────────────────────────────────────────────────
// Satu client dipakai untuk auth (login/sesi/logout) maupun REST sync
// (tug15_history, stock_current, dst — lihat fungsi sync di bawah).
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const supabase = (SUPABASE_URL && SUPABASE_KEY) ? createClient(SUPABASE_URL, SUPABASE_KEY) : null;
// Supabase Auth butuh format email; akun PLN login pakai username pendek
// seperti sebelumnya, jadi kita tempelkan domain sintetis di belakangnya.
// Tidak perlu domain ini benar-benar bisa terima email (Fase 1 belum pakai
// fitur reset password lewat email — Admin reset manual via Dashboard).
const AUTH_EMAIL_DOMAIN = "@warnoto.pln.local";
function usernameToAuthEmail(username) { return `${(username||"").trim().toLowerCase()}${AUTH_EMAIL_DOMAIN}`; }

// ─── RAG (Retrieval-Augmented Generation) — knowledge base AI Agent ────
// Embedding pakai Cohere (embed-multilingual-v3.0, 1024 dim) — model
// terpisah dari Groq (dipakai untuk chat), karena Groq tidak punya endpoint
// embedding. Vector disimpan di Supabase (pgvector, tabel rag_chunks, lihat
// schema.sql section 9), dicari via fungsi match_rag_chunks (cosine
// similarity) saat user bertanya ke AI Agent.
async function cohereEmbed(texts, inputType) {
  const key = import.meta.env.VITE_COHERE_API_KEY;
  if (!key) throw new Error("VITE_COHERE_API_KEY belum diisi di .env");
  const resp = await fetch("https://api.cohere.com/v1/embed", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}` },
    body: JSON.stringify({ model: "embed-multilingual-v3.0", texts, input_type: inputType }),
  });
  if (!resp.ok) throw new Error(`Cohere embed gagal (${resp.status}): ${await resp.text()}`);
  const data = await resp.json();
  return data.embeddings; // array of vectors, sejajar urutan dengan `texts`
}
// Teks deskriptif 1 katalog — dipakai sebagai 1 "chunk" RAG.
// stockInfo (opsional): {qty, price, locations:[{gudang,blok,qty}]} hasil agregasi
// enrichedStocks per katalogId — supaya chunk RAG ikut bawa angka real-time (qty/harga/
// nilai Rupiah) + lokasi presisi (gudang & blok mana), bukan cuma teks deskriptif.
// Tanpa ini bot WA/Telegram cuma bisa jawab nama/satuan untuk material di luar top-20/kritis,
// dan tidak tahu sama sekali material itu fisiknya ada di gudang/blok mana.
function buildKatalogRagContent(k, stockInfo) {
  const sap = getSAPLabel(k.katalog);
  if (!stockInfo) return `Material: ${k.name}. Nomor Katalog: ${k.katalog||"-"}. Kategori: ${k.category||"-"}. Jenis Barang: ${k.jenisBarang||"-"}. Satuan: ${k.satuan||"-"}. Keterangan: ${k.keterangan||"-"}. Status: ${sap}. Belum ada data stok untuk material ini.`;
  const angka = ` Qty saat ini: ${fmtNum(stockInfo.qty)} ${k.satuan||"-"}. Harga satuan: Rp ${fmtNum(Math.round(stockInfo.price))}. Nilai total: Rp ${fmtNum(Math.round(stockInfo.qty*stockInfo.price))}.`;
  const lokasiText = (stockInfo.locations||[]).length===0 ? " Lokasi: belum diisi." :
    ` Lokasi fisik: ${stockInfo.locations.map(l=>`${fmtNum(l.qty)} ${k.satuan||""} di ${l.gudang||"Gudang tidak diketahui"} blok ${l.blok||"-"}`).join("; ")}.`;
  return `Material: ${k.name}. Nomor Katalog: ${k.katalog||"-"}. Kategori: ${k.category||"-"}. Jenis Barang: ${k.jenisBarang||"-"}. Satuan: ${k.satuan||"-"}. Keterangan: ${k.keterangan||"-"}. Status: ${sap}.${angka}${lokasiText}`;
}
// Ringkasan 1 transaksi TUG (approved) — dipakai sebagai 1 "chunk" RAG.
function buildTxnRagContent(t) {
  const namaBarang = (t.stockItems||[]).map(si=>si.namaBarang||si.name).filter(Boolean).join(", ") || "-";
  return `Transaksi ${t.docType||"-"} (${t.id}) — Pekerjaan: ${t.namaPekerjaan||t.pekerjaan||"-"}. Lokasi: ${t.lokasiPekerjaan||"-"}. Tanggal: ${fmtDateOnly(t.createdAt)}. Status: ${t.status||"-"}. Barang: ${namaBarang}.`;
}

const JENIS_BARANG = ["Pre Memory", "Cadang", "Persediaan", "Persediaan Bursa", "ATTB", "Non-Stock", "Bongkaran"];
const STATUS_MATERIAL_RETUR = ["Material Sisa Baru", "Bongkaran", "Bongkaran ATTB (MTU)"]; // used in TUG-10 returns
// Maps a return status to the resulting Jenis Barang in Data Stok (null = leave as user's manual choice)
const STATUS_RETUR_TO_JENIS = { "Bongkaran": "Bongkaran", "Bongkaran ATTB (MTU)": "ATTB" };
const CATEGORIES = ["Transformator", "Kabel", "Panel", "Meter", "Tools", "Safety", "Consumable", "Spare Part", "Struktur", "Isolator", "Lainnya"];
const ROLES = { ADMIN: "Admin Gudang", TL: "TL Logistik", ASMAN: "Asman Konstruksi", MANAGER: "Manager", ADMIN_UIT: "Admin UIT", MGR_LOGISTIK_UIT: "Manager Logistik UIT", PENGADAAN: "Tim Pengadaan", VIEWER: "Viewer", ADMIN_ULTG: "Admin ULTG", MGR_ULTG: "Manager ULTG" };
const ULTG_ROLES = ["ADMIN_ULTG","MGR_ULTG"]; // role dengan sidebar terbatas (view-only + TUG-5 saja)
const ROMAN = ["I","II","III","IV","V","VI","VII","VIII","IX","X","XI","XII"];
// Who can create TUG-9 transactions
const CAN_CREATE = ["ADMIN", "TL"];
// Who can approve, and what happens
// ADMIN-created -> needs TL approve -> Asman auto-approved alongside
// TL-created     -> needs ASMAN approve -> directly APPROVED

const HEAVY_EQUIPMENT_RAW = `
HE-001|Surabaya|Gudang Ketintang|TRUCK CRANE|Angkat|Nissan|8 TON|||Baik|
HE-002|Surabaya|Gudang Ketintang|TRUCK CRANE|Angkat Angkut|Hino|3 TON|||Service Time|
HE-003|Surabaya|GI Sukolilo|TRUCK CRANE|Angkat Angkut|Isuzu|3 TON||2024|Baik|
HE-004|Surabaya|Gudang Ketintang|FORKLIFT|Angkat Angkut|Patria|3 TON|||Baik|
HE-005|Surabaya|Gudang Ketintang|FORKLIFT|Angkat Angkut|Nissan|5 TON|||Baik|
HE-006|Surabaya|Gudang Ketintang|MANLIFT|Angkat|Haulotte|-|||Baik|
HE-007|Surabaya|Gudang Ketintang|MOBILE MANLIFT|Angkat|Hino|-|||Baik|
HE-008|Surabaya|Gudang Ketintang|HANDLIFT|Angkat|Krisbow|3 TON||2025|Baik|
HE-009|Surabaya|Gudang Ketintang|HANDLIFT|Angkat|Magna|3 TON||2021|Baik|
HE-010|Surabaya|Gudang Wonorejo|HANDLIFT|Angkat|HEMNEX|3 TON||2026|Baik|
HE-011|Surabaya|Gudang Wonorejo|HANDLIFT|Angkat|HEMNEX|3 TON||2026|Baik|
HE-012|Surabaya|Gudang Ketintang|TRUCK|Angkut|Rangger|-|||Baik|
HE-013|Probolinggo|KANTOR UPT PROBOLINGGO|TRUCK CRANE 5 TON|ANGKAT  ANGKUT|TADANO|5000|||BAIK|PERPANJANGAN
HE-014|Probolinggo|KANTOR UPT PROBOLINGGO|TRUCK CRANE 3 TON|ANGKAT  ANGKUT|TADANO|3000|||BAIK|PERPANJANGAN
HE-015|Probolinggo|GUDANG BANGIL|FORKLIFT|ANGKAT|TOYOTA|5000|||BAIK|PERPANJANGAN
HE-016|Probolinggo|GUDANG BANGIL|HAND PALLET|ANGKAT|KRISBOW|2000|||KERUSAKAN PISTON|
HE-017|Probolinggo|GUDANG BANGIL|HAND STACKER|ANGKAT|CAR LIFT|2000|||BAIK|
HE-018|Probolinggo|GUDANG BANGIL|HAND STACKER SEMI ELECTRIC|ANGKAT|GONON|2000|||BAIK|
HE-019|Bali|KAPAL|TROLLEY||KRISBOW|300 KG|||BAIK|
HE-020|Bali|KAPAL|TROLLEY||KRISBOW|300 KG|10544133||BAIK|
HE-021|Bali|KAPAL|DRUM HANDLING TROLLEY||KRISBOW||050087-0025-0825||BAIK|
HE-022|Bali|KAPAL|HYDRAULIC HAND PALLET||DALTON|2 TON|||BAIK|
HE-023|Bali|KAPAL|HYDRAULIC HAND PALLET||KRISBOW|3 TON|||BAIK|
HE-024|Bali|KAPAL|HYDRAULIC HAND PALLET||TOYO|5 TON|||BAIK|
HE-025|Bali|KAPAL|HYDRAULIC HAND STACKER||KRISBOW|2 TON x 1.5 M|051845-0094-0825||BAIK|
HE-026|Bali|KAPAL|MANLIFT||HINO|200 KG|DK 9002 FB||BAIK|
HE-027|Bali|KAPAL|FORKLIFT||KOMATSU|1 TON|||BAIK|
HE-028|Bali|KAPAL|FORKLIFT||TCM|4 TON|59204586||BAIK|
HE-029|Bali|KAPAL|CRANE||TOYOTA|2 TON|DK 8126 FE||BAIK|
HE-030|Bali|KAPAL|TRUCK CRANE||ISUZU|5 TON|DK 8214 JF||BAIK|
HE-031|Madiun|GUDANG PLTD|CRANE|ANGKAT / ANGKUT|HINO / SANNY PALFINGER|4 TON|NR:FF173MA14295 ;NM: H07CEJ15745|1990|NORMAL / KONDISI FISIK 60%|
HE-032|Madiun|GUDANG PLTD|CRANE|ANGKAT / ANGKUT|ISUZU GIGA / SANNY PALFINGER|10 TON|NR:MHCFVZ34URJ000690; NM:6HK1F108452|2024|NORMAL / KONDISI FISIK BAGUS|
HE-033|Madiun|GUDANG PLTD|FORKLIFT|ANGKAT|TOYOTA|5 TON||2022|NORMAL / KONDISI FISIK BAGUS|
HE-034|Madiun|GUDANG ULTG BABAT|FORKLIFT|ANGKAT|PATRIA|2 TON||2012|NORMAL / KONDISI FISIK 60%|
HE-035|Madiun|GUDANG PLTD / GUDANG DOLOPO|HAND STACKER|ANGKAT|NOBLELIFT|2 TON||2023|NORMAL / KONDISI FISIK BAGUS|
HE-036|Madiun|GUDANG PLTD / GUDANG DOLOPO|HAND STACKER|ANGKAT|NOBLELIFT|2 TON||2023|NORMAL / KONDISI FISIK BAGUS|
HE-037|Madiun|GUDANG PLTD / GUDANG DOLOPO|HANDLIFT|ANGKAT|KRISBOW|2 TON||2022|GUDANG PLTD NORMAL / GUDANG DOLOPO BOCOR SIL OIL|
HE-038|Madiun|GUDANG PLTD / GUDANG DOLOPO|HANDLIFT|ANGKAT|KRISBOW|2 TON||2022|GUDANG PLTD NORMAL / GUDANG DOLOPO BOCOR SIL OIL|
HE-039|Gresik|Gudang Tandes|TRUCK CRANE|Angkat Angkut|Tadano|3 TON|KE2298|2020|Baik|28 May 2026
HE-040|Gresik|Gudang Tandes|TRUCK CRANE|Angkat Angkut|Isuzu|8 TON|1100183287|2026|Baik|
HE-041|Gresik|Gudang Tandes|FORKLIFT|Angkat Angkut|Toyota|5 TON|8FD50N-22639|2023|Baik|28 May 2026
HE-042|Gresik|Gudang Tandes|FORKLIFT|Angkat Angkut|Komatsu|3 TON|413225-P||Butuh Peremajaan|28 May 2026
HE-043|Gresik|Gudang Tandes|HAND PALLET|Angkat|Krisbow||||Baik|
HE-044|Gresik|Gudang Tandes|TROLLEY|Angkat|Krisbow||||Baik|
HE-045|Malang|Gudang Polehan|TRUCK CRANE||Hino|5 TON||2024|Baik|June 2026
HE-046|Malang|Gudang Polehan|FORKLIFT||Patria|3 TON|||Butuh Peremajaan|
HE-047|Malang|Gudang Polehan|HAND PALLET||Krisbow|3 TON||2025|Baik|
HE-048|Malang|Gudang Polehan|HAND STACKER||Wipro|3 TON||2025|Baik|
HE-049|Malang|Gudang Polehan|TRUCK||Hino Ranger|-|||Baik|
HE-050|Malang|Gudang Krian|TRUCK CRANE||Isuzu|8 TON||2018|Butuh Perbaikan|
HE-051|Malang|Gudang Mojokerto|TRUCK CRANE||Mitsubishi Fuso|5 TON|||Butuh Peremajaan|
`;

function normalizeHeavyEquipmentJenis(jenis, nama) {
  const raw = String(jenis || "").toUpperCase().replace(/\s+/g, " ").trim();
  if (raw.includes("ANGKAT") && raw.includes("ANGKUT")) return "Angkat Angkut";
  if (raw.includes("ANGKUT")) return "Angkut";
  if (raw.includes("ANGKAT")) return "Angkat";
  const n = String(nama || "").toUpperCase();
  if (n.includes("TRUCK") || n.includes("TROLLEY")) return "Angkut";
  return "Angkat";
}

function heavyEquipmentStatusFromKondisi(kondisi) {
  const s = String(kondisi || "").toUpperCase();
  if (s.includes("PEREMAJAAN")) return "BUTUH_PEREMAJAAN";
  if (s.includes("PERBAIKAN") || s.includes("KERUSAKAN") || s.includes("BOCOR")) return "BUTUH_PERBAIKAN";
  if (s.includes("SERVICE")) return "PERLU_SERVICE";
  return "LAYAK";
}

const DEFAULT_HEAVY_EQUIPMENT = HEAVY_EQUIPMENT_RAW.trim().split("\n").map(line => {
  const [id, upt, lokasi, nama, jenis, merkType, kapasitas, nomorSeri, tahun, kondisi, suratIzinAlat] = line.split("|");
  return {
    id, upt, lokasi, nama,
    jenis: normalizeHeavyEquipmentJenis(jenis, nama),
    merkType, kapasitas, nomorSeri, tahun, kondisi,
    statusAlat: heavyEquipmentStatusFromKondisi(kondisi),
    suratIzinAlat,
    foto: null,
    availabilityStatus: "TERSEDIA",
    source: "KAPASITAS GUDANG UIT JBM.xlsx - ALAT ANGKAT ANGKUT",
    createdAt: 1751245200000,
  };
});

// ─── CLOUD STORAGE (auto-detect: Artifact window.storage vs localStorage) ──
function getHeavyEquipmentLoanOwnerUpt(loan) {
  return loan?.ownerUpt || loan?.fromUpt || loan?.requiredApproverUpt || "";
}

function getHeavyEquipmentLoanRequesterUpt(loan) {
  return loan?.requesterUpt || loan?.toUpt || "";
}

function getHeavyEquipmentLoanStartDate(loan) {
  return loan?.tanggalAmbil || loan?.tanggalMulai || "";
}

function getHeavyEquipmentLoanReturnDate(loan) {
  return loan?.tanggalKembali || loan?.tanggalSelesai || "";
}

function getHeavyEquipmentLoanJobName(loan) {
  return loan?.namaPekerjaan || loan?.keperluan || "";
}

function normalizeHeavyEquipmentLoanStatus(status) {
  if (status === "PENDING_ASMAN") return "PENDING_OWNER_ASMAN";
  if (status === "APPROVED") return "DIPINJAM";
  return status || "PENDING_OWNER_ASMAN";
}

function isPendingHeavyEquipmentLoan(loan) {
  return normalizeHeavyEquipmentLoanStatus(loan?.status) === "PENDING_OWNER_ASMAN";
}

function getHeavyEquipmentLoanRuntimeStatus(loan, now = Date.now()) {
  const normalized = normalizeHeavyEquipmentLoanStatus(loan?.status);
  if (["SELESAI", "REJECTED", "PENDING_OWNER_ASMAN"].includes(normalized)) return normalized;
  const plannedReturn = getHeavyEquipmentLoanReturnDate(loan);
  if (plannedReturn) {
    const returnEnd = new Date(`${plannedReturn}T23:59:59`).getTime();
    if (!Number.isNaN(returnEnd) && returnEnd < now) return "OVERDUE";
  }
  return normalized;
}

function getUserUptScope(user) {
  // currentUser.upt/uptName/uptKode/uptId nyaris selalu kosong untuk akun biasa (belum di-assign
  // per-user) — fallback ke const UPT global (deployment ini = 1 UPT), pola sama seperti `myUpt`
  // di HeavyEquipmentTabV2 dan AI Agent, supaya scoping tidak diam-diam lolos jadi "boleh semua".
  const appUptShort = (typeof UPT !== "undefined" ? UPT : "").replace(/^UPT\s+/i, "").trim();
  return user?.upt || user?.uptName || user?.uptKode || user?.uptId || appUptShort || "";
}

function canApproveHeavyEquipmentLoan(user, loan) {
  if (user?.role !== "ASMAN") return false;
  const userUpt = getUserUptScope(user);
  // Approval discope ke UNIT PEMINJAM (requesterUpt) — Asman UPT sendiri hanya boleh approve
  // pengajuan peminjaman YANG DIAJUKAN OLEH UPT-nya sendiri, bukan berdasar pemilik alat.
  const requesterUpt = getHeavyEquipmentLoanRequesterUpt(loan);
  return !requesterUpt || userUpt === requesterUpt;
}

const CLOUD = {
  async get(key) {
    try {
      if (typeof window.storage !== 'undefined') {
        const r = await window.storage.get(key);
        return r ? JSON.parse(r.value) : null;
      } else {
        const val = localStorage.getItem('warnoto_' + key);
        return val ? JSON.parse(val) : null;
      }
    } catch { return null; }
  },
  async set(key, val) {
    try {
      if (typeof window.storage !== 'undefined') {
        await window.storage.set(key, JSON.stringify(val));
      } else {
        localStorage.setItem('warnoto_' + key, JSON.stringify(val));
      }
      return true;
    } catch { return false; }
  },
};

// ─── MASTER DATA TABLES (Supabase = sumber utama) ──────────────────────
// Satpam, Tim Mutu, UIT, UPT, Gudang, Lokasi dulu hanya tersimpan di
// localStorage/CLOUD (per-browser, tidak sinkron antar device/user). Sekarang
// disimpan sebagai baris asli di Supabase: 1 baris = {id, data jsonb, ...kolom
// relasi}. Kolom `data` menyimpan object JS apa adanya (field-nya beragam dan
// berkembang seiring waktu, mis. lokasi punya mapX/mapY/pendingData/jenisArea
// yang tidak semua dipakai di semua baris) — kolom id/relasi/status dipisah
// supaya tetap bisa di-query/relasikan di Supabase Studio, tapi tidak perlu
// mendaftar ulang setiap field yang mungkin ada.
async function loadMasterTable(table) {
  if (!supabase) return null;
  const { data, error } = await supabase.from(table).select("*");
  if (error) { console.error(`loadMasterTable(${table})`, error); return null; }
  return data.map(row => ({ ...row.data, id: row.id }));
}
// extraCols(item) => kolom tambahan per baris (FK/status) di luar id & data, opsional
async function syncMasterTable(table, list, extraCols) {
  if (!supabase) return false;
  const rows = list.map(item => ({
    id: item.id,
    data: item,
    created_at: item.createdAt ?? Date.now(),
    ...(extraCols ? extraCols(item) : {}),
  }));
  if (rows.length) {
    const { error } = await supabase.from(table).upsert(rows, { onConflict: "id" });
    if (error) { console.error(`syncMasterTable upsert(${table})`, error); return false; }
  }
  const { data: existing, error: selErr } = await supabase.from(table).select("id");
  if (selErr) { console.error(`syncMasterTable select(${table})`, selErr); return false; }
  const currentIds = new Set(list.map(i => i.id));
  const toDelete = (existing || []).filter(r => !currentIds.has(r.id)).map(r => r.id);
  if (toDelete.length) {
    const { error: delErr } = await supabase.from(table).delete().in("id", toDelete);
    if (delErr) { console.error(`syncMasterTable delete(${table})`, delErr); return false; }
  }
  return true;
}
// Seed Supabase sekali dari DEFAULT_* kalau tabelnya masih kosong (instalasi pertama kali)
async function seedMasterTableIfEmpty(table, defaults, extraCols) {
  if (!supabase || !defaults?.length) return defaults || [];
  const existing = await loadMasterTable(table);
  if (existing === null) return defaults; // Supabase tidak terkonfigurasi/error — fallback lokal
  if (existing.length > 0) return existing;
  await syncMasterTable(table, defaults, extraCols);
  return defaults;
}

// ─── DEFAULT DATA ────────────────────────────────────────────────────
// User & password TIDAK lagi disimpan di source code (lihat Supabase Auth +
// tabel "profiles" di supabase/schema.sql) — daftar user kini di-fetch dari
// Supabase setelah login, bukan array statis seperti sebelumnya.

// ─── MASTER UIT (Unit Induk Transmisi) ─────────────────────────────────
const DEFAULT_UIT = [
  { id:"UIT-JBM", nama:"PT PLN (PERSERO) UNIT INDUK TRANSMISI JAWA BAGIAN TIMUR DAN BALI", kode:"UIT-JBM", alamat:"Jl. Ketintang Baru No. 9 Surabaya 60231", createdAt:Date.now() },
];

// ─── MASTER UPT (Unit Pelaksana Transmisi dalam UIT-JBM) ───────────────
const DEFAULT_UPT_LIST = [
  { id:"UPT-SBY", nama:"UPT Surabaya", kode:"UPT-SBYA", alamat:"Jl. Ketintang Baru No. 9 Surabaya", uitId:"UIT-JBM", createdAt:Date.now() },
  { id:"UPT-MLG", nama:"UPT Malang", kode:"UPT-MLG", alamat:"Malang, Jawa Timur", uitId:"UIT-JBM", createdAt:Date.now() },
  { id:"UPT-MDN", nama:"UPT Madiun", kode:"UPT-MDN", alamat:"Madiun, Jawa Timur", uitId:"UIT-JBM", createdAt:Date.now() },
  { id:"UPT-PBG", nama:"UPT Probolinggo", kode:"UPT-PBG", alamat:"Probolinggo, Jawa Timur", uitId:"UIT-JBM", createdAt:Date.now() },
  { id:"UPT-BLI", nama:"UPT Bali", kode:"UPT-BLI", alamat:"Bali", uitId:"UIT-JBM", createdAt:Date.now() },
  { id:"UPT-GRS", nama:"UPT Gresik", kode:"UPT-GRS", alamat:"Gresik, Jawa Timur", uitId:"UIT-JBM", createdAt:Date.now() },
];

// ─── MASTER GUDANG (bangunan gudang, parent dari Blok/Lokasi) ──────────
const MATURITY_LEVELS = { 1:"Basic", 2:"Developing", 3:"Defined", 4:"Managed", 5:"Excellent" };
const SURABAYA_REF_LAT = -7.2575, SURABAYA_REF_LNG = 112.7521; // titik tengah Surabaya, dipakai sbg referensi decode Plus Code pendek (offline, tanpa API)

// Cari & decode Google Maps Plus Code (cth "MPJG+4JX, Ketintang, Gayungan, Surabaya, East Java 60231")
// dari teks alamat bebas → {lat,lng}. Plus Code pendek di-recover memakai titik tengah Surabaya
// sebagai referensi (akurat selama lokasinya memang di area Surabaya). Tidak butuh internet/API key.
function extractLatLngFromAddress(text) {
  if (!text) return null;
  const m = (text.match(/[23456789CFGHJMPQRVWX]{2,8}\+[23456789CFGHJMPQRVWX]{2,3}/i) || [])[0];
  if (!m) return null;
  try {
    const code = m.toUpperCase();
    const full = olcIsFull(code) ? code : olcRecoverNearest(code, SURABAYA_REF_LAT, SURABAYA_REF_LNG);
    const area = olcDecode(full);
    return { lat: Math.round(area.latitudeCenter*1e6)/1e6, lng: Math.round(area.longitudeCenter*1e6)/1e6 };
  } catch (e) {
    return null;
  }
}
const DEFAULT_GUDANG = [
  { id:"GDG-001", nama:"Gudang Ketintang", kode:"GTK", alamat:"Jl. Ketintang Baru No. 9 Surabaya", uptId:"UPT-SBY", lat:-7.3185, lng:112.7244, denahImageData:null, denahUploadedAt:null, createdAt:Date.now() },
];

const DEFAULT_SATPAM = [
  { id:"SP001", name:"Robby Demas Riady", telp:"", createdAt:Date.now() },
  { id:"SP002", name:"Yudi Hartono", telp:"", createdAt:Date.now() },
];

// ─── MASTER TIM MUTU (2 paket tetap, dipakai di TUG-4) ─────────────────
const DEFAULT_TIM_MUTU = [
  { id:"TM-300PLUS", label:"Tim Mutu ≥ Rp 300 Juta", ketua:"Warnoto", sekretaris:"Imam Nawawi", anggota1:"Sumarwan", anggota2:"", anggota3:"", createdAt:Date.now() },
  { id:"TM-300MIN", label:"Tim Mutu < Rp 300 Juta", ketua:"Warnoto", sekretaris:"Imam Nawawi", anggota1:"", anggota2:"", anggota3:"", createdAt:Date.now() },
];

// ─── MASTER KATALOG BARANG (identitas tetap barang) ───────────────────
const DEFAULT_KATALOG = [
  {id:"KAT-1060011",name:"TRF ACC;NGR 70kV 200 Ohm",katalog:"1060011",satuan:"U",jenisBarang:"Persediaan",merk:"",type:"",keterangan:"HAR-Transformator",createdAt:1751000000000},
  {id:"KAT-1060018",name:"TRF ACC;SUDD PRESS",katalog:"1060018",satuan:"BH",jenisBarang:"Pre Memory",merk:"",type:"",keterangan:"HAR-Transformator",createdAt:1751000000000},
  {id:"KAT-1060029",name:"TRF ACC;BUCHOLZ 150kV",katalog:"1060029",satuan:"SET",jenisBarang:"Pre Memory",merk:"",type:"",keterangan:"HAR-Transformator",createdAt:1751000000000},
  {id:"KAT-1060031",name:"TRF ACC;BUSHING 150kV",katalog:"1060031",satuan:"BH",jenisBarang:"Persediaan Bursa",merk:"",type:"",keterangan:"HAR-Material Bursa",createdAt:1751000000000},
  {id:"KAT-1060035",name:"TRF ACC;BUSHING 20kV",katalog:"1060035",satuan:"BH",jenisBarang:"Pre Memory",merk:"",type:"",keterangan:"HAR-Transformator",createdAt:1751000000000},
  {id:"KAT-1060045",name:"TRF ACC;BUSHING 150kV HV",katalog:"1060045",satuan:"BH",jenisBarang:"Pre Memory",merk:"",type:"",keterangan:"HAR-Transformator",createdAt:1751000000000},
  {id:"KAT-1060058",name:"TRF ACC;OIL LEVEL INDIKATOR",katalog:"1060058",satuan:"BH",jenisBarang:"Pre Memory",merk:"",type:"",keterangan:"HAR-Transformator",createdAt:1751000000000},
  {id:"KAT-1060080",name:"TRF ACC;OLTC BREATHER SILICAGEL",katalog:"1060080",satuan:"U",jenisBarang:"Pre Memory",merk:"",type:"",keterangan:"HAR-Transformator",createdAt:1751000000000},
  {id:"KAT-1060132",name:"TRF ACC;GATE VALVE",katalog:"1060132",satuan:"BH",jenisBarang:"Pre Memory",merk:"",type:"",keterangan:"HAR-Transformator",createdAt:1751000000000},
  {id:"KAT-1060149",name:"TRF ACC;OIL TEMPERATURE INDICATOR",katalog:"1060149",satuan:"BH",jenisBarang:"Pre Memory",merk:"",type:"",keterangan:"HAR-Transformator",createdAt:1751000000000},
  {id:"KAT-1060154",name:"TRF ACC;BUSHING NEUTRAL 150kV HV",katalog:"1060154",satuan:"BH",jenisBarang:"Pre Memory",merk:"",type:"",keterangan:"HAR-Transformator",createdAt:1751000000000},
  {id:"KAT-1060181",name:"TRF ACC;FAN",katalog:"1060181",satuan:"BH",jenisBarang:"Pre Memory",merk:"",type:"",keterangan:"HAR-Transformator",createdAt:1751000000000},
  {id:"KAT-1060544",name:"TRF ACC;CIRCULATING OIL PUMP",katalog:"1060544",satuan:"BH",jenisBarang:"Pre Memory",merk:"",type:"",keterangan:"HAR-Transformator",createdAt:1751000000000},
  {id:"KAT-1060562",name:"TRF ACC;BUSHING 70KV",katalog:"1060562",satuan:"BH",jenisBarang:"Persediaan Bursa",merk:"",type:"",keterangan:"HAR-Material Bursa",createdAt:1751000000000},
  {id:"KAT-2010124",name:"CB;K;20kV;1250A;25kA;SPRING;3P;VACUM",katalog:"2010124",satuan:"U",jenisBarang:"Pre Memory",merk:"",type:"",keterangan:"HAR-Switchgear&Jaringan",createdAt:1751000000000},
  {id:"KAT-2010312",name:"CB;K;20kV;2000A;40KA;SPRING;3P;VACUUM",katalog:"2010312",satuan:"U",jenisBarang:"Pre Memory",merk:"",type:"",keterangan:"HAR-Switchgear&Jaringan",createdAt:1751000000000},
  {id:"KAT-2020033",name:"CB ACC;OIL FILTER FOR GIS",katalog:"2020033",satuan:"BH",jenisBarang:"Pre Memory",merk:"",type:"",keterangan:"HAR-Switchgear&Jaringan",createdAt:1751000000000},
  {id:"KAT-2020136",name:"CB ACC;CLOSING TRIP COIL 110VDC",katalog:"2020136",satuan:"BH",jenisBarang:"Pre Memory",merk:"",type:"",keterangan:"HAR-Switchgear&Jaringan",createdAt:1751000000000},
  {id:"KAT-2020146",name:"CB ACC;SET OF GASKET FOR ONE POLE",katalog:"2020146",satuan:"BH",jenisBarang:"Pre Memory",merk:"",type:"",keterangan:"HAR-Switchgear&Jaringan",createdAt:1751000000000},
  {id:"KAT-2040074",name:"DS ACC;INTERLOCKING COIL",katalog:"2040074",satuan:"BH",jenisBarang:"Pre Memory",merk:"",type:"",keterangan:"HAR-Switchgear&Jaringan",createdAt:1751000000000},
  {id:"KAT-2070735",name:"PT;150KV;K;CAP;150/V3-100/V3;3P;400VA",katalog:"2070735",satuan:"U",jenisBarang:"Pre Memory",merk:"",type:"",keterangan:"HAR-Switchgear&Jaringan",createdAt:1751000000000},
  {id:"KAT-2080002",name:"PT ACC;STEEL SUPPORT 150 KV",katalog:"2080002",satuan:"BH",jenisBarang:"Pre Memory",merk:"",type:"",keterangan:"HAR-Switchgear&Jaringan",createdAt:1751000000000},
  {id:"KAT-2150393",name:"CUB;ISO;INTERFACE;20kV;1250A;25kA;SF6",katalog:"2150393",satuan:"SET",jenisBarang:"Pre Memory",merk:"",type:"",keterangan:"HAR-Switchgear&Jaringan",createdAt:1751000000000},
  {id:"KAT-2180035",name:"RELAY ACC;SOCKET RELAY CONTROL SIGNAL",katalog:"2180035",satuan:"BH",jenisBarang:"Pre Memory",merk:"",type:"",keterangan:"HAR-Switchgear&Jaringan",createdAt:1751000000000},
  {id:"KAT-2230011",name:"CLAMP;L PLAT TO W;AL;550mm2;BOLT",katalog:"2230011",satuan:"BH",jenisBarang:"Persediaan Bursa",merk:"",type:"",keterangan:"HAR-Material Bursa",createdAt:1751000000000},
  {id:"KAT-2230055",name:"CLAMP;T SLEEVE;AL;400-400mm2;PRESS",katalog:"2230055",satuan:"BH",jenisBarang:"Persediaan Bursa",merk:"",type:"",keterangan:"HAR-Material Bursa",createdAt:1751000000000},
  {id:"KAT-2230058",name:"CLAMP;T STUD TO W;AL;510-400mm2;BOLT",katalog:"2230058",satuan:"BH",jenisBarang:"Persediaan Bursa",merk:"",type:"",keterangan:"HAR-Material Bursa",createdAt:1751000000000},
  {id:"KAT-2230071",name:"CLAMP;L STUD TO 2 WIRE;AL;A3C400mm2;PRS;",katalog:"2230071",satuan:"BH",jenisBarang:"Persediaan Bursa",merk:"",type:"",keterangan:"HAR-Material Bursa",createdAt:1751000000000},
  {id:"KAT-2240004",name:"FUSE;20/24kV;25A;TUBE;D24mm",katalog:"2240004",satuan:"BH",jenisBarang:"Pre Memory",merk:"",type:"",keterangan:"HAR-Switchgear&Jaringan",createdAt:1751000000000},
  {id:"KAT-2240212",name:"FUSE;220V;5A;TUBE;",katalog:"2240212",satuan:"BH",jenisBarang:"Pre Memory",merk:"",type:"",keterangan:"HAR-Switchgear&Jaringan",createdAt:1751000000000},
  {id:"KAT-3050067",name:"CONDUCTOR;GSW;70mm2;",katalog:"3050067",satuan:"M",jenisBarang:"Pre Memory",merk:"",type:"",keterangan:"HAR-Switchgear&Jaringan",createdAt:1751000000000},
  {id:"KAT-3050160",name:"CONDUCTOR;ZEBRA;400MM2;133.45KN",katalog:"3050160",satuan:"M",jenisBarang:"Pre Memory",merk:"",type:"",keterangan:"HAR-Switchgear&Jaringan",createdAt:1751000000000},
  {id:"KAT-3050356",name:"CONDUCTOR;ACCC;418.5MM2;110.6KN",katalog:"3050356",satuan:"M",jenisBarang:"Persediaan",merk:"",type:"",keterangan:"HAR-Switchgear&Jaringan",createdAt:1751000000000},
  {id:"KAT-3050445",name:"CONDUCTOR;TAL;240MM2;",katalog:"3050445",satuan:"M",jenisBarang:"Pre Memory",merk:"",type:"",keterangan:"HAR-Switchgear&Jaringan",createdAt:1751000000000},
  {id:"KAT-3060004",name:"COND ACC;ARMOUR ROD AL 484.5mm2",katalog:"3060004",satuan:"SET",jenisBarang:"Persediaan Bursa",merk:"",type:"",keterangan:"HAR-Material Bursa",createdAt:1751000000000},
  {id:"KAT-3060005",name:"COND ACC;ARMOUR ROD AL 490.60mm2",katalog:"3060005",satuan:"SET",jenisBarang:"Persediaan Bursa",merk:"",type:"",keterangan:"HAR-Material Bursa",createdAt:1751000000000},
  {id:"KAT-3060028",name:"COND ACC;JOINT SLEEVE ST 56.30mm2 COMP",katalog:"3060028",satuan:"BH",jenisBarang:"Persediaan Bursa",merk:"",type:"",keterangan:"HAR-Material Bursa",createdAt:1751000000000},
  {id:"KAT-3060036",name:"COND ACC;SPACER AL 800mm2 300mm",katalog:"3060036",satuan:"BH",jenisBarang:"Persediaan Bursa",merk:"",type:"",keterangan:"HAR-Material Bursa",createdAt:1751000000000},
  {id:"KAT-3060066",name:"COND ACC;DEAD END CLAMP AL 410 mm2",katalog:"3060066",satuan:"BH",jenisBarang:"Persediaan",merk:"",type:"",keterangan:"HAR-Switchgear&Jaringan",createdAt:1751000000000},
  {id:"KAT-3060087",name:"COND ACC;REPAIR SLEEVE AL 187.5MM2",katalog:"3060087",satuan:"BH",jenisBarang:"Pre Memory",merk:"",type:"",keterangan:"HAR-Switchgear&Jaringan",createdAt:1751000000000},
  {id:"KAT-3060101",name:"COND ACC;REPAIR SLEEVE AL 240mm2",katalog:"3060101",satuan:"BH",jenisBarang:"Pre Memory",merk:"",type:"",keterangan:"HAR-Switchgear&Jaringan",createdAt:1751000000000},
  {id:"KAT-3060103",name:"COND ACC;JOINT AL 240mm2 COMP",katalog:"3060103",satuan:"BH",jenisBarang:"Pre Memory",merk:"",type:"",keterangan:"HAR-Switchgear&Jaringan",createdAt:1751000000000},
  {id:"KAT-3060113",name:"COND ACC;ARMOUR ROD AL 240mm2",katalog:"3060113",satuan:"BH",jenisBarang:"Pre Memory",merk:"",type:"",keterangan:"HAR-Switchgear&Jaringan",createdAt:1751000000000},
  {id:"KAT-3060308",name:"COND ACC;ARMOUR ROD AL 55mm2",katalog:"3060308",satuan:"BH",jenisBarang:"Pre Memory",merk:"",type:"",keterangan:"HAR-Switchgear&Jaringan",createdAt:1751000000000},
  {id:"KAT-3060310",name:"COND ACC;DAMPER 55mm2",katalog:"3060310",satuan:"BH",jenisBarang:"Pre Memory",merk:"",type:"",keterangan:"HAR-Switchgear&Jaringan",createdAt:1751000000000},
  {id:"KAT-3060313",name:"COND ACC;DEAD END CLAMP AL 800 mm2",katalog:"3060313",satuan:"BH",jenisBarang:"Pre Memory",merk:"",type:"",keterangan:"HAR-Switchgear&Jaringan",createdAt:1751000000000},
  {id:"KAT-3060339",name:"COND ACC;JOINT SLEEVE AL 55mm2",katalog:"3060339",satuan:"BH",jenisBarang:"Persediaan Bursa",merk:"",type:"",keterangan:"HAR-Material Bursa",createdAt:1751000000000},
  {id:"KAT-3060363",name:"COND ACC;SPACER ACSR 340mm2",katalog:"3060363",satuan:"BH",jenisBarang:"Pre Memory",merk:"",type:"",keterangan:"HAR-Switchgear&Jaringan",createdAt:1751000000000},
  {id:"KAT-3060392",name:"COND ACC;EARTH WIRE TENSION GSW 55MM2",katalog:"3060392",satuan:"BH",jenisBarang:"Pre Memory",merk:"",type:"",keterangan:"HAR-Switchgear&Jaringan",createdAt:1751000000000},
  {id:"KAT-3060505",name:"COND ACC;STRAIGHT JOINT 3X240mm2",katalog:"3060505",satuan:"SET",jenisBarang:"Pre Memory",merk:"",type:"",keterangan:"HAR-Switchgear&Jaringan",createdAt:1751000000000},
  {id:"KAT-3060614",name:"COND ACC;I CLAMP AL 430 MM2",katalog:"3060614",satuan:"BH",jenisBarang:"Pre Memory",merk:"",type:"",keterangan:"HAR-Switchgear&Jaringan",createdAt:1751000000000},
  {id:"KAT-3060716",name:"COND ACC;DAMPER 400MM2",katalog:"3060716",satuan:"BH",jenisBarang:"Pre Memory",merk:"",type:"",keterangan:"HAR-Switchgear&Jaringan",createdAt:1751000000000},
  {id:"KAT-3060719",name:"COND ACC;ARMOUR ROD AL 330MM2",katalog:"3060719",satuan:"BH",jenisBarang:"Pre Memory",merk:"",type:"",keterangan:"HAR-Switchgear&Jaringan",createdAt:1751000000000},
  {id:"KAT-3060897",name:"COND ACC;DEAD END CLAMP 240MM2",katalog:"3060897",satuan:"BH",jenisBarang:"Pre Memory",merk:"",type:"",keterangan:"HAR-Switchgear&Jaringan",createdAt:1751000000000},
  {id:"KAT-3060902",name:"COND ACC;DEAD END AL 598.94MM2",katalog:"3060902",satuan:"BH",jenisBarang:"Pre Memory",merk:"",type:"",keterangan:"HAR-Switchgear&Jaringan",createdAt:1751000000000},
  {id:"KAT-3061004",name:"COND ACC;ARMOUR ROD AL 160MM2",katalog:"3061004",satuan:"BH",jenisBarang:"Pre Memory",merk:"",type:"",keterangan:"HAR-Switchgear&Jaringan",createdAt:1751000000000},
  {id:"KAT-3061092",name:"COND ACC;JOINT AL 330mm2 COMP",katalog:"3061092",satuan:"BH",jenisBarang:"Pre Memory",merk:"",type:"",keterangan:"HAR-Switchgear&Jaringan",createdAt:1751000000000},
  {id:"KAT-3061097",name:"COND ACC;JOINT AL 55mm2 COMP",katalog:"3061097",satuan:"BH",jenisBarang:"Pre Memory",merk:"",type:"",keterangan:"HAR-Switchgear&Jaringan",createdAt:1751000000000},
  {id:"KAT-3061101",name:"COND ACC;JOINT GSW 55mm2 COMP",katalog:"3061101",satuan:"BH",jenisBarang:"Pre Memory",merk:"",type:"",keterangan:"HAR-Switchgear&Jaringan",createdAt:1751000000000},
  {id:"KAT-3061118",name:"COND ACC;JOINT ST 55mm2",katalog:"3061118",satuan:"BH",jenisBarang:"Pre Memory",merk:"",type:"",keterangan:"HAR-Switchgear&Jaringan",createdAt:1751000000000},
  {id:"KAT-3061159",name:"COND ACC;SPACER ACSR 330mm2",katalog:"3061159",satuan:"BH",jenisBarang:"Pre Memory",merk:"",type:"",keterangan:"HAR-Switchgear&Jaringan",createdAt:1751000000000},
  {id:"KAT-3061166",name:"COND ACC;SPACER ACSR 429mm2 400mm",katalog:"3061166",satuan:"BH",jenisBarang:"Persediaan",merk:"",type:"",keterangan:"HAR-Switchgear&Jaringan",createdAt:1751000000000},
  {id:"KAT-3061196",name:"COND ACC;SUSPENSION CLAMP 338mm2",katalog:"3061196",satuan:"BH",jenisBarang:"Pre Memory",merk:"",type:"",keterangan:"HAR-Switchgear&Jaringan",createdAt:1751000000000},
  {id:"KAT-3061223",name:"COND ACC;TENSION CLAMP 150mm2",katalog:"3061223",satuan:"BH",jenisBarang:"Pre Memory",merk:"",type:"",keterangan:"HAR-Switchgear&Jaringan",createdAt:1751000000000},
  {id:"KAT-3061242",name:"COND ACC;TERMINAL CLAMP ST 38mm2",katalog:"3061242",satuan:"BH",jenisBarang:"Pre Memory",merk:"",type:"",keterangan:"HAR-Switchgear&Jaringan",createdAt:1751000000000},
  {id:"KAT-3061356",name:"COND ACC;COMP MIDSPAN JOINT AL 328.5MM2",katalog:"3061356",satuan:"BH",jenisBarang:"Persediaan",merk:"",type:"",keterangan:"HAR-Switchgear&Jaringan",createdAt:1751000000000},
  {id:"KAT-3061378",name:"COND ACC;COMP MIDSPAN JOINT AL 418.5MM2",katalog:"3061378",satuan:"BH",jenisBarang:"Persediaan",merk:"",type:"",keterangan:"HAR-Switchgear&Jaringan",createdAt:1751000000000},
  {id:"KAT-3061416",name:"COND ACC;TENSION CLAMP ACSR 240MM2",katalog:"3061416",satuan:"BH",jenisBarang:"Pre Memory",merk:"",type:"",keterangan:"HAR-Switchgear&Jaringan",createdAt:1751000000000},
  {id:"KAT-3061441",name:"COND ACC;I CLAMP AL600/800MM2 TO PLATE",katalog:"3061441",satuan:"U",jenisBarang:"Pre Memory",merk:"",type:"",keterangan:"HAR-Switchgear&Jaringan",createdAt:1751000000000},
  {id:"KAT-3061458",name:"COND ACC;I CLAMP AL400-400MM2",katalog:"3061458",satuan:"U",jenisBarang:"Pre Memory",merk:"",type:"",keterangan:"HAR-Switchgear&Jaringan",createdAt:1751000000000},
  {id:"KAT-3061459",name:"COND ACC;I CLAMP AL500-500MM2",katalog:"3061459",satuan:"U",jenisBarang:"Pre Memory",merk:"",type:"",keterangan:"HAR-Switchgear&Jaringan",createdAt:1751000000000},
  {id:"KAT-3061461",name:"COND ACC;T CLAMP AL400/500-600/800MM2",katalog:"3061461",satuan:"U",jenisBarang:"Pre Memory",merk:"",type:"",keterangan:"HAR-Switchgear&Jaringan",createdAt:1751000000000},
  {id:"KAT-3061465",name:"COND ACC;COMP TENSION CLAMP AL 587.3MM2",katalog:"3061465",satuan:"BH",jenisBarang:"Pre Memory",merk:"",type:"",keterangan:"HAR-Switchgear&Jaringan",createdAt:1751000000000},
  {id:"KAT-3061472",name:"COND ACC;JOINT BOX OPGW 70MM2",katalog:"3061472",satuan:"BH",jenisBarang:"Pre Memory",merk:"",type:"",keterangan:"HAR-Switchgear&Jaringan",createdAt:1751000000000},
  {id:"KAT-3061484",name:"COND ACC;REPAIR SLEEVE AL 176.9MM2",katalog:"3061484",satuan:"BH",jenisBarang:"Pre Memory",merk:"",type:"",keterangan:"HAR-Switchgear&Jaringan",createdAt:1751000000000},
  {id:"KAT-3061509",name:"COND ACC;T CLAMP 1000MM TO 630MM",katalog:"3061509",satuan:"BH",jenisBarang:"Pre Memory",merk:"",type:"",keterangan:"HAR-Switchgear&Jaringan",createdAt:1751000000000},
  {id:"KAT-3061547",name:"COND ACC;I CLAMP 400MM2-1000MM2",katalog:"3061547",satuan:"BH",jenisBarang:"Pre Memory",merk:"",type:"",keterangan:"HAR-Switchgear&Jaringan",createdAt:1751000000000},
  {id:"KAT-3061588",name:"COND ACC;ARMOUR RODS AL",katalog:"3061588",satuan:"SET",jenisBarang:"Pre Memory",merk:"",type:"",keterangan:"HAR-Switchgear&Jaringan",createdAt:1751000000000},
  {id:"KAT-3061602",name:"COND ACC;T CLAMP TAL 850-510 MM2",katalog:"3061602",satuan:"BH",jenisBarang:"Pre Memory",merk:"",type:"",keterangan:"HAR-Switchgear&Jaringan",createdAt:1751000000000},
  {id:"KAT-3061611",name:"COND ACC;DOUBLE T CLAMP 400/600MM2",katalog:"3061611",satuan:"BH",jenisBarang:"Pre Memory",merk:"",type:"",keterangan:"HAR-Switchgear&Jaringan",createdAt:1751000000000},
  {id:"KAT-3061614",name:"COND ACC;SUSPENSION CLAMP 160MM2",katalog:"3061614",satuan:"BH",jenisBarang:"Pre Memory",merk:"",type:"",keterangan:"HAR-Switchgear&Jaringan",createdAt:1751000000000},
  {id:"KAT-3061615",name:"COND ACC;SUSPENSION CLAMP 240MM2",katalog:"3061615",satuan:"BH",jenisBarang:"Pre Memory",merk:"",type:"",keterangan:"HAR-Switchgear&Jaringan",createdAt:1751000000000},
  {id:"KAT-3061616",name:"COND ACC;SUSPENSION CLAMP 660MM2",katalog:"3061616",satuan:"BH",jenisBarang:"Pre Memory",merk:"",type:"",keterangan:"HAR-Switchgear&Jaringan",createdAt:1751000000000},
  {id:"KAT-3061617",name:"COND ACC;SUSPENSION CLAMP 800MM2",katalog:"3061617",satuan:"BH",jenisBarang:"Pre Memory",merk:"",type:"",keterangan:"HAR-Switchgear&Jaringan",createdAt:1751000000000},
  {id:"KAT-3061619",name:"COND ACC;T CLAMP AL 330MM2",katalog:"3061619",satuan:"BH",jenisBarang:"Pre Memory",merk:"",type:"",keterangan:"HAR-Switchgear&Jaringan",createdAt:1751000000000},
  {id:"KAT-3061621",name:"COND ACC;T-BRANCH SLEEVE AL 400MM2",katalog:"3061621",satuan:"BH",jenisBarang:"Pre Memory",merk:"",type:"",keterangan:"HAR-Switchgear&Jaringan",createdAt:1751000000000},
  {id:"KAT-3061626",name:"COND ACC;TERMINAL CLAMP 800-400MM",katalog:"3061626",satuan:"BH",jenisBarang:"Pre Memory",merk:"",type:"",keterangan:"HAR-Switchgear&Jaringan",createdAt:1751000000000},
  {id:"KAT-3070088",name:"ISOLATOR;NORMAL;PORC;150kV;DISC;120kN",katalog:"3070088",satuan:"BH",jenisBarang:"Persediaan",merk:"",type:"",keterangan:"HAR-Switchgear&Jaringan",createdAt:1751000000000},
  {id:"KAT-3070211",name:"ISOLATOR;ROD;SILICONE;70KV;POST;70KN",katalog:"3070211",satuan:"SET",jenisBarang:"Persediaan",merk:"",type:"",keterangan:"HAR-Switchgear&Jaringan",createdAt:1751000000000},
  {id:"KAT-3070213",name:"ISOLATOR;AFOG;POLYMER;150KV;POST;120KN",katalog:"3070213",satuan:"U",jenisBarang:"Persediaan",merk:"",type:"",keterangan:"HAR-Switchgear&Jaringan",createdAt:1751000000000},
  {id:"KAT-3100003",name:"STRINGSET ACC;BALL EYE",katalog:"3100003",satuan:"BH",jenisBarang:"Pre Memory",merk:"",type:"",keterangan:"HAR-Switchgear&Jaringan",createdAt:1751000000000},
  {id:"KAT-3100026",name:"STRINGSET ACC;SOCKET CLEVIS",katalog:"3100026",satuan:"BH",jenisBarang:"Pre Memory",merk:"",type:"",keterangan:"HAR-Switchgear&Jaringan",createdAt:1751000000000},
  {id:"KAT-3100078",name:"STRINGSET ACC;T CLAMP AL 300mm2 BOLT",katalog:"3100078",satuan:"BH",jenisBarang:"Pre Memory",merk:"",type:"",keterangan:"HAR-Switchgear&Jaringan",createdAt:1751000000000},
  {id:"KAT-3100102",name:"STRINGSET ACC;SINGLE ARCHING HORN",katalog:"3100102",satuan:"BH",jenisBarang:"Pre Memory",merk:"",type:"",keterangan:"HAR-Switchgear&Jaringan",createdAt:1751000000000},
  {id:"KAT-3100126",name:"STRINGSET ACC;RECTANGULAR YOKE",katalog:"3100126",satuan:"BH",jenisBarang:"Pre Memory",merk:"",type:"",keterangan:"HAR-Switchgear&Jaringan",createdAt:1751000000000},
  {id:"KAT-3100155",name:"STRINGSET ACC;I CLAMP AL 330MM2",katalog:"3100155",satuan:"BH",jenisBarang:"Pre Memory",merk:"",type:"",keterangan:"HAR-Switchgear&Jaringan",createdAt:1751000000000},
  {id:"KAT-3100156",name:"STRINGSET ACC;T CLAMP AL 330MM2",katalog:"3100156",satuan:"BH",jenisBarang:"Pre Memory",merk:"",type:"",keterangan:"HAR-Switchgear&Jaringan",createdAt:1751000000000},
  {id:"KAT-3100157",name:"STRINGSET ACC;SOCKET CLEVIS 160KN",katalog:"3100157",satuan:"BH",jenisBarang:"Pre Memory",merk:"",type:"",keterangan:"HAR-Switchgear&Jaringan",createdAt:1751000000000},
  {id:"KAT-3110074",name:"CABLE PWR;XLPE AL;1X800mm2;20kV;UG",katalog:"3110074",satuan:"M",jenisBarang:"Pre Memory",merk:"",type:"",keterangan:"HAR-Switchgear&Jaringan",createdAt:1751000000000},
  {id:"KAT-3110436",name:"CABLE PWR;XLPE CU;1X800MM2;150KV;UG",katalog:"3110436",satuan:"M",jenisBarang:"Pre Memory",merk:"",type:"",keterangan:"HAR-Switchgear&Jaringan",createdAt:1751000000000},
  {id:"KAT-3120356",name:"CABLE PWR ACC;CABLE SUPPORT",katalog:"3120356",satuan:"BH",jenisBarang:"Pre Memory",merk:"",type:"",keterangan:"HAR-Switchgear&Jaringan",createdAt:1751000000000},
  {id:"KAT-3120420",name:"CABLE PWR ACC;CABLE SHOE AL 4mm2",katalog:"3120420",satuan:"BH",jenisBarang:"Pre Memory",merk:"",type:"",keterangan:"HAR-Switchgear&Jaringan",createdAt:1751000000000},
  {id:"KAT-3120422",name:"CABLE PWR ACC;CABLE SHOE AL ID 1H 500mm2",katalog:"3120422",satuan:"BH",jenisBarang:"Pre Memory",merk:"",type:"",keterangan:"HAR-Switchgear&Jaringan",createdAt:1751000000000},
  {id:"KAT-3120550",name:"CABLE PWR ACC;SEALING END OIL CU 800MM2",katalog:"3120550",satuan:"M",jenisBarang:"Pre Memory",merk:"",type:"",keterangan:"HAR-Switchgear&Jaringan",createdAt:1751000000000},
  {id:"KAT-3120560",name:"CABLE PWR ACC;SEAL END 150KV 1000MM2",katalog:"3120560",satuan:"BH",jenisBarang:"Pre Memory",merk:"",type:"",keterangan:"HAR-Switchgear&Jaringan",createdAt:1751000000000},
  {id:"KAT-3120590",name:"CABLE PWR ACC;STRAIGHT JOINT AL1X800mm2",katalog:"3120590",satuan:"SET",jenisBarang:"Pre Memory",merk:"",type:"",keterangan:"HAR-Switchgear&Jaringan",createdAt:1751000000000},
  {id:"KAT-3120628",name:"CABLE PWR ACC;SEALING END 150kV 240-2000",katalog:"3120628",satuan:"BH",jenisBarang:"Pre Memory",merk:"",type:"",keterangan:"HAR-Switchgear&Jaringan",createdAt:1751000000000},
  {id:"KAT-3120654",name:"CABLE PWR ACC;LINK BOX FOR CROSS BONDING",katalog:"3120654",satuan:"BH",jenisBarang:"Persediaan",merk:"",type:"",keterangan:"HAR-Switchgear&Jaringan",createdAt:1751000000000},
  {id:"KAT-3130056",name:"JOINT;20kV;AL-AL;800mm2;X-X;1P;PR",katalog:"3130056",satuan:"SET",jenisBarang:"Persediaan Bursa",merk:"",type:"",keterangan:"HAR-Material Bursa",createdAt:1751000000000},
  {id:"KAT-3130193",name:"JOINT;150KV;CU-CU;1200MM2;;1P;PR",katalog:"3130193",satuan:"BH",jenisBarang:"Persediaan",merk:"",type:"",keterangan:"HAR-Switchgear&Jaringan",createdAt:1751000000000},
  {id:"KAT-3150115",name:"TERM;150kV;;CU;1P;1X800MM2;ISO;ID",katalog:"3150115",satuan:"BH",jenisBarang:"Persediaan Bursa",merk:"",type:"",keterangan:"HAR-Material Bursa",createdAt:1751000000000},
  {id:"KAT-3160005",name:"TERM ACC;ELASTIMOLD",katalog:"3160005",satuan:"SET",jenisBarang:"Persediaan Bursa",merk:"",type:"",keterangan:"HAR-Material Bursa",createdAt:1751000000000},
  {id:"KAT-3160043",name:"TERM ACC;TERMINATION 20kV 95mm2 OD",katalog:"3160043",satuan:"BH",jenisBarang:"Pre Memory",merk:"",type:"",keterangan:"HAR-Switchgear&Jaringan",createdAt:1751000000000},
  {id:"KAT-3160062",name:"TERM ACC;TERMINATION 20 KV 400MM2 OD",katalog:"3160062",satuan:"SET",jenisBarang:"Pre Memory",merk:"",type:"",keterangan:"HAR-Switchgear&Jaringan",createdAt:1751000000000},
  {id:"KAT-3160090",name:"TERM ACC;TERMINATION 1 CORE 150-300MM2OD",katalog:"3160090",satuan:"SET",jenisBarang:"Pre Memory",merk:"",type:"",keterangan:"HAR-Switchgear&Jaringan",createdAt:1751000000000},
  {id:"KAT-3260187",name:"COND ACC;COUNTER WEIGHT",katalog:"3260187",satuan:"BH",jenisBarang:"Pre Memory",merk:"",type:"",keterangan:"HAR-Switchgear&Jaringan",createdAt:1751000000000},
  {id:"KAT-3260197",name:"COND ACC;DEAD END CLAMP AL 310mm2",katalog:"3260197",satuan:"BH",jenisBarang:"Persediaan",merk:"",type:"",keterangan:"HAR-Kabel",createdAt:1751000000000},
  {id:"KAT-3260198",name:"COND ACC;DEAD END CLAMP AL 330mm2",katalog:"3260198",satuan:"BH",jenisBarang:"Pre Memory",merk:"",type:"",keterangan:"HAR-Switchgear&Jaringan",createdAt:1751000000000},
  {id:"KAT-3260216",name:"COND ACC;JUMPER CLAMP GSW 55mm2",katalog:"3260216",satuan:"BH",jenisBarang:"Pre Memory",merk:"",type:"",keterangan:"HAR-Switchgear&Jaringan",createdAt:1751000000000},
  {id:"KAT-3280054",name:"CONN;;T STUD TO W;AL;510-400mm2;BOLT",katalog:"3280054",satuan:"BH",jenisBarang:"Persediaan Bursa",merk:"",type:"",keterangan:"HAR-Material Bursa",createdAt:1751000000000},
  {id:"KAT-4120026",name:"BOX;TRF;ST PLATE;",katalog:"4120026",satuan:"BH",jenisBarang:"Persediaan Bursa",merk:"",type:"",keterangan:"HAR-Material Bursa",createdAt:1751000000000},
  {id:"KAT-4140009",name:"PANEL;SPINDEL;ST;;",katalog:"4140009",satuan:"U",jenisBarang:"Pre Memory",merk:"",type:"",keterangan:"HAR-Persediaan Umum",createdAt:1751000000000},
  {id:"KAT-4140037",name:"PANEL;CTL150kVTRF;ST;2250X800X800MM",katalog:"4140037",satuan:"SET",jenisBarang:"Persediaan Bursa",merk:"",type:"",keterangan:"HAR-Material Bursa",createdAt:1751000000000},
  {id:"KAT-4140059",name:"PANEL;CTL AC/DC;ST;220X90X80cm",katalog:"4140059",satuan:"U",jenisBarang:"Pre Memory",merk:"",type:"",keterangan:"HAR-Persediaan Umum",createdAt:1751000000000},
  {id:"KAT-4140203",name:"PANEL;PRO150KV;ST;243X80X150CM",katalog:"4140203",satuan:"U",jenisBarang:"Pre Memory",merk:"",type:"",keterangan:"HAR-Switchgear&Jaringan",createdAt:1751000000000},
  {id:"KAT-4140348",name:"PANEL;SCADA;ST;240X95X85CM",katalog:"4140348",satuan:"U",jenisBarang:"Pre Memory",merk:"",type:"",keterangan:"HAR-Persediaan Umum",createdAt:1751000000000},
  {id:"KAT-4140690",name:"PANEL;SAS;ST 2.5mm;2200X800X800mm;IP54",katalog:"4140690",satuan:"U",jenisBarang:"Pre Memory",merk:"",type:"",keterangan:"HAR-Persediaan Umum",createdAt:1751000000000},
  {id:"KAT-4140699",name:"PANEL;CTL+PRO INTRFC;IRON;800X600X200CM;",katalog:"4140699",satuan:"BH",jenisBarang:"Pre Memory",merk:"",type:"",keterangan:"HAR-Switchgear&Jaringan",createdAt:1751000000000},
  {id:"KAT-4160002",name:"CABLE CTRL;COAXIAL ARMOUR 75OHM;;;",katalog:"4160002",satuan:"M",jenisBarang:"Persediaan Bursa",merk:"",type:"",keterangan:"HAR-Material Bursa",createdAt:1751000000000},
  {id:"KAT-4160003",name:"CABLE CTRL;COAXIAL RG8 50OHM;;;",katalog:"4160003",satuan:"M",jenisBarang:"Pre Memory",merk:"",type:"",keterangan:"HAR-Kabel",createdAt:1751000000000},
  {id:"KAT-4160174",name:"CABLE CTRL;FO AERIAL 12 CORE;12.5MM;;OH",katalog:"4160174",satuan:"M",jenisBarang:"Pre Memory",merk:"",type:"",keterangan:"HAR-Kabel",createdAt:1751000000000},
  {id:"KAT-4170157",name:"CABLE CTRL ACC;CABLE SCHOEN AL-CU 630MM",katalog:"4170157",satuan:"BH",jenisBarang:"Pre Memory",merk:"",type:"",keterangan:"HAR-Kabel",createdAt:1751000000000},
  {id:"KAT-4180024",name:"INSUL MEDIA;OIL;SILICON",katalog:"4180024",satuan:"L",jenisBarang:"Pre Memory",merk:"",type:"",keterangan:"HAR-Persediaan Umum",createdAt:1751000000000},
  {id:"KAT-4190331",name:"UNIV ACC;ORING GIL 150KV",katalog:"4190331",satuan:"SET",jenisBarang:"Pre Memory",merk:"",type:"",keterangan:"HAR-Persediaan Umum",createdAt:1751000000000},
  {id:"KAT-4190448",name:"UNIV ACC;CLAMP CABLE NO.12",katalog:"4190448",satuan:"BH",jenisBarang:"Pre Memory",merk:"",type:"",keterangan:"HAR-Persediaan Umum",createdAt:1751000000000},
  {id:"KAT-4191106",name:"UNIV ACC;KACA OIL LEVEL",katalog:"4191106",satuan:"BH",jenisBarang:"Pre Memory",merk:"",type:"",keterangan:"HAR-Persediaan Umum",createdAt:1751000000000},
  {id:"KAT-4191468",name:"UNIV ACC;U BOLT",katalog:"4191468",satuan:"BH",jenisBarang:"Pre Memory",merk:"",type:"",keterangan:"HAR-Persediaan Umum",createdAt:1751000000000},
  {id:"KAT-4191591",name:"UNIV ACC;MOISTURE ABSORBENT",katalog:"4191591",satuan:"BH",jenisBarang:"Pre Memory",merk:"",type:"",keterangan:"HAR-Persediaan Umum",createdAt:1751000000000},
  {id:"KAT-5020387",name:"PLC ACC;KABEL TELEPON OUTDOOR",katalog:"5020387",satuan:"M",jenisBarang:"Pre Memory",merk:"",type:"",keterangan:"HAR-Tele Informasi Data",createdAt:1751000000000},
  {id:"KAT-7010351",name:"TOOL M;SHACKLE",katalog:"7010351",satuan:"BH",jenisBarang:"Pre Memory",merk:"",type:"",keterangan:"HAR-Persediaan Umum",createdAt:1751000000000},
  {id:"KAT-7020054",name:"TOOL E;MANOMETER",katalog:"7020054",satuan:"SET",jenisBarang:"Pre Memory",merk:"",type:"",keterangan:"HAR-Persediaan Umum",createdAt:1751000000000},
  {id:"KAT-7020880",name:"TOOL E;TEST RELAY 3 PHASA 3 CURRENT",katalog:"7020880",satuan:"U",jenisBarang:"Persediaan",merk:"",type:"",keterangan:"HAR-Switchgear&Jaringan",createdAt:1751000000000},
  {id:"KAT-31200240",name:"CABLE PWR ACC;LINK BOX GROUNDING SISTEM",katalog:"31200240",satuan:"BH",jenisBarang:"Persediaan",merk:"",type:"",keterangan:"HAR-Switchgear&Jaringan",createdAt:1751000000000},
  {id:"KAT-3260169",name:"COND ACC;REPAIR SLEEVE AL 330mm2",katalog:"3260169",satuan:"BH",jenisBarang:"Pre Memory",merk:"",type:"",keterangan:"HAR-Switchgear&Jaringan",createdAt:1751000000000}
];

// ─── MASTER LOKASI GUDANG (kode lokasi + kapasitas) ────────────────────
const DEFAULT_LOKASI = [
  { id:"LOK-001", kode:"Rak A-1", keterangan:"Area Transformator", kapasitas:50, createdAt:Date.now() },
  { id:"LOK-002", kode:"Rak B-2", keterangan:"Area Kabel & Konduktor", kapasitas:50, createdAt:Date.now() },
  { id:"LOK-003", kode:"Rak C-1", keterangan:"Area Panel & Proteksi", kapasitas:50, createdAt:Date.now() },
  { id:"LOK-004", kode:"Rak D-3", keterangan:"Area Meteran", kapasitas:50, createdAt:Date.now() },
  { id:"LOK-005", kode:"Rak E-1", keterangan:"Area Safety/APD", kapasitas:50, createdAt:Date.now() },
  { id:"LOK-006", kode:"Wonorejo", keterangan:"Lapangan / Lokasi Proyek", kapasitas:50, createdAt:Date.now() },
  { id:"LOK-007", kode:"Ketintang", keterangan:"Lapangan / Lokasi Proyek", kapasitas:50, createdAt:Date.now() },
];

// ─── DATA STOK dari SAP PEMAT (145 material Persediaan UPT Surabaya) ───
// Data real dari file PEMAT_04062026.csv — selalu tersedia saat aplikasi dibuka.
const DEFAULT_STOCKS = [
  {id:"STK-SAP-1060011",katalogId:"KAT-1060011",lokasiId:"",name:"TRF ACC;NGR 70kV 200 Ohm",katalog:"1060011",satuan:"U",unit:"U",qty:1.0,price:121000000,minQty:0,jenisBarang:"Persediaan",lokasi:"— Belum diisi —",img:null,createdAt:1751000000000},
  {id:"STK-SAP-1060018",katalogId:"KAT-1060018",lokasiId:"",name:"TRF ACC;SUDD PRESS",katalog:"1060018",satuan:"BH",unit:"BH",qty:2.0,price:0,minQty:0,jenisBarang:"Pre Memory",lokasi:"— Belum diisi —",img:null,createdAt:1751000000000},
  {id:"STK-SAP-1060029",katalogId:"KAT-1060029",lokasiId:"",name:"TRF ACC;BUCHOLZ 150kV",katalog:"1060029",satuan:"SET",unit:"SET",qty:2.0,price:0,minQty:0,jenisBarang:"Pre Memory",lokasi:"— Belum diisi —",img:null,createdAt:1751000000000},
  {id:"STK-SAP-1060031",katalogId:"KAT-1060031",lokasiId:"",name:"TRF ACC;BUSHING 150kV",katalog:"1060031",satuan:"BH",unit:"BH",qty:1.0,price:205899375,minQty:0,jenisBarang:"Persediaan Bursa",lokasi:"— Belum diisi —",img:null,createdAt:1751000000000},
  {id:"STK-SAP-1060035",katalogId:"KAT-1060035",lokasiId:"",name:"TRF ACC;BUSHING 20kV",katalog:"1060035",satuan:"BH",unit:"BH",qty:18.0,price:0,minQty:0,jenisBarang:"Pre Memory",lokasi:"— Belum diisi —",img:null,createdAt:1751000000000},
  {id:"STK-SAP-1060045",katalogId:"KAT-1060045",lokasiId:"",name:"TRF ACC;BUSHING 150kV HV",katalog:"1060045",satuan:"BH",unit:"BH",qty:4.0,price:0,minQty:0,jenisBarang:"Pre Memory",lokasi:"— Belum diisi —",img:null,createdAt:1751000000000},
  {id:"STK-SAP-1060058",katalogId:"KAT-1060058",lokasiId:"",name:"TRF ACC;OIL LEVEL INDIKATOR",katalog:"1060058",satuan:"BH",unit:"BH",qty:4.0,price:0,minQty:0,jenisBarang:"Pre Memory",lokasi:"— Belum diisi —",img:null,createdAt:1751000000000},
  {id:"STK-SAP-1060080",katalogId:"KAT-1060080",lokasiId:"",name:"TRF ACC;OLTC BREATHER SILICAGEL",katalog:"1060080",satuan:"U",unit:"U",qty:1.0,price:0,minQty:0,jenisBarang:"Pre Memory",lokasi:"— Belum diisi —",img:null,createdAt:1751000000000},
  {id:"STK-SAP-1060132",katalogId:"KAT-1060132",lokasiId:"",name:"TRF ACC;GATE VALVE",katalog:"1060132",satuan:"BH",unit:"BH",qty:6.0,price:0,minQty:0,jenisBarang:"Pre Memory",lokasi:"— Belum diisi —",img:null,createdAt:1751000000000},
  {id:"STK-SAP-1060149",katalogId:"KAT-1060149",lokasiId:"",name:"TRF ACC;OIL TEMPERATURE INDICATOR",katalog:"1060149",satuan:"BH",unit:"BH",qty:2.0,price:0,minQty:0,jenisBarang:"Pre Memory",lokasi:"— Belum diisi —",img:null,createdAt:1751000000000},
  {id:"STK-SAP-1060154",katalogId:"KAT-1060154",lokasiId:"",name:"TRF ACC;BUSHING NEUTRAL 150kV HV",katalog:"1060154",satuan:"BH",unit:"BH",qty:1.0,price:0,minQty:0,jenisBarang:"Pre Memory",lokasi:"— Belum diisi —",img:null,createdAt:1751000000000},
  {id:"STK-SAP-1060181",katalogId:"KAT-1060181",lokasiId:"",name:"TRF ACC;FAN",katalog:"1060181",satuan:"BH",unit:"BH",qty:2.0,price:0,minQty:0,jenisBarang:"Pre Memory",lokasi:"— Belum diisi —",img:null,createdAt:1751000000000},
  {id:"STK-SAP-1060544",katalogId:"KAT-1060544",lokasiId:"",name:"TRF ACC;CIRCULATING OIL PUMP",katalog:"1060544",satuan:"BH",unit:"BH",qty:2.0,price:0,minQty:0,jenisBarang:"Pre Memory",lokasi:"— Belum diisi —",img:null,createdAt:1751000000000},
  {id:"STK-SAP-1060562",katalogId:"KAT-1060562",lokasiId:"",name:"TRF ACC;BUSHING 70KV",katalog:"1060562",satuan:"BH",unit:"BH",qty:2.0,price:166579875,minQty:0,jenisBarang:"Persediaan Bursa",lokasi:"— Belum diisi —",img:null,createdAt:1751000000000},
  {id:"STK-SAP-2010124",katalogId:"KAT-2010124",lokasiId:"",name:"CB;K;20kV;1250A;25kA;SPRING;3P;VACUM",katalog:"2010124",satuan:"U",unit:"U",qty:2.0,price:0,minQty:0,jenisBarang:"Pre Memory",lokasi:"— Belum diisi —",img:null,createdAt:1751000000000},
  {id:"STK-SAP-2010312",katalogId:"KAT-2010312",lokasiId:"",name:"CB;K;20kV;2000A;40KA;SPRING;3P;VACUUM",katalog:"2010312",satuan:"U",unit:"U",qty:1.0,price:0,minQty:0,jenisBarang:"Pre Memory",lokasi:"— Belum diisi —",img:null,createdAt:1751000000000},
  {id:"STK-SAP-2020033",katalogId:"KAT-2020033",lokasiId:"",name:"CB ACC;OIL FILTER FOR GIS",katalog:"2020033",satuan:"BH",unit:"BH",qty:14.0,price:0,minQty:0,jenisBarang:"Pre Memory",lokasi:"— Belum diisi —",img:null,createdAt:1751000000000},
  {id:"STK-SAP-2020136",katalogId:"KAT-2020136",lokasiId:"",name:"CB ACC;CLOSING TRIP COIL 110VDC",katalog:"2020136",satuan:"BH",unit:"BH",qty:3.0,price:0,minQty:0,jenisBarang:"Pre Memory",lokasi:"— Belum diisi —",img:null,createdAt:1751000000000},
  {id:"STK-SAP-2020146",katalogId:"KAT-2020146",lokasiId:"",name:"CB ACC;SET OF GASKET FOR ONE POLE",katalog:"2020146",satuan:"BH",unit:"BH",qty:4.0,price:0,minQty:0,jenisBarang:"Pre Memory",lokasi:"— Belum diisi —",img:null,createdAt:1751000000000},
  {id:"STK-SAP-2040074",katalogId:"KAT-2040074",lokasiId:"",name:"DS ACC;INTERLOCKING COIL",katalog:"2040074",satuan:"BH",unit:"BH",qty:2.0,price:0,minQty:0,jenisBarang:"Pre Memory",lokasi:"— Belum diisi —",img:null,createdAt:1751000000000},
  {id:"STK-SAP-2070735",katalogId:"KAT-2070735",lokasiId:"",name:"PT;150KV;K;CAP;150/V3-100/V3;3P;400VA",katalog:"2070735",satuan:"U",unit:"U",qty:1.0,price:0,minQty:0,jenisBarang:"Pre Memory",lokasi:"— Belum diisi —",img:null,createdAt:1751000000000},
  {id:"STK-SAP-2080002",katalogId:"KAT-2080002",lokasiId:"",name:"PT ACC;STEEL SUPPORT 150 KV",katalog:"2080002",satuan:"BH",unit:"BH",qty:18.0,price:0,minQty:0,jenisBarang:"Pre Memory",lokasi:"— Belum diisi —",img:null,createdAt:1751000000000},
  {id:"STK-SAP-2150393",katalogId:"KAT-2150393",lokasiId:"",name:"CUB;ISO;INTERFACE;20kV;1250A;25kA;SF6",katalog:"2150393",satuan:"SET",unit:"SET",qty:1.0,price:0,minQty:0,jenisBarang:"Pre Memory",lokasi:"— Belum diisi —",img:null,createdAt:1751000000000},
  {id:"STK-SAP-2180035",katalogId:"KAT-2180035",lokasiId:"",name:"RELAY ACC;SOCKET RELAY CONTROL SIGNAL",katalog:"2180035",satuan:"BH",unit:"BH",qty:2.0,price:0,minQty:0,jenisBarang:"Pre Memory",lokasi:"— Belum diisi —",img:null,createdAt:1751000000000},
  {id:"STK-SAP-2230011",katalogId:"KAT-2230011",lokasiId:"",name:"CLAMP;L PLAT TO W;AL;550mm2;BOLT",katalog:"2230011",satuan:"BH",unit:"BH",qty:1.0,price:4186,minQty:0,jenisBarang:"Persediaan Bursa",lokasi:"— Belum diisi —",img:null,createdAt:1751000000000},
  {id:"STK-SAP-2230055",katalogId:"KAT-2230055",lokasiId:"",name:"CLAMP;T SLEEVE;AL;400-400mm2;PRESS",katalog:"2230055",satuan:"BH",unit:"BH",qty:3.0,price:1354442,minQty:0,jenisBarang:"Persediaan Bursa",lokasi:"— Belum diisi —",img:null,createdAt:1751000000000},
  {id:"STK-SAP-2230058",katalogId:"KAT-2230058",lokasiId:"",name:"CLAMP;T STUD TO W;AL;510-400mm2;BOLT",katalog:"2230058",satuan:"BH",unit:"BH",qty:26.0,price:129924,minQty:0,jenisBarang:"Persediaan Bursa",lokasi:"— Belum diisi —",img:null,createdAt:1751000000000},
  {id:"STK-SAP-2230071",katalogId:"KAT-2230071",lokasiId:"",name:"CLAMP;L STUD TO 2 WIRE;AL;A3C400mm2;PRS;",katalog:"2230071",satuan:"BH",unit:"BH",qty:18.0,price:11000,minQty:0,jenisBarang:"Persediaan Bursa",lokasi:"— Belum diisi —",img:null,createdAt:1751000000000},
  {id:"STK-SAP-2240004",katalogId:"KAT-2240004",lokasiId:"",name:"FUSE;20/24kV;25A;TUBE;D24mm",katalog:"2240004",satuan:"BH",unit:"BH",qty:2.0,price:0,minQty:0,jenisBarang:"Pre Memory",lokasi:"— Belum diisi —",img:null,createdAt:1751000000000},
  {id:"STK-SAP-2240212",katalogId:"KAT-2240212",lokasiId:"",name:"FUSE;220V;5A;TUBE;",katalog:"2240212",satuan:"BH",unit:"BH",qty:24.0,price:0,minQty:0,jenisBarang:"Pre Memory",lokasi:"— Belum diisi —",img:null,createdAt:1751000000000},
  {id:"STK-SAP-3050067",katalogId:"KAT-3050067",lokasiId:"",name:"CONDUCTOR;GSW;70mm2;",katalog:"3050067",satuan:"M",unit:"M",qty:1960.0,price:0,minQty:0,jenisBarang:"Pre Memory",lokasi:"— Belum diisi —",img:null,createdAt:1751000000000},
  {id:"STK-SAP-3050160",katalogId:"KAT-3050160",lokasiId:"",name:"CONDUCTOR;ZEBRA;400MM2;133.45KN",katalog:"3050160",satuan:"M",unit:"M",qty:2797.0,price:0,minQty:0,jenisBarang:"Pre Memory",lokasi:"— Belum diisi —",img:null,createdAt:1751000000000},
  {id:"STK-SAP-3050356",katalogId:"KAT-3050356",lokasiId:"",name:"CONDUCTOR;ACCC;418.5MM2;110.6KN",katalog:"3050356",satuan:"M",unit:"M",qty:39.0,price:310842,minQty:0,jenisBarang:"Persediaan",lokasi:"— Belum diisi —",img:null,createdAt:1751000000000},
  {id:"STK-SAP-3050445",katalogId:"KAT-3050445",lokasiId:"",name:"CONDUCTOR;TAL;240MM2;",katalog:"3050445",satuan:"M",unit:"M",qty:4200.0,price:0,minQty:0,jenisBarang:"Pre Memory",lokasi:"— Belum diisi —",img:null,createdAt:1751000000000},
  {id:"STK-SAP-3060004",katalogId:"KAT-3060004",lokasiId:"",name:"COND ACC;ARMOUR ROD AL 484.5mm2",katalog:"3060004",satuan:"SET",unit:"SET",qty:12.0,price:5450500,minQty:0,jenisBarang:"Persediaan Bursa",lokasi:"— Belum diisi —",img:null,createdAt:1751000000000},
  {id:"STK-SAP-3060005",katalogId:"KAT-3060005",lokasiId:"",name:"COND ACC;ARMOUR ROD AL 490.60mm2",katalog:"3060005",satuan:"SET",unit:"SET",qty:7.0,price:6528500,minQty:0,jenisBarang:"Persediaan Bursa",lokasi:"— Belum diisi —",img:null,createdAt:1751000000000},
  {id:"STK-SAP-3060028",katalogId:"KAT-3060028",lokasiId:"",name:"COND ACC;JOINT SLEEVE ST 56.30mm2 COMP",katalog:"3060028",satuan:"BH",unit:"BH",qty:3.0,price:14868,minQty:0,jenisBarang:"Persediaan Bursa",lokasi:"— Belum diisi —",img:null,createdAt:1751000000000},
  {id:"STK-SAP-3060036",katalogId:"KAT-3060036",lokasiId:"",name:"COND ACC;SPACER AL 800mm2 300mm",katalog:"3060036",satuan:"BH",unit:"BH",qty:12.0,price:342600,minQty:0,jenisBarang:"Persediaan Bursa",lokasi:"— Belum diisi —",img:null,createdAt:1751000000000},
  {id:"STK-SAP-3060066",katalogId:"KAT-3060066",lokasiId:"",name:"COND ACC;DEAD END CLAMP AL 410 mm2",katalog:"3060066",satuan:"BH",unit:"BH",qty:3.0,price:12650000,minQty:0,jenisBarang:"Persediaan",lokasi:"— Belum diisi —",img:null,createdAt:1751000000000},
  {id:"STK-SAP-3060087",katalogId:"KAT-3060087",lokasiId:"",name:"COND ACC;REPAIR SLEEVE AL 187.5MM2",katalog:"3060087",satuan:"BH",unit:"BH",qty:39.0,price:0,minQty:0,jenisBarang:"Pre Memory",lokasi:"— Belum diisi —",img:null,createdAt:1751000000000},
  {id:"STK-SAP-3060101",katalogId:"KAT-3060101",lokasiId:"",name:"COND ACC;REPAIR SLEEVE AL 240mm2",katalog:"3060101",satuan:"BH",unit:"BH",qty:1.0,price:0,minQty:0,jenisBarang:"Pre Memory",lokasi:"— Belum diisi —",img:null,createdAt:1751000000000},
  {id:"STK-SAP-3060103",katalogId:"KAT-3060103",lokasiId:"",name:"COND ACC;JOINT AL 240mm2 COMP",katalog:"3060103",satuan:"BH",unit:"BH",qty:17.0,price:0,minQty:0,jenisBarang:"Pre Memory",lokasi:"— Belum diisi —",img:null,createdAt:1751000000000},
  {id:"STK-SAP-3060113",katalogId:"KAT-3060113",lokasiId:"",name:"COND ACC;ARMOUR ROD AL 240mm2",katalog:"3060113",satuan:"BH",unit:"BH",qty:212.0,price:0,minQty:0,jenisBarang:"Pre Memory",lokasi:"— Belum diisi —",img:null,createdAt:1751000000000},
  {id:"STK-SAP-3060308",katalogId:"KAT-3060308",lokasiId:"",name:"COND ACC;ARMOUR ROD AL 55mm2",katalog:"3060308",satuan:"BH",unit:"BH",qty:18.0,price:0,minQty:0,jenisBarang:"Pre Memory",lokasi:"— Belum diisi —",img:null,createdAt:1751000000000},
  {id:"STK-SAP-3060310",katalogId:"KAT-3060310",lokasiId:"",name:"COND ACC;DAMPER 55mm2",katalog:"3060310",satuan:"BH",unit:"BH",qty:8.0,price:0,minQty:0,jenisBarang:"Pre Memory",lokasi:"— Belum diisi —",img:null,createdAt:1751000000000},
  {id:"STK-SAP-3060313",katalogId:"KAT-3060313",lokasiId:"",name:"COND ACC;DEAD END CLAMP AL 800 mm2",katalog:"3060313",satuan:"BH",unit:"BH",qty:6.0,price:0,minQty:0,jenisBarang:"Pre Memory",lokasi:"— Belum diisi —",img:null,createdAt:1751000000000},
  {id:"STK-SAP-3060339",katalogId:"KAT-3060339",lokasiId:"",name:"COND ACC;JOINT SLEEVE AL 55mm2",katalog:"3060339",satuan:"BH",unit:"BH",qty:50.0,price:67710,minQty:0,jenisBarang:"Persediaan Bursa",lokasi:"— Belum diisi —",img:null,createdAt:1751000000000},
  {id:"STK-SAP-3060363",katalogId:"KAT-3060363",lokasiId:"",name:"COND ACC;SPACER ACSR 340mm2",katalog:"3060363",satuan:"BH",unit:"BH",qty:1.0,price:0,minQty:0,jenisBarang:"Pre Memory",lokasi:"— Belum diisi —",img:null,createdAt:1751000000000},
  {id:"STK-SAP-3060392",katalogId:"KAT-3060392",lokasiId:"",name:"COND ACC;EARTH WIRE TENSION GSW 55MM2",katalog:"3060392",satuan:"BH",unit:"BH",qty:4.0,price:0,minQty:0,jenisBarang:"Pre Memory",lokasi:"— Belum diisi —",img:null,createdAt:1751000000000},
  {id:"STK-SAP-3060505",katalogId:"KAT-3060505",lokasiId:"",name:"COND ACC;STRAIGHT JOINT 3X240mm2",katalog:"3060505",satuan:"SET",unit:"SET",qty:2.0,price:0,minQty:0,jenisBarang:"Pre Memory",lokasi:"— Belum diisi —",img:null,createdAt:1751000000000},
  {id:"STK-SAP-3060614",katalogId:"KAT-3060614",lokasiId:"",name:"COND ACC;I CLAMP AL 430 MM2",katalog:"3060614",satuan:"BH",unit:"BH",qty:2.0,price:0,minQty:0,jenisBarang:"Pre Memory",lokasi:"— Belum diisi —",img:null,createdAt:1751000000000},
  {id:"STK-SAP-3060716",katalogId:"KAT-3060716",lokasiId:"",name:"COND ACC;DAMPER 400MM2",katalog:"3060716",satuan:"BH",unit:"BH",qty:23.0,price:0,minQty:0,jenisBarang:"Pre Memory",lokasi:"— Belum diisi —",img:null,createdAt:1751000000000},
  {id:"STK-SAP-3060719",katalogId:"KAT-3060719",lokasiId:"",name:"COND ACC;ARMOUR ROD AL 330MM2",katalog:"3060719",satuan:"BH",unit:"BH",qty:44.0,price:0,minQty:0,jenisBarang:"Pre Memory",lokasi:"— Belum diisi —",img:null,createdAt:1751000000000},
  {id:"STK-SAP-3060897",katalogId:"KAT-3060897",lokasiId:"",name:"COND ACC;DEAD END CLAMP 240MM2",katalog:"3060897",satuan:"BH",unit:"BH",qty:12.0,price:0,minQty:0,jenisBarang:"Pre Memory",lokasi:"— Belum diisi —",img:null,createdAt:1751000000000},
  {id:"STK-SAP-3060902",katalogId:"KAT-3060902",lokasiId:"",name:"COND ACC;DEAD END AL 598.94MM2",katalog:"3060902",satuan:"BH",unit:"BH",qty:33.0,price:0,minQty:0,jenisBarang:"Pre Memory",lokasi:"— Belum diisi —",img:null,createdAt:1751000000000},
  {id:"STK-SAP-3061004",katalogId:"KAT-3061004",lokasiId:"",name:"COND ACC;ARMOUR ROD AL 160MM2",katalog:"3061004",satuan:"BH",unit:"BH",qty:3.0,price:0,minQty:0,jenisBarang:"Pre Memory",lokasi:"— Belum diisi —",img:null,createdAt:1751000000000},
  {id:"STK-SAP-3061092",katalogId:"KAT-3061092",lokasiId:"",name:"COND ACC;JOINT AL 330mm2 COMP",katalog:"3061092",satuan:"BH",unit:"BH",qty:52.0,price:0,minQty:0,jenisBarang:"Pre Memory",lokasi:"— Belum diisi —",img:null,createdAt:1751000000000},
  {id:"STK-SAP-3061097",katalogId:"KAT-3061097",lokasiId:"",name:"COND ACC;JOINT AL 55mm2 COMP",katalog:"3061097",satuan:"BH",unit:"BH",qty:27.0,price:0,minQty:0,jenisBarang:"Pre Memory",lokasi:"— Belum diisi —",img:null,createdAt:1751000000000},
  {id:"STK-SAP-3061101",katalogId:"KAT-3061101",lokasiId:"",name:"COND ACC;JOINT GSW 55mm2 COMP",katalog:"3061101",satuan:"BH",unit:"BH",qty:59.0,price:0,minQty:0,jenisBarang:"Pre Memory",lokasi:"— Belum diisi —",img:null,createdAt:1751000000000},
  {id:"STK-SAP-3061118",katalogId:"KAT-3061118",lokasiId:"",name:"COND ACC;JOINT ST 55mm2",katalog:"3061118",satuan:"BH",unit:"BH",qty:90.0,price:0,minQty:0,jenisBarang:"Pre Memory",lokasi:"— Belum diisi —",img:null,createdAt:1751000000000},
  {id:"STK-SAP-3061159",katalogId:"KAT-3061159",lokasiId:"",name:"COND ACC;SPACER ACSR 330mm2",katalog:"3061159",satuan:"BH",unit:"BH",qty:52.0,price:0,minQty:0,jenisBarang:"Pre Memory",lokasi:"— Belum diisi —",img:null,createdAt:1751000000000},
  {id:"STK-SAP-3061166",katalogId:"KAT-3061166",lokasiId:"",name:"COND ACC;SPACER ACSR 429mm2 400mm",katalog:"3061166",satuan:"BH",unit:"BH",qty:14.0,price:203500,minQty:0,jenisBarang:"Persediaan",lokasi:"— Belum diisi —",img:null,createdAt:1751000000000},
  {id:"STK-SAP-3061196",katalogId:"KAT-3061196",lokasiId:"",name:"COND ACC;SUSPENSION CLAMP 338mm2",katalog:"3061196",satuan:"BH",unit:"BH",qty:6.0,price:0,minQty:0,jenisBarang:"Pre Memory",lokasi:"— Belum diisi —",img:null,createdAt:1751000000000},
  {id:"STK-SAP-3061223",katalogId:"KAT-3061223",lokasiId:"",name:"COND ACC;TENSION CLAMP 150mm2",katalog:"3061223",satuan:"BH",unit:"BH",qty:3.0,price:0,minQty:0,jenisBarang:"Pre Memory",lokasi:"— Belum diisi —",img:null,createdAt:1751000000000},
  {id:"STK-SAP-3061242",katalogId:"KAT-3061242",lokasiId:"",name:"COND ACC;TERMINAL CLAMP ST 38mm2",katalog:"3061242",satuan:"BH",unit:"BH",qty:12.0,price:0,minQty:0,jenisBarang:"Pre Memory",lokasi:"— Belum diisi —",img:null,createdAt:1751000000000},
  {id:"STK-SAP-3061356",katalogId:"KAT-3061356",lokasiId:"",name:"COND ACC;COMP MIDSPAN JOINT AL 328.5MM2",katalog:"3061356",satuan:"BH",unit:"BH",qty:2.0,price:12210000,minQty:0,jenisBarang:"Persediaan",lokasi:"— Belum diisi —",img:null,createdAt:1751000000000},
  {id:"STK-SAP-3061378",katalogId:"KAT-3061378",lokasiId:"",name:"COND ACC;COMP MIDSPAN JOINT AL 418.5MM2",katalog:"3061378",satuan:"BH",unit:"BH",qty:2.0,price:15070000,minQty:0,jenisBarang:"Persediaan",lokasi:"— Belum diisi —",img:null,createdAt:1751000000000},
  {id:"STK-SAP-3061416",katalogId:"KAT-3061416",lokasiId:"",name:"COND ACC;TENSION CLAMP ACSR 240MM2",katalog:"3061416",satuan:"BH",unit:"BH",qty:1.0,price:0,minQty:0,jenisBarang:"Pre Memory",lokasi:"— Belum diisi —",img:null,createdAt:1751000000000},
  {id:"STK-SAP-3061441",katalogId:"KAT-3061441",lokasiId:"",name:"COND ACC;I CLAMP AL600/800MM2 TO PLATE",katalog:"3061441",satuan:"U",unit:"U",qty:13.0,price:0,minQty:0,jenisBarang:"Pre Memory",lokasi:"— Belum diisi —",img:null,createdAt:1751000000000},
  {id:"STK-SAP-3061458",katalogId:"KAT-3061458",lokasiId:"",name:"COND ACC;I CLAMP AL400-400MM2",katalog:"3061458",satuan:"U",unit:"U",qty:19.0,price:0,minQty:0,jenisBarang:"Pre Memory",lokasi:"— Belum diisi —",img:null,createdAt:1751000000000},
  {id:"STK-SAP-3061459",katalogId:"KAT-3061459",lokasiId:"",name:"COND ACC;I CLAMP AL500-500MM2",katalog:"3061459",satuan:"U",unit:"U",qty:8.0,price:0,minQty:0,jenisBarang:"Pre Memory",lokasi:"— Belum diisi —",img:null,createdAt:1751000000000},
  {id:"STK-SAP-3061461",katalogId:"KAT-3061461",lokasiId:"",name:"COND ACC;T CLAMP AL400/500-600/800MM2",katalog:"3061461",satuan:"U",unit:"U",qty:12.0,price:0,minQty:0,jenisBarang:"Pre Memory",lokasi:"— Belum diisi —",img:null,createdAt:1751000000000},
  {id:"STK-SAP-3061465",katalogId:"KAT-3061465",lokasiId:"",name:"COND ACC;COMP TENSION CLAMP AL 587.3MM2",katalog:"3061465",satuan:"BH",unit:"BH",qty:6.0,price:0,minQty:0,jenisBarang:"Pre Memory",lokasi:"— Belum diisi —",img:null,createdAt:1751000000000},
  {id:"STK-SAP-3061472",katalogId:"KAT-3061472",lokasiId:"",name:"COND ACC;JOINT BOX OPGW 70MM2",katalog:"3061472",satuan:"BH",unit:"BH",qty:3.0,price:0,minQty:0,jenisBarang:"Pre Memory",lokasi:"— Belum diisi —",img:null,createdAt:1751000000000},
  {id:"STK-SAP-3061484",katalogId:"KAT-3061484",lokasiId:"",name:"COND ACC;REPAIR SLEEVE AL 176.9MM2",katalog:"3061484",satuan:"BH",unit:"BH",qty:3.0,price:0,minQty:0,jenisBarang:"Pre Memory",lokasi:"— Belum diisi —",img:null,createdAt:1751000000000},
  {id:"STK-SAP-3061509",katalogId:"KAT-3061509",lokasiId:"",name:"COND ACC;T CLAMP 1000MM TO 630MM",katalog:"3061509",satuan:"BH",unit:"BH",qty:19.0,price:0,minQty:0,jenisBarang:"Pre Memory",lokasi:"— Belum diisi —",img:null,createdAt:1751000000000},
  {id:"STK-SAP-3061547",katalogId:"KAT-3061547",lokasiId:"",name:"COND ACC;I CLAMP 400MM2-1000MM2",katalog:"3061547",satuan:"BH",unit:"BH",qty:6.0,price:0,minQty:0,jenisBarang:"Pre Memory",lokasi:"— Belum diisi —",img:null,createdAt:1751000000000},
  {id:"STK-SAP-3061588",katalogId:"KAT-3061588",lokasiId:"",name:"COND ACC;ARMOUR RODS AL",katalog:"3061588",satuan:"SET",unit:"SET",qty:15.0,price:0,minQty:0,jenisBarang:"Pre Memory",lokasi:"— Belum diisi —",img:null,createdAt:1751000000000},
  {id:"STK-SAP-3061602",katalogId:"KAT-3061602",lokasiId:"",name:"COND ACC;T CLAMP TAL 850-510 MM2",katalog:"3061602",satuan:"BH",unit:"BH",qty:32.0,price:0,minQty:0,jenisBarang:"Pre Memory",lokasi:"— Belum diisi —",img:null,createdAt:1751000000000},
  {id:"STK-SAP-3061611",katalogId:"KAT-3061611",lokasiId:"",name:"COND ACC;DOUBLE T CLAMP 400/600MM2",katalog:"3061611",satuan:"BH",unit:"BH",qty:2.0,price:0,minQty:0,jenisBarang:"Pre Memory",lokasi:"— Belum diisi —",img:null,createdAt:1751000000000},
  {id:"STK-SAP-3061614",katalogId:"KAT-3061614",lokasiId:"",name:"COND ACC;SUSPENSION CLAMP 160MM2",katalog:"3061614",satuan:"BH",unit:"BH",qty:35.0,price:0,minQty:0,jenisBarang:"Pre Memory",lokasi:"— Belum diisi —",img:null,createdAt:1751000000000},
  {id:"STK-SAP-3061615",katalogId:"KAT-3061615",lokasiId:"",name:"COND ACC;SUSPENSION CLAMP 240MM2",katalog:"3061615",satuan:"BH",unit:"BH",qty:11.0,price:0,minQty:0,jenisBarang:"Pre Memory",lokasi:"— Belum diisi —",img:null,createdAt:1751000000000},
  {id:"STK-SAP-3061616",katalogId:"KAT-3061616",lokasiId:"",name:"COND ACC;SUSPENSION CLAMP 660MM2",katalog:"3061616",satuan:"BH",unit:"BH",qty:33.0,price:0,minQty:0,jenisBarang:"Pre Memory",lokasi:"— Belum diisi —",img:null,createdAt:1751000000000},
  {id:"STK-SAP-3061617",katalogId:"KAT-3061617",lokasiId:"",name:"COND ACC;SUSPENSION CLAMP 800MM2",katalog:"3061617",satuan:"BH",unit:"BH",qty:12.0,price:0,minQty:0,jenisBarang:"Pre Memory",lokasi:"— Belum diisi —",img:null,createdAt:1751000000000},
  {id:"STK-SAP-3061619",katalogId:"KAT-3061619",lokasiId:"",name:"COND ACC;T CLAMP AL 330MM2",katalog:"3061619",satuan:"BH",unit:"BH",qty:7.0,price:0,minQty:0,jenisBarang:"Pre Memory",lokasi:"— Belum diisi —",img:null,createdAt:1751000000000},
  {id:"STK-SAP-3061621",katalogId:"KAT-3061621",lokasiId:"",name:"COND ACC;T-BRANCH SLEEVE AL 400MM2",katalog:"3061621",satuan:"BH",unit:"BH",qty:3.0,price:0,minQty:0,jenisBarang:"Pre Memory",lokasi:"— Belum diisi —",img:null,createdAt:1751000000000},
  {id:"STK-SAP-3061626",katalogId:"KAT-3061626",lokasiId:"",name:"COND ACC;TERMINAL CLAMP 800-400MM",katalog:"3061626",satuan:"BH",unit:"BH",qty:5.0,price:0,minQty:0,jenisBarang:"Pre Memory",lokasi:"— Belum diisi —",img:null,createdAt:1751000000000},
  {id:"STK-SAP-3070088",katalogId:"KAT-3070088",lokasiId:"",name:"ISOLATOR;NORMAL;PORC;150kV;DISC;120kN",katalog:"3070088",satuan:"BH",unit:"BH",qty:9732.0,price:405182,minQty:0,jenisBarang:"Persediaan",lokasi:"— Belum diisi —",img:null,createdAt:1751000000000},
  {id:"STK-SAP-3070211",katalogId:"KAT-3070211",lokasiId:"",name:"ISOLATOR;ROD;SILICONE;70KV;POST;70KN",katalog:"3070211",satuan:"SET",unit:"SET",qty:81.0,price:1454100,minQty:0,jenisBarang:"Persediaan",lokasi:"— Belum diisi —",img:null,createdAt:1751000000000},
  {id:"STK-SAP-3070213",katalogId:"KAT-3070213",lokasiId:"",name:"ISOLATOR;AFOG;POLYMER;150KV;POST;120KN",katalog:"3070213",satuan:"U",unit:"U",qty:12.0,price:3906090,minQty:0,jenisBarang:"Persediaan",lokasi:"— Belum diisi —",img:null,createdAt:1751000000000},
  {id:"STK-SAP-3100003",katalogId:"KAT-3100003",lokasiId:"",name:"STRINGSET ACC;BALL EYE",katalog:"3100003",satuan:"BH",unit:"BH",qty:107.0,price:0,minQty:0,jenisBarang:"Pre Memory",lokasi:"— Belum diisi —",img:null,createdAt:1751000000000},
  {id:"STK-SAP-3100026",katalogId:"KAT-3100026",lokasiId:"",name:"STRINGSET ACC;SOCKET CLEVIS",katalog:"3100026",satuan:"BH",unit:"BH",qty:44.0,price:0,minQty:0,jenisBarang:"Pre Memory",lokasi:"— Belum diisi —",img:null,createdAt:1751000000000},
  {id:"STK-SAP-3100078",katalogId:"KAT-3100078",lokasiId:"",name:"STRINGSET ACC;T CLAMP AL 300mm2 BOLT",katalog:"3100078",satuan:"BH",unit:"BH",qty:27.0,price:0,minQty:0,jenisBarang:"Pre Memory",lokasi:"— Belum diisi —",img:null,createdAt:1751000000000},
  {id:"STK-SAP-3100102",katalogId:"KAT-3100102",lokasiId:"",name:"STRINGSET ACC;SINGLE ARCHING HORN",katalog:"3100102",satuan:"BH",unit:"BH",qty:63.0,price:0,minQty:0,jenisBarang:"Pre Memory",lokasi:"— Belum diisi —",img:null,createdAt:1751000000000},
  {id:"STK-SAP-3100126",katalogId:"KAT-3100126",lokasiId:"",name:"STRINGSET ACC;RECTANGULAR YOKE",katalog:"3100126",satuan:"BH",unit:"BH",qty:16.0,price:0,minQty:0,jenisBarang:"Pre Memory",lokasi:"— Belum diisi —",img:null,createdAt:1751000000000},
  {id:"STK-SAP-3100155",katalogId:"KAT-3100155",lokasiId:"",name:"STRINGSET ACC;I CLAMP AL 330MM2",katalog:"3100155",satuan:"BH",unit:"BH",qty:15.0,price:0,minQty:0,jenisBarang:"Pre Memory",lokasi:"— Belum diisi —",img:null,createdAt:1751000000000},
  {id:"STK-SAP-3100156",katalogId:"KAT-3100156",lokasiId:"",name:"STRINGSET ACC;T CLAMP AL 330MM2",katalog:"3100156",satuan:"BH",unit:"BH",qty:12.0,price:0,minQty:0,jenisBarang:"Pre Memory",lokasi:"— Belum diisi —",img:null,createdAt:1751000000000},
  {id:"STK-SAP-3100157",katalogId:"KAT-3100157",lokasiId:"",name:"STRINGSET ACC;SOCKET CLEVIS 160KN",katalog:"3100157",satuan:"BH",unit:"BH",qty:100.0,price:0,minQty:0,jenisBarang:"Pre Memory",lokasi:"— Belum diisi —",img:null,createdAt:1751000000000},
  {id:"STK-SAP-3110074",katalogId:"KAT-3110074",lokasiId:"",name:"CABLE PWR;XLPE AL;1X800mm2;20kV;UG",katalog:"3110074",satuan:"M",unit:"M",qty:77.0,price:0,minQty:0,jenisBarang:"Pre Memory",lokasi:"— Belum diisi —",img:null,createdAt:1751000000000},
  {id:"STK-SAP-3110436",katalogId:"KAT-3110436",lokasiId:"",name:"CABLE PWR;XLPE CU;1X800MM2;150KV;UG",katalog:"3110436",satuan:"M",unit:"M",qty:450.0,price:0,minQty:0,jenisBarang:"Pre Memory",lokasi:"— Belum diisi —",img:null,createdAt:1751000000000},
  {id:"STK-SAP-3120356",katalogId:"KAT-3120356",lokasiId:"",name:"CABLE PWR ACC;CABLE SUPPORT",katalog:"3120356",satuan:"BH",unit:"BH",qty:3.0,price:0,minQty:0,jenisBarang:"Pre Memory",lokasi:"— Belum diisi —",img:null,createdAt:1751000000000},
  {id:"STK-SAP-3120420",katalogId:"KAT-3120420",lokasiId:"",name:"CABLE PWR ACC;CABLE SHOE AL 4mm2",katalog:"3120420",satuan:"BH",unit:"BH",qty:6.0,price:0,minQty:0,jenisBarang:"Pre Memory",lokasi:"— Belum diisi —",img:null,createdAt:1751000000000},
  {id:"STK-SAP-3120422",katalogId:"KAT-3120422",lokasiId:"",name:"CABLE PWR ACC;CABLE SHOE AL ID 1H 500mm2",katalog:"3120422",satuan:"BH",unit:"BH",qty:66.0,price:0,minQty:0,jenisBarang:"Pre Memory",lokasi:"— Belum diisi —",img:null,createdAt:1751000000000},
  {id:"STK-SAP-3120550",katalogId:"KAT-3120550",lokasiId:"",name:"CABLE PWR ACC;SEALING END OIL CU 800MM2",katalog:"3120550",satuan:"M",unit:"M",qty:5.0,price:0,minQty:0,jenisBarang:"Pre Memory",lokasi:"— Belum diisi —",img:null,createdAt:1751000000000},
  {id:"STK-SAP-3120560",katalogId:"KAT-3120560",lokasiId:"",name:"CABLE PWR ACC;SEAL END 150KV 1000MM2",katalog:"3120560",satuan:"BH",unit:"BH",qty:1.0,price:0,minQty:0,jenisBarang:"Pre Memory",lokasi:"— Belum diisi —",img:null,createdAt:1751000000000},
  {id:"STK-SAP-3120590",katalogId:"KAT-3120590",lokasiId:"",name:"CABLE PWR ACC;STRAIGHT JOINT AL1X800mm2",katalog:"3120590",satuan:"SET",unit:"SET",qty:1.0,price:0,minQty:0,jenisBarang:"Pre Memory",lokasi:"— Belum diisi —",img:null,createdAt:1751000000000},
  {id:"STK-SAP-3120628",katalogId:"KAT-3120628",lokasiId:"",name:"CABLE PWR ACC;SEALING END 150kV 240-2000",katalog:"3120628",satuan:"BH",unit:"BH",qty:4.0,price:0,minQty:0,jenisBarang:"Pre Memory",lokasi:"— Belum diisi —",img:null,createdAt:1751000000000},
  {id:"STK-SAP-3120654",katalogId:"KAT-3120654",lokasiId:"",name:"CABLE PWR ACC;LINK BOX FOR CROSS BONDING",katalog:"3120654",satuan:"BH",unit:"BH",qty:5.0,price:45265000,minQty:0,jenisBarang:"Persediaan",lokasi:"— Belum diisi —",img:null,createdAt:1751000000000},
  {id:"STK-SAP-3130056",katalogId:"KAT-3130056",lokasiId:"",name:"JOINT;20kV;AL-AL;800mm2;X-X;1P;PR",katalog:"3130056",satuan:"SET",unit:"SET",qty:10.0,price:10043000,minQty:0,jenisBarang:"Persediaan Bursa",lokasi:"— Belum diisi —",img:null,createdAt:1751000000000},
  {id:"STK-SAP-3130193",katalogId:"KAT-3130193",lokasiId:"",name:"JOINT;150KV;CU-CU;1200MM2;;1P;PR",katalog:"3130193",satuan:"BH",unit:"BH",qty:3.0,price:85001400,minQty:0,jenisBarang:"Persediaan",lokasi:"— Belum diisi —",img:null,createdAt:1751000000000},
  {id:"STK-SAP-3150115",katalogId:"KAT-3150115",lokasiId:"",name:"TERM;150kV;;CU;1P;1X800MM2;ISO;ID",katalog:"3150115",satuan:"BH",unit:"BH",qty:3.0,price:99978689,minQty:0,jenisBarang:"Persediaan Bursa",lokasi:"— Belum diisi —",img:null,createdAt:1751000000000},
  {id:"STK-SAP-3160005",katalogId:"KAT-3160005",lokasiId:"",name:"TERM ACC;ELASTIMOLD",katalog:"3160005",satuan:"SET",unit:"SET",qty:30.0,price:4627700,minQty:0,jenisBarang:"Persediaan Bursa",lokasi:"— Belum diisi —",img:null,createdAt:1751000000000},
  {id:"STK-SAP-3160043",katalogId:"KAT-3160043",lokasiId:"",name:"TERM ACC;TERMINATION 20kV 95mm2 OD",katalog:"3160043",satuan:"BH",unit:"BH",qty:2.0,price:0,minQty:0,jenisBarang:"Pre Memory",lokasi:"— Belum diisi —",img:null,createdAt:1751000000000},
  {id:"STK-SAP-3160062",katalogId:"KAT-3160062",lokasiId:"",name:"TERM ACC;TERMINATION 20 KV 400MM2 OD",katalog:"3160062",satuan:"SET",unit:"SET",qty:1.0,price:0,minQty:0,jenisBarang:"Pre Memory",lokasi:"— Belum diisi —",img:null,createdAt:1751000000000},
  {id:"STK-SAP-3160090",katalogId:"KAT-3160090",lokasiId:"",name:"TERM ACC;TERMINATION 1 CORE 150-300MM2OD",katalog:"3160090",satuan:"SET",unit:"SET",qty:1.0,price:0,minQty:0,jenisBarang:"Pre Memory",lokasi:"— Belum diisi —",img:null,createdAt:1751000000000},
  {id:"STK-SAP-3260187",katalogId:"KAT-3260187",lokasiId:"",name:"COND ACC;COUNTER WEIGHT",katalog:"3260187",satuan:"BH",unit:"BH",qty:134.0,price:0,minQty:0,jenisBarang:"Pre Memory",lokasi:"— Belum diisi —",img:null,createdAt:1751000000000},
  {id:"STK-SAP-3260197",katalogId:"KAT-3260197",lokasiId:"",name:"COND ACC;DEAD END CLAMP AL 310mm2",katalog:"3260197",satuan:"BH",unit:"BH",qty:2.0,price:10450000,minQty:0,jenisBarang:"Persediaan",lokasi:"— Belum diisi —",img:null,createdAt:1751000000000},
  {id:"STK-SAP-3260198",katalogId:"KAT-3260198",lokasiId:"",name:"COND ACC;DEAD END CLAMP AL 330mm2",katalog:"3260198",satuan:"BH",unit:"BH",qty:21.0,price:0,minQty:0,jenisBarang:"Pre Memory",lokasi:"— Belum diisi —",img:null,createdAt:1751000000000},
  {id:"STK-SAP-3260216",katalogId:"KAT-3260216",lokasiId:"",name:"COND ACC;JUMPER CLAMP GSW 55mm2",katalog:"3260216",satuan:"BH",unit:"BH",qty:20.0,price:0,minQty:0,jenisBarang:"Pre Memory",lokasi:"— Belum diisi —",img:null,createdAt:1751000000000},
  {id:"STK-SAP-3280054",katalogId:"KAT-3280054",lokasiId:"",name:"CONN;;T STUD TO W;AL;510-400mm2;BOLT",katalog:"3280054",satuan:"BH",unit:"BH",qty:11.0,price:105566,minQty:0,jenisBarang:"Persediaan Bursa",lokasi:"— Belum diisi —",img:null,createdAt:1751000000000},
  {id:"STK-SAP-4120026",katalogId:"KAT-4120026",lokasiId:"",name:"BOX;TRF;ST PLATE;",katalog:"4120026",satuan:"BH",unit:"BH",qty:2.0,price:27116667,minQty:0,jenisBarang:"Persediaan Bursa",lokasi:"— Belum diisi —",img:null,createdAt:1751000000000},
  {id:"STK-SAP-4140009",katalogId:"KAT-4140009",lokasiId:"",name:"PANEL;SPINDEL;ST;;",katalog:"4140009",satuan:"U",unit:"U",qty:2.0,price:0,minQty:0,jenisBarang:"Pre Memory",lokasi:"— Belum diisi —",img:null,createdAt:1751000000000},
  {id:"STK-SAP-4140037",katalogId:"KAT-4140037",lokasiId:"",name:"PANEL;CTL150kVTRF;ST;2250X800X800MM",katalog:"4140037",satuan:"SET",unit:"SET",qty:1.0,price:323391860,minQty:0,jenisBarang:"Persediaan Bursa",lokasi:"— Belum diisi —",img:null,createdAt:1751000000000},
  {id:"STK-SAP-4140059",katalogId:"KAT-4140059",lokasiId:"",name:"PANEL;CTL AC/DC;ST;220X90X80cm",katalog:"4140059",satuan:"U",unit:"U",qty:1.0,price:0,minQty:0,jenisBarang:"Pre Memory",lokasi:"— Belum diisi —",img:null,createdAt:1751000000000},
  {id:"STK-SAP-4140203",katalogId:"KAT-4140203",lokasiId:"",name:"PANEL;PRO150KV;ST;243X80X150CM",katalog:"4140203",satuan:"U",unit:"U",qty:1.0,price:0,minQty:0,jenisBarang:"Pre Memory",lokasi:"— Belum diisi —",img:null,createdAt:1751000000000},
  {id:"STK-SAP-4140348",katalogId:"KAT-4140348",lokasiId:"",name:"PANEL;SCADA;ST;240X95X85CM",katalog:"4140348",satuan:"U",unit:"U",qty:1.0,price:0,minQty:0,jenisBarang:"Pre Memory",lokasi:"— Belum diisi —",img:null,createdAt:1751000000000},
  {id:"STK-SAP-4140690",katalogId:"KAT-4140690",lokasiId:"",name:"PANEL;SAS;ST 2.5mm;2200X800X800mm;IP54",katalog:"4140690",satuan:"U",unit:"U",qty:1.0,price:0,minQty:0,jenisBarang:"Pre Memory",lokasi:"— Belum diisi —",img:null,createdAt:1751000000000},
  {id:"STK-SAP-4140699",katalogId:"KAT-4140699",lokasiId:"",name:"PANEL;CTL+PRO INTRFC;IRON;800X600X200CM;",katalog:"4140699",satuan:"BH",unit:"BH",qty:1.0,price:0,minQty:0,jenisBarang:"Pre Memory",lokasi:"— Belum diisi —",img:null,createdAt:1751000000000},
  {id:"STK-SAP-4160002",katalogId:"KAT-4160002",lokasiId:"",name:"CABLE CTRL;COAXIAL ARMOUR 75OHM;;;",katalog:"4160002",satuan:"M",unit:"M",qty:1174.0,price:62234,minQty:0,jenisBarang:"Persediaan Bursa",lokasi:"— Belum diisi —",img:null,createdAt:1751000000000},
  {id:"STK-SAP-4160003",katalogId:"KAT-4160003",lokasiId:"",name:"CABLE CTRL;COAXIAL RG8 50OHM;;;",katalog:"4160003",satuan:"M",unit:"M",qty:1000.0,price:0,minQty:0,jenisBarang:"Pre Memory",lokasi:"— Belum diisi —",img:null,createdAt:1751000000000},
  {id:"STK-SAP-4160174",katalogId:"KAT-4160174",lokasiId:"",name:"CABLE CTRL;FO AERIAL 12 CORE;12.5MM;;OH",katalog:"4160174",satuan:"M",unit:"M",qty:2000.0,price:0,minQty:0,jenisBarang:"Pre Memory",lokasi:"— Belum diisi —",img:null,createdAt:1751000000000},
  {id:"STK-SAP-4170157",katalogId:"KAT-4170157",lokasiId:"",name:"CABLE CTRL ACC;CABLE SCHOEN AL-CU 630MM",katalog:"4170157",satuan:"BH",unit:"BH",qty:3.0,price:0,minQty:0,jenisBarang:"Pre Memory",lokasi:"— Belum diisi —",img:null,createdAt:1751000000000},
  {id:"STK-SAP-4180024",katalogId:"KAT-4180024",lokasiId:"",name:"INSUL MEDIA;OIL;SILICON",katalog:"4180024",satuan:"L",unit:"L",qty:200.0,price:0,minQty:0,jenisBarang:"Pre Memory",lokasi:"— Belum diisi —",img:null,createdAt:1751000000000},
  {id:"STK-SAP-4190331",katalogId:"KAT-4190331",lokasiId:"",name:"UNIV ACC;ORING GIL 150KV",katalog:"4190331",satuan:"SET",unit:"SET",qty:4.0,price:0,minQty:0,jenisBarang:"Pre Memory",lokasi:"— Belum diisi —",img:null,createdAt:1751000000000},
  {id:"STK-SAP-4190448",katalogId:"KAT-4190448",lokasiId:"",name:"UNIV ACC;CLAMP CABLE NO.12",katalog:"4190448",satuan:"BH",unit:"BH",qty:16.0,price:0,minQty:0,jenisBarang:"Pre Memory",lokasi:"— Belum diisi —",img:null,createdAt:1751000000000},
  {id:"STK-SAP-4191106",katalogId:"KAT-4191106",lokasiId:"",name:"UNIV ACC;KACA OIL LEVEL",katalog:"4191106",satuan:"BH",unit:"BH",qty:1.0,price:0,minQty:0,jenisBarang:"Pre Memory",lokasi:"— Belum diisi —",img:null,createdAt:1751000000000},
  {id:"STK-SAP-4191468",katalogId:"KAT-4191468",lokasiId:"",name:"UNIV ACC;U BOLT",katalog:"4191468",satuan:"BH",unit:"BH",qty:101.0,price:0,minQty:0,jenisBarang:"Pre Memory",lokasi:"— Belum diisi —",img:null,createdAt:1751000000000},
  {id:"STK-SAP-4191591",katalogId:"KAT-4191591",lokasiId:"",name:"UNIV ACC;MOISTURE ABSORBENT",katalog:"4191591",satuan:"BH",unit:"BH",qty:2.0,price:0,minQty:0,jenisBarang:"Pre Memory",lokasi:"— Belum diisi —",img:null,createdAt:1751000000000},
  {id:"STK-SAP-5020387",katalogId:"KAT-5020387",lokasiId:"",name:"PLC ACC;KABEL TELEPON OUTDOOR",katalog:"5020387",satuan:"M",unit:"M",qty:1000.0,price:0,minQty:0,jenisBarang:"Pre Memory",lokasi:"— Belum diisi —",img:null,createdAt:1751000000000},
  {id:"STK-SAP-7010351",katalogId:"KAT-7010351",lokasiId:"",name:"TOOL M;SHACKLE",katalog:"7010351",satuan:"BH",unit:"BH",qty:11.0,price:0,minQty:0,jenisBarang:"Pre Memory",lokasi:"— Belum diisi —",img:null,createdAt:1751000000000},
  {id:"STK-SAP-7020054",katalogId:"KAT-7020054",lokasiId:"",name:"TOOL E;MANOMETER",katalog:"7020054",satuan:"SET",unit:"SET",qty:2.0,price:0,minQty:0,jenisBarang:"Pre Memory",lokasi:"— Belum diisi —",img:null,createdAt:1751000000000},
  {id:"STK-SAP-7020880",katalogId:"KAT-7020880",lokasiId:"",name:"TOOL E;TEST RELAY 3 PHASA 3 CURRENT",katalog:"7020880",satuan:"U",unit:"U",qty:6.0,price:149898563,minQty:0,jenisBarang:"Persediaan",lokasi:"— Belum diisi —",img:null,createdAt:1751000000000},
  {id:"STK-SAP-31200240",katalogId:"KAT-31200240",lokasiId:"",name:"CABLE PWR ACC;LINK BOX GROUNDING SISTEM",katalog:"31200240",satuan:"BH",unit:"BH",qty:3.0,price:53212762,minQty:0,jenisBarang:"Persediaan",lokasi:"— Belum diisi —",img:null,createdAt:1751000000000},
  {id:"STK-SAP-3260169",katalogId:"KAT-3260169",lokasiId:"",name:"COND ACC;REPAIR SLEEVE AL 330mm2",katalog:"3260169",satuan:"BH",unit:"BH",qty:0.0,price:0,minQty:0,jenisBarang:"Pre Memory",lokasi:"— Belum diisi —",img:null,createdAt:1751000000000}
];

// ─── MIGRATION: convert legacy flat-stock records (pre-master-data) ───
// into the new {katalog, lokasi, stock} structure. Safe to run on data
// that's already in the new shape (returns it unchanged via a marker).
function migrateLegacyStocks(rawStocks) {
  if (!rawStocks || rawStocks.length === 0) return null;
  // New-shape rows have katalogId/lokasiId; legacy rows have name/katalog/lokasi directly.
  const isLegacy = rawStocks.some(s => s.katalogId === undefined && s.name !== undefined);
  if (!isLegacy) return null; // already migrated / not applicable

  const katalogMap = new Map(); // name+katalog -> katalogId
  const lokasiMap = new Map();  // lokasi string -> lokasiId
  const katalog = [];
  const lokasi = [];
  const stocks = [];

  rawStocks.forEach((s, idx) => {
    const katKey = `${s.katalog}|${s.name}`;
    let katalogId = katalogMap.get(katKey);
    if (!katalogId) {
      katalogId = `KAT-${String(katalog.length+1).padStart(3,"0")}`;
      katalogMap.set(katKey, katalogId);
      katalog.push({ id:katalogId, katalog:s.katalog||"", name:s.name, category:s.category||"Lainnya", satuan:s.unit||"unit", createdAt:s.createdAt||Date.now() });
    }
    const lokKey = s.lokasi || "Belum Ditentukan";
    let lokasiId = lokasiMap.get(lokKey);
    if (!lokasiId) {
      lokasiId = `LOK-${String(lokasi.length+1).padStart(3,"0")}`;
      lokasiMap.set(lokKey, lokasiId);
      lokasi.push({ id:lokasiId, kode:lokKey, keterangan:"Hasil migrasi otomatis", kapasitas:50, createdAt:Date.now() });
    }
    stocks.push({
      id: `STK-${String(idx+1).padStart(3,"0")}`,
      katalogId, lokasiId,
      qty: s.qty||0, minQty: s.minQty||0, price: s.price||0,
      jenisBarang: s.jenisBarang||"Cadang", img: s.img||null,
      createdAt: s.createdAt||Date.now(),
    });
  });

  return { katalog, lokasi, stocks };
}

const now = Date.now();
const DEFAULT_TXNS = [];

// ─── DOC NUMBER GENERATOR ─────────────────────────────────────────────
function generateDocNumbers(seq, date, docCode) {
  const d = new Date(date);
  const roman = ROMAN[d.getMonth()];
  const year = d.getFullYear();
  const code = docCode || "LOG.00.02";
  const base = `${code}/UPT-SBYA/${roman}/${year}`;
  const baseUIT = `LOG/UIT-JBM/${roman}/${year}`;
  return {
    sj: `${seq}.SJ/${base}`,
    tug9: `${seq}.TUG-9/${base}`,
    tug8: `${seq}.TUG-8/${base}`,
    tug3: `${seq}.TUG-3/${base}`,
    tug4: `${seq}.TUG-4/${base}`,
    tug10: `${seq}.TUG-10/${base}`,
    tug5: `${seq}.TUG-5/LOG-UPT-SBYA/${roman}/${year}`, // format: 13.TUG-5/LOG-UPT-SBYA/VI/2026
    tug7: `${String(seq).padStart(3,"0")}.TUG7/${baseUIT}`, // format: 001.TUG7/LOG/UIT-JBM/VI/2026
  };
}

// ─── UTILITIES ───────────────────────────────────────────────────────
function uid() { return "PLN" + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2,5).toUpperCase(); }
function fmtDate(ts) { if (!ts) return "-"; return new Date(ts).toLocaleDateString("id-ID", { day:"2-digit", month:"short", year:"numeric", hour:"2-digit", minute:"2-digit" }); }
function fmtDateOnly(ts) { if (!ts) return "-"; return new Date(ts).toLocaleDateString("id-ID", { day:"2-digit", month:"long", year:"numeric" }); }
function fmtNum(n) { return Number(n||0).toLocaleString("id-ID"); }
function fmtRp(n) { return "Rp " + fmtNum(n); }

// ── Statistik Stok: saldo per jenis barang & persentase SAP vs Non-SAP ──
// Dipakai sebagai konteks tambahan untuk AI chat/forecast supaya bisa
// menjawab pertanyaan detail seperti "berapa saldo cadang", "berapa
// persentase material SAP" dll tanpa AI harus menghitung ulang dari mentah.
function buildStockStats(stocks) {
  const byJenis = {};
  let sapCount = 0, sapValue = 0, nonSapCount = 0, nonSapValue = 0;
  stocks.forEach(s => {
    const jenis = s.jenisBarang || "Tidak Terklasifikasi";
    if (!byJenis[jenis]) byJenis[jenis] = { count: 0, qty: 0, value: 0 };
    byJenis[jenis].count += 1;
    byJenis[jenis].qty += s.qty || 0;
    byJenis[jenis].value += (s.qty || 0) * (s.price || 0);

    const isSap = String(s.id || "").startsWith("STK-SAP-");
    if (isSap) { sapCount += 1; sapValue += (s.qty || 0) * (s.price || 0); }
    else { nonSapCount += 1; nonSapValue += (s.qty || 0) * (s.price || 0); }
  });
  const totalCount = stocks.length || 1;
  const totalValue = sapValue + nonSapValue;
  return {
    byJenis,
    sap: { count: sapCount, value: sapValue, pctCount: (sapCount/totalCount*100).toFixed(1), pctValue: totalValue?(sapValue/totalValue*100).toFixed(1):"0.0" },
    nonSap: { count: nonSapCount, value: nonSapValue, pctCount: (nonSapCount/totalCount*100).toFixed(1), pctValue: totalValue?(nonSapValue/totalValue*100).toFixed(1):"0.0" },
  };
}

// Format ringkasan statistik stok jadi teks siap-pakai untuk system prompt AI.
function formatStockStatsText(stocks) {
  const stats = buildStockStats(stocks);
  const jenisLines = Object.entries(stats.byJenis)
    .map(([jenis, d]) => `- ${jenis}: ${d.count} item | Saldo Qty: ${fmtNum(d.qty)} | Nilai: ${fmtRp(Math.round(d.value))}`)
    .join("\n");
  return `SALDO PER JENIS BARANG:
${jenisLines}

KOMPOSISI SAP vs NON-SAP:
- Material SAP (kode STK-SAP-...): ${stats.sap.count} item (${stats.sap.pctCount}% dari jumlah item, ${stats.sap.pctValue}% dari total nilai) | Nilai: ${fmtRp(Math.round(stats.sap.value))}
- Material Non-SAP (input manual): ${stats.nonSap.count} item (${stats.nonSap.pctCount}% dari jumlah item, ${stats.nonSap.pctValue}% dari total nilai) | Nilai: ${fmtRp(Math.round(stats.nonSap.value))}`;
}

// ── SAP File Parser (CSV + XLSX, handle BOM) ─────────────────────────────
function parseSAPRowsFromCSV(text) {
  // Strip BOM if present
  const cleaned = text.replace(/^\uFEFF/, "").replace(/^\xEF\xBB\xBF/, "");
  const lines = cleaned.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return [];

  // Parse header - handle quoted fields
  function splitCSVLine(line) {
    const result = [];
    let cur = "", inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') { inQ = !inQ; }
      else if (ch === ',' && !inQ) { result.push(cur.trim()); cur = ""; }
      else { cur += ch; }
    }
    result.push(cur.trim());
    return result;
  }

  const headers = splitCSVLine(lines[0]);
  return lines.slice(1).filter(l => l.trim()).map(line => {
    const vals = splitCSVLine(line);
    const obj = {};
    headers.forEach((h, i) => { obj[h.trim()] = (vals[i] || "").trim(); });
    return mapSAPRow(obj);
  }).filter(r => r.katalog);
}

function parseSAPRowsFromXLSX(arrayBuffer) {
  const wb = XLSX.read(arrayBuffer, { type: "array" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const raw = XLSX.utils.sheet_to_json(ws, { defval: "" });
  return raw.map(obj => mapSAPRow(obj)).filter(r => r.katalog);
}

function mapSAPRow(obj) {
  // Normalize key lookup - try exact then trimmed
  const get = (key) => (obj[key] ?? obj[key.trim()] ?? "").toString().trim();

  const materialRaw = get("Material");
  const katalog = materialRaw.replace(/^0+/, "");
  if (!katalog) return null;

  // Parse qty: "1.000" → 1 (SAP uses dot as decimal, not thousands)
  const qtyRaw = get("Unrestricted Use Stock");
  const qty = parseFloat(qtyRaw.replace(",", ".")) || 0;

  // Parse harga: "121000000" plain integer
  const hargaRaw = get("Harga Satuan");
  let harga = 0;
  try {
    const cleaned = hargaRaw.replace(/[^\d.,]/g, "");
    const parts = cleaned.split(".");
    // If multiple dots and last group is 3 digits → thousands separator
    if (parts.length > 2 || (parts.length === 2 && parts[1].length === 3 && !cleaned.includes(","))) {
      harga = parseInt(cleaned.replace(/\./g, "")) || 0;
    } else {
      harga = parseFloat(cleaned.replace(",", ".")) || 0;
    }
  } catch { harga = 0; }

  const valType = get("Valuation Type").toUpperCase();
  const digitCount = katalog.length;

  let jenisBarang;
  if (digitCount === 10) {
    jenisBarang = "Cadang";
  } else {
    if (valType === "PRE-MEMORY") jenisBarang = "Pre Memory";
    else if (valType === "BURSA") jenisBarang = "Persediaan Bursa";
    else jenisBarang = "Persediaan";
  }

  return {
    katalog,
    nama: get("Material Description"),
    satuan: get("Base Unit of Measure") || "U",
    qty,
    harga: Math.round(harga),
    jenisBarang,
    valuationType: valType,
    valuationDesc: get("Valuation Description"),
  };
}

async function parseSAPFile(file) {
  return new Promise((resolve, reject) => {
    const ext = file.name.split(".").pop().toLowerCase();
    if (ext === "xlsx" || ext === "xls") {
      const reader = new FileReader();
      reader.onload = ev => {
        try {
          const rows = parseSAPRowsFromXLSX(ev.target.result);
          resolve(rows);
        } catch(e) { reject(e); }
      };
      reader.onerror = () => reject(new Error("Gagal membaca file XLSX"));
      reader.readAsArrayBuffer(file);
    } else {
      // CSV — try utf-8 first, handle BOM
      const reader = new FileReader();
      reader.onload = ev => {
        try {
          const rows = parseSAPRowsFromCSV(ev.target.result);
          resolve(rows);
        } catch(e) { reject(e); }
      };
      reader.onerror = () => reject(new Error("Gagal membaca file CSV"));
      reader.readAsText(file, "utf-8");
    }
  });
}

function terbilangHari(ts) {
  const days = ["Minggu","Senin","Selasa","Rabu","Kamis","Jumat","Sabtu"];
  return days[new Date(ts).getDay()];
}

// ─── ENRICHMENT: join Data Stok rows with Master Katalog + Master Lokasi ─
// Returns a "flat" view shaped like the old combined stock record, so the
// rest of the UI (cards, forms, PDF builder, forecast, etc.) can keep using
// familiar fields (name, katalog, category, unit, lokasi) without needing
// to know about the master-data split under the hood.
function enrichStock(stock, katalogList, lokasiList) {
  const kat = (katalogList||[]).find(k => k.id === stock.katalogId) || {};
  const lok = (lokasiList||[]).find(l => l.id === stock.lokasiId) || {};
  return {
    ...stock,
    name: kat.name || stock.name || "(Katalog tidak ditemukan)",
    katalog: kat.katalog || stock.katalog || "-",
    category: kat.category || "Lainnya",
    unit: kat.satuan || stock.unit || "unit",
    lokasi: lok.kode || stock.lokasi || "-",
    lokasiKeterangan: lok.keterangan || "",
    // jenisBarang: Master Katalog adalah sumber kebenaran.
    // Jika katalog tidak ditemukan, fallback ke nilai di Data Stok.
    jenisBarang: kat.jenisBarang || stock.jenisBarang || "Cadang",
  };
}
function enrichStocks(stocks, katalogList, lokasiList) {
  return (stocks||[]).map(s => enrichStock(s, katalogList, lokasiList));
}

// Buang entri dengan `id` ganda (simpan kemunculan PERTAMA saja). Dipakai saat
// memuat data dari storage — data lama yang sudah tersimpan di localStorage
// user (sebelum bug id ganda di seed data diperbaiki) tidak ikut diperbaiki
// oleh perubahan source code, karena begitu ada data tersimpan, app selalu
// memuat dari storage, bukan dari DEFAULT_* lagi. Jadi pembersihan id ganda
// harus dilakukan saat load, bukan cuma di seed.
function dedupeById(arr) {
  const seen = new Set();
  const list = [];
  let removed = 0;
  for (const item of (arr || [])) {
    if (item && item.id != null) {
      if (seen.has(item.id)) { removed++; continue; }
      seen.add(item.id);
    }
    list.push(item);
  }
  return { list, removed };
}

// ─── PENCARIAN MATERIAL: struktur nama (KATEGORI;SUBTIPE;SPEK...) di katalog
// TIDAK diubah — hanya cara membandingkannya saat search yang disesuaikan,
// supaya orang yang tidak tahu singkatan/istilah teknis PLN tetap bisa
// menemukan barangnya.
// Singkatan kategori PLN -> frasa deskriptif lengkap. SATU ARAH SAJA: hanya
// dipakai untuk memperkaya teks KATALOG (haystack), TIDAK dipakai untuk
// meng-expand kata yang diketik user. Kalau dipakai dua arah, kategori yang
// berbeda tapi berbagi kata umum di frasanya (mis. "pt" dan "ct" sama-sama
// punya kata "trafo"/"transformer") akan saling ketuker — cari "pt" ikut
// menampilkan semua barang "trf"/"ct" hanya karena kata "trafo" dibagi
// bersama. Makanya arah ini ditutup di sisi query.
const CATEGORY_SYNONYMS = {
  trf: "transformator trafo",
  cb: "circuit breaker pemutus tenaga pmt",
  ds: "disconnecting switch pemisah pms",
  pt: "potential transformer trafo tegangan",
  ct: "current transformer trafo arus",
  acc: "accessories aksesoris",
  al: "aluminium",
  cu: "tembaga copper",
  ngr: "neutral grounding resistance resistor pentanahan",
  cond: "conductor kawat penghantar",
  gsw: "galvanized steel wire kawat baja",
  sw: "switch saklar",
  cub: "kubikel cubicle",
  relay: "rele",
};

// Pasangan istilah 1:1 (awam <-> teknis) yang AMAN dipakai dua arah karena
// kata penggantinya spesifik/tidak dibagi kategori lain — ini yang membuat
// "klem" nemu "CLAMP", "saklar" nemu kata "switch" (hasil expand DS di atas),
// "sekring" nemu "FUSE", dst.
const QUERY_SYNONYMS = {
  klem: "clamp",
  clamp: "klem",
  saklar: "switch",
  sekring: "fuse",
  fuse: "sekring",
  terminasi: "term terminal",
  terminal: "term",
  term: "terminal",
  box: "kotak",
  kotak: "box",
  joint: "sambungan",
  conn: "sambungan",
  sambungan: "joint conn",
  bolt: "baut",
  baut: "bolt",
  rod: "batang",
  batang: "rod",
};

// Samakan variasi penulisan biar bisa dibandingkan apa adanya: hilangkan
// pemisah `;`/`,`/`-`, lowercase, rapatkan spasi antara angka dan satuan
// (550 mm2 -> 550mm2) tanpa pernah menulis balik ke data aslinya.
function normalizeSearchText(str) {
  return (str || "")
    .toLowerCase()
    .replace(/[;,\-]/g, " ")
    .replace(/(\d)\s+(mm2|mm|cm|kv|kn|kva|kw|ka|ohm|va|a|v)\b/gi, "$1$2")
    .replace(/\s+/g, " ")
    .trim();
}

// Haystack katalog diperkaya dengan KEDUA kamus (kategori + istilah 1:1) —
// aman di sisi ini karena hanya mempengaruhi item itu sendiri, tidak
// menjembatani ke item lain.
function expandHaystackSynonyms(normalizedText) {
  return normalizedText
    .split(" ")
    .map(w => {
      const exp = CATEGORY_SYNONYMS[w] || QUERY_SYNONYMS[w];
      return exp ? `${w} ${exp}` : w;
    })
    .join(" ");
}

// Setiap KATA yang diketik user jadi satu "grup alternatif" (kata itu sendiri
// + sinonim 1:1-nya saja, BUKAN kamus kategori) — posisi itu lolos kalau
// SALAH SATU alternatif ketemu di katalog (OR per grup), tapi user tetap
// harus mengetik SEMUA kata yang ia masukkan (AND antar grup).
function queryTokenGroups(query) {
  return normalizeSearchText(query).split(" ").filter(Boolean).map(w => {
    const syn = QUERY_SYNONYMS[w];
    return syn ? [w, ...syn.split(" ")] : [w];
  });
}

// Kata pendek (<=2 huruf, mis. "al"/"cb"/"ct"/"cu") HARUS sama persis dengan
// satu kata di katalog — kalau dibolehkan prefix, "cu" bisa nyangkut di kata
// tak terkait yang juga diawali "cu" (mis. "CUB"/"CURRENT"), jadi ikut
// memunculkan barang yang salah klasifikasi. Kata yang lebih panjang (>=3
// huruf) tetap dicocokkan sebagai prefix supaya bisa diketik sebagian
// ("trans" -> "transformator", "550" -> "550mm2").
function matchesStockSearch(stock, query) {
  if (!query || !query.trim()) return true;
  const haystackWords = expandHaystackSynonyms(normalizeSearchText(
    [stock.name, stock.id, stock.katalog, stock.lokasi, stock.merk, stock.category].filter(Boolean).join(" ")
  )).split(" ").filter(Boolean);
  const groups = queryTokenGroups(query);
  return groups.every(alts => alts.some(t => haystackWords.some(w => (t.length <= 2 ? w === t : w.startsWith(t)))));
}
// Total quantity of a catalog item across ALL locations (used for forecast /
// dashboard totals where "this item" should mean the sum, not one location).
function totalQtyForKatalog(katalogId, stocks) {
  return (stocks||[]).filter(s => s.katalogId === katalogId).reduce((a,s)=>a+(s.qty||0), 0);
}
// How much capacity is used at a given location (sum of qty of all stock rows there)
function lokasiUsedCapacity(lokasiId, stocks) {
  return (stocks||[]).filter(s => s.lokasiId === lokasiId).reduce((a,s)=>a+(s.qty||0), 0);
}
// Badge color scheme for the 3 TUG-10 return statuses
function statusMaterialBadgeStyle(status) {
  if (status === "Bongkaran ATTB (MTU)") return { bg:"#fef3c7", fg:"#92400e" };
  if (status === "Bongkaran") return { bg:"#fef9c3", fg:"#854d0e" };
  return { bg:"#dcfce7", fg:"#166534" }; // Material Sisa Baru
}

// ─── SAP STATUS DETECTION ────────────────────────────────────────────────
// Detects SAP/Non-SAP automatically from katalog number format:
//   10-digit pure number → SAP (Cadang)
//   7-digit pure number  → SAP (Persediaan / Pre Memory terdaftar SAP)
//   anything else        → Non-SAP
function getSAPStatus(katalog) {
  if (!katalog || katalog.trim() === "") return "Non-SAP";
  const k = katalog.trim();
  if (/^\d{10}$/.test(k)) return "SAP";
  if (/^\d{7,8}$/.test(k)) return "SAP";
  return "Non-SAP";
}
function getSAPLabel(katalog) {
  if (!katalog || katalog.trim() === "") return "Non-SAP";
  const k = katalog.trim();
  if (/^\d{10}$/.test(k)) return "SAP — Cadang";
  if (/^\d{7,8}$/.test(k)) return "SAP — Persediaan";
  return "Non-SAP";
}
function getSAPBadgeStyle(katalog) {
  return getSAPStatus(katalog) === "SAP"
    ? { bg:"#dbeafe", fg:"#1d4ed8" }
    : { bg:"#f3f4f6", fg:"#6b7280" };
}

// Accent color per Jenis Barang, used on the printable QR label
function jenisBarangAccentColor(jenisBarang) {
  const map = {
    "Persediaan": "#16a34a",
    "Persediaan Bursa": "#ea580c",
    "Cadang": "#dc2626",
    "Pre Memory": "#1d4ed8",
    "ATTB": "#d97706",
    "Non-Stock": "#be185d",
    "Bongkaran": "#6b7280",
  };
  return map[jenisBarang] || "#9ca3af";
}

// Builds the Kartu Gantung Digital (TUG-2) history for one Master Katalog item,
// pulling from every APPROVED transaction across all locations that touched it.
// Each row carries a running balance (sisa) computed in chronological order.
//
// Resolution notes:
// - TUG9/TUG8 items store stockId (a Data Stok row); we resolve katalogId via `stocks`.
// - TUG10/TUG3 items reference katalogId directly when katalogMode==="existing".
//   For katalogMode==="new" items, the transaction itself doesn't retain the
//   auto-created katalogId, so we match by name against the current katalogList entry instead.
function buildKartuGantungHistory(katalog, txns, stocks, lokasiList) {
  const katalogId = katalog.id;
  const events = [];
  (txns||[]).forEach(t => {
    if (t.status !== "APPROVED" && !(t.docType==="TUG3" && t.stage==="APPROVED")) return;
    if (t.docType === "TUG9" || t.docType === "TUG8") {
      t.stockItems.forEach(si => {
        const stockRow = (stocks||[]).find(s=>s.id===si.stockId);
        if (stockRow && stockRow.katalogId === katalogId) {
          const lok = (lokasiList||[]).find(l=>l.id===stockRow.lokasiId);
          events.push({ tgl: t.approvedAt||t.createdAt, noBon: t.docNumbers?.[t.docType==="TUG9"?"tug9":"tug8"], masuk:0, keluar:si.qty, lokasi: lok?.kode||"-", catatan: t.namaPekerjaan||"-" });
        }
      });
    } else if (t.docType === "TUG10") {
      t.stockItems.forEach(si => {
        const isMatch = si.katalogMode==="existing" ? si.katalogId===katalogId : si.namaBaru===katalog.name;
        if (isMatch) {
          const lok = (lokasiList||[]).find(l=>l.id===t.lokasiTujuanId);
          events.push({ tgl: t.approvedAt||t.createdAt, noBon: t.docNumbers?.tug10, masuk:si.qty, keluar:0, lokasi: lok?.kode||"-", catatan: t.namaPekerjaan||"-" });
        }
      });
    } else if (t.docType === "TUG3" && t.stage === "APPROVED") {
      t.stockItems.forEach(si => {
        const isMatch = si.katalogMode==="existing" ? si.katalogId===katalogId : si.namaBaru===katalog.name;
        if (isMatch) {
          const lok = (lokasiList||[]).find(l=>l.id===si.lokasiTujuanId);
          events.push({ tgl: t.approvedAtAsman||t.createdAt, noBon: t.docNumbers?.tug3, masuk:si.qty, keluar:0, lokasi: lok?.kode||"-", catatan: `Penerimaan dari ${t.dariSupplier||"-"}` });
        }
      });
    }
  });
  events.sort((a,b)=>(a.tgl||0)-(b.tgl||0));
  // Hitung Sisa MUNDUR dari qty stok nyata saat ini (ground truth dari Data Stok),
  // bukan maju dari 0 — supaya baris terbaru selalu pas dengan qty sebenarnya,
  // walau ada stok awal yang tidak tercatat lewat transaksi TUG.
  const currentQty = (stocks||[]).filter(s=>s.katalogId===katalogId).reduce((a,s)=>a+(s.qty||0),0);
  const withSisa = new Array(events.length);
  let running = currentQty;
  for (let i = events.length-1; i >= 0; i--) {
    withSisa[i] = { ...events[i], sisa: running };
    running -= (events[i].masuk - events[i].keluar);
  }
  return withSisa;
}

// ─── SEARCHABLE SELECT (combobox) ────────────────────────────────────
// Ganti <select> raksasa (semua barang/material dijejer dalam 1 dropdown
// panjang) dengan field cari + daftar hasil yang bisa disaring sambil
// mengetik — dipakai di semua form TUG saat memilih barang/material.
function SearchableSelect({ options, value, onChange, getLabel, getSearchText, renderOption, placeholder="-- Cari & pilih barang --", sty, C, emptyText="Tidak ada barang yang cocok" }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  const selected = options.find(o=>o.id===value);

  useEffect(() => {
    function onDocClick(e) { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const q = query.trim().toLowerCase();
  const filtered = q
    ? options.filter(o => (getSearchText?getSearchText(o):getLabel(o)).toLowerCase().includes(q))
    : options;

  return (
    <div ref={wrapRef} style={{position:"relative"}}>
      <input
        style={sty.input}
        placeholder={placeholder}
        value={open ? query : (selected ? getLabel(selected) : "")}
        onFocus={()=>{setOpen(true); setQuery("");}}
        onChange={e=>{setQuery(e.target.value); setOpen(true);}}
      />
      {open && (
        <div style={{position:"absolute",zIndex:50,top:"100%",left:0,right:0,background:"white",border:`1px solid ${C.border}`,borderRadius:8,marginTop:2,maxHeight:260,overflowY:"auto",boxShadow:"0 8px 24px rgba(0,0,0,0.15)"}}>
          {value && (
            <div onClick={()=>{onChange("");setOpen(false);setQuery("");}} style={{padding:"8px 10px",fontSize:11,color:C.muted,cursor:"pointer",borderBottom:`1px solid ${C.border}`}}>✕ Kosongkan pilihan</div>
          )}
          {filtered.length===0 && <div style={{padding:"12px 10px",fontSize:12,color:C.muted,textAlign:"center"}}>{emptyText}</div>}
          {filtered.slice(0,50).map(o=>(
            <div key={o.id} onClick={()=>{onChange(o.id);setOpen(false);setQuery("");}}
              style={{padding:"8px 10px",fontSize:12,cursor:"pointer",background:o.id===value?"#eff6ff":"white",borderBottom:`1px solid #f1f5f9`}}>
              {renderOption?renderOption(o):getLabel(o)}
            </div>
          ))}
          {filtered.length>50 && <div style={{padding:"6px 10px",fontSize:10,color:C.muted,textAlign:"center"}}>+{filtered.length-50} lainnya — ketik lebih spesifik untuk menyaring</div>}
        </div>
      )}
    </div>
  );
}

// ─── SPARKLINE ───────────────────────────────────────────────────────
function Sparkline({ data, color="#3b82f6", h=36, w=100 }) {
  if (!data || data.length<2) return <svg width={w} height={h}><line x1="0" y1={h/2} x2={w} y2={h/2} stroke={color} strokeOpacity="0.3" strokeWidth="1.5" strokeDasharray="4"/></svg>;
  const max=Math.max(...data,1), min=Math.min(...data,0), range=max-min||1;
  const pts = data.map((v,i)=>`${(i/(data.length-1))*w},${h-((v-min)/range)*(h-4)-2}`).join(" ");
  return <svg width={w} height={h}><polyline fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" points={pts}/></svg>;
}

// ─── FORECAST ────────────────────────────────────────────────────────
function computeForecast(stockId, txns, stock) {
  const outTxns = txns.filter(t=>t.stockItems?.some(si=>si.stockId===stockId) && t.docType==="TUG9" && t.status==="APPROVED");
  if (!outTxns.length) return { dailyAvg:0, daysLeft:999, suggestBuy:0, trend:[], confidence:"low" };
  const DAY=86400000, nowT=Date.now();
  const daily = {};
  outTxns.forEach(t=>{
    const item = t.stockItems.find(si=>si.stockId===stockId);
    const d = Math.floor(t.createdAt/DAY);
    daily[d] = (daily[d]||0) + (item?.qty||0);
  });
  const vals = Object.values(daily);
  const dailyAvg = vals.reduce((a,b)=>a+b,0)/vals.length;
  const daysLeft = dailyAvg>0 ? Math.floor(stock.qty/dailyAvg) : 999;
  const suggestBuy = Math.max(0, Math.ceil(dailyAvg*30)-stock.qty);
  const trend = Array.from({length:7},(_,i)=>{ const d=Math.floor((nowT-(6-i)*DAY)/DAY); return daily[d]||0; });
  const confidence = vals.length>=7?"high":vals.length>=3?"medium":"low";
  return { dailyAvg:dailyAvg.toFixed(2), daysLeft, suggestBuy, trend, confidence };
}

// ─── TUG-9 DOCUMENT HTML BUILDER (Surat Jalan + Bon TUG-9 + Lampiran Foto) ────
// Returns a full standalone HTML string. Used for both in-app preview
// (rendered in an iframe inside a modal) and for downloading as a
// .html file the user can open in any browser and Print > Save as PDF.
function buildTUG9HTML(txn, stocks, users, satpamList) {
  const docs = txn.docNumbers;
  const isTUG8 = txn.docType === "TUG8";
  const docKey = isTUG8 ? "tug8" : "tug9";
  const creator = users.find(u=>u.id===txn.createdBy) || {};
  const actualApprover = users.find(u=>u.id===txn.approvedBy) || {};
  // "Mengetahui" on the Bon Pemakaian is ALWAYS Asman Konstruksi, per baku format.
  // Whether Asman approved it directly or it was auto-approved alongside TL's
  // approval, the on-file Asman Konstruksi user always signs this slot.
  const asmanUser = users.find(u => u.role === "ASMAN") || {};
  // "Yang Menyerahkan" is always TL Logistik (whoever holds that role / actually approved if TL)
  const menyerahkanUser = txn.requiredApprover === "TL" ? actualApprover : (users.find(u=>u.role==="TL")||{});
  const satpamUser = (satpamList||[]).find(sp => sp.id === txn.satpamId) || {};
  const itemRows = txn.stockItems.map(si => {
    const stock = stocks.find(s=>s.id===si.stockId) || {};
    return { stock, qty: si.qty };
  });

  const materialRowsSJ = itemRows.map(({stock,qty}) => `
    <tr><td>${stock.name||""}</td><td>${stock.lokasi||""}</td><td style="text-align:center">${fmtNum(qty)}</td><td style="text-align:center">${stock.unit||""}</td><td>${stock.jenisBarang==="Non-Stock"?"(NON-STOCK) ":""}${txn.keteranganBarang||""}</td></tr>`).join("");

  const materialRowsTUG9 = itemRows.map(({stock,qty}) => `
    <tr><td style="text-align:center">${fmtNum(qty)}</td><td style="text-align:center">${stock.unit||""}</td><td>${stock.name||""}</td><td style="text-align:center">${stock.katalog||"-"}</td><td>${stock.jenisBarang==="Non-Stock"?"(NON-STOCK) ":""}${txn.keteranganBarang||""}</td></tr>`).join("");

  // ── Lampiran Foto: build photo rows (2 columns: Kendaraan/SIM-KTP, then Surat, then per-material) ──
  const hasAnyAttachment = txn.fotoKendaraan || txn.fotoSimKtp || txn.fotoSuratPengembalian || (txn.fotoMaterial && txn.fotoMaterial.length > 0);
  function photoCell(label, src) {
    return `<div class="photo-cell"><div class="photo-label">${label}</div>${src ? `<img src="${src}" alt="${label}"/>` : `<div class="photo-empty">Tidak ada foto</div>`}</div>`;
  }
  const materialPhotoCells = itemRows.map(({stock}) => {
    const photo = (txn.fotoMaterial||[]).find(fm => fm.stockId === stock.id);
    return photoCell(stock.name || "-", photo?.img);
  }).join("");

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${isTUG8?"TUG-8":"TUG-9"} ${txn.id}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:Arial,sans-serif;font-size:10.5px;color:#111;background:#e5e7eb}
.page{padding:28px;page-break-after:always;min-height:100vh;background:white;max-width:794px;margin:0 auto 16px}
.page:last-child{page-break-after:auto;margin-bottom:0}
.topbar{height:6px;background:linear-gradient(90deg,#00377a,#0098da);margin-bottom:4px}
.head{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:14px}
.head h1{font-size:13px;font-weight:800;letter-spacing:.3px}
.head .sub{font-size:9px;color:#555}
.logobox{display:flex;align-items:center;gap:6px}
.logo{height:38px;width:auto;display:block;object-fit:contain}
.doctitle{text-align:center;margin-bottom:4px}
.doctitle h2{font-size:14px;font-weight:800;letter-spacing:.5px}
.doctitle .docno{font-size:10px;font-style:italic;color:#0098da;font-weight:700}
table.meta{width:100%;margin-bottom:10px;font-size:10.5px}
table.meta td{padding:2px 4px;vertical-align:top}
table.meta td.label{width:140px;color:#333}
table.meta td.colon{width:10px}
table.items{width:100%;border-collapse:collapse;margin-bottom:10px}
table.items th{background:#003087;color:white;padding:6px 6px;font-size:9.5px;text-align:left}
table.items td{padding:6px 6px;border-bottom:1px solid #ddd;font-size:10px}
.sig-row{display:flex;justify-content:space-between;margin-top:18px;text-align:center}
.sig-col{flex:1;font-size:10px}
.sig-space{height:50px}
.sig-name{font-weight:700;text-decoration:underline;margin-top:2px}
.note{font-size:9.5px;font-style:italic;margin-bottom:10px}
.status-stamp{display:inline-block;border:2px solid #16a34a;color:#16a34a;font-weight:800;padding:4px 14px;border-radius:6px;font-size:11px;transform:rotate(-8deg);margin-bottom:8px}
.print-bar{position:sticky;top:0;background:#003087;color:white;padding:10px 16px;text-align:center;font-size:13px;font-weight:700;z-index:10}
.print-bar button{background:#16a34a;color:white;border:none;border-radius:6px;padding:8px 18px;font-size:13px;font-weight:700;cursor:pointer;margin-left:10px}
.photo-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px}
.photo-cell{border:1px solid #ccc;border-radius:6px;overflow:hidden}
.photo-label{background:#f1f5f9;padding:6px 10px;font-size:10px;font-weight:700;border-bottom:1px solid #ccc}
.photo-cell img{width:100%;height:160px;object-fit:cover;display:block}
.photo-empty{height:160px;display:flex;align-items:center;justify-content:center;color:#9ca3af;font-size:10px;font-style:italic;background:#fafafa}
.section-heading{font-weight:800;font-size:11.5px;margin:14px 0 8px;color:#003087}
@media print{.print-bar{display:none}.page{box-shadow:none;margin:0;max-width:none}body{background:white}}
</style></head><body>

<div class="print-bar">📄 Dokumen TUG-9 siap dicetak &nbsp; <button onclick="window.print()">🖨️ Print / Save as PDF</button></div>

<!-- ════════ PAGE 1: SURAT JALAN ════════ -->
<div class="page">
  <div class="topbar"></div>
  <div class="head">
    <div><h1>${UIT}</h1><div class="sub">Unit Pelaksana Transmisi Surabaya</div></div>
    <div class="logobox"><img class="logo" src="${PLN_LOGO_DATA_URI}" alt="Logo PLN"/></div>
  </div>
  <div class="doctitle"><h2>SURAT JALAN PENGAMBILAN MATERIAL</h2><div class="docno">${docs.sj}</div></div>

  <table class="meta">
    <tr><td class="label">Dibawa Ke</td><td class="colon">:</td><td>${txn.lokasiPekerjaan}</td><td class="label" style="width:120px">Kendaraan / Nopol</td><td class="colon">:</td><td>${txn.nopol||"-"}</td></tr>
    <tr><td class="label">Tanggal Pengambilan</td><td class="colon">:</td><td>${fmtDateOnly(txn.createdAt)}</td><td class="label">No SIM / KTP Pengemudi</td><td class="colon">:</td><td>${txn.simKtp||"-"}</td></tr>
    <tr><td class="label">PIC Gudang ${UPT}</td><td class="colon">:</td><td colspan="3">${creator.name||"-"}</td></tr>
  </table>

  <table class="items">
    <thead><tr><th>Material</th><th>Gudang</th><th>Jumlah</th><th>Satuan</th><th>Keterangan</th></tr></thead>
    <tbody>${materialRowsSJ}</tbody>
  </table>

  <div class="note">Demikian Surat Jalan ini kami buat agar dipergunakan sebagaimana mestinya</div>

  <div class="sig-row">
    <div class="sig-col">Transporter,<div class="sig-space"></div><div class="sig-name">${txn.namaPengemudi||"....................."}</div></div>
    <div class="sig-col">Mengetahui,<br>SATPAM ${WAREHOUSE.toUpperCase()}<div class="sig-space"></div><div class="sig-name">${satpamUser.name||"....................."}</div></div>
    <div class="sig-col">Yang menyerahkan,<br>ADMINISTRASI GUDANG<div class="sig-space"></div><div class="sig-name">${creator.name||"....................."}</div></div>
  </div>
</div>

<!-- ════════ PAGE 2: BON PEMAKAIAN TUG-9 ════════ -->
<div class="page">
  <div class="topbar"></div>
  <div class="head">
    <div></div>
    <div class="logobox"><img class="logo" src="${PLN_LOGO_DATA_URI}" alt="Logo PLN"/></div>
  </div>
  <div style="text-align:right;font-weight:800;font-size:13px;margin-bottom:6px">${isTUG8 ? "TUG 8" : "TUG 9"}</div>
  <div class="doctitle"><h2>BON PEMAKAIAN</h2><div class="docno">${docs[docKey]}</div></div>

  ${txn.status==="APPROVED" ? `<div style="text-align:center"><span class="status-stamp">✓ DISETUJUI</span></div>` : ""}

  <table class="meta" style="border:1px solid #ccc;border-radius:4px;padding:6px;margin-bottom:10px">
    <tr><td colspan="6" style="font-weight:700;text-align:center;border-bottom:1px solid #ccc;padding-bottom:4px">${COMPANY.toUpperCase()} UNIT INDUK TRANSMISI JAWA BAGIAN TIMUR DAN BALI</td></tr>
    <tr><td class="label">PEKERJAAN</td><td class="colon">:</td><td colspan="2">${txn.pekerjaan}</td><td class="label" style="width:90px">UNIT/SEKTOR</td><td>: ${isTUG8 ? (txn.unitTujuan||"-") : UPT}</td></tr>
    <tr><td class="label">NAMA PEKERJAAN</td><td class="colon">:</td><td colspan="2">${txn.namaPekerjaan}</td><td class="label">SURAT/NODIN</td><td>: ${txn.noNodin||"-"}</td></tr>
    <tr><td class="label">LOKASI PEKERJAAN</td><td class="colon">:</td><td colspan="2">${txn.lokasiPekerjaan}</td><td class="label">TANGGAL</td><td>: ${fmtDateOnly(txn.createdAt)}</td></tr>
  </table>

  <table class="items">
    <thead><tr><th>Banyaknya</th><th>Satuan</th><th>Nama Barang / Spare Parts</th><th>Nomor Katalog</th><th>Keterangan</th></tr></thead>
    <tbody>${materialRowsTUG9}</tbody>
  </table>

  <table class="meta" style="border:1px solid #ccc;border-radius:4px;padding:6px;margin-bottom:10px">
    <tr><td class="label" style="width:160px">Perkiraan Pembebanan</td><td class="colon">:</td><td>${txn.perkiraanPembebanan||"-"}</td></tr>
    <tr><td class="label">Kode Perkiraan</td><td class="colon">:</td><td>${txn.kodePerkiraan||"-"}</td></tr>
    <tr><td class="label">Tanggal</td><td class="colon">:</td><td>${fmtDateOnly(txn.approvedAt||Date.now())}</td></tr>
  </table>

  <div class="sig-row">
    <div class="sig-col">Yang Menerima,<br>${txn.penerimaUnit||"-"}<div class="sig-space"></div><div class="sig-name">${txn.penerimaNama||"....................."}</div></div>
    <div class="sig-col">Mengetahui,<br>${asmanUser.jabatan||"ASMAN KONSTRUKSI " + UPT}<div class="sig-space"></div><div class="sig-name">${asmanUser.name||"....................."}</div></div>
    <div class="sig-col">Yang Menyerahkan,<br>${menyerahkanUser.jabatan||"TL LOGISTIK " + UPT}<div class="sig-space"></div><div class="sig-name">${menyerahkanUser.name||"....................."}</div></div>
  </div>
  ${txn.requiredApprover==="TL" ? `<div style="font-size:9px;color:#16a34a;text-align:center;margin-top:6px;font-style:italic">* Disetujui oleh TL Logistik, Asman Konstruksi turut menyetujui sesuai ketentuan internal</div>` : ""}
</div>

${hasAnyAttachment ? `
<!-- ════════ PAGE 3: LAMPIRAN FOTO ════════ -->
<div class="page">
  <div class="topbar"></div>
  <div class="head">
    <div><h1>${UIT}</h1><div class="sub">Unit Pelaksana Transmisi Surabaya</div></div>
    <div class="logobox"><img class="logo" src="${PLN_LOGO_DATA_URI}" alt="Logo PLN"/></div>
  </div>
  <div class="doctitle"><h2>LAMPIRAN FOTO</h2><div class="docno">${docs[docKey]}</div></div>

  <div class="section-heading">Foto Kendaraan &amp; SIM / KTP Pengemudi</div>
  <div class="photo-grid">
    ${photoCell("Foto Kendaraan", txn.fotoKendaraan)}
    ${photoCell("SIM / KTP Pengemudi", txn.fotoSimKtp)}
  </div>

  ${txn.fotoSuratPengembalian ? `
  <div class="section-heading">Surat Permintaan / Pengembalian</div>
  <div class="photo-grid">
    ${photoCell("Surat Permintaan / Pengembalian", txn.fotoSuratPengembalian)}
  </div>` : ""}

  ${itemRows.length > 0 ? `
  <div class="section-heading">Foto Material</div>
  <div class="photo-grid">
    ${materialPhotoCells}
  </div>` : ""}
</div>` : ""}

</body></html>`;
}

// Triggers a real browser download of the HTML document (works without
// any external CDN and without window.open — uses a Blob + <a download>).
// ─── TUG-10 DOCUMENT HTML BUILDER (Bon Pengembalian) ──────────────────
// Single-page document matching the uploaded format_TUG_10.pdf layout.
// Signature roles are reversed vs TUG-9: external party hands material
// back, internal SPV/TL Log receives it, Asman still signs "Mengetahui".
function buildTUG10HTML(txn, katalogList, lokasiList, users) {
  const docs = txn.docNumbers;
  const asmanUser = users.find(u => u.role === "ASMAN") || {};
  const actualApprover = users.find(u=>u.id===txn.approvedBy) || {};
  // "Yang Menerima" is internal SPV/TL Log (whoever holds that role / actually approved if TL)
  const penerimaUser = txn.requiredApprover === "TL" ? actualApprover : (users.find(u=>u.role==="TL")||{});
  const lokTujuan = (lokasiList||[]).find(l => l.id === txn.lokasiTujuanId) || {};

  const itemRows = txn.stockItems.map(si => {
    const namaBarang = si.katalogMode==="existing" ? ((katalogList||[]).find(k=>k.id===si.katalogId)?.name||"-") : si.namaBaru;
    const satuan = si.katalogMode==="existing" ? ((katalogList||[]).find(k=>k.id===si.katalogId)?.satuan||"-") : (si.satuanBaru||"-");
    const ketStatus = si.statusMaterial==="Bongkaran ATTB (MTU)" ? `EKS BONGKARAN ATTB/MTU${si.noSeri?` — SN: ${si.noSeri}`:""}` : si.statusMaterial==="Bongkaran" ? "EKS BONGKARAN" : "MATERIAL SISA BARU";
    return `<tr><td>${namaBarang}</td><td style="text-align:center">${fmtNum(si.qty)}</td><td style="text-align:center">${satuan}</td><td style="text-align:center">${si.noAsset||"-"}</td><td>${ketStatus}</td></tr>`;
  }).join("");

  const hasAttachments = txn.fotoBAPengembalian || txn.stockItems.some(si=>si.fotoNameplate||si.fotoBarangRetur);
  // Note: with foto barang now mandatory for every item, hasAttachments will
  // almost always be true for transactions created after this fix.
  function photoCell(label, src) {
    return `<div class="photo-cell"><div class="photo-label">${label}</div>${src ? `<img src="${src}" alt="${label}"/>` : `<div class="photo-empty">Tidak ada foto</div>`}</div>`;
  }
  const materialPhotoCells = txn.stockItems.map(si => {
    const namaBarang = si.katalogMode==="existing" ? ((katalogList||[]).find(k=>k.id===si.katalogId)?.name||"-") : si.namaBaru;
    const cells = [photoCell(`${namaBarang} — Foto Barang (${si.statusMaterial})`, si.fotoBarangRetur)];
    if (si.statusMaterial === "Bongkaran ATTB (MTU)") cells.push(photoCell(`${namaBarang} — Nameplate`, si.fotoNameplate));
    return cells.join("");
  }).join("");

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>TUG-10 ${txn.id}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:Arial,sans-serif;font-size:10.5px;color:#111;background:#e5e7eb}
.page{padding:28px;page-break-after:always;min-height:100vh;background:white;max-width:794px;margin:0 auto 16px}
.page:last-child{page-break-after:auto;margin-bottom:0}
.topbar{height:6px;background:linear-gradient(90deg,#00377a,#0098da);margin-bottom:4px}
.head{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:14px}
.head h1{font-size:13px;font-weight:800;letter-spacing:.3px}
.head .sub{font-size:9px;color:#555}
.logobox{display:flex;align-items:center;gap:6px}
.logo{height:38px;width:auto;display:block;object-fit:contain}
.doctitle{text-align:center;margin-bottom:4px}
.doctitle h2{font-size:14px;font-weight:800;letter-spacing:.5px}
.doctitle .docno{font-size:10px;font-style:italic;color:#0098da;font-weight:700}
table.meta{width:100%;margin-bottom:10px;font-size:10.5px}
table.meta td{padding:2px 4px;vertical-align:top}
table.meta td.label{width:140px;color:#333}
table.meta td.colon{width:10px}
table.items{width:100%;border-collapse:collapse;margin-bottom:10px}
table.items th{background:#003087;color:white;padding:6px 6px;font-size:9.5px;text-align:left}
table.items td{padding:6px 6px;border-bottom:1px solid #ddd;font-size:10px}
.sig-row{display:flex;justify-content:space-between;margin-top:18px;text-align:center}
.sig-col{flex:1;font-size:10px}
.sig-space{height:50px}
.sig-name{font-weight:700;text-decoration:underline;margin-top:2px}
.status-stamp{display:inline-block;border:2px solid #16a34a;color:#16a34a;font-weight:800;padding:4px 14px;border-radius:6px;font-size:11px;transform:rotate(-8deg);margin-bottom:8px}
.print-bar{position:sticky;top:0;background:#003087;color:white;padding:10px 16px;text-align:center;font-size:13px;font-weight:700;z-index:10}
.print-bar button{background:#16a34a;color:white;border:none;border-radius:6px;padding:8px 18px;font-size:13px;font-weight:700;cursor:pointer;margin-left:10px}
.photo-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px}
.photo-cell{border:1px solid #ccc;border-radius:6px;overflow:hidden}
.photo-label{background:#f1f5f9;padding:6px 10px;font-size:10px;font-weight:700;border-bottom:1px solid #ccc}
.photo-cell img{width:100%;height:160px;object-fit:cover;display:block}
.photo-empty{height:160px;display:flex;align-items:center;justify-content:center;color:#9ca3af;font-size:10px;font-style:italic;background:#fafafa}
.section-heading{font-weight:800;font-size:11.5px;margin:14px 0 8px;color:#003087}
@media print{.print-bar{display:none}.page{box-shadow:none;margin:0;max-width:none}body{background:white}}
</style></head><body>

<div class="print-bar">📄 Dokumen TUG-10 siap dicetak &nbsp; <button onclick="window.print()">🖨️ Print / Save as PDF</button></div>

<!-- ════════ PAGE 1: BON PENGEMBALIAN ════════ -->
<div class="page">
  <div class="topbar"></div>
  <div class="head">
    <div></div>
    <div class="logobox"><img class="logo" src="${PLN_LOGO_DATA_URI}" alt="Logo PLN"/></div>
  </div>
  <div style="text-align:right;font-weight:800;font-size:13px;margin-bottom:6px">TUG 10<br/><span style="font-size:9px;font-weight:400">2. Untuk Fungsi Gudang</span></div>
  <div class="doctitle"><h2>BON PENGEMBALIAN</h2><div class="docno">${docs.tug10}</div></div>

  ${txn.status==="APPROVED" ? `<div style="text-align:center"><span class="status-stamp">✓ DISETUJUI</span></div>` : ""}

  <table class="meta" style="border:1px solid #ccc;border-radius:4px;padding:6px;margin-bottom:10px">
    <tr><td colspan="6" style="font-weight:700;text-align:center;border-bottom:1px solid #ccc;padding-bottom:4px">${COMPANY.toUpperCase()} UNIT INDUK TRANSMISI JAWA BAGIAN TIMUR DAN BALI</td></tr>
    <tr><td class="label">PEKERJAAN</td><td class="colon">:</td><td colspan="2">${txn.pekerjaan||"-"}</td><td class="label" style="width:100px">UNIT/SEKTOR</td><td>: ${UPT}</td></tr>
    <tr><td class="label">NAMA PEKERJAAN</td><td class="colon">:</td><td colspan="2">${txn.namaPekerjaan}</td><td class="label">NO BA PENGGANTIAN</td><td>: ${txn.noBAPenggantian||"-"}</td></tr>
    <tr><td class="label">LOKASI PEKERJAAN</td><td class="colon">:</td><td colspan="2">${txn.lokasiPekerjaan}</td><td class="label">TANGGAL</td><td>: ${fmtDateOnly(txn.createdAt)}</td></tr>
  </table>

  <table class="items">
    <thead><tr><th>Nama Barang / Spare Parts</th><th>Jumlah</th><th>Satuan</th><th>Nomor Asset</th><th>Keterangan</th></tr></thead>
    <tbody>${itemRows}</tbody>
  </table>

  <table class="meta" style="border:1px solid #ccc;border-radius:4px;padding:6px;margin-bottom:10px">
    <tr><td class="label" style="width:160px">Perkiraan Pembebanan</td><td class="colon">:</td><td>${txn.perkiraanPembebanan||"-"}</td></tr>
    <tr><td class="label">Kode Perkiraan</td><td class="colon">:</td><td>${txn.kodePerkiraan||"-"}</td></tr>
    <tr><td class="label">Disimpan di Lokasi</td><td class="colon">:</td><td>${lokTujuan.kode||"-"}</td></tr>
    <tr><td class="label">Tanggal</td><td class="colon">:</td><td>${fmtDateOnly(txn.approvedAt||Date.now())}</td></tr>
  </table>

  <div class="sig-row">
    <div class="sig-col">Mengetahui,<br>${asmanUser.jabatan||"ASMAN KONS UPT " + UPT}<div class="sig-space"></div><div class="sig-name">${asmanUser.name||"....................."}</div></div>
    <div class="sig-col">Yang Menerima,<br>${penerimaUser.jabatan||"SPV LOG UPT " + UPT}<div class="sig-space"></div><div class="sig-name">${penerimaUser.name||"....................."}</div></div>
    <div class="sig-col">Yang Menyerahkan<div class="sig-space"></div><div class="sig-name">${txn.menyerahkanNama||"....................."}</div></div>
  </div>
  ${txn.requiredApprover==="TL" ? `<div style="font-size:9px;color:#16a34a;text-align:center;margin-top:6px;font-style:italic">* Disetujui oleh TL Logistik, Asman Konstruksi turut menyetujui sesuai ketentuan internal</div>` : ""}
</div>

${hasAttachments ? `
<!-- ════════ PAGE 2: LAMPIRAN FOTO & SURAT BA ════════ -->
<div class="page">
  <div class="topbar"></div>
  <div class="head">
    <div><h1>${UIT}</h1><div class="sub">Unit Pelaksana Transmisi Surabaya</div></div>
    <div class="logobox"><img class="logo" src="${PLN_LOGO_DATA_URI}" alt="Logo PLN"/></div>
  </div>
  <div class="doctitle"><h2>LAMPIRAN — MATERIAL BEKAS/ATTB</h2><div class="docno">${docs.tug10}</div></div>

  ${txn.fotoBAPengembalian ? `
  <div class="section-heading">Surat BA Pengembalian</div>
  <div class="photo-grid">${photoCell("Surat BA Pengembalian", txn.fotoBAPengembalian)}</div>` : ""}

  ${materialPhotoCells ? `
  <div class="section-heading">Foto Barang &amp; Nameplate per Material</div>
  <div class="photo-grid">${materialPhotoCells}</div>` : ""}
</div>` : ""}

</body></html>`;
}

function downloadTUG10HTML(txn, katalogList, lokasiList, users, showToast) {
  const html = buildTUG10HTML(txn, katalogList, lokasiList, users);
  const blob = new Blob([html], { type: "text/html" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `TUG10_${txn.docSeq}_${txn.namaPekerjaan.replace(/[^a-zA-Z0-9]/g,"_").slice(0,30)}.html`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  showToast && showToast("📄 File diunduh! Buka di browser HP/laptop, lalu Print > Save as PDF.", "success");
}

// ─── TUG-3 / TUG-4 DOCUMENT HTML BUILDER ───────────────────────────────
// Combines all 3 stages into one printable document: TUG-3 Karantina (page 1),
// TUG-4 Berita Acara Pemeriksaan (page 2), and Lampiran Foto Final (page 3+).
// ─── TUG-5 DOCUMENT BUILDER ─────────────────────────────────────────────
function buildTUG5HTML(txn, katalogList, uitList, users, ultgList) {
  const docs = txn.docNumbers;
  const isUltg = txn.sourceType === "ULTG";

  if (isUltg) return buildTUG5ULTGHTML(txn, katalogList, users, ultgList);

  const managerUser = users.find(u=>u.role==="MANAGER")||{};
  const asmanUser = users.find(u=>u.role==="ASMAN")||{};
  const uit = (uitList||[]).find(u=>u.id===txn.uitId)||{};
  const tanggal = fmtDateOnly(txn.approvedAtManager||txn.createdAt);

  const itemRows = (txn.stockItems||[]).map((si,idx)=>{
    const kat = (katalogList||[]).find(k=>k.id===si.katalogId)||{};
    return `<tr>
      <td>${kat.name||"-"}</td>
      <td style="text-align:center">${kat.katalog||"-"}</td>
      <td style="text-align:center">${kat.satuan||"-"}</td>
      <td style="text-align:center">${fmtNum(si.pemakaianBulan||0)}</td>
      <td style="text-align:center">${fmtNum(si.sisaPersediaan||0)}</td>
      <td style="text-align:center">${fmtNum(si.permintaan||0)}</td>
      <td style="text-align:center"></td><td style="text-align:center"></td><td></td>
      <td>${si.keterangan||""}</td>
    </tr>`;
  }).join("");

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>TUG-5 ${txn.id}</title>
<style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:Arial,sans-serif;font-size:10px;color:#111;background:#e5e7eb}.page{padding:24px;background:white;max-width:1000px;margin:0 auto 16px;min-height:100vh}.topbar{height:5px;background:linear-gradient(90deg,#00377a,#0098da);margin-bottom:4px}.doctitle{text-align:center;margin-bottom:10px}.doctitle h2{font-size:13px;font-weight:800;text-decoration:underline}.doctitle .docno{font-size:10px;font-style:italic;color:#0098da}table.meta{width:100%;margin-bottom:10px}table.meta td{padding:2px 3px;font-size:10px}table.meta td.label{width:90px}table.meta td.colon{width:8px}table.items{width:100%;border-collapse:collapse;margin-bottom:10px}table.items th{background:#003087;color:white;padding:5px 5px;font-size:9px;text-align:center;border:1px solid #ccc}table.items td{padding:5px 5px;border:1px solid #ccc;font-size:9.5px}.sig-row{display:flex;justify-content:space-around;margin-top:20px;text-align:center}.sig-col{flex:1;font-size:10px}.sig-space{height:50px}.sig-name{font-weight:700;text-decoration:underline;margin-top:2px}.print-bar{position:sticky;top:0;background:#003087;color:white;padding:8px 14px;text-align:center;font-size:12px;font-weight:700;z-index:10}.print-bar button{background:#16a34a;color:white;border:none;border-radius:6px;padding:6px 16px;font-size:12px;cursor:pointer;margin-left:10px}@media print{.print-bar{display:none}body{background:white}}</style></head><body>
<div class="print-bar">📄 TUG-5 siap cetak <button onclick="window.print()">🖨️ Print / Save as PDF</button></div>
<div class="page">
<div class="topbar"></div>
<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px">
  <div><b>PT PLN (PERSERO)</b><br/>${UIT}</div>
  <div style="font-weight:800;font-size:14px">TUG - 5</div>
</div>
<div class="doctitle"><h2>DAFTAR PERMINTAAN BARANG - BARANG</h2><div class="docno">${docs?.tug5||txn.id}</div></div>
<table class="meta" style="border:1px solid #ccc;padding:6px;border-radius:4px;margin-bottom:10px">
  <tr>
    <td class="label">Kepada</td><td class="colon">:</td>
    <td colspan="3">${uit.nama||"-"}</td>
    <td style="width:60px"><b>PLN</b></td><td>: ${uit.kode||"UIT-JBM"}</td>
  </tr>
  <tr>
    <td class="label">Harap dikirim ke</td><td class="colon">:</td>
    <td colspan="3">PT PLN (PERSERO) ${UIT} - UPT SURABAYA</td>
    <td><b>UPT</b></td><td>: UPT SURABAYA</td>
  </tr>
  <tr>
    <td class="label">Alamat</td><td class="colon">:</td>
    <td colspan="5">JL. KETINTANG BARU NO. 9 SURABAYA KODE POS 60231</td>
  </tr>
</table>
<table class="items">
  <thead>
    <tr>
      <th rowspan="2" style="width:22%">Nama Barang<br/>(Ditulis Selengkap–lengkapnya)</th>
      <th rowspan="2">Nomor<br/>Normalisasi</th>
      <th rowspan="2">Satuan</th>
      <th rowspan="2">Pemakaian<br/>rata-rata<br/>per bulan</th>
      <th rowspan="2">Sisa<br/>Persediaan</th>
      <th rowspan="2">Permintaan</th>
      <th colspan="3">Diberikan</th>
      <th rowspan="2">Keterangan</th>
    </tr>
    <tr><th>Jumlah</th><th>DO Nomor</th><th>Tanggal</th></tr>
  </thead>
  <tbody>${itemRows}</tbody>
</table>
<table class="meta" style="border:1px solid #ccc;border-radius:4px;padding:6px;margin-bottom:10px">
  <tr><td class="label">Keterangan</td><td class="colon">:</td><td>${txn.keteranganUmum||"-"}</td></tr>
  <tr><td class="label">Perintah Kerja</td><td class="colon">:</td><td>${txn.perintahKerja||""}</td><td style="width:80px">Kode Perkiraan</td><td class="colon">:</td><td>${txn.kodePerkiraan||""}</td><td style="width:50px">Fungsi</td><td class="colon">:</td><td>${txn.fungsi||""}</td></tr>
</table>
<div style="text-align:right;font-size:10px;margin-bottom:14px">${tanggal}</div>
<div class="sig-row">
  <div class="sig-col"><b>MANAGER UPT SURABAYA</b><div class="sig-space"></div><div class="sig-name">${managerUser.name||"....................."}</div></div>
  <div class="sig-col"><b>ASMAN KONSTRUKSI</b><div class="sig-space"></div><div class="sig-name">${asmanUser.name||"....................."}</div></div>
</div>
</div></body></html>`;
}

// ─── TUG-5 (ULTG) DOCUMENT BUILDER — 1 penandatangan (Manager ULTG), tanda tangan
// digital otomatis terisi nama+waktu approve (bukan gambar, konsisten dengan
// seluruh dokumen TUG lain di app yang juga pakai nama teks, bukan gambar ttd).
function buildTUG5ULTGHTML(txn, katalogList, users, ultgList) {
  const docs = txn.docNumbers;
  const ultg = (ultgList||[]).find(u=>u.id===txn.ultgId)||{};
  const mgrUltgUser = users.find(u=>u.id===txn.approvedByMgrUltg) || users.find(u=>u.role==="MGR_ULTG" && u.ultgId===txn.ultgId) || {};
  const isApproved = !!txn.approvedByMgrUltg;
  const tanggalApprove = txn.approvedAtMgrUltg ? fmtDate(txn.approvedAtMgrUltg) : "";

  const itemRows = (txn.stockItems||[]).map((si)=>{
    const kat = (katalogList||[]).find(k=>k.id===si.katalogId)||{};
    return `<tr>
      <td>${kat.name||"-"}</td>
      <td style="text-align:center">${kat.katalog||"-"}</td>
      <td style="text-align:center">${kat.satuan||"-"}</td>
      <td style="text-align:center">${fmtNum(si.sisaPersediaan||0)}</td>
      <td style="text-align:center">${fmtNum(si.permintaan||0)}</td>
      <td>${si.keterangan||""}</td>
    </tr>`;
  }).join("");

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>TUG-5 ULTG ${txn.id}</title>
<style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:Arial,sans-serif;font-size:10px;color:#111;background:#e5e7eb}.page{padding:24px;background:white;max-width:1000px;margin:0 auto 16px;min-height:100vh}.topbar{height:5px;background:linear-gradient(90deg,#00377a,#0098da);margin-bottom:4px}.doctitle{text-align:center;margin-bottom:10px}.doctitle h2{font-size:13px;font-weight:800;text-decoration:underline}.doctitle .docno{font-size:10px;font-style:italic;color:#0098da}table.meta{width:100%;margin-bottom:10px}table.meta td{padding:3px 4px;font-size:10px}table.meta td.label{width:110px}table.meta td.colon{width:8px}table.items{width:100%;border-collapse:collapse;margin-bottom:10px}table.items th{background:#003087;color:white;padding:6px 6px;font-size:9.5px;text-align:center;border:1px solid #ccc}table.items td{padding:6px 6px;border:1px solid #ccc;font-size:10px}.sig-row{display:flex;justify-content:center;margin-top:24px;text-align:center}.sig-col{width:280px;font-size:10px}.sig-space{height:40px;display:flex;align-items:center;justify-content:center}.sig-name{font-weight:700;text-decoration:underline;margin-top:2px}.digital-stamp{border:2px solid #16a34a;color:#16a34a;border-radius:6px;padding:6px 10px;font-size:9px;font-weight:700;display:inline-block;transform:rotate(-4deg)}.print-bar{position:sticky;top:0;background:#003087;color:white;padding:8px 14px;text-align:center;font-size:12px;font-weight:700;z-index:10}.print-bar button{background:#16a34a;color:white;border:none;border-radius:6px;padding:6px 16px;font-size:12px;cursor:pointer;margin-left:10px}@media print{.print-bar{display:none}body{background:white}}</style></head><body>
<div class="print-bar">📄 TUG-5 ULTG siap cetak <button onclick="window.print()">🖨️ Print / Save as PDF</button></div>
<div class="page">
<div class="topbar"></div>
<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px">
  <div><b>PT PLN (PERSERO)</b><br/>${ultg.nama||"ULTG"}</div>
  <div style="font-weight:800;font-size:14px">TUG - 5</div>
</div>
<div class="doctitle"><h2>DAFTAR PERMINTAAN BARANG - BARANG (ULTG)</h2><div class="docno">${docs?.tug5||txn.id}</div></div>
<table class="meta" style="border:1px solid #ccc;padding:6px;border-radius:4px;margin-bottom:10px">
  <tr><td class="label">Diajukan oleh</td><td class="colon">:</td><td>${ultg.nama||"-"} (${ultg.kode||"-"})</td></tr>
  <tr><td class="label">Nama Pekerjaan</td><td class="colon">:</td><td>${txn.namaPekerjaan||"-"}</td></tr>
  <tr><td class="label">Lokasi Pekerjaan</td><td class="colon">:</td><td>${txn.lokasiPekerjaan||"-"}</td></tr>
</table>
<table class="items">
  <thead><tr>
    <th style="width:26%">Nama Barang</th>
    <th>Nomor Normalisasi</th>
    <th>Satuan</th>
    <th>Sisa Persediaan<br/>(Stok Aktual UPT)</th>
    <th>Jumlah Permintaan</th>
    <th>Keterangan</th>
  </tr></thead>
  <tbody>${itemRows}</tbody>
</table>
<div style="text-align:right;font-size:10px;margin-bottom:14px">${tanggalApprove||fmtDate(txn.createdAt)}</div>
<div class="sig-row">
  <div class="sig-col">
    <b>MANAGER ULTG${ultg.nama?" — "+ultg.nama.toUpperCase().replace(/^ULTG\s+/,""):""}</b>
    <div class="sig-space">${isApproved?`<div class="digital-stamp">✓ DISETUJUI SECARA DIGITAL<br/>${tanggalApprove}</div>`:""}</div>
    <div class="sig-name">${mgrUltgUser.name||"....................."}</div>
  </div>
</div>
</div></body></html>`;
}

// ─── TUG-7 DOCUMENT BUILDER ─────────────────────────────────────────────
function buildTUG7HTML(txn, katalogList, uitList, uptList, users) {
  const docs = txn.docNumbers;
  const mgrLogistikUser = users.find(u=>u.role==="MGR_LOGISTIK_UIT")||{};
  const uit = (uitList||[]).find(u=>u.id===txn.uitId)||{};
  const uptPengirim = (uptList||[]).find(u=>u.id===txn.uptPengirimId)||{};
  const tanggal = fmtDateOnly(txn.approvedAtMgrLogistik||txn.createdAt);

  const itemRows = (txn.stockItems||[]).map((si,idx)=>{
    const kat = (katalogList||[]).find(k=>k.id===si.katalogId)||{};
    return `<tr>
      <td style="text-align:center">${idx+1}</td>
      <td>${kat.name||"-"}</td>
      <td style="text-align:center">${kat.katalog||"-"}</td>
      <td style="text-align:center">${kat.satuan||"-"}</td>
      <td style="text-align:center">${fmtNum(si.qty||si.permintaan||0)}</td>
      <td style="text-align:right"></td>
      <td style="text-align:right"></td>
      <td>${si.keterangan||""}</td>
    </tr>`;
  }).join("");

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>TUG-7 ${txn.id}</title>
<style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:Arial,sans-serif;font-size:10.5px;color:#111;background:#e5e7eb}.page{padding:28px;background:white;max-width:850px;margin:0 auto 16px;min-height:100vh}table.meta{width:100%;margin-bottom:10px}table.meta td{padding:3px 4px;font-size:10.5px}table.meta td.label{width:100px}table.meta td.colon{width:10px}table.items{width:100%;border-collapse:collapse;margin-bottom:10px}table.items th{background:#003087;color:white;padding:6px 6px;font-size:10px;text-align:center;border:1px solid #ccc}table.items td{padding:6px 6px;border:1px solid #ccc;font-size:10px}.sig-row{display:flex;justify-content:flex-end;margin-top:20px;text-align:center}.sig-col{width:250px;font-size:10px}.sig-space{height:55px}.sig-name{font-weight:700;text-decoration:underline;margin-top:2px}.print-bar{position:sticky;top:0;background:#003087;color:white;padding:8px 14px;text-align:center;font-size:12px;font-weight:700;z-index:10}.print-bar button{background:#16a34a;color:white;border:none;border-radius:6px;padding:6px 16px;font-size:12px;cursor:pointer;margin-left:10px}@media print{.print-bar{display:none}body{background:white}}</style></head><body>
<div class="print-bar">📄 TUG-7 siap cetak <button onclick="window.print()">🖨️ Print / Save as PDF</button></div>
<div class="page">
<div style="display:flex;justify-content:space-between;margin-bottom:14px">
  <div><b>PT PLN (PERSERO)</b><br/>${uit.nama||UIT}</div>
  <div style="font-weight:800;font-size:14px">TUG 7</div>
</div>
<div style="text-align:right;margin-bottom:8px">${uptPengirim.alamat?uptPengirim.alamat+", ":""} ${tanggal}</div>
<div style="text-align:center;margin-bottom:12px">
  <div style="font-weight:800;font-size:13px;text-decoration:underline">PERINTAH PENYERAHAN BARANG</div>
  <div style="font-size:11px;color:#555">DELIVERY ORDER</div>
  <div style="font-size:10px;font-style:italic;color:#0098da;margin-top:2px">No. : ${docs?.tug7||txn.id}</div>
</div>
<table class="meta" style="border:1px solid #ccc;border-radius:4px;padding:8px;margin-bottom:14px">
  <tr><td class="label">Kepada</td><td class="colon">:</td><td>Gudang PLTD PT PLN (Persero) ${uptPengirim.nama||"-"}</td></tr>
  <tr><td class="label">Untuk</td><td class="colon">:</td><td>PT PLN (Persero) ${uit.kode||"UIT-JBM"} UPT ${txn.unitPenerima||"Surabaya"}</td></tr>
  <tr><td class="label">Berdasarkan</td><td class="colon">:</td><td>${txn.tug5DocNo||"-"}</td></tr>
  <tr><td class="label">Atas beban rekening</td><td class="colon">:</td><td>${txn.atasBebanRekening||"-"}</td></tr>
</table>
<p style="font-size:10px;margin-bottom:10px">Dengan penyerahan lembar asli dari pada Perintah penyerahan ini harap menyerahkan/mengirimkan dari persediaan gudang ke alamat tersebut diatas, barang-barang/Spare parts sbb :</p>
<table class="items">
  <thead><tr><th>No.<br/>Urut</th><th style="width:30%">Nama barang/Spare part</th><th>Nomor Norm./part</th><th>Stn.</th><th>Banyaknya</th><th colspan="2">Harga</th><th>Keterangan</th></tr>
  <tr style="background:#1a3a6b"><th></th><th></th><th></th><th></th><th></th><th style="color:white;font-size:9px">Stn.</th><th style="color:white;font-size:9px">Jumlah</th><th></th></tr></thead>
  <tbody>${itemRows}</tbody>
</table>
<table class="meta">
  <tr><td class="label">Perintah Kerja</td><td class="colon">:</td><td>${txn.perintahKerja||""}</td><td style="width:60px">Kode Akun</td><td class="colon">:</td><td>${txn.kodeAkun||""}</td><td style="width:50px">Fungsi</td><td class="colon">:</td><td>${txn.fungsi||""}</td></tr>
</table>
<div class="sig-row">
  <div class="sig-col">
    <b>MANAJER MANAJEMEN MATERIAL &amp; LOGISTIK</b>
    <div class="sig-space"></div>
    <div class="sig-name">${mgrLogistikUser.name||"....................."}</div>
  </div>
</div>
</div></body></html>`;
}

function downloadTUG5HTML(txn, katalogList, uitList, users, showToast, ultgList) {
  const html = buildTUG5HTML(txn, katalogList, uitList, users, ultgList);
  const blob = new Blob([html], {type:"text/html"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `TUG5_${txn.docSeq}_${(txn.keteranganUmum||"").replace(/[^a-zA-Z0-9]/g,"_").slice(0,25)}.html`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(()=>URL.revokeObjectURL(url),2000);
  showToast && showToast("📄 File diunduh! Buka di browser lalu Print → Save as PDF.", "success");
}

// ─── PEMINJAMAN ALAT BERAT DOCUMENT BUILDER ─────────────────────────────
function buildHeavyEquipmentLoanHTML(loan, equipment, users) {
  const ownerUpt = getHeavyEquipmentLoanOwnerUpt(loan);
  const requesterUpt = getHeavyEquipmentLoanRequesterUpt(loan);
  const pemohon = (users||[]).find(u=>u.id===loan.requestedBy) || {};
  const asmanUser = (users||[]).find(u=>u.id===loan.approvedBy) || {};
  const isApproved = !!loan.approvedBy;
  const tanggalApprove = loan.approvedAt ? fmtDate(loan.approvedAt) : "";

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Peminjaman Alat Berat ${loan.id}</title>
<style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:Arial,sans-serif;font-size:10.5px;color:#111;background:#e5e7eb}.page{padding:28px;background:white;max-width:850px;margin:0 auto 16px;min-height:100vh}.topbar{height:5px;background:linear-gradient(90deg,#00377a,#0098da);margin-bottom:4px}.doctitle{text-align:center;margin-bottom:14px}.doctitle h2{font-size:14px;font-weight:800;text-decoration:underline}.doctitle .docno{font-size:10px;font-style:italic;color:#0098da;margin-top:2px}table.meta{width:100%;margin-bottom:14px;border:1px solid #ccc;border-radius:4px;padding:8px}table.meta td{padding:4px 6px;font-size:10.5px}table.meta td.label{width:150px}table.meta td.colon{width:10px}.sig-row{display:flex;justify-content:space-around;margin-top:30px;text-align:center}.sig-col{width:250px;font-size:10px}.sig-space{height:50px;display:flex;align-items:center;justify-content:center}.sig-name{font-weight:700;text-decoration:underline;margin-top:2px}.digital-stamp{border:2px solid #16a34a;color:#16a34a;border-radius:6px;padding:6px 10px;font-size:9px;font-weight:700;display:inline-block;transform:rotate(-4deg)}.print-bar{position:sticky;top:0;background:#003087;color:white;padding:8px 14px;text-align:center;font-size:12px;font-weight:700;z-index:10}.print-bar button{background:#16a34a;color:white;border:none;border-radius:6px;padding:6px 16px;font-size:12px;cursor:pointer;margin-left:10px}@media print{.print-bar{display:none}body{background:white}}</style></head><body>
<div class="print-bar">📄 Dokumen Peminjaman Alat Berat siap cetak <button onclick="window.print()">🖨️ Print / Save as PDF</button></div>
<div class="page">
<div class="topbar"></div>
<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px">
  <div><b>PT PLN (PERSERO)</b><br/>UPT ${ownerUpt||"-"}</div>
  <div style="font-weight:800;font-size:13px">SURAT PEMINJAMAN<br/>ALAT BERAT</div>
</div>
<div class="doctitle"><h2>BERITA ACARA PEMINJAMAN ALAT BERAT / ANGKAT-ANGKUT</h2><div class="docno">${loan.id}</div></div>
<table class="meta">
  <tr><td class="label">Nama Alat</td><td class="colon">:</td><td>${equipment?.nama||"-"} (${equipment?.merkType||"-"}, ${equipment?.kapasitas||"-"})</td></tr>
  <tr><td class="label">Nomor Seri / Aset</td><td class="colon">:</td><td>${equipment?.nomorSeri||loan.equipmentId||"-"}</td></tr>
  <tr><td class="label">UPT Pemilik Alat</td><td class="colon">:</td><td>UPT ${ownerUpt||"-"} — ${equipment?.lokasi||"-"}</td></tr>
  <tr><td class="label">UPT Peminjam</td><td class="colon">:</td><td>UPT ${requesterUpt||"-"}</td></tr>
  <tr><td class="label">Nama Pekerjaan</td><td class="colon">:</td><td>${loan.namaPekerjaan||"-"}</td></tr>
  <tr><td class="label">Keperluan</td><td class="colon">:</td><td>${loan.keperluan||"-"}</td></tr>
  <tr><td class="label">Tanggal Peminjaman</td><td class="colon">:</td><td>${loan.tanggalAmbil||"-"} s/d ${loan.tanggalKembali||"-"}</td></tr>
  <tr><td class="label">Diajukan oleh</td><td class="colon">:</td><td>${pemohon.name||"-"}${loan.catatan?` • Catatan: ${loan.catatan}`:""}</td></tr>
</table>
<p style="font-size:10px;margin-bottom:20px">Dokumen ini menjadi bukti persetujuan peminjaman alat berat/angkat-angkut antar UPT sebagaimana rincian di atas. Alat wajib dikembalikan dalam kondisi baik selambat-lambatnya pada tanggal yang tercantum.</p>
<div class="sig-row">
  <div class="sig-col">
    <b>ASMAN KONSTRUKSI<br/>UPT ${ownerUpt||"-"} (Pemilik Alat)</b>
    <div class="sig-space">${isApproved?`<div class="digital-stamp">✓ DISETUJUI SECARA DIGITAL<br/>${tanggalApprove}</div>`:""}</div>
    <div class="sig-name">${asmanUser.name||"....................."}</div>
  </div>
  <div class="sig-col">
    <b>PEMOHON<br/>UPT ${requesterUpt||"-"}</b>
    <div class="sig-space"></div>
    <div class="sig-name">${pemohon.name||"....................."}</div>
  </div>
</div>
</div></body></html>`;
}

function downloadHeavyEquipmentLoanHTML(loan, equipment, users, showToast) {
  const html = buildHeavyEquipmentLoanHTML(loan, equipment, users);
  const blob = new Blob([html], {type:"text/html"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `PeminjamanAlat_${loan.id}.html`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(()=>URL.revokeObjectURL(url),2000);
  showToast && showToast("📄 File diunduh! Buka di browser lalu Print → Save as PDF.", "success");
}

function downloadTUG7HTML(txn, katalogList, uitList, uptList, users, showToast) {
  const html = buildTUG7HTML(txn, katalogList, uitList, uptList, users);
  const blob = new Blob([html], {type:"text/html"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `TUG7_${txn.docSeq}_${txn.id}.html`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(()=>URL.revokeObjectURL(url),2000);
  showToast && showToast("📄 File diunduh! Buka di browser lalu Print → Save as PDF.", "success");
}

function buildTUG3HTML(txn, katalogList, lokasiList, timMutuList, users) {
  const docs = txn.docNumbers;
  const tlUser = users.find(u=>u.id===txn.approvedByTL) || {};
  const mgrUser = users.find(u=>u.id===txn.approvedByManager) || {};
  const asmanUser = users.find(u => u.role === "ASMAN") || {};
  const tm = (timMutuList||[]).find(t=>t.id===txn.timMutuId) || {};

  function itemRow(si, withHarga) {
    const namaBarang = si.katalogMode==="existing" ? ((katalogList||[]).find(k=>k.id===si.katalogId)?.name||"-") : si.namaBaru;
    const katKode = si.katalogMode==="existing" ? ((katalogList||[]).find(k=>k.id===si.katalogId)?.katalog||"-") : (si.katalogBaru||"-");
    const satuan = si.katalogMode==="existing" ? ((katalogList||[]).find(k=>k.id===si.katalogId)?.satuan||"-") : (si.satuanBaru||"-");
    if (withHarga) {
      const jumlahHarga = (si.qty||0)*(si.harga||0);
      return `<tr><td>${namaBarang}</td><td style="text-align:center">${katKode}</td><td style="text-align:center">${satuan}</td><td style="text-align:center">${fmtNum(si.qty)}</td><td>Pengadaan ${txn.dariSupplier||""}</td><td style="text-align:right">Rp ${fmtNum(si.harga||0)}</td><td style="text-align:right">Rp ${fmtNum(jumlahHarga)}</td></tr>`;
    }
    return `<tr><td>${namaBarang}</td><td style="text-align:center">${katKode}</td><td style="text-align:center">${fmtNum(si.qty)}</td><td style="text-align:center">${satuan}</td><td>Pengadaan ${txn.dariSupplier||""}</td></tr>`;
  }
  const totalHarga = txn.stockItems.reduce((a,si)=>a+(si.qty||0)*(si.harga||0),0);

  function photoCell(label, src) {
    return `<div class="photo-cell"><div class="photo-label">${label}</div>${src ? `<img src="${src}" alt="${label}"/>` : `<div class="photo-empty">Tidak ada foto</div>`}</div>`;
  }

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>TUG-3 ${txn.id}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:Arial,sans-serif;font-size:10.5px;color:#111;background:#e5e7eb}
.page{padding:28px;page-break-after:always;min-height:100vh;background:white;max-width:794px;margin:0 auto 16px}
.page:last-child{page-break-after:auto;margin-bottom:0}
.topbar{height:6px;background:linear-gradient(90deg,#00377a,#0098da);margin-bottom:4px}
.doctitle{text-align:center;margin-bottom:4px}
.doctitle h2{font-size:14px;font-weight:800;letter-spacing:.5px}
.doctitle .docno{font-size:10px;font-style:italic;color:#0098da;font-weight:700}
table.meta{width:100%;margin-bottom:10px;font-size:10.5px}
table.meta td{padding:2px 4px;vertical-align:top}
table.meta td.label{width:150px;color:#333}
table.meta td.colon{width:10px}
table.items{width:100%;border-collapse:collapse;margin-bottom:10px}
table.items th{background:#003087;color:white;padding:6px 6px;font-size:9.5px;text-align:left}
table.items td{padding:6px 6px;border-bottom:1px solid #ddd;font-size:10px}
.sig-row{display:flex;justify-content:space-around;margin-top:18px;text-align:center}
.sig-col{flex:1;font-size:10px}
.sig-space{height:50px}
.sig-name{font-weight:700;text-decoration:underline;margin-top:2px}
.status-stamp{display:inline-block;border:2px solid #16a34a;color:#16a34a;font-weight:800;padding:4px 14px;border-radius:6px;font-size:11px;transform:rotate(-8deg);margin-bottom:8px}
.print-bar{position:sticky;top:0;background:#003087;color:white;padding:10px 16px;text-align:center;font-size:13px;font-weight:700;z-index:10}
.print-bar button{background:#16a34a;color:white;border:none;border-radius:6px;padding:8px 18px;font-size:13px;font-weight:700;cursor:pointer;margin-left:10px}
.photo-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px}
.photo-cell{border:1px solid #ccc;border-radius:6px;overflow:hidden}
.photo-label{background:#f1f5f9;padding:6px 10px;font-size:10px;font-weight:700;border-bottom:1px solid #ccc}
.photo-cell img{width:100%;height:160px;object-fit:cover;display:block}
.photo-empty{height:160px;display:flex;align-items:center;justify-content:center;color:#9ca3af;font-size:10px;font-style:italic;background:#fafafa}
.section-heading{font-weight:800;font-size:11.5px;margin:14px 0 8px;color:#003087}
.tim-table{width:100%;border-collapse:collapse;margin-bottom:14px}
.tim-table th,.tim-table td{border:1px solid #ccc;padding:6px 8px;font-size:10px}
.tim-table th{background:#f1f5f9}
@media print{.print-bar{display:none}.page{box-shadow:none;margin:0;max-width:none}body{background:white}}
</style></head><body>

<div class="print-bar">📄 Dokumen TUG-3/TUG-4 siap dicetak &nbsp; <button onclick="window.print()">🖨️ Print / Save as PDF</button></div>

<!-- ════════ PAGE 1: TUG-3 KARANTINA ════════ -->
<div class="page">
  <div class="topbar"></div>
  <div style="text-align:right;font-weight:800;font-size:13px;margin-bottom:6px">TUG.3<br/><span style="font-size:9px;font-weight:400">Lembar 3: GUDANG — TUG-3 KARANTINA</span></div>
  <div class="doctitle"><h2>BON PENERIMAAN BARANG-BARANG / SPARE PARTS</h2><div class="docno">${docs.tug3}</div></div>
  ${txn.approvedByTL ? `<div style="text-align:center"><span class="status-stamp">✓ KARANTINA DISETUJUI TL</span></div>` : ""}
  <table class="meta" style="border:1px solid #ccc;border-radius:4px;padding:6px;margin-bottom:10px">
    <tr><td class="label">Diterima Tanggal</td><td class="colon">:</td><td>${txn.tanggalDiterima||"-"}</td><td class="label" style="width:130px">No. Surat Jalan</td><td>: ${txn.noSuratJalan||"-"} Tgl. ${txn.tglSuratJalan||"-"}</td></tr>
    <tr><td class="label">Dari</td><td class="colon">:</td><td>${txn.dariSupplier||"-"}</td><td class="label">No. SPK</td><td>: ${txn.noSpk||"-"} Tgl. ${txn.tglSpk||"-"}</td></tr>
    <tr><td class="label">Dengan</td><td class="colon">:</td><td>${txn.denganKirim||"-"}</td><td class="label">Amandemen/Kontrak</td><td>: ${txn.noAmandemen||"-"}</td></tr>
    <tr><td class="label">Biaya Angkutan</td><td class="colon">:</td><td>Rp ${fmtNum(txn.biayaAngkutan||0)}</td><td class="label">No. Faktur</td><td>: ${txn.noFaktur||"-"} Tgl. ${txn.tglFaktur||"-"}</td></tr>
  </table>
  <table class="items">
    <thead><tr><th>Nama Barang/Spare Part</th><th>Kode Katalog</th><th>Sat</th><th>Jumlah</th><th>Keterangan</th><th>Harga Satuan</th><th>Jumlah</th></tr></thead>
    <tbody>${txn.stockItems.map(si=>itemRow(si,true)).join("")}</tbody>
  </table>
  <table class="meta" style="border:1px solid #ccc;border-radius:4px;padding:6px;margin-bottom:10px">
    <tr><td class="label">Nota No.</td><td class="colon">:</td><td>${txn.notaNo||"-"}</td><td class="label">Kode Perkiraan</td><td>: ${txn.kodePerkiraan||"-"}</td></tr>
    <tr><td class="label">Perintah Kerja</td><td class="colon">:</td><td>${txn.perintahKerja||"-"}</td><td class="label">Fungsi</td><td>: ${txn.fungsi||"-"}</td></tr>
    <tr><td class="label">Jumlah</td><td class="colon">:</td><td colspan="3">Rp ${fmtNum(totalHarga)}</td></tr>
  </table>
  <div style="margin-bottom:10px"><b>Keterangan:</b> ${txn.keteranganTug3||"-"}</div>
  <div class="sig-row">
    <div class="sig-col">Diperiksa oleh,<br>Asisten Manager Konstruksi<div class="sig-space"></div><div class="sig-name">${asmanUser.name||"....................."}</div></div>
    <div class="sig-col">TL Logistik<div class="sig-space"></div><div class="sig-name">${tlUser.name||"....................."}</div></div>
  </div>
</div>

<!-- ════════ PAGE 2: TUG-4 BERITA ACARA PEMERIKSAAN ════════ -->
<div class="page">
  <div class="topbar"></div>
  <div style="text-align:right;font-weight:800;font-size:13px;margin-bottom:6px">TUG.4</div>
  <div class="doctitle"><h2>BERITA ACARA PEMERIKSAAN BARANG/SPARE PARTS</h2><div class="docno">${docs.tug4}</div></div>
  ${txn.approvedByManager ? `<div style="text-align:center"><span class="status-stamp">✓ DISETUJUI MANAGER</span></div>` : ""}
  <p style="margin-bottom:10px">Para pemeriksa terdiri dari (${tm.label||"-"}):</p>
  <table class="tim-table">
    <thead><tr><th>NO</th><th>NAMA</th><th>SATUAN ADMINISTRASI</th><th>TANDA TANGAN</th></tr></thead>
    <tbody>
      <tr><td>1</td><td>${tm.ketua||"-"}</td><td>KETUA</td><td></td></tr>
      <tr><td>2</td><td>${tm.sekretaris||"-"}</td><td>SEKRETARIS</td><td></td></tr>
      <tr><td>3</td><td>${tm.anggota1||"-"}</td><td>ANGGOTA</td><td></td></tr>
      <tr><td>4</td><td>${tm.anggota2||"-"}</td><td>ANGGOTA</td><td></td></tr>
      <tr><td>5</td><td>${tm.anggota3||"-"}</td><td>ANGGOTA</td><td></td></tr>
    </tbody>
  </table>
  <table class="meta" style="border:1px solid #ccc;border-radius:4px;padding:6px;margin-bottom:10px">
    <tr><td class="label">Lokasi Penyerahan</td><td class="colon">:</td><td>${txn.lokasiPenyerahan||"-"}</td><td class="label">No SPK</td><td>: ${txn.noSpk||"-"}</td></tr>
    <tr><td class="label">Diterima Dari</td><td class="colon">:</td><td>${txn.dariSupplier||"-"}</td><td class="label">Tanggal</td><td>: ${txn.tglSpk||"-"}</td></tr>
    <tr><td class="label">Tanggal Penerimaan</td><td class="colon">:</td><td>${txn.tanggalDiterima||"-"}</td><td class="label">No Surat Jalan</td><td>: ${txn.noSuratJalan||"-"}</td></tr>
  </table>
  <div style="margin-bottom:10px"><b>Dan menyatakan bahwa:</b> ${txn.hasilPemeriksaan||"-"}</div>
  <table class="items">
    <thead><tr><th>Nama Barang/Spare Part</th><th>Kode Katalog</th><th>Banyaknya</th><th>Satuan</th><th>Catatan</th></tr></thead>
    <tbody>${txn.stockItems.map(si=>itemRow(si,false)).join("")}</tbody>
  </table>
  <table class="meta" style="margin-bottom:14px">
    <tr><td class="label">Kode Perkiraan</td><td class="colon">:</td><td>${txn.kodePerkiraan||"-"}</td><td class="label">Perintah Kerja</td><td>: ${txn.perintahKerja||"-"}</td><td class="label">Fungsi</td><td>: ${txn.fungsi||"-"}</td></tr>
  </table>
  <p style="margin-bottom:20px">Spesifikasi, hasil uji dan jumlah sesuai klausul kontrak dan dapat diterima oleh PENGGUNA BARANG</p>
  <div style="text-align:center">
    <div>PT PLN (PERSERO) UIT - JBM</div>
    <div>Unit Pelaksana Transmisi Surabaya</div>
    <div style="font-weight:700;margin-top:4px">MANAGER</div>
    <div class="sig-space"></div>
    <div class="sig-name">${mgrUser.name||"....................."}</div>
  </div>
</div>

<!-- ════════ PAGE 3: LAMPIRAN FOTO FINAL ════════ -->
<div class="page">
  <div class="topbar"></div>
  <div class="doctitle"><h2>LAMPIRAN FOTO — TUG-3 FINAL</h2><div class="docno">${docs.tug3}</div></div>
  ${txn.approvedByAsman ? `<div style="text-align:center"><span class="status-stamp">✓ DISETUJUI ASMAN — STOK MASUK</span></div>` : ""}
  <div class="section-heading">Foto Kendaraan &amp; SIM/KTP</div>
  <div class="photo-grid">${photoCell("Foto Kendaraan", txn.fotoKendaraan)}${photoCell("SIM / KTP", txn.fotoSimKtp)}</div>
  <div class="section-heading">Surat Jalan &amp; Kontrak</div>
  <div class="photo-grid">${photoCell("Surat Jalan", txn.fotoSuratJalanImg)}${photoCell("Foto Kontrak", txn.fotoKontrak)}</div>
</div>

</body></html>`;
}

function downloadTUG3HTML(txn, katalogList, lokasiList, timMutuList, users, showToast) {
  const html = buildTUG3HTML(txn, katalogList, lokasiList, timMutuList, users);
  const blob = new Blob([html], { type: "text/html" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `TUG3_${txn.docSeq}_${(txn.dariSupplier||"").replace(/[^a-zA-Z0-9]/g,"_").slice(0,30)}.html`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  showToast && showToast("📄 File diunduh! Buka di browser HP/laptop, lalu Print > Save as PDF.", "success");
}

function downloadTUG9HTML(txn, stocks, users, satpamList, showToast) {
  const html = buildTUG9HTML(txn, stocks, users, satpamList);
  const blob = new Blob([html], { type: "text/html" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${txn.docType}_${txn.docSeq}_${txn.namaPekerjaan.replace(/[^a-zA-Z0-9]/g,"_").slice(0,30)}.html`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  showToast && showToast("📄 File diunduh! Buka di browser HP/laptop, lalu Print > Save as PDF.", "success");
}

// ─── AI AGENT ────────────────────────────────────────────────────────
async function askAI(msg, stocks, txns, users, currentUser) {
  const pending = txns.filter(t=>t.status==="PENDING");
  const totalVal = stocks.reduce((a,s)=>a+s.qty*s.price,0);
  const lowStocks = stocks.filter(s=>s.jenisBarang!=="Non-Stock" && s.qty<=s.minQty);
  const ctx = `Kamu adalah AI Assistant untuk sistem Tata Usaha Gudang (TUG) ${WAREHOUSE}, ${COMPANY} ${UPT}.
Pengguna saat ini: ${currentUser.name} (${ROLES[currentUser.role]}).
Jawab dalam Bahasa Indonesia profesional, gunakan istilah kelistrikan PLN bila relevan. Gunakan Rp untuk mata uang, format titik ribuan.

=== DATA REAL-TIME GUDANG ===
Total Item Stok: ${stocks.length}
Total Nilai Inventory: ${fmtRp(totalVal)}
Stok Menipis/Kritis (kategori Persediaan/Cadang/Pre Memory/ATTB): ${lowStocks.length} item
Transaksi TUG-9 Pending Approval: ${pending.length}

${formatStockStatsText(stocks)}

Data Stok Lengkap (termasuk Nomor Katalog):
${stocks.map(s=>`[${s.id}] ${s.name} | Katalog: ${s.katalog} | Jenis: ${s.jenisBarang} | Qty: ${s.qty} ${s.unit} | Min: ${s.minQty} | Harga: ${fmtRp(s.price)} | Lokasi: ${s.lokasi}`).join("\n")}

Riwayat Transaksi TUG-9:
${txns.map(t=>`[${t.status}] ${t.id} | Pekerjaan: ${t.namaPekerjaan} | Lokasi: ${t.lokasiPekerjaan} | Items: ${t.stockItems?.map(si=>{const s=stocks.find(x=>x.id===si.stockId);return `${s?.name} x${si.qty}`}).join(", ")} | ${fmtDate(t.createdAt)}`).join("\n")}
=== AKHIR DATA ===

Analisa data dan berikan jawaban akurat, spesifik, dan dapat ditindaklanjuti.`;
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions",{method:"POST",headers:{"Content-Type":"application/json","Authorization":`Bearer ${import.meta.env.VITE_GROQ_API_KEY}`},body:JSON.stringify({model:"llama-3.3-70b-versatile",max_tokens:1000,messages:[{role:"system",content:ctx},{role:"user",content:msg}]})});
  const data = await res.json();
  return data.choices?.[0]?.message?.content || "Maaf, AI tidak dapat menjawab saat ini.";
}

// ─── BARCODE SCANNER (camera-based) ───────────────────────────────────
function BarcodeScanner({ onDetect, onClose }) {
  const videoRef = useRef(null);
  const [error, setError] = useState("");
  const [scanning, setScanning] = useState(true);
  const streamRef = useRef(null);
  const detectorRef = useRef(null);

  useEffect(() => {
    let active = true;
    async function start() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        if (!active) { stream.getTracks().forEach(t=>t.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play(); }
        if ("BarcodeDetector" in window) {
          detectorRef.current = new window.BarcodeDetector({ formats: ["qr_code","code_128","ean_13","code_39","upc_a","upc_e","ean_8"] });
          scanLoop();
        } else {
          setError("Browser ini tidak mendukung scan barcode otomatis. Gunakan Chrome di Android, atau input manual kode katalog.");
        }
      } catch (e) {
        setError("Tidak dapat mengakses kamera. Pastikan izin kamera diaktifkan.");
      }
    }
    async function scanLoop() {
      if (!active || !videoRef.current || !detectorRef.current) return;
      try {
        const codes = await detectorRef.current.detect(videoRef.current);
        if (codes.length > 0 && active) {
          onDetect(codes[0].rawValue);
          return;
        }
      } catch {}
      if (active) requestAnimationFrame(scanLoop);
    }
    start();
    return () => { active = false; if (streamRef.current) streamRef.current.getTracks().forEach(t=>t.stop()); };
  }, []);

  return (
    <div style={{position:"fixed",inset:0,background:"black",zIndex:2000,display:"flex",flexDirection:"column"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:16,background:"#111"}}>
        <span style={{color:"white",fontWeight:700,fontSize:14}}>📷 Scan Barcode / QR Barang</span>
        <button onClick={onClose} style={{background:"#dc2626",color:"white",border:"none",borderRadius:8,padding:"6px 14px",cursor:"pointer",fontSize:13}}>✕ Tutup</button>
      </div>
      <div style={{flex:1,position:"relative",overflow:"hidden",display:"flex",alignItems:"center",justifyContent:"center"}}>
        {error ? (
          <div style={{color:"white",textAlign:"center",padding:30,fontSize:13}}>⚠️ {error}</div>
        ) : (
          <>
            <video ref={videoRef} style={{width:"100%",height:"100%",objectFit:"cover"}} muted playsInline/>
            <div style={{position:"absolute",width:240,height:240,border:"3px solid #22d3ee",borderRadius:16,boxShadow:"0 0 0 9999px rgba(0,0,0,0.45)"}}/>
          </>
        )}
      </div>
      <div style={{padding:14,background:"#111",color:"#9ca3af",fontSize:11,textAlign:"center"}}>Arahkan kamera ke barcode / QR code label barang</div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ════════════════════════════════════════════════════════════════════
export default function PLNWarehouse() {
  const [currentUser, setCurrentUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true); // true selama cek sesi Supabase Auth yang tersimpan
  const [loginForm, setLoginForm] = useState({ username:"", password:"" });
  const [loginErr, setLoginErr] = useState("");
  const [loginBusy, setLoginBusy] = useState(false);

  const [users, setUsers] = useState([]); // di-fetch dari tabel "profiles" Supabase setelah login (lihat effect onAuthStateChange)
  const [stocks, setStocks] = useState([]); // junction rows: katalogId + lokasiId + qty/price/jenis
  const [katalogList, setKatalogList] = useState([]); // Master Katalog Barang
  const [lokasiList, setLokasiList] = useState([]); // Master Lokasi Gudang
  const [txns, setTxns] = useState([]);
  const [satpamList, setSatpamList] = useState([]);
  const [timMutuList, setTimMutuList] = useState([]);
  const [uitList, setUitList] = useState([]);
  const [uptList, setUptList] = useState([]);
  const [ultgList, setUltgList] = useState([]); // Unit di bawah UPT (mis. ULTG Surabaya Utara/Selatan)
  const [gudangList, setGudangList] = useState([]);
  const [subGudangList, setSubGudangList] = useState([]); // level di antara Gudang dan Blok Lokasi
  const [importGudangOpen, setImportGudangOpen] = useState(false); // toggle panel Import & Review di Master Gudang
  const [rencanaKedatanganList, setRencanaKedatanganList] = useState([]);
  const [opnameList, setOpnameList] = useState([]);
  const [stockCountList, setStockCountList] = useState([]); // riwayat sesi Stock Count (banding SAP vs Aplikasi)
  const [approvalHistoryList, setApprovalHistoryList] = useState([]); // log keputusan approval (Lokasi/Blok, Pemindahan Stok, dkk) — TUG tetap diturunkan dari txns
  const [maturityAssessments, setMaturityAssessments] = useState([]); // riwayat asesmen Maturity Level Gudang UPT Surabaya, diisi manual oleh Admin
  const [heavyEquipmentList, setHeavyEquipmentList] = useState([]);
  const [heavyEquipmentLoans, setHeavyEquipmentLoans] = useState([]);
  const [materialCadangData, setMaterialCadangData] = useState({ imports:[], analyses:[], applyHistory:[] });
  const [maraReference, setMaraReference] = useState(null); // legacy — dipertahankan untuk MigrasiDataTab & MaterialCadangTab
  const [maraSearch, setMaraSearch] = useState("");
  const [maraSearchResults, setMaraSearchResults] = useState([]);
  const [maraSearchLoading, setMaraSearchLoading] = useState(false);
  const [maraSearchError, setMaraSearchError] = useState(null);
  const [maraUploadLoading, setMaraUploadLoading] = useState(false);
  const [maraUploadProgress, setMaraUploadProgress] = useState(null);
  const [catalogMasterRef, setCatalogMasterRef] = useState(null); // session-only hidden cataloger reference
  const [gudangCapacityList, setGudangCapacityList] = useState([]);
  const [gudangCapacityImports, setGudangCapacityImports] = useState([]);
  const [migratedTug15History, setMigratedTug15History] = useState([]);
  const [docSeq, setDocSeq] = useState(196);
  const [loading, setLoading] = useState(true);
  const [cloudSaving, setCloudSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState(null);

  const [tab, setTab] = useState("dashboard");
  const [search, setSearch] = useState("");
  const [filterJenis, setFilterJenis] = useState("ALL");
  const [stockPage, setStockPage] = useState(1);
  const [stockPageSize, setStockPageSize] = useState(10);
  const [katalogPage, setKatalogPage] = useState(1);
  const [katalogPageSize, setKatalogPageSize] = useState(10);
  const [filterStatus, setFilterStatus] = useState("ALL");

  const [stockModal, setStockModal] = useState(null);
  const [txnModal, setTxnModal] = useState(false);
  const [editingDraftTxnId, setEditingDraftTxnId] = useState(null); // non-null = sedang edit draft TUG-9 hasil adopt ULTG
  const [tug5ExpandedIdx, setTug5ExpandedIdx] = useState(0); // index baris material TUG-5 yang sedang terbuka penuh (baris lain collapse)
  const [tug5MaterialPage, setTug5MaterialPage] = useState(0); // 5 item per halaman, max 10 (2 halaman)
  const [satpamModal, setSatpamModal] = useState(null);
  const [satpamForm, setSatpamForm] = useState({});
  const [katalogModal, setKatalogModal] = useState(null);
  const [katalogForm, setKatalogForm] = useState({});
  const [lokasiModal, setLokasiModal] = useState(null);
  const [lokasiForm, setLokasiForm] = useState({});
  const [timMutuModal, setTimMutuModal] = useState(null);
  const [timMutuForm, setTimMutuForm] = useState({});
  const [uitModal, setUitModal] = useState(null);
  const [uitForm, setUitForm] = useState({});
  const [ultgModal, setUltgModal] = useState(null);
  const [ultgForm, setUltgForm] = useState({});
  const [uptModal, setUptModal] = useState(null);
  const [uptForm, setUptForm] = useState({});
  const [stockSubTab, setStockSubTab] = useState("katalog"); // "katalog" | "lokasi" | "satpam" | "timmutu" (within Master Data tab)
  const [tugGroup, setTugGroup] = useState("penerimaan");
  const [tug15Filter, setTug15Filter] = useState({
    dateFrom: "", dateTo: "",
    katalogId: "ALL",
    jenisBarang: "ALL",
    sapStatus: "ALL",  // "ALL" | "SAP" | "Non-SAP"
    docTypes: ["TUG9","TUG8","TUG10","TUG3"],
  });
  const [topN, setTopN] = useState(10);
  const [pemakaianMode, setPemakaianMode] = useState("frekuensi"); // "frekuensi" | "qty"
  const [tugExpanded, setTugExpanded] = useState(false); // sidebar accordion state for TUG
  const [tugSubTab, setTugSubTab] = useState("TUG3"); // "TUG3" | "TUG10" (penerimaan) or "TUG9" | "TUG8" (pengeluaran)
  const [masterExpanded, setMasterExpanded] = useState(false); // sidebar accordion state for Master Data
  const [opnameExpanded, setOpnameExpanded] = useState(false); // sidebar accordion state for Stock Opname & Stock Count (digabung 1 menu)
  const [opnameSubTab, setOpnameSubTab] = useState("opname"); // "opname" | "stockCount"
  const [isMobile, setIsMobile] = useState(typeof window !== "undefined" && window.innerWidth <= 768);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false); // drawer sidebar di HP
  const [stockGudangFilter, setStockGudangFilter] = useState({}); // UI-only: stockId -> gudangId terpilih, untuk menyaring opsi dropdown Blok
  useEffect(() => {
    function onResize() { setIsMobile(window.innerWidth <= 768); }
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Auto-sync ke Supabase setiap kali ada transaksi TUG yang berubah (approve/reject/dll),
  // supaya tidak perlu klik tombol "Sync ke Supabase" manual. Di-debounce 2.5 detik supaya
  // tidak nembak Supabase berkali-kali kalau banyak perubahan state beruntun.
  useEffect(() => {
    if (!currentUser || loading) return;
    const timer = setTimeout(async () => {
      try {
        const filter = { dateFrom:"", dateTo:"", katalogId:"ALL", jenisBarang:"ALL", sapStatus:"ALL", docTypes:["TUG9","TUG8","TUG10","TUG3"] };
        const rows = buildMutasiRows(txns, katalogList, stocks, filter, lokasiList);
        const histRes = await syncTUG15ToSupabase(rows, katalogList);
        await syncStockQtyToSupabase(stocks, katalogList);
        await syncFotoMaterialToSupabase(stocks, katalogList);
        if (histRes.historyCount > 0) {
          showToastRef.current && showToastRef.current(`☁️ Auto-sync Supabase: ${histRes.historyCount} baris histori baru.`, "success");
        }
      } catch (err) {
        console.error("Auto-sync Supabase gagal:", err.message);
      }
    }, 2500);
    return () => clearTimeout(timer);
  }, [txns, stocks, katalogList, currentUser, loading]);
  const [ocrSuggestions, setOcrSuggestions] = useState([]); // usulan blok batch dari OCR denah: [{id,kode,xPct,yPct,checked}]
  const [ocrSuggestGudangId, setOcrSuggestGudangId] = useState(null); // gudang mana yang usulannya sedang tampil
  const [ocrSuggestSubGudangId, setOcrSuggestSubGudangId] = useState(null); // non-null = usulan berasal dari denah Sub Gudang, bukan denah Gudang keseluruhan
  const [mapConfigSubGudangId, setMapConfigSubGudangId] = useState(null);
  const [pendingMapLokasiSub, setPendingMapLokasiSub] = useState(null);
  const [manualAddModeSub, setManualAddModeSub] = useState(false);
  const [denahSubLoading, setDenahSubLoading] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [docPreview, setDocPreview] = useState(null); // txn object when previewing TUG-9 document
  const [kartuGantungDetail, setKartuGantungDetail] = useState(null);
  const [petaMiniDetail, setPetaMiniDetail] = useState(null); // {stock, lokasi, gudang}
  const [stockDetailId, setStockDetailId] = useState(null); // id stok yang dibuka detailnya (klik baris Data Stok)
  const [pendingFoto, setPendingFoto] = useState({}); // foto yang baru dipilih tapi belum diklik "Simpan Foto" — {fotoNameplate, fotoKeseluruhan}
  const [lightboxImg, setLightboxImg] = useState(null); // src foto yang sedang di-overview full-screen
  const [scannerTarget, setScannerTarget] = useState(null); // "stockForm" | {index}
  const [stockForm, setStockForm] = useState({});
  const [txnForm, setTxnForm] = useState(null);
  const [toast, setToast] = useState(null);

  const [chatHistory, setChatHistory] = useState([{ role:"ai", text:`Selamat datang di Sistem TUG Digital ${WAREHOUSE}! ⚡\n\nSaya siap membantu analisa stok, forecast kebutuhan material, dan rekomendasi pengadaan.\n\nTanya apa saja!` }]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [ragSyncing, setRagSyncing] = useState(false);
  const [ragLastSync, setRagLastSync] = useState(null);
  const chatEndRef = useRef(null);
  const petaWilayahDivRef = useRef(null);
  const petaWilayahMapRef = useRef(null);
  const dedupeGudangRanRef = useRef(false);
  const [forecastDetail, setForecastDetail] = useState(null); // katalog object for drill-down
  const [forecastDetailResult, setForecastDetailResult] = useState(null);
  const [forecastDetailLoading, setForecastDetailLoading] = useState(false);
  const showToastRef = useRef(null);

  useEffect(() => {
    async function loadCloud() {
      setLoading(true);
      const cs = await CLOUD.get("pln_stocks_v4");
      const ckat = await CLOUD.get("pln_katalog_v4");
      const clokLocal = await CLOUD.get("pln_lokasi_v4");
      const ct = await CLOUD.get("pln_txns_v3");
      const cseq = await CLOUD.get("pln_docseq_v3");
      const crk = await CLOUD.get("pln_rencana_v1");
      const copn = await CLOUD.get("pln_opname_v1");
      const csc = await CLOUD.get("pln_stockcount_v1");
      const cah = await CLOUD.get("pln_approval_history_v1");
      const cma = await CLOUD.get("pln_maturity_v1");
      const che = await CLOUD.get("pln_heavy_equipment_v1");
      const chel = await CLOUD.get("pln_heavy_equipment_loans_v1");
      const cmcd = await CLOUD.get("pln_material_cadang_v1");
      const cgcap = await CLOUD.get("pln_gudang_capacity_v1");
      const cgcapi = await CLOUD.get("pln_gudang_capacity_imports_v1");
      const cmig = await CLOUD.get("pln_migrated_tug15_v1");

      // Master data (UIT/UPT/Gudang/Lokasi/Satpam/Tim Mutu) sekarang sumber
      // utamanya Supabase, bukan localStorage lagi — load dulu (seed dari
      // DEFAULT_* kalau tabelnya masih kosong, mis. instalasi baru).
      const [cuit, cupt, cultg, cgdg, csgdg, clokRemote, csp, ctm, ckatRemote, csRemote] = await Promise.all([
        seedMasterTableIfEmpty("uit", DEFAULT_UIT),
        seedMasterTableIfEmpty("upt", DEFAULT_UPT_LIST, u => ({ uit_id: u.uitId || null })),
        loadMasterTable("ultg").then(r => r || []),
        seedMasterTableIfEmpty("gudang", DEFAULT_GUDANG, g => ({ upt_id: g.uptId || null })),
        loadMasterTable("sub_gudang").then(r => r || []),
        seedMasterTableIfEmpty("lokasi", DEFAULT_LOKASI, l => ({ gudang_id: l.gudangId || null, status: l.status || null })),
        seedMasterTableIfEmpty("satpam", DEFAULT_SATPAM),
        seedMasterTableIfEmpty("tim_mutu", DEFAULT_TIM_MUTU),
        loadMasterTable("katalog"),
        loadMasterTable("stocks"),
      ]);
      const clok = clokRemote || clokLocal; // fallback ke localStorage kalau Supabase belum terkonfigurasi

      if (cs && ckat && clok) {
        // Already on new master-data structure.
        // Bersihkan id ganda yang mungkin sudah kepalanjar tersimpan (mis.
        // bug katalog/stok 2230071 yang dobel sebelum diperbaiki di seed).
        const dKat = dedupeById(ckat);
        const dStk = dedupeById(cs);
        const dLok = dedupeById(clok);
        setStocks(dStk.list); setKatalogList(dKat.list); setLokasiList(dLok.list);
        const totalRemoved = dKat.removed + dStk.removed + dLok.removed;
        if (totalRemoved > 0) {
          showToastRef.current && showToastRef.current(`🧹 Membersihkan ${totalRemoved} data duplikat (id ganda) di Master Katalog/Stok/Lokasi.`, "success");
          CLOUD.set("pln_katalog_v4", dKat.list);
          CLOUD.set("pln_stocks_v4", dStk.list);
          syncMasterTable("lokasi", dLok.list, l => ({ gudang_id: l.gudangId || null, status: l.status || null }));
        }

        // Master Katalog & Data Stok sekarang punya "rumah" permanen di Supabase (tabel
        // katalog/stocks, pola sama seperti uit/upt/dll) — sebelumnya cuma localStorage
        // (lihat catatan di schema.sql section 1). Supabase jadi sumber utama kalau sudah
        // ada isinya; kalau masih kosong (instalasi lama yang baru upgrade ke versi ini),
        // dorong sekali data localStorage yang ada ke Supabase supaya tidak hilang lagi.
        // Filter `k.name` (bukan cuma length>0): baris `katalog` lama sempat berupa row
        // kosong (`data:{}`, orphan dari skema sebelum migrasi) yang tidak bisa dihapus
        // karena masih dirujuk FK tug15_history — jangan sampai baris kosong itu dianggap
        // "Supabase sudah ada data" dan menimpa data asli di localStorage.
        const ckatRemoteReal = (ckatRemote||[]).filter(k=>k.name);
        if (ckatRemoteReal.length > 0) {
          setKatalogList(dedupeById(ckatRemoteReal).list);
        } else if (dKat.list.length > 0) {
          syncMasterTable("katalog", dKat.list);
        }
        if (csRemote && csRemote.length > 0) {
          setStocks(dedupeById(csRemote).list);
        } else if (dStk.list.length > 0) {
          syncMasterTable("stocks", dStk.list, s => ({ katalog_id: s.katalogId || null, lokasi_id: s.lokasiId || null }));
        }
      } else {
        // Check for legacy flat-stock data from older version of the app
        const legacyStocks = await CLOUD.get("pln_stocks_v3");
        const migrated = migrateLegacyStocks(legacyStocks);
        if (migrated) {
          setStocks(migrated.stocks); setKatalogList(migrated.katalog); setLokasiList(migrated.lokasi);
          showToastRef.current && showToastRef.current("📦 Data lama berhasil dimigrasikan ke struktur Master Data baru!", "success");
        } else {
          setStocks((csRemote&&csRemote.length>0) ? csRemote : DEFAULT_STOCKS);
          setKatalogList((ckatRemote||[]).some(k=>k.name) ? ckatRemote.filter(k=>k.name) : DEFAULT_KATALOG);
          setLokasiList(clok || DEFAULT_LOKASI);
        }
      }
      setTxns(ct || DEFAULT_TXNS);
      setDocSeq(cseq || 196);
      setSatpamList(csp);
      setTimMutuList(ctm);
      setUitList(cuit);
      setUptList(cupt);
      setUltgList(cultg);
      setGudangList(cgdg);
      setSubGudangList(csgdg || []);
      setRencanaKedatanganList(crk || []);
      setOpnameList(copn || []);
      setStockCountList(csc || []);
      setApprovalHistoryList(cah || []);
      setMaturityAssessments(cma || []);
      setHeavyEquipmentList(che || DEFAULT_HEAVY_EQUIPMENT);
      setHeavyEquipmentLoans(chel || []);
      setMaterialCadangData(cmcd || { imports:[], analyses:[], applyHistory:[] });
      setGudangCapacityList(cgcap || []);
      setGudangCapacityImports(cgcapi || []);
      setMigratedTug15History(cmig || []);
      setLoading(false);
    }
    loadCloud();
  }, []);

  // saveToCloud now takes an overrides object. Any field not passed falls back
  // to the latest React state via stateRef (always up to date, avoids stale
  // closures without needing every call site updated when new fields are added).
  const stateRef = useRef({});
  stateRef.current = { stocks, txns, docSeq, satpamList, katalogList, lokasiList, timMutuList, uitList, uptList, gudangList, subGudangList, rencanaKedatanganList, opnameList, stockCountList, approvalHistoryList, maturityAssessments, heavyEquipmentList, heavyEquipmentLoans, materialCadangData, gudangCapacityList, gudangCapacityImports, migratedTug15History };
  // Debounce auto-sync warnoto_state + RAG (bot WA/Telegram) — dipicu tiap ada perubahan
  // stocks/txns lewat saveToCloud, tapi ditunda sampai 90 detik tidak ada perubahan baru
  // lagi (quiet period), supaya sesi edit beruntun (banyak saveToCloud berturut-turut)
  // cuma memicu 1x sync di akhir, bukan spam panggilan Cohere embed API tiap perubahan.
  const autoSyncTimerRef = useRef(null);
  // Catatan: satpamList/timMutuList/uitList/uptList/gudangList/lokasiList TIDAK
  // lagi ditulis di sini — sumber utamanya sekarang Supabase (tabel satpam/
  // tim_mutu/uit/upt/gudang/lokasi), ditulis langsung oleh masing-masing
  // fungsi CRUD-nya lewat syncMasterTable(). saveToCloud tetap menangani sisa
  // data yang belum dimigrasi (stocks, katalog, txns, dst).
  const saveToCloud = useCallback(async (overrides = {}) => {
    const s = overrides.stocks ?? stateRef.current.stocks;
    const t = overrides.txns ?? stateRef.current.txns;
    const seq = overrides.docSeq ?? stateRef.current.docSeq;
    const kat = overrides.katalogList ?? stateRef.current.katalogList;
    const rk = overrides.rencanaKedatanganList ?? stateRef.current.rencanaKedatanganList;
    const opn = overrides.opnameList ?? stateRef.current.opnameList;
    const sc = overrides.stockCountList ?? stateRef.current.stockCountList;
    const ah = overrides.approvalHistoryList ?? stateRef.current.approvalHistoryList;
    const ma = overrides.maturityAssessments ?? stateRef.current.maturityAssessments;
    const he = overrides.heavyEquipmentList ?? stateRef.current.heavyEquipmentList;
    const hel = overrides.heavyEquipmentLoans ?? stateRef.current.heavyEquipmentLoans;
    const mcd = overrides.materialCadangData ?? stateRef.current.materialCadangData;
    const gcap = overrides.gudangCapacityList ?? stateRef.current.gudangCapacityList;
    const gcapi = overrides.gudangCapacityImports ?? stateRef.current.gudangCapacityImports;
    const mig = overrides.migratedTug15History ?? stateRef.current.migratedTug15History;
    setCloudSaving(true);
    await Promise.all([
      CLOUD.set("pln_stocks_v4", s),
      CLOUD.set("pln_katalog_v4", kat),
      CLOUD.set("pln_txns_v3", t),
      CLOUD.set("pln_docseq_v3", seq),
      CLOUD.set("pln_rencana_v1", rk),
      CLOUD.set("pln_opname_v1", opn),
      CLOUD.set("pln_stockcount_v1", sc),
      CLOUD.set("pln_approval_history_v1", ah),
      CLOUD.set("pln_maturity_v1", ma),
      CLOUD.set("pln_heavy_equipment_v1", he),
      CLOUD.set("pln_heavy_equipment_loans_v1", hel),
      CLOUD.set("pln_material_cadang_v1", mcd),
      CLOUD.set("pln_gudang_capacity_v1", gcap),
      CLOUD.set("pln_gudang_capacity_imports_v1", gcapi),
      CLOUD.set("pln_migrated_tug15_v1", mig),
    ]);
    setLastSaved(Date.now());
    setCloudSaving(false);

    // Master Katalog & Data Stok — sumber utama sekarang Supabase (tabel katalog/stocks),
    // bukan cuma localStorage lagi (lihat catatan migrasi di schema.sql section 1/1b).
    // Disinkron langsung (tidak di-debounce) karena ini data inti aplikasi, bukan cuma
    // kebutuhan bot chat seperti stocks_snapshot/warnoto_state di bawah.
    if (overrides.katalogList !== undefined) syncMasterTable("katalog", kat);
    if (overrides.stocks !== undefined) syncMasterTable("stocks", s, item => ({ katalog_id: item.katalogId || null, lokasi_id: item.lokasiId || null }));

    // Auto-sync warnoto_state + RAG (bot WA/Telegram) kalau ada perubahan stocks/txns —
    // debounced 90 detik supaya tidak spam Cohere embed API tiap 1 saveToCloud.
    if ((overrides.stocks !== undefined || overrides.txns !== undefined) && supabase) {
      if (autoSyncTimerRef.current) clearTimeout(autoSyncTimerRef.current);
      autoSyncTimerRef.current = setTimeout(async () => {
        try {
          await syncStocksSnapshot(true);
          await syncRagChunks(true);
          await syncWarnotoState(true);
        } catch (e) {
          console.error("Auto-sync bot WA/Telegram gagal:", e);
        }
      }, 90000);
    }
  }, []);

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior:"smooth" }); }, [chatHistory]);
  useEffect(() => { setStockPage(1); }, [search, filterJenis, stockPageSize]);
  useEffect(() => { setKatalogPage(1); }, [katalogPageSize]);

  // Auto-gabungkan Gudang/Sub Gudang duplikat sekali per sesi setelah data dimuat — supaya
  // denah/koordinat yang "nyasar" ke ID duplikat langsung ketemu tanpa perlu klik manual.
  useEffect(() => {
    if (dedupeGudangRanRef.current) return;
    if (loading) return;
    if (gudangList.length === 0) return;
    dedupeGudangRanRef.current = true;
    dedupeGudangDanSubGudang();
  }, [loading, gudangList]);

  // Peta Wilayah Gudang UPT Surabaya — render/refresh marker Leaflet tiap kali Dashboard dibuka atau data gudang berubah
  useEffect(() => {
    if (tab !== "dashboard" || !petaWilayahDivRef.current || typeof window.L === "undefined") return;
    // Tab Dashboard di-unmount/mount ulang tiap pindah tab, jadi <div> peta selalu jadi node DOM baru —
    // kalau instance map lama masih nempel ke container lama (sudah lepas dari DOM), buang & buat ulang.
    if (petaWilayahMapRef.current && petaWilayahMapRef.current.getContainer() !== petaWilayahDivRef.current) {
      petaWilayahMapRef.current.remove();
      petaWilayahMapRef.current = null;
    }
    const gudangWithCoord = gudangList.filter(g => g.lat != null && g.lng != null);
    if (!petaWilayahMapRef.current) {
      petaWilayahMapRef.current = window.L.map(petaWilayahDivRef.current, { scrollWheelZoom:false }).setView([-7.2945, 112.7321], 12);
      window.L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution:"© OpenStreetMap contributors", maxZoom:19 }).addTo(petaWilayahMapRef.current);
      petaWilayahMapRef.current._markersLayer = window.L.layerGroup().addTo(petaWilayahMapRef.current);
    }
    const map = petaWilayahMapRef.current;
    map._markersLayer.clearLayers();
    // Ikon gudang merah (divIcon — tidak butuh file gambar terpisah)
    const gudangIcon = window.L.divIcon({
      html: `<div style="width:30px;height:30px;border-radius:50%;background:#dc2626;border:2px solid white;box-shadow:0 1px 4px rgba(0,0,0,0.4);display:flex;align-items:center;justify-content:center;font-size:16px;">🏭</div>`,
      className: "", iconSize:[30,30], iconAnchor:[15,15], popupAnchor:[0,-15],
    });
    gudangWithCoord.forEach(g => {
      const stockRows = stocks.filter(s=>{ const lok = lokasiList.find(l=>l.id===s.lokasiId); return lok?.gudangId===g.id; });
      const itemCount = stockRows.length;
      const totalQty = stockRows.reduce((a,s)=>a+(s.qty||0),0);
      const lastMaturity = maturityAssessments[0];
      window.L.marker([g.lat, g.lng], {icon:gudangIcon}).addTo(map._markersLayer)
        .bindPopup(`<b>🏭 ${g.nama}</b> (${g.kode})<br/>${g.alamat||"-"}<br/>${itemCount} baris stok • Total Qty: <b>${fmtNum(totalQty)}</b>${lastMaturity?`<br/>Maturity: Level ${lastMaturity.level} (${MATURITY_LEVELS[lastMaturity.level]})`:""}`);
    });
    if (gudangWithCoord.length > 0) {
      map.setView([gudangWithCoord[0].lat, gudangWithCoord[0].lng], gudangWithCoord.length===1?13:11);
    }
    setTimeout(()=>map.invalidateSize(), 100);
  }, [tab, gudangList, stocks, lokasiList, maturityAssessments, currentUser]);

  // Toast error dibiarkan tampil lebih lama (5.5s) daripada sukses (3.5s) —
  // pesan error biasanya lebih panjang/penting untuk dibaca tuntas, terutama
  // di HP saat user sedang fokus mengisi form di lapangan.
  function showToast(msg, type="success") { setToast({msg,type}); setTimeout(()=>setToast(null), type==="error"?5500:3500); }
  showToastRef.current = showToast;

  async function handleLogin() {
    if (!supabase) { setLoginErr("Supabase belum dikonfigurasi."); return; }
    if (!loginForm.username.trim() || !loginForm.password) { setLoginErr("Username dan password wajib diisi."); return; }
    setLoginBusy(true); setLoginErr("");
    const { error } = await supabase.auth.signInWithPassword({
      email: usernameToAuthEmail(loginForm.username),
      password: loginForm.password,
    });
    setLoginBusy(false);
    // currentUser di-set oleh listener onAuthStateChange (lihat effect di bawah),
    // bukan di sini — supaya restore sesi (reload halaman) dan login manual
    // lewat jalur yang sama persis, tidak ada logic yang didobel.
    if (error) setLoginErr("Username atau password salah.");
  }

  async function handleLogout() {
    if (supabase) await supabase.auth.signOut();
    setCurrentUser(null); setUsers([]);
  }

  // Pulihkan sesi Supabase Auth yang tersimpan saat app dibuka (reload, buka
  // tab baru, dst), dan dengarkan event login/logout — satu listener ini
  // menangani SEMUA transisi auth (initial load, login manual, logout),
  // supaya currentUser & users selalu konsisten dari satu sumber.
  useEffect(() => {
    if (!supabase) { setAuthLoading(false); return; }
    const { data: sub } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (session?.user) {
        const { data: profile, error: profErr } = await supabase.from("profiles").select("*").eq("id", session.user.id).single();
        if (profErr || !profile) {
          setLoginErr("Akun ini belum punya profil (hubungi Admin). Logout otomatis.");
          await supabase.auth.signOut();
          setCurrentUser(null); setUsers([]);
        } else {
          setCurrentUser({ id: profile.id, name: profile.name, username: profile.username, role: profile.role, jabatan: profile.jabatan, avatar: profile.avatar, uptId: profile.upt_id, ultgId: profile.ultg_id });
          const { data: allProfiles } = await supabase.from("profiles").select("*");
          setUsers((allProfiles||[]).map(p => ({ id: p.id, name: p.name, username: p.username, role: p.role, jabatan: p.jabatan, avatar: p.avatar, uptId: p.upt_id, ultgId: p.ultg_id })));
        }
      } else {
        setCurrentUser(null); setUsers([]);
      }
      setAuthLoading(false);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  // ── Stock CRUD ──
  // ── MASTER KATALOG BARANG CRUD ──
  function openAddKatalog() {
    setKatalogForm({ id:`KAT-${uid().slice(-6)}`, katalog:"", name:"", category:"Lainnya", satuan:"unit" });
    setKatalogModal("add");
  }
  function openEditKatalog(k) { setKatalogForm({...k}); setKatalogModal("edit"); }
  async function saveKatalog() {
    if (!katalogForm.name?.trim()) { showToast("Nama barang tidak boleh kosong!","error"); return; }
    if (!katalogForm.katalog?.trim()) { showToast("Nomor Katalog tidak boleh kosong!","error"); return; }
    // Cegah duplikat: 1 barang fisik seharusnya cuma punya 1 katalogId. Kode katalog (nomor
    // SAP) harus unik mutlak; nama juga dicek (case-insensitive, exact match) karena barang
    // yang sama sering ke-input dobel dengan kode beda kalau tidak dicek di sini.
    const kodeDup = katalogList.find(k => k.id!==katalogForm.id && (k.katalog||"").trim().toLowerCase()===katalogForm.katalog.trim().toLowerCase());
    if (kodeDup) { showToast(`Nomor Katalog "${katalogForm.katalog}" sudah dipakai oleh "${kodeDup.name}"!`, "error"); return; }
    const namaDup = katalogList.find(k => k.id!==katalogForm.id && (k.name||"").trim().toLowerCase()===katalogForm.name.trim().toLowerCase());
    if (namaDup) { showToast(`Nama barang "${katalogForm.name}" sudah ada (kode ${namaDup.katalog||"-"}). Kalau ini barang yang sama, edit yang sudah ada — jangan buat baru.`, "error"); return; }
    // _maraLocked cuma flag UI (kunci form), bukan bagian data katalog — jangan ikut tersimpan.
    const { _maraLocked, ...katalogClean } = katalogForm;
    let nk;
    if (katalogModal==="edit") nk = katalogList.map(k=>k.id===katalogForm.id?{...katalogClean}:k);
    else nk = [...katalogList, {...katalogClean, createdAt:Date.now()}];
    setKatalogList(nk); setKatalogModal(null);
    await saveToCloud({katalogList: nk});
    showToast(katalogModal==="edit" ? "Master Katalog diupdate!" : "Katalog barang baru ditambahkan!");
  }
  async function searchMaraCatalog(q) {
    setMaraSearch(q);
    if (!q || q.trim().length < 2) { setMaraSearchResults([]); return; }
    if (!supabase) { showToast("Supabase tidak terhubung","error"); return; }
    setMaraSearchLoading(true);
    const { data, error } = await supabase.from("mara_catalog")
      .select("kode_material,nama,satuan,material_group")
      .ilike("nama", `%${q.trim()}%`)
      .limit(20);
    setMaraSearchLoading(false);
    if (error) {
      setMaraSearchResults([]);
      setMaraSearchError(error.code==="42P01" ? "Tabel MARA belum dibuat di Supabase. Jalankan SQL create table mara_catalog dulu." : `Error: ${error.message}`);
      return;
    }
    setMaraSearchError(null);
    setMaraSearchResults(data || []);
  }
  function applyMaraToKatalog(item) {
    // _maraLocked: kunci Nomor Katalog/Nama/Kategori/Satuan supaya tidak diketik ulang manual
    // dan jadi tidak konsisten dengan sumber MARA — bisa dibuka lagi lewat tombol "Lepas kunci".
    setKatalogForm(kf=>({...kf, katalog: item.kode_material||kf.katalog, name: item.nama||kf.name, satuan: item.satuan||kf.satuan, category: item.material_group||kf.category, _maraLocked: true }));
    setMaraSearchResults([]);
    setMaraSearch("");
  }
  async function uploadMaraToDB(file) {
    if (!supabase) { showToast("Supabase tidak terhubung","error"); return; }
    if (!file) return;
    setMaraUploadLoading(true);
    setMaraUploadProgress("Membaca file...");
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, {type:"array"});
      const ws = wb.Sheets[wb.SheetNames[0]];
      // pakai object mode agar mapping kolom by name, bukan index
      const rows = XLSX.utils.sheet_to_json(ws, {defval:""});
      const total = rows.length;
      const CHUNK = 500;
      let done = 0;
      for (let i=0; i<rows.length; i+=CHUNK) {
        const chunk = rows.slice(i, i+CHUNK).map(r=>({
          kode_material: String(r["Material"]||"").trim(),
          material_type: String(r["Material Type"]||"").trim(),
          material_group: String(r["Material Group"]||"").trim(),
          satuan: String(r["Base Unit of Measure"]||"").trim(),
          status: String(r["X-plant matl status"]||"").trim(),
          nama: String(r["Material Description"]||"").trim(),
        })).filter(r=>r.kode_material&&r.nama);
        const { error } = await supabase.from("mara_catalog").upsert(chunk, {onConflict:"kode_material"});
        if (error) { showToast("Error upload chunk: "+error.message,"error"); break; }
        done += chunk.length;
        setMaraUploadProgress(`Mengupload... ${done.toLocaleString()} / ${total.toLocaleString()}`);
      }
      showToast(`✅ ${done.toLocaleString()} material MARA berhasil disimpan ke database.`, "success");
      setMaraUploadProgress(null);
    } catch(e) {
      showToast("Gagal upload MARA: "+e.message, "error");
      setMaraUploadProgress(null);
    }
    setMaraUploadLoading(false);
  }
  async function deleteKatalog(id) {
    if (stocks.some(s=>s.katalogId===id)) { showToast("Tidak bisa hapus: katalog ini masih dipakai di Data Stok!","error"); return; }
    if (!window.confirm("Hapus katalog barang ini dari Master Data?")) return;
    const nk = katalogList.filter(k=>k.id!==id);
    setKatalogList(nk); await saveToCloud({katalogList: nk}); showToast("Katalog dihapus.");
  }

  // ── MASTER LOKASI GUDANG CRUD ──
  // Semua perubahan (tambah/edit/hapus) blok lokasi butuh approval TL,
  // kecuali yang mengajukan sendiri adalah TL (langsung disetujui).
  function openAddLokasi() {
    setLokasiForm({ id:`LOK-${uid().slice(-6)}`, kode:"", keterangan:"", kapasitas:50 });
    setLokasiModal("add");
  }
  function openAddLokasiFor(gudangId, subGudangId) {
    setLokasiForm({ id:`LOK-${uid().slice(-6)}`, kode:"", keterangan:"", kapasitas:50, gudangId, subGudangId: subGudangId||null });
    setLokasiModal("add");
  }
  function openEditLokasi(l) { setLokasiForm({...l}); setLokasiModal("edit"); }

  // Cek kode blok sudah dipakai di gudang yang sama (termasuk usulan pending EDIT lain).
  // Blok tanpa gudangId (belum di-assign) tidak dicek silang, karena belum "di dalam" gudang manapun.
  function isKodeDuplicateInGudang(kode, gudangId, excludeId) {
    if (!gudangId || !kode?.trim()) return false;
    const norm = kode.trim().toLowerCase();
    return lokasiList.some(l => {
      if (l.id === excludeId) return false;
      if (l.gudangId !== gudangId) return false;
      if (l.pendingAction === "DELETE") return false;
      const kodeAktif = (l.pendingAction === "EDIT" && l.pendingData?.kode) ? l.pendingData.kode : l.kode;
      return (kodeAktif||"").trim().toLowerCase() === norm;
    });
  }

  function syncLokasi(nl) { return syncMasterTable("lokasi", nl, l => ({ gudang_id: l.gudangId || null, status: l.status || null })); }

  async function saveLokasi() {
    if (!lokasiForm.gudangId) { showToast("Pilih Gudang dulu sebelum mengisi Blok! Data harus berjenjang: Gudang → Blok.","error"); return; }
    if (!lokasiForm.kode?.trim()) { showToast("Kode Lokasi tidak boleh kosong!","error"); return; }
    if (isKodeDuplicateInGudang(lokasiForm.kode, lokasiForm.gudangId, lokasiModal==="edit"?lokasiForm.id:null)) {
      showToast(`Kode blok "${lokasiForm.kode}" sudah dipakai di gudang ini!`,"error"); return;
    }
    const isTL = currentUser.role === "TL";
    let nl;
    if (lokasiModal==="edit") {
      nl = lokasiList.map(l => l.id===lokasiForm.id ? (
        isTL
          ? { ...l, ...lokasiForm, status:"APPROVED", pendingAction:null, pendingData:null }
          : { ...l, status:"PENDING", pendingAction:"EDIT", pendingData:{...lokasiForm}, requestedBy:currentUser.id, requestedAt:Date.now() }
      ) : l);
    } else {
      const baru = { ...lokasiForm, createdAt:Date.now(),
        status: isTL ? "APPROVED" : "PENDING",
        pendingAction: isTL ? null : "ADD",
        requestedBy: currentUser.id, requestedAt: Date.now() };
      nl = [...lokasiList, baru];
    }
    setLokasiList(nl); setLokasiModal(null);
    await syncLokasi(nl);
    showToast(isTL ? (lokasiModal==="edit"?"Master Lokasi diupdate!":"Lokasi gudang baru ditambahkan!") : "📨 Diajukan! Menunggu approval TL.");
  }
  async function deleteLokasi(id) {
    if (stocks.some(s=>s.lokasiId===id)) { showToast("Tidak bisa hapus: lokasi ini masih dipakai di Data Stok!","error"); return; }
    if (!window.confirm("Hapus lokasi gudang ini dari Master Data?")) return;
    const isTL = currentUser.role === "TL";
    let nl;
    if (isTL) {
      nl = lokasiList.filter(l=>l.id!==id);
    } else {
      nl = lokasiList.map(l=>l.id===id ? {...l, status:"PENDING", pendingAction:"DELETE", requestedBy:currentUser.id, requestedAt:Date.now()} : l);
    }
    setLokasiList(nl); await syncLokasi(nl);
    showToast(isTL ? "Lokasi dihapus." : "📨 Penghapusan diajukan! Menunggu approval TL.");
  }

  // Simpan 1 entri baru riwayat Maturity Level Gudang (khusus Admin, input manual)
  async function saveMaturityAssessment(form) {
    const entry = { id:`MAT-${uid().slice(-8)}`, level:form.level, catatan:form.catatan||"", tanggalAsesmen:form.tanggalAsesmen||Date.now(), createdBy:currentUser.id, createdAt:Date.now() };
    const nm = [entry, ...maturityAssessments];
    setMaturityAssessments(nm);
    await saveToCloud({maturityAssessments: nm});
    showToast("✅ Asesmen Maturity Level disimpan!");
  }

  // Catat 1 keputusan approval (disetujui/ditolak) ke riwayat — dipakai oleh
  // semua jenis approval non-TUG (TUG sudah punya jejaknya sendiri di txns).
  async function logApprovalHistory(entry) {
    const nh = [{ id:`AH-${uid().slice(-8)}`, decidedBy:currentUser.id, decidedAt:Date.now(), ...entry }, ...approvalHistoryList].slice(0, 300);
    setApprovalHistoryList(nh);
    await saveToCloud({approvalHistoryList: nh});
  }

  // Approve/reject pengajuan perubahan blok lokasi (khusus role TL)
  async function approveLokasiChange(id) {
    const item = lokasiList.find(l=>l.id===id);
    if (!item) return;
    let nl;
    if (item.pendingAction === "DELETE") {
      nl = lokasiList.filter(l=>l.id!==id);
    } else if (item.pendingAction === "EDIT") {
      nl = lokasiList.map(l=>l.id===id ? {...l, ...item.pendingData, status:"APPROVED", pendingAction:null, pendingData:null, approvedBy:currentUser.id, approvedAt:Date.now()} : l);
    } else {
      nl = lokasiList.map(l=>l.id===id ? {...l, status:"APPROVED", pendingAction:null, approvedBy:currentUser.id, approvedAt:Date.now()} : l);
    }
    setLokasiList(nl); await syncLokasi(nl);
    const aksiLabel = {ADD:"Tambah Blok Baru",EDIT:"Ubah Data Blok",DELETE:"Hapus Blok"}[item.pendingAction]||item.pendingAction;
    await logApprovalHistory({type:"LOKASI", decision:"APPROVED", title:`${aksiLabel}: ${item.pendingAction==="EDIT"?item.pendingData?.kode:item.kode}`, requestedBy:item.requestedBy, requestedAt:item.requestedAt});
    showToast("✅ Perubahan Blok Lokasi disetujui.");
  }
  async function rejectLokasiChange(id) {
    const item = lokasiList.find(l=>l.id===id);
    if (!item) return;
    let nl;
    if (item.pendingAction === "ADD") {
      nl = lokasiList.filter(l=>l.id!==id);
    } else {
      nl = lokasiList.map(l=>l.id===id ? {...l, status:"APPROVED", pendingAction:null, pendingData:null} : l);
    }
    setLokasiList(nl); await syncLokasi(nl);
    const aksiLabel = {ADD:"Tambah Blok Baru",EDIT:"Ubah Data Blok",DELETE:"Hapus Blok"}[item.pendingAction]||item.pendingAction;
    await logApprovalHistory({type:"LOKASI", decision:"REJECTED", title:`${aksiLabel}: ${item.pendingAction==="EDIT"?item.pendingData?.kode:item.kode}`, requestedBy:item.requestedBy, requestedAt:item.requestedAt});
    showToast("❌ Perubahan Blok Lokasi ditolak.");
  }

  // Approve/reject pengajuan pemindahan blok Data Stok (khusus role TL) — 1 per 1, bukan bulk
  async function approveStockMove(id) {
    const st = stocks.find(s=>s.id===id);
    if (!st || !st.lokasiMovePending) return;
    const lokSel = lokasiList.find(l=>l.id===st.pendingLokasiId);
    const lokAsal = lokasiList.find(l=>l.id===st.lokasiId);
    const ns = stocks.map(s=>s.id===id ? {...s, lokasiId:st.pendingLokasiId, lokasi:lokSel?.kode||"-", lokasiMovePending:false, pendingLokasiId:null, pendingLokasiKode:null, moveApprovedBy:currentUser.id, moveApprovedAt:Date.now()} : s);
    setStocks(ns); await saveToCloud({stocks:ns});
    await logApprovalHistory({type:"STOCK_MOVE", decision:"APPROVED", title:`${st.name}: ${lokAsal?.kode||"—"} → ${st.pendingLokasiKode}`, requestedBy:st.moveRequestedBy, requestedAt:st.moveRequestedAt});
    showToast(`✅ Pemindahan blok ${st.name} disetujui.`);
  }
  async function rejectStockMove(id) {
    const st = stocks.find(s=>s.id===id);
    if (!st || !st.lokasiMovePending) return;
    const lokAsal = lokasiList.find(l=>l.id===st.lokasiId);
    await logApprovalHistory({type:"STOCK_MOVE", decision:"REJECTED", title:`${st.name}: ${lokAsal?.kode||"—"} → ${st.pendingLokasiKode}`, requestedBy:st.moveRequestedBy, requestedAt:st.moveRequestedAt});
    const ns = stocks.map(s=>s.id===id ? {...s, lokasiMovePending:false, pendingLokasiId:null, pendingLokasiKode:null} : s);
    setStocks(ns); await saveToCloud({stocks:ns});
    showToast(`❌ Pemindahan blok ${st.name} ditolak.`);
  }

  // Kartu kecil untuk 1 Blok Lokasi — dipakai di halaman Master Gudang (per gudang & blok tanpa gudang)
  function renderLokasiCard(l) {
    const used = lokasiUsedCapacity(l.id, stocks);
    const pct = l.kapasitas > 0 ? Math.min(100, (used/l.kapasitas)*100) : 0;
    const barC = pct>=90?C.red:pct>=70?C.yellow:C.green;
    const isPending = l.status==="PENDING";
    return (
      <div key={l.id} style={{...sty.card,borderTop:`3px solid ${isPending?C.yellow:barC}`,opacity:isPending?0.85:1}}>
        <div style={{fontWeight:700,fontSize:14}}>📍 {l.kode} {isPending && <span style={{fontSize:10,fontWeight:700,color:"#92400e",background:"#fef3c7",padding:"1px 6px",borderRadius:6,marginLeft:6}}>⏳ Menunggu Approval ({ {ADD:"Baru",EDIT:"Edit",DELETE:"Hapus"}[l.pendingAction] })</span>}</div>
        <div style={{fontSize:11,color:C.muted,marginTop:2}}>{l.id}</div>
        <div style={{fontSize:11,color:C.muted,marginTop:4}}>{l.keterangan||"-"}</div>
        <div style={{marginTop:10,marginBottom:10}}>
          <div style={{display:"flex",justifyContent:"space-between",fontSize:11,marginBottom:3}}>
            <span style={{fontWeight:600}}>Kapasitas Terpakai</span>
            <span style={{color:barC,fontWeight:700}}>{fmtNum(used)} / {fmtNum(l.kapasitas)}</span>
          </div>
          <div style={{background:"#f3f4f6",borderRadius:20,height:8}}><div style={{width:`${pct}%`,background:barC,height:"100%",borderRadius:20}}/></div>
          {pct>=90 && <div style={{fontSize:10,color:C.red,marginTop:4,fontWeight:600}}>⚠️ Lokasi hampir penuh!</div>}
        </div>
        {currentUser.role==="ADMIN" && (
          <div style={{display:"flex",gap:6}}>
            <button style={{...sty.btn("ghost","sm"),flex:1}} onClick={()=>openEditLokasi(l)} disabled={isPending}>✏️ Edit</button>
            <button style={{...sty.btn("danger","sm"),flex:1}} onClick={()=>deleteLokasi(l.id)} disabled={isPending}>🗑️ Hapus</button>
          </div>
        )}
      </div>
    );
  }

  // ── DATA STOK CRUD (junction: katalog x lokasi, qty/harga/jenis) ──
  function openAddStock() {
    setStockForm({ id:`STK-${uid().slice(-6)}`, katalogId:"", lokasiId:"", qty:0, minQty:0, price:0, jenisBarang:"Cadang", img:null });
    setStockModal("add");
  }
  function openEditStock(s) { setStockForm({...s}); setStockModal("edit"); }
  async function saveStock() {
    if (!stockForm.katalogId) { showToast("Pilih barang dari Master Katalog!","error"); return; }
    if (!stockForm.lokasiId) { showToast("Pilih lokasi dari Master Lokasi!","error"); return; }
    // Foto Nameplate + Foto Keseluruhan wajib diisi, kecuali data hasil import SAP (PEMAT) —
    // data lama itu akan disinkronkan fotonya saat proses import PEMAT berikutnya, bukan di sini.
    if (!stockForm.id?.startsWith("STK-SAP-")) {
      if (!stockForm.fotoNameplate) { showToast("Foto Nameplate wajib diupload!","error"); return; }
      if (!stockForm.fotoKeseluruhan) { showToast("Foto Keseluruhan wajib diupload!","error"); return; }
    }
    // prevent duplicate katalog+lokasi combo (except when editing that same row)
    const dup = stocks.find(s => s.katalogId===stockForm.katalogId && s.lokasiId===stockForm.lokasiId && s.id!==stockForm.id);
    if (dup) { showToast("Kombinasi barang + lokasi ini sudah ada! Edit baris yang sudah ada saja.","error"); return; }
    let ns;
    let wentToApproval = false;
    if (stockModal==="edit") {
      const original = stocks.find(s=>s.id===stockForm.id) || {};
      const isTL = currentUser.role === "TL";
      const fieldsChanged = original.qty!==stockForm.qty || original.price!==stockForm.price || original.jenisBarang!==stockForm.jenisBarang;
      if (fieldsChanged && !isTL) {
        wentToApproval = true;
        // qty/harga/jenis butuh approval TL — field lain (lokasi, minQty, foto) tetap langsung tersimpan
        const updated = {
          ...stockForm,
          qty: original.qty, price: original.price, jenisBarang: original.jenisBarang,
          editPending: true,
          pendingEditData: { qty: stockForm.qty, price: stockForm.price, jenisBarang: stockForm.jenisBarang },
          editRequestedBy: currentUser.id, editRequestedAt: Date.now(),
        };
        ns = stocks.map(s=>s.id===stockForm.id?updated:s);
      } else {
        ns = stocks.map(s=>s.id===stockForm.id?{...stockForm, editPending:false, pendingEditData:null}:s);
      }
    }
    else ns = [...stocks, {...stockForm, createdAt:Date.now()}];
    setStocks(ns); setStockModal(null);
    await saveToCloud({stocks: ns});
    showToast(wentToApproval ? "📨 Perubahan qty/harga/jenis diajukan! Menunggu approval TL." : (stockModal==="edit" ? "Data Stok diupdate!" : "Data Stok baru ditambahkan!"));
  }
  // Upload langsung foto Nameplate/Keseluruhan dari modal detail (klik baris Data Stok) — khusus Admin/TL
  async function updateStockFoto(id, field, img) {
    const ns = stocks.map(s=>s.id===id?{...s,[field]:img}:s);
    setStocks(ns);
    await saveToCloud({stocks: ns});
    showToast(`📷 ${field==="fotoNameplate"?"Foto Nameplate":"Foto Keseluruhan"} diperbarui!`);
  }
  async function deleteStock(id) {
    if (!window.confirm("Hapus baris stok ini?")) return;
    const isTL = currentUser.role === "TL";
    if (isTL) {
      const ns = stocks.filter(s=>s.id!==id);
      setStocks(ns); await saveToCloud({stocks: ns}); showToast("Data Stok dihapus.");
    } else {
      const st = stocks.find(s=>s.id===id);
      const ns = stocks.map(s=>s.id===id ? {...s, deletePending:true, deleteRequestedBy:currentUser.id, deleteRequestedAt:Date.now()} : s);
      setStocks(ns); await saveToCloud({stocks: ns});
      showToast(`📨 Penghapusan ${st?.name||""} diajukan! Menunggu approval TL.`);
    }
  }

  // Approve/reject pengajuan Edit (qty/harga/jenis) Data Stok — khusus TL
  async function approveStockEdit(id) {
    const st = stocks.find(s=>s.id===id);
    if (!st || !st.editPending) return;
    const ns = stocks.map(s=>s.id===id ? {...s, ...s.pendingEditData, editPending:false, pendingEditData:null, editApprovedBy:currentUser.id, editApprovedAt:Date.now()} : s);
    setStocks(ns); await saveToCloud({stocks: ns});
    await logApprovalHistory({type:"STOCK_EDIT", decision:"APPROVED", title:`Edit ${st.name}: qty ${fmtNum(st.qty)}→${fmtNum(st.pendingEditData.qty)}, harga Rp${fmtNum(st.price)}→Rp${fmtNum(st.pendingEditData.price)}, jenis ${st.jenisBarang}→${st.pendingEditData.jenisBarang}`, requestedBy:st.editRequestedBy, requestedAt:st.editRequestedAt});
    showToast(`✅ Perubahan ${st.name} disetujui.`);
  }
  async function rejectStockEdit(id) {
    const st = stocks.find(s=>s.id===id);
    if (!st || !st.editPending) return;
    const ns = stocks.map(s=>s.id===id ? {...s, editPending:false, pendingEditData:null} : s);
    setStocks(ns); await saveToCloud({stocks: ns});
    await logApprovalHistory({type:"STOCK_EDIT", decision:"REJECTED", title:`Edit ${st.name} ditolak`, requestedBy:st.editRequestedBy, requestedAt:st.editRequestedAt});
    showToast(`❌ Perubahan ${st.name} ditolak.`);
  }

  // Approve/reject pengajuan Hapus Data Stok — khusus TL
  async function approveStockDelete(id) {
    const st = stocks.find(s=>s.id===id);
    if (!st || !st.deletePending) return;
    const ns = stocks.filter(s=>s.id!==id);
    setStocks(ns); await saveToCloud({stocks: ns});
    await logApprovalHistory({type:"STOCK_DELETE", decision:"APPROVED", title:`Hapus ${st.name}`, requestedBy:st.deleteRequestedBy, requestedAt:st.deleteRequestedAt});
    showToast(`✅ Penghapusan ${st.name} disetujui.`);
  }
  async function rejectStockDelete(id) {
    const st = stocks.find(s=>s.id===id);
    if (!st || !st.deletePending) return;
    const ns = stocks.map(s=>s.id===id ? {...s, deletePending:false, deleteRequestedBy:null, deleteRequestedAt:null} : s);
    setStocks(ns); await saveToCloud({stocks: ns});
    await logApprovalHistory({type:"STOCK_DELETE", decision:"REJECTED", title:`Hapus ${st.name} ditolak`, requestedBy:st.deleteRequestedBy, requestedAt:st.deleteRequestedAt});
    showToast(`❌ Penghapusan ${st.name} ditolak.`);
  }

  // ── Satpam CRUD ──
  function openAddSatpam() { setSatpamForm({ id:"SP"+uid().slice(-6), name:"", telp:"" }); setSatpamModal("add"); }
  function openEditSatpam(sp) { setSatpamForm({...sp}); setSatpamModal("edit"); }
  async function saveSatpam() {
    if (!satpamForm.name?.trim()) { showToast("Nama Satpam tidak boleh kosong!","error"); return; }
    let nsp;
    if (satpamModal==="edit") nsp = satpamList.map(s=>s.id===satpamForm.id?{...satpamForm}:s);
    else nsp = [...satpamList, {...satpamForm, createdAt:Date.now()}];
    setSatpamList(nsp); setSatpamModal(null);
    await syncMasterTable("satpam", nsp);
    showToast(satpamModal==="edit" ? "Data Satpam diupdate!" : "Satpam baru ditambahkan!");
  }
  async function deleteSatpam(id) {
    if (!window.confirm("Hapus Satpam ini dari daftar?")) return;
    const nsp = satpamList.filter(s=>s.id!==id);
    setSatpamList(nsp); await syncMasterTable("satpam", nsp); showToast("Satpam dihapus.");
  }

  // ── Master Tim Mutu CRUD (2 paket TETAP — hanya edit anggota, tidak tambah/hapus paket) ──
  function openEditTimMutu(tm) { setTimMutuForm({...tm}); setTimMutuModal("edit"); }
  async function saveTimMutu() {
    const ntm = timMutuList.map(t=>t.id===timMutuForm.id?{...timMutuForm}:t);
    setTimMutuList(ntm); setTimMutuModal(null);
    await syncMasterTable("tim_mutu", ntm);
    showToast("Paket Tim Mutu diupdate!");
  }

  // ── Master UIT CRUD ──
  function openAddUIT() { setUitForm({id:"UIT-"+uid().slice(-6).toUpperCase(), nama:"", kode:"", alamat:"", createdAt:Date.now()}); setUitModal("add"); }
  function openEditUIT(u) { setUitForm({...u}); setUitModal("edit"); }
  async function saveUIT() {
    if (!uitForm.nama?.trim()||!uitForm.kode?.trim()) { showToast("Nama dan Kode UIT wajib diisi!","error"); return; }
    const nu = uitModal==="add" ? [...uitList, uitForm] : uitList.map(u=>u.id===uitForm.id?uitForm:u);
    setUitList(nu); setUitModal(null);
    await syncMasterTable("uit", nu);
    showToast(uitModal==="add"?"UIT ditambahkan!":"UIT diupdate!");
  }
  async function deleteUIT(id) {
    if (!window.confirm("Hapus UIT ini?")) return;
    const nu = uitList.filter(u=>u.id!==id);
    setUitList(nu); await syncMasterTable("uit", nu); showToast("UIT dihapus.");
  }

  // ── Master ULTG CRUD (unit di bawah UPT) ──
  function syncUltg(nu) { return syncMasterTable("ultg", nu, u => ({ upt_id: u.parentUptId || null })); }
  function openAddULTG(presetUptId) { setUltgForm({id:"ULTG-"+uid().slice(-6).toUpperCase(), nama:"", kode:"", parentUptId: presetUptId || uptList[0]?.id||"", createdAt:Date.now()}); setUltgModal("add"); }
  function openEditULTG(u) { setUltgForm({...u}); setUltgModal("edit"); }
  async function saveULTG() {
    if (!ultgForm.nama?.trim()||!ultgForm.kode?.trim()) { showToast("Nama dan Kode ULTG wajib diisi!","error"); return; }
    if (!ultgForm.parentUptId) { showToast("Pilih UPT induk!","error"); return; }
    const nu = ultgModal==="add" ? [...ultgList, ultgForm] : ultgList.map(u=>u.id===ultgForm.id?ultgForm:u);
    setUltgList(nu); setUltgModal(null);
    await syncUltg(nu);
    showToast(ultgModal==="add"?"ULTG ditambahkan!":"ULTG diupdate!");
  }
  async function deleteULTG(id) {
    if (!window.confirm("Hapus ULTG ini?")) return;
    const nu = ultgList.filter(u=>u.id!==id);
    setUltgList(nu); await syncUltg(nu); showToast("ULTG dihapus.");
  }

  // ── Master UPT CRUD ──
  function openAddUPT(presetUitId) { setUptForm({id:"UPT-"+uid().slice(-6).toUpperCase(), nama:"", kode:"", alamat:"", uitId: presetUitId || uitList[0]?.id||"", createdAt:Date.now()}); setUptModal("add"); }
  function openEditUPT(u) { setUptForm({...u}); setUptModal("edit"); }
  function syncUpt(nu) { return syncMasterTable("upt", nu, u => ({ uit_id: u.uitId || null })); }
  async function saveUPT() {
    if (!uptForm.nama?.trim()||!uptForm.kode?.trim()) { showToast("Nama dan Kode UPT wajib diisi!","error"); return; }
    const nu = uptModal==="add" ? [...uptList, uptForm] : uptList.map(u=>u.id===uptForm.id?uptForm:u);
    setUptList(nu); setUptModal(null);
    await syncUpt(nu);
    showToast(uptModal==="add"?"UPT ditambahkan!":"UPT diupdate!");
  }
  async function deleteUPT(id) {
    if (!window.confirm("Hapus UPT ini?")) return;
    const nu = uptList.filter(u=>u.id!==id);
    setUptList(nu); await syncUpt(nu); showToast("UPT dihapus.");
  }

  // ── Master Gudang CRUD ──
  const [gudangModal, setGudangModal] = useState(null);
  const [maturityModal, setMaturityModal] = useState(false);
  const [maturityForm, setMaturityForm] = useState({ level:3, catatan:"", tanggalAsesmen:Date.now() });
  const [gudangForm, setGudangForm] = useState({});
  const [denahLoading, setDenahLoading] = useState(false);
  const [mapConfigMode, setMapConfigMode] = useState(false);
  const [mapConfigGudangId, setMapConfigGudangId] = useState(null);
  const [pendingMapLokasi, setPendingMapLokasi] = useState(null);
  const [expandedGudangId, setExpandedGudangId] = useState(null); // accordion: hanya 1 gudang terbuka sekaligus di Master Gudang
  const [gudangWizardStep, setGudangWizardStep] = useState(1); // 1=Data Gudang, 2=Upload Denah, 3=Tambah Blok (hanya untuk mode "add")
  const [wizardBlokDraft, setWizardBlokDraft] = useState(null); // {kode,keterangan,kapasitas,xPct,yPct} saat klik titik di denah pada wizard step 3
  const [manualAddMode, setManualAddMode] = useState(false); // mode "Tambah Blok Baru" di Konfigurasi Koordinat Blok: klik di peta menambah draft usulan (belum dikirim ke TL)

  function openAddGudang() { setGudangForm({id:"GDG-"+uid().slice(-6), nama:"", kode:"", alamat:"", uptId:uptList[0]?.id||"", denahImageData:null, denahUploadedAt:null, createdAt:Date.now()}); setGudangModal("add"); setGudangWizardStep(1); setWizardBlokDraft(null); }
  function openEditGudang(g) { setGudangForm({...g}); setGudangModal("edit"); }
  function closeGudangWizard() { setGudangModal(null); setGudangWizardStep(1); setWizardBlokDraft(null); }
  function syncGudang(ng) { return syncMasterTable("gudang", ng, g => ({ upt_id: g.uptId || null })); }
  function syncSubGudang(nsg) { return syncMasterTable("sub_gudang", nsg, sg => ({ gudang_id: sg.gudangId || null })); }

  // Cari Master UPT yang cocok dengan label string UPT dari laporan kapasitas (fuzzy, uppercase)
  function findMatchingUpt(uptLabel) {
    const needle = String(uptLabel||"").trim().toUpperCase();
    if (!needle) return null;
    return uptList.find(u =>
      String(u.nama||"").toUpperCase().includes(needle) ||
      needle.includes(String(u.nama||"").toUpperCase().replace(/^UPT\s+/,"")) ||
      String(u.kode||"").toUpperCase()===needle
    ) || null;
  }

  // Auto-create/merge Master Gudang + Sub Gudang dari record kapasitas yang disetujui.
  // Data yang sudah ada (manual atau dari import sebelumnya) TIDAK di-overwrite,
  // hanya alamat kosong yang dilengkapi. UPT yang tidak match di-skip + dilaporkan.
  function syncGudangCapacityToMasterGudang(records) {
    let gList = [...gudangList];
    let sgList = [...subGudangList];
    const created = [];
    const createdSub = [];
    const skippedNoUpt = [];
    const uniqueRows = new Map(); // key: "UPT|GUDANG|SUBGUDANG" -> record
    records.forEach(r => {
      const key = `${r.upt}|${r.gudang}|${r.subGudang}`;
      if (!uniqueRows.has(key)) uniqueRows.set(key, r);
    });
    uniqueRows.forEach(r => {
      const uptMatch = findMatchingUpt(r.upt);
      if (!uptMatch) { skippedNoUpt.push(`${r.upt} / ${r.gudang}`); return; }

      let gudangEntry = gList.find(g => g.uptId===uptMatch.id && String(g.nama||"").trim().toUpperCase()===String(r.gudang||"").trim().toUpperCase());
      if (gudangEntry) {
        const patch = {};
        if (!gudangEntry.alamat && r.alamat) patch.alamat = r.alamat;
        if (gudangEntry.lat == null && r.latitude != null) patch.lat = r.latitude;
        if (gudangEntry.lng == null && r.longitude != null) patch.lng = r.longitude;
        if (Object.keys(patch).length) {
          gList = gList.map(g => g.id===gudangEntry.id ? {...g, ...patch} : g);
          gudangEntry = {...gudangEntry, ...patch};
        }
      } else {
        gudangEntry = {
          id: `GDG-CAP-${r.upt}-${r.gudang}`.replace(/\s+/g,"-").toUpperCase(),
          nama: r.gudang, kode: "", alamat: r.alamat||"", uptId: uptMatch.id,
          lat: r.latitude ?? null, lng: r.longitude ?? null,
          denahImageData: null, denahUploadedAt: null, createdAt: Date.now(),
          sourceCapacityImport: true,
        };
        gList.push(gudangEntry);
        created.push(r.gudang);
      }

      if (!r.subGudang) return;
      const existingSub = sgList.find(sg => sg.gudangId===gudangEntry.id && String(sg.nama||"").trim().toUpperCase()===String(r.subGudang||"").trim().toUpperCase());
      if (!existingSub) {
        sgList.push({
          id: `SGD-CAP-${r.upt}-${r.gudang}-${r.subGudang}`.replace(/\s+/g,"-").toUpperCase(),
          nama: r.subGudang, gudangId: gudangEntry.id, createdAt: Date.now(),
          sourceCapacityImport: true,
        });
        createdSub.push(r.subGudang);
      }
    });
    return { gList, sgList, created, createdSub, skippedNoUpt };
  }

  // Sinkron ulang koordinat lat/lng + alamat Master Gudang dari data Kapasitas Gudang yang
  // sudah live (gudangCapacityList) — dipakai saat data lama sudah live tapi lat/lng belum
  // sempat ikut ke Master Gudang (mis. dibuat sebelum field koordinat ditambahkan).
  async function backfillGudangCoordFromCapacity() {
    if (!gudangCapacityList.length) { showToast("Belum ada data Kapasitas Gudang live.", "error"); return; }
    const { gList: newGudangList, sgList: newSubGudangList } = syncGudangCapacityToMasterGudang(gudangCapacityList);
    setGudangList(newGudangList);
    setSubGudangList(newSubGudangList);
    await syncGudang(newGudangList);
    await syncSubGudang(newSubGudangList);
    showToast("✅ Koordinat & data Master Gudang disinkron ulang dari Kapasitas Gudang.", "success");
  }

  // Gabungkan Gudang/Sub Gudang duplikat (nama sama, ID beda — biasanya karena satu dibuat manual
  // dan satu lagi otomatis dari import Kapasitas Gudang). Ini penyebab umum denah/koordinat "hilang":
  // datanya nyasar ke ID duplikat yang sedang tidak ditampilkan. Blok Lokasi & Sub Gudang direassign
  // ke ID "primary" yang dipilih (prioritas: sudah punya denah > sudah punya koordinat > paling lama).
  async function dedupeGudangDanSubGudang() {
    const norm = s => String(s||"").trim().toUpperCase().replace(/\s+/g," ");
    let newGudangList = [...gudangList];
    let newSubGudangList = [...subGudangList];
    let newLokasiList = [...lokasiList];
    let mergedGudang = 0, mergedSub = 0;

    const gGroups = new Map();
    gudangList.forEach(g => {
      const key = `${g.uptId||""}|${norm(g.nama)}`;
      if (!gGroups.has(key)) gGroups.set(key, []);
      gGroups.get(key).push(g);
    });
    gGroups.forEach(list => {
      if (list.length <= 1) return;
      mergedGudang += list.length - 1;
      const primary = [...list].sort((a,b) => {
        const scoreA = (a.denahImageData?2:0)+(a.lat!=null?1:0);
        const scoreB = (b.denahImageData?2:0)+(b.lat!=null?1:0);
        if (scoreA !== scoreB) return scoreB - scoreA;
        return (a.createdAt||0) - (b.createdAt||0);
      })[0];
      const losers = list.filter(g=>g.id!==primary.id);
      const loserIds = new Set(losers.map(g=>g.id));
      let merged = {...primary};
      losers.forEach(l => {
        if (!merged.denahImageData && l.denahImageData) { merged.denahImageData=l.denahImageData; merged.denahUploadedAt=l.denahUploadedAt; merged.denahOcrWords=l.denahOcrWords; }
        if (merged.lat == null && l.lat != null) { merged.lat=l.lat; merged.lng=l.lng; }
        if (!merged.alamat && l.alamat) merged.alamat = l.alamat;
        if (!merged.kode && l.kode) merged.kode = l.kode;
      });
      newGudangList = newGudangList.filter(g=>!loserIds.has(g.id)).map(g=>g.id===primary.id?merged:g);
      newLokasiList = newLokasiList.map(l => loserIds.has(l.gudangId) ? {...l, gudangId: primary.id} : l);
      newSubGudangList = newSubGudangList.map(sg => loserIds.has(sg.gudangId) ? {...sg, gudangId: primary.id} : sg);
    });

    const sgGroups = new Map();
    newSubGudangList.forEach(sg => {
      const key = `${sg.gudangId}|${norm(sg.nama)}`;
      if (!sgGroups.has(key)) sgGroups.set(key, []);
      sgGroups.get(key).push(sg);
    });
    sgGroups.forEach(list => {
      if (list.length <= 1) return;
      mergedSub += list.length - 1;
      const primary = [...list].sort((a,b) => {
        const scoreA = a.denahImageData?1:0, scoreB = b.denahImageData?1:0;
        if (scoreA !== scoreB) return scoreB - scoreA;
        return (a.createdAt||0) - (b.createdAt||0);
      })[0];
      const losers = list.filter(sg=>sg.id!==primary.id);
      const loserIds = new Set(losers.map(sg=>sg.id));
      let merged = {...primary};
      losers.forEach(l => { if (!merged.denahImageData && l.denahImageData) { merged.denahImageData=l.denahImageData; merged.denahUploadedAt=l.denahUploadedAt; merged.denahOcrWords=l.denahOcrWords; } });
      newSubGudangList = newSubGudangList.filter(sg=>!loserIds.has(sg.id)).map(sg=>sg.id===primary.id?merged:sg);
      newLokasiList = newLokasiList.map(l => loserIds.has(l.subGudangId) ? {...l, subGudangId: primary.id} : l);
    });

    if (mergedGudang===0 && mergedSub===0) { showToast("Tidak ada Gudang/Sub Gudang duplikat ditemukan.", "success"); return; }

    setGudangList(newGudangList);
    setSubGudangList(newSubGudangList);
    setLokasiList(newLokasiList);
    await syncGudang(newGudangList);
    await syncSubGudang(newSubGudangList);
    await syncLokasi(newLokasiList);
    showToast(`✅ ${mergedGudang} Gudang duplikat & ${mergedSub} Sub Gudang duplikat digabungkan.`, "success");
  }

  async function approveCapacityImport(importId) {
    const imp = gudangCapacityImports.find(i=>i.id===importId);
    if (!imp) return;
    const newList = imp.records.map(r => ({...r, importBatchId: imp.id}));
    const newImports = gudangCapacityImports.map(i => i.id===importId
      ? {...i, status:"APPROVED", approvedBy:currentUser.id, approvedAt:Date.now()} : i);
    const { gList: newGudangList, sgList: newSubGudangList, created, createdSub, skippedNoUpt } = syncGudangCapacityToMasterGudang(newList);
    setGudangCapacityList(newList);
    setGudangCapacityImports(newImports);
    setGudangList(newGudangList);
    setSubGudangList(newSubGudangList);
    await saveToCloud({ gudangCapacityList: newList, gudangCapacityImports: newImports });
    await syncGudang(newGudangList);
    await syncSubGudang(newSubGudangList);
    await logApprovalHistory({ type:"KAPASITAS_GUDANG_IMPORT", refId:imp.id, decision:"APPROVED", note:`${imp.sourceFile} — ${newList.length} record, ${created.length} Gudang + ${createdSub.length} Sub Gudang baru` });
    let msg = `Import disetujui — ${newList.length} record kapasitas gudang kini live.`;
    if (created.length || createdSub.length) msg += ` ${created.length} Gudang, ${createdSub.length} Sub Gudang baru dibuat otomatis.`;
    showToast(msg, "success");
    if (skippedNoUpt.length) {
      showToast(`⚠️ ${skippedNoUpt.length} gudang di-skip dari Master Gudang (UPT tidak dikenal): ${skippedNoUpt.slice(0,3).join(", ")}${skippedNoUpt.length>3?"...":""}`, "error");
    }
  }

  async function rejectCapacityImport(importId, reason) {
    const imp = gudangCapacityImports.find(i=>i.id===importId);
    if (!imp) return;
    const newImports = gudangCapacityImports.map(i => i.id===importId
      ? {...i, status:"REJECTED", rejectedBy:currentUser.id, rejectedAt:Date.now(), rejectReason:reason} : i);
    setGudangCapacityImports(newImports);
    await saveToCloud({ gudangCapacityImports: newImports });
    await logApprovalHistory({ type:"KAPASITAS_GUDANG_IMPORT", refId:imp.id, decision:"REJECTED", note:reason });
    showToast("Import ditolak.", "success");
  }
  async function saveGudang() {
    if (!gudangForm.nama?.trim()) { showToast("Nama Gudang wajib diisi!","error"); return; }
    const ng = gudangModal==="add" ? [...gudangList, gudangForm] : gudangList.map(g=>g.id===gudangForm.id?gudangForm:g);
    setGudangList(ng); setGudangModal(null);
    await syncGudang(ng);
    showToast(gudangModal==="add"?"Gudang ditambahkan!":"Gudang diupdate!");
  }
  // Step 1 wizard: simpan data gudang lalu lanjut ke Step 2 (upload denah) tanpa menutup modal
  async function gudangWizardNext() {
    if (!gudangForm.nama?.trim()) { showToast("Nama Gudang wajib diisi!","error"); return; }
    const exists = gudangList.some(g=>g.id===gudangForm.id);
    const ng = exists ? gudangList.map(g=>g.id===gudangForm.id?gudangForm:g) : [...gudangList, gudangForm];
    setGudangList(ng);
    await syncGudang(ng);
    setGudangWizardStep(2);
  }
  async function deleteGudang(id) {
    if (!window.confirm("Hapus gudang ini? Koordinat blok yang terkait akan hilang.")) return;
    const ng = gudangList.filter(g=>g.id!==id);
    setGudangList(ng); await syncGudang(ng); showToast("Gudang dihapus.");
  }
  // Tambah blok langsung dari klik titik di denah pada wizard step 3 (tanpa modal Lokasi terpisah)
  async function addWizardBlok() {
    if (!wizardBlokDraft?.kode?.trim()) { showToast("Kode blok tidak boleh kosong!","error"); return; }
    if (isKodeDuplicateInGudang(wizardBlokDraft.kode, gudangForm.id, null)) {
      showToast(`Kode blok "${wizardBlokDraft.kode}" sudah dipakai di gudang ini!`,"error"); return;
    }
    const isTL = currentUser.role === "TL";
    const baru = {
      id: `LOK-${uid().slice(-6)}`,
      kode: wizardBlokDraft.kode.trim(), keterangan: wizardBlokDraft.keterangan||"", kapasitas: wizardBlokDraft.kapasitas||50,
      mapX: wizardBlokDraft.xPct, mapY: wizardBlokDraft.yPct, gudangId: gudangForm.id,
      createdAt: Date.now(),
      status: isTL ? "APPROVED" : "PENDING",
      pendingAction: isTL ? null : "ADD",
      requestedBy: currentUser.id, requestedAt: Date.now(),
    };
    const nl = [...lokasiList, baru];
    setLokasiList(nl);
    await syncLokasi(nl);
    setWizardBlokDraft(null);
    showToast(isTL ? "✅ Blok ditambahkan!" : "📨 Blok diajukan! Menunggu approval TL.");
  }

  // Upload gambar denah gudang (PNG/JPG) — kompres otomatis jika > 1MB
  async function uploadDenahGudang(gudangId, file) {
    setDenahLoading(true);
    try {
      const imgData = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = ev => {
          const img = new Image();
          img.onload = () => {
            // Target max dimension 1400px, JPEG 80% — menghasilkan ~300-800KB
            const maxDim = 1400;
            let w = img.width, h = img.height;
            if (w > maxDim || h > maxDim) {
              const ratio = Math.min(maxDim/w, maxDim/h);
              w = Math.round(w * ratio);
              h = Math.round(h * ratio);
            }
            const canvas = document.createElement("canvas");
            canvas.width = w; canvas.height = h;
            canvas.getContext("2d").drawImage(img, 0, 0, w, h);
            resolve(canvas.toDataURL("image/jpeg", 0.80));
          };
          img.onerror = () => reject(new Error("Gagal membaca gambar"));
          img.src = ev.target.result;
        };
        reader.onerror = () => reject(new Error("Gagal membaca file"));
        reader.readAsDataURL(file);
      });
      const ng = gudangList.map(g=>g.id===gudangId ? {...g, denahImageData:imgData, denahUploadedAt:Date.now(), denahOcrWords:null} : g);
      setGudangList(ng);
      await syncGudang(ng);
      showToast("✅ Denah gudang berhasil diupload! Membaca label blok di gambar...");
      await runOcrOnDenah(gudangId, imgData);
    } catch(e) {
      showToast("Gagal upload denah: " + e.message, "error");
    } finally {
      setDenahLoading(false);
    }
  }

  // Baca teks/label blok yang sudah tergambar di PNG denah (OCR) supaya
  // sistem bisa mengusulkan kode blok otomatis saat user klik titik di peta.
  async function runOcrOnDenah(gudangId, imgData) {
    try {
      const img = await new Promise((resolve, reject) => {
        const im = new Image();
        im.onload = () => resolve(im);
        im.onerror = () => reject(new Error("Gagal membaca dimensi gambar"));
        im.src = imgData;
      });
      const { data } = await ocrRecognize(imgData, "eng");
      const words = (data.words || [])
        .filter(w => w.text && w.text.trim().length > 0)
        .map(w => ({
          text: w.text.trim(),
          xPct: Number((((w.bbox.x0 + w.bbox.x1) / 2) / img.naturalWidth * 100).toFixed(1)),
          yPct: Number((((w.bbox.y0 + w.bbox.y1) / 2) / img.naturalHeight * 100).toFixed(1)),
        }));
      // Pakai stateRef.current.gudangList (selalu terkini), bukan closure `gudangList` yang
      // sudah usang setelah OCR (proses beberapa detik) — kalau pakai closure lama, hasilnya
      // menimpa balik denahImageData yang baru diset di uploadDenahGudang sehingga gambar hilang.
      const ng2 = stateRef.current.gudangList.map(g => g.id === gudangId ? { ...g, denahOcrWords: words } : g);
      setGudangList(ng2);
      await syncGudang(ng2);

      // Usulkan blok batch dari semua label yang terbaca (filter noise teks pendek/simbol)
      const suggestions = words
        .filter(w => w.text.replace(/[^A-Za-z0-9]/g,"").length >= 2)
        .slice(0, 40)
        .map(w => ({ id: uid(), kode: w.text.toUpperCase().replace(/[^A-Z0-9]/g,""), jenisArea:"Rak Tertutup", luasan:"", xPct: w.xPct, yPct: w.yPct, checked: true }));
      setOcrSuggestions(suggestions);
      setOcrSuggestGudangId(gudangId);

      showToast(words.length > 0 ? `🔎 OCR selesai: ${words.length} label terbaca, ${suggestions.length} diusulkan jadi blok.` : "🔎 OCR selesai, tidak ada teks terbaca di denah.");
    } catch (e) {
      showToast("OCR gagal membaca label di denah: " + e.message, "error");
    }
  }

  // Edit/hapus baris usulan blok hasil OCR sebelum dikonfirmasi
  function updateOcrSuggestion(id, patch) {
    setOcrSuggestions(s => s.map(x => x.id===id ? {...x, ...patch} : x));
  }
  function removeOcrSuggestion(id) {
    setOcrSuggestions(s => s.filter(x => x.id!==id));
  }
  function dismissOcrSuggestions() {
    setOcrSuggestions([]); setOcrSuggestGudangId(null); setOcrSuggestSubGudangId(null);
  }
  // Konfirmasi: usulan yang dicentang ditambahkan ke Master Lokasi (kena alur approval TL).
  // subGudangId non-null = usulan berasal dari denah Sub Gudang -> koordinat disimpan di
  // subMapX/subMapY (bukan mapX/mapY yang dipakai denah Gudang keseluruhan).
  async function confirmOcrSuggestions(gudangId, subGudangId=null) {
    const isTL = currentUser.role === "TL";
    const checked = ocrSuggestions.filter(s => s.checked);
    if (checked.length === 0) { showToast("Tidak ada usulan yang dicentang.","error"); return; }
    if (checked.some(s => !s.kode.trim())) { showToast("Nama Area wajib diisi untuk semua usulan yang dicentang!","error"); return; }

    // Saring duplikat kode: terhadap blok yang sudah ada di gudang ini, DAN antar sesama usulan yang dicentang.
    const seenInBatch = new Set();
    const valid = [], duplikat = [];
    checked.forEach(s => {
      const norm = s.kode.trim().toLowerCase();
      if (seenInBatch.has(norm) || isKodeDuplicateInGudang(s.kode, gudangId, null)) {
        duplikat.push(s.kode);
      } else {
        seenInBatch.add(norm);
        valid.push(s);
      }
    });
    if (valid.length === 0) { showToast("Semua usulan terpilih duplikat kode dengan blok yang sudah ada di gudang ini.","error"); return; }

    const baru = valid.map(s => ({
      id: `LOK-${uid().slice(-6)}`,
      kode: s.kode.trim(), keterangan: "", kapasitas: 50,
      jenisArea: s.jenisArea||"Rak Tertutup", luasan: s.luasan||"",
      ...(subGudangId ? { subMapX: s.xPct, subMapY: s.yPct, subGudangId } : { mapX: s.xPct, mapY: s.yPct }),
      gudangId,
      createdAt: Date.now(),
      status: isTL ? "APPROVED" : "PENDING",
      pendingAction: isTL ? null : "ADD",
      requestedBy: currentUser.id, requestedAt: Date.now(),
    }));
    const nl = [...lokasiList, ...baru];
    setLokasiList(nl);
    await syncLokasi(nl);
    setOcrSuggestions(s => s.filter(x => !checked.includes(x)));
    const dupMsg = duplikat.length ? ` (${duplikat.length} dilewati karena duplikat kode: ${duplikat.join(", ")})` : "";
    showToast((isTL ? `✅ ${baru.length} blok ditambahkan!` : `📨 ${baru.length} blok diajukan! Menunggu approval TL.`) + dupMsg);
  }

  // Cari label OCR terdekat dari titik klik untuk diusulkan sebagai kode blok.
  function suggestKodeFromOcr(gudang, xPct, yPct) {
    const words = gudang?.denahOcrWords || [];
    if (words.length === 0) return "";
    let best = null, bestDist = Infinity;
    words.forEach(w => {
      const dx = w.xPct - xPct, dy = w.yPct - yPct;
      const dist = dx*dx + dy*dy;
      if (dist < bestDist) { bestDist = dist; best = w; }
    });
    return best ? best.text.toUpperCase().replace(/[^A-Z0-9]/g,"") : "";
  }

  // Assign koordinat blok via klik di gambar denah
  async function assignLokasiKoordinat(lokasiId, xPct, yPct, gudangId) {
    const nl = lokasiList.map(l=>l.id===lokasiId ? {...l, mapX:xPct, mapY:yPct, gudangId} : l);
    setLokasiList(nl);
    await syncLokasi(nl);
    showToast(`📍 Koordinat Blok disimpan!`);
  }

  async function resetLokasiKoordinat(lokasiId) {
    const nl = lokasiList.map(l=>l.id===lokasiId ? {...l, mapX:null, mapY:null, gudangId:null} : l);
    setLokasiList(nl);
    await syncLokasi(nl);
    showToast("Koordinat blok direset.");
  }

  // Assign koordinat blok via klik di denah Sub Gudang (terpisah dari mapX/mapY denah Gudang keseluruhan)
  async function assignLokasiKoordinatSub(lokasiId, xPct, yPct, subGudangId, gudangId) {
    const nl = lokasiList.map(l=>l.id===lokasiId ? {...l, subMapX:xPct, subMapY:yPct, subGudangId, gudangId} : l);
    setLokasiList(nl);
    await syncLokasi(nl);
    showToast(`📍 Koordinat Blok (Sub Gudang) disimpan!`);
  }

  // Reset hanya koordinat pin di denah Sub Gudang — assignment subGudangId (pengelompokan) tidak ikut dihapus
  async function resetLokasiKoordinatSub(lokasiId) {
    const nl = lokasiList.map(l=>l.id===lokasiId ? {...l, subMapX:null, subMapY:null} : l);
    setLokasiList(nl);
    await syncLokasi(nl);
    showToast("Koordinat blok (Sub Gudang) direset.");
  }

  async function uploadDenahSubGudang(subGudangId, gudangId, file) {
    setDenahSubLoading(true);
    try {
      const imgData = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = ev => {
          const img = new Image();
          img.onload = () => {
            const maxDim = 1400;
            let w = img.width, h = img.height;
            if (w > maxDim || h > maxDim) {
              const ratio = Math.min(maxDim/w, maxDim/h);
              w = Math.round(w * ratio);
              h = Math.round(h * ratio);
            }
            const canvas = document.createElement("canvas");
            canvas.width = w; canvas.height = h;
            canvas.getContext("2d").drawImage(img, 0, 0, w, h);
            resolve(canvas.toDataURL("image/jpeg", 0.80));
          };
          img.onerror = () => reject(new Error("Gagal membaca gambar"));
          img.src = ev.target.result;
        };
        reader.onerror = () => reject(new Error("Gagal membaca file"));
        reader.readAsDataURL(file);
      });
      const nsg = subGudangList.map(sg=>sg.id===subGudangId ? {...sg, denahImageData:imgData, denahUploadedAt:Date.now(), denahOcrWords:null} : sg);
      setSubGudangList(nsg);
      await syncSubGudang(nsg);
      showToast("✅ Denah Sub Gudang berhasil diupload! Membaca label blok di gambar...");
      await runOcrOnDenahSub(subGudangId, gudangId, imgData);
    } catch(e) {
      showToast("Gagal upload denah: " + e.message, "error");
    } finally {
      setDenahSubLoading(false);
    }
  }

  async function runOcrOnDenahSub(subGudangId, gudangId, imgData) {
    try {
      const img = await new Promise((resolve, reject) => {
        const im = new Image();
        im.onload = () => resolve(im);
        im.onerror = () => reject(new Error("Gagal membaca dimensi gambar"));
        im.src = imgData;
      });
      const { data } = await ocrRecognize(imgData, "eng");
      const words = (data.words || [])
        .filter(w => w.text && w.text.trim().length > 0)
        .map(w => ({
          text: w.text.trim(),
          xPct: Number((((w.bbox.x0 + w.bbox.x1) / 2) / img.naturalWidth * 100).toFixed(1)),
          yPct: Number((((w.bbox.y0 + w.bbox.y1) / 2) / img.naturalHeight * 100).toFixed(1)),
        }));
      const nsg2 = stateRef.current.subGudangList.map(sg => sg.id === subGudangId ? { ...sg, denahOcrWords: words } : sg);
      setSubGudangList(nsg2);
      await syncSubGudang(nsg2);

      const suggestions = words
        .filter(w => w.text.replace(/[^A-Za-z0-9]/g,"").length >= 2)
        .slice(0, 40)
        .map(w => ({ id: uid(), kode: w.text.toUpperCase().replace(/[^A-Z0-9]/g,""), jenisArea:"Rak Tertutup", luasan:"", xPct: w.xPct, yPct: w.yPct, checked: true }));
      setOcrSuggestions(suggestions);
      setOcrSuggestGudangId(gudangId);
      setOcrSuggestSubGudangId(subGudangId);

      showToast(words.length > 0 ? `🔎 OCR selesai: ${words.length} label terbaca, ${suggestions.length} diusulkan jadi blok.` : "🔎 OCR selesai, tidak ada teks terbaca di denah.");
    } catch (e) {
      showToast("OCR gagal membaca label di denah: " + e.message, "error");
    }
  }

  const [importSAPModal, setImportSAPModal] = useState(false);

  // ── Import SAP (PEMAT CSV) → Master Katalog + Data Stok ──
  async function importFromSAP(sapRows) {
    let newKatalogList = [...katalogList];
    let newStocks = [];

    sapRows.forEach(row => {
      if (!row.katalog) return;
      let kat = newKatalogList.find(k=>k.katalog===row.katalog);
      if (!kat) {
        kat = {
          id: "KAT-"+row.katalog,
          name: row.nama,
          katalog: row.katalog,
          satuan: row.satuan,
          jenisBarang: row.jenisBarang,
          merk: "",
          type: "",
          keterangan: row.valuationDesc,
          createdAt: Date.now(),
          sapBaselineQty: row.qty, sapBaselineAt: Date.now(),
        };
        newKatalogList.push(kat);
      } else {
        // Update jenisBarang dan nama dari data SAP terbaru + catat snapshot baseline saldo SAP terbaru (utk Akurasi Material)
        newKatalogList = newKatalogList.map(k=>k.id===kat.id
          ? {...k, jenisBarang: row.jenisBarang, name: row.nama, satuan: row.satuan, sapBaselineQty: row.qty, sapBaselineAt: Date.now()}
          : k
        );
        kat = newKatalogList.find(k=>k.katalog===row.katalog);
      }
      newStocks.push({
        id: "STK-SAP-"+row.katalog,
        katalogId: kat.id,
        lokasiId: "",
        name: row.nama,
        katalog: row.katalog,
        satuan: row.satuan,
        unit: row.satuan,
        qty: row.qty,
        price: row.harga,
        minQty: 0,
        jenisBarang: row.jenisBarang,
        lokasi: "— Belum diisi —",
        createdAt: Date.now(),
      });
    });

    setKatalogList(newKatalogList);
    setStocks(newStocks);
    await saveToCloud({ katalogList: newKatalogList, stocks: newStocks });
    showToast(`✅ Import selesai! ${sapRows.length} material berhasil dimuat.`);
    return { katalogCount: newKatalogList.length, stockCount: newStocks.length, sapRows };
  }
  async function saveOpname(opn) {
    const exists = opnameList.find(o=>o.id===opn.id);
    const nl = exists ? opnameList.map(o=>o.id===opn.id?opn:o) : [...opnameList, opn];
    setOpnameList(nl);
    await saveToCloud({opnameList: nl});
    showToast("✅ Data opname disimpan!");
  }
  async function submitOpname(opn) {
    const updated = {...opn, status:"PENDING_ASMAN", submittedAt:Date.now()};
    const nl = opnameList.map(o=>o.id===opn.id?updated:o);
    setOpnameList(nl);
    await saveToCloud({opnameList: nl});
    showToast("📋 Opname disubmit! Menunggu approval Asman.");
  }
  async function approveOpname_Asman(opn, catatan) {
    if (currentUser.role!=="ASMAN") { showToast("Hanya Asman yang bisa approve.","error"); return; }
    const updated = {...opn, status:"PENDING_MANAGER", approvedByAsman:currentUser.id, approvedAtAsman:Date.now(), catatanAsman:catatan||""};
    const nl = opnameList.map(o=>o.id===opn.id?updated:o);
    setOpnameList(nl);
    await saveToCloud({opnameList: nl});
    showToast("✅ Disetujui Asman! Menunggu Manager.");
  }
  async function approveOpname_Manager(opn, catatan) {
    if (currentUser.role!=="MANAGER") { showToast("Hanya Manager yang bisa approve.","error"); return; }
    let newStocks = [...stocks];
    (opn.items||[]).filter(item=>item.selisih!==0).forEach(item => {
      const stockRows = newStocks.filter(s=>s.katalogId===item.katalogId);
      if (!stockRows.length) return;
      const totalSistem = stockRows.reduce((a,s)=>a+(s.qty||0),0);
      if (totalSistem===0) {
        newStocks = newStocks.map(s=>s.id===stockRows[0].id?{...s,qty:item.qtsFisik}:s);
        return;
      }
      let remaining = item.qtsFisik;
      stockRows.forEach((sr,idx)=>{
        if (idx===stockRows.length-1) {
          newStocks = newStocks.map(s=>s.id===sr.id?{...s,qty:Math.max(0,remaining)}:s);
        } else {
          const portion = Math.round((sr.qty/totalSistem)*item.qtsFisik);
          newStocks = newStocks.map(s=>s.id===sr.id?{...s,qty:Math.max(0,portion)}:s);
          remaining -= portion;
        }
      });
    });
    const updated = {...opn, status:"SELESAI", approvedByManager:currentUser.id, approvedAtManager:Date.now(), catatanManager:catatan||""};
    const nl = opnameList.map(o=>o.id===opn.id?updated:o);
    setOpnameList(nl); setStocks(newStocks);
    await saveToCloud({opnameList: nl, stocks: newStocks});
    showToast("✅ Stock Opname SELESAI! Data Stok disesuaikan.");
  }
  async function rejectOpname(opn, reason) {
    const updated = {...opn, status:"DITOLAK", rejectedBy:currentUser.id, rejectedAt:Date.now(), rejectReason:reason};
    const nl = opnameList.map(o=>o.id===opn.id?updated:o);
    setOpnameList(nl); await saveToCloud({opnameList: nl});
    showToast("❌ Opname ditolak.", "error");
  }
  async function deleteOpname(id) {
    if (!window.confirm("Hapus sesi opname ini?")) return;
    const nl = opnameList.filter(o=>o.id!==id);
    setOpnameList(nl); await saveToCloud({opnameList: nl});
    showToast("Opname dihapus.");
  }

  // ── STOCK COUNT (banding SAP vs Aplikasi) — read-only, TIDAK mengubah
  // Data Stok/Master Katalog sama sekali (beda dari "Import dari SAP" yang
  // memang sengaja mengganti Data Stok). Cuma membandingkan qty per material
  // ber-status SAP, lalu setiap temuan selisih menunggu approval Asman
  // (per item, bukan bulk — konsisten dengan aturan approval lain di app
  // ini). Approval di sini TIDAK memicu aksi otomatis apa pun (tidak bikin
  // draft TUG / tidak bikin Data Stok baru) — cuma menandai temuan itu valid
  // atau tidak, rekomendasi tindak lanjutnya tetap teks saran saja.
  function computeStockCountItems(sapRows) {
    const TOL_PCT = 5; // toleransi sama dengan widget "Akurasi Material" sebelumnya
    return (sapRows||[]).filter(r=>r.katalog).map(row => {
      const kat = katalogList.find(k=>k.katalog===row.katalog);
      const qtyApp = kat ? totalQtyForKatalog(kat.id, stocks) : 0;
      const qtySap = row.qty || 0;
      const selisih = qtyApp - qtySap;
      const selisihPct = qtySap===0 ? (qtyApp===0?0:100) : Math.round(Math.abs(selisih)/qtySap*1000)/10;
      let status = "AKURAT", rekomendasi = null;
      if (selisihPct > TOL_PCT) {
        if (selisih < 0) { status = "APP_KURANG"; rekomendasi = "TAMBAH_STOK"; }
        else { status = "APP_LEBIH"; rekomendasi = "BUAT_TUG_KELUAR"; }
      }
      return {
        id: `SCI-${uid().slice(-8)}`,
        katalogId: kat?.id || null,
        katalogKode: row.katalog,
        nama: row.nama || kat?.name || "(tidak ada di Master Katalog)",
        satuan: row.satuan || kat?.satuan || "-",
        qtySap, qtyApp, selisih, selisihPct, status, rekomendasi,
        approval: status==="AKURAT" ? null : "PENDING",
        approvedBy: null, approvedAt: null, catatan: null,
      };
    });
  }
  // Upload CSV/XLSX hanya menghasilkan DRAFT (dihitung di memori, belum
  // disimpan/belum terlihat siapa pun) — Admin me-review tiap item satu per
  // satu (termasuk material baru yang belum ada di Master Katalog) dan boleh
  // mencoret item yang tidak relevan, baru tombol "Simpan & Kirim ke Asman"
  // di review yang benar-benar membuat sesi dan memunculkan approval Asman.
  function previewStockCount(sapRows) {
    return computeStockCountItems(sapRows);
  }
  async function saveStockCountSession(items) {
    const akuratCount = items.filter(i=>i.status==="AKURAT").length;
    const session = {
      id: `SC-${uid().slice(-8)}`,
      uploadedAt: Date.now(), uploadedBy: currentUser.id,
      items,
      summary: { totalItem: items.length, akuratCount, akuratPct: items.length ? Math.round(akuratCount/items.length*100) : 0 },
    };
    const nsc = [session, ...stockCountList].slice(0, 50); // riwayat dibatasi 50 sesi terakhir
    setStockCountList(nsc);
    await saveToCloud({ stockCountList: nsc });
    showToast(`✅ Stock Count disimpan: ${items.length} item, ${akuratCount} akurat.`);
    return session;
  }
  async function approveStockCountItem(sessionId, itemId, catatan) {
    const session = stockCountList.find(s=>s.id===sessionId);
    const item = session?.items.find(i=>i.id===itemId);
    if (!item) return;
    const nsc = stockCountList.map(s=>s.id!==sessionId ? s : {
      ...s, items: s.items.map(it=>it.id!==itemId?it:{...it, approval:"APPROVED", approvedBy:currentUser.id, approvedAt:Date.now(), catatan:catatan||it.catatan})
    });
    setStockCountList(nsc); await saveToCloud({stockCountList: nsc});
    await logApprovalHistory({type:"STOCK_COUNT", decision:"APPROVED", title:`Temuan Stock Count: ${item.nama} (selisih ${item.selisih>0?"+":""}${item.selisih} ${item.satuan})`, requestedBy:null, requestedAt:session.uploadedAt});
    showToast("✅ Temuan Stock Count disetujui.");
  }
  async function rejectStockCountItem(sessionId, itemId, catatan) {
    const session = stockCountList.find(s=>s.id===sessionId);
    const item = session?.items.find(i=>i.id===itemId);
    if (!item) return;
    const nsc = stockCountList.map(s=>s.id!==sessionId ? s : {
      ...s, items: s.items.map(it=>it.id!==itemId?it:{...it, approval:"REJECTED", approvedBy:currentUser.id, approvedAt:Date.now(), catatan:catatan||it.catatan})
    });
    setStockCountList(nsc); await saveToCloud({stockCountList: nsc});
    await logApprovalHistory({type:"STOCK_COUNT", decision:"REJECTED", title:`Temuan Stock Count: ${item.nama} (selisih ${item.selisih>0?"+":""}${item.selisih} ${item.satuan})`, requestedBy:null, requestedAt:session.uploadedAt});
    showToast("❌ Temuan Stock Count ditolak.");
  }
  async function deleteStockCountSession(id) {
    if (!window.confirm("Hapus sesi Stock Count ini?")) return;
    const nsc = stockCountList.filter(s=>s.id!==id);
    setStockCountList(nsc); await saveToCloud({stockCountList: nsc});
    showToast("Sesi Stock Count dihapus.");
  }

  async function saveRencana(rencana) {
    const exists = rencanaKedatanganList.find(r=>r.id===rencana.id);
    const nr = exists
      ? rencanaKedatanganList.map(r=>r.id===rencana.id?rencana:r)
      : [...rencanaKedatanganList, rencana];
    setRencanaKedatanganList(nr);
    await saveToCloud({rencanaKedatanganList: nr});
    showToast("✅ Rencana Kedatangan disimpan!");
  }
  async function deleteRencana(id) {
    if (!window.confirm("Hapus rencana kedatangan ini?")) return;
    const nr = rencanaKedatanganList.filter(r=>r.id!==id);
    setRencanaKedatanganList(nr);
    await saveToCloud({rencanaKedatanganList: nr});
    showToast("Rencana dihapus.");
  }

  // AI Extract dari PDF kontrak menggunakan Groq API
  // Groq (llama-3.3-70b-versatile) adalah model text-only, jadi teks PDF
  // diekstrak dulu di browser dengan pdf.js sebelum dikirim ke Groq.
  async function extractPdfText(pdfBase64) {
    const binary = atob(pdfBase64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
    let text = "";
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      text += content.items.map(it => it.str).join(" ") + "\n";
    }
    return text;
  }

  async function aiExtractKontrak(pdfBase64, onResult, onError, onLoading) {
    onLoading(true);
    try {
      const pdfText = await extractPdfText(pdfBase64);
      const resp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${import.meta.env.VITE_GROQ_API_KEY}` },
        body: JSON.stringify({
          model: "llama-3.3-70b-versatile",
          max_tokens: 1000,
          messages: [
            { role: "system", content: `Kamu adalah asisten ekstraksi data kontrak pengadaan PLN. Ekstrak informasi dari dokumen kontrak dan kembalikan HANYA JSON valid tanpa teks lain. Format: {"noKontrak":"...","tanggalKontrak":"YYYY-MM-DD","supplier":"...","tanggalSerahTerima":"YYYY-MM-DD","items":[{"namaBarang":"...","jumlah":0,"satuan":"..."}]}. Jika field tidak ditemukan gunakan string kosong atau 0.` },
            { role: "user", content: `Ekstrak data kontrak pengadaan dari teks dokumen ini. Kembalikan JSON saja.\n\n${pdfText}` }
          ]
        })
      });
      const data = await resp.json();
      const text = data.choices?.[0]?.message?.content || "{}";
      const clean = text.replace(/```json|```/g,"").trim();
      const parsed = JSON.parse(clean);
      onResult(parsed);
    } catch(err) {
      onError("Gagal membaca kontrak: " + err.message);
    } finally {
      onLoading(false);
    }
  }

  function handleImg(e, setter) {
    const f = e.target.files[0]; if (!f) return;
    const r = new FileReader(); r.onload = ev => setter(ev.target.result); r.readAsDataURL(f);
  }
  async function saveHeavyEquipmentPhoto(equipmentId, img) {
    const next = heavyEquipmentList.map(eq => eq.id === equipmentId ? { ...eq, foto: img, fotoUpdatedAt: Date.now(), fotoUpdatedBy: currentUser.id } : eq);
    setHeavyEquipmentList(next);
    await saveToCloud({heavyEquipmentList: next});
    showToast("Foto alat disimpan.");
  }
  async function createHeavyEquipmentLoan(form) {
    if (!["ADMIN","TL"].includes(currentUser.role)) { showToast("Hanya Admin/TL yang bisa mengajukan peminjaman alat.","error"); return; }
    if (!form.equipmentId || !form.requesterUpt || !form.namaPekerjaan?.trim() || !form.tanggalAmbil || !form.tanggalKembali || !form.keperluan?.trim()) {
      showToast("Lengkapi alat, UPT peminjam, nama pekerjaan, tanggal, dan keperluan.","error"); return;
    }
    const alat = heavyEquipmentList.find(eq=>eq.id===form.equipmentId);
    if (!alat) { showToast("Alat tidak ditemukan.","error"); return; }
    if (alat.availabilityStatus === "DIPINJAM") { showToast("Alat sedang dipinjam, tidak bisa diajukan lagi.","error"); return; }
    if (alat.upt === form.requesterUpt) { showToast("Peminjaman harus antar UPT. Pilih UPT peminjam yang berbeda dari UPT pemilik alat.","error"); return; }
    const loan = {
      id: `HLOAN-${uid().slice(-8)}`,
      equipmentId: form.equipmentId,
      ownerUpt: alat.upt,
      requesterUpt: form.requesterUpt,
      fromUpt: alat.upt,
      toUpt: form.requesterUpt,
      namaPekerjaan: form.namaPekerjaan.trim(),
      tanggalAmbil: form.tanggalAmbil,
      tanggalKembali: form.tanggalKembali,
      tanggalMulai: form.tanggalAmbil,
      tanggalSelesai: form.tanggalKembali,
      keperluan: form.keperluan.trim(),
      catatan: form.catatan || "",
      status: "PENDING_OWNER_ASMAN",
      requestedBy: currentUser.id,
      requestedAt: Date.now(),
      requiredApprover: "ASMAN",
      requiredApproverUpt: alat.upt,
    };
    const nextLoans = [loan, ...heavyEquipmentLoans];
    setHeavyEquipmentLoans(nextLoans);
    await saveToCloud({heavyEquipmentLoans: nextLoans});
    showToast("Peminjaman alat diajukan. Menunggu approval Asman.");
  }
  async function approveHeavyEquipmentLoan(loanId, catatan="") {
    const loan = heavyEquipmentLoans.find(l=>l.id===loanId);
    if (!loan || !isPendingHeavyEquipmentLoan(loan)) return;
    if (!canApproveHeavyEquipmentLoan(currentUser, loan)) { showToast("Hanya Asman UPT pemilik alat yang bisa approve peminjaman ini.","error"); return; }
    const ownerUpt = getHeavyEquipmentLoanOwnerUpt(loan);
    const requesterUpt = getHeavyEquipmentLoanRequesterUpt(loan);
    const nextLoans = heavyEquipmentLoans.map(l=>l.id===loanId ? { ...l, ownerUpt, requesterUpt, status:"DIPINJAM", approvedBy:currentUser.id, approvedAt:Date.now(), catatanApproval:catatan } : l);
    const nextEquipment = heavyEquipmentList.map(eq=>eq.id===loan.equipmentId ? { ...eq, availabilityStatus:"DIPINJAM", activeLoanId:loanId, borrowedToUpt:requesterUpt, borrowedJobName:getHeavyEquipmentLoanJobName(loan), borrowedUntil:getHeavyEquipmentLoanReturnDate(loan) } : eq);
    setHeavyEquipmentLoans(nextLoans);
    setHeavyEquipmentList(nextEquipment);
    await saveToCloud({heavyEquipmentLoans: nextLoans, heavyEquipmentList: nextEquipment});
    await logApprovalHistory({type:"HEAVY_EQUIPMENT_LOAN", decision:"APPROVED", title:`Peminjaman alat ${loan.equipmentId}: ${ownerUpt} -> ${requesterUpt}`, requestedBy:loan.requestedBy, requestedAt:loan.requestedAt});
    showToast("Peminjaman alat disetujui.");
  }
  async function rejectHeavyEquipmentLoan(loanId, reason) {
    if (!reason?.trim()) { showToast("Masukkan alasan penolakan.","error"); return; }
    const loan = heavyEquipmentLoans.find(l=>l.id===loanId);
    if (!loan || !isPendingHeavyEquipmentLoan(loan)) return;
    if (!canApproveHeavyEquipmentLoan(currentUser, loan)) { showToast("Hanya Asman UPT pemilik alat yang bisa menolak peminjaman ini.","error"); return; }
    const ownerUpt = getHeavyEquipmentLoanOwnerUpt(loan);
    const requesterUpt = getHeavyEquipmentLoanRequesterUpt(loan);
    const nextLoans = heavyEquipmentLoans.map(l=>l.id===loanId ? { ...l, ownerUpt, requesterUpt, status:"REJECTED", rejectedBy:currentUser.id, rejectedAt:Date.now(), rejectReason:reason.trim() } : l);
    setHeavyEquipmentLoans(nextLoans);
    await saveToCloud({heavyEquipmentLoans: nextLoans});
    await logApprovalHistory({type:"HEAVY_EQUIPMENT_LOAN", decision:"REJECTED", title:`Peminjaman alat ${loan.equipmentId}: ${ownerUpt} -> ${requesterUpt}`, requestedBy:loan.requestedBy, requestedAt:loan.requestedAt});
    showToast("Peminjaman alat ditolak.", "error");
  }
  async function completeHeavyEquipmentLoan(loanId) {
    const loan = heavyEquipmentLoans.find(l=>l.id===loanId);
    if (!loan || !["DIPINJAM","OVERDUE"].includes(getHeavyEquipmentLoanRuntimeStatus(loan))) return;
    if (!["ADMIN","TL","ASMAN"].includes(currentUser.role)) { showToast("Role kamu tidak bisa menandai alat kembali.","error"); return; }
    const nextLoans = heavyEquipmentLoans.map(l=>l.id===loanId ? { ...l, status:"SELESAI", returnedBy:currentUser.id, returnedAt:Date.now() } : l);
    const nextEquipment = heavyEquipmentList.map(eq=>eq.id===loan.equipmentId ? { ...eq, availabilityStatus:"TERSEDIA", activeLoanId:null, borrowedToUpt:null, borrowedJobName:null, borrowedUntil:null } : eq);
    setHeavyEquipmentLoans(nextLoans);
    setHeavyEquipmentList(nextEquipment);
    await saveToCloud({heavyEquipmentLoans: nextLoans, heavyEquipmentList: nextEquipment});
    showToast("Alat ditandai sudah kembali.");
  }
  function setMaterialPhoto(stockId, dataUrl) {
    setTxnForm(tf => {
      const existing = tf.fotoMaterial.filter(fm => fm.stockId !== stockId);
      return { ...tf, fotoMaterial: [...existing, { stockId, img: dataUrl }] };
    });
  }
  function handleMaterialImg(e, stockId) {
    const f = e.target.files[0]; if (!f) return;
    const r = new FileReader(); r.onload = ev => setMaterialPhoto(stockId, ev.target.result); r.readAsDataURL(f);
  }

  // ── Barcode scan handling ──
  function openScanner(target) { setScannerTarget(target); setScannerOpen(true); }
  // QR di label Kartu Gantung TUG-2 (lihat KartuGantungModal "Label QR Print")
  // berisi URL lengkap "?scan=<katalogId>", bukan sekadar nomor katalog.
  // Ekstrak katalogId-nya supaya scan QR fisik di rak langsung match ke
  // material yang benar, baik via URL utuh maupun fallback regex kalau
  // kamera cuma menangkap sebagian teks.
  function extractKatalogIdFromScan(code) {
    try { const u = new URL(code); const id = u.searchParams.get("scan"); if (id) return id; } catch {}
    const m = code.match(/[?&]scan=([^&\s]+)/);
    return m ? decodeURIComponent(m[1]) : null;
  }

  function handleScanResult(code) {
    if (scannerTarget === "katalogForm") {
      setKatalogForm(kf => ({ ...kf, katalog: code }));
      showToast(`📷 Kode terdeteksi: ${code}`);
    } else if (scannerTarget?.txnIndex !== undefined) {
      const scannedKatalogId = extractKatalogIdFromScan(code);
      // Scan QR Kartu Gantung TUG-2 (berisi katalogId) → cari semua baris Data
      // Stok untuk material itu; kalau scan kode katalog biasa (bukan QR
      // TUG-2), fallback ke pencocokan lama by katalog code.
      const matches = scannedKatalogId
        ? enrichedStocks.filter(s => s.katalogId === scannedKatalogId)
        : enrichedStocks.filter(s => s.katalog === code);
      if (matches.length > 0) {
        const match = matches.find(s=>s.qty>0) || matches[0];
        setTxnForm(tf => {
          const items = [...tf.stockItems];
          items[scannerTarget.txnIndex] = { ...items[scannerTarget.txnIndex], stockId: match.id };
          return { ...tf, stockItems: items };
        });
        showToast(matches.length>1
          ? `📷 ${match.name} ditemukan di ${matches.length} lokasi — terpilih: ${match.lokasi}. Cek lokasinya sudah benar.`
          : `📷 Barang ditemukan: ${match.name} (${match.lokasi})`);
      } else {
        showToast(`Kode ${code} tidak ditemukan di database katalog`, "error");
      }
    }
    setScannerOpen(false);
  }

  // ── Transaction (TUG-9) ──
  function openNewTxn(docType = "TUG9") {
    const base = {
      docType,
      pekerjaan: "", namaPekerjaan: "", lokasiPekerjaan: "",
      perkiraanPembebanan: "", kodePerkiraan: "",
      stockItems: [{ stockId: "", qty: 1 }],
      keteranganBarang: "",
    };
    if (docType === "TUG9") {
      setTxnForm({
        ...base,
        noNodin: "", noPersetujuan: "",
        nopol: "", simKtp: "", namaPengemudi: "",
        penerimaNama: "", penerimaJabatan: "", penerimaUnit: "",
        satpamId: "",
        fotoKendaraan: null, fotoSimKtp: null, fotoSuratPengembalian: null,
        fotoMaterial: [],
      });
    } else if (docType === "TUG8") {
      setTxnForm({
        ...base,
        unitTujuan: "",
        noNodin: "", noPersetujuan: "",
        nopol: "", simKtp: "", namaPengemudi: "",
        penerimaNama: "", penerimaJabatan: "", penerimaUnit: "",
        satpamId: "",
        fotoKendaraan: null, fotoSimKtp: null, fotoSuratPengembalian: null,
        fotoMaterial: [],
      });
    } else if (docType === "TUG10") {
      setTxnForm({
        ...base,
        stockItems: [{ katalogMode:"existing", katalogId:"", namaBaru:"", katalogBaru:"", categoryBaru:"Lainnya", satuanBaru:"unit", qty:1, statusMaterial:"Material Sisa Baru", noAsset:"", noSeri:"", fotoNameplate:null, fotoBarangRetur:null }],
        noBAPenggantian: "",
        // For TUG10 the flow is reversed: external party hands back to PLN
        menyerahkanNama: "",
        lokasiTujuanId: "", // which Master Lokasi the returned items go into
        fotoBAPengembalian: null,
      });
    } else if (docType === "TUG3") {
      setTxnForm({
        ...base,
        stockItems: [{ katalogMode:"existing", katalogId:"", namaBaru:"", katalogBaru:"", categoryBaru:"Lainnya", satuanBaru:"unit", qty:1, harga:0, lokasiTujuanId:"" }],
        tanggalDiterima: "", dariSupplier: "", denganKirim: "Dikirim Langsung",
        noFaktur: "", tglFaktur: "",
        noSuratJalan: "", tglSuratJalan: "",
        noSpk: "", tglSpk: "",
        noAmandemen: "", tglAmandemen: "",
        biayaAngkutan: 0,
        notaNo: "", perintahKerja: "", fungsi: "",
        keteranganTug3: "Baik",
        timMutuId: "",
        lokasiPenyerahan: "",
        hasilPemeriksaan: "Barang Diterima Sesuai Pengadaan",
        fotoKendaraan: null, fotoSimKtp: null, fotoSuratJalanImg: null, fotoKontrak: null,
        fotoMaterial: [],
      });
    } else if (docType === "TUG5") {
      setTug5ExpandedIdx(0); setTug5MaterialPage(0);
      if (currentUser.role === "ADMIN_ULTG") {
        // TUG-5 dari ULTG: tujuan implisit = UPT induk ULTG-nya, tidak perlu pilih UIT/jenis transfer
        setTxnForm({
          ...base,
          sourceType: "ULTG",
          ultgId: currentUser.ultgId || "",
          lokasiPekerjaan: "",
          keteranganUmum: "",
          perintahKerja: "", kodePerkiraan: "", fungsi: "",
          stockItems: [{ katalogId:"", pemakaianBulan:0, sisaPersediaan:0, permintaan:1, keterangan:"" }],
        });
      } else {
        setTxnForm({
          ...base,
          // TUG-5 header
          uitId: uitList[0]?.id || "",       // Kepada: UIT tujuan
          jenisTransfer: "INTRACOMPANY",     // INTRACOMPANY | INTERCOMPANY
          keteranganUmum: "",
          perintahKerja: "", kodePerkiraan: "", fungsi: "",
          // Per-item fields for TUG-5 tabel
          stockItems: [{ katalogId:"", pemakaianBulan:0, sisaPersediaan:0, permintaan:1, keterangan:"" }],
        });
      }
    }
    setTxnModal(true);
  }
  function addItemRow() {
    if (txnForm.docType === "TUG5" && txnForm.stockItems.length >= 10) {
      showToast("Maksimal 10 item material per TUG-5.","error");
      return;
    }
    if (txnForm.docType === "TUG5") {
      const newIdx = txnForm.stockItems.length;
      setTug5ExpandedIdx(newIdx);
      setTug5MaterialPage(Math.floor(newIdx/5));
    }
    setTxnForm(tf => {
      if (tf.docType === "TUG10") {
        return { ...tf, stockItems: [...tf.stockItems, { katalogMode:"existing", katalogId:"", namaBaru:"", katalogBaru:"", categoryBaru:"Lainnya", satuanBaru:"unit", qty:1, statusMaterial:"Material Sisa Baru", noAsset:"", noSeri:"", fotoNameplate:null, fotoBarangRetur:null }] };
      }
      if (tf.docType === "TUG5") {
        return { ...tf, stockItems: [...tf.stockItems, { katalogId:"", pemakaianBulan:0, sisaPersediaan:0, permintaan:1, keterangan:"" }] };
      }
      if (tf.docType === "TUG3") {
        return { ...tf, stockItems: [...tf.stockItems, { katalogMode:"existing", katalogId:"", namaBaru:"", katalogBaru:"", categoryBaru:"Lainnya", satuanBaru:"unit", qty:1, harga:0 }] };
      }
      return { ...tf, stockItems: [...tf.stockItems, { stockId:"", qty:1 }] };
    });
  }
  function removeItemRow(i) { setTxnForm(tf => ({ ...tf, stockItems: tf.stockItems.filter((_,idx)=>idx!==i) })); }
  function updateItemRow(i, key, val) {
    setTxnForm(tf => {
      const items=[...tf.stockItems];
      items[i] = {...items[i], [key]: val};
      // TUG-5 dari ULTG: begitu pilih katalog, auto-isi Sisa Persediaan dari total stok aktual UPT
      // (dijumlah lintas gudang/lokasi) — ULTG tidak punya stok sendiri untuk diketik manual.
      if (tf.docType==="TUG5" && tf.sourceType==="ULTG" && key==="katalogId") {
        const totalQty = enrichedStocks.filter(s=>s.katalogId===val).reduce((a,s)=>a+(s.qty||0),0);
        items[i].sisaPersediaan = totalQty;
      }
      return {...tf, stockItems: items};
    });
  }

  async function saveTxn() {
    const canCreateULTG = currentUser.role==="ADMIN_ULTG" && txnForm?.docType==="TUG5";
    if (!CAN_CREATE.includes(currentUser.role) && !canCreateULTG && !editingDraftTxnId) { showToast("Role kamu tidak dapat mengajukan transaksi!","error"); return; }
    const docType = txnForm.docType;

    if (docType !== "TUG3") {
      if (!txnForm.namaPekerjaan.trim()) { showToast("Nama Pekerjaan wajib diisi!","error"); return; }
      if (!txnForm.lokasiPekerjaan.trim()) { showToast("Lokasi Pekerjaan wajib diisi!","error"); return; }
    }

    if (docType === "TUG9" || docType === "TUG8") {
      if (!txnForm.penerimaNama.trim()) { showToast("Nama Penerima wajib diisi!","error"); return; }
      if (docType === "TUG8" && !txnForm.unitTujuan?.trim()) { showToast("Unit/Sektor Tujuan wajib diisi untuk TUG-8!","error"); return; }
      const validItems = txnForm.stockItems.filter(si => si.stockId && si.qty > 0);
      if (validItems.length === 0) { showToast("Minimal 1 barang harus dipilih!","error"); return; }
      for (const si of validItems) {
        const stock = enrichedStocks.find(s=>s.id===si.stockId);
        if (stock && stock.jenisBarang !== "Non-Stock" && stock.qty < si.qty) {
          showToast(`Stok ${stock.name} di ${stock.lokasi} tidak cukup! Tersedia: ${stock.qty} ${stock.unit}`,"error"); return;
        }
      }
      if (editingDraftTxnId) { await submitDraftTug9({ ...txnForm, stockItems: validItems }); return; }
      await commitNewTxn(docType, { ...txnForm, stockItems: validItems });
      return;
    }

    if (docType === "TUG10") {
      if (!txnForm.menyerahkanNama?.trim()) { showToast("Nama Pihak Yang Menyerahkan wajib diisi!","error"); return; }
      if (!txnForm.lokasiTujuanId) { showToast("Pilih Lokasi Penyimpanan (Master Lokasi) untuk barang retur!","error"); return; }
      const validItems = txnForm.stockItems.filter(si => si.qty > 0 && (si.katalogMode==="existing" ? si.katalogId : si.namaBaru?.trim()));
      if (validItems.length === 0) { showToast("Minimal 1 barang retur harus diisi!","error"); return; }
      for (const si of validItems) {
        if (!si.fotoBarangRetur) { showToast(`Foto Barang wajib diupload untuk semua material retur (status: ${si.statusMaterial})!`,"error"); return; }
        if (si.statusMaterial === "Bongkaran ATTB (MTU)") {
          if (!si.noSeri?.trim()) { showToast("Nomor Seri Material wajib diisi untuk barang Bongkaran ATTB (MTU)!","error"); return; }
          if (!si.fotoNameplate) { showToast("Foto Nameplate wajib diupload untuk barang Bongkaran ATTB (MTU)!","error"); return; }
        }
      }
      if (txnForm.stockItems.some(si=>si.statusMaterial==="Bongkaran ATTB (MTU)") && !txnForm.fotoBAPengembalian) {
        showToast("Upload Surat BA Pengembalian wajib untuk material Bongkaran ATTB (MTU)!","error"); return;
      }
      await commitNewTxn(docType, { ...txnForm, stockItems: validItems });
      return;
    }

    if (docType === "TUG3") {
      if (!txnForm.dariSupplier?.trim()) { showToast("Field 'Dari' (Supplier) wajib diisi!","error"); return; }
      if (!txnForm.tanggalDiterima) { showToast("Tanggal Diterima wajib diisi!","error"); return; }
      const validItems = txnForm.stockItems.filter(si => si.qty > 0 && (si.katalogMode==="existing" ? si.katalogId : si.namaBaru?.trim()));
      if (validItems.length === 0) { showToast("Minimal 1 barang harus diisi!","error"); return; }
      await commitNewTxn(docType, { ...txnForm, stockItems: validItems, namaPekerjaan: txnForm.namaPekerjaan || txnForm.dariSupplier, lokasiPekerjaan: txnForm.lokasiPekerjaan || "Gudang Ketintang" });
      return;
    }

    if (docType === "TUG5" && txnForm.sourceType === "ULTG") {
      if (!txnForm.ultgId) { showToast("Unit ULTG kamu tidak terdeteksi. Hubungi Admin.","error"); return; }
      const validItems = txnForm.stockItems.filter(si => si.katalogId && si.permintaan > 0);
      if (validItems.length === 0) { showToast("Minimal 1 material harus diisi!","error"); return; }
      await commitNewTxn(docType, { ...txnForm, stockItems: validItems, keteranganUmum: txnForm.namaPekerjaan });
      return;
    }

    if (docType === "TUG5") {
      if (!txnForm.uitId) { showToast("Pilih UIT tujuan (Kepada)!","error"); return; }
      const validItems = txnForm.stockItems.filter(si => si.katalogId && si.permintaan > 0);
      if (validItems.length === 0) { showToast("Minimal 1 material harus diisi!","error"); return; }
      await commitNewTxn(docType, { ...txnForm, stockItems: validItems, namaPekerjaan: txnForm.keteranganUmum || "Permintaan Material", lokasiPekerjaan: "UPT Surabaya" });
      return;
    }
  }

  async function commitNewTxn(docType, formData) {
    const seq = docSeq;
    const docCode = (docType === "TUG10" || docType === "TUG3") ? "LOG.00.01" : "LOG.00.02";
    const docNumbers = generateDocNumbers(seq, Date.now(), docCode);
    const docKey = docType === "TUG9" ? "tug9" : docType === "TUG8" ? "tug8" : docType === "TUG10" ? "tug10" : docType === "TUG5" ? "tug5" : "tug3";

    if (docType === "TUG5" && formData.sourceType === "ULTG") {
      // TUG-5 dari ULTG: 1-stage approval oleh Manager ULTG unit yang sama.
      // Setelah approve, jadi pengajuan yang bisa di-adopt Admin/TL UPT induk (bukan auto-chain TUG-7).
      const nt5u = {
        id: `TUG5-` + uid().slice(3,9),
        docType, docSeq: seq, docNumbers,
        ...formData,
        stage: "PENDING_MGR_ULTG",
        status: "PENDING",
        requiredApprover: "MGR_ULTG",
        approvedByMgrUltg: null, approvedAtMgrUltg: null,
        adoptedBy: null, adoptedAt: null, adoptedTug9Id: null,
        rejectedBy: null, rejectedAt: null, rejectReason: null,
        createdBy: currentUser.id, createdAt: Date.now(),
      };
      const newTxnsU = [...txns, nt5u];
      const newSeqU = seq + 1;
      setTxns(newTxnsU); setDocSeq(newSeqU); setTxnModal(false);
      await saveToCloud({txns: newTxnsU, docSeq: newSeqU});
      showToast(`${nt5u.docNumbers.tug5} dibuat! Menunggu approval Manager ULTG. ⏳`);
      return;
    }

    if (docType === "TUG5") {
      // TUG-5: 2-stage approval: Asman → Manager UPT
      // Then auto-generates: INTRACOMPANY → draft TUG-7, INTERCOMPANY → draft TUG-5 UIT
      const nt5 = {
        id: `TUG5-` + uid().slice(3,9),
        docType, docSeq: seq, docNumbers,
        ...formData,
        stage: "PENDING_ASMAN",
        status: "PENDING",
        requiredApprover: "ASMAN",
        approvedByAsman: null, approvedAtAsman: null,
        approvedByManager: null, approvedAtManager: null,
        tug7Id: null, // will be set when TUG-7 is auto-generated
        rejectedBy: null, rejectedAt: null, rejectReason: null,
        createdBy: currentUser.id, createdAt: Date.now(),
      };
      const newTxns5 = [...txns, nt5];
      const newSeq5 = seq + 1;
      setTxns(newTxns5); setDocSeq(newSeq5); setTxnModal(false);
      await saveToCloud({txns: newTxns5, docSeq: newSeq5});
      showToast(`${nt5.docNumbers.tug5} dibuat! Menunggu approval Asman Konstruksi. ⏳`);
      return;
    }

    if (docType === "TUG3") {
      // TUG-3/4 is a 3-stage approval chain on a single transaction:
      // PENDING_TL -> (TL approves) -> MENUNGGU_TUG4 -> (TUG-4 filled + Manager approves)
      // -> MENUNGGU_FINAL -> (lampiran final filled) -> PENDING_ASMAN -> (Asman approves) -> APPROVED
      const nt3 = {
        id: `TUG3-` + uid().slice(3,9),
        docType, docSeq: seq, docNumbers,
        ...formData,
        stage: "PENDING_TL",
        status: "PENDING", // kept for compatibility with generic PENDING/APPROVED/REJECTED filters
        requiredApprover: "TL",
        approvedByTL: null, approvedAtTL: null,
        approvedByManager: null, approvedAtManager: null,
        approvedByAsman: null, approvedAtAsman: null,
        rejectedBy: null, rejectedAt: null, rejectReason: null,
        createdBy: currentUser.id, createdAt: Date.now(),
      };
      const newTxns3 = [...txns, nt3];
      const newSeq3 = seq + 1;
      setTxns(newTxns3); setDocSeq(newSeq3); setTxnModal(false);
      await saveToCloud({txns: newTxns3, docSeq: newSeq3});
      showToast(`Transaksi ${nt3.docNumbers.tug3} dibuat! Menunggu approval TL Logistik (TUG-3 Karantina). ⏳`);
      return;
    }

    const requiredApprover = currentUser.role === "ADMIN" ? "TL" : "ASMAN";
    const nt = {
      id: `${docType}-` + uid().slice(3,9),
      docType, docSeq: seq, docNumbers,
      ...formData,
      status: "PENDING",
      requiredApprover,
      approvedBy: null, approvedAt: null,
      asmanAutoApproved: false,
      rejectedBy: null, rejectedAt: null, rejectReason: null,
      createdBy: currentUser.id, createdAt: Date.now(),
    };
    const newTxns = [...txns, nt];
    const newSeq = seq + 1;
    setTxns(newTxns); setDocSeq(newSeq); setTxnModal(false);
    await saveToCloud({txns: newTxns, docSeq: newSeq});
    showToast(`Transaksi ${nt.docNumbers[docKey]} dibuat! Menunggu approval ${ROLES[requiredApprover]}. ⏳`);
  }

  function docKeyOf(txn) {
    if (txn.docType==="TUG9") return "tug9";
    if (txn.docType==="TUG8") return "tug8";
    if (txn.docType==="TUG10") return "tug10";
    if (txn.docType==="TUG5") return "tug5";
    if (txn.docType==="TUG7") return "tug7";
    return "tug3";
  }

  // ── Approval logic ──
  // ADMIN-created  -> TL approves -> Asman auto-approved alongside
  // TL-created     -> ASMAN approves -> directly APPROVED
  async function approveTxn(txn) {
    if (txn.requiredApprover !== currentUser.role) {
      showToast(`Transaksi ini butuh approval dari ${ROLES[txn.requiredApprover]}, bukan kamu.`,"error"); return;
    }
    const isAdminCreated = txn.requiredApprover === "TL";
    const dKey = docKeyOf(txn);

    if (txn.docType === "TUG9" || txn.docType === "TUG8") {
      // Outgoing material: decrease Data Stok qty at the specific location row.
      for (const si of txn.stockItems) {
        const stock = stocks.find(s=>s.id===si.stockId);
        if (stock && stock.jenisBarang !== "Non-Stock" && stock.qty < si.qty) { showToast("Stok tidak cukup untuk disetujui!","error"); return; }
      }
      const newTxns = txns.map(t => t.id===txn.id ? { ...t, status:"APPROVED", approvedBy:currentUser.id, approvedAt:Date.now(), asmanAutoApproved:isAdminCreated } : t);
      const newStocks = stocks.map(s => {
        const item = txn.stockItems.find(si=>si.stockId===s.id);
        if (!item) return s;
        if (s.jenisBarang === "Non-Stock") return s;
        return { ...s, qty: s.qty - item.qty };
      });
      setTxns(newTxns); setStocks(newStocks);
      await saveToCloud({stocks: newStocks, txns: newTxns});
      showToast(isAdminCreated ? `✅ ${txn.docNumbers[dKey]} DISETUJUI! (Asman otomatis ikut menyetujui)` : `✅ ${txn.docNumbers[dKey]} DISETUJUI!`);
      return;
    }

    if (txn.docType === "TUG10") {
      // Incoming material (return to warehouse): for each line item, either
      // increase qty on an existing Data Stok row, or auto-create a new
      // Master Katalog entry + new Data Stok row. Status maps to Jenis Barang via
      // STATUS_RETUR_TO_JENIS: Bongkaran -> "Bongkaran", Bongkaran ATTB (MTU) -> "ATTB".
      // Material Sisa Baru has no forced mapping, defaults to "Persediaan".
      let newKatalog = [...katalogList];
      let newStocks = [...stocks];
      let nextKatNum = newKatalog.length + 1;
      let nextStkNum = newStocks.length + 1;

      txn.stockItems.forEach(si => {
        const jenisBarangFinal = STATUS_RETUR_TO_JENIS[si.statusMaterial] || "Persediaan";
        if (si.katalogMode === "existing" && si.katalogId) {
          // Find an existing Data Stok row for this katalog+location; bump qty if found
          const existingRow = newStocks.find(s => s.katalogId===si.katalogId && s.lokasiId===txn.lokasiTujuanId);
          if (existingRow) {
            newStocks = newStocks.map(s => s.id===existingRow.id ? { ...s, qty: s.qty + si.qty } : s);
          } else {
            const newId = `STK-${String(nextStkNum++).padStart(3,"0")}-${uid().slice(3,6)}`;
            newStocks.push({ id:newId, katalogId:si.katalogId, lokasiId:txn.lokasiTujuanId, qty:si.qty, minQty:0, price:0, jenisBarang:jenisBarangFinal, img:si.fotoBarangRetur||null, createdAt:Date.now() });
          }
        } else {
          // Brand-new item: register into Master Katalog first
          const newKatId = `KAT-${String(nextKatNum++).padStart(3,"0")}-${uid().slice(3,6)}`;
          newKatalog.push({ id:newKatId, katalog:si.katalogBaru||"", name:si.namaBaru, category:si.categoryBaru||"Lainnya", satuan:si.satuanBaru||"unit", createdAt:Date.now() });
          const newStkId = `STK-${String(nextStkNum++).padStart(3,"0")}-${uid().slice(3,6)}`;
          newStocks.push({ id:newStkId, katalogId:newKatId, lokasiId:txn.lokasiTujuanId, qty:si.qty, minQty:0, price:0, jenisBarang:jenisBarangFinal, img:si.fotoBarangRetur||null, createdAt:Date.now() });
        }
      });

      const newTxns = txns.map(t => t.id===txn.id ? { ...t, status:"APPROVED", approvedBy:currentUser.id, approvedAt:Date.now(), asmanAutoApproved:isAdminCreated } : t);
      setTxns(newTxns); setStocks(newStocks); setKatalogList(newKatalog);
      await saveToCloud({stocks: newStocks, txns: newTxns, katalogList: newKatalog});
      showToast(isAdminCreated ? `✅ ${txn.docNumbers[dKey]} DISETUJUI! Stok bertambah. (Asman otomatis ikut menyetujui)` : `✅ ${txn.docNumbers[dKey]} DISETUJUI! Stok bertambah.`);
      return;
    }
  }
  async function rejectTxn(txn, reason) {
    if (txn.requiredApprover !== currentUser.role) {
      showToast(`Transaksi ini butuh approval dari ${ROLES[txn.requiredApprover]}, bukan kamu.`,"error"); return;
    }
    if (!reason.trim()) { showToast("Masukkan alasan penolakan!","error"); return; }
    const newTxns = txns.map(t => t.id===txn.id ? {...t, status:"REJECTED", rejectedBy:currentUser.id, rejectedAt:Date.now(), rejectReason:reason} : t);
    setTxns(newTxns);
    await saveToCloud({txns: newTxns});
    showToast(`❌ ${txn.docNumbers[docKeyOf(txn)]} DITOLAK.`, "error");
  }

  // ══════════════════════════════════════════════════════════════════
  // TUG-3 / TUG-4 — 3-stage approval chain on a single transaction:
  //   Stage 1: PENDING_TL      -> TL Logistik approves      -> MENUNGGU_TUG4
  //   Stage 2: PENDING_MANAGER -> Manager approves (TUG-4)  -> MENUNGGU_FINAL
  //   Stage 3: PENDING_ASMAN   -> Asman approves (TUG-3 Final) -> APPROVED (stock increases)
  // ══════════════════════════════════════════════════════════════════

  // Stage 1: TL Logistik approves the TUG-3 Karantina submission
  async function approveTUG3_TL(txn) {
    if (currentUser.role !== "TL") { showToast("Hanya TL Logistik yang bisa menyetujui TUG-3 Karantina.","error"); return; }
    if (txn.stage !== "PENDING_TL") { showToast("Transaksi ini tidak dalam tahap menunggu TL.","error"); return; }
    const newTxns = txns.map(t => t.id===txn.id ? { ...t, stage:"MENUNGGU_TUG4", approvedByTL:currentUser.id, approvedAtTL:Date.now(), requiredApprover:"MANAGER" } : t);
    setTxns(newTxns);
    await saveToCloud({txns: newTxns});
    showToast(`✅ ${txn.docNumbers.tug3} disetujui TL Logistik! Lanjut ke tahap TUG-4 (Pemeriksaan Mutu).`);
  }
  async function rejectTUG3_TL(txn, reason) {
    if (currentUser.role !== "TL") { showToast("Hanya TL Logistik yang bisa menolak TUG-3 Karantina.","error"); return; }
    if (!reason.trim()) { showToast("Masukkan alasan penolakan!","error"); return; }
    const newTxns = txns.map(t => t.id===txn.id ? {...t, status:"REJECTED", stage:"REJECTED", rejectedBy:currentUser.id, rejectedAt:Date.now(), rejectReason:reason} : t);
    setTxns(newTxns);
    await saveToCloud({txns: newTxns});
    showToast(`❌ ${txn.docNumbers.tug3} DITOLAK oleh TL Logistik.`, "error");
  }

  // Stage 2a: Admin/TL fills in the TUG-4 form (Tim Mutu, Lokasi Penyerahan, hasil pemeriksaan)
  async function submitTUG4Form(txn, tug4Data) {
    if (!tug4Data.timMutuId) { showToast("Pilih paket Tim Mutu!","error"); return; }
    if (!tug4Data.lokasiPenyerahan?.trim()) { showToast("Lokasi Penyerahan wajib diisi!","error"); return; }
    const newTxns = txns.map(t => t.id===txn.id ? { ...t, ...tug4Data, stage:"PENDING_MANAGER" } : t);
    setTxns(newTxns);
    await saveToCloud({txns: newTxns});
    showToast(`📋 Form TUG-4 dilengkapi! Menunggu approval Manager.`);
  }
  // Stage 2b: Manager approves the TUG-4 pemeriksaan
  async function approveTUG4_Manager(txn) {
    if (currentUser.role !== "MANAGER") { showToast("Hanya Manager yang bisa menyetujui TUG-4.","error"); return; }
    if (txn.stage !== "PENDING_MANAGER") { showToast("Transaksi ini tidak dalam tahap menunggu Manager.","error"); return; }
    const newTxns = txns.map(t => t.id===txn.id ? { ...t, stage:"MENUNGGU_FINAL", approvedByManager:currentUser.id, approvedAtManager:Date.now(), requiredApprover:"ASMAN" } : t);
    setTxns(newTxns);
    await saveToCloud({txns: newTxns});
    showToast(`✅ ${txn.docNumbers.tug4} disetujui Manager! Lanjut ke tahap finalisasi TUG-3.`);
  }
  async function rejectTUG4_Manager(txn, reason) {
    if (currentUser.role !== "MANAGER") { showToast("Hanya Manager yang bisa menolak TUG-4.","error"); return; }
    if (!reason.trim()) { showToast("Masukkan alasan penolakan!","error"); return; }
    const newTxns = txns.map(t => t.id===txn.id ? {...t, status:"REJECTED", stage:"REJECTED", rejectedBy:currentUser.id, rejectedAt:Date.now(), rejectReason:reason} : t);
    setTxns(newTxns);
    await saveToCloud({txns: newTxns});
    showToast(`❌ ${txn.docNumbers.tug4} DITOLAK oleh Manager.`, "error");
  }

  // Stage 3a: Admin/TL completes the TUG-3 Final lampiran (foto kendaraan, SIM/KTP, surat jalan, kontrak, per-material)
  async function submitTUG3FinalLampiran(txn, lampiranData) {
    const newTxns = txns.map(t => t.id===txn.id ? { ...t, ...lampiranData, stage:"PENDING_ASMAN" } : t);
    setTxns(newTxns);
    await saveToCloud({txns: newTxns});
    showToast(`📎 Lampiran TUG-3 Final dilengkapi! Menunggu approval Asman Konstruksi.`);
  }
  // Stage 3b: Asman Konstruksi approves the final receipt — THIS is when stock actually increases
  async function approveTUG3Final_Asman(txn) {
    if (currentUser.role !== "ASMAN") { showToast("Hanya Asman Konstruksi yang bisa menyetujui TUG-3 Final.","error"); return; }
    if (txn.stage !== "PENDING_ASMAN") { showToast("Transaksi ini tidak dalam tahap menunggu Asman.","error"); return; }

    // Same incoming-material logic as TUG-10 approval: bump existing Data Stok
    // row or auto-create new Master Katalog + Data Stok entry.
    let newKatalog = [...katalogList];
    let newStocks = [...stocks];
    let nextKatNum = newKatalog.length + 1;
    let nextStkNum = newStocks.length + 1;

    txn.stockItems.forEach(si => {
      const lokasiId = si.lokasiTujuanId || txn.stockItems[0]?.lokasiTujuanId;
      if (!lokasiId) return;
      if (si.katalogMode === "existing" && si.katalogId) {
        const existingRow = newStocks.find(s => s.katalogId===si.katalogId && s.lokasiId===lokasiId);
        if (existingRow) {
          newStocks = newStocks.map(s => s.id===existingRow.id ? { ...s, qty: s.qty + si.qty } : s);
        } else {
          const newId = `STK-${String(nextStkNum++).padStart(3,"0")}-${uid().slice(3,6)}`;
          newStocks.push({ id:newId, katalogId:si.katalogId, lokasiId, qty:si.qty, minQty:0, price:si.harga||0, jenisBarang:"Persediaan", img:null, createdAt:Date.now() });
        }
      } else {
        const newKatId = `KAT-${String(nextKatNum++).padStart(3,"0")}-${uid().slice(3,6)}`;
        newKatalog.push({ id:newKatId, katalog:si.katalogBaru||"", name:si.namaBaru, category:si.categoryBaru||"Lainnya", satuan:si.satuanBaru||"unit", createdAt:Date.now() });
        const newStkId = `STK-${String(nextStkNum++).padStart(3,"0")}-${uid().slice(3,6)}`;
        newStocks.push({ id:newStkId, katalogId:newKatId, lokasiId, qty:si.qty, minQty:0, price:si.harga||0, jenisBarang:"Persediaan", img:null, createdAt:Date.now() });
      }
    });

    const newTxns = txns.map(t => t.id===txn.id ? { ...t, stage:"APPROVED", status:"APPROVED", approvedByAsman:currentUser.id, approvedAtAsman:Date.now() } : t);
    setTxns(newTxns); setStocks(newStocks); setKatalogList(newKatalog);
    await saveToCloud({txns: newTxns, stocks: newStocks, katalogList: newKatalog});
    showToast(`✅ ${txn.docNumbers.tug3} DISETUJUI FINAL! Stok bertambah ke gudang.`);
  }
  async function rejectTUG3Final_Asman(txn, reason) {
    if (currentUser.role !== "ASMAN") { showToast("Hanya Asman Konstruksi yang bisa menolak TUG-3 Final.","error"); return; }
    if (!reason.trim()) { showToast("Masukkan alasan penolakan!","error"); return; }
    const newTxns = txns.map(t => t.id===txn.id ? {...t, status:"REJECTED", stage:"REJECTED", rejectedBy:currentUser.id, rejectedAt:Date.now(), rejectReason:reason} : t);
    setTxns(newTxns);
    await saveToCloud({txns: newTxns});
    showToast(`❌ ${txn.docNumbers.tug3} DITOLAK oleh Asman Konstruksi (tahap final).`, "error");
  }

  // ══════════════════════════════════════════════════════════════════
  // TUG-5 APPROVAL CHAIN: Asman → Manager UPT
  // Setelah Manager approve → auto-generate TUG-7 (Intracompany)
  //                        atau draft TUG-5 UIT (Intercompany)
  // ══════════════════════════════════════════════════════════════════

  async function approveTUG5_Asman(txn) {
    if (currentUser.role !== "ASMAN") { showToast("Hanya Asman Konstruksi yang bisa menyetujui TUG-5 tahap ini.","error"); return; }
    if (txn.stage !== "PENDING_ASMAN") { showToast("TUG-5 ini tidak dalam tahap menunggu Asman.","error"); return; }
    const newTxns = txns.map(t => t.id===txn.id ? {...t, stage:"PENDING_MANAGER", requiredApprover:"MANAGER", approvedByAsman:currentUser.id, approvedAtAsman:Date.now()} : t);
    setTxns(newTxns);
    await saveToCloud({txns: newTxns});
    showToast(`✅ ${txn.docNumbers.tug5} disetujui Asman! Menunggu approval Manager.`);
  }
  async function rejectTUG5_Asman(txn, reason) {
    if (currentUser.role !== "ASMAN") { showToast("Hanya Asman Konstruksi yang bisa menolak TUG-5.","error"); return; }
    if (!reason.trim()) { showToast("Masukkan alasan penolakan!","error"); return; }
    const newTxns = txns.map(t => t.id===txn.id ? {...t, status:"REJECTED", stage:"REJECTED", rejectedBy:currentUser.id, rejectedAt:Date.now(), rejectReason:reason} : t);
    setTxns(newTxns); await saveToCloud({txns: newTxns});
    showToast(`❌ ${txn.docNumbers.tug5} DITOLAK oleh Asman.`, "error");
  }

  async function approveTUG5_Manager(txn) {
    if (currentUser.role !== "MANAGER") { showToast("Hanya Manager yang bisa menyetujui TUG-5 tahap ini.","error"); return; }
    if (txn.stage !== "PENDING_MANAGER") { showToast("TUG-5 ini tidak dalam tahap menunggu Manager.","error"); return; }

    if (txn.jenisTransfer === "INTRACOMPANY") {
      // Auto-generate draft TUG-7 di level UIT
      const seq = docSeq;
      const docNumbers = generateDocNumbers(seq, Date.now());
      const newTug7 = {
        id: `TUG7-` + uid().slice(3,9),
        docType: "TUG7",
        docSeq: seq, docNumbers,
        tug5Id: txn.id,
        tug5DocNo: txn.docNumbers.tug5,
        uitId: txn.uitId,
        uptPengirimId: "", // diisi Admin UIT
        atasBebanRekening: "",
        perintahKerja: txn.perintahKerja||"", kodeAkun: txn.kodePerkiraan||"", fungsi: txn.fungsi||"",
        stockItems: txn.stockItems.map(si=>({...si, qty: si.permintaan||si.qty||0})),
        stage: "DRAFT_UIT",
        status: "PENDING",
        requiredApprover: "ADMIN_UIT",
        approvedByAdminUIT: null, approvedAtAdminUIT: null,
        approvedByMgrLogistik: null, approvedAtMgrLogistik: null,
        rejectedBy: null, rejectedAt: null, rejectReason: null,
        createdAt: Date.now(),
        unitPenerima: "UPT Surabaya",
      };
      const newTxns = txns.map(t => t.id===txn.id ? {...t, stage:"APPROVED", status:"APPROVED", approvedByManager:currentUser.id, approvedAtManager:Date.now(), tug7Id:newTug7.id} : t);
      const allTxns = [...newTxns, newTug7];
      const newSeq = seq + 1;
      setTxns(allTxns); setDocSeq(newSeq);
      await saveToCloud({txns: allTxns, docSeq: newSeq});
      showToast(`✅ ${txn.docNumbers.tug5} DISETUJUI! Draft TUG-7 otomatis dibuat untuk UIT. 📋`);
    } else {
      // INTERCOMPANY — generate draft TUG-5 UIT (untuk dikirim ke UIT lain)
      const seq = docSeq;
      const docNumbers = generateDocNumbers(seq, Date.now());
      const draftTug5UIT = {
        id: `TUG5UIT-` + uid().slice(3,9),
        docType: "TUG5",
        docSubType: "UIT_INTERCOMPANY",
        docSeq: seq, docNumbers,
        tug5UptId: txn.id, // referensi ke TUG-5 UPT asal
        uitId: txn.uitId,
        jenisTransfer: "INTERCOMPANY",
        keteranganUmum: txn.keteranganUmum,
        perintahKerja: txn.perintahKerja||"", kodePerkiraan: txn.kodePerkiraan||"", fungsi: txn.fungsi||"",
        stockItems: txn.stockItems.map(si=>({...si})),
        stage: "DRAFT_UIT",
        status: "PENDING",
        createdAt: Date.now(),
        namaPekerjaan: txn.keteranganUmum||"Permintaan Intercompany",
        lokasiPekerjaan: "UIT-JBM",
      };
      const newTxns = txns.map(t => t.id===txn.id ? {...t, stage:"APPROVED", status:"APPROVED", approvedByManager:currentUser.id, approvedAtManager:Date.now(), draftTug5UITId:draftTug5UIT.id} : t);
      const allTxns = [...newTxns, draftTug5UIT];
      const newSeq = seq + 1;
      setTxns(allTxns); setDocSeq(newSeq);
      await saveToCloud({txns: allTxns, docSeq: newSeq});
      showToast(`✅ ${txn.docNumbers.tug5} DISETUJUI! Draft TUG-5 UIT (Intercompany) dibuat — cetak & kirim manual ke UIT tujuan. 📄`);
    }
  }
  async function rejectTUG5_Manager(txn, reason) {
    if (currentUser.role !== "MANAGER") { showToast("Hanya Manager yang bisa menolak TUG-5.","error"); return; }
    if (!reason.trim()) { showToast("Masukkan alasan penolakan!","error"); return; }
    const newTxns = txns.map(t => t.id===txn.id ? {...t, status:"REJECTED", stage:"REJECTED", rejectedBy:currentUser.id, rejectedAt:Date.now(), rejectReason:reason} : t);
    setTxns(newTxns); await saveToCloud({txns: newTxns});
    showToast(`❌ ${txn.docNumbers.tug5} DITOLAK oleh Manager.`, "error");
  }

  // ══════════════════════════════════════════════════════════════════
  // TUG-5 DARI ULTG: Manager ULTG approve (1 tahap) → jadi pengajuan siap di-adopt
  // Admin/TL UPT induk ULTG tersebut. Adopt = auto-create draft TUG-9 (editable).
  // ══════════════════════════════════════════════════════════════════

  async function approveTUG5_MgrULTG(txn) {
    if (currentUser.role !== "MGR_ULTG") { showToast("Hanya Manager ULTG yang bisa menyetujui TUG-5 ini.","error"); return; }
    if (txn.ultgId !== currentUser.ultgId) { showToast("TUG-5 ini bukan dari unit ULTG kamu.","error"); return; }
    if (txn.stage !== "PENDING_MGR_ULTG") { showToast("TUG-5 ini tidak dalam tahap menunggu Manager ULTG.","error"); return; }
    const newTxns = txns.map(t => t.id===txn.id ? {...t, stage:"APPROVED_ULTG", status:"APPROVED", approvedByMgrUltg:currentUser.id, approvedAtMgrUltg:Date.now()} : t);
    setTxns(newTxns);
    await saveToCloud({txns: newTxns});
    showToast(`✅ ${txn.docNumbers.tug5} disetujui! Menunggu di-adopt oleh Admin/TL UPT.`);
  }
  async function rejectTUG5_MgrULTG(txn, reason) {
    if (currentUser.role !== "MGR_ULTG") { showToast("Hanya Manager ULTG yang bisa menolak TUG-5 ini.","error"); return; }
    if (!reason.trim()) { showToast("Masukkan alasan penolakan!","error"); return; }
    const newTxns = txns.map(t => t.id===txn.id ? {...t, status:"REJECTED", stage:"REJECTED", rejectedBy:currentUser.id, rejectedAt:Date.now(), rejectReason:reason} : t);
    setTxns(newTxns); await saveToCloud({txns: newTxns});
    showToast(`❌ ${txn.docNumbers.tug5} DITOLAK oleh Manager ULTG.`, "error");
  }
  // Admin/TL UPT induk "mengadopsi" pengajuan ULTG → auto-create draft TUG-9 (editable, stok dipilih sendiri)
  async function adoptTUG5ULTG(txn) {
    if (!["ADMIN","TL"].includes(currentUser.role)) { showToast("Hanya Admin/TL UPT yang bisa mengadopsi pengajuan ini.","error"); return; }
    if (txn.adoptedBy) { showToast("Pengajuan ini sudah di-adopt UPT lain.","error"); return; }
    const seq = docSeq;
    const docCode = "LOG.00.02";
    const docNumbers = generateDocNumbers(seq, Date.now(), docCode);
    const ultg = ultgList.find(u=>u.id===txn.ultgId);
    // Cocokkan katalogId dari pengajuan TUG-5 ULTG ke baris stok aktual (pilih stok dengan
    // qty terbesar untuk katalog tsb) — supaya list material TIDAK hilang saat masuk draft TUG-9,
    // karena form TUG-9 me-render item lewat stocks.find(s=>s.id===si.stockId), bukan katalogId.
    const draftTug9 = {
      id: `TUG9-` + uid().slice(3,9),
      docType: "TUG9", docSeq: seq, docNumbers,
      tug5Id: txn.id, tug5DocNo: txn.docNumbers.tug5,
      namaPekerjaan: txn.keteranganUmum || "Permintaan Material ULTG",
      lokasiPekerjaan: ultg?.nama || "ULTG",
      perkiraanPembebanan: "", kodePerkiraan: txn.kodePerkiraan||"",
      keteranganBarang: txn.namaPekerjaan || txn.keteranganUmum || `Adopsi dari pengajuan ${ultg?.nama||""} — ${txn.docNumbers.tug5}`,
      stockItems: txn.stockItems.map(si=>{
        const matches = stocks.filter(s=>s.katalogId===si.katalogId).sort((a,b)=>(b.qty||0)-(a.qty||0));
        return { stockId: matches[0]?.id || "", qty: si.permintaan||si.qty||1, _katalogHint: si.katalogId };
      }),
      noNodin: "", noPersetujuan: "",
      nopol: "", simKtp: "", namaPengemudi: "",
      penerimaNama: "", penerimaJabatan: "", penerimaUnit: ultg?.nama||"",
      satpamId: "",
      fotoKendaraan: null, fotoSimKtp: null, fotoSuratPengembalian: null, fotoMaterial: [],
      status: "DRAFT",
      createdBy: currentUser.id, createdAt: Date.now(),
    };
    const newTxns = txns.map(t => t.id===txn.id ? {...t, adoptedBy:currentUser.id, adoptedAt:Date.now(), adoptedTug9Id:draftTug9.id} : t);
    const allTxns = [...newTxns, draftTug9];
    const newSeq = seq + 1;
    setTxns(allTxns); setDocSeq(newSeq);
    await saveToCloud({txns: allTxns, docSeq: newSeq});
    showToast(`📋 Diadopsi! Draft TUG-9 dibuat — lengkapi & edit materialnya sebelum submit.`);
    return draftTug9;
  }
  // Buka draft TUG-9 (hasil adopt) di form TUG-9 biasa supaya bisa diedit — tambah/hapus
  // baris material, lengkapi field yang kurang — sebelum disubmit ke approval normal.
  function openDraftTug9(txn) {
    setTxnForm({ ...txn, stockItems: txn.stockItems.length ? txn.stockItems : [{stockId:"",qty:1}] });
    setEditingDraftTxnId(txn.id);
    setTxnModal(true);
  }
  // Submit draft TUG-9 (hasil adopt) yang sudah dilengkapi/diedit → masuk approval normal TUG-9
  async function submitDraftTug9(formData) {
    const requiredApprover = currentUser.role === "ADMIN" ? "TL" : "ASMAN";
    const newTxns = txns.map(t => t.id===editingDraftTxnId ? {
      ...t, ...formData,
      status: "PENDING", requiredApprover,
      approvedBy: null, approvedAt: null, asmanAutoApproved: false,
      createdBy: currentUser.id,
    } : t);
    setTxns(newTxns); setTxnModal(false); setEditingDraftTxnId(null);
    await saveToCloud({txns: newTxns});
    showToast(`✅ TUG-9 dilengkapi & diajukan! Menunggu approval ${ROLES[requiredApprover]}.`);
  }

  // ══════════════════════════════════════════════════════════════════
  // TUG-7 APPROVAL CHAIN: Admin UIT (lengkapi) → Manager Logistik UIT (approve)
  // Setelah Manager Logistik approve → auto-generate draft TUG-8 di UPT Pengirim
  // ══════════════════════════════════════════════════════════════════

  async function submitTUG7_AdminUIT(txn, tug7Data) {
    if (currentUser.role !== "ADMIN_UIT") { showToast("Hanya Admin UIT yang bisa melengkapi TUG-7.","error"); return; }
    if (!tug7Data.uptPengirimId) { showToast("Pilih UPT Pengirim terlebih dahulu!","error"); return; }
    const newTxns = txns.map(t => t.id===txn.id ? {...t, ...tug7Data, stage:"PENDING_MGR_LOGISTIK", requiredApprover:"MGR_LOGISTIK_UIT", approvedByAdminUIT:currentUser.id, approvedAtAdminUIT:Date.now()} : t);
    setTxns(newTxns);
    await saveToCloud({txns: newTxns});
    showToast(`📋 TUG-7 ${txn.docNumbers.tug7} dilengkapi! Menunggu approval Manager Logistik UIT.`);
  }
  async function approveTUG7_MgrLogistik(txn) {
    if (currentUser.role !== "MGR_LOGISTIK_UIT") { showToast("Hanya Manager Logistik UIT yang bisa menyetujui TUG-7.","error"); return; }
    if (txn.stage !== "PENDING_MGR_LOGISTIK") { showToast("TUG-7 ini tidak dalam tahap menunggu Manager Logistik.","error"); return; }

    // Auto-generate draft TUG-8 di UPT Pengirim
    const seq = docSeq;
    const docNumbers = generateDocNumbers(seq, Date.now(), "LOG.00.02");
    const uptPengirim = uptList.find(u=>u.id===txn.uptPengirimId);
    const tug5Ref = txns.find(t=>t.id===txn.tug5Id);
    const newTug8Draft = {
      id: `TUG8-` + uid().slice(3,9),
      docType: "TUG8",
      docSeq: seq, docNumbers,
      tug7Id: txn.id,
      tug5Id: txn.tug5Id,
      noReferensiTug7: txn.docNumbers.tug7,
      noReferensiTug5: tug5Ref?.docNumbers?.tug5 || "",
      unitTujuan: txn.unitPenerima || "UPT Surabaya",
      uptPengirimId: txn.uptPengirimId,
      namaPekerjaan: `Berdasarkan TUG-7 ${txn.docNumbers.tug7}`,
      lokasiPekerjaan: uptPengirim?.nama || "-",
      perkiraanPembebanan: "", kodePerkiraan: txn.kodeAkun||"",
      stockItems: txn.stockItems.map(si=>({stockId:"", katalogId:si.katalogId, qty:si.qty||si.permintaan||0})),
      keteranganBarang: `Berdasarkan TUG-5 ${tug5Ref?.docNumbers?.tug5||""} dan TUG-7 ${txn.docNumbers.tug7}`,
      stage: "DRAFT_TUG8", // Admin UPT Pengirim harus konfirmasi dulu
      status: "DRAFT",
      penerimaNama:"", penerimaJabatan:"", penerimaUnit:"",
      nopol:"", namaPengemudi:"", simKtp:"", satpamId:"",
      fotoKendaraan:null, fotoSimKtp:null, fotoSuratPengembalian:null, fotoMaterial:[],
      createdAt: Date.now(),
    };
    const newTxns = txns.map(t => t.id===txn.id ? {...t, stage:"APPROVED", status:"APPROVED", approvedByMgrLogistik:currentUser.id, approvedAtMgrLogistik:Date.now(), tug8DraftId:newTug8Draft.id} : t);
    const allTxns = [...newTxns, newTug8Draft];
    const newSeq = seq + 1;
    setTxns(allTxns); setDocSeq(newSeq);
    await saveToCloud({txns: allTxns, docSeq: newSeq});
    showToast(`✅ TUG-7 DISETUJUI! Draft TUG-8 otomatis muncul di UPT ${uptPengirim?.nama||"Pengirim"}. 📦`);
  }
  async function rejectTUG7_MgrLogistik(txn, reason) {
    if (currentUser.role !== "MGR_LOGISTIK_UIT") { showToast("Hanya Manager Logistik UIT yang bisa menolak TUG-7.","error"); return; }
    if (!reason.trim()) { showToast("Masukkan alasan penolakan!","error"); return; }
    const newTxns = txns.map(t => t.id===txn.id ? {...t, status:"REJECTED", stage:"REJECTED", rejectedBy:currentUser.id, rejectedAt:Date.now(), rejectReason:reason} : t);
    setTxns(newTxns); await saveToCloud({txns: newTxns});
    showToast(`❌ TUG-7 DITOLAK oleh Manager Logistik UIT.`, "error");
  }

  // Konfirmasi draft TUG-8 dari TUG-7 oleh Admin UPT Pengirim
  async function konfirmasiDraftTUG8(txn) {
    if (!["ADMIN","TL"].includes(currentUser.role)) { showToast("Hanya Admin Gudang / TL yang bisa mengkonfirmasi draft TUG-8.","error"); return; }
    const requiredApprover = currentUser.role === "ADMIN" ? "TL" : "ASMAN";
    const newTxns = txns.map(t => t.id===txn.id ? {
      ...t, stage:undefined, status:"PENDING",
      requiredApprover, approvedBy:null, approvedAt:null,
      asmanAutoApproved:false, createdBy:currentUser.id,
    } : t);
    setTxns(newTxns); await saveToCloud({txns: newTxns});
    showToast(`✅ Draft TUG-8 dikonfirmasi! Status: PENDING, menunggu approval ${ROLES[requiredApprover]}.`);
  }

  // Bangun ulang knowledge base RAG (tabel rag_chunks di Supabase) dari
  // Master Katalog + transaksi TUG yang approved. Dipicu MANUAL lewat tombol
  // di AI Agent (bukan otomatis tiap save) supaya tidak boros panggilan API
  // embedding Cohere. Batasi transaksi ke 6 bulan terakhir supaya knowledge
  // base tidak membengkak tanpa batas dari histori lama.
  async function syncRagChunks(silent = false) {
    if (!supabase) { if (!silent) showToast("Supabase belum terkonfigurasi.", "error"); return; }
    if (!silent) setRagSyncing(true);
    try {
      const enam_bulan_lalu = Date.now() - 180*24*60*60*1000;
      const txnRelevant = txns.filter(t=>t.status==="APPROVED" && t.createdAt>=enam_bulan_lalu);
      // Agregasi qty+harga per katalogId (jumlah semua lokasi/blok untuk katalog yang sama)
      // supaya chunk RAG-nya bawa angka real-time, bukan cuma deskripsi statis.
      const stockByKatalog = {};
      enrichedStocks.forEach(s=>{
        if (!s.katalogId) return;
        if (!stockByKatalog[s.katalogId]) stockByKatalog[s.katalogId] = { qty:0, price:s.price||0, locations:[] };
        stockByKatalog[s.katalogId].qty += s.qty||0;
        if (s.qty>0) {
          const lok = lokasiList.find(l=>l.id===s.lokasiId);
          const gdg = lok?.gudangId ? gudangList.find(g=>g.id===lok.gudangId) : null;
          stockByKatalog[s.katalogId].locations.push({ gudang: gdg?.nama||"", blok: lok?.kode||s.lokasi||"", qty: s.qty||0 });
        }
      });
      // "Buku pintar" hasil kurasi Admin dari pertanyaan nyata yang dijawab buruk oleh bot —
      // diprioritaskan tinggi karena isinya jawaban resmi untuk pertanyaan yang benar-benar
      // pernah ditanyakan, bukan cuma deskripsi umum.
      const { data: faqRows } = await supabase.from("ai_faq_curated").select("id, pertanyaan, jawaban").eq("is_active", true);

      const chunks = [
        ...katalogList.map(k=>({ id:`katalog_${k.id}`, source_type:"katalog", source_id:k.id, content:buildKatalogRagContent(k, stockByKatalog[k.id]) })),
        ...txnRelevant.map(t=>({ id:`txn_${t.id}`, source_type:"txn", source_id:t.id, content:buildTxnRagContent(t) })),
        ...(faqRows||[]).map(f=>({ id:`faq_${f.id}`, source_type:"faq", source_id:String(f.id), content:`Pertanyaan: ${f.pertanyaan}\nJawaban resmi (kurasi Admin): ${f.jawaban}` })),
      ];
      if (chunks.length===0) { if (!silent) showToast("Tidak ada data untuk di-index.", "error"); if (!silent) setRagSyncing(false); return; }
      // Cohere embed API maks ~96 teks per request — kirim per batch.
      const BATCH = 90;
      for (let i=0; i<chunks.length; i+=BATCH) {
        const batch = chunks.slice(i, i+BATCH);
        const vectors = await cohereEmbed(batch.map(c=>c.content), "search_document");
        const rows = batch.map((c,idx)=>({ ...c, embedding: vectors[idx], updated_at: new Date().toISOString() }));
        const { error } = await supabase.from("rag_chunks").upsert(rows, { onConflict: "id" });
        if (error) throw error;
      }
      // Hapus chunk lama yang sumbernya sudah tidak ada lagi (katalog/txn/FAQ terhapus)
      const currentIds = new Set(chunks.map(c=>c.id));
      const { data: existing } = await supabase.from("rag_chunks").select("id");
      const toDelete = (existing||[]).filter(r=>!currentIds.has(r.id)).map(r=>r.id);
      if (toDelete.length) await supabase.from("rag_chunks").delete().in("id", toDelete);
      setRagLastSync(Date.now());
      if (!silent) showToast(`✅ Knowledge Base RAG disinkron: ${chunks.length} item (${katalogList.length} katalog, ${txnRelevant.length} transaksi, ${(faqRows||[]).length} FAQ).`);
    } catch (err) {
      if (!silent) showToast("Gagal sinkron Knowledge Base: " + err.message, "error");
      else console.error("Auto-sync RAG gagal:", err.message);
    }
    if (!silent) setRagSyncing(false);
  }

  // Snapshot data ringkas (qty, harga/Rupiah, stok kritis, pending approval, rencana
  // kedatangan) yang dikirim ke bot WA/Telegram lewat tabel `warnoto_state`. Tanpa ini,
  // bot cuma punya RAG chunk katalog (nama/satuan/kategori doang, tidak ada qty/harga —
  // lihat buildKatalogRagContent) sehingga jauh lebih "bodoh" dibanding AI Agent web yang
  // selalu inject snapshot ini langsung ke prompt tiap chat (lihat sendChat di bawah).
  // Dipicu manual bareng "Sync Knowledge Base (RAG)" — sama seperti RAG, sengaja tidak
  // otomatis tiap perubahan data supaya tidak boros write ke Supabase.
  function buildWarnotoStateSnapshot() {
    const gudangNamaByLokasiId = {};
    lokasiList.forEach(l=>{ gudangNamaByLokasiId[l.id] = gudangList.find(g=>g.id===l.gudangId)?.nama || ""; });
    const withLokasi = s => ({ gudang: gudangNamaByLokasiId[s.lokasiId]||"", blok: s.lokasi||"-" });
    const top20 = [...enrichedStocks].sort((a,b)=>(b.qty*b.price)-(a.qty*a.price)).slice(0,20);
    const kritis = enrichedStocks.filter(s=>s.minQty>0&&s.qty<=s.minQty);
    const pending = txns.filter(t=>t.status==="PENDING");
    const tiga_bulan_lalu = Date.now() - 90*24*60*60*1000;
    const txnRecent = txns.filter(t=>t.createdAt>=tiga_bulan_lalu && t.status==="APPROVED");
    const usageSummary = {};
    txnRecent.forEach(t=>{
      (t.stockItems||[]).forEach(si=>{
        const s = enrichedStocks.find(x=>x.id===si.stockId);
        if(!s) return;
        if(!usageSummary[s.name]) usageSummary[s.name]={total:0,count:0};
        usageSummary[s.name].total += si.qty||0;
        usageSummary[s.name].count += 1;
      });
    });
    const topPakai = Object.entries(usageSummary).sort((a,b)=>b[1].total-a[1].total).slice(0,10).map(([nama,d])=>({nama, total:d.total, count:d.count}));
    const plus30 = Date.now()+30*24*60*60*1000;
    const rencana30 = rencanaKedatanganList
      .flatMap(r=>(r.items||[]).map(i=>({...i,supplier:r.supplier,tanggalSerahTerima:r.tanggalSerahTerima,noKontrak:r.noKontrak})))
      .filter(i=>i.tanggalSerahTerima&&new Date(i.tanggalSerahTerima).getTime()<=plus30)
      .sort((a,b)=>new Date(a.tanggalSerahTerima)-new Date(b.tanggalSerahTerima));

    return {
      generatedAt: new Date().toISOString(),
      totalItem: enrichedStocks.length,
      totalNilaiRp: Math.round(enrichedStocks.reduce((a,s)=>a+(s.qty*s.price),0)),
      top20ByValue: top20.map(s=>({ nama:s.name, katalog:s.katalog, qty:s.qty, satuan:s.unit, hargaSatuan:s.price, nilaiRp: Math.round(s.qty*s.price), status:getSAPLabel(s.katalog), ...withLokasi(s) })),
      materialKritis: kritis.map(s=>({ nama:s.name, katalog:s.katalog, qty:s.qty, satuan:s.unit, minQty:s.minQty, ...withLokasi(s) })),
      pemakaian3BulanTop10: topPakai,
      tugPendingApproval: pending.map(t=>({ docType:t.docType, id:t.id, namaPekerjaan:t.namaPekerjaan, requiredApprover:t.requiredApprover, createdAt:t.createdAt })),
      rencanaKedatangan30Hari: rencana30.map(i=>({ namaBarang:i.namaBarang, jumlah:i.jumlah, satuan:i.satuan, supplier:i.supplier, noKontrak:i.noKontrak, tanggalSerahTerima:i.tanggalSerahTerima })),
    };
  }

  async function syncWarnotoState(silent = false) {
    if (!supabase) return;
    try {
      const state_data = buildWarnotoStateSnapshot();
      const { error } = await supabase.from("warnoto_state").insert({ state_data, version: "v1" });
      if (error) throw error;
    } catch (err) {
      if (!silent) showToast("Gagal sinkron State Gudang (untuk bot WA/Telegram): " + err.message, "error");
      else console.error("Auto-sync warnoto_state gagal:", err.message);
    }
  }

  // Salin qty+harga Data Stok ke tabel Supabase `stocks_snapshot` — khusus supaya cron malam
  // (nightly_sync.mjs, jalan di GitHub Actions tanpa browser terbuka) bisa hitung ulang
  // top-N/stok kritis dengan harga yang benar. Tanpa ini, harga cuma ada di localStorage
  // browser, tidak bisa diakses proses server-side sama sekali. "Whole list is the truth"
  // (upsert + hapus yang sudah tidak ada), sama pola dengan sync master data lain.
  async function syncStocksSnapshot(silent = false) {
    if (!supabase) return;
    try {
      const rows = enrichedStocks.map(s => {
        const lok = lokasiList.find(l=>l.id===s.lokasiId);
        const gdg = lok?.gudangId ? gudangList.find(g=>g.id===lok.gudangId) : null;
        return {
          id: s.id, katalog_id: s.katalogId || null, nama: s.name,
          qty: s.qty || 0, satuan: s.unit || "", harga: s.price || 0,
          jenis_barang: s.jenisBarang || "", min_qty: s.minQty || 0,
          lokasi_kode: lok?.kode || s.lokasi || null, gudang_nama: gdg?.nama || null,
          kode_katalog: s.katalog || null,
          updated_at: new Date().toISOString(),
        };
      });
      if (rows.length > 0) {
        const { error } = await supabase.from("stocks_snapshot").upsert(rows, { onConflict: "id" });
        if (error) throw error;
      }
      const currentIds = new Set(rows.map(r=>r.id));
      const { data: existing } = await supabase.from("stocks_snapshot").select("id");
      const toDelete = (existing||[]).filter(r=>!currentIds.has(r.id)).map(r=>r.id);
      if (toDelete.length) await supabase.from("stocks_snapshot").delete().in("id", toDelete);
    } catch (err) {
      if (!silent) showToast("Gagal sinkron Stocks Snapshot (untuk cron malam bot): " + err.message, "error");
      else console.error("Auto-sync stocks_snapshot gagal:", err.message);
    }
  }

  async function sendChat(overrideMsg) {
    const msg = overrideMsg || chatInput.trim();
    if (!msg || chatLoading) return;
    if (!overrideMsg) setChatInput("");
    setChatHistory(h=>[...h,{role:"user",text:msg}]);
    setChatLoading(true);

    // Build rich context from live system data
    const now = new Date();
    const tiga_bulan_lalu = Date.now() - 90*24*60*60*1000;
    const txnRecent = txns.filter(t=>t.createdAt>=tiga_bulan_lalu && t.status==="APPROVED");

    // Top 20 material by nilai
    const top20 = [...enrichedStocks]
      .sort((a,b)=>(b.qty*b.price)-(a.qty*a.price))
      .slice(0,20);

    // Stok kritis
    const kritis = enrichedStocks.filter(s=>s.minQty>0&&s.qty<=s.minQty);

    // Pending approvals
    const pending = txns.filter(t=>t.status==="PENDING");
    const pendingDetailText = pending.length===0 ? "Tidak ada transaksi pending." : pending
      .map(t=>{
        const creator = users.find(u=>u.id===t.createdBy);
        const hariMenunggu = Math.floor((Date.now()-t.createdAt)/(24*60*60*1000));
        return `- [${t.docType}] ${t.id} | Pekerjaan: ${t.namaPekerjaan} | Pemohon: ${creator?.name||"?"} | Menunggu approval: ${ROLES[t.requiredApprover]||t.requiredApprover} | Sudah menunggu: ${hariMenunggu} hari`;
      }).join("\n");

    // Rencana kedatangan 30 hari
    const plus30 = Date.now()+30*24*60*60*1000;
    const rencana30 = rencanaKedatanganList
      .flatMap(r=>(r.items||[]).map(i=>({...i,supplier:r.supplier,tanggalSerahTerima:r.tanggalSerahTerima,noKontrak:r.noKontrak})))
      .filter(i=>i.tanggalSerahTerima&&new Date(i.tanggalSerahTerima).getTime()<=plus30);
    const rencana30DetailText = rencana30.length===0 ? "Tidak ada rencana kedatangan dalam 30 hari ke depan." : rencana30
      .sort((a,b)=>new Date(a.tanggalSerahTerima)-new Date(b.tanggalSerahTerima))
      .map(i=>{
        const sisaHari = Math.ceil((new Date(i.tanggalSerahTerima).getTime()-Date.now())/(24*60*60*1000));
        return `- ${i.namaBarang} | Qty: ${i.jumlah} ${i.satuan} | Supplier: ${i.supplier} | No. Kontrak: ${i.noKontrak||"-"} | Tanggal Serah Terima: ${fmtDate(i.tanggalSerahTerima)} (${sisaHari} hari lagi)`;
      }).join("\n");

    // Pemakaian per bulan (3 bulan terakhir)
    const usageSummary = {};
    txnRecent.forEach(t=>{
      (t.stockItems||[]).forEach(si=>{
        const s = enrichedStocks.find(x=>x.id===si.stockId);
        if(!s) return;
        if(!usageSummary[s.name]) usageSummary[s.name]={total:0,count:0};
        usageSummary[s.name].total += si.qty||0;
        usageSummary[s.name].count += 1;
      });
    });
    const topPakai = Object.entries(usageSummary).sort((a,b)=>b[1].total-a[1].total).slice(0,10);

    // ── RAG: cari chunk (katalog/transaksi) yang paling relevan secara makna
    // dengan pertanyaan user — pelengkap snapshot di atas yang cuma top-N
    // hardcoded. Kalau Cohere/knowledge base belum siap, lewati saja (tetap
    // jawab pakai snapshot biasa) — RAG di sini bersifat tambahan, bukan
    // syarat AI Agent bisa jalan.
    let ragContextText = "Belum ada hasil pencarian (Knowledge Base RAG belum disinkron atau belum terkonfigurasi).";
    try {
      if (supabase && import.meta.env.VITE_COHERE_API_KEY) {
        const [queryVector] = await cohereEmbed([msg], "search_query");
        const { data: matches, error } = await supabase.rpc("match_rag_chunks", { query_embedding: queryVector, match_count: 8 });
        if (error) throw error;
        if (matches && matches.length>0) {
          ragContextText = matches.map(m=>`- (relevansi ${(m.similarity*100).toFixed(0)}%) ${m.content}`).join("\n");
        } else {
          ragContextText = "Tidak ada hasil yang relevan ditemukan di Knowledge Base.";
        }
      }
    } catch (e) {
      ragContextText = `(Pencarian Knowledge Base gagal: ${e.message})`;
    }

    const systemPrompt = `Kamu adalah AI Agent sistem manajemen gudang PLN bernama WARNOTO untuk ${WAREHOUSE}.

INSTRUKSI FORMAT JAWABAN:
Selalu jawab dalam format terstruktur berikut (gunakan emoji dan baris baru):

📊 DATA
[fakta & angka spesifik dari data sistem]

🔍 ANALISIS
[interpretasi, konteks, dan temuan penting]

💡 REKOMENDASI
[tindakan konkret yang disarankan, spesifik dan dapat dilakukan]

Sumber: Data WARNOTO per ${now.toLocaleDateString("id-ID")}

---
SNAPSHOT DATA SISTEM SAAT INI:

INVENTORI (${enrichedStocks.length} item total):
Nilai total: Rp ${fmtNum(Math.round(enrichedStocks.reduce((a,s)=>a+(s.qty*s.price),0)))}
Top 20 material by nilai:
${top20.map(s=>`- ${s.name} [${s.katalog}]: ${fmtNum(s.qty)} ${s.unit} | Rp ${fmtNum(Math.round(s.qty*s.price))}`).join('\n')}

MATERIAL KRITIS (stok ≤ minimum):
${kritis.length===0?"Tidak ada material kritis":kritis.map(s=>`- ${s.name}: stok ${s.qty} ${s.unit}, min ${s.minQty}`).join('\n')}

PEMAKAIAN 3 BULAN TERAKHIR (top 10):
${topPakai.map(([nama,d])=>`- ${nama}: ${d.total} unit (${d.count}x transaksi)`).join('\n')}

${formatStockStatsText(enrichedStocks)}

TUG PENDING APPROVAL (${pending.length} transaksi):
${pendingDetailText}

RENCANA KEDATANGAN (30 hari, ${rencana30.length} item):
${rencana30DetailText}

---
HASIL PENCARIAN KNOWLEDGE BASE (paling relevan dengan pertanyaan user, dari RAG — bisa berisi data yang TIDAK ada di snapshot top-N di atas, mis. material di luar top 20/transaksi lebih lama):
${ragContextText}

Jawab pertanyaan user berdasarkan data di atas (gabungkan snapshot dan hasil pencarian Knowledge Base). Gunakan Bahasa Indonesia yang profesional.`;

    try {
      const resp = await fetch("https://api.groq.com/openai/v1/chat/completions",{
        method:"POST",
        headers:{"Content-Type":"application/json","Authorization":`Bearer ${import.meta.env.VITE_GROQ_API_KEY}`},
        body:JSON.stringify({
          model:"llama-3.3-70b-versatile",
          max_tokens:1500,
          messages:[
            {role:"system",content:systemPrompt},
            ...chatHistory.filter(m=>m.role!=="ai"||chatHistory.indexOf(m)>0).slice(-8).map(m=>({
              role:m.role==="user"?"user":"assistant",
              content:m.text
            })),
            {role:"user",content:msg}
          ]
        })
      });
      const data = await resp.json();
      const reply = data.choices?.[0]?.message?.content || "Maaf, tidak ada jawaban dari AI.";
      setChatHistory(h=>[...h,{role:"ai",text:reply}]);
    } catch {
      setChatHistory(h=>[...h,{role:"ai",text:"❌ Gagal koneksi ke AI. Periksa koneksi internet."}]);
    }
    setChatLoading(false);
  }

  async function forecastDrillDown(katalog, stockRows) {
    setForecastDetailLoading(true);
    setForecastDetailResult(null);

    // Build history pemakaian per bulan
    const historyMap = {};
    txns.filter(t=>["TUG9","TUG8"].includes(t.docType)&&t.status==="APPROVED").forEach(t=>{
      const tgl = new Date(t.approvedAt||t.createdAt);
      const bulanKey = `${tgl.getFullYear()}-${String(tgl.getMonth()+1).padStart(2,"0")}`;
      (t.stockItems||[]).forEach(si=>{
        const s = enrichedStocks.find(x=>x.id===si.stockId);
        if(!s||s.katalogId!==katalog.id) return;
        if(!historyMap[bulanKey]) historyMap[bulanKey]=0;
        historyMap[bulanKey]+=si.qty||0;
      });
    });
    const history = Object.entries(historyMap).sort().slice(-12);
    const totalQty = stockRows.reduce((a,s)=>a+(s.qty||0),0);
    const rencana = rencanaKedatanganList
      .flatMap(r=>(r.items||[]).map(i=>({...i,noKontrak:r.noKontrak,supplier:r.supplier,tanggalSerahTerima:r.tanggalSerahTerima})))
      .filter(i=>i.katalogId===katalog.id);

    const prompt = `Analisis mendalam untuk material berikut:

Material: ${katalog.name}
No Katalog: ${katalog.katalog}
Jenis: ${katalog.jenisBarang||"-"}
Satuan: ${katalog.satuan}
Stok saat ini: ${totalQty} ${katalog.satuan}
Min stok: ${stockRows[0]?.minQty||0}

History pemakaian per bulan (${history.length} bulan):
${history.length===0?"Belum ada data pemakaian":history.map(([b,q])=>`${b}: ${q} ${katalog.satuan}`).join('\n')}

Rencana kedatangan:
${rencana.length===0?"Tidak ada rencana kedatangan":rencana.map(r=>`- ${r.jumlah} ${r.satuan} dari ${r.supplier} (${r.tanggalSerahTerima})`).join('\n')}

Berikan analisis forecast dalam format:

📊 DATA
[ringkasan data pemakaian, rata-rata, tren]

🔍 ANALISIS
[pola pemakaian, prediksi kebutuhan 1/3/6 bulan ke depan, faktor risiko]

💡 REKOMENDASI
[waktu pengadaan ideal, jumlah yang perlu diadakan, safety stock yang disarankan]

Sumber: Data TUG WARNOTO UPT Surabaya`;

    try {
      const resp = await fetch("https://api.groq.com/openai/v1/chat/completions",{
        method:"POST",
        headers:{"Content-Type":"application/json","Authorization":`Bearer ${import.meta.env.VITE_GROQ_API_KEY}`},
        body:JSON.stringify({model:"llama-3.3-70b-versatile",max_tokens:1200,messages:[{role:"user",content:prompt}]})
      });
      const data = await resp.json();
      const result = data.choices?.[0]?.message?.content||"Tidak ada hasil.";
      setForecastDetailResult(result);
    } catch {
      setForecastDetailResult("❌ Gagal koneksi ke AI.");
    }
    setForecastDetailLoading(false);
  }

  // ── DERIVED ──
  // enrichedStocks: each row from `stocks` (junction table) joined with its
  // Master Katalog and Master Lokasi data, shaped to look like the old flat
  // stock record so the rest of the UI/PDF/forecast code can use familiar
  // fields (name, katalog, category, unit, lokasi) without modification.
  const enrichedStocks = enrichStocks(stocks, katalogList, lokasiList);
  const myPendingApprovals = txns.filter(t => {
    if (t.status === "PENDING" && t.requiredApprover === currentUser?.role) return true;
    // TUG-5: Asman and Manager see their respective stages
    if (t.docType==="TUG5" && t.stage==="PENDING_ASMAN" && currentUser?.role==="ASMAN") return true;
    if (t.docType==="TUG5" && t.stage==="PENDING_MANAGER" && currentUser?.role==="MANAGER") return true;
    // TUG-7 DRAFT_UIT stage needs Admin UIT attention
    if (t.docType==="TUG7" && t.stage==="DRAFT_UIT" && currentUser?.role==="ADMIN_UIT") return true;
    // TUG-7 PENDING_MGR_LOGISTIK needs Manager Logistik UIT
    if (t.docType==="TUG7" && t.stage==="PENDING_MGR_LOGISTIK" && currentUser?.role==="MGR_LOGISTIK_UIT") return true;
    // TUG-8 DRAFT from TUG-7 needs Admin/TL UPT to confirm
    if (t.docType==="TUG8" && t.stage==="DRAFT_TUG8" && ["ADMIN","TL"].includes(currentUser?.role)) return true;
    // TUG-5 dari ULTG: Manager ULTG (unit yang sama) approve
    if (t.docType==="TUG5" && t.sourceType==="ULTG" && t.stage==="PENDING_MGR_ULTG" && currentUser?.role==="MGR_ULTG" && t.ultgId===currentUser?.ultgId) return true;
    return false;
  });
  // Pengajuan TUG-5 dari ULTG yang sudah disetujui Manager ULTG, siap di-adopt oleh Admin/TL UPT induknya.
  // currentUser.uptId biasanya KOSONG untuk akun ADMIN/TL biasa (UPT mereka ditentukan dari konstanta
  // global UPT/WAREHOUSE, bukan field profil) — fallback cocokkan nama UPT konstan ke Master UPT.
  const appUptShortForAdopt = (typeof UPT !== "undefined" ? UPT : "").replace(/^UPT\s+/i,"").trim();
  const currentUserUptId = currentUser?.uptId
    || (ultgList.find(u=>u.id===currentUser?.ultgId)?.parentUptId)
    || (uptList.find(u=>String(u.nama||"").toUpperCase().includes(appUptShortForAdopt.toUpperCase()))?.id);
  const ultgPengajuanUntukAdopt = ["ADMIN","TL"].includes(currentUser?.role) ? txns.filter(t =>
    t.docType==="TUG5" && t.sourceType==="ULTG" && t.stage==="APPROVED_ULTG" && !t.adoptedBy &&
    ultgList.find(u=>u.id===t.ultgId)?.parentUptId === currentUserUptId
  ) : [];
  const pendingTxns = txns.filter(t=>t.status==="PENDING");
  const stockCountPendingCount = stockCountList.reduce((a,s)=>a+s.items.filter(i=>i.approval==="PENDING").length, 0);
  const heavyEquipmentPendingCount = heavyEquipmentLoans.filter(l=>isPendingHeavyEquipmentLoan(l) && canApproveHeavyEquipmentLoan(currentUser, l)).length;
  const heavyEquipmentOverdueCount = heavyEquipmentLoans.filter(l=>getHeavyEquipmentLoanRuntimeStatus(l)==="OVERDUE").length;
  const lowStocks = enrichedStocks.filter(s=>s.jenisBarang!=="Non-Stock" && s.qty<=s.minQty);
  const totalVal = enrichedStocks.reduce((a,s)=>a+s.qty*s.price,0);
  const filteredStocks = enrichedStocks.filter(s=>{
    const ms = matchesStockSearch(s, search);
    const mj = filterJenis==="ALL" || s.jenisBarang===filterJenis;
    return ms && mj;
  });
  const stockTotalPages = Math.max(1, Math.ceil(filteredStocks.length / stockPageSize));
  const stockPageClamped = Math.min(stockPage, stockTotalPages);
  const pagedStocks = filteredStocks.slice((stockPageClamped-1)*stockPageSize, stockPageClamped*stockPageSize);
  const katalogTotalPages = Math.max(1, Math.ceil(katalogList.length / katalogPageSize));
  const katalogPageClamped = Math.min(katalogPage, katalogTotalPages);
  const pagedKatalog = katalogList.slice((katalogPageClamped-1)*katalogPageSize, katalogPageClamped*katalogPageSize);
  const filteredTxns = txns.filter(t=> filterStatus==="ALL" || t.status===filterStatus).sort((a,b)=>b.createdAt-a.createdAt);

  // ── DESIGN TOKENS ──
  const C = { bg:"#f0f4f8", surface:"#ffffff", sidebar:"#003087", accent:"#003087", yellow:"#f59e0b", green:"#16a34a", red:"#dc2626", text:"#111827", muted:"#6b7280", border:"#e5e7eb" };
  // Target sentuh & ukuran font input dibesarkan otomatis di HP (isMobile):
  // - tombol minimal ~44px tinggi (standar minimum tap target Apple/Google)
  //   supaya tidak gampang salah pencet pakai jari.
  // - font input >=16px di HP supaya Safari/Chrome iOS tidak auto-zoom saat
  //   field di-tap (auto-zoom terjadi kalau font input <16px).
  const sty = {
    btn:(v="primary",sz="md")=>({ padding:isMobile?(sz==="sm"?"10px 14px":"12px 18px"):(sz==="sm"?"5px 10px":"9px 18px"), minHeight:isMobile?44:undefined, borderRadius:8, border:"none", cursor:"pointer", fontWeight:600, fontSize:isMobile?(sz==="sm"?13:14):(sz==="sm"?11:13), background: v==="primary"?C.accent:v==="danger"?C.red:v==="success"?C.green:v==="warn"?C.yellow:"#f3f4f6", color:v==="ghost"?C.text:"white" }),
    card:{ background:C.surface, borderRadius:12, border:`1px solid ${C.border}`, padding:20 },
    // Tombol Batal/Simpan "menempel" di bawah kartu modal (position:sticky)
    // supaya di form panjang (banyak baris material) user tidak perlu scroll
    // balik ke bawah cuma untuk menemukan tombol submit. bottom/marginBottom
    // negatif menutupi padding bawah sty.card (20px) supaya menempel pas di
    // tepi, bukan menggantung dengan jarak kosong di bawahnya.
    stickyFooter:{ display:"flex", gap:10, position:"sticky", bottom:-20, background:C.surface, padding:"14px 0 0", marginTop:14, marginBottom:-20, borderTop:`1px solid ${C.border}` },
    // Pakai padding longhand (bukan shorthand "Npx Mpx") supaya tempat yang
    // perlu override paddingRight sendiri (mis. input cari + tombol clear)
    // tidak bentrok shorthand-vs-longhand di style yang sama (React warning
    // "Updating padding paddingRight").
    input:{ background:"#f9fafb", border:`1px solid ${C.border}`, borderRadius:8, color:C.text, paddingTop:isMobile?12:8, paddingBottom:isMobile?12:8, paddingLeft:isMobile?14:12, paddingRight:isMobile?14:12, minHeight:isMobile?44:undefined, fontSize:isMobile?16:13, outline:"none", width:"100%" },
    select:{ background:"#f9fafb", border:`1px solid ${C.border}`, borderRadius:8, color:C.text, paddingTop:isMobile?12:8, paddingBottom:isMobile?12:8, paddingLeft:isMobile?14:12, paddingRight:isMobile?14:12, minHeight:isMobile?44:undefined, fontSize:isMobile?16:13, outline:"none", width:"100%" },
    label:{ fontSize:11, color:C.muted, display:"block", marginBottom:4, fontWeight:600, textTransform:"uppercase", letterSpacing:".5px" },
    statusBadge:(s)=>({ padding:"3px 10px", borderRadius:20, fontSize:10, fontWeight:700, background:s==="APPROVED"?"#dcfce7":s==="PENDING"?"#fef3c7":s==="REJECTED"?"#fee2e2":"#f3f4f6", color:s==="APPROVED"?C.green:s==="PENDING"?C.yellow:s==="REJECTED"?C.red:C.muted }),
    jenisBadge:(j)=>({ padding:"2px 8px", borderRadius:20, fontSize:10, fontWeight:700,
      background: j==="Pre Memory"?"#dbeafe":j==="Cadang"?"#f3e8ff":j==="Persediaan"?"#dcfce7":j==="Persediaan Bursa"?"#fff7ed":j==="ATTB"?"#fef3c7":j==="Non-Stock"?"#fce7f3":"#f3f4f6",
      color: j==="Pre Memory"?"#1d4ed8":j==="Cadang"?"#7c3aed":j==="Persediaan"?C.green:j==="Persediaan Bursa"?"#ea580c":j==="ATTB"?C.yellow:j==="Non-Stock"?"#be185d":C.muted }),
  };

  // ══════════════════════ PUBLIC SCAN VIEW (QR dari HP, tanpa login) ══════════════════════
  const scanKatalogId = new URLSearchParams(window.location.search).get("scan");
  if (scanKatalogId) return <ScanPublicView katalogId={scanKatalogId} />;

  // ══════════════════════ LOGIN ══════════════════════
  // Selama authLoading, jangan tampilkan form login dulu — supaya tidak kedip
  // ke layar login sesaat sebelum sesi Supabase Auth yang tersimpan terdeteksi.
  if (authLoading) return (
    <div style={{minHeight:"100vh",background:"linear-gradient(135deg,#001a57 0%,#003087 50%,#0052cc 100%)",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'Inter',system-ui,sans-serif",color:"white",fontSize:13}}>
      Memuat sesi...
    </div>
  );

  if (!currentUser) return (
    <div style={{minHeight:"100vh",background:"linear-gradient(135deg,#001a57 0%,#003087 50%,#0052cc 100%)",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'Inter',system-ui,sans-serif"}}>
      <div style={{background:"white",borderRadius:20,padding:40,width:400,boxShadow:"0 25px 60px rgba(0,0,0,0.35)"}}>
        <div style={{textAlign:"center",marginBottom:32}}>
          <div style={{width:72,height:72,background:"#003087",borderRadius:"50%",display:"flex",alignItems:"center",justifyContent:"center",fontSize:32,margin:"0 auto 16px"}}>⚡</div>
          <div style={{fontSize:11,color:C.muted,fontWeight:600,letterSpacing:1,textTransform:"uppercase",marginBottom:4}}>{COMPANY}</div>
          <div style={{fontSize:16,fontWeight:800,color:"#003087"}}>{UPT}</div>
          <div style={{fontSize:13,color:C.muted}}>{WAREHOUSE} — Sistem TUG Digital</div>
        </div>
        <div style={{marginBottom:16}}>
          <label style={sty.label}>Username</label>
          <input style={sty.input} placeholder="Masukkan username..." value={loginForm.username} onChange={e=>setLoginForm(f=>({...f,username:e.target.value}))} onKeyDown={e=>e.key==="Enter"&&handleLogin()} autoFocus/>
        </div>
        <div style={{marginBottom:8}}>
          <label style={sty.label}>Password</label>
          <input style={sty.input} type="password" placeholder="Masukkan password..." value={loginForm.password} onChange={e=>setLoginForm(f=>({...f,password:e.target.value}))} onKeyDown={e=>e.key==="Enter"&&handleLogin()}/>
        </div>
        {loginErr && <div style={{color:C.red,fontSize:12,marginBottom:12,padding:"8px 12px",background:"#fee2e2",borderRadius:8}}>{loginErr}</div>}
        <button style={{...sty.btn("primary"),width:"100%",padding:"12px",fontSize:15,marginTop:8,opacity:loginBusy?0.6:1,cursor:loginBusy?"default":"pointer"}} onClick={handleLogin} disabled={loginBusy}>{loginBusy?"Memeriksa...":"Masuk ke Sistem"}</button>
        <div style={{marginTop:16,fontSize:11,color:C.muted,textAlign:"center"}}>Lupa password? Hubungi Admin untuk reset manual.</div>
      </div>
    </div>
  );

  if (loading) return (
    <div style={{minHeight:"100vh",background:C.bg,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'Inter',system-ui,sans-serif"}}>
      <div style={{textAlign:"center"}}><div style={{fontSize:40,marginBottom:12}}>⚡</div><div style={{fontSize:16,fontWeight:700,color:"#003087"}}>Memuat data dari cloud...</div></div>
    </div>
  );

  // ══════════════════════ MAIN APP ══════════════════════
  // Role PENGADAAN hanya punya akses Dashboard + Rencana Kedatangan
  const isPengadaan = currentUser.role === "PENGADAAN";
  // Role ULTG (Admin/Manager ULTG): sidebar terbatas — semua view-only kecuali TUG-5 & Approval TUG-5
  const isUltgRole = ULTG_ROLES.includes(currentUser.role);
  const navItems = isPengadaan ? [
    {id:"dashboard",icon:"📊",label:"Dashboard"},
    {id:"rencana",icon:"📅",label:"Rencana Kedatangan"},
  ] : isUltgRole ? [
    {id:"dashboard",icon:"📊",label:"Dashboard"},
    {id:"stock",icon:"📦",label:"Data Stok"},
    {id:"transaction",icon:"🔄",label:"TUG"},
    {id:"approval",icon:"✅",label:"Approval",badge: currentUser.role==="MGR_ULTG" ? myPendingApprovals.length : 0},
    {id:"heavyEquipment",icon:"🚜",label:"Alat Berat"},
    {id:"rencana",icon:"📅",label:"Rencana Kedatangan"},
    {id:"forecastStok",icon:"📈",label:"Forecast Stok"},
    {id:"ai",icon:"🤖",label:"AI Agent"},
  ] : [
    {id:"dashboard",icon:"📊",label:"Dashboard"},
    {id:"stock",icon:"📦",label:"Data Stok"},
    {id:"master",icon:"🗂️",label:"Master Data"},
    {id:"transaction",icon:"🔄",label:"TUG"},
    ...(["TL","ASMAN","MANAGER","ADMIN_UIT","MGR_LOGISTIK_UIT","ADMIN"].includes(currentUser.role) ? [{id:"approval",icon:"✅",label:"Approval",badge:myPendingApprovals.length + (currentUser.role==="ASMAN"?heavyEquipmentPendingCount:0) + (["TL","ASMAN"].includes(currentUser.role) ? gudangCapacityImports.filter(i=>i.status==="PENDING_ASMAN").length : 0) + (currentUser.role==="TL" ? lokasiList.filter(l=>l.status==="PENDING").length : 0) + (["ADMIN","TL"].includes(currentUser.role) ? ultgPengajuanUntukAdopt.length : 0)}] : []),
    {id:"heavyEquipment",icon:"🚜",label:"Alat Berat",badge:(currentUser.role==="ASMAN"?heavyEquipmentPendingCount:0)+heavyEquipmentOverdueCount},
    {id:"opname",icon:"📋",label:"Stock Opname & Count",badge:stockCountPendingCount},
    {id:"rencana",icon:"📅",label:"Rencana Kedatangan"},
    {id:"kapasitasGudang",icon:"📐",label:"Kapasitas Gudang"},
    {id:"forecastStok",icon:"📈",label:"Forecast Stok"},
    {id:"ai",icon:"🤖",label:"AI Agent"},
  ];

  return (
    <div style={{display:"flex",minHeight:"100vh",fontFamily:"'Inter',system-ui,sans-serif",background:C.bg}}>
      {/* Di HP: toast dipusatkan & dibatasi lebar (bukan nempel kanan tanpa batas
          lebar) supaya pesan panjang tidak terpotong/keluar layar. */}
      {toast && (
        <div style={isMobile
          ? {position:"fixed",top:16,left:16,right:16,zIndex:9999,background:toast.type==="error"?C.red:C.green,color:"white",padding:"12px 16px",borderRadius:10,fontSize:14,fontWeight:600,boxShadow:"0 8px 24px rgba(0,0,0,0.25)",textAlign:"center"}
          : {position:"fixed",top:20,right:20,maxWidth:420,zIndex:9999,background:toast.type==="error"?C.red:C.green,color:"white",padding:"12px 20px",borderRadius:10,fontSize:13,fontWeight:600,boxShadow:"0 8px 24px rgba(0,0,0,0.2)"}
        }>{toast.msg}</div>
      )}
      {scannerOpen && <BarcodeScanner onDetect={handleScanResult} onClose={()=>setScannerOpen(false)}/>}

      {/* Overlay gelap di belakang drawer sidebar saat dibuka di HP — tap di luar drawer untuk menutup */}
      {isMobile && mobileMenuOpen && (
        <div onClick={()=>setMobileMenuOpen(false)} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.45)",zIndex:1400}}/>
      )}

      {/* SIDEBAR — di desktop tetap menempel di kiri; di HP jadi drawer yang slide-in dari kiri,
          disembunyikan (translateX(-100%)) sampai tombol ☰ ditekan. */}
      <div style={{
        width:240, background:C.sidebar, display:"flex", flexDirection:"column", flexShrink:0,
        ...(isMobile ? {
          position:"fixed", top:0, left:0, bottom:0, zIndex:1500,
          transform:mobileMenuOpen ? "translateX(0)" : "translateX(-100%)",
          transition:"transform 0.25s ease", boxShadow:"4px 0 16px rgba(0,0,0,0.3)",
        } : {}),
      }}>
        <div style={{padding:"20px 16px",borderBottom:"1px solid rgba(255,255,255,0.1)"}}>
          <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:6}}>
            <div style={{width:36,height:36,background:"rgba(255,255,255,0.15)",borderRadius:8,display:"flex",alignItems:"center",justifyContent:"center",fontSize:20}}>⚡</div>
            <div><div style={{color:"white",fontWeight:800,fontSize:13,lineHeight:1.2}}>PLN TUG Digital</div><div style={{color:"rgba(255,255,255,0.6)",fontSize:10}}>{WAREHOUSE}</div></div>
          </div>
          <div style={{fontSize:10,color:"rgba(255,255,255,0.5)",lineHeight:1.4}}>{UPT}</div>
        </div>
        <div style={{flex:1,padding:"12px 8px",overflowY:"auto"}}>
          {navItems.map(n => {
            if (n.id === "transaction") {
              // TUG item: accordion parent — click expands, sub-items navigate
              const isActive = tab === "transaction";
              return (
                <div key="transaction">
                  <button
                    style={{display:"flex",alignItems:"center",gap:10,width:"100%",padding:"9px 12px",minHeight:isMobile?44:undefined,borderRadius:8,border:"none",cursor:"pointer",background:isActive?"rgba(255,255,255,0.15)":"transparent",color:isActive?"white":"rgba(255,255,255,0.65)",fontSize:13,fontWeight:isActive?700:400,marginBottom:2,textAlign:"left"}}
                    onClick={()=>setTugExpanded(e=>!e)}
                  >
                    <span>{n.icon}</span>
                    <span style={{flex:1}}>{n.label}</span>
                    <span style={{fontSize:10,opacity:0.7,transition:"transform 0.2s",transform:tugExpanded?"rotate(90deg)":"rotate(0deg)"}}>▶</span>
                  </button>
                  {tugExpanded && (
                    <div style={{marginBottom:4}}>
                      {(isUltgRole ? [
                        {id:"permintaan",icon:"📋",label:"Permintaan (TUG-5)",defaultSub:"TUG5"},
                      ] : [
                        {id:"penerimaan",icon:"📥",label:"Penerimaan (TUG-3/4/10)",defaultSub:"TUG3"},
                        {id:"pengeluaran",icon:"📤",label:"Pengeluaran (TUG-8/9)",defaultSub:"TUG9"},
                        {id:"permintaan",icon:"📋",label:"Permintaan (TUG-5)",defaultSub:"TUG5"},
                        {id:"laporan",icon:"📊",label:"Laporan (TUG-15)",defaultSub:"TUG15"},
                      ]).map(sub=>{
                        const subActive = isActive && tugGroup===sub.id;
                        return (
                          <button
                            key={sub.id}
                            style={{display:"flex",alignItems:"center",gap:8,width:"100%",padding:"7px 12px 7px 32px",minHeight:isMobile?44:undefined,borderRadius:8,border:"none",cursor:"pointer",background:subActive?"rgba(255,255,255,0.12)":"transparent",color:subActive?"white":"rgba(255,255,255,0.55)",fontSize:12,fontWeight:subActive?700:400,marginBottom:1,textAlign:"left",borderLeft:subActive?"2px solid rgba(255,255,255,0.4)":"2px solid transparent"}}
                            onClick={()=>{setTab("transaction"); setTugGroup(sub.id); setTugSubTab(sub.defaultSub); setMobileMenuOpen(false);}}
                          >
                            <span>{sub.icon}</span> {sub.label}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            }
            if (n.id === "master") {
              // Master Data item: accordion parent — click expands, sub-items navigate
              const isActive = tab === "master";
              return (
                <div key="master">
                  <button
                    style={{display:"flex",alignItems:"center",gap:10,width:"100%",padding:"9px 12px",minHeight:isMobile?44:undefined,borderRadius:8,border:"none",cursor:"pointer",background:isActive?"rgba(255,255,255,0.15)":"transparent",color:isActive?"white":"rgba(255,255,255,0.65)",fontSize:13,fontWeight:isActive?700:400,marginBottom:2,textAlign:"left"}}
                    onClick={()=>setMasterExpanded(e=>!e)}
                  >
                    <span>{n.icon}</span>
                    <span style={{flex:1}}>{n.label}</span>
                    <span style={{fontSize:10,opacity:0.7,transition:"transform 0.2s",transform:masterExpanded?"rotate(90deg)":"rotate(0deg)"}}>▶</span>
                  </button>
                  {masterExpanded && (
                    <div style={{marginBottom:4}}>
                      {[
                        {id:"katalog",icon:"📑",label:"Master Katalog"},
                        {id:"satpam",icon:"🛡️",label:"Satpam"},
                        {id:"timmutu",icon:"👥",label:"Tim Mutu"},
                        {id:"organisasi",icon:"🏢",label:"Struktur Organisasi"},
                        {id:"gudang",icon:"🏭",label:"Master Gudang"},
        ...(currentUser.role==="ADMIN" ? [{id:"migrasi",icon:"🔄",label:"Migrasi Data"}] : []),
                      ].map(sub=>{
                        const subActive = isActive && stockSubTab===sub.id;
                        return (
                          <button
                            key={sub.id}
                            style={{display:"flex",alignItems:"center",gap:8,width:"100%",padding:"7px 12px 7px 32px",minHeight:isMobile?44:undefined,borderRadius:8,border:"none",cursor:"pointer",background:subActive?"rgba(255,255,255,0.12)":"transparent",color:subActive?"white":"rgba(255,255,255,0.55)",fontSize:12,fontWeight:subActive?700:400,marginBottom:1,textAlign:"left",borderLeft:subActive?"2px solid rgba(255,255,255,0.4)":"2px solid transparent"}}
                            onClick={()=>{setTab("master"); setStockSubTab(sub.id); setMobileMenuOpen(false);}}
                          >
                            <span>{sub.icon}</span> {sub.label}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            }
            if (n.id === "opname") {
              // Stock Opname & Stock Count digabung 1 menu: accordion parent — click expands, sub-items navigate
              const isActive = tab === "opname";
              return (
                <div key="opname">
                  <button
                    style={{display:"flex",alignItems:"center",gap:10,width:"100%",padding:"9px 12px",minHeight:isMobile?44:undefined,borderRadius:8,border:"none",cursor:"pointer",background:isActive?"rgba(255,255,255,0.15)":"transparent",color:isActive?"white":"rgba(255,255,255,0.65)",fontSize:13,fontWeight:isActive?700:400,marginBottom:2,textAlign:"left"}}
                    onClick={()=>setOpnameExpanded(e=>!e)}
                  >
                    <span>{n.icon}</span>
                    <span style={{flex:1}}>{n.label}</span>
                    {n.badge>0 && <span style={{background:"#dc2626",color:"white",borderRadius:20,padding:"1px 7px",fontSize:10,fontWeight:800,marginRight:4}}>{n.badge}</span>}
                    <span style={{fontSize:10,opacity:0.7,transition:"transform 0.2s",transform:opnameExpanded?"rotate(90deg)":"rotate(0deg)"}}>▶</span>
                  </button>
                  {opnameExpanded && (
                    <div style={{marginBottom:4}}>
                      {[
                        {id:"opname",icon:"📋",label:"Stock Opname"},
                        {id:"stockCount",icon:"📊",label:"Stock Count",badge:stockCountPendingCount},
                      ].map(sub=>{
                        const subActive = isActive && opnameSubTab===sub.id;
                        return (
                          <button
                            key={sub.id}
                            style={{display:"flex",alignItems:"center",gap:8,width:"100%",padding:"7px 12px 7px 32px",minHeight:isMobile?44:undefined,borderRadius:8,border:"none",cursor:"pointer",background:subActive?"rgba(255,255,255,0.12)":"transparent",color:subActive?"white":"rgba(255,255,255,0.55)",fontSize:12,fontWeight:subActive?700:400,marginBottom:1,textAlign:"left",borderLeft:subActive?"2px solid rgba(255,255,255,0.4)":"2px solid transparent"}}
                            onClick={()=>{setTab("opname"); setOpnameSubTab(sub.id); setMobileMenuOpen(false);}}
                          >
                            <span>{sub.icon}</span> {sub.label} {sub.badge>0 && <span style={{background:"#dc2626",color:"white",borderRadius:20,padding:"1px 6px",fontSize:9,fontWeight:800,marginLeft:4}}>{sub.badge}</span>}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            }
            // Regular nav item
            return (
              <button key={n.id} style={{display:"flex",alignItems:"center",gap:10,width:"100%",padding:"9px 12px",minHeight:isMobile?44:undefined,borderRadius:8,border:"none",cursor:"pointer",background:tab===n.id?"rgba(255,255,255,0.15)":"transparent",color:tab===n.id?"white":"rgba(255,255,255,0.65)",fontSize:13,fontWeight:tab===n.id?700:400,marginBottom:2,textAlign:"left"}} onClick={()=>{setTab(n.id); if(n.id!=="transaction") setTugExpanded(false); if(n.id!=="master") setMasterExpanded(false); if(n.id!=="opname") setOpnameExpanded(false); setMobileMenuOpen(false);}}>
                <span>{n.icon}</span> {n.label}
                {n.badge>0 && <span style={{marginLeft:"auto",background:"#dc2626",color:"white",borderRadius:20,padding:"1px 7px",fontSize:10,fontWeight:800}}>{n.badge}</span>}
              </button>
            );
          })}
        </div>
        <div style={{padding:"8px 16px",borderTop:"1px solid rgba(255,255,255,0.1)",fontSize:10,color:"rgba(255,255,255,0.45)"}}>
          {cloudSaving ? "☁️ Menyimpan..." : lastSaved ? `☁️ Tersimpan` : "☁️ Cloud Storage Aktif"}
        </div>

        {/* Export / Import JSON — backup & restore data */}
        {currentUser.role==="ADMIN" && (
          <div style={{padding:"8px 12px",borderTop:"1px solid rgba(255,255,255,0.1)",display:"flex",gap:6}}>
            <button title="Export semua data ke file JSON" style={{flex:1,padding:"5px 0",background:"rgba(255,255,255,0.08)",border:"1px solid rgba(255,255,255,0.15)",borderRadius:6,color:"rgba(255,255,255,0.7)",fontSize:10,cursor:"pointer",fontWeight:600}}
              onClick={()=>{
                const data = {
                  stocks, katalogList, lokasiList, txns, docSeq,
                  satpamList, timMutuList, uitList, uptList, gudangList,
                  rencanaKedatanganList, opnameList, heavyEquipmentList, heavyEquipmentLoans,
                  exportedAt: new Date().toISOString(),
                  version: "v31"
                };
                const blob = new Blob([JSON.stringify(data,null,2)],{type:"application/json"});
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href=url; a.download=`WARNOTO_backup_${new Date().toLocaleDateString("id-ID").replace(/\//g,"-")}.json`;
                document.body.appendChild(a); a.click(); document.body.removeChild(a);
                setTimeout(()=>URL.revokeObjectURL(url),2000);
                showToast("✅ Data berhasil di-export!");
              }}>
              💾 Export
            </button>
            <label title="Import data dari file JSON backup" style={{flex:1,padding:"5px 0",background:"rgba(255,255,255,0.08)",border:"1px solid rgba(255,255,255,0.15)",borderRadius:6,color:"rgba(255,255,255,0.7)",fontSize:10,cursor:"pointer",fontWeight:600,textAlign:"center",display:"flex",alignItems:"center",justifyContent:"center"}}>
              📂 Import
              <input type="file" accept=".json" style={{display:"none"}} onChange={async e=>{
                const f = e.target.files[0]; if(!f) return;
                try {
                  const text = await f.text();
                  const data = JSON.parse(text);
                  if (!data.stocks || !data.katalogList) { showToast("File JSON tidak valid!","error"); return; }
                  if (!window.confirm(`Import data dari backup ${data.exportedAt||"unknown"}?\nSemua data saat ini akan diganti.`)) return;
                  if(data.stocks) setStocks(data.stocks);
                  if(data.katalogList) setKatalogList(data.katalogList);
                  if(data.lokasiList) setLokasiList(data.lokasiList);
                  if(data.txns) setTxns(data.txns);
                  if(data.docSeq) setDocSeq(data.docSeq);
                  if(data.satpamList) setSatpamList(data.satpamList);
                  if(data.timMutuList) setTimMutuList(data.timMutuList);
                  if(data.uitList) setUitList(data.uitList);
                  if(data.uptList) setUptList(data.uptList);
                  if(data.gudangList) setGudangList(data.gudangList);
                  if(data.rencanaKedatanganList) setRencanaKedatanganList(data.rencanaKedatanganList);
                  if(data.opnameList) setOpnameList(data.opnameList);
                  if(data.heavyEquipmentList) setHeavyEquipmentList(data.heavyEquipmentList);
                  if(data.heavyEquipmentLoans) setHeavyEquipmentLoans(data.heavyEquipmentLoans);
                  await saveToCloud({
                    stocks:data.stocks||stocks, katalogList:data.katalogList||katalogList,
                    lokasiList:data.lokasiList||lokasiList, txns:data.txns||txns,
                    docSeq:data.docSeq||docSeq, satpamList:data.satpamList||satpamList,
                    timMutuList:data.timMutuList||timMutuList, uitList:data.uitList||uitList,
                    uptList:data.uptList||uptList, gudangList:data.gudangList||gudangList,
                    rencanaKedatanganList:data.rencanaKedatanganList||rencanaKedatanganList,
                    opnameList:data.opnameList||opnameList,
                    heavyEquipmentList:data.heavyEquipmentList||heavyEquipmentList,
                    heavyEquipmentLoans:data.heavyEquipmentLoans||heavyEquipmentLoans,
                  });
                  showToast("✅ Data berhasil di-import!");
                  e.target.value="";
                } catch(err) {
                  showToast("Gagal import: "+err.message,"error");
                }
              }}/>
            </label>
          </div>
        )}
        <div style={{padding:"12px 16px",borderTop:"1px solid rgba(255,255,255,0.1)",display:"flex",alignItems:"center",gap:10}}>
          <div style={{width:36,height:36,background:"rgba(255,255,255,0.2)",borderRadius:"50%",display:"flex",alignItems:"center",justifyContent:"center",fontWeight:700,color:"white",fontSize:13,flexShrink:0}}>{currentUser.avatar}</div>
          <div style={{flex:1,minWidth:0}}>
            <div style={{color:"white",fontWeight:600,fontSize:12,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{currentUser.name}</div>
            <div style={{color:"rgba(255,255,255,0.5)",fontSize:10}}>{ROLES[currentUser.role]}</div>
          </div>
          <button style={{background:"transparent",border:"none",color:"rgba(255,255,255,0.4)",cursor:"pointer",fontSize:16}} onClick={handleLogout} title="Logout">⬅</button>
        </div>
      </div>

      {/* MAIN */}
      <div style={{flex:1,overflowY:"auto",padding:isMobile?16:24, width:isMobile?"100%":"auto", minWidth:0}}>
        {isMobile && (
          <button
            onClick={()=>setMobileMenuOpen(true)}
            style={{display:"flex",alignItems:"center",gap:8,background:C.sidebar,color:"white",border:"none",borderRadius:8,padding:"10px 14px",fontSize:14,fontWeight:700,cursor:"pointer",marginBottom:16,minHeight:44}}
          >☰ Menu</button>
        )}

        {/* DASHBOARD */}
        {tab==="dashboard" && currentUser.role==="MANAGER" && (
          <DashboardManager
            stocks={enrichedStocks} txns={txns} katalogList={katalogList}
            uptList={uptList} rencanaKedatanganList={rencanaKedatanganList}
            myPendingApprovals={myPendingApprovals}
            topN={topN} setTopN={setTopN}
            pemakaianMode={pemakaianMode} setPemakaianMode={setPemakaianMode}
            C={C} sty={sty} setTab={setTab}
            heavyEquipmentList={heavyEquipmentList} heavyEquipmentLoans={heavyEquipmentLoans}
          />
        )}
        {tab==="dashboard" && currentUser.role==="ASMAN" && (
          <DashboardAsman
            stocks={enrichedStocks} txns={txns} katalogList={katalogList}
            rencanaKedatanganList={rencanaKedatanganList}
            myPendingApprovals={myPendingApprovals}
            topN={topN} setTopN={setTopN}
            pemakaianMode={pemakaianMode} setPemakaianMode={setPemakaianMode}
            C={C} sty={sty} setTab={setTab}
            heavyEquipmentList={heavyEquipmentList} heavyEquipmentLoans={heavyEquipmentLoans}
            currentUser={currentUser}
          />
        )}
        {tab==="dashboard" && !["MANAGER","ASMAN"].includes(currentUser.role) && (
          <>
          {/* ── PETA WILAYAH GUDANG UPT SURABAYA ── */}
          <div style={{...sty.card}}>
            <div style={{fontWeight:800,fontSize:15,marginBottom:4}}>🗺️ Peta Wilayah Gudang UPT Surabaya</div>
            <div style={{fontSize:12,color:C.muted,marginBottom:12}}>
              {gudangList.filter(g=>g.lat!=null&&g.lng!=null).length} dari {gudangList.length} gudang sudah punya koordinat GPS. Klik pin untuk lihat ringkasan.
            </div>
            <div ref={petaWilayahDivRef} style={{width:"100%",height:320,borderRadius:10,border:`1px solid ${C.border}`,background:"#eef2f7"}}/>
            {gudangList.filter(g=>g.lat==null||g.lng==null).length>0 && currentUser.role==="ADMIN" && (
              <div style={{fontSize:11,color:"#92400e",marginTop:8}}>⚠️ Ada gudang belum punya koordinat GPS — isi di Master Data → Master Gudang → Edit.</div>
            )}
          </div>

          {/* ── STOCK COUNT (SAP vs Aplikasi) — ringkasan sesi terakhir ── */}
          {(()=>{
            const latest = stockCountList[0];
            return (
              <div style={{...sty.card,marginTop:16}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
                  <div style={{fontWeight:800,fontSize:15}}>📊 Stock Count (SAP vs Aplikasi)</div>
                  <button style={sty.btn("ghost","sm")} onClick={()=>{setTab("opname"); setOpnameSubTab("stockCount");}}>Lihat detail →</button>
                </div>
                {!latest ? (
                  <div style={{fontSize:12,color:C.muted}}>Belum pernah ada sesi Stock Count. Jalankan di menu "Stock Count" → upload CSV SAP.</div>
                ) : (
                  <>
                    <div style={{display:"flex",alignItems:"baseline",gap:10,marginBottom:6}}>
                      <span style={{fontSize:30,fontWeight:900,color:latest.summary.akuratPct>=90?C.green:latest.summary.akuratPct>=70?C.yellow:C.red}}>{latest.summary.akuratPct}%</span>
                      <span style={{fontSize:12,color:C.muted}}>{latest.summary.akuratCount} dari {latest.summary.totalItem} item akurat (toleransi ≤5%) — sesi {fmtDate(latest.uploadedAt)}</span>
                    </div>
                    {latest.items.some(i=>i.approval==="PENDING") && (
                      <div style={{fontSize:12,fontWeight:700,color:"#92400e",background:"#fef3c7",borderRadius:8,padding:"6px 10px"}}>
                        ⏳ {latest.items.filter(i=>i.approval==="PENDING").length} temuan menunggu approval Asman
                      </div>
                    )}
                  </>
                )}
              </div>
            );
          })()}

          {/* ── MATURITY LEVEL GUDANG UPT SURABAYA ── */}
          {(()=>{
            const latest = maturityAssessments[0];
            return (
              <div style={{...sty.card,marginTop:16}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                  <div style={{fontWeight:800,fontSize:15}}>🏆 Maturity Level Gudang UPT Surabaya</div>
                  {currentUser.role==="ADMIN" && <button style={sty.btn("primary","sm")} onClick={()=>{setMaturityForm({level:latest?.level||3,catatan:"",tanggalAsesmen:Date.now()}); setMaturityModal(true);}}>+ Asesmen Baru</button>}
                </div>
                {!latest ? (
                  <div style={{fontSize:12,color:C.muted}}>Belum ada data asesmen maturity level.</div>
                ) : (
                  <>
                    <div style={{display:"flex",alignItems:"baseline",gap:10,marginBottom:4}}>
                      <span style={{fontSize:30,fontWeight:900,color:C.accent}}>Level {latest.level}</span>
                      <span style={{fontSize:14,fontWeight:700,color:C.muted}}>{MATURITY_LEVELS[latest.level]}</span>
                    </div>
                    <div style={{fontSize:11,color:C.muted,marginBottom:8}}>Asesmen: {fmtDate(latest.tanggalAsesmen)} {latest.catatan && `— "${latest.catatan}"`}</div>
                    {maturityAssessments.length>1 && (
                      <details>
                        <summary style={{fontSize:12,color:"#0098da",cursor:"pointer"}}>Lihat Riwayat ({maturityAssessments.length-1} sebelumnya)</summary>
                        <div style={{marginTop:8}}>
                          {maturityAssessments.slice(1).map(m=>(
                            <div key={m.id} style={{display:"flex",justifyContent:"space-between",padding:"6px 0",borderBottom:`1px solid ${C.border}`,fontSize:12}}>
                              <span>Level {m.level} ({MATURITY_LEVELS[m.level]}) {m.catatan && `— "${m.catatan}"`}</span>
                              <span style={{color:C.muted}}>{fmtDate(m.tanggalAsesmen)}</span>
                            </div>
                          ))}
                        </div>
                      </details>
                    )}
                  </>
                )}
              </div>
            );
          })()}

          <div style={{marginTop:20}}/>
          <DashboardDefault
            stocks={enrichedStocks} txns={txns} katalogList={katalogList} lokasiList={lokasiList}
            rencanaKedatanganList={rencanaKedatanganList}
            myPendingApprovals={myPendingApprovals}
            lowStocks={lowStocks} totalVal={totalVal}
            topN={topN} setTopN={setTopN}
            pemakaianMode={pemakaianMode} setPemakaianMode={setPemakaianMode}
            C={C} sty={sty} setTab={setTab} currentUser={currentUser}
            heavyEquipmentList={heavyEquipmentList} heavyEquipmentLoans={heavyEquipmentLoans}
            materialCadangData={materialCadangData}
          />
        </>
        )}

                {/* STOCK OPNAME & STOCK COUNT (digabung 1 menu, dipilih lewat sub-tab sidebar) */}
        {tab==="opname" && (
          <div>
            <div style={{display:"flex",gap:8,marginBottom:16}}>
              {[{id:"opname",label:"📋 Stock Opname"},{id:"stockCount",label:"📊 Stock Count"}].map(s=>(
                <button key={s.id} style={{padding:"8px 16px",borderRadius:8,border:`1px solid ${opnameSubTab===s.id?C.accent:C.border}`,background:opnameSubTab===s.id?C.accent:"white",color:opnameSubTab===s.id?"white":C.muted,fontWeight:700,fontSize:13,cursor:"pointer"}} onClick={()=>setOpnameSubTab(s.id)}>{s.label}</button>
              ))}
            </div>
            {opnameSubTab==="opname" ? (
              <StockOpnameTab
                opnameList={opnameList}
                stocks={stocks}
                katalogList={katalogList}
                currentUser={currentUser}
                users={users}
                sty={sty} C={C}
                saveOpname={saveOpname}
                submitOpname={submitOpname}
                approveOpname_Asman={approveOpname_Asman}
                approveOpname_Manager={approveOpname_Manager}
                rejectOpname={rejectOpname}
                deleteOpname={deleteOpname}
              />
            ) : (
              <StockCountTab
                stockCountList={stockCountList}
                currentUser={currentUser}
                sty={sty} C={C}
                previewStockCount={previewStockCount}
                saveStockCountSession={saveStockCountSession}
                approveStockCountItem={approveStockCountItem}
                rejectStockCountItem={rejectStockCountItem}
                deleteStockCountSession={deleteStockCountSession}
              />
            )}
          </div>
        )}

        {/* KAPASITAS GUDANG (termasuk Peta Gudang sebagai sub-tab) */}
        {tab==="kapasitasGudang" && (
          <KapasitasGudangTab
            gudangCapacityList={gudangCapacityList}
            gudangList={gudangList}
            subGudangList={subGudangList}
            lokasiList={lokasiList}
            stocks={enrichedStocks}
            currentUser={currentUser}
            sty={sty} C={C}
            setTab={setTab}
            setStockSubTab={setStockSubTab}
          />
        )}

        {tab==="rencana" && (
          <RencanaKedatanganTab
            rencanaList={rencanaKedatanganList}
            katalogList={katalogList}
            currentUser={currentUser}
            sty={sty} C={C}
            saveRencana={saveRencana}
            deleteRencana={deleteRencana}
            aiExtractKontrak={aiExtractKontrak}
          />
        )}

        {/* STOCK */}
        {/* DATA STOK — view of operational stock (read-focused, with admin edit) */}
        {tab==="stock" && (
          <div>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
              <div>
                <h1 style={{fontSize:22,fontWeight:900}}>Data Stok Gudang</h1>
                <p style={{color:C.muted,fontSize:13}}>{filteredStocks.length} baris stok (barang x lokasi)
                  {stocks.filter(s=>!s.lokasiId).length>0 && <span style={{color:"#f59e0b",fontWeight:700,marginLeft:8}}>• ⚠️ {stocks.filter(s=>!s.lokasiId).length} material belum ada lokasi</span>}
                </p>
              </div>
              {currentUser.role==="ADMIN" && <button style={sty.btn("primary")} onClick={openAddStock}>+ Tambah Data Stok</button>}
              {currentUser.role==="ADMIN" && <button style={{...sty.btn("ghost"),border:`1px solid #0098da`,color:"#0098da"}} onClick={()=>setImportSAPModal(true)}>⬆️ Import dari SAP (PEMAT)</button>}
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:10,marginBottom:16}}>
              <div style={{position:"relative",width:"100%"}}>
                <input style={{...sty.input,paddingRight:32}} placeholder="🔍 Cari nama, kode, no. katalog, lokasi..." value={search} onChange={e=>setSearch(e.target.value)}/>
                {search && (
                  <button
                    onClick={()=>setSearch("")}
                    title="Hapus pencarian"
                    style={{position:"absolute",right:6,top:"50%",transform:"translateY(-50%)",background:"transparent",border:"none",cursor:"pointer",fontSize:14,color:C.muted,padding:4,lineHeight:1}}
                  >✕</button>
                )}
              </div>
              <select style={{...sty.select,maxWidth:280}} value={filterJenis} onChange={e=>setFilterJenis(e.target.value)}>
                <option value="ALL">Semua Jenis</option>{JENIS_BARANG.map(j=><option key={j}>{j}</option>)}
              </select>
            </div>
            {katalogList.length===0 && (
              <div style={{...sty.card,textAlign:"center",color:C.muted,padding:20,marginBottom:16}}>
                ℹ️ Belum ada Master Katalog. Tambahkan jenis barang dulu di menu "Master Data" → "Master Katalog" sebelum membuat Data Stok.
              </div>
            )}
            {/* Tampilan tabel horizontal (data & fungsi tidak berubah, cuma cara
                merendernya — semua handler/state sama persis dengan versi kartu
                sebelumnya). */}
            <div style={{...sty.card,padding:0,overflowX:"auto"}}>
              <table style={{width:"100%",borderCollapse:"collapse",fontSize:12,minWidth:980}}>
                <thead>
                  <tr style={{background:"#003087",color:"white"}}>
                    {["Foto","Nama Barang","Kategori","Qty","Gudang","Blok","Harga","Status","Aksi"].map(h=>(
                      <th key={h} style={{padding:"9px 10px",textAlign:h==="Aksi"||h==="Foto"?"center":"left",whiteSpace:"nowrap",fontSize:11}}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {pagedStocks.map(st=>{
                    const isLow = st.jenisBarang!=="Non-Stock" && st.qty<=st.minQty;
                    const noLokasi = !st.lokasiId;
                    const lok = lokasiList.find(l=>l.id===st.lokasiId);
                    const gdg = lok?.gudangId ? gudangList.find(g=>g.id===lok.gudangId) : null;
                    const canLihatPeta = lok && gdg && gdg.denahImageData && lok.mapX!=null;
                    return (
                      <tr key={st.id} onClick={()=>{setPendingFoto({}); setStockDetailId(st.id);}} style={{cursor:"pointer",background:st.deletePending?"#fef2f2":undefined,borderBottom:`1px solid ${C.border}`,borderLeft:`3px ${st.deletePending?"dashed #dc2626":"solid"} ${st.deletePending?"#dc2626":noLokasi?"#f59e0b":isLow?C.red:st.jenisBarang==="Non-Stock"?"#be185d":C.green}`}}>
                        <td onClick={e=>{ if(st.img){e.stopPropagation(); setLightboxImg(st.img);} }} style={{padding:"8px 10px",textAlign:"center",cursor:st.img?"zoom-in":"default"}}>
                          {st.img ? <img src={st.img} alt={st.name} style={{width:40,height:40,borderRadius:6,objectFit:"cover",border:`1px solid ${C.border}`}}/>
                            : <div style={{width:40,height:40,background:"#eff6ff",borderRadius:6,display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,border:`1px solid #bfdbfe`,margin:"0 auto"}}>📦</div>}
                        </td>
                        <td style={{padding:"8px 10px",minWidth:200}}>
                          <div style={{fontWeight:700,color:C.text}}>{st.name}</div>
                          <div style={{fontSize:10,color:"#0098da",fontWeight:700,marginTop:1}}>📑 {st.katalog||"-"}</div>
                          {st.deletePending && <div style={{fontSize:9,color:"#dc2626",fontWeight:700,marginTop:2}}>⏳ Menunggu approval Hapus</div>}
                          {st.editPending && <div style={{fontSize:9,color:"#92400e",fontWeight:700,marginTop:2}}>⏳ Ada perubahan menunggu approval TL</div>}
                        </td>
                        <td style={{padding:"8px 10px"}}>
                          <div style={{display:"flex",gap:4,flexWrap:"wrap",maxWidth:160}}>
                            <span style={sty.jenisBadge(st.jenisBarang)}>{st.jenisBarang}</span>
                            <span style={{padding:"2px 7px",borderRadius:20,fontSize:10,background:"#f3f4f6",color:C.muted}}>{st.category}</span>
                          </div>
                        </td>
                        <td style={{padding:"8px 10px",whiteSpace:"nowrap"}}>
                          {st.jenisBarang==="Non-Stock"
                            ? <span style={{color:C.muted}}>Project-Based</span>
                            : <div>
                                <span style={{fontWeight:700,color:isLow?C.red:C.green}}>{fmtNum(st.qty)} {st.unit}</span>
                                <div style={{fontSize:9,color:C.muted}}>Min {fmtNum(st.minQty)} {st.unit}</div>
                              </div>}
                          {isLow && <div style={{fontSize:9,color:C.red,fontWeight:700,marginTop:2}}>⚠️ Stok kritis</div>}
                        </td>
                        <td onClick={e=>e.stopPropagation()} style={{padding:"8px 10px",minWidth:120}}>
                          {currentUser.role==="ADMIN" ? (
                            <select
                              value={stockGudangFilter[st.id] ?? gdg?.id ?? gudangList[0]?.id ?? ""}
                              style={{...sty.select,fontSize:11,paddingTop:5,paddingBottom:5,paddingLeft:8,paddingRight:8}}
                              onChange={e=>setStockGudangFilter(prev=>({...prev,[st.id]:e.target.value}))}>
                              {gudangList.map(g=><option key={g.id} value={g.id}>{g.kode||g.nama}</option>)}
                            </select>
                          ) : (
                            <span style={{color:C.text}}>{gdg?.kode||gdg?.nama||"—"}</span>
                          )}
                        </td>
                        <td onClick={e=>e.stopPropagation()} style={{padding:"8px 10px",minWidth:150}}>
                          {currentUser.role==="ADMIN" ? (
                            <>
                              <select
                                value={st.lokasiId||""}
                                disabled={st.lokasiMovePending}
                                style={{...sty.select,fontSize:11,paddingTop:5,paddingBottom:5,paddingLeft:8,paddingRight:8,border:`1px solid ${noLokasi?"#f59e0b":C.border}`,background:st.lokasiMovePending?"#f3f4f6":noLokasi?"#fffbeb":"#f9fafb"}}
                                onChange={async e=>{
                                  const newLokasiId = e.target.value;
                                  const lokSel = lokasiList.find(l=>l.id===newLokasiId);
                                  const pindahGudang = (lokSel?.gudangId||null) !== (lok?.gudangId||null);
                                  let updated, msg;
                                  if (pindahGudang) {
                                    // Pindah ke Gudang lain wajib approval TL.
                                    updated = {...st, lokasiMovePending:true, pendingLokasiId:newLokasiId, pendingLokasiKode:lokSel?.kode||"-", moveRequestedBy:currentUser.id, moveRequestedAt:Date.now()};
                                    msg = `📨 Pemindahan ${st.name} ke Gudang lain (${lokSel?.kode||"-"}) diajukan! Menunggu approval TL.`;
                                  } else {
                                    // Pindah blok dalam Gudang yang sama: Admin langsung, tanpa approval.
                                    updated = {...st, lokasiId:newLokasiId, lokasi:lokSel?.kode||"-", lokasiMovePending:false, pendingLokasiId:null, pendingLokasiKode:null};
                                    msg = `📍 Blok ${st.name} → ${lokSel?.kode||"-"}`;
                                  }
                                  const ns = stocks.map(s=>s.id===st.id?updated:s);
                                  setStocks(ns);
                                  await saveToCloud({stocks:ns});
                                  showToast(msg);
                                }}>
                                <option value="">-- Pilih Blok --</option>
                                {lokasiList.filter(l=>(l.gudangId ?? gudangList[0]?.id) === (stockGudangFilter[st.id] ?? gdg?.id ?? gudangList[0]?.id)).map(l=><option key={l.id} value={l.id}>{l.kode}{l.nama?" — "+l.nama:""}</option>)}
                              </select>
                              {st.lokasiMovePending && <div style={{fontSize:9,color:"#92400e",fontWeight:700,marginTop:2}}>⏳ Menunggu approval TL → {st.pendingLokasiKode}</div>}
                            </>
                          ) : currentUser.role==="TL" ? (
                            <select
                              value={st.lokasiId||""}
                              style={{...sty.select,fontSize:11,paddingTop:5,paddingBottom:5,paddingLeft:8,paddingRight:8,border:`1px solid ${noLokasi?"#f59e0b":C.border}`,background:noLokasi?"#fffbeb":"#f9fafb"}}
                              onChange={async e=>{
                                const newLokasiId = e.target.value;
                                const lokSel = lokasiList.find(l=>l.id===newLokasiId);
                                const updated = {...st, lokasiId:newLokasiId, lokasi:lokSel?.kode||"-", lokasiMovePending:false, pendingLokasiId:null, pendingLokasiKode:null};
                                const ns = stocks.map(s=>s.id===st.id?updated:s);
                                setStocks(ns);
                                await saveToCloud({stocks:ns});
                                showToast(`📍 Blok ${st.name} → ${lokSel?.kode||"-"}`);
                              }}>
                              <option value="">-- Pilih Blok --</option>
                              {lokasiList.filter(l=>(l.gudangId ?? gudangList[0]?.id) === (stockGudangFilter[st.id] ?? gdg?.id ?? gudangList[0]?.id)).map(l=><option key={l.id} value={l.id}>{l.kode}{l.nama?" — "+l.nama:""}</option>)}
                            </select>
                          ) : (
                            <span style={{color:noLokasi?"#f59e0b":C.text,fontWeight:noLokasi?700:400}}>{noLokasi?"⚠️ Belum diisi":st.lokasi||"—"}</span>
                          )}
                        </td>
                        <td style={{padding:"8px 10px",whiteSpace:"nowrap"}}>Rp {fmtNum(st.price)}</td>
                        <td style={{padding:"8px 10px"}}>
                          {(()=>{const bs=getSAPBadgeStyle(st.katalog);return <span style={{padding:"2px 7px",borderRadius:20,fontSize:10,fontWeight:700,background:bs.bg,color:bs.fg,whiteSpace:"nowrap"}}>{getSAPLabel(st.katalog)}</span>})()}
                        </td>
                        <td onClick={e=>e.stopPropagation()} style={{padding:"8px 10px"}}>
                          <div style={{display:"flex",gap:4,justifyContent:"center"}}>
                            {currentUser.role==="ADMIN" && (
                              <>
                                <button title="Edit" disabled={st.deletePending} style={{...sty.btn("ghost","sm"),padding:"6px 8px",opacity:st.deletePending?0.4:1}} onClick={()=>openEditStock(st)}>✏️</button>
                                <button title="Hapus" disabled={st.deletePending} style={{...sty.btn("danger","sm"),padding:"6px 8px",opacity:st.deletePending?0.4:1}} onClick={()=>deleteStock(st.id)}>🗑️</button>
                              </>
                            )}
                            <button title="Kartu Gantung TUG-2" style={{...sty.btn("ghost","sm"),padding:"6px 8px",borderColor:"#e0f2fe",color:"#0369a1"}}
                              onClick={()=>{const k=katalogList.find(x=>x.id===st.katalogId); if(k) setKartuGantungDetail(k);}}>🏷️</button>
                            <button
                              title={canLihatPeta ? "Lihat di Peta Gudang" : !lok ? "Blok belum diisi" : !gdg?.denahImageData ? "Denah Gudang belum diupload (Master Data → Master Gudang)" : "Blok ini belum diplot koordinatnya di denah"}
                              style={{...sty.btn("ghost","sm"),padding:"6px 8px",borderColor:canLihatPeta?"#fca5a5":C.border,color:canLihatPeta?"#dc2626":C.muted,opacity:canLihatPeta?1:0.5}}
                              onClick={()=>{
                                if (canLihatPeta) { setPetaMiniDetail({stock:st, lokasi:lok, gudang:gdg}); return; }
                                if (!lok) { showToast("Blok/Lokasi belum diisi untuk material ini.","error"); return; }
                                if (!gdg?.denahImageData) { showToast(`Denah Gudang "${gdg?.nama||lok?.kode||"-"}" belum diupload. Upload di Master Data → Master Gudang.`,"error"); return; }
                                showToast(`Blok ${lok?.kode||"-"} belum diplot koordinatnya di denah. Atur di Master Data → Master Gudang.`,"error");
                              }}>📍</button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {filteredStocks.length===0 && (
                    <tr><td colSpan={9} style={{padding:30,textAlign:"center",color:C.muted}}>Tidak ada data stok untuk filter ini.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            {filteredStocks.length > 0 && (
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginTop:12,flexWrap:"wrap",gap:10}}>
                <div style={{display:"flex",alignItems:"center",gap:8,fontSize:12,color:C.muted}}>
                  Tampilkan
                  <select style={{...sty.select,width:"auto",padding:"4px 8px",minHeight:"unset",fontSize:12}} value={stockPageSize} onChange={e=>setStockPageSize(Number(e.target.value))}>
                    {[10,20,50].map(n=><option key={n} value={n}>{n}</option>)}
                  </select>
                  item per halaman — {filteredStocks.length} total
                </div>
                <div style={{display:"flex",alignItems:"center",gap:6}}>
                  <button style={{...sty.btn("ghost","sm")}} disabled={stockPageClamped<=1} onClick={()=>setStockPage(p=>Math.max(1,p-1))}>← Sebelumnya</button>
                  <span style={{fontSize:12,color:C.muted,padding:"0 6px"}}>Halaman {stockPageClamped} / {stockTotalPages}</span>
                  <button style={{...sty.btn("ghost","sm")}} disabled={stockPageClamped>=stockTotalPages} onClick={()=>setStockPage(p=>Math.min(stockTotalPages,p+1))}>Berikutnya →</button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* MASTER DATA — Master Katalog, Master Lokasi, Satpam (identity/reference data) */}
        {tab==="master" && (
          <div>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
              <div>
                <h1 style={{fontSize:22,fontWeight:900}}>
                  {stockSubTab==="katalog"?"Master Katalog Barang":stockSubTab==="satpam"?"Daftar Satpam":stockSubTab==="timmutu"?"Master Tim Mutu":stockSubTab==="organisasi"?"Struktur Organisasi (UIT / UPT / ULTG)":stockSubTab==="migrasi"?"🔄 Migrasi Data SAP/Non-SAP":"Master Gudang"}
                </h1>
                <p style={{color:C.muted,fontSize:13}}>
                  {stockSubTab==="katalog"?`${katalogList.length} jenis barang terdaftar`:stockSubTab==="satpam"?`${satpamList.length} satpam terdaftar`:stockSubTab==="timmutu"?`${timMutuList.length} paket tim mutu`:stockSubTab==="organisasi"?`${uitList.length} UIT • ${uptList.length} UPT • ${ultgList.length} ULTG`:stockSubTab==="migrasi"?"Cutover terkontrol data stok dari SAP — wajib backup sebelum apply":stockSubTab==="usulanKatalog"?"Cari di referensi MARA, usulkan penambahan katalog baru, persetujuan Asman/TL":`${gudangList.length} gudang • ${lokasiList.length} blok lokasi terdaftar`}
                </p>
              </div>
              {currentUser.role==="ADMIN" && stockSubTab==="katalog" && <button style={sty.btn("primary")} onClick={openAddKatalog}>+ Tambah Katalog Barang</button>}
              {currentUser.role==="ADMIN" && stockSubTab==="satpam" && <button style={sty.btn("primary")} onClick={openAddSatpam}>+ Tambah Satpam</button>}
              {currentUser.role==="ADMIN" && stockSubTab==="organisasi" && <button style={sty.btn("primary")} onClick={openAddUIT}>+ Tambah UIT</button>}
            </div>
            {stockSubTab==="gudang" && (
              <div style={{...sty.card,marginBottom:12,background:"#eff6ff",borderLeft:"4px solid #0369a1",padding:"10px 14px",fontSize:12,color:"#0369a1"}}>
                ℹ️ Master Gudang kini otomatis terbentuk dari data <b>Monitoring Kapasitas Gudang</b> setelah disetujui Asman. Tidak ada input manual di sini — lengkapi Kode Gudang / Denah lewat tombol Edit jika diperlukan.
              </div>
            )}
            {stockSubTab==="gudang" && ["ADMIN","TL"].includes(currentUser.role) && (
              <div style={{marginBottom:16}}>
                <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                  <button style={{...sty.btn(importGudangOpen?"danger":"primary","sm")}} onClick={()=>setImportGudangOpen(o=>!o)}>
                    {importGudangOpen?"✕ Tutup Import Data Gudang":"📥 Import Data Gudang"}
                  </button>
                  <button style={sty.btn("ghost","sm")} onClick={backfillGudangCoordFromCapacity} title="Isi ulang koordinat lat/lng Master Gudang dari data Kapasitas Gudang yang sudah live">
                    🔄 Sinkron Koordinat dari Kapasitas Gudang
                  </button>
                  <button style={sty.btn("ghost","sm")} onClick={dedupeGudangDanSubGudang} title="Gabungkan Gudang/Sub Gudang yang namanya sama tapi ID berbeda — perbaiki denah/koordinat yang 'hilang'">
                    🧹 Gabungkan Gudang Duplikat
                  </button>
                </div>
                {importGudangOpen && (
                  <div style={{marginTop:12}}>
                    <KapasitasGudangImportTab
                      gudangCapacityImports={gudangCapacityImports}
                      setGudangCapacityImports={setGudangCapacityImports}
                      currentUser={currentUser}
                      sty={sty} C={C}
                      saveToCloud={saveToCloud}
                      showToast={showToast}
                    />
                  </div>
                )}
              </div>
            )}
            {/* ── SUB-TAB: MASTER KATALOG ── */}
            {stockSubTab==="katalog" && currentUser.role==="ADMIN" && (
              <div style={{...sty.card,marginBottom:12,borderLeft:"4px solid #0369a1",padding:14}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:12,flexWrap:"wrap"}}>
                  <div>
                    <div style={{fontSize:13,fontWeight:800,color:"#0369a1"}}>📚 Referensi Katalog MARA</div>
                    <div style={{fontSize:11,color:C.muted,marginTop:2}}>Upload file MARA agar tersedia sebagai referensi saat menambah katalog baru.</div>
                  </div>
                  <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
                    {maraUploadProgress && (
                      <span style={{fontSize:11,color:"#0369a1",fontWeight:700,padding:"4px 10px",background:"#e0f2fe",borderRadius:6}}>{maraUploadProgress}</span>
                    )}
                    <label style={{...sty.btn(maraUploadLoading?"ghost":"ghost","sm"),cursor:"pointer",borderColor:"#0369a1",color:"#0369a1"}}>
                      {maraUploadLoading ? "⏳ Mengupload..." : "📂 Upload MARA (.xlsx)"}
                      <input type="file" accept=".xlsx" style={{display:"none"}} disabled={maraUploadLoading}
                        onChange={e=>{ if(e.target.files?.[0]) uploadMaraToDB(e.target.files[0]); e.target.value=""; }}/>
                    </label>
                  </div>
                </div>
              </div>
            )}

            {stockSubTab==="katalog" && (
              katalogList.length===0
              ? <div style={{...sty.card,textAlign:"center",color:C.muted,padding:30}}>Belum ada Master Katalog. {currentUser.role==="ADMIN" && "Klik \"+ Tambah Katalog Barang\" untuk menambahkan."}</div>
              : (
              <div style={{...sty.card,padding:0,overflowX:"auto"}}>
                <table style={{width:"100%",borderCollapse:"collapse",fontSize:12,minWidth:860}}>
                  <thead>
                    <tr style={{background:"#003087",color:"white"}}>
                      {["Foto","No Katalog","Nama Barang","Kategori","Jenis","Satuan","Status","Aksi"].map(h=>(
                        <th key={h} style={{padding:"9px 10px",textAlign:h==="Aksi"||h==="Foto"?"center":"left",whiteSpace:"nowrap",fontSize:11}}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {pagedKatalog.map(k=>{
                      const sampleFoto = stocks.find(s=>s.katalogId===k.id && s.img)?.img || null;
                      const bs = getSAPBadgeStyle(k.katalog);
                      return (
                        <tr key={k.id} style={{borderBottom:`1px solid ${C.border}`,borderLeft:`3px solid ${C.accent}`}}>
                          <td style={{padding:"8px 10px",textAlign:"center"}}>
                            {sampleFoto ? <img src={sampleFoto} alt={k.name} style={{width:40,height:40,borderRadius:6,objectFit:"cover",border:`1px solid ${C.border}`}}/>
                              : <div style={{width:40,height:40,background:"#eff6ff",borderRadius:6,display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,border:`1px solid #bfdbfe`,margin:"0 auto"}}>📦</div>}
                          </td>
                          <td style={{padding:"8px 10px",whiteSpace:"nowrap"}}>
                            <div style={{fontSize:10,color:"#0098da",fontWeight:700}}>📑 {k.katalog}</div>
                            <div style={{fontSize:9,color:C.muted}}>{k.id}</div>
                          </td>
                          <td style={{padding:"8px 10px",minWidth:200,fontWeight:700}}>{k.name}</td>
                          <td style={{padding:"8px 10px"}}><span style={{padding:"2px 7px",borderRadius:20,fontSize:10,background:"#f3f4f6",color:C.muted,whiteSpace:"nowrap"}}>{(k.name||"").split(";")[0]?.trim()||k.category||"Lainnya"}</span></td>
                          <td style={{padding:"8px 10px"}}><span style={sty.jenisBadge(k.jenisBarang)}>{k.jenisBarang||"-"}</span></td>
                          <td style={{padding:"8px 10px",whiteSpace:"nowrap"}}>{k.satuan}</td>
                          <td style={{padding:"8px 10px"}}><span style={{padding:"2px 7px",borderRadius:20,fontSize:10,fontWeight:700,background:bs.bg,color:bs.fg,whiteSpace:"nowrap"}}>{getSAPLabel(k.katalog)}</span></td>
                          <td style={{padding:"8px 10px"}}>
                            {currentUser.role==="ADMIN" && (
                              <div style={{display:"flex",gap:4,justifyContent:"center"}}>
                                <button title="Edit" style={{...sty.btn("ghost","sm"),padding:"6px 8px"}} onClick={()=>openEditKatalog(k)}>✏️</button>
                                <button title="Hapus" style={{...sty.btn("danger","sm"),padding:"6px 8px"}} onClick={()=>deleteKatalog(k.id)}>🗑️</button>
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              )
            )}
            {stockSubTab==="katalog" && katalogList.length>0 && (
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginTop:12,flexWrap:"wrap",gap:10}}>
                <div style={{display:"flex",alignItems:"center",gap:8,fontSize:12,color:C.muted}}>
                  Tampilkan
                  <select style={{...sty.select,width:"auto",padding:"4px 8px",minHeight:"unset",fontSize:12}} value={katalogPageSize} onChange={e=>setKatalogPageSize(Number(e.target.value))}>
                    {[10,20,50].map(n=><option key={n} value={n}>{n}</option>)}
                  </select>
                  item per halaman — {katalogList.length} total
                </div>
                <div style={{display:"flex",alignItems:"center",gap:6}}>
                  <button style={{...sty.btn("ghost","sm")}} disabled={katalogPageClamped<=1} onClick={()=>setKatalogPage(p=>Math.max(1,p-1))}>← Sebelumnya</button>
                  <span style={{fontSize:12,color:C.muted,padding:"0 6px"}}>Halaman {katalogPageClamped} / {katalogTotalPages}</span>
                  <button style={{...sty.btn("ghost","sm")}} disabled={katalogPageClamped>=katalogTotalPages} onClick={()=>setKatalogPage(p=>Math.min(katalogTotalPages,p+1))}>Berikutnya →</button>
                </div>
              </div>
            )}


            {/* ── SUB-TAB: SATPAM ── */}
            {stockSubTab==="satpam" && (
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(260px,1fr))",gap:14}}>
                {satpamList.length===0 && <div style={{...sty.card,gridColumn:"1/-1",textAlign:"center",color:C.muted,padding:30}}>Belum ada data Satpam. {currentUser.role==="ADMIN" && "Klik \"+ Tambah Satpam\" untuk menambahkan."}</div>}
                {satpamList.map(sp=>(
                  <div key={sp.id} style={{...sty.card,borderTop:`3px solid ${C.accent}`}}>
                    <div style={{display:"flex",gap:10,alignItems:"center",marginBottom:10}}>
                      <div style={{width:44,height:44,borderRadius:"50%",background:"#eff6ff",display:"flex",alignItems:"center",justifyContent:"center",fontSize:20,border:`1px solid #bfdbfe`}}>🛡️</div>
                      <div>
                        <div style={{fontWeight:700,fontSize:14}}>{sp.name}</div>
                        <div style={{fontSize:11,color:C.muted}}>{sp.id}{sp.telp ? ` • ${sp.telp}` : ""}</div>
                      </div>
                    </div>
                    {currentUser.role==="ADMIN" && (
                      <div style={{display:"flex",gap:6}}>
                        <button style={{...sty.btn("ghost","sm"),flex:1}} onClick={()=>openEditSatpam(sp)}>✏️ Edit</button>
                        <button style={{...sty.btn("danger","sm"),flex:1}} onClick={()=>deleteSatpam(sp.id)}>🗑️ Hapus</button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* ── SUB-TAB: TIM MUTU (2 paket tetap, hanya bisa diedit anggotanya) ── */}
            {stockSubTab==="timmutu" && (
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(320px,1fr))",gap:14}}>
                {timMutuList.map(tm=>(
                  <div key={tm.id} style={{...sty.card,borderTop:`3px solid ${C.accent}`}}>
                    <div style={{fontWeight:800,fontSize:14,marginBottom:8}}>👥 {tm.label}</div>
                    <div style={{fontSize:12,lineHeight:1.8}}>
                      <div><b>Ketua:</b> {tm.ketua||"-"}</div>
                      <div><b>Sekretaris:</b> {tm.sekretaris||"-"}</div>
                      <div><b>Anggota 1:</b> {tm.anggota1||"-"}</div>
                      <div><b>Anggota 2:</b> {tm.anggota2||"-"}</div>
                      <div><b>Anggota 3:</b> {tm.anggota3||"-"}</div>
                    </div>
                    {currentUser.role==="ADMIN" && (
                      <button style={{...sty.btn("ghost","sm"),marginTop:10,width:"100%"}} onClick={()=>openEditTimMutu(tm)}>✏️ Edit Anggota</button>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* ── SUB-TAB: STRUKTUR ORGANISASI (UIT → UPT → ULTG, satu kesatuan) ── */}
            {stockSubTab==="organisasi" && (
              <div style={{display:"flex",flexDirection:"column",gap:14}}>
                {uitList.length===0 && <div style={{...sty.card,textAlign:"center",color:C.muted,padding:30}}>Belum ada Master UIT.</div>}
                {uitList.map(uit=>{
                  const uptOfUit = uptList.filter(u=>u.uitId===uit.id);
                  return (
                    <div key={uit.id} style={{...sty.card,borderLeft:"4px solid #003087"}}>
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:8}}>
                        <div>
                          <div style={{fontWeight:800,fontSize:14}}>🏢 {uit.kode} — {uit.nama}</div>
                          <div style={{fontSize:11,color:C.muted}}>📍 {uit.alamat||"-"} • {uptOfUit.length} UPT</div>
                        </div>
                        {currentUser.role==="ADMIN" && (
                          <div style={{display:"flex",gap:6,flexShrink:0}}>
                            <button style={sty.btn("ghost","sm")} onClick={()=>openAddUPT(uit.id)}>+ UPT</button>
                            <button style={sty.btn("ghost","sm")} onClick={()=>openEditUIT(uit)}>✏️</button>
                            <button style={sty.btn("danger","sm")} onClick={()=>deleteUIT(uit.id)}>🗑️</button>
                          </div>
                        )}
                      </div>
                      {uptOfUit.length===0
                        ? <div style={{fontSize:12,color:C.muted,fontStyle:"italic",paddingLeft:14}}>Belum ada UPT di bawah UIT ini.</div>
                        : <div style={{display:"flex",flexDirection:"column",gap:8,paddingLeft:14,borderLeft:`2px solid ${C.border}`}}>
                            {uptOfUit.map(upt=>{
                              const ultgOfUpt = ultgList.filter(x=>x.parentUptId===upt.id);
                              return (
                                <div key={upt.id} style={{background:"#f9fafb",border:`1px solid ${C.border}`,borderRadius:8,padding:10}}>
                                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:6}}>
                                    <div>
                                      <div style={{fontWeight:700,fontSize:13}}>📍 {upt.kode} — {upt.nama}</div>
                                      <div style={{fontSize:11,color:C.muted}}>{upt.alamat||"-"} • {ultgOfUpt.length} ULTG</div>
                                    </div>
                                    {currentUser.role==="ADMIN" && (
                                      <div style={{display:"flex",gap:6,flexShrink:0}}>
                                        <button style={{...sty.btn("ghost","sm"),padding:"3px 8px"}} onClick={()=>openAddULTG(upt.id)}>+ ULTG</button>
                                        <button style={{...sty.btn("ghost","sm"),padding:"3px 8px"}} onClick={()=>openEditUPT(upt)}>✏️</button>
                                        <button style={{...sty.btn("danger","sm"),padding:"3px 8px"}} onClick={()=>deleteUPT(upt.id)}>🗑️</button>
                                      </div>
                                    )}
                                  </div>
                                  {ultgOfUpt.length>0 && (
                                    <div style={{display:"flex",flexDirection:"column",gap:4,paddingLeft:14,borderLeft:`2px solid ${C.border}`}}>
                                      {ultgOfUpt.map(ultg=>(
                                        <div key={ultg.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",background:"white",border:`1px solid ${C.border}`,borderRadius:6,padding:"5px 8px",fontSize:12}}>
                                          <span>🏘️ <b>{ultg.kode}</b> — {ultg.nama}</span>
                                          {currentUser.role==="ADMIN" && (
                                            <div style={{display:"flex",gap:4}}>
                                              <button style={{...sty.btn("ghost","sm"),padding:"2px 6px"}} onClick={()=>openEditULTG(ultg)}>✏️</button>
                                              <button style={{...sty.btn("danger","sm"),padding:"2px 6px"}} onClick={()=>deleteULTG(ultg.id)}>🗑️</button>
                                            </div>
                                          )}
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                      }
                    </div>
                  );
                })}
              </div>
            )}

            {/* ── SUB-TAB: MASTER GUDANG ── */}
            {stockSubTab==="gudang" && (
              <div>
                {/* Notifikasi approval blok lokasi sudah dipindahkan ke menu "✅ Approval" — lihat di sana. */}
                {gudangList.length===0 && <div style={{...sty.card,textAlign:"center",color:C.muted,padding:30}}>Belum ada Master Gudang.</div>}
                {gudangList.map(g=>{
                  const upt = uptList.find(u=>u.id===g.uptId);
                  const bloklokasi = lokasiList.filter(l=>l.gudangId===g.id);
                  const blokWithCoord = bloklokasi.filter(l=>l.mapX!=null);
                  const isExpanded = expandedGudangId===g.id;
                  return (
                    <div key={g.id} style={{...sty.card,marginBottom:10,borderTop:`3px solid #003087`}}>
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",cursor:"pointer"}} onClick={()=>setExpandedGudangId(isExpanded?null:g.id)}>
                        <div>
                          <div style={{fontWeight:800,fontSize:15}}>🏭 {g.nama}</div>
                          <div style={{fontSize:12,color:C.muted}}>{g.kode} • {upt?.nama||"-"} • {g.alamat||"-"}</div>
                          <div style={{fontSize:11,color:C.muted,marginTop:2}}>{bloklokasi.length} blok terkait, {blokWithCoord.length} sudah ter-peta</div>
                        </div>
                        <div style={{display:"flex",gap:6,alignItems:"center"}}>
                          {currentUser.role==="ADMIN" && (
                            <div style={{display:"flex",gap:6}} onClick={e=>e.stopPropagation()}>
                              <button style={sty.btn("ghost","sm")} onClick={()=>openEditGudang(g)}>✏️ Edit</button>
                              <button style={sty.btn("danger","sm")} onClick={()=>deleteGudang(g.id)}>🗑️</button>
                            </div>
                          )}
                          <span style={{fontSize:14,color:C.muted,transition:"transform 0.15s",transform:isExpanded?"rotate(90deg)":"rotate(0deg)",display:"inline-block"}}>▶</span>
                        </div>
                      </div>

                      {isExpanded && <div style={{marginTop:14}}>

                      {/* Denah Upload — gambar PNG/JPG */}
                      {currentUser.role==="ADMIN" && (
                        <div style={{marginBottom:12}}>
                          <label style={sty.label}>Upload Denah Gudang (PNG / JPG)</label>
                          <div style={{fontSize:10,color:C.muted,marginBottom:4}}>
                            💡 Convert PDF denah ke gambar terlebih dahulu (screenshot, foto, atau export dari PDF viewer)
                          </div>
                          <input type="file" accept="image/*" capture="environment"
                            onChange={e=>{const f=e.target.files[0];if(f)uploadDenahGudang(g.id,f);}}
                            style={{fontSize:11,color:C.muted}}/>
                          {denahLoading && (
                            <div style={{fontSize:11,color:"#1d4ed8",marginTop:4}}>
                              ⏳ Mengompres dan menyimpan gambar...
                            </div>
                          )}
                          {g.denahUploadedAt && !denahLoading && (
                            <div style={{fontSize:10,color:C.green,marginTop:4}}>
                              ✅ Denah tersimpan • {fmtDate(g.denahUploadedAt)}
                            </div>
                          )}
                        </div>
                      )}

                      {/* Preview Denah */}
                      {g.denahImageData && (
                        <div style={{marginBottom:12}}>
                          <div style={{fontSize:11,fontWeight:700,color:C.muted,marginBottom:6}}>Preview Denah:</div>
                          <img src={g.denahImageData} alt="Denah Gudang" style={{width:"100%",maxHeight:200,objectFit:"contain",borderRadius:6,border:`1px solid ${C.border}`}}/>
                        </div>
                      )}


                      {/* Konfigurasi Koordinat Blok */}
                      {currentUser.role==="ADMIN" && g.denahImageData && (
                        <div>
                          <button style={{...sty.btn(mapConfigGudangId===g.id?"danger":"primary","sm"),marginBottom:8}} onClick={()=>{setMapConfigGudangId(mapConfigGudangId===g.id?null:g.id);setPendingMapLokasi(null);setManualAddMode(false);}}>
                            {mapConfigGudangId===g.id?"✕ Tutup Mode Konfigurasi":"⚙️ Konfigurasi Koordinat Blok"}
                          </button>
                          {mapConfigGudangId===g.id && (() => {
                            const belumPunyaKoordinat = lokasiList.filter(l=>l.status!=="PENDING" && l.gudangId===g.id && l.mapX==null);
                            return (
                            <div style={{background:"#eff6ff",border:`1px solid #bfdbfe`,borderRadius:8,padding:12}}>
                              {!manualAddMode && (
                                <div style={{display:"flex",gap:8,marginBottom:10,flexWrap:"wrap"}}>
                                  <button style={sty.btn("primary","sm")} onClick={()=>{setManualAddMode(true);setPendingMapLokasi(null);}}>
                                    ➕ Tambah Blok Baru
                                  </button>
                                </div>
                              )}

                              {manualAddMode && (
                                <div style={{fontSize:11,color:"#1d4ed8",fontWeight:700,marginBottom:8}}>Klik titik-titik di denah untuk menambah blok baru (bisa beberapa kali). Usulan akan muncul di panel di atas untuk dikonfirmasi & dikirim ke TL.</div>
                              )}

                              {!manualAddMode && (
                                <div style={{marginBottom:10}}>
                                  <div style={{fontSize:11,fontWeight:700,color:C.muted,marginBottom:6}}>Blok belum punya koordinat — klik untuk pilih, lalu klik titik di denah:</div>
                                  {belumPunyaKoordinat.length===0
                                    ? <div style={{fontSize:11,color:C.muted,fontStyle:"italic"}}>Semua blok di gudang ini sudah punya koordinat.</div>
                                    : <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
                                        {belumPunyaKoordinat.map(l=>(
                                          <button key={l.id} style={sty.btn(pendingMapLokasi===l.id?"danger":"ghost","sm")} onClick={()=>setPendingMapLokasi(pendingMapLokasi===l.id?null:l.id)}>
                                            📍 {l.kode}{pendingMapLokasi===l.id?" (klik di peta)":""}
                                          </button>
                                        ))}
                                      </div>
                                  }
                                </div>
                              )}

                              {g.denahOcrWords==null && <div style={{fontSize:10,color:C.muted,marginBottom:8}}>⏳ OCR denah belum tersedia, jalankan ulang upload denah untuk membaca label otomatis.</div>}

                              <div style={{maxWidth:380,margin:"0 auto"}}>
                                <div style={{position:"relative",cursor:(manualAddMode||pendingMapLokasi)?"crosshair":"default",width:"100%"}}
                                  onClick={e=>{
                                    if (!manualAddMode && !pendingMapLokasi) { showToast("Aktifkan 'Tambah Blok Baru' atau pilih blok di daftar dulu!","error"); return; }
                                    const rect = e.currentTarget.getBoundingClientRect();
                                    const xPct = Number(((e.clientX - rect.left) / rect.width * 100).toFixed(1));
                                    const yPct = Number(((e.clientY - rect.top) / rect.height * 100).toFixed(1));
                                    if (manualAddMode) {
                                      const totalUsulan = lokasiList.filter(l=>l.gudangId===g.id).length + ocrSuggestions.length;
                                      const kodeUsulan = suggestKodeFromOcr(g, xPct, yPct) || `${g.kode||"BLOK"}-${String(totalUsulan+1).padStart(2,"0")}`;
                                      setOcrSuggestions(prev=>[...prev, { id: uid(), kode: kodeUsulan, jenisArea:"Rak Tertutup", luasan:"", xPct, yPct, checked: true }]);
                                      setOcrSuggestGudangId(g.id);
                                      setOcrSuggestSubGudangId(null);
                                    } else if (pendingMapLokasi) {
                                      assignLokasiKoordinat(pendingMapLokasi, xPct, yPct, g.id);
                                      setPendingMapLokasi(null);
                                    }
                                  }}>
                                  <img src={g.denahImageData} alt="Denah" style={{width:"100%",height:"auto",borderRadius:6,border:`2px dashed #3b82f6`,display:"block"}}/>
                                  {lokasiList.filter(l=>l.gudangId===g.id&&l.mapX!=null).map(l=>(
                                    <div key={l.id} title={pendingMapLokasi===l.id?`${l.kode} — klik posisi baru di denah`:`${l.kode} — klik untuk pindah koordinat`} style={{position:"absolute",left:`${l.mapX}%`,top:`${l.mapY}%`,transform:"translate(-50%,-50%)",width:12,height:12,borderRadius:"50%",background:pendingMapLokasi===l.id?"#22c55e":(l.status==="PENDING"?"#9ca3af":"#dc2626"),border:l.status==="PENDING"?"2px dashed white":"2px solid white",cursor:"pointer",boxShadow:pendingMapLokasi===l.id?"0 0 0 3px rgba(34,197,94,.35)":"0 1px 4px rgba(0,0,0,0.4)"}} onClick={e=>{e.stopPropagation();setPendingMapLokasi(pendingMapLokasi===l.id?null:l.id);setManualAddMode(false);}}/>
                                  ))}
                                  {ocrSuggestGudangId===g.id && !ocrSuggestSubGudangId && ocrSuggestions.map(s=>(
                                    <div key={s.id} title={`${s.kode} (draft, belum dikirim)`} style={{position:"absolute",left:`${s.xPct}%`,top:`${s.yPct}%`,transform:"translate(-50%,-50%)",width:12,height:12,borderRadius:"50%",background:"#22c55e",border:"2px dashed white",boxShadow:"0 1px 4px rgba(0,0,0,0.4)"}}/>
                                  ))}
                                </div>
                              </div>
                              {manualAddMode && (
                                <button style={{...sty.btn("success","sm"),marginTop:10}} onClick={()=>{setManualAddMode(false);setPendingMapLokasi(null);setMapConfigGudangId(null);}}>
                                  💾 Save Blok
                                </button>
                              )}
                              <div style={{fontSize:10,color:C.muted,marginTop:6}}>💡 Klik titik merah yang sudah ada, lalu klik posisi baru di denah untuk memindahkan koordinatnya (titik jadi hijau saat mode pindah aktif). Titik hijau putus-putus = blok baru draft (belum dikirim ke TL).</div>
                            </div>
                            );
                          })()}
                        </div>
                      )}

                      {/* Sub Gudang milik Gudang ini, tiap Sub Gudang punya daftar Blok + denah sendiri */}
                      <div style={{marginTop:16}}>
                        {(() => {
                          const subsOfGudang = subGudangList.filter(sg=>sg.gudangId===g.id);
                          const knownSubIds = new Set(subsOfGudang.map(sg=>sg.id));
                          const umumBlok = bloklokasi.filter(l=>!l.subGudangId || !knownSubIds.has(l.subGudangId));
                          const groups = [
                            ...subsOfGudang.map(sg=>({ id:sg.id, sg, nama:sg.nama, blok: bloklokasi.filter(l=>l.subGudangId===sg.id) })),
                            { id:null, sg:null, nama:"Umum / Belum Dikelompokkan", blok: umumBlok },
                          ];
                          return groups.map(grp=>{
                            const belumPunyaKoordinatSub = grp.sg ? grp.blok.filter(l=>l.status!=="PENDING" && l.subMapX==null) : [];
                            return (
                            <div key={grp.id||"umum"} style={{marginBottom:18,paddingLeft:10,borderLeft:`3px solid ${C.border}`}}>
                              {grp.sg && <div style={{fontSize:13,fontWeight:800,marginBottom:2}}>🏢 Sub Gudang: {grp.nama}</div>}

                              {/* Opsi 2: Upload Denah per Sub Gudang (hanya untuk grup real, bukan "Umum") */}
                              {grp.sg && currentUser.role==="ADMIN" && (
                                <div style={{marginBottom:10,marginTop:6}}>
                                  <label style={{...sty.label,fontSize:10}}>Upload Denah Sub Gudang (PNG / JPG) — opsional, fallback ke denah Gudang jika kosong</label>
                                  <div>
                                    <input type="file" accept="image/*" capture="environment"
                                      onChange={e=>{const f=e.target.files[0];if(f)uploadDenahSubGudang(grp.sg.id,g.id,f);}}
                                      style={{fontSize:11,color:C.muted}}/>
                                  </div>
                                  {denahSubLoading && <div style={{fontSize:11,color:"#1d4ed8",marginTop:4}}>⏳ Mengompres dan menyimpan gambar...</div>}
                                  {grp.sg.denahUploadedAt && !denahSubLoading && <div style={{fontSize:10,color:C.green,marginTop:4}}>✅ Denah tersimpan • {fmtDate(grp.sg.denahUploadedAt)}</div>}
                                </div>
                              )}
                              {grp.sg?.denahImageData && (
                                <div style={{marginBottom:10}}>
                                  <div style={{fontSize:11,fontWeight:700,color:C.muted,marginBottom:6}}>Preview Denah Sub Gudang:</div>
                                  <img src={grp.sg.denahImageData} alt="Denah Sub Gudang" style={{width:"100%",maxHeight:180,objectFit:"contain",borderRadius:6,border:`1px solid ${C.border}`}}/>
                                </div>
                              )}

                              {/* Konfigurasi Koordinat Blok — level Sub Gudang */}
                              {grp.sg && currentUser.role==="ADMIN" && grp.sg.denahImageData && (
                                <div style={{marginBottom:10}}>
                                  <button style={{...sty.btn(mapConfigSubGudangId===grp.sg.id?"danger":"primary","sm"),marginBottom:8}} onClick={()=>{setMapConfigSubGudangId(mapConfigSubGudangId===grp.sg.id?null:grp.sg.id);setPendingMapLokasiSub(null);setManualAddModeSub(false);}}>
                                    {mapConfigSubGudangId===grp.sg.id?"✕ Tutup Mode Konfigurasi":"⚙️ Konfigurasi Koordinat Blok (Sub Gudang)"}
                                  </button>
                                  {mapConfigSubGudangId===grp.sg.id && (
                                    <div style={{background:"#eff6ff",border:`1px solid #bfdbfe`,borderRadius:8,padding:12}}>
                                      {!manualAddModeSub && (
                                        <div style={{display:"flex",gap:8,marginBottom:10,flexWrap:"wrap"}}>
                                          <button style={sty.btn("primary","sm")} onClick={()=>{setManualAddModeSub(true);setPendingMapLokasiSub(null);}}>
                                            ➕ Tambah Blok Baru
                                          </button>
                                        </div>
                                      )}
                                      {manualAddModeSub && <div style={{fontSize:11,color:"#1d4ed8",fontWeight:700,marginBottom:8}}>Klik titik-titik di denah untuk menambah blok baru. Usulan akan muncul di panel di atas untuk dikonfirmasi & dikirim ke TL.</div>}
                                      {!manualAddModeSub && (
                                        <div style={{marginBottom:10}}>
                                          <div style={{fontSize:11,fontWeight:700,color:C.muted,marginBottom:6}}>Blok belum punya koordinat di denah ini — klik untuk pilih, lalu klik titik di denah:</div>
                                          {belumPunyaKoordinatSub.length===0
                                            ? <div style={{fontSize:11,color:C.muted,fontStyle:"italic"}}>Semua blok di sub gudang ini sudah punya koordinat.</div>
                                            : <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
                                                {belumPunyaKoordinatSub.map(l=>(
                                                  <button key={l.id} style={sty.btn(pendingMapLokasiSub===l.id?"danger":"ghost","sm")} onClick={()=>setPendingMapLokasiSub(pendingMapLokasiSub===l.id?null:l.id)}>
                                                    📍 {l.kode}{pendingMapLokasiSub===l.id?" (klik di peta)":""}
                                                  </button>
                                                ))}
                                              </div>
                                          }
                                        </div>
                                      )}
                                      <div style={{maxWidth:380,margin:"0 auto"}}>
                                        <div style={{position:"relative",cursor:(manualAddModeSub||pendingMapLokasiSub)?"crosshair":"default",width:"100%"}}
                                          onClick={e=>{
                                            if (!manualAddModeSub && !pendingMapLokasiSub) { showToast("Aktifkan 'Tambah Blok Baru' atau pilih blok di daftar dulu!","error"); return; }
                                            const rect = e.currentTarget.getBoundingClientRect();
                                            const xPct = Number(((e.clientX - rect.left) / rect.width * 100).toFixed(1));
                                            const yPct = Number(((e.clientY - rect.top) / rect.height * 100).toFixed(1));
                                            if (manualAddModeSub) {
                                              const totalUsulan = grp.blok.length + ocrSuggestions.length;
                                              const kodeUsulan = suggestKodeFromOcr(grp.sg, xPct, yPct) || `${grp.sg.nama?.slice(0,6).toUpperCase()||"BLOK"}-${String(totalUsulan+1).padStart(2,"0")}`;
                                              setOcrSuggestions(prev=>[...prev, { id: uid(), kode: kodeUsulan, jenisArea:"Rak Tertutup", luasan:"", xPct, yPct, checked: true }]);
                                              setOcrSuggestGudangId(g.id);
                                              setOcrSuggestSubGudangId(grp.sg.id);
                                            } else if (pendingMapLokasiSub) {
                                              assignLokasiKoordinatSub(pendingMapLokasiSub, xPct, yPct, grp.sg.id, g.id);
                                              setPendingMapLokasiSub(null);
                                            }
                                          }}>
                                          <img src={grp.sg.denahImageData} alt="Denah Sub Gudang" style={{width:"100%",height:"auto",borderRadius:6,border:`2px dashed #3b82f6`,display:"block"}}/>
                                          {grp.blok.filter(l=>l.subMapX!=null).map(l=>(
                                            <div key={l.id} title={pendingMapLokasiSub===l.id?`${l.kode} — klik posisi baru di denah`:`${l.kode} — klik untuk pindah koordinat`} style={{position:"absolute",left:`${l.subMapX}%`,top:`${l.subMapY}%`,transform:"translate(-50%,-50%)",width:12,height:12,borderRadius:"50%",background:pendingMapLokasiSub===l.id?"#22c55e":(l.status==="PENDING"?"#9ca3af":"#dc2626"),border:l.status==="PENDING"?"2px dashed white":"2px solid white",cursor:"pointer",boxShadow:pendingMapLokasiSub===l.id?"0 0 0 3px rgba(34,197,94,.35)":"0 1px 4px rgba(0,0,0,0.4)"}} onClick={e=>{e.stopPropagation();setPendingMapLokasiSub(pendingMapLokasiSub===l.id?null:l.id);setManualAddModeSub(false);}}/>
                                          ))}
                                          {ocrSuggestSubGudangId===grp.sg.id && ocrSuggestions.map(s=>(
                                            <div key={s.id} title={`${s.kode} (draft, belum dikirim)`} style={{position:"absolute",left:`${s.xPct}%`,top:`${s.yPct}%`,transform:"translate(-50%,-50%)",width:12,height:12,borderRadius:"50%",background:"#22c55e",border:"2px dashed white",boxShadow:"0 1px 4px rgba(0,0,0,0.4)"}}/>
                                          ))}
                                        </div>
                                      </div>
                                      {manualAddModeSub && (
                                        <button style={{...sty.btn("success","sm"),marginTop:10}} onClick={()=>{setManualAddModeSub(false);setPendingMapLokasiSub(null);setMapConfigSubGudangId(null);}}>
                                          💾 Save Blok
                                        </button>
                                      )}
                                      <div style={{fontSize:10,color:C.muted,marginTop:6}}>💡 Klik titik merah yang sudah ada untuk mereset koordinatnya. Titik hijau putus-putus = blok baru draft (belum dikirim ke TL).</div>
                                    </div>
                                  )}
                                </div>
                              )}

                              {/* Blok "Umum" pakai koordinat level Gudang (mapX/mapY) — tombol konfigurasi
                                  aslinya cuma ada di panel atas (di luar loop grup), jadi tidak terlihat dari
                                  sini. Tambahkan pintasan langsung ke mode konfigurasi yang sama. */}
                              {!grp.sg && currentUser.role==="ADMIN" && g.denahImageData && (
                                <div style={{marginBottom:10}}>
                                  <button style={sty.btn(mapConfigGudangId===g.id?"danger":"primary","sm")} onClick={()=>{setMapConfigGudangId(mapConfigGudangId===g.id?null:g.id);setPendingMapLokasi(null);setManualAddMode(false);}}>
                                    {mapConfigGudangId===g.id?"✕ Tutup Mode Konfigurasi":"⚙️ Konfigurasi Koordinat Blok (pakai denah Gudang)"}
                                  </button>
                                  {mapConfigGudangId!==g.id && <div style={{fontSize:10,color:C.muted,marginTop:4}}>💡 Blok di grup "Umum" diplot di denah utama Gudang (bukan denah Sub Gudang) — klik tombol di atas untuk mengatur koordinatnya.</div>}
                                </div>
                              )}
                              {!grp.sg && currentUser.role==="ADMIN" && !g.denahImageData && (
                                <div style={{fontSize:10,color:"#92400e",background:"#fef3c7",borderRadius:6,padding:"6px 10px",marginBottom:10}}>⚠️ Upload Denah Gudang dulu (panel di atas) sebelum bisa mengatur koordinat blok di grup "Umum".</div>
                              )}

                              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                                <div style={{fontSize:12,color:C.muted}}>📍 Daftar Blok Lokasi ({grp.blok.length})</div>
                                {currentUser.role==="ADMIN" && <button style={sty.btn("ghost","sm")} onClick={()=>openAddLokasiFor(g.id, grp.id)}>+ Tambah Blok</button>}
                              </div>
                              {grp.blok.length===0
                                ? <div style={{fontSize:12,color:C.muted,fontStyle:"italic",marginBottom:8}}>Belum ada blok lokasi di sub gudang ini.</div>
                                : <div style={{display:"flex",flexDirection:"column",gap:4,marginBottom:8}}>
                                    {grp.blok.map(l=>{
                                      const n = stocks.filter(s=>s.lokasiId===l.id).length;
                                      const hasCoord = grp.sg ? l.subMapX!=null : l.mapX!=null;
                                      return (
                                        <div key={l.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"6px 10px",background:"#f9fafb",border:`1px solid ${C.border}`,borderRadius:6,fontSize:12}}>
                                          <div style={{display:"flex",alignItems:"center",gap:8,minWidth:0}}>
                                            <span style={{fontWeight:700}}>{l.kode}</span>
                                            {l.nama && <span style={{color:C.muted,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{l.nama}</span>}
                                            {l.status==="PENDING" && <span style={{fontSize:9,fontWeight:700,color:"#92400e",background:"#fef3c7",padding:"1px 6px",borderRadius:10}}>MENUNGGU APPROVAL TL</span>}
                                            {!hasCoord && <span style={{fontSize:9,fontWeight:700,color:"#92400e",background:"#fef3c7",padding:"1px 6px",borderRadius:10}}>BELUM ADA KOORDINAT</span>}
                                          </div>
                                          <div style={{display:"flex",alignItems:"center",gap:8,flexShrink:0}}>
                                            <span style={{fontSize:11,color:n>0?C.accent:C.muted,fontWeight:700}}>{n} item</span>
                                            {currentUser.role==="ADMIN" && <button style={{...sty.btn("ghost","sm"),padding:"2px 8px"}} onClick={()=>openEditLokasi(l)}>✏️</button>}
                                          </div>
                                        </div>
                                      );
                                    })}
                                  </div>
                              }
                            </div>
                          );});
                        })()}
                      </div>
                      </div>}
                    </div>
                  );
                })}
              </div>
            )}

            {/* ── SUB-TAB: MIGRASI DATA (ADMIN only) ── */}
            {stockSubTab==="migrasi" && currentUser.role==="ADMIN" && (
              <MigrasiDataTab
                stocks={stocks}
                katalogList={katalogList}
                lokasiList={lokasiList}
                txns={txns}
                migratedTug15History={migratedTug15History}
                setMigratedTug15History={setMigratedTug15History}
                maraReference={maraReference}
                setMaraReference={setMaraReference}
                maraUploadLoading={maraUploadLoading}
                maraUploadProgress={maraUploadProgress}
                uploadMaraToDB={uploadMaraToDB}
                currentUser={currentUser}
                sty={sty} C={C}
                saveToCloud={saveToCloud}
                setStocks={setStocks}
                setKatalogList={setKatalogList}
                setTxns={setTxns}
                showToast={showToast}
              />
            )}
          </div>
        )}
        {tab==="transaction" && (
          <div>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
              <div>
                <h1 style={{fontSize:22,fontWeight:900}}>
                  {tugSubTab==="TUG9"?"TUG-9 — Bon Pemakaian":tugSubTab==="TUG8"?"TUG-8 — Pemakaian Unit Lain":tugSubTab==="TUG10"?"TUG-10 — Bon Pengembalian":tugSubTab==="TUG5"?"TUG-5 — Daftar Permintaan Barang":tugSubTab==="TUG15"?"TUG-15 — Laporan Mutasi Stok":"TUG-3 / TUG-4 — Penerimaan Barang"}
                </h1>
                <p style={{color:C.muted,fontSize:13}}>
                  {tugSubTab==="TUG9"?"Pengeluaran Barang Pemakaian di Unit Sendiri (UPT Surabaya)":tugSubTab==="TUG8"?"Pengeluaran Barang Pemakaian ke Unit PLN Lain":tugSubTab==="TUG10"?"Pengembalian Material ke Gudang — Sisa Pekerjaan / Bekas Bongkaran":tugSubTab==="TUG5"?"Permintaan material ke UIT — Intracompany (→TUG-7) atau Intercompany (→TUG-5 UIT)":tugSubTab==="TUG15"?"History mutasi stok dari semua transaksi TUG yang disetujui — filter rentang tanggal & unduh":"Karantina → Pemeriksaan Mutu → Final (3 tahap: TL → Manager → Asman)"}
                </p>
              </div>
              {(CAN_CREATE.includes(currentUser.role) || currentUser.role==="ADMIN_ULTG") && (tugSubTab==="TUG3"||tugSubTab==="TUG10"||tugSubTab==="TUG9"||tugSubTab==="TUG8"||tugSubTab==="TUG5") && <button style={sty.btn("primary")} onClick={()=>openNewTxn(tugSubTab)}>+ Buat {tugSubTab.replace("TUG","TUG-")} Baru</button>}
            </div>

            <div style={{display:"flex",gap:8,marginBottom:10,alignItems:"center"}}>
              <span style={{fontSize:11,color:C.muted}}>TUG</span>
              <span style={{fontSize:11,color:C.muted}}>▸</span>
              <span style={{fontSize:11,fontWeight:700,color:C.accent}}>{tugGroup==="penerimaan"?"📥 Penerimaan":tugGroup==="pengeluaran"?"📤 Pengeluaran":"📋 Permintaan"}</span>
              <span style={{fontSize:10,color:C.muted,marginLeft:4}}>(ganti via sidebar)</span>
            </div>
            <div style={{display:"flex",gap:8,marginBottom:14,flexWrap:"wrap"}}>
              {(tugGroup==="penerimaan"
                ? [{id:"TUG3",label:"TUG-3 / TUG-4 (Penerimaan Baru)"},{id:"TUG10",label:"TUG-10 (Pengembalian)"}]
                : tugGroup==="pengeluaran"
                ? [{id:"TUG9",label:"TUG-9 (Pemakaian Sendiri)"},{id:"TUG8",label:"TUG-8 (Pemakaian Unit Lain)"}]
                : tugGroup==="laporan"
                ? [{id:"TUG15",label:"TUG-15 (Laporan Mutasi Stok)"}]
                : [{id:"TUG5",label:"TUG-5 (Permintaan Barang)"}]
              ).map(o=>(
                <button key={o.id} style={{padding:"6px 14px",borderRadius:20,border:`1px solid ${tugSubTab===o.id?C.accent:C.border}`,background:tugSubTab===o.id?C.accent:"white",color:tugSubTab===o.id?"white":C.muted,fontSize:12,cursor:"pointer",fontWeight:tugSubTab===o.id?700:400}} onClick={()=>setTugSubTab(o.id)}>{o.label}</button>
              ))}
            </div>
            <div style={{display:"flex",gap:8,marginBottom:14}}>
              {["ALL","PENDING","APPROVED","REJECTED","DRAFT"].map(s=>(
                <button key={s} style={{padding:"6px 14px",borderRadius:20,border:`1px solid ${filterStatus===s?C.accent:C.border}`,background:filterStatus===s?C.accent:"white",color:filterStatus===s?"white":C.muted,fontSize:12,cursor:"pointer",fontWeight:filterStatus===s?700:400}} onClick={()=>setFilterStatus(s)}>{s==="ALL"?"Semua":s}</button>
              ))}
            </div>

            {tugSubTab==="TUG3" ? (
              <TUG3Tab
                txns={txns.filter(t=>t.docType==="TUG3")}
                filterStatus={filterStatus}
                users={users} sty={sty} C={C} currentUser={currentUser}
                katalogList={katalogList} lokasiList={lokasiList} timMutuList={timMutuList}
                approveTUG3_TL={approveTUG3_TL} rejectTUG3_TL={rejectTUG3_TL}
                submitTUG4Form={submitTUG4Form} approveTUG4_Manager={approveTUG4_Manager} rejectTUG4_Manager={rejectTUG4_Manager}
                submitTUG3FinalLampiran={submitTUG3FinalLampiran} approveTUG3Final_Asman={approveTUG3Final_Asman} rejectTUG3Final_Asman={rejectTUG3Final_Asman}
                handleImg={handleImg} setDocPreview={setDocPreview}
              />
            ) : tugSubTab==="TUG5" ? (
              <TUG5Tab
                txns={txns}
                filterStatus={filterStatus}
                users={users} sty={sty} C={C} currentUser={currentUser}
                katalogList={katalogList} uitList={uitList} uptList={uptList}
                approveTUG5_Asman={approveTUG5_Asman} rejectTUG5_Asman={rejectTUG5_Asman}
                approveTUG5_Manager={approveTUG5_Manager} rejectTUG5_Manager={rejectTUG5_Manager}
                submitTUG7_AdminUIT={submitTUG7_AdminUIT}
                approveTUG7_MgrLogistik={approveTUG7_MgrLogistik} rejectTUG7_MgrLogistik={rejectTUG7_MgrLogistik}
                konfirmasiDraftTUG8={konfirmasiDraftTUG8}
                setDocPreview={setDocPreview}
                ultgList={ultgList}
                approveTUG5_MgrULTG={approveTUG5_MgrULTG} rejectTUG5_MgrULTG={rejectTUG5_MgrULTG}
                adoptTUG5ULTG={adoptTUG5ULTG} openDraftTug9={openDraftTug9}
              />
            ) : tugSubTab==="TUG15" ? (
              <TUG15Tab
                txns={txns} katalogList={katalogList} stocks={stocks}
                sty={sty} C={C}
                filter={tug15Filter} setFilter={setTug15Filter}
                lokasiList={lokasiList}
              />
            ) : (
            <div style={{display:"flex",flexDirection:"column",gap:10}}>
              {filteredTxns.filter(t=>t.docType===tugSubTab).length===0 && <div style={{...sty.card,textAlign:"center",color:C.muted,padding:30}}>Belum ada transaksi {tugSubTab.replace("TUG","TUG-")}</div>}
              {filteredTxns.filter(t=>t.docType===tugSubTab).map(t=>{
                const creator = users.find(u=>u.id===t.createdBy)||{};
                const approver = users.find(u=>u.id===t.approvedBy)||{};
                const dKey = t.docType==="TUG9"?"tug9":t.docType==="TUG8"?"tug8":"tug10";
                const lokTujuan = lokasiList.find(l=>l.id===t.lokasiTujuanId);
                return (
                  <div key={t.id} style={{...sty.card}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:8}}>
                      <div>
                        <div style={{fontWeight:800,fontSize:14}}>{t.namaPekerjaan}</div>
                        <div style={{fontSize:11,color:"#0098da",fontWeight:700}}>{t.docNumbers[dKey]}</div>
                      </div>
                      <span style={sty.statusBadge(t.status)}>{t.status}</span>
                    </div>
                    <div style={{fontSize:11,color:C.muted,display:"flex",gap:16,flexWrap:"wrap",marginBottom:8}}>
                      <span>📍 {t.lokasiPekerjaan}</span>
                      <span>📅 {fmtDate(t.createdAt)}</span>
                      <span>👷 {creator.name||"-"} ({ROLES[creator.role]})</span>
                      {t.docType==="TUG8" && <span>🏭 Unit Tujuan: {t.unitTujuan}</span>}
                      {(t.docType==="TUG9"||t.docType==="TUG8") && <span>🏢 Penerima: {t.penerimaNama} ({t.penerimaUnit})</span>}
                      {t.docType==="TUG10" && <span>📍 Disimpan di: {lokTujuan?.kode||"-"}</span>}
                      {t.docType==="TUG10" && <span>📤 Menyerahkan: {t.menyerahkanNama}</span>}
                    </div>
                    <div style={{background:"#f9fafb",borderRadius:8,padding:8,marginBottom:8}}>
                      {t.docType!=="TUG10" ? t.stockItems.map((si,idx)=>{
                        const stock = enrichedStocks.find(s=>s.id===si.stockId);
                        return <div key={idx} style={{fontSize:12,padding:"3px 0"}}>📦 {stock?.name||"?"} <b>x{si.qty}</b> {stock?.unit} <span style={{fontSize:11,color:C.muted}}>@ {stock?.lokasi}</span> <span style={sty.jenisBadge(stock?.jenisBarang)}>{stock?.jenisBarang}</span></div>;
                      }) : t.stockItems.map((si,idx)=>{
                        const namaBarang = si.katalogMode==="existing" ? (katalogList.find(k=>k.id===si.katalogId)?.name||"?") : si.namaBaru;
                        const bs = statusMaterialBadgeStyle(si.statusMaterial);
                        return <div key={idx} style={{fontSize:12,padding:"3px 0"}}>📦 {namaBarang} <b>x{si.qty}</b> <span style={{padding:"2px 7px",borderRadius:20,fontSize:10,background:bs.bg,color:bs.fg,fontWeight:700}}>{si.statusMaterial}</span>{si.noSeri && <span style={{fontSize:11,color:C.muted}}> • SN: {si.noSeri}</span>}</div>;
                      })}
                    </div>
                    {t.status==="APPROVED" && <div style={{fontSize:11,color:C.green,marginBottom:8}}>✅ Disetujui oleh {approver.name} ({ROLES[approver.role]}) • {fmtDate(t.approvedAt)} {t.asmanAutoApproved && "• Asman Konstruksi otomatis ikut menyetujui"}</div>}
                    {t.status==="REJECTED" && <div style={{fontSize:11,color:C.red,marginBottom:8}}>❌ Ditolak: {t.rejectReason}</div>}
                    {t.status==="APPROVED" && <button style={sty.btn("ghost","sm")} onClick={()=>setDocPreview(t)}>📄 Lihat & Unduh Dokumen {t.docType.replace("TUG","TUG-")}</button>}
                  </div>
                );
              })}
            </div>
            )}
          </div>
        )}

        {tab==="heavyEquipment" && (
          <HeavyEquipmentTabV2
            equipmentList={heavyEquipmentList}
            loans={heavyEquipmentLoans}
            currentUser={currentUser}
            users={users}
            sty={sty}
            C={C}
            handleImg={handleImg}
            savePhoto={saveHeavyEquipmentPhoto}
            createLoan={createHeavyEquipmentLoan}
            approveLoan={approveHeavyEquipmentLoan}
            rejectLoan={rejectHeavyEquipmentLoan}
            completeLoan={completeHeavyEquipmentLoan}
            showToast={showToast}
          />
        )}

        {/* APPROVAL — semua notifikasi approval (TUG, Lokasi/Blok, Pemindahan Stok, dkk) dikumpulkan di sini, dipisah per-bagian + riwayat di bawah */}
        {tab==="approval" && ["TL","ASMAN","MANAGER","ADMIN_UIT","MGR_LOGISTIK_UIT","ADMIN","MGR_ULTG","ADMIN_ULTG"].includes(currentUser.role) && (
          <div>
            {/* ── BAGIAN: Pemindahan Blok Data Stok (khusus TL) ── */}
            {currentUser.role==="TL" && stocks.some(s=>s.lokasiMovePending) && (
              <div style={{...sty.card,marginBottom:16,borderLeft:`4px solid ${C.yellow}`}}>
                <div style={{fontWeight:800,fontSize:14,marginBottom:10}}>📦 Pemindahan Blok Data Stok ({stocks.filter(s=>s.lokasiMovePending).length})</div>
                {stocks.filter(s=>s.lokasiMovePending).map(s=>{
                  const pemohon = users.find(u=>u.id===s.moveRequestedBy);
                  const lokAsal = lokasiList.find(l=>l.id===s.lokasiId);
                  return (
                    <div key={s.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"8px 0",borderBottom:`1px solid ${C.border}`,gap:10}}>
                      <div>
                        <div style={{fontSize:12,fontWeight:700}}>{s.name}</div>
                        <div style={{fontSize:11,color:C.muted}}>{lokAsal?.kode||"—"} → {s.pendingLokasiKode} • Diajukan oleh {pemohon?.name||"?"} • {fmtDate(s.moveRequestedAt)}</div>
                      </div>
                      <div style={{display:"flex",gap:6}}>
                        <button style={sty.btn("primary","sm")} onClick={()=>approveStockMove(s.id)}>✓ Setuju</button>
                        <button style={sty.btn("danger","sm")} onClick={()=>rejectStockMove(s.id)}>✕ Tolak</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* ── BAGIAN: Edit Data Stok (qty/harga/jenis) — khusus TL ── */}
            {currentUser.role==="TL" && stocks.some(s=>s.editPending) && (
              <div style={{...sty.card,marginBottom:16,borderLeft:`4px solid ${C.yellow}`}}>
                <div style={{fontWeight:800,fontSize:14,marginBottom:10}}>✏️ Edit Data Stok ({stocks.filter(s=>s.editPending).length})</div>
                {stocks.filter(s=>s.editPending).map(s=>{
                  const pemohon = users.find(u=>u.id===s.editRequestedBy);
                  return (
                    <div key={s.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"8px 0",borderBottom:`1px solid ${C.border}`,gap:10}}>
                      <div>
                        <div style={{fontSize:12,fontWeight:700}}>{s.name}</div>
                        <div style={{fontSize:11,color:C.muted}}>
                          Qty {fmtNum(s.qty)}→{fmtNum(s.pendingEditData.qty)} • Harga Rp{fmtNum(s.price)}→Rp{fmtNum(s.pendingEditData.price)} • Jenis {s.jenisBarang}→{s.pendingEditData.jenisBarang}<br/>
                          Diajukan oleh {pemohon?.name||"?"} • {fmtDate(s.editRequestedAt)}
                        </div>
                      </div>
                      <div style={{display:"flex",gap:6}}>
                        <button style={sty.btn("primary","sm")} onClick={()=>approveStockEdit(s.id)}>✓ Setuju</button>
                        <button style={sty.btn("danger","sm")} onClick={()=>rejectStockEdit(s.id)}>✕ Tolak</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* ── BAGIAN: Hapus Data Stok — khusus TL ── */}
            {currentUser.role==="TL" && stocks.some(s=>s.deletePending) && (
              <div style={{...sty.card,marginBottom:16,borderLeft:`4px solid ${C.red}`}}>
                <div style={{fontWeight:800,fontSize:14,marginBottom:10}}>🗑️ Hapus Data Stok ({stocks.filter(s=>s.deletePending).length})</div>
                {stocks.filter(s=>s.deletePending).map(s=>{
                  const pemohon = users.find(u=>u.id===s.deleteRequestedBy);
                  return (
                    <div key={s.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"8px 0",borderBottom:`1px solid ${C.border}`,gap:10}}>
                      <div>
                        <div style={{fontSize:12,fontWeight:700}}>{s.name}</div>
                        <div style={{fontSize:11,color:C.muted}}>Diajukan oleh {pemohon?.name||"?"} • {fmtDate(s.deleteRequestedAt)}</div>
                      </div>
                      <div style={{display:"flex",gap:6}}>
                        <button style={sty.btn("primary","sm")} onClick={()=>approveStockDelete(s.id)}>✓ Setuju</button>
                        <button style={sty.btn("danger","sm")} onClick={()=>rejectStockDelete(s.id)}>✕ Tolak</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* ── BAGIAN: Transaksi TUG (TUG-3/4/5/7/8/9/10, dkk) ── */}
            {currentUser.role==="ASMAN" && heavyEquipmentLoans.some(l=>isPendingHeavyEquipmentLoan(l) && canApproveHeavyEquipmentLoan(currentUser, l)) && (
              <div style={{...sty.card,marginBottom:16,borderLeft:`4px solid ${C.yellow}`}}>
                <div style={{fontWeight:800,fontSize:14,marginBottom:10}}>🚜 Peminjaman Alat Berat ({heavyEquipmentLoans.filter(l=>isPendingHeavyEquipmentLoan(l) && canApproveHeavyEquipmentLoan(currentUser, l)).length})</div>
                {heavyEquipmentLoans.filter(l=>isPendingHeavyEquipmentLoan(l) && canApproveHeavyEquipmentLoan(currentUser, l)).map(l=>{
                  const alat = heavyEquipmentList.find(eq=>eq.id===l.equipmentId);
                  const pemohon = users.find(u=>u.id===l.requestedBy);
                  const ownerUpt = getHeavyEquipmentLoanOwnerUpt(l);
                  const requesterUpt = getHeavyEquipmentLoanRequesterUpt(l);
                  return (
                    <div key={l.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"8px 0",borderBottom:`1px solid ${C.border}`,gap:10}}>
                      <div>
                        <div style={{fontSize:12,fontWeight:700}}>{alat?.nama||l.equipmentId} • {ownerUpt} → {requesterUpt}</div>
                        <div style={{fontSize:11,color:C.muted}}>{getHeavyEquipmentLoanStartDate(l)} s/d {getHeavyEquipmentLoanReturnDate(l)} • Diajukan oleh {pemohon?.name||"?"} • {fmtDate(l.requestedAt)}</div>
                        <div style={{fontSize:11,color:C.text,marginTop:2}}>{getHeavyEquipmentLoanJobName(l)}{l.keperluan ? ` • ${l.keperluan}` : ""}</div>
                      </div>
                      <div style={{display:"flex",gap:6,flexShrink:0}}>
                        <button style={sty.btn("primary","sm")} onClick={()=>approveHeavyEquipmentLoan(l.id)}>✓ Setuju</button>
                        <button style={sty.btn("danger","sm")} onClick={()=>{
                          const rejectReason = window.prompt("Alasan penolakan peminjaman alat?");
                          if (rejectReason) rejectHeavyEquipmentLoan(l.id, rejectReason);
                        }}>✕ Tolak</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <div style={{fontWeight:800,fontSize:14,margin:"4px 0 10px"}}>🔄 Transaksi TUG</div>
            <ApprovalTab
              pendingTxns={myPendingApprovals}
              stocks={enrichedStocks} katalogList={katalogList} lokasiList={lokasiList}
              users={users} sty={sty} C={C}
              approveTxn={approveTxn} rejectTxn={rejectTxn} currentUser={currentUser}
              uptList={uptList}
              submitTUG7_AdminUIT={submitTUG7_AdminUIT}
              approveTUG7_MgrLogistik={approveTUG7_MgrLogistik} rejectTUG7_MgrLogistik={rejectTUG7_MgrLogistik}
              konfirmasiDraftTUG8={konfirmasiDraftTUG8}
              gudangCapacityImports={gudangCapacityImports}
              approveCapacityImport={approveCapacityImport}
              rejectCapacityImport={rejectCapacityImport}
              approveLokasiChange={approveLokasiChange}
              rejectLokasiChange={rejectLokasiChange}
              ultgList={ultgList}
              approveTUG5_MgrULTG={approveTUG5_MgrULTG}
              rejectTUG5_MgrULTG={rejectTUG5_MgrULTG}
              ultgPengajuanUntukAdopt={ultgPengajuanUntukAdopt}
              adoptTUG5ULTG={adoptTUG5ULTG}
              openDraftTug9={openDraftTug9}
              heavyEquipmentPendingCount={currentUser.role==="ASMAN" ? heavyEquipmentPendingCount : 0}
            />

            {/* ── BAGIAN: Riwayat Approval (gabungan semua jenis, terbaru di atas) ── */}
            {(()=>{
              const histTUG = txns.filter(t=>t.status==="APPROVED"||t.status==="REJECTED").map(t=>({
                id:`TUG-${t.id}`, type:"TUG", decision:t.status,
                title:`${t.docType||"TUG"} • ${t.id}`,
                decidedBy: t.status==="REJECTED" ? t.rejectedBy : t.approvedBy,
                decidedAt: t.status==="REJECTED" ? t.rejectedAt : t.approvedAt,
              }));
              const combined = [...approvalHistoryList, ...histTUG].filter(h=>h.decidedAt).sort((a,b)=>b.decidedAt-a.decidedAt).slice(0,80);
              const typeLabel = {LOKASI:"📍 Lokasi/Blok", STOCK_MOVE:"📦 Pemindahan Stok", STOCK_EDIT:"✏️ Edit Stok", STOCK_DELETE:"🗑️ Hapus Stok", HEAVY_EQUIPMENT_LOAN:"🚜 Peminjaman Alat", TUG:"🔄 TUG"};
              const typeOrder = ["TUG","HEAVY_EQUIPMENT_LOAN","LOKASI","STOCK_MOVE","STOCK_EDIT","STOCK_DELETE"];
              const groupsByType = typeOrder
                .map(type=>({ type, items: combined.filter(h=>h.type===type) }))
                .filter(g=>g.items.length>0);
              // Jenis lain yang mungkin muncul di masa depan tapi belum ada di typeOrder — tetap ditampilkan.
              const knownTypes = new Set(typeOrder);
              combined.forEach(h=>{ if(!knownTypes.has(h.type)){ knownTypes.add(h.type); groupsByType.push({type:h.type, items:combined.filter(x=>x.type===h.type)}); } });
              return (
                <div style={{...sty.card,marginTop:16}}>
                  <div style={{fontWeight:800,fontSize:14,marginBottom:10}}>📜 Riwayat Approval</div>
                  {combined.length===0 && <div style={{textAlign:"center",color:C.muted,padding:20,fontSize:13}}>Belum ada riwayat approval.</div>}
                  {groupsByType.map(g=>(
                    <div key={g.type} style={{marginBottom:14}}>
                      <div style={{fontSize:12,fontWeight:800,color:"#0098da",marginBottom:4}}>{typeLabel[g.type]||g.type} ({g.items.length})</div>
                      {g.items.map(h=>{
                        const decider = users.find(u=>u.id===h.decidedBy);
                        return (
                          <div key={h.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"8px 0",borderBottom:`1px solid ${C.border}`,gap:10}}>
                            <div>
                              <div style={{fontSize:12,fontWeight:700}}>{h.title}</div>
                              <div style={{fontSize:11,color:C.muted}}>Oleh {decider?.name||"?"} • {fmtDate(h.decidedAt)}</div>
                            </div>
                            <span style={{padding:"3px 10px",borderRadius:20,fontSize:10,fontWeight:700,background:h.decision==="APPROVED"?"#dcfce7":"#fee2e2",color:h.decision==="APPROVED"?C.green:C.red}}>
                              {h.decision==="APPROVED"?"✓ Disetujui":"✕ Ditolak"}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </div>
              );
            })()}
          </div>
        )}

        {/* AI AGENT — chat AI murni, terpisah dari Forecast Stok */}
        {tab==="ai" && (
          <AIAgentPage
            enrichedStocks={enrichedStocks}
            katalogList={katalogList}
            stocks={stocks}
            txns={txns}
            rencanaKedatanganList={rencanaKedatanganList}
            chatHistory={chatHistory}
            setChatHistory={setChatHistory}
            chatInput={chatInput}
            setChatInput={setChatInput}
            chatLoading={chatLoading}
            chatEndRef={chatEndRef}
            sendChat={sendChat}
            syncRagChunks={syncRagChunks}
            syncWarnotoState={syncWarnotoState}
            syncStocksSnapshot={syncStocksSnapshot}
            ragSyncing={ragSyncing}
            ragLastSync={ragLastSync}
            currentUser={currentUser}
            C={C} sty={sty}
          />
        )}

        {/* FORECAST STOK — halaman sendiri, gabungkan heuristik lokal + AI Groq + ML Prophet berdampingan */}
        {tab==="forecastStok" && (
          <ForecastStokPage
            katalogList={katalogList}
            stocks={stocks}
            txns={txns}
            forecastDetail={forecastDetail}
            setForecastDetail={setForecastDetail}
            forecastDetailResult={forecastDetailResult}
            setForecastDetailResult={setForecastDetailResult}
            forecastDetailLoading={forecastDetailLoading}
            forecastDrillDown={forecastDrillDown}
            setTab={setTab}
            sendChat={sendChat}
            materialCadangData={materialCadangData}
            setMaterialCadangData={setMaterialCadangData}
            maraReference={maraReference}
            setMaraReference={setMaraReference}
            catalogMasterRef={catalogMasterRef}
            setCatalogMasterRef={setCatalogMasterRef}
            saveToCloud={saveToCloud}
            showToast={showToast}
            currentUser={currentUser}
            C={C} sty={sty}
          />
        )}

      </div>

      {/* STOCK MODAL (Data Stok = junction of Katalog x Lokasi) */}
      {stockModal && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000}}>
          <div style={{...sty.card,width:520,maxHeight:"90vh",overflowY:"auto"}}>
            <h3 style={{fontSize:18,fontWeight:800,marginBottom:20}}>{stockModal==="edit"?"Edit Data Stok":"Tambah Data Stok Baru"}</h3>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
              <div style={{gridColumn:"1/-1"}}>
                <label style={sty.label}>Barang (dari Master Katalog)</label>
                <select style={sty.select} value={stockForm.katalogId||""} onChange={e=>setStockForm(sf=>({...sf,katalogId:e.target.value}))}>
                  <option value="">-- Pilih Barang --</option>
                  {katalogList.map(k=><option key={k.id} value={k.id}>{k.name} [{k.katalog}]</option>)}
                </select>
                {katalogList.length===0 && <div style={{fontSize:10,color:"#be185d",marginTop:4}}>Belum ada Master Katalog. Tambahkan dulu di tab "Master Katalog".</div>}
              </div>
              <div style={{gridColumn:"1/-1"}}>
                <label style={sty.label}>Lokasi (dari Master Lokasi)</label>
                <select style={sty.select} value={stockForm.lokasiId||""} onChange={e=>setStockForm(sf=>({...sf,lokasiId:e.target.value}))}>
                  <option value="">-- Pilih Lokasi --</option>
                  {lokasiList.map(l=><option key={l.id} value={l.id}>{l.kode} {l.keterangan ? `— ${l.keterangan}` : ""}</option>)}
                </select>
                {lokasiList.length===0 && <div style={{fontSize:10,color:"#be185d",marginTop:4}}>Belum ada Blok Lokasi. Tambahkan dulu di Master Data → Master Gudang.</div>}
              </div>
              <div><label style={sty.label}>Harga Satuan (Rp)</label><input style={sty.input} type="number" inputMode="decimal" value={stockForm.price||0} onChange={e=>setStockForm(sf=>({...sf,price:Number(e.target.value)}))}/></div>
              <div><label style={sty.label}>Qty di Lokasi Ini</label><input style={sty.input} type="number" inputMode="decimal" value={stockForm.qty||0} onChange={e=>setStockForm(sf=>({...sf,qty:Number(e.target.value)}))}/></div>
              <div><label style={sty.label}>Min Qty Alert</label><input style={sty.input} type="number" inputMode="decimal" value={stockForm.minQty||0} onChange={e=>setStockForm(sf=>({...sf,minQty:Number(e.target.value)}))}/></div>
              <div>
                <label style={sty.label}>Jenis Barang</label>
                <select style={sty.select} value={stockForm.jenisBarang||"Cadang"} onChange={e=>setStockForm(sf=>({...sf,jenisBarang:e.target.value}))}>{JENIS_BARANG.map(j=><option key={j}>{j}</option>)}</select>
                {stockForm.jenisBarang==="Non-Stock" && <div style={{fontSize:10,color:"#be185d",marginTop:4}}>ℹ️ Barang khusus proyek — tidak dihitung dalam alert stok minimum</div>}
              </div>
              <div style={{gridColumn:"1/-1"}}>
                <label style={sty.label}>Foto Kondisi Barang (opsional)</label>
                {stockForm.img && <img src={stockForm.img} alt="prev" onClick={()=>setLightboxImg(stockForm.img)} style={{width:80,height:80,objectFit:"cover",borderRadius:8,marginBottom:6,border:`1px solid ${C.border}`,display:"block",cursor:"zoom-in"}}/>}
                <label style={{...sty.btn("ghost","sm"),display:"inline-block",cursor:"pointer"}}>
                  🔄 Update Gambar
                  <input type="file" accept="image/*" capture="environment" onChange={e=>handleImg(e, img=>setStockForm(sf=>({...sf,img})))} style={{display:"none"}}/>
                </label>
              </div>
              <div>
                <label style={sty.label}>Foto Nameplate {!stockForm.id?.startsWith("STK-SAP-") && "*"}</label>
                {stockForm.fotoNameplate && <img src={stockForm.fotoNameplate} alt="prev" onClick={()=>setLightboxImg(stockForm.fotoNameplate)} style={{width:80,height:80,objectFit:"cover",borderRadius:8,marginBottom:6,border:`1px solid ${C.border}`,display:"block",cursor:"zoom-in"}}/>}
                <label style={{...sty.btn("ghost","sm"),display:"inline-block",cursor:"pointer"}}>
                  🔄 Update Gambar
                  <input type="file" accept="image/*" capture="environment" onChange={e=>handleImg(e, img=>setStockForm(sf=>({...sf,fotoNameplate:img})))} style={{display:"none"}}/>
                </label>
              </div>
              <div>
                <label style={sty.label}>Foto Keseluruhan {!stockForm.id?.startsWith("STK-SAP-") && "*"}</label>
                {stockForm.fotoKeseluruhan && <img src={stockForm.fotoKeseluruhan} alt="prev" onClick={()=>setLightboxImg(stockForm.fotoKeseluruhan)} style={{width:80,height:80,objectFit:"cover",borderRadius:8,marginBottom:6,border:`1px solid ${C.border}`,display:"block",cursor:"zoom-in"}}/>}
                <label style={{...sty.btn("ghost","sm"),display:"inline-block",cursor:"pointer"}}>
                  🔄 Update Gambar
                  <input type="file" accept="image/*" capture="environment" onChange={e=>handleImg(e, img=>setStockForm(sf=>({...sf,fotoKeseluruhan:img})))} style={{display:"none"}}/>
                </label>
              </div>
              {stockForm.id?.startsWith("STK-SAP-") && (
                <div style={{gridColumn:"1/-1",fontSize:10,color:C.muted}}>ℹ️ Data hasil import SAP (PEMAT) — foto Nameplate/Keseluruhan akan disinkronkan saat import data PEMAT berikutnya, tidak wajib diisi sekarang.</div>
              )}
            </div>
            <div style={sty.stickyFooter}>
              <button style={{...sty.btn("ghost"),flex:1}} onClick={()=>setStockModal(null)}>Batal</button>
              <button style={{...sty.btn("primary"),flex:2}} onClick={saveStock}>💾 Simpan ke Cloud</button>
            </div>
          </div>
        </div>
      )}

      {/* MASTER KATALOG MODAL */}
      {katalogModal && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000}}>
          <div style={{...sty.card,width:460,maxHeight:"90vh",overflowY:"auto"}}>
            <h3 style={{fontSize:18,fontWeight:800,marginBottom:20}}>{katalogModal==="edit"?"Edit Master Katalog":"Tambah Katalog Barang Baru"}</h3>
            {/* MARA Referensi Search */}
            <div style={{marginBottom:16,background:"#f0f9ff",border:"1px solid #bae6fd",borderRadius:10,padding:12}}>
              <div style={{fontSize:12,fontWeight:800,color:"#0369a1",marginBottom:8}}>🔍 Cari Referensi MARA</div>
              <div style={{display:"flex",gap:6}}>
                <input style={{...sty.input,flex:1}} value={maraSearch} placeholder="Ketik nama material MARA (min. 2 huruf)..."
                  onChange={e=>searchMaraCatalog(e.target.value)}/>
                {maraSearch && <button style={sty.btn("ghost","sm")} onClick={()=>{setMaraSearch("");setMaraSearchResults([])}}>✕</button>}
              </div>
              {maraSearchLoading && <div style={{fontSize:11,color:"#0369a1",marginTop:6}}>Mencari...</div>}
              {maraSearchError && <div style={{fontSize:11,color:C.red,marginTop:6,padding:"6px 8px",background:"#fef2f2",borderRadius:6}}>⚠️ {maraSearchError}</div>}
              {maraSearchResults.length>0 && (
                <div style={{marginTop:8,maxHeight:180,overflowY:"auto",display:"flex",flexDirection:"column",gap:4}}>
                  {maraSearchResults.map(item=>(
                    <div key={item.kode_material} onClick={()=>applyMaraToKatalog(item)}
                      style={{padding:"6px 10px",borderRadius:7,border:"1px solid #bae6fd",background:"white",cursor:"pointer",fontSize:12,display:"flex",justifyContent:"space-between",gap:8}}
                      onMouseEnter={e=>e.currentTarget.style.background="#e0f2fe"}
                      onMouseLeave={e=>e.currentTarget.style.background="white"}>
                      <div>
                        <span style={{fontWeight:700,color:"#0369a1"}}>{item.kode_material}</span>
                        <span style={{color:"#334155",marginLeft:8}}>{item.nama}</span>
                      </div>
                      <span style={{color:"#64748b",flexShrink:0}}>{item.satuan}</span>
                    </div>
                  ))}
                </div>
              )}
              {maraSearch.length>=2 && !maraSearchLoading && maraSearchResults.length===0 && (
                <div style={{fontSize:11,color:"#64748b",marginTop:6}}>Tidak ada hasil untuk "{maraSearch}"</div>
              )}
              <div style={{fontSize:10,color:"#94a3b8",marginTop:6}}>Klik item untuk auto-fill form. MARA tersimpan di database.</div>
            </div>
            {katalogForm._maraLocked && (
              <div style={{marginBottom:12,display:"flex",justifyContent:"space-between",alignItems:"center",background:"#f0fdf4",border:"1px solid #bbf7d0",borderRadius:8,padding:"8px 10px"}}>
                <span style={{fontSize:11,color:"#166534"}}>🔒 Terkunci dari referensi MARA — Nomor Katalog, Nama, Kategori, Satuan tidak bisa diketik manual.</span>
                <button type="button" style={{...sty.btn("ghost","sm"),flexShrink:0}} onClick={()=>setKatalogForm(kf=>({...kf,_maraLocked:false}))}>🔓 Lepas Kunci</button>
              </div>
            )}
            <div style={{marginBottom:12}}>
              <label style={sty.label}>Nomor Katalog PLN</label>
              <div style={{display:"flex",gap:6}}>
                <input style={{...sty.input,...(katalogForm._maraLocked?{background:"#f3f4f6",color:C.muted}:{})}} disabled={!!katalogForm._maraLocked} value={katalogForm.katalog||""} placeholder="cth: 84618768" onChange={e=>setKatalogForm(kf=>({...kf,katalog:e.target.value}))}/>
                <button type="button" style={{...sty.btn("ghost","sm"),flexShrink:0}} disabled={!!katalogForm._maraLocked} onClick={()=>openScanner("katalogForm")}>📷</button>
              </div>
            </div>
            <div style={{marginBottom:12}}><label style={sty.label}>Nama Barang</label><input style={{...sty.input,...(katalogForm._maraLocked?{background:"#f3f4f6",color:C.muted}:{})}} disabled={!!katalogForm._maraLocked} value={katalogForm.name||""} onChange={e=>setKatalogForm(kf=>({...kf,name:e.target.value}))}/></div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:12}}>
              <div>
                <label style={sty.label}>Kategori</label>
                {katalogForm._maraLocked ? (
                  <input style={{...sty.input,background:"#f3f4f6",color:C.muted}} disabled value={katalogForm.category||"-"} title="Material Group dari MARA — bukan kategori standar aplikasi"/>
                ) : (
                  <select style={sty.select} value={katalogForm.category||"Lainnya"} onChange={e=>setKatalogForm(kf=>({...kf,category:e.target.value}))}>{CATEGORIES.map(c=><option key={c}>{c}</option>)}</select>
                )}
              </div>
              <div><label style={sty.label}>Satuan Default</label><input style={{...sty.input,...(katalogForm._maraLocked?{background:"#f3f4f6",color:C.muted}:{})}} disabled={!!katalogForm._maraLocked} value={katalogForm.satuan||""} placeholder="cth: unit, pcs, roll" onChange={e=>setKatalogForm(kf=>({...kf,satuan:e.target.value}))}/></div>
            </div>
            <div style={{display:"flex",gap:10,marginTop:20}}>
              <button style={{...sty.btn("ghost"),flex:1}} onClick={()=>setKatalogModal(null)}>Batal</button>
              <button style={{...sty.btn("primary"),flex:2}} onClick={saveKatalog}>💾 Simpan ke Cloud</button>
            </div>
          </div>
        </div>
      )}

      {/* USULAN BLOK DARI DENAH — popup terpusat, supaya tidak perlu scroll naik-turun ke peta */}
      {currentUser.role==="ADMIN" && ocrSuggestGudangId && ocrSuggestions.length>0 && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1100}}>
          <div style={{...sty.card,width:520,maxHeight:"85vh",overflowY:"auto"}}>
            <h3 style={{fontSize:18,fontWeight:800,marginBottom:6}}>📋 Usulan Blok dari Denah {ocrSuggestSubGudangId?"(Sub Gudang)":"(Gudang)"} ({ocrSuggestions.length})</h3>
            <p style={{fontSize:12,color:C.muted,marginBottom:16}}>Lengkapi data tiap usulan, lalu konfirmasi untuk mengirim ke approval TL.</p>
            <div style={{display:"flex",flexDirection:"column",gap:12,marginBottom:16}}>
              {ocrSuggestions.map(s=>(
                <div key={s.id} style={{border:`1px solid ${C.border}`,borderRadius:8,padding:12,background:s.checked?"#fefce8":"#f9fafb"}}>
                  <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}>
                    <input type="checkbox" checked={s.checked} onChange={e=>updateOcrSuggestion(s.id,{checked:e.target.checked})}/>
                    <span style={{fontSize:11,color:C.muted}}>Posisi: {s.xPct}%, {s.yPct}%</span>
                    <button style={{...sty.btn("danger","sm"),marginLeft:"auto"}} onClick={()=>removeOcrSuggestion(s.id)}>🗑️ Hapus</button>
                  </div>
                  <div style={{marginBottom:8}}>
                    <label style={sty.label}>Nama Area <span style={{color:C.red}}>*wajib</span></label>
                    <input style={sty.input} value={s.kode} placeholder="cth: Rak A-1" onChange={e=>updateOcrSuggestion(s.id,{kode:e.target.value})}/>
                  </div>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                    <div>
                      <label style={sty.label}>Jenis Area Penyimpanan</label>
                      <select style={sty.select} value={s.jenisArea||"Rak Tertutup"} onChange={e=>updateOcrSuggestion(s.id,{jenisArea:e.target.value})}>
                        <option value="Rak Tertutup">Rak Tertutup</option>
                        <option value="Rak Terbuka">Rak Terbuka</option>
                        <option value="Lapangan Terbuka">Lapangan Terbuka</option>
                        <option value="Gudang Tertutup">Gudang Tertutup</option>
                        <option value="Container">Container</option>
                        <option value="Lainnya">Lainnya</option>
                      </select>
                    </div>
                    <div>
                      <label style={sty.label}>Luasan (m²)</label>
                      <input style={sty.input} type="number" inputMode="decimal" value={s.luasan||""} placeholder="cth: 12" onChange={e=>updateOcrSuggestion(s.id,{luasan:e.target.value})}/>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div style={{display:"flex",gap:10}}>
              <button style={{...sty.btn("ghost"),flex:1}} onClick={dismissOcrSuggestions}>Lewati Semua</button>
              <button style={{...sty.btn("primary"),flex:2}} onClick={()=>confirmOcrSuggestions(ocrSuggestGudangId, ocrSuggestSubGudangId)}>✓ Konfirmasi & Tambahkan Blok Terpilih</button>
            </div>
          </div>
        </div>
      )}

      {/* MASTER LOKASI MODAL */}
      {lokasiModal && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000}}>
          <div style={{...sty.card,width:420}}>
            <h3 style={{fontSize:18,fontWeight:800,marginBottom:20}}>{lokasiModal==="edit"?"Edit Master Lokasi":"Tambah Lokasi Gudang Baru"}</h3>
            {gudangList.length===0 ? (
              <div style={{background:"#fef3c7",border:`1px solid #fcd34d`,borderRadius:8,padding:"10px 12px",fontSize:12,color:"#92400e",marginBottom:16}}>⚠️ Belum ada Master Gudang. Tambahkan Gudang dulu di menu "Master Data" → "Master Gudang" sebelum bisa mengisi Blok — data harus berjenjang: Gudang dulu, baru Blok.</div>
            ) : (
              <div style={{background:"#dbeafe",border:`1px solid #93c5fd`,borderRadius:8,padding:"10px 12px",fontSize:12,color:"#1e40af",marginBottom:16}}>ℹ️ Pilih Gudang dulu, baru isi data Blok-nya (berjenjang).</div>
            )}
            <div style={{marginBottom:12}}>
              <label style={sty.label}>Gudang *</label>
              <select style={sty.select} value={lokasiForm.gudangId||""} disabled={gudangList.length===0} onChange={e=>setLokasiForm(lf=>({...lf,gudangId:e.target.value||null,subGudangId:null}))}>
                <option value="">-- Pilih Gudang --</option>
                {gudangList.map(g=><option key={g.id} value={g.id}>{g.nama}</option>)}
              </select>
            </div>
            {lokasiForm.gudangId && (
              <div style={{marginBottom:12}}>
                <label style={sty.label}>Sub Gudang</label>
                <select style={sty.select} value={lokasiForm.subGudangId||""} onChange={e=>setLokasiForm(lf=>({...lf,subGudangId:e.target.value||null}))}>
                  <option value="">-- Umum / Tidak ada Sub Gudang --</option>
                  {subGudangList.filter(sg=>sg.gudangId===lokasiForm.gudangId).map(sg=><option key={sg.id} value={sg.id}>{sg.nama}</option>)}
                </select>
              </div>
            )}
            <div style={{marginBottom:12}}><label style={sty.label}>Kode Lokasi (Blok)</label><input style={sty.input} value={lokasiForm.kode||""} placeholder="cth: Rak A-1" disabled={!lokasiForm.gudangId} onChange={e=>setLokasiForm(lf=>({...lf,kode:e.target.value}))}/></div>
            <div style={{marginBottom:12}}><label style={sty.label}>Keterangan Area</label><input style={sty.input} value={lokasiForm.keterangan||""} placeholder="cth: Area Transformator" disabled={!lokasiForm.gudangId} onChange={e=>setLokasiForm(lf=>({...lf,keterangan:e.target.value}))}/></div>
            <div style={{marginBottom:12}}><label style={sty.label}>Kapasitas Maksimal</label><input style={sty.input} type="number" inputMode="decimal" value={lokasiForm.kapasitas||0} disabled={!lokasiForm.gudangId} onChange={e=>setLokasiForm(lf=>({...lf,kapasitas:Number(e.target.value)}))}/></div>
            <div style={{display:"flex",gap:10,marginTop:20}}>
              <button style={{...sty.btn("ghost"),flex:1}} onClick={()=>setLokasiModal(null)}>Batal</button>
              <button style={{...sty.btn("primary"),flex:2}} disabled={!lokasiForm.gudangId} onClick={saveLokasi}>💾 Simpan ke Cloud</button>
            </div>
          </div>
        </div>
      )}

      {/* SATPAM MODAL */}
      {satpamModal && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000}}>
          <div style={{...sty.card,width:400}}>
            <h3 style={{fontSize:18,fontWeight:800,marginBottom:20}}>{satpamModal==="edit"?"Edit Satpam":"Tambah Satpam Baru"}</h3>
            <div style={{marginBottom:12}}>
              <label style={sty.label}>Nama Satpam</label>
              <input style={sty.input} value={satpamForm.name||""} onChange={e=>setSatpamForm(sf=>({...sf,name:e.target.value}))} placeholder="cth: Robby Demas Riady"/>
            </div>
            <div style={{marginBottom:12}}>
              <label style={sty.label}>No. Telepon (opsional)</label>
              <input style={sty.input} value={satpamForm.telp||""} onChange={e=>setSatpamForm(sf=>({...sf,telp:e.target.value}))} placeholder="08xxxxxxxxxx"/>
            </div>
            <div style={{display:"flex",gap:10,marginTop:20}}>
              <button style={{...sty.btn("ghost"),flex:1}} onClick={()=>setSatpamModal(null)}>Batal</button>
              <button style={{...sty.btn("primary"),flex:2}} onClick={saveSatpam}>💾 Simpan ke Cloud</button>
            </div>
          </div>
        </div>
      )}

      {/* TIM MUTU MODAL — edit anggota paket tetap (tidak bisa tambah/hapus paket) */}
      {timMutuModal && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000}}>
          <div style={{...sty.card,width:420}}>
            <h3 style={{fontSize:18,fontWeight:800,marginBottom:6}}>Edit {timMutuForm.label}</h3>
            <p style={{fontSize:12,color:C.muted,marginBottom:16}}>Paket tim ini tetap (tidak bisa diganti namanya) — hanya anggotanya yang bisa diedit.</p>
            <div style={{marginBottom:12}}>
              <label style={sty.label}>Ketua</label>
              <input style={sty.input} value={timMutuForm.ketua||""} onChange={e=>setTimMutuForm(tf=>({...tf,ketua:e.target.value}))}/>
            </div>
            <div style={{marginBottom:12}}>
              <label style={sty.label}>Sekretaris</label>
              <input style={sty.input} value={timMutuForm.sekretaris||""} onChange={e=>setTimMutuForm(tf=>({...tf,sekretaris:e.target.value}))}/>
            </div>
            <div style={{marginBottom:12}}>
              <label style={sty.label}>Anggota 1</label>
              <input style={sty.input} value={timMutuForm.anggota1||""} onChange={e=>setTimMutuForm(tf=>({...tf,anggota1:e.target.value}))}/>
            </div>
            <div style={{marginBottom:12}}>
              <label style={sty.label}>Anggota 2</label>
              <input style={sty.input} value={timMutuForm.anggota2||""} onChange={e=>setTimMutuForm(tf=>({...tf,anggota2:e.target.value}))}/>
            </div>
            <div style={{marginBottom:12}}>
              <label style={sty.label}>Anggota 3</label>
              <input style={sty.input} value={timMutuForm.anggota3||""} onChange={e=>setTimMutuForm(tf=>({...tf,anggota3:e.target.value}))}/>
            </div>
            <div style={{display:"flex",gap:10,marginTop:20}}>
              <button style={{...sty.btn("ghost"),flex:1}} onClick={()=>setTimMutuModal(null)}>Batal</button>
              <button style={{...sty.btn("primary"),flex:2}} onClick={saveTimMutu}>💾 Simpan ke Cloud</button>
            </div>
          </div>
        </div>
      )}

      {/* KARTU GANTUNG DIGITAL DETAIL MODAL */}
      {/* DETAIL DATA STOK — klik baris di tabel Data Stok, termasuk foto Nameplate + Foto Keseluruhan */}
      {stockDetailId && (() => {
        const st = stocks.find(s=>s.id===stockDetailId);
        if (!st) return null;
        const kat = katalogList.find(k=>k.id===st.katalogId);
        const lok = lokasiList.find(l=>l.id===st.lokasiId);
        const gdg = lok?.gudangId ? gudangList.find(g=>g.id===lok.gudangId) : null;
        const canUploadFoto = ["ADMIN","TL"].includes(currentUser.role);
        const isSAP = st.id?.startsWith("STK-SAP-");
        const bs = getSAPBadgeStyle(st.katalog);
        const fotoBox = (label, field) => {
          const previewImg = pendingFoto[field] ?? st[field];
          const hasUnsaved = pendingFoto[field] != null;
          return (
            <div style={{flex:1,minWidth:160}}>
              <div style={{fontSize:11,fontWeight:700,marginBottom:6}}>{label} {!isSAP && "*"}</div>
              {previewImg ? (
                <img src={previewImg} alt={label} onClick={()=>setLightboxImg(previewImg)} style={{width:"100%",height:140,objectFit:"cover",borderRadius:8,border:`1px solid ${hasUnsaved?"#f59e0b":C.border}`,cursor:"zoom-in"}}/>
              ) : (
                <div style={{width:"100%",height:140,background:"#f3f4f6",borderRadius:8,border:`1px dashed ${C.border}`,display:"flex",alignItems:"center",justifyContent:"center",color:C.muted,fontSize:11,textAlign:"center",padding:8}}>
                  {isSAP ? "Belum ada foto (data SAP — akan disinkronkan saat import PEMAT)" : "⚠️ Belum ada foto"}
                </div>
              )}
              {canUploadFoto && (
                <>
                  <label style={{...sty.btn("ghost","sm"),display:"block",textAlign:"center",marginTop:6,cursor:"pointer"}}>
                    🔄 Update Gambar
                    <input type="file" accept="image/*" capture="environment" style={{display:"none"}}
                      onChange={e=>handleImg(e, img=>setPendingFoto(p=>({...p,[field]:img})))}/>
                  </label>
                  {hasUnsaved && (
                    <div style={{display:"flex",gap:6,marginTop:6}}>
                      <button style={{...sty.btn("primary","sm"),flex:1}} onClick={async()=>{
                        await updateStockFoto(st.id, field, pendingFoto[field]);
                        setPendingFoto(p=>{const n={...p}; delete n[field]; return n;});
                      }}>💾 Simpan Foto</button>
                      <button style={{...sty.btn("ghost","sm")}} onClick={()=>setPendingFoto(p=>{const n={...p}; delete n[field]; return n;})}>Batal</button>
                    </div>
                  )}
                  {hasUnsaved && <div style={{fontSize:9,color:"#92400e",marginTop:4}}>⚠️ Belum disimpan — klik "Simpan Foto" untuk memastikan tersimpan di sistem.</div>}
                </>
              )}
            </div>
          );
        };
        return (
          <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.6)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1500,padding:20}} onClick={()=>{setStockDetailId(null); setPendingFoto({});}}>
            <div style={{...sty.card,width:560,maxHeight:"90vh",overflowY:"auto"}} onClick={e=>e.stopPropagation()}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:14}}>
                <div>
                  <h3 style={{fontSize:16,fontWeight:800}}>{st.name}</h3>
                  <p style={{fontSize:11,color:"#0098da",fontWeight:700,marginTop:2}}>📑 {st.katalog||kat?.katalog||"-"}</p>
                </div>
                <button style={{background:"#dc2626",color:"white",border:"none",borderRadius:8,padding:"6px 14px",cursor:"pointer",fontSize:12}} onClick={()=>{setStockDetailId(null); setPendingFoto({});}}>✕</button>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:16,fontSize:12}}>
                <div><b>Kategori:</b> {st.category||"-"}</div>
                <div><b>Jenis:</b> <span style={sty.jenisBadge(st.jenisBarang)}>{st.jenisBarang}</span></div>
                <div><b>Qty:</b> {fmtNum(st.qty)} {st.unit}</div>
                <div><b>Min Qty:</b> {fmtNum(st.minQty)} {st.unit}</div>
                <div><b>Gudang:</b> {gdg?.kode||gdg?.nama||"—"}</div>
                <div><b>Blok:</b> {lok?.kode||"—"}</div>
                <div><b>Harga:</b> Rp {fmtNum(st.price)}</div>
                <div><b>Status:</b> <span style={{padding:"2px 7px",borderRadius:20,fontSize:10,fontWeight:700,background:bs.bg,color:bs.fg}}>{getSAPLabel(st.katalog)}</span></div>
              </div>
              <div style={{display:"flex",gap:12,flexWrap:"wrap"}}>
                {fotoBox("Foto Nameplate", "fotoNameplate")}
                {fotoBox("Foto Keseluruhan", "fotoKeseluruhan")}
              </div>
              {!canUploadFoto && <div style={{fontSize:10,color:C.muted,marginTop:10}}>Hanya Admin/TL yang bisa mengunggah/mengganti foto.</div>}
              <div style={{marginTop:16,paddingTop:14,borderTop:`1px solid ${C.border}`}}>
                <button style={{...sty.btn("ghost"),width:"100%",borderColor:"#e0f2fe",color:"#0369a1"}}
                  onClick={()=>{ if(kat) setKartuGantungDetail(kat); }}>🏷️ Lihat Kartu Gantung (TUG-2)</button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* LIGHTBOX — overview foto full-screen, klik foto kecil mana saja di Data Stok */}
      {lightboxImg && (
        <div onClick={()=>setLightboxImg(null)} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.85)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:2000,padding:20,cursor:"zoom-out"}}>
          <img src={lightboxImg} alt="Overview" style={{maxWidth:"90vw",maxHeight:"90vh",objectFit:"contain",borderRadius:8}}/>
          <button style={{position:"fixed",top:20,right:20,background:"#dc2626",color:"white",border:"none",borderRadius:8,padding:"8px 16px",cursor:"pointer",fontSize:14}} onClick={()=>setLightboxImg(null)}>✕ Tutup</button>
        </div>
      )}

      {/* PETA MINI MODAL — dari card Data Stok */}
      {petaMiniDetail && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.6)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1500,padding:20}}>
          <div style={{...sty.card,width:560,maxHeight:"90vh",overflowY:"auto"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
              <div>
                <h3 style={{fontSize:16,fontWeight:800}}>📍 Lokasi di Peta Gudang</h3>
                <p style={{fontSize:11,color:C.muted}}>{petaMiniDetail.gudang.nama} — Blok: {petaMiniDetail.lokasi.kode} {petaMiniDetail.lokasi.nama}</p>
              </div>
              <button style={{background:"#dc2626",color:"white",border:"none",borderRadius:8,padding:"6px 14px",cursor:"pointer",fontSize:12}} onClick={()=>setPetaMiniDetail(null)}>✕</button>
            </div>
            <div style={{position:"relative",width:"100%"}}>
              <img src={petaMiniDetail.gudang.denahImageData} alt="Denah" style={{width:"100%",borderRadius:8,display:"block",filter:"brightness(0.7)"}}/>
              {/* Semua blok lain — abu */}
              {(petaMiniDetail.gudang ? lokasiList.filter(l=>l.gudangId===petaMiniDetail.gudang.id&&l.mapX!=null&&l.id!==petaMiniDetail.lokasi.id) : []).map(l=>(
                <div key={l.id} style={{position:"absolute",left:`${l.mapX}%`,top:`${l.mapY}%`,transform:"translate(-50%,-50%)",width:10,height:10,borderRadius:"50%",background:"#9ca3af",border:"1px solid white",opacity:0.6}}/>
              ))}
              {/* Titik merah — lokasi barang ini */}
              {petaMiniDetail.lokasi.mapX!=null && (
                <div style={{position:"absolute",left:`${petaMiniDetail.lokasi.mapX}%`,top:`${petaMiniDetail.lokasi.mapY}%`,transform:"translate(-50%,-50%)"}}>
                  <div style={{width:18,height:18,borderRadius:"50%",background:"#dc2626",border:"3px solid white",boxShadow:"0 0 0 3px rgba(220,38,38,0.4)",animation:"pulse 1.5s infinite"}}/>
                  <div style={{position:"absolute",top:-24,left:"50%",transform:"translateX(-50%)",background:"#dc2626",color:"white",fontSize:9,fontWeight:700,padding:"2px 6px",borderRadius:4,whiteSpace:"nowrap"}}>{petaMiniDetail.lokasi.kode}</div>
                </div>
              )}
            </div>
            <style>{`@keyframes pulse{0%,100%{box-shadow:0 0 0 3px rgba(220,38,38,0.4)}50%{box-shadow:0 0 0 8px rgba(220,38,38,0)}}`}</style>
          </div>
        </div>
      )}
      {kartuGantungDetail && (
        <KartuGantungModal
          katalog={kartuGantungDetail}
          stocks={stocks} txns={txns} lokasiList={lokasiList}
          sty={sty} C={C}
          onClose={()=>setKartuGantungDetail(null)}
        />
      )}

      {/* UIT MODAL */}
      {/* IMPORT SAP MODAL */}
      {importSAPModal && (
        <ImportSAPModal
          lokasiList={lokasiList}
          sty={sty} C={C}
          onImport={importFromSAP}
          onClose={()=>setImportSAPModal(false)}
        />
      )}

      {/* GUDANG MODAL — mode "edit" satu langkah; mode "add" wizard 3 langkah (Data → Denah → Blok) */}
      {gudangModal==="edit" && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000}}>
          <div style={{...sty.card,width:460}}>
            <h3 style={{fontSize:18,fontWeight:800,marginBottom:20}}>Edit Gudang</h3>
            <div style={{marginBottom:12}}><label style={sty.label}>Kode Gudang</label><input style={sty.input} value={gudangForm.kode||""} onChange={e=>setGudangForm(f=>({...f,kode:e.target.value}))} placeholder="cth: GTK"/></div>
            <div style={{marginBottom:12}}><label style={sty.label}>Nama Gudang</label><input style={sty.input} value={gudangForm.nama||""} onChange={e=>setGudangForm(f=>({...f,nama:e.target.value}))} placeholder="cth: Gudang Ketintang"/></div>
            <div style={{marginBottom:12}}>
              <label style={sty.label}>Alamat (format Google Maps)</label>
              <input style={sty.input} value={gudangForm.alamat||""} onChange={e=>{
                const val = e.target.value;
                const r = extractLatLngFromAddress(val);
                setGudangForm(f=>({...f, alamat:val, lat:r?r.lat:f.lat, lng:r?r.lng:f.lng}));
              }} placeholder="cth: MRR6+9M Wonorejo, Surabaya, East Java"/>
              <div style={{fontSize:10,color:C.muted,marginTop:3}}>Tempel alamat persis seperti format Google Maps (kode + area) — koordinat untuk Peta Wilayah otomatis terisi, tidak perlu diisi manual.</div>
            </div>
            <div style={{marginBottom:16}}>
              <label style={sty.label}>UPT</label>
              <select style={sty.select} value={gudangForm.uptId||""} onChange={e=>setGudangForm(f=>({...f,uptId:e.target.value}))}>
                <option value="">-- Pilih UPT --</option>
                {uptList.map(u=><option key={u.id} value={u.id}>{u.kode} — {u.nama}</option>)}
              </select>
            </div>
            <div style={{display:"flex",gap:10}}><button style={{...sty.btn("ghost"),flex:1}} onClick={()=>setGudangModal(null)}>Batal</button><button style={{...sty.btn("primary"),flex:2}} onClick={saveGudang}>💾 Simpan</button></div>
          </div>
        </div>
      )}

      {gudangModal==="add" && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000}}>
          <div style={{...sty.card,width:540,maxHeight:"90vh",overflowY:"auto"}}>
            <div style={{display:"flex",gap:6,marginBottom:18}}>
              {[1,2,3].map(n=>(
                <div key={n} style={{flex:1,height:4,borderRadius:4,background:gudangWizardStep>=n?C.accent:C.border}}/>
              ))}
            </div>

            {/* STEP 1: Data Gudang */}
            {gudangWizardStep===1 && (
              <div>
                <h3 style={{fontSize:18,fontWeight:800,marginBottom:6}}>Tambah Gudang Baru</h3>
                <p style={{fontSize:12,color:C.muted,marginBottom:16}}>Langkah 1 dari 3 — Data Gudang</p>
                <div style={{marginBottom:12}}><label style={sty.label}>Kode Gudang</label><input style={sty.input} value={gudangForm.kode||""} onChange={e=>setGudangForm(f=>({...f,kode:e.target.value}))} placeholder="cth: GTK"/></div>
                <div style={{marginBottom:12}}><label style={sty.label}>Nama Gudang</label><input style={sty.input} value={gudangForm.nama||""} onChange={e=>setGudangForm(f=>({...f,nama:e.target.value}))} placeholder="cth: Gudang Ketintang"/></div>
                <div style={{marginBottom:12}}>
                  <label style={sty.label}>Alamat (format Google Maps)</label>
                  <input style={sty.input} value={gudangForm.alamat||""} onChange={e=>{
                    const val = e.target.value;
                    const r = extractLatLngFromAddress(val);
                    setGudangForm(f=>({...f, alamat:val, lat:r?r.lat:f.lat, lng:r?r.lng:f.lng}));
                  }} placeholder="cth: MRR6+9M Wonorejo, Surabaya, East Java"/>
                  <div style={{fontSize:10,color:C.muted,marginTop:3}}>Tempel alamat persis seperti format Google Maps (kode + area) — koordinat untuk Peta Wilayah otomatis terisi, tidak perlu diisi manual.</div>
                </div>
                <div style={{marginBottom:16}}>
                  <label style={sty.label}>UPT</label>
                  <select style={sty.select} value={gudangForm.uptId||""} onChange={e=>setGudangForm(f=>({...f,uptId:e.target.value}))}>
                    <option value="">-- Pilih UPT --</option>
                    {uptList.map(u=><option key={u.id} value={u.id}>{u.kode} — {u.nama}</option>)}
                  </select>
                </div>
                <div style={{display:"flex",gap:10}}>
                  <button style={{...sty.btn("ghost"),flex:1}} onClick={closeGudangWizard}>Batal</button>
                  <button style={{...sty.btn("primary"),flex:2}} onClick={gudangWizardNext}>Lanjut: Upload Denah →</button>
                </div>
              </div>
            )}

            {/* STEP 2: Upload Denah */}
            {gudangWizardStep===2 && (() => {
              const g = gudangList.find(x=>x.id===gudangForm.id);
              return (
                <div>
                  <h3 style={{fontSize:18,fontWeight:800,marginBottom:6}}>Upload Denah Gudang</h3>
                  <p style={{fontSize:12,color:C.muted,marginBottom:16}}>Langkah 2 dari 3 — Opsional, tapi disarankan supaya bisa menambahkan blok di peta.</p>
                  <div style={{fontSize:10,color:C.muted,marginBottom:8}}>💡 Convert PDF denah ke gambar terlebih dahulu (screenshot, foto, atau export dari PDF viewer)</div>
                  <input type="file" accept="image/*" capture="environment" onChange={e=>{const f=e.target.files[0]; if(f) uploadDenahGudang(gudangForm.id,f);}} style={{fontSize:11,color:C.muted}}/>
                  {denahLoading && <div style={{fontSize:11,color:"#1d4ed8",marginTop:8}}>⏳ Mengompres, menyimpan, dan membaca label di gambar (OCR)...</div>}
                  {g?.denahImageData && !denahLoading && (
                    <div style={{marginTop:12}}>
                      <img src={g.denahImageData} alt="Denah Gudang" style={{width:"100%",maxHeight:220,objectFit:"contain",borderRadius:6,border:`1px solid ${C.border}`}}/>
                    </div>
                  )}
                  <div style={{display:"flex",gap:10,marginTop:18}}>
                    <button style={{...sty.btn("ghost"),flex:1}} onClick={closeGudangWizard}>Lewati, Selesai</button>
                    <button style={{...sty.btn("primary"),flex:2}} disabled={!g?.denahImageData} onClick={()=>setGudangWizardStep(3)}>Lanjut: Tambah Blok →</button>
                  </div>
                </div>
              );
            })()}

            {/* STEP 3: Tambah Blok (klik titik di denah) */}
            {gudangWizardStep===3 && (() => {
              const g = gudangList.find(x=>x.id===gudangForm.id);
              const bloklokasi = lokasiList.filter(l=>l.gudangId===gudangForm.id);
              return (
                <div>
                  <h3 style={{fontSize:18,fontWeight:800,marginBottom:6}}>Tambah Blok Lokasi</h3>
                  <p style={{fontSize:12,color:C.muted,marginBottom:12}}>Langkah 3 dari 3 — Klik titik di denah untuk menambah blok. Kode diusulkan otomatis dari OCR, bisa diedit.</p>

                  {/* Catatan: panel usulan blok dari OCR sekarang tampil sebagai popup terpusat (lihat USULAN BLOK DARI DENAH di luar wizard ini) */}

                  {g?.denahImageData ? (
                    <div style={{position:"relative",cursor:"crosshair",display:"inline-block",width:"100%"}}
                      onClick={e=>{
                        const rect = e.currentTarget.getBoundingClientRect();
                        const xPct = Number(((e.clientX - rect.left) / rect.width * 100).toFixed(1));
                        const yPct = Number(((e.clientY - rect.top) / rect.height * 100).toFixed(1));
                        const kodeUsulan = suggestKodeFromOcr(g, xPct, yPct) || `${g.kode||"BLOK"}-${String(bloklokasi.length+1).padStart(2,"0")}`;
                        setWizardBlokDraft({ kode:kodeUsulan, keterangan:"", kapasitas:50, xPct, yPct });
                      }}>
                      <img src={g.denahImageData} alt="Denah" style={{width:"100%",borderRadius:6,border:`2px dashed #3b82f6`,display:"block"}}/>
                      {bloklokasi.filter(l=>l.mapX!=null).map(l=>(
                        <div key={l.id} title={l.kode} style={{position:"absolute",left:`${l.mapX}%`,top:`${l.mapY}%`,transform:"translate(-50%,-50%)",width:14,height:14,borderRadius:"50%",background:l.status==="PENDING"?"#9ca3af":"#dc2626",border:l.status==="PENDING"?"2px dashed white":"2px solid white",boxShadow:"0 1px 4px rgba(0,0,0,0.4)"}}/>
                      ))}
                      {wizardBlokDraft && (
                        <div style={{position:"absolute",left:`${wizardBlokDraft.xPct}%`,top:`${wizardBlokDraft.yPct}%`,transform:"translate(-50%,-50%)",width:16,height:16,borderRadius:"50%",background:"#22c55e",border:"2px solid white",boxShadow:"0 1px 4px rgba(0,0,0,0.4)"}}/>
                      )}
                    </div>
                  ) : <div style={{fontSize:12,color:C.muted,fontStyle:"italic"}}>Denah belum tersedia.</div>}

                  {wizardBlokDraft && (
                    <div style={{background:"#eff6ff",border:`1px solid #bfdbfe`,borderRadius:8,padding:12,marginTop:12}} onClick={e=>e.stopPropagation()}>
                      <div style={{marginBottom:8}}><label style={sty.label}>Kode Blok</label><input style={sty.input} value={wizardBlokDraft.kode} onChange={e=>setWizardBlokDraft(d=>({...d,kode:e.target.value}))}/></div>
                      <div style={{marginBottom:8}}><label style={sty.label}>Keterangan Area</label><input style={sty.input} value={wizardBlokDraft.keterangan} onChange={e=>setWizardBlokDraft(d=>({...d,keterangan:e.target.value}))}/></div>
                      <div style={{marginBottom:10}}><label style={sty.label}>Kapasitas Maksimal</label><input style={sty.input} type="number" inputMode="decimal" value={wizardBlokDraft.kapasitas} onChange={e=>setWizardBlokDraft(d=>({...d,kapasitas:Number(e.target.value)}))}/></div>
                      <div style={{display:"flex",gap:8}}>
                        <button style={{...sty.btn("ghost","sm"),flex:1}} onClick={()=>setWizardBlokDraft(null)}>Batal</button>
                        <button style={{...sty.btn("primary","sm"),flex:2}} onClick={addWizardBlok}>✓ Tambah Blok Ini</button>
                      </div>
                    </div>
                  )}

                  <div style={{fontSize:12,color:C.muted,marginTop:14}}>Blok di gudang ini: {bloklokasi.length}</div>
                  <div style={{display:"flex",gap:10,marginTop:10}}>
                    <button style={{...sty.btn("primary"),flex:1}} onClick={closeGudangWizard}>✓ Selesai</button>
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {/* MATURITY ASSESSMENT MODAL — input manual Admin untuk Dashboard */}
      {maturityModal && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000}}>
          <div style={{...sty.card,width:460}}>
            <h3 style={{fontSize:18,fontWeight:800,marginBottom:20}}>🏆 Asesmen Maturity Level Baru</h3>
            <div style={{marginBottom:12}}>
              <label style={sty.label}>Level (1-5)</label>
              <select style={sty.select} value={maturityForm.level} onChange={e=>setMaturityForm(f=>({...f,level:Number(e.target.value)}))}>
                {[1,2,3,4,5].map(lv=><option key={lv} value={lv}>Level {lv} — {MATURITY_LEVELS[lv]}</option>)}
              </select>
            </div>
            <div style={{marginBottom:12}}>
              <label style={sty.label}>Tanggal Asesmen</label>
              <input style={sty.input} type="date" value={new Date(maturityForm.tanggalAsesmen).toISOString().slice(0,10)} onChange={e=>setMaturityForm(f=>({...f,tanggalAsesmen:new Date(e.target.value).getTime()}))}/>
            </div>
            <div style={{marginBottom:16}}>
              <label style={sty.label}>Catatan (opsional)</label>
              <textarea style={{...sty.input,minHeight:70}} value={maturityForm.catatan} onChange={e=>setMaturityForm(f=>({...f,catatan:e.target.value}))} placeholder="cth: Hasil audit internal triwulan II"/>
            </div>
            <div style={{display:"flex",gap:10}}>
              <button style={{...sty.btn("ghost"),flex:1}} onClick={()=>setMaturityModal(false)}>Batal</button>
              <button style={{...sty.btn("primary"),flex:2}} onClick={async()=>{await saveMaturityAssessment(maturityForm); setMaturityModal(false);}}>💾 Simpan</button>
            </div>
          </div>
        </div>
      )}

      {uitModal && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000}}>
          <div style={{...sty.card,width:440}}>
            <h3 style={{fontSize:18,fontWeight:800,marginBottom:20}}>{uitModal==="edit"?"Edit UIT":"Tambah UIT Baru"}</h3>
            <div style={{marginBottom:12}}><label style={sty.label}>Kode UIT</label><input style={sty.input} value={uitForm.kode||""} onChange={e=>setUitForm(f=>({...f,kode:e.target.value}))} placeholder="cth: UIT-JBM"/></div>
            <div style={{marginBottom:12}}><label style={sty.label}>Nama Lengkap UIT</label><input style={sty.input} value={uitForm.nama||""} onChange={e=>setUitForm(f=>({...f,nama:e.target.value}))} placeholder="cth: PT PLN (PERSERO) UNIT INDUK TRANSMISI JAWA BAGIAN TIMUR DAN BALI"/></div>
            <div style={{marginBottom:16}}><label style={sty.label}>Alamat</label><input style={sty.input} value={uitForm.alamat||""} onChange={e=>setUitForm(f=>({...f,alamat:e.target.value}))}/></div>
            <div style={{display:"flex",gap:10}}><button style={{...sty.btn("ghost"),flex:1}} onClick={()=>setUitModal(null)}>Batal</button><button style={{...sty.btn("primary"),flex:2}} onClick={saveUIT}>💾 Simpan</button></div>
          </div>
        </div>
      )}

      {/* UPT MODAL */}
      {uptModal && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000}}>
          <div style={{...sty.card,width:440}}>
            <h3 style={{fontSize:18,fontWeight:800,marginBottom:20}}>{uptModal==="edit"?"Edit UPT":"Tambah UPT Baru"}</h3>
            <div style={{marginBottom:12}}><label style={sty.label}>Kode UPT</label><input style={sty.input} value={uptForm.kode||""} onChange={e=>setUptForm(f=>({...f,kode:e.target.value}))} placeholder="cth: UPT-MLG"/></div>
            <div style={{marginBottom:12}}><label style={sty.label}>Nama UPT</label><input style={sty.input} value={uptForm.nama||""} onChange={e=>setUptForm(f=>({...f,nama:e.target.value}))} placeholder="cth: UPT Malang"/></div>
            <div style={{marginBottom:12}}><label style={sty.label}>Alamat</label><input style={sty.input} value={uptForm.alamat||""} onChange={e=>setUptForm(f=>({...f,alamat:e.target.value}))}/></div>
            <div style={{marginBottom:16}}>
              <label style={sty.label}>Unit Induk (UIT)</label>
              <select style={sty.select} value={uptForm.uitId||""} onChange={e=>setUptForm(f=>({...f,uitId:e.target.value}))}>
                <option value="">-- Pilih UIT --</option>
                {uitList.map(u=><option key={u.id} value={u.id}>{u.kode} — {u.nama}</option>)}
              </select>
            </div>
            <div style={{display:"flex",gap:10}}><button style={{...sty.btn("ghost"),flex:1}} onClick={()=>setUptModal(null)}>Batal</button><button style={{...sty.btn("primary"),flex:2}} onClick={saveUPT}>💾 Simpan</button></div>
          </div>
        </div>
      )}

      {/* ULTG MODAL */}
      {ultgModal && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000}}>
          <div style={{...sty.card,width:440}}>
            <h3 style={{fontSize:18,fontWeight:800,marginBottom:20}}>{ultgModal==="edit"?"Edit ULTG":"Tambah ULTG Baru"}</h3>
            <div style={{marginBottom:12}}><label style={sty.label}>Kode ULTG</label><input style={sty.input} value={ultgForm.kode||""} onChange={e=>setUltgForm(f=>({...f,kode:e.target.value}))} placeholder="cth: ULTG-SBU"/></div>
            <div style={{marginBottom:12}}><label style={sty.label}>Nama ULTG</label><input style={sty.input} value={ultgForm.nama||""} onChange={e=>setUltgForm(f=>({...f,nama:e.target.value}))} placeholder="cth: ULTG Surabaya Utara"/></div>
            <div style={{marginBottom:16}}>
              <label style={sty.label}>UPT Induk *</label>
              <select style={sty.select} value={ultgForm.parentUptId||""} onChange={e=>setUltgForm(f=>({...f,parentUptId:e.target.value}))}>
                <option value="">-- Pilih UPT --</option>
                {uptList.map(u=><option key={u.id} value={u.id}>{u.kode} — {u.nama}</option>)}
              </select>
            </div>
            <div style={{display:"flex",gap:10}}><button style={{...sty.btn("ghost"),flex:1}} onClick={()=>setUltgModal(null)}>Batal</button><button style={{...sty.btn("primary"),flex:2}} onClick={saveULTG}>💾 Simpan</button></div>
          </div>
        </div>
      )}

      {/* TXN MODAL - TUG5 FORM */}
      {txnModal && txnForm && txnForm.docType==="TUG5" && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000,padding:20}}>
          <div style={{...sty.card,width:700,maxHeight:"92vh",overflowY:"auto"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
              <h3 style={{fontSize:18,fontWeight:800}}>Formulir TUG-5 — Daftar Permintaan Barang</h3>
              <span style={{fontSize:11,color:"#0098da",fontWeight:700}}>No: {docSeq}.TUG-5/...</span>
            </div>
            {txnForm.sourceType==="ULTG" ? (
              <>
                <div style={{background:"#dbeafe",border:`1px solid #93c5fd`,borderRadius:8,padding:"8px 12px",fontSize:12,color:"#1e40af",marginBottom:16}}>ℹ️ Alur: Admin Ajukan TUG-5 → Manager ULTG approve</div>
                <div style={{fontSize:12,fontWeight:800,color:C.accent,marginBottom:8,borderBottom:`1px solid ${C.border}`,paddingBottom:4}}>HEADER DOKUMEN</div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:14}}>
                  <div>
                    <label style={sty.label}>Unit ULTG Pengaju</label>
                    <input style={{...sty.input,background:"#f3f4f6"}} value={ultgList.find(u=>u.id===txnForm.ultgId)?.nama || "-"} disabled/>
                  </div>
                  <div>
                    <label style={sty.label}>Lokasi Pekerjaan *</label>
                    <input style={sty.input} value={txnForm.lokasiPekerjaan||""} onChange={e=>setTxnForm(tf=>({...tf,lokasiPekerjaan:e.target.value}))} placeholder="cth: Gardu Induk Rungkut"/>
                  </div>
                  <div style={{gridColumn:"1/-1"}}>
                    <label style={sty.label}>Nama Pekerjaan *</label>
                    <input style={sty.input} value={txnForm.namaPekerjaan||""} onChange={e=>setTxnForm(tf=>({...tf,namaPekerjaan:e.target.value,keteranganUmum:e.target.value}))} placeholder="cth: Penggantian Isolator Komposit Bay Trafo 1"/>
                  </div>
                </div>
              </>
            ) : (
            <>
            <div style={{background:"#dbeafe",border:`1px solid #93c5fd`,borderRadius:8,padding:"8px 12px",fontSize:12,color:"#1e40af",marginBottom:16}}>ℹ️ Alur: Asman approve → Manager UPT approve → INTRACOMPANY: auto draft TUG-7 di UIT | INTERCOMPANY: auto draft TUG-5 UIT (cetak manual).</div>

            <div style={{fontSize:12,fontWeight:800,color:C.accent,marginBottom:8,borderBottom:`1px solid ${C.border}`,paddingBottom:4}}>HEADER DOKUMEN</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:14}}>
              <div style={{gridColumn:"1/-1"}}>
                <label style={sty.label}>Kepada (UIT tujuan)</label>
                <select style={sty.select} value={txnForm.uitId||""} onChange={e=>setTxnForm(tf=>({...tf,uitId:e.target.value}))}>
                  <option value="">-- Pilih UIT --</option>
                  {uitList.map(u=><option key={u.id} value={u.id}>{u.kode} — {u.nama}</option>)}
                </select>
              </div>
              <div style={{gridColumn:"1/-1"}}>
                <label style={sty.label}>Jenis Transfer</label>
                <div style={{display:"flex",gap:8}}>
                  {["INTRACOMPANY","INTERCOMPANY"].map(jt=>(
                    <button key={jt} type="button" style={{flex:1,padding:"8px",borderRadius:8,border:`2px solid ${txnForm.jenisTransfer===jt?C.accent:C.border}`,background:txnForm.jenisTransfer===jt?"#eff6ff":"white",color:txnForm.jenisTransfer===jt?C.accent:C.muted,cursor:"pointer",fontWeight:700,fontSize:12}} onClick={()=>setTxnForm(tf=>({...tf,jenisTransfer:jt}))}>
                      {jt==="INTRACOMPANY"?"🔄 Intracompany (sesama UIT-JBM)":"🌐 Intercompany (lintas UIT)"}
                    </button>
                  ))}
                </div>
                {txnForm.jenisTransfer==="INTRACOMPANY" && <div style={{fontSize:10,color:C.green,marginTop:4}}>→ Setelah approved: otomatis generate draft TUG-7 di UIT untuk ditentukan UPT pengirimnya.</div>}
                {txnForm.jenisTransfer==="INTERCOMPANY" && <div style={{fontSize:10,color:"#7c3aed",marginTop:4}}>→ Setelah approved: otomatis generate draft TUG-5 UIT untuk dikirim manual ke UIT lain.</div>}
              </div>
            </div>
            </>
            )}

            <div style={{fontSize:12,fontWeight:800,color:C.accent,marginBottom:8,borderBottom:`1px solid ${C.border}`,paddingBottom:4}}>DAFTAR MATERIAL ({txnForm.stockItems.length}/10)</div>
            {(()=>{
              const pageStart = tug5MaterialPage*5;
              const pageIdxs = txnForm.stockItems.map((_,i)=>i).slice(pageStart, pageStart+5);
              return pageIdxs.map(idx=>{
                const si = txnForm.stockItems[idx];
                const kat = katalogList.find(k=>k.id===si.katalogId);
                const isExpanded = idx===tug5ExpandedIdx;
                if (!isExpanded) {
                  return (
                    <div key={idx} style={{display:"flex",alignItems:"center",gap:8,border:`1px solid ${C.border}`,borderRadius:8,padding:"8px 10px",marginBottom:8,background:"white",cursor:"pointer"}} onClick={()=>setTug5ExpandedIdx(idx)}>
                      <span style={{fontSize:11,fontWeight:700,color:C.muted}}>#{idx+1}</span>
                      <span style={{flex:1,fontSize:12,fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{kat ? `${kat.name} [${kat.katalog||"-"}]` : <span style={{color:C.muted,fontStyle:"italic"}}>Belum dipilih</span>}</span>
                      <span style={{fontSize:11,color:C.accent,fontWeight:700}}>Qty: {si.permintaan||0}{kat?.satuan?` ${kat.satuan}`:""}</span>
                      <span style={{fontSize:11,color:C.muted}}>✏️ Edit</span>
                      {txnForm.stockItems.length>1 && <button type="button" style={{...sty.btn("danger","sm"),padding:"3px 8px"}} onClick={e=>{e.stopPropagation();removeItemRow(idx);if(tug5ExpandedIdx===idx)setTug5ExpandedIdx(Math.max(0,idx-1));}}>✕</button>}
                    </div>
                  );
                }
                return (
                <div key={idx} style={{border:`2px solid ${C.accent}`,borderRadius:8,padding:10,marginBottom:8,background:"#f9fafb"}}>
                  <div style={{display:"flex",gap:8,alignItems:"flex-end",marginBottom:8}}>
                    <div style={{flex:3}}>
                      <label style={sty.label}>Nama Barang {idx+1}</label>
                      <SearchableSelect
                        options={katalogList}
                        value={si.katalogId}
                        onChange={v=>updateItemRow(idx,"katalogId",v)}
                        getLabel={k=>`${k.name} [${k.katalog||"-"}]`}
                        getSearchText={k=>`${k.name} ${k.katalog||""}`}
                        placeholder="-- Cari & pilih dari Master Katalog --"
                        sty={sty} C={C}
                      />
                    </div>
                    {txnForm.stockItems.length>1 && <button type="button" style={{...sty.btn("danger","sm")}} onClick={()=>{removeItemRow(idx);setTug5ExpandedIdx(Math.max(0,idx-1));}}>✕</button>}
                  </div>
                  {kat && <div style={{fontSize:10,color:C.muted,marginBottom:8}}>Nomor Normalisasi: {kat.katalog||"-"} • Satuan: {kat.satuan}</div>}
                  {txnForm.sourceType==="ULTG" ? (
                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                      <div><label style={sty.label}>Sisa Persediaan <span style={{color:C.muted,fontWeight:400}}>(stok aktual UPT)</span></label><input style={{...sty.input,background:"#f3f4f6"}} type="number" inputMode="decimal" min="0" value={si.sisaPersediaan||0} disabled/></div>
                      <div><label style={sty.label}>Jumlah Permintaan {kat?.satuan && <span style={{color:C.muted,fontWeight:400}}>({kat.satuan})</span>}</label><input style={sty.input} type="number" inputMode="decimal" min="1" value={si.permintaan||1} onChange={e=>updateItemRow(idx,"permintaan",Number(e.target.value))}/></div>
                    </div>
                  ) : (
                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8}}>
                      <div><label style={sty.label}>Pemakaian/Bulan</label><input style={sty.input} type="number" inputMode="decimal" min="0" value={si.pemakaianBulan||0} onChange={e=>updateItemRow(idx,"pemakaianBulan",Number(e.target.value))}/></div>
                      <div><label style={sty.label}>Sisa Persediaan</label><input style={sty.input} type="number" inputMode="decimal" min="0" value={si.sisaPersediaan||0} onChange={e=>updateItemRow(idx,"sisaPersediaan",Number(e.target.value))}/></div>
                      <div><label style={sty.label}>Jumlah Permintaan</label><input style={sty.input} type="number" inputMode="decimal" min="1" value={si.permintaan||1} onChange={e=>updateItemRow(idx,"permintaan",Number(e.target.value))}/></div>
                    </div>
                  )}
                  <div style={{marginTop:8}}><label style={sty.label}>Keterangan</label><input style={sty.input} value={si.keterangan||""} onChange={e=>updateItemRow(idx,"keterangan",e.target.value)} placeholder="cth: Single Insulator Strings"/></div>
                </div>
                );
              });
            })()}
            {txnForm.stockItems.length>5 && (
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                <button type="button" style={sty.btn("ghost","sm")} disabled={tug5MaterialPage===0} onClick={()=>setTug5MaterialPage(p=>Math.max(0,p-1))}>← Sebelumnya</button>
                <span style={{fontSize:11,color:C.muted}}>Halaman {tug5MaterialPage+1} dari {Math.ceil(txnForm.stockItems.length/5)}</span>
                <button type="button" style={sty.btn("ghost","sm")} disabled={(tug5MaterialPage+1)*5>=txnForm.stockItems.length} onClick={()=>setTug5MaterialPage(p=>p+1)}>Selanjutnya →</button>
              </div>
            )}
            <button type="button" style={{...sty.btn("ghost","sm"),marginBottom:14}} disabled={txnForm.stockItems.length>=10} onClick={addItemRow}>+ Tambah Material {txnForm.stockItems.length>=10?"(maks 10)":""}</button>

            {txnForm.sourceType!=="ULTG" && (
              <>
                <div style={{fontSize:12,fontWeight:800,color:C.accent,marginBottom:8,borderBottom:`1px solid ${C.border}`,paddingBottom:4}}>ADMINISTRASI</div>
                <div style={{display:"grid",gridTemplateColumns:"1fr",gap:10,marginBottom:16}}>
                  <div><label style={sty.label}>Keterangan Umum</label><input style={sty.input} value={txnForm.keteranganUmum||""} onChange={e=>setTxnForm(tf=>({...tf,keteranganUmum:e.target.value}))} placeholder="cth: Penggantian Isolator Komposit UPT Surabaya"/></div>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10}}>
                    <div><label style={sty.label}>Perintah Kerja</label><input style={sty.input} value={txnForm.perintahKerja||""} onChange={e=>setTxnForm(tf=>({...tf,perintahKerja:e.target.value}))}/></div>
                    <div><label style={sty.label}>Kode Perkiraan</label><input style={sty.input} value={txnForm.kodePerkiraan||""} onChange={e=>setTxnForm(tf=>({...tf,kodePerkiraan:e.target.value}))}/></div>
                    <div><label style={sty.label}>Fungsi</label><input style={sty.input} value={txnForm.fungsi||""} onChange={e=>setTxnForm(tf=>({...tf,fungsi:e.target.value}))}/></div>
                  </div>
                </div>
              </>
            )}
            <div style={sty.stickyFooter}>
              <button style={{...sty.btn("ghost"),flex:1}} onClick={()=>setTxnModal(false)}>Batal</button>
              <button style={{...sty.btn("primary"),flex:2}} onClick={saveTxn}>📋 Ajukan TUG-5</button>
            </div>
          </div>
        </div>
      )}

      {/* TXN MODAL - TUG9 / TUG8 FORM (outgoing material) */}
      {txnModal && txnForm && (txnForm.docType==="TUG9" || txnForm.docType==="TUG8") && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000,padding:20}}>
          <div style={{...sty.card,width:680,maxHeight:"92vh",overflowY:"auto"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
              <h3 style={{fontSize:18,fontWeight:800}}>Formulir {txnForm.docType.replace("TUG","TUG-")} — {txnForm.docType==="TUG9"?"Bon Pemakaian":"Pemakaian Unit Lain"}</h3>
              <span style={{fontSize:11,color:"#0098da",fontWeight:700}}>No: {docSeq}.{txnForm.docType.replace("TUG","TUG-")}/...</span>
            </div>
            <div style={{background:"#fef3c7",border:`1px solid #fcd34d`,borderRadius:8,padding:"8px 12px",fontSize:12,color:"#92400e",marginBottom:16}}>⚠️ Transaksi akan PENDING sampai disetujui TL Logistik / Asman.</div>

            <div style={{fontSize:12,fontWeight:800,color:C.accent,marginBottom:8,borderBottom:`1px solid ${C.border}`,paddingBottom:4}}>DATA PEKERJAAN</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:14}}>
              <div style={{gridColumn:"1/-1"}}><label style={sty.label}>Nama Pekerjaan</label><input style={sty.input} value={txnForm.namaPekerjaan} onChange={e=>setTxnForm(tf=>({...tf,namaPekerjaan:e.target.value,pekerjaan:e.target.value}))} placeholder="cth: Extension Bay Kapasitor"/></div>
              <div style={{gridColumn:"1/-1"}}><label style={sty.label}>Lokasi Pekerjaan</label><input style={sty.input} value={txnForm.lokasiPekerjaan} onChange={e=>setTxnForm(tf=>({...tf,lokasiPekerjaan:e.target.value}))} placeholder="cth: GI Paciran, GI New Pacitan"/></div>
              {txnForm.docType==="TUG8" && (
                <div style={{gridColumn:"1/-1"}}>
                  <label style={sty.label}>Unit / Sektor Tujuan (PLN Lain)</label>
                  <input style={sty.input} value={txnForm.unitTujuan||""} onChange={e=>setTxnForm(tf=>({...tf,unitTujuan:e.target.value}))} placeholder="cth: UPT Malang, ULTG Pasuruan"/>
                </div>
              )}
              <div><label style={sty.label}>No. Surat / Nodin</label><input style={sty.input} value={txnForm.noNodin} onChange={e=>setTxnForm(tf=>({...tf,noNodin:e.target.value}))} placeholder="2175/LOG.00.02/F34000000/2026"/></div>
              <div><label style={sty.label}>No. Surat Persetujuan</label><input style={sty.input} value={txnForm.noPersetujuan} onChange={e=>setTxnForm(tf=>({...tf,noPersetujuan:e.target.value}))} placeholder="1861/DAN.01.03/F34000000/2026"/></div>
            </div>

            <div style={{fontSize:12,fontWeight:800,color:C.accent,marginBottom:8,borderBottom:`1px solid ${C.border}`,paddingBottom:4}}>DATA PENERIMA</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:12,marginBottom:14}}>
              <div><label style={sty.label}>Nama Penerima</label><input style={sty.input} value={txnForm.penerimaNama} onChange={e=>setTxnForm(tf=>({...tf,penerimaNama:e.target.value}))}/></div>
              <div><label style={sty.label}>Jabatan</label><input style={sty.input} value={txnForm.penerimaJabatan} onChange={e=>setTxnForm(tf=>({...tf,penerimaJabatan:e.target.value}))} placeholder="cth: Project Manager"/></div>
              <div><label style={sty.label}>Unit / Perusahaan</label><input style={sty.input} value={txnForm.penerimaUnit} onChange={e=>setTxnForm(tf=>({...tf,penerimaUnit:e.target.value}))} placeholder="cth: PT. Mitra Jaya"/></div>
            </div>

            <div style={{fontSize:12,fontWeight:800,color:C.accent,marginBottom:8,borderBottom:`1px solid ${C.border}`,paddingBottom:4}}>TRANSPORTASI (untuk Surat Jalan)</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:12,marginBottom:14}}>
              <div><label style={sty.label}>Nopol Kendaraan</label><input style={sty.input} value={txnForm.nopol} onChange={e=>setTxnForm(tf=>({...tf,nopol:e.target.value}))} placeholder="L 9859 UK"/></div>
              <div><label style={sty.label}>Nama Pengemudi</label><input style={sty.input} value={txnForm.namaPengemudi} onChange={e=>setTxnForm(tf=>({...tf,namaPengemudi:e.target.value}))}/></div>
              <div><label style={sty.label}>No. SIM / KTP</label><input style={sty.input} value={txnForm.simKtp} onChange={e=>setTxnForm(tf=>({...tf,simKtp:e.target.value}))}/></div>
            </div>
            <div style={{marginBottom:14}}>
              <label style={sty.label}>Satpam Bertugas (Mengetahui di Surat Jalan)</label>
              <select style={sty.select} value={txnForm.satpamId||""} onChange={e=>setTxnForm(tf=>({...tf,satpamId:e.target.value}))}>
                <option value="">-- Pilih Satpam --</option>
                {satpamList.map(sp=><option key={sp.id} value={sp.id}>{sp.name}</option>)}
              </select>
              {satpamList.length===0 && <div style={{fontSize:10,color:C.muted,marginTop:4}}>Belum ada data Satpam. Tambahkan di menu Master Data → tab Satpam.</div>}
            </div>

            <div style={{fontSize:12,fontWeight:800,color:C.accent,marginBottom:8,borderBottom:`1px solid ${C.border}`,paddingBottom:4}}>BARANG / MATERIAL</div>
            <div style={{fontSize:10,color:C.muted,marginBottom:8,fontStyle:"italic"}}>💡 Barang yang sama bisa ada di lokasi berbeda — pastikan pilih baris dengan lokasi yang benar.</div>
            {txnForm.stockItems.map((si,idx)=>{
              const stockOpt = enrichedStocks.find(s=>s.id===si.stockId);
              return (
                <div key={idx} style={{display:"flex",gap:8,marginBottom:8,alignItems:"flex-end"}}>
                  <div style={{flex:3}}>
                    <label style={sty.label}>Barang {idx+1}</label>
                    <SearchableSelect
                      options={enrichedStocks}
                      value={si.stockId}
                      onChange={v=>updateItemRow(idx,"stockId",v)}
                      getLabel={s=>`${s.name} [${s.katalog}] @ ${s.lokasi}`}
                      getSearchText={s=>`${s.name} ${s.katalog} ${s.lokasi}`}
                      renderOption={s=>(
                        <div>
                          <div style={{fontWeight:600}}>{s.name} <span style={{color:C.muted,fontWeight:400}}>[{s.katalog}]</span></div>
                          <div style={{fontSize:10,color:C.muted}}>📍 {s.lokasi} • {s.jenisBarang!=="Non-Stock"?`Stok: ${fmtNum(s.qty)} ${s.unit}`:"Non-Stock"}</div>
                        </div>
                      )}
                      placeholder="-- Cari & pilih barang --"
                      sty={sty} C={C}
                    />
                  </div>
                  <div style={{flex:1}}><label style={sty.label}>Qty</label><input style={sty.input} type="number" inputMode="decimal" min="1" value={si.qty} onChange={e=>updateItemRow(idx,"qty",Number(e.target.value))}/></div>
                  <button type="button" style={{...sty.btn("ghost","sm"),height:36}} onClick={()=>openScanner({txnIndex:idx})}>📷</button>
                  {txnForm.stockItems.length>1 && <button type="button" style={{...sty.btn("danger","sm"),height:36}} onClick={()=>removeItemRow(idx)}>✕</button>}
                </div>
              );
            })}
            <button type="button" style={{...sty.btn("ghost","sm"),marginBottom:14}} onClick={addItemRow}>+ Tambah Barang Lain</button>

            <div style={{marginBottom:14}}><label style={sty.label}>Keterangan Barang{txnForm.docType!=="TUG8"?" (status proyek/non-stock)":""}</label><input style={sty.input} value={txnForm.keteranganBarang} onChange={e=>setTxnForm(tf=>({...tf,keteranganBarang:e.target.value}))} placeholder="cth: Untuk Proyek PT. Mitra Jaya"/></div>

            <div style={{fontSize:12,fontWeight:800,color:C.accent,marginBottom:8,borderBottom:`1px solid ${C.border}`,paddingBottom:4}}>📸 LAMPIRAN FOTO (opsional)</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:12,marginBottom:14}}>
              <div>
                <label style={sty.label}>Foto Kendaraan</label>
                <input type="file" accept="image/*" capture="environment" onChange={e=>handleImg(e, img=>setTxnForm(tf=>({...tf,fotoKendaraan:img})))} style={{fontSize:11,color:C.muted}}/>
                {txnForm.fotoKendaraan && <img src={txnForm.fotoKendaraan} alt="kendaraan" style={{width:"100%",height:70,objectFit:"cover",borderRadius:6,marginTop:6,border:`1px solid ${C.border}`}}/>}
              </div>
              <div>
                <label style={sty.label}>Foto SIM / KTP Pengemudi</label>
                <input type="file" accept="image/*" capture="environment" onChange={e=>handleImg(e, img=>setTxnForm(tf=>({...tf,fotoSimKtp:img})))} style={{fontSize:11,color:C.muted}}/>
                {txnForm.fotoSimKtp && <img src={txnForm.fotoSimKtp} alt="sim ktp" style={{width:"100%",height:70,objectFit:"cover",borderRadius:6,marginTop:6,border:`1px solid ${C.border}`}}/>}
              </div>
              <div>
                <label style={sty.label}>Surat Permintaan/Pengembalian</label>
                <input type="file" accept="image/*" capture="environment" onChange={e=>handleImg(e, img=>setTxnForm(tf=>({...tf,fotoSuratPengembalian:img})))} style={{fontSize:11,color:C.muted}}/>
                {txnForm.fotoSuratPengembalian && <img src={txnForm.fotoSuratPengembalian} alt="surat" style={{width:"100%",height:70,objectFit:"cover",borderRadius:6,marginTop:6,border:`1px solid ${C.border}`}}/>}
              </div>
            </div>
            <div style={{marginBottom:16}}>
              <label style={sty.label}>Foto Tiap Material</label>
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(140px,1fr))",gap:10,marginTop:6}}>
                {txnForm.stockItems.filter(si=>si.stockId).map((si,idx)=>{
                  const stock = enrichedStocks.find(s=>s.id===si.stockId);
                  const existingPhoto = txnForm.fotoMaterial.find(fm=>fm.stockId===si.stockId);
                  return (
                    <div key={idx} style={{background:"#f9fafb",border:`1px solid ${C.border}`,borderRadius:8,padding:8}}>
                      <div style={{fontSize:11,fontWeight:600,marginBottom:4,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{stock?.name||"-"}</div>
                      <input type="file" accept="image/*" capture="environment" onChange={e=>handleMaterialImg(e, si.stockId)} style={{fontSize:10,color:C.muted,width:"100%"}}/>
                      {existingPhoto && <img src={existingPhoto.img} alt={stock?.name} style={{width:"100%",height:60,objectFit:"cover",borderRadius:6,marginTop:6}}/>}
                    </div>
                  );
                })}
                {txnForm.stockItems.filter(si=>si.stockId).length===0 && <div style={{fontSize:11,color:C.muted,fontStyle:"italic"}}>Pilih barang terlebih dahulu untuk upload foto material</div>}
              </div>
            </div>

            <div style={{fontSize:12,fontWeight:800,color:C.accent,marginBottom:8,borderBottom:`1px solid ${C.border}`,paddingBottom:4}}>PEMBEBANAN (opsional)</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:16}}>
              <div><label style={sty.label}>Perkiraan Pembebanan</label><input style={sty.input} value={txnForm.perkiraanPembebanan} onChange={e=>setTxnForm(tf=>({...tf,perkiraanPembebanan:e.target.value}))}/></div>
              <div><label style={sty.label}>Kode Perkiraan</label><input style={sty.input} value={txnForm.kodePerkiraan} onChange={e=>setTxnForm(tf=>({...tf,kodePerkiraan:e.target.value}))}/></div>
            </div>

            <div style={sty.stickyFooter}>
              <button style={{...sty.btn("ghost"),flex:1}} onClick={()=>{setTxnModal(false);setEditingDraftTxnId(null);}}>Batal</button>
              <button style={{...sty.btn("primary"),flex:2}} onClick={saveTxn}>{editingDraftTxnId?"📤 Lengkapi & Ajukan TUG-9":`📤 Ajukan ${txnForm.docType.replace("TUG","TUG-")}`}</button>
            </div>
          </div>
        </div>
      )}

      {/* TXN MODAL - TUG10 FORM (incoming material / return to warehouse) */}
      {txnModal && txnForm && txnForm.docType==="TUG10" && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000,padding:20}}>
          <div style={{...sty.card,width:700,maxHeight:"92vh",overflowY:"auto"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
              <h3 style={{fontSize:18,fontWeight:800}}>Formulir TUG-10 — Bon Pengembalian</h3>
              <span style={{fontSize:11,color:"#0098da",fontWeight:700}}>No: {docSeq}.TUG-10/...</span>
            </div>
            <div style={{background:"#fef3c7",border:`1px solid #fcd34d`,borderRadius:8,padding:"8px 12px",fontSize:12,color:"#92400e",marginBottom:16}}>⚠️ Transaksi akan PENDING sampai disetujui TL Logistik / Asman. Stok akan BERTAMBAH saat disetujui.</div>

            <div style={{fontSize:12,fontWeight:800,color:C.accent,marginBottom:8,borderBottom:`1px solid ${C.border}`,paddingBottom:4}}>DATA PEKERJAAN</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:14}}>
              <div><label style={sty.label}>Pekerjaan (jenis)</label><input style={sty.input} value={txnForm.pekerjaan} onChange={e=>setTxnForm(tf=>({...tf,pekerjaan:e.target.value}))} placeholder="cth: Penggantian"/></div>
              <div><label style={sty.label}>No. BA Penggantian</label><input style={sty.input} value={txnForm.noBAPenggantian} onChange={e=>setTxnForm(tf=>({...tf,noBAPenggantian:e.target.value}))} placeholder="0266/PT-SD/VI/2026"/></div>
              <div style={{gridColumn:"1/-1"}}><label style={sty.label}>Nama Pekerjaan</label><input style={sty.input} value={txnForm.namaPekerjaan} onChange={e=>setTxnForm(tf=>({...tf,namaPekerjaan:e.target.value}))} placeholder="cth: Pengembalian Material Relay GIS Darmo dan GIS Waru"/></div>
              <div style={{gridColumn:"1/-1"}}><label style={sty.label}>Lokasi Pekerjaan</label><input style={sty.input} value={txnForm.lokasiPekerjaan} onChange={e=>setTxnForm(tf=>({...tf,lokasiPekerjaan:e.target.value}))} placeholder="cth: GIS Darmo dan GIS Waru"/></div>
            </div>

            <div style={{fontSize:12,fontWeight:800,color:C.accent,marginBottom:8,borderBottom:`1px solid ${C.border}`,paddingBottom:4}}>PIHAK YANG MENYERAHKAN</div>
            <div style={{marginBottom:14}}>
              <label style={sty.label}>Nama</label>
              <input style={sty.input} value={txnForm.menyerahkanNama} onChange={e=>setTxnForm(tf=>({...tf,menyerahkanNama:e.target.value}))}/>
            </div>

            <div style={{marginBottom:14}}>
              <label style={sty.label}>Lokasi Penyimpanan di Gudang (Master Lokasi)</label>
              <select style={sty.select} value={txnForm.lokasiTujuanId||""} onChange={e=>setTxnForm(tf=>({...tf,lokasiTujuanId:e.target.value}))}>
                <option value="">-- Pilih Lokasi --</option>
                {lokasiList.map(l=><option key={l.id} value={l.id}>{l.kode} {l.keterangan?`— ${l.keterangan}`:""}</option>)}
              </select>
              {lokasiList.length===0 && <div style={{fontSize:10,color:"#be185d",marginTop:4}}>Belum ada Blok Lokasi. Tambahkan dulu di menu Master Data → Master Gudang.</div>}
            </div>

            <div style={{fontSize:12,fontWeight:800,color:C.accent,marginBottom:8,borderBottom:`1px solid ${C.border}`,paddingBottom:4}}>BARANG / MATERIAL RETUR</div>
            <div style={{fontSize:10,color:C.muted,marginBottom:8,fontStyle:"italic"}}>💡 Pilih dari katalog yang sudah ada, atau daftarkan barang baru langsung di sini.</div>
            {txnForm.stockItems.map((si,idx)=>(
              <div key={idx} style={{border:`1px solid ${C.border}`,borderRadius:10,padding:12,marginBottom:10,background:"#f9fafb"}}>
                <div style={{display:"flex",gap:8,marginBottom:8}}>
                  <button type="button" style={{...sty.btn(si.katalogMode==="existing"?"primary":"ghost","sm"),flex:1}} onClick={()=>updateItemRow(idx,"katalogMode","existing")}>📑 Dari Katalog</button>
                  <button type="button" style={{...sty.btn(si.katalogMode==="new"?"primary":"ghost","sm"),flex:1}} onClick={()=>updateItemRow(idx,"katalogMode","new")}>✨ Barang Baru</button>
                  {txnForm.stockItems.length>1 && <button type="button" style={{...sty.btn("danger","sm")}} onClick={()=>removeItemRow(idx)}>✕</button>}
                </div>

                {si.katalogMode==="existing" ? (
                  <div style={{marginBottom:8}}>
                    <label style={sty.label}>Pilih Barang</label>
                    <SearchableSelect
                      options={katalogList}
                      value={si.katalogId}
                      onChange={v=>updateItemRow(idx,"katalogId",v)}
                      getLabel={k=>`${k.name} [${k.katalog}]`}
                      getSearchText={k=>`${k.name} ${k.katalog||""}`}
                      placeholder="-- Cari & pilih dari Master Katalog --"
                      sty={sty} C={C}
                    />
                  </div>
                ) : (
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:8}}>
                    <div style={{gridColumn:"1/-1"}}><label style={sty.label}>Nama Barang Baru</label><input style={sty.input} value={si.namaBaru} onChange={e=>updateItemRow(idx,"namaBaru",e.target.value)} placeholder="cth: Relay CCP Bongkaran"/></div>
                    <div><label style={sty.label}>Nomor Katalog (opsional)</label><input style={sty.input} value={si.katalogBaru} onChange={e=>updateItemRow(idx,"katalogBaru",e.target.value)}/></div>
                    <div><label style={sty.label}>Satuan</label><input style={sty.input} value={si.satuanBaru} onChange={e=>updateItemRow(idx,"satuanBaru",e.target.value)} placeholder="cth: BH, pcs, unit"/></div>
                    <div style={{gridColumn:"1/-1"}}><label style={sty.label}>Kategori</label><select style={sty.select} value={si.categoryBaru} onChange={e=>updateItemRow(idx,"categoryBaru",e.target.value)}>{CATEGORIES.map(c=><option key={c}>{c}</option>)}</select></div>
                  </div>
                )}

                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:8}}>
                  <div><label style={sty.label}>Jumlah</label><input style={sty.input} type="number" inputMode="decimal" min="1" value={si.qty} onChange={e=>updateItemRow(idx,"qty",Number(e.target.value))}/></div>
                  <div><label style={sty.label}>Nomor Asset (opsional)</label><input style={sty.input} value={si.noAsset} onChange={e=>updateItemRow(idx,"noAsset",e.target.value)}/></div>
                </div>

                <div style={{marginBottom:8}}>
                  <label style={sty.label}>Status Material</label>
                  <div style={{display:"flex",gap:8}}>
                    {STATUS_MATERIAL_RETUR.map(sm=>{
                      const bs = statusMaterialBadgeStyle(sm);
                      const active = si.statusMaterial===sm;
                      return (
                        <button key={sm} type="button" style={{flex:1,padding:"8px",borderRadius:8,border:`2px solid ${active?bs.fg:C.border}`,background:active?bs.bg:"white",color:active?bs.fg:C.muted,cursor:"pointer",fontWeight:700,fontSize:12}} onClick={()=>updateItemRow(idx,"statusMaterial",sm)}>{sm}</button>
                      );
                    })}
                  </div>
                  {si.statusMaterial==="Bongkaran" && <div style={{fontSize:10,color:"#854d0e",marginTop:4}}>ℹ️ Jenis Barang otomatis menjadi "Bongkaran".</div>}
                  {si.statusMaterial==="Bongkaran ATTB (MTU)" && <div style={{fontSize:10,color:"#92400e",marginTop:4}}>ℹ️ Jenis Barang otomatis menjadi "ATTB". Wajib lengkapi data tambahan di bawah.</div>}
                </div>

                <div style={{background:"#f0fdf4",border:`1px solid #bbf7d0`,borderRadius:8,padding:10,marginBottom:si.statusMaterial==="Bongkaran ATTB (MTU)"?8:0}}>
                  <label style={sty.label}>Foto Barang * (wajib untuk semua status)</label>
                  <input type="file" accept="image/*" capture="environment" onChange={e=>handleImg(e, img=>updateItemRow(idx,"fotoBarangRetur",img))} style={{fontSize:10,color:C.muted,width:"100%"}}/>
                  {si.fotoBarangRetur && <img src={si.fotoBarangRetur} alt="barang" style={{width:120,height:80,objectFit:"cover",borderRadius:6,marginTop:6}}/>}
                </div>

                {si.statusMaterial==="Bongkaran ATTB (MTU)" && (
                  <div style={{background:"#fffbeb",border:`1px solid #fde68a`,borderRadius:8,padding:10}}>
                    <div style={{fontSize:11,fontWeight:700,color:"#92400e",marginBottom:8}}>📋 Data Tambahan Wajib — Bongkaran ATTB (MTU)</div>
                    <div style={{marginBottom:8}}><label style={sty.label}>Nomor Seri Material *</label><input style={sty.input} value={si.noSeri} onChange={e=>updateItemRow(idx,"noSeri",e.target.value)} placeholder="cth: SN-2024-001"/></div>
                    <div>
                      <label style={sty.label}>Foto Nameplate *</label>
                      <input type="file" accept="image/*" capture="environment" onChange={e=>handleImg(e, img=>updateItemRow(idx,"fotoNameplate",img))} style={{fontSize:10,color:C.muted,width:"100%"}}/>
                      {si.fotoNameplate && <img src={si.fotoNameplate} alt="nameplate" style={{width:120,height:80,objectFit:"cover",borderRadius:6,marginTop:6}}/>}
                    </div>
                  </div>
                )}
              </div>
            ))}
            <button type="button" style={{...sty.btn("ghost","sm"),marginBottom:14}} onClick={addItemRow}>+ Tambah Barang Retur Lain</button>

            {txnForm.stockItems.some(si=>si.statusMaterial==="Bongkaran ATTB (MTU)") && (
              <div style={{marginBottom:16}}>
                <label style={sty.label}>Upload Surat BA Pengembalian * (foto)</label>
                <input type="file" accept="image/*" capture="environment" onChange={e=>handleImg(e, img=>setTxnForm(tf=>({...tf,fotoBAPengembalian:img})))} style={{fontSize:11,color:C.muted}}/>
                {txnForm.fotoBAPengembalian && <img src={txnForm.fotoBAPengembalian} alt="BA Pengembalian" style={{width:120,height:80,objectFit:"cover",borderRadius:6,marginTop:6,border:`1px solid ${C.border}`}}/>}
              </div>
            )}

            <div style={{fontSize:12,fontWeight:800,color:C.accent,marginBottom:8,borderBottom:`1px solid ${C.border}`,paddingBottom:4}}>PEMBEBANAN (opsional)</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:16}}>
              <div><label style={sty.label}>Perkiraan Pembebanan</label><input style={sty.input} value={txnForm.perkiraanPembebanan} onChange={e=>setTxnForm(tf=>({...tf,perkiraanPembebanan:e.target.value}))}/></div>
              <div><label style={sty.label}>Kode Perkiraan</label><input style={sty.input} value={txnForm.kodePerkiraan} onChange={e=>setTxnForm(tf=>({...tf,kodePerkiraan:e.target.value}))}/></div>
            </div>

            <div style={sty.stickyFooter}>
              <button style={{...sty.btn("ghost"),flex:1}} onClick={()=>setTxnModal(false)}>Batal</button>
              <button style={{...sty.btn("primary"),flex:2}} onClick={saveTxn}>📤 Ajukan TUG-10</button>
            </div>
          </div>
        </div>
      )}

      {/* TXN MODAL - TUG3 FORM (Karantina — penerimaan barang tahap 1) */}
      {txnModal && txnForm && txnForm.docType==="TUG3" && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000,padding:20}}>
          <div style={{...sty.card,width:700,maxHeight:"92vh",overflowY:"auto"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
              <h3 style={{fontSize:18,fontWeight:800}}>Formulir TUG-3 Karantina — Bon Penerimaan</h3>
              <span style={{fontSize:11,color:"#0098da",fontWeight:700}}>No: {docSeq}.TUG-3/...</span>
            </div>
            <div style={{background:"#dbeafe",border:`1px solid #93c5fd`,borderRadius:8,padding:"8px 12px",fontSize:12,color:"#1e40af",marginBottom:16}}>ℹ️ Setelah diajukan: TL Logistik approve → lanjut isi TUG-4 → Manager approve → lengkapi lampiran → Asman approve → stok masuk gudang.</div>

            <div style={{fontSize:12,fontWeight:800,color:C.accent,marginBottom:8,borderBottom:`1px solid ${C.border}`,paddingBottom:4}}>DATA PENERIMAAN</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:14}}>
              <div><label style={sty.label}>Tanggal Diterima</label><input type="date" style={sty.input} value={txnForm.tanggalDiterima} onChange={e=>setTxnForm(tf=>({...tf,tanggalDiterima:e.target.value}))}/></div>
              <div><label style={sty.label}>Dari (Supplier)</label><input style={sty.input} value={txnForm.dariSupplier} onChange={e=>setTxnForm(tf=>({...tf,dariSupplier:e.target.value}))} placeholder="cth: PT. Sedayu"/></div>
              <div><label style={sty.label}>Dengan</label><input style={sty.input} value={txnForm.denganKirim} onChange={e=>setTxnForm(tf=>({...tf,denganKirim:e.target.value}))} placeholder="cth: Dikirim Langsung"/></div>
              <div></div>
              <div><label style={sty.label}>No. Surat Jalan</label><input style={sty.input} value={txnForm.noSuratJalan} onChange={e=>setTxnForm(tf=>({...tf,noSuratJalan:e.target.value}))}/></div>
              <div><label style={sty.label}>Tgl. Surat Jalan</label><input type="date" style={sty.input} value={txnForm.tglSuratJalan} onChange={e=>setTxnForm(tf=>({...tf,tglSuratJalan:e.target.value}))}/></div>
              <div><label style={sty.label}>No. SPK / Surat Pesanan</label><input style={sty.input} value={txnForm.noSpk} onChange={e=>setTxnForm(tf=>({...tf,noSpk:e.target.value}))}/></div>
              <div><label style={sty.label}>Tgl. SPK</label><input type="date" style={sty.input} value={txnForm.tglSpk} onChange={e=>setTxnForm(tf=>({...tf,tglSpk:e.target.value}))}/></div>
              <div><label style={sty.label}>No. Faktur / Bukti Kas (opsional)</label><input style={sty.input} value={txnForm.noFaktur} onChange={e=>setTxnForm(tf=>({...tf,noFaktur:e.target.value}))}/></div>
              <div><label style={sty.label}>Tgl. Faktur</label><input type="date" style={sty.input} value={txnForm.tglFaktur} onChange={e=>setTxnForm(tf=>({...tf,tglFaktur:e.target.value}))}/></div>
              <div><label style={sty.label}>No. Amandemen/Kontrak (opsional)</label><input style={sty.input} value={txnForm.noAmandemen} onChange={e=>setTxnForm(tf=>({...tf,noAmandemen:e.target.value}))}/></div>
              <div><label style={sty.label}>Biaya Angkutan</label><input type="number" inputMode="decimal" style={sty.input} value={txnForm.biayaAngkutan} onChange={e=>setTxnForm(tf=>({...tf,biayaAngkutan:Number(e.target.value)}))}/></div>
            </div>

            <div style={{fontSize:12,fontWeight:800,color:C.accent,marginBottom:8,borderBottom:`1px solid ${C.border}`,paddingBottom:4}}>BARANG / SPARE PARTS</div>
            <div style={{fontSize:10,color:C.muted,marginBottom:8,fontStyle:"italic"}}>💡 Pilih dari katalog yang sudah ada, atau daftarkan barang baru langsung di sini.</div>
            {txnForm.stockItems.map((si,idx)=>(
              <div key={idx} style={{border:`1px solid ${C.border}`,borderRadius:10,padding:12,marginBottom:10,background:"#f9fafb"}}>
                <div style={{display:"flex",gap:8,marginBottom:8}}>
                  <button type="button" style={{...sty.btn(si.katalogMode==="existing"?"primary":"ghost","sm"),flex:1}} onClick={()=>updateItemRow(idx,"katalogMode","existing")}>📑 Dari Katalog</button>
                  <button type="button" style={{...sty.btn(si.katalogMode==="new"?"primary":"ghost","sm"),flex:1}} onClick={()=>updateItemRow(idx,"katalogMode","new")}>✨ Barang Baru</button>
                  {txnForm.stockItems.length>1 && <button type="button" style={{...sty.btn("danger","sm")}} onClick={()=>removeItemRow(idx)}>✕</button>}
                </div>
                {si.katalogMode==="existing" ? (
                  <div style={{marginBottom:8}}>
                    <label style={sty.label}>Pilih Barang</label>
                    <SearchableSelect
                      options={katalogList}
                      value={si.katalogId}
                      onChange={v=>updateItemRow(idx,"katalogId",v)}
                      getLabel={k=>`${k.name} [${k.katalog}]`}
                      getSearchText={k=>`${k.name} ${k.katalog||""}`}
                      placeholder="-- Cari & pilih dari Master Katalog --"
                      sty={sty} C={C}
                    />
                  </div>
                ) : (
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:8}}>
                    <div style={{gridColumn:"1/-1"}}><label style={sty.label}>Nama Barang Baru</label><input style={sty.input} value={si.namaBaru} onChange={e=>updateItemRow(idx,"namaBaru",e.target.value)} placeholder="cth: INSUL MEDIA;OIL;NAPHTHENIC"/></div>
                    <div><label style={sty.label}>Nomor Katalog</label><input style={sty.input} value={si.katalogBaru} onChange={e=>updateItemRow(idx,"katalogBaru",e.target.value)} placeholder="cth: 4180023"/></div>
                    <div><label style={sty.label}>Satuan</label><input style={sty.input} value={si.satuanBaru} onChange={e=>updateItemRow(idx,"satuanBaru",e.target.value)} placeholder="cth: L, BH, pcs"/></div>
                    <div style={{gridColumn:"1/-1"}}><label style={sty.label}>Kategori</label><select style={sty.select} value={si.categoryBaru} onChange={e=>updateItemRow(idx,"categoryBaru",e.target.value)}>{CATEGORIES.map(c=><option key={c}>{c}</option>)}</select></div>
                  </div>
                )}
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8}}>
                  <div><label style={sty.label}>Jumlah</label><input style={sty.input} type="number" inputMode="decimal" min="1" value={si.qty} onChange={e=>updateItemRow(idx,"qty",Number(e.target.value))}/></div>
                  <div><label style={sty.label}>Harga Satuan</label><input style={sty.input} type="number" inputMode="decimal" min="0" value={si.harga} onChange={e=>updateItemRow(idx,"harga",Number(e.target.value))}/></div>
                  <div>
                    <label style={sty.label}>Lokasi Tujuan</label>
                    <select style={sty.select} value={si.lokasiTujuanId||""} onChange={e=>updateItemRow(idx,"lokasiTujuanId",e.target.value)}>
                      <option value="">-- Pilih --</option>
                      {lokasiList.map(l=><option key={l.id} value={l.id}>{l.kode}</option>)}
                    </select>
                  </div>
                </div>
              </div>
            ))}
            <button type="button" style={{...sty.btn("ghost","sm"),marginBottom:14}} onClick={addItemRow}>+ Tambah Barang Lain</button>

            <div style={{fontSize:12,fontWeight:800,color:C.accent,marginBottom:8,borderBottom:`1px solid ${C.border}`,paddingBottom:4}}>ADMINISTRASI</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:16}}>
              <div><label style={sty.label}>Nota No.</label><input style={sty.input} value={txnForm.notaNo} onChange={e=>setTxnForm(tf=>({...tf,notaNo:e.target.value}))}/></div>
              <div><label style={sty.label}>Kode Perkiraan</label><input style={sty.input} value={txnForm.kodePerkiraan} onChange={e=>setTxnForm(tf=>({...tf,kodePerkiraan:e.target.value}))}/></div>
              <div><label style={sty.label}>Perintah Kerja</label><input style={sty.input} value={txnForm.perintahKerja} onChange={e=>setTxnForm(tf=>({...tf,perintahKerja:e.target.value}))}/></div>
              <div><label style={sty.label}>Fungsi</label><input style={sty.input} value={txnForm.fungsi} onChange={e=>setTxnForm(tf=>({...tf,fungsi:e.target.value}))}/></div>
              <div style={{gridColumn:"1/-1"}}><label style={sty.label}>Keterangan</label><input style={sty.input} value={txnForm.keteranganTug3} onChange={e=>setTxnForm(tf=>({...tf,keteranganTug3:e.target.value}))} placeholder="Baik"/></div>
            </div>

            <div style={sty.stickyFooter}>
              <button style={{...sty.btn("ghost"),flex:1}} onClick={()=>setTxnModal(false)}>Batal</button>
              <button style={{...sty.btn("primary"),flex:2}} onClick={saveTxn}>📤 Ajukan TUG-3 Karantina</button>
            </div>
          </div>
        </div>
      )}

      {/* DOCUMENT PREVIEW MODAL (TUG-9 / TUG-8 / TUG-10 / TUG-3 package) */}
      {docPreview && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.6)",display:"flex",flexDirection:"column",zIndex:1500}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"12px 18px",background:C.sidebar,flexShrink:0}}>
            <div style={{color:"white",fontWeight:700,fontSize:14}}>📄 Dokumen {docPreview.docType.replace("TUG","TUG-")} — {docPreview.docNumbers?.[docKeyOf(docPreview)]||docPreview.id}</div>
            <div style={{display:"flex",gap:8}}>
              <button style={{...sty.btn("success"),padding:"7px 16px"}} onClick={()=>{
                if (docPreview.docType==="TUG10") downloadTUG10HTML(docPreview, katalogList, lokasiList, users, showToast);
                else if (docPreview.docType==="TUG3") downloadTUG3HTML(docPreview, katalogList, lokasiList, timMutuList, users, showToast);
                else if (docPreview.docType==="TUG5") downloadTUG5HTML(docPreview, katalogList, uitList, users, showToast, ultgList);
                else if (docPreview.docType==="TUG7") downloadTUG7HTML(docPreview, katalogList, uitList, uptList, users, showToast);
                else downloadTUG9HTML(docPreview, enrichedStocks, users, satpamList, showToast);
              }}>⬇️ Unduh File (untuk Print/PDF)</button>
              <button style={{background:"#dc2626",color:"white",border:"none",borderRadius:8,padding:"7px 16px",cursor:"pointer",fontSize:13,fontWeight:600}} onClick={()=>setDocPreview(null)}>✕ Tutup</button>
            </div>
          </div>
          <div style={{flex:1,background:"#e5e7eb",overflow:"hidden"}}>
            <iframe
              title="Document Preview"
              srcDoc={docPreview.docType==="TUG10" ? buildTUG10HTML(docPreview, katalogList, lokasiList, users) : docPreview.docType==="TUG3" ? buildTUG3HTML(docPreview, katalogList, lokasiList, timMutuList, users) : docPreview.docType==="TUG5" ? buildTUG5HTML(docPreview, katalogList, uitList, users, ultgList) : docPreview.docType==="TUG7" ? buildTUG7HTML(docPreview, katalogList, uitList, uptList, users) : buildTUG9HTML(docPreview, enrichedStocks, users, satpamList)}
              style={{width:"100%",height:"100%",border:"none"}}
            />
          </div>
          <div style={{padding:"8px 18px",background:"#fef3c7",fontSize:11,color:"#92400e",flexShrink:0}}>
            💡 Tips: klik "Unduh File", buka file-nya di browser HP/laptop, lalu pilih menu Print → Save as PDF untuk dapat file PDF asli.
          </div>
        </div>
      )}

    </div>
  );
}
// ─── TUG3Tab — handles the 3-stage Karantina → TUG-4 → Final flow ──────
// ─── KARTU GANTUNG DIGITAL MODAL (TUG-2) ───────────────────────────────
// Two internal views: riwayat (history table, matches the physical card
// format minus the removed "Peti" column) and label (QR + nama barang +
// category color accent, ready to be downloaded/printed and stuck on the item).
// ─── TUG-15 ENGINE ───────────────────────────────────────────────────────
// Builds mutasi rows from all APPROVED transactions within the given filter.
// Returns sorted array of row objects matching TUG-15 column spec.
// ─── ANALYTICS HELPER FUNCTIONS ──────────────────────────────────────────

function getTopPemakaian(txns, stocks, katalogList, mode, n) {
  // Collect all outgoing items from approved TUG-9 and TUG-8
  const outItems = [];
  (txns||[]).forEach(t => {
    if (!["TUG9","TUG8"].includes(t.docType)) return;
    if (t.status !== "APPROVED") return;
    (t.stockItems||[]).forEach(si => {
      const stockRow = (stocks||[]).find(s=>s.id===si.stockId);
      if (!stockRow) return;
      const kat = (katalogList||[]).find(k=>k.id===stockRow.katalogId);
      if (!kat) return;
      outItems.push({ katalogId: kat.id, nama: kat.name, katalog: kat.katalog||"-", satuan: kat.satuan||"-", qty: si.qty||0 });
    });
  });
  // Group by katalogId
  const grouped = {};
  outItems.forEach(item => {
    if (!grouped[item.katalogId]) grouped[item.katalogId] = { ...item, frekuensi: 0, totalQty: 0 };
    grouped[item.katalogId].frekuensi += 1;
    grouped[item.katalogId].totalQty += item.qty;
  });
  const arr = Object.values(grouped);
  arr.sort((a,b) => mode==="frekuensi" ? b.frekuensi-a.frekuensi : b.totalQty-a.totalQty);
  return arr.slice(0, n);
}

function getTopStokTerbanyak(stocks, katalogList, n) {
  // Aggregate qty per katalog (a katalog can be in multiple locations)
  const grouped = {};
  (stocks||[]).forEach(s => {
    const kat = (katalogList||[]).find(k=>k.id===s.katalogId);
    if (!kat) return;
    if (!grouped[kat.id]) grouped[kat.id] = { katalogId:kat.id, nama:kat.name, katalog:kat.katalog||"-", satuan:kat.satuan||"-", jenisBarang:s.jenisBarang||"-", totalQty:0, totalNilai:0 };
    grouped[kat.id].totalQty += s.qty||0;
    grouped[kat.id].totalNilai += (s.qty||0)*(s.price||0);
  });
  const arr = Object.values(grouped).filter(x=>x.totalQty>0);
  arr.sort((a,b)=>b.totalQty-a.totalQty);
  return arr.slice(0, n);
}

function getMaterialAkanHabis(stocks, katalogList, txns, n) {
  // Aggregate qty per katalog
  const grouped = {};
  (stocks||[]).forEach(s => {
    const kat = (katalogList||[]).find(k=>k.id===s.katalogId);
    if (!kat) return;
    if (!grouped[kat.id]) grouped[kat.id] = { katalogId:kat.id, nama:kat.name, katalog:kat.katalog||"-", satuan:kat.satuan||"-", jenisBarang:s.jenisBarang||"-", totalQty:0, minQty:s.minQty||0, totalNilai:0 };
    grouped[kat.id].totalQty += s.qty||0;
    grouped[kat.id].minQty = Math.max(grouped[kat.id].minQty, s.minQty||0);
  });

  // Calculate avg monthly usage from all history
  const usageMap = {};
  (txns||[]).forEach(t => {
    if (!["TUG9","TUG8"].includes(t.docType) || t.status!=="APPROVED") return;
    const ts = t.approvedAt||t.createdAt||0;
    (t.stockItems||[]).forEach(si => {
      const stockRow = (stocks||[]).find(s=>s.id===si.stockId);
      if (!stockRow) return;
      const kid = stockRow.katalogId;
      if (!usageMap[kid]) usageMap[kid] = { totalQty:0, oldest:Date.now() };
      usageMap[kid].totalQty += si.qty||0;
      if (ts < usageMap[kid].oldest) usageMap[kid].oldest = ts;
    });
  });

  const results = Object.values(grouped).map(g => {
    const usage = usageMap[g.katalogId];
    let avgPerBulan = 0;
    let estimasiHari = Infinity;
    if (usage && usage.totalQty > 0) {
      const bulan = Math.max(1, (Date.now()-usage.oldest)/(30*24*60*60*1000));
      avgPerBulan = usage.totalQty / bulan;
      estimasiHari = avgPerBulan > 0 ? Math.round(g.totalQty / (avgPerBulan/30)) : Infinity;
    }
    const isKritis = g.minQty > 0 && g.totalQty <= g.minQty;
    const isPerhatian = estimasiHari <= 30;
    const isWaspada = estimasiHari > 30 && estimasiHari <= 60;
    if (!isKritis && !isPerhatian && !isWaspada) return null;
    let badge = isKritis?"🔴 Kritis":isPerhatian?"🟡 Perhatian":"🟠 Waspada";
    return { ...g, avgPerBulan, estimasiHari, isKritis, badge };
  }).filter(Boolean);

  results.sort((a,b) => {
    if (a.isKritis && !b.isKritis) return -1;
    if (!a.isKritis && b.isKritis) return 1;
    return a.estimasiHari - b.estimasiHari;
  });
  return results.slice(0, n);
}

function buildMutasiRows(txns, katalogList, stocks, filter, lokasiList) {
  const { dateFrom, dateTo, katalogId, jenisBarang, sapStatus, docTypes } = filter;
  const fromMs = dateFrom ? new Date(dateFrom).getTime() : 0;
  const toMs   = dateTo   ? new Date(dateTo).getTime() + 86399999 : Infinity;

  // Helper: resolve katalog object and apply SAP/jenisBarang filters
  function shouldIncludeKatalog(kat, stockRow) {
    if (!kat) return false;
    if (katalogId !== "ALL" && kat.id !== katalogId) return false;
    // Jenis Barang filter (from Data Stok row)
    if (jenisBarang !== "ALL") {
      const jb = stockRow?.jenisBarang || "Persediaan";
      if (jb !== jenisBarang) return false;
    }
    // SAP status filter (from katalog number)
    if (sapStatus !== "ALL") {
      if (getSAPStatus(kat.katalog) !== sapStatus) return false;
    }
    return true;
  }

  const rows = [];

  txns.forEach(t => {
    const approved = t.status==="APPROVED" || t.stage==="APPROVED";
    if (!approved) return;
    if (!docTypes.includes(t.docType)) return;

    const ts = t.approvedAt || t.approvedAtAsman || t.approvedAtMgrLogistik || t.createdAt || 0;
    if (ts < fromMs || ts > toMs) return;

    const tanggal = fmtDateOnly(ts);
    const docNo = t.docNumbers?.[t.docType==="TUG9"?"tug9":t.docType==="TUG8"?"tug8":t.docType==="TUG10"?"tug10":"tug3"] || "-";

    if (t.docType==="TUG9" || t.docType==="TUG8") {
      (t.stockItems||[]).forEach(si => {
        const stockRow = stocks.find(s=>s.id===si.stockId);
        const kat = katalogList.find(k=>k.id===stockRow?.katalogId);
        if (!shouldIncludeKatalog(kat, stockRow)) return;
        rows.push({
          katalog: kat.katalog||"-", deskripsi: kat.name, merk:"-", type:"-",
          satuan: kat.satuan||"-", valuasi: stockRow?.price||0,
          masuk:0, keluar: si.qty||0,
          upt: "UPT Surabaya",
          tugBaDoc: `${t.docType.replace("TUG","TUG-")} / ${docNo}`,
          keterangan: t.namaPekerjaan||"-",
          tanggalMutasi: tanggal, ts,
          katalogId: kat.id,
          sapStatus: getSAPStatus(kat.katalog),
          sapLabel: getSAPLabel(kat.katalog),
          jenisBarang: stockRow?.jenisBarang||"-",
          docType: t.docType,
          lokasiId: stockRow?.lokasiId||"",
          lokasiKode: (lokasiList||[]).find(l=>l.id===stockRow?.lokasiId)?.kode||"-",
        });
      });
    }

    if (t.docType==="TUG10") {
      (t.stockItems||[]).forEach(si => {
        const kat = si.katalogMode==="existing"
          ? katalogList.find(k=>k.id===si.katalogId)
          : { id:si.katalogId||"", katalog:si.katalogBaru||"", name:si.namaBaru, satuan:si.satuanBaru||"-" };
        const fakeStockRow = { jenisBarang: STATUS_RETUR_TO_JENIS[si.statusMaterial]||"Persediaan" };
        if (!shouldIncludeKatalog(kat, fakeStockRow)) return;
        rows.push({
          katalog: kat?.katalog||"-", deskripsi: kat?.name||"-", merk:"-", type:"-",
          satuan: kat?.satuan||"-", valuasi: 0,
          masuk: si.qty||0, keluar: 0,
          upt: "UPT Surabaya",
          tugBaDoc: `TUG-10 / ${docNo}`,
          keterangan: `${t.namaPekerjaan||"-"} — ${si.statusMaterial||""}`,
          tanggalMutasi: tanggal, ts,
          katalogId: kat?.id||"-",
          sapStatus: getSAPStatus(kat?.katalog),
          sapLabel: getSAPLabel(kat?.katalog),
          jenisBarang: fakeStockRow.jenisBarang,
          docType: "TUG10",
          lokasiId: t.lokasiTujuanId||"",
          lokasiKode: (lokasiList||[]).find(l=>l.id===t.lokasiTujuanId)?.kode||"-",
        });
      });
    }

    if (t.docType==="TUG3" && t.stage==="APPROVED") {
      (t.stockItems||[]).forEach(si => {
        const kat = si.katalogMode==="existing"
          ? katalogList.find(k=>k.id===si.katalogId)
          : { id:"-", katalog:si.katalogBaru||"", name:si.namaBaru, satuan:si.satuanBaru||"-" };
        const fakeStockRow = { jenisBarang:"Persediaan" };
        if (!shouldIncludeKatalog(kat, fakeStockRow)) return;
        rows.push({
          katalog: kat?.katalog||"-", deskripsi: kat?.name||"-", merk:"-", type:"-",
          satuan: kat?.satuan||"-", valuasi: si.harga||0,
          masuk: si.qty||0, keluar: 0,
          upt: "UPT Surabaya",
          tugBaDoc: `TUG-3 / ${docNo}`,
          keterangan: `Penerimaan dari ${t.dariSupplier||"-"}`,
          tanggalMutasi: tanggal, ts,
          katalogId: kat?.id||"-",
          sapStatus: getSAPStatus(kat?.katalog),
          sapLabel: getSAPLabel(kat?.katalog),
          jenisBarang: "Persediaan",
          docType: "TUG3",
          lokasiId: si.lokasiTujuanId||"",
          lokasiKode: (lokasiList||[]).find(l=>l.id===si.lokasiTujuanId)?.kode||"-",
        });
      });
    }
  });

  rows.sort((a,b)=>a.ts-b.ts);
  const saldoMap = {};
  return rows.map((r,i) => {
    const prev = saldoMap[r.katalogId] || 0;
    const saldo = prev + r.masuk - r.keluar;
    saldoMap[r.katalogId] = saldo;
    return { ...r, saldoAwal: prev, saldoAkhir: saldo, no: i+1 };
  });
}

// ─── SUPABASE SYNC (TUG-15 → tug15_history) ──────────────────────────────
// Push approved mutasi rows ke Supabase supaya bisa dipakai job ML forecast.
// Pakai anon/publishable key (write diizinkan lewat RLS policy "Public insert"
// yang scope-nya cuma ke tabel katalog & tug15_history — lihat supabase/schema.sql).
// (SUPABASE_URL/SUPABASE_KEY/supabase client didefinisikan di dekat awal file.)
const SYNCED_KEYS_STORAGE = "warnoto_synced_tug15_keys";

function rowSyncKey(r) {
  return `${r.katalogId}|${r.ts}|${r.masuk}|${r.keluar}|${r.docType}`;
}

function getSyncedKeys() {
  try { return new Set(JSON.parse(localStorage.getItem(SYNCED_KEYS_STORAGE) || "[]")); }
  catch { return new Set(); }
}

function saveSyncedKeys(set) {
  localStorage.setItem(SYNCED_KEYS_STORAGE, JSON.stringify([...set]));
}

async function syncTUG15ToSupabase(rows, katalogList) {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    throw new Error("Supabase belum dikonfigurasi (cek VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY di .env)");
  }
  const synced = getSyncedKeys();
  const newRows = rows.filter(r => r.katalogId && r.katalogId!=="-" && !synced.has(rowSyncKey(r)));
  if (newRows.length === 0) return { katalogCount: 0, historyCount: 0 };

  const headers = {
    "apikey": SUPABASE_KEY,
    "Authorization": `Bearer ${SUPABASE_KEY}`,
    "Content-Type": "application/json",
  };

  // 1. Upsert katalog yang dipakai (FK target — harus ada dulu sebelum insert history)
  const katalogIds = [...new Set(newRows.map(r=>r.katalogId))];
  const katalogPayload = katalogIds.map(kid => {
    const kat = katalogList.find(k=>k.id===kid);
    return { id: kid, nama: kat?.name||kid, kategori: kat?.katalog||null, satuan: kat?.satuan||null, jenis_barang: kat?.jenisBarang||null };
  });
  const katRes = await fetch(`${SUPABASE_URL}/rest/v1/katalog?on_conflict=id`, {
    method: "POST",
    headers: { ...headers, "Prefer": "resolution=merge-duplicates" },
    body: JSON.stringify(katalogPayload),
  });
  if (!katRes.ok) throw new Error(`Gagal sync katalog: ${await katRes.text()}`);

  // 2. Insert baris mutasi (MASUK & KELUAR jadi baris terpisah sesuai skema tug15_history).
  // sync_key dibuat dari isi transaksi (bukan random) + upsert on_conflict=sync_key dengan
  // ignore-duplicates — supaya kalau cache lokal kebetulan kosong/di-reset dan baris yang sama
  // terkirim ulang (atau ada race antar tab), Supabase sendiri yang menolak duplikatnya,
  // bukan cuma mengandalkan cache di localStorage.
  const historyPayload = [];
  newRows.forEach(r => {
    const tanggal = new Date(r.ts).toISOString().slice(0,10);
    const baseKey = `${r.katalogId}_${r.ts}_${r.docType}`;
    if (r.masuk > 0) historyPayload.push({ katalog_id: r.katalogId, tanggal, jenis_transaksi: "MASUK", qty: r.masuk, lokasi_id: r.lokasiId||null, lokasi_kode: r.lokasiKode||null, doc_type: r.docType, no_bon: r.tugBaDoc||null, catatan: r.keterangan||null, sync_key: `${baseKey}_MASUK` });
    if (r.keluar > 0) historyPayload.push({ katalog_id: r.katalogId, tanggal, jenis_transaksi: "KELUAR", qty: r.keluar, lokasi_id: r.lokasiId||null, lokasi_kode: r.lokasiKode||null, doc_type: r.docType, no_bon: r.tugBaDoc||null, catatan: r.keterangan||null, sync_key: `${baseKey}_KELUAR` });
  });
  const histRes = await fetch(`${SUPABASE_URL}/rest/v1/tug15_history?on_conflict=sync_key`, {
    method: "POST",
    headers: { ...headers, "Prefer": "resolution=ignore-duplicates" },
    body: JSON.stringify(historyPayload),
  });
  if (!histRes.ok) throw new Error(`Gagal sync tug15_history: ${await histRes.text()}`);

  newRows.forEach(r => synced.add(rowSyncKey(r)));
  saveSyncedKeys(synced);
  return { katalogCount: katalogPayload.length, historyCount: historyPayload.length };
}

// ─── SUPABASE SYNC (Data Stok → stock_current) ───────────────────────────
// Push qty stok terkini (dijumlah per katalog dari semua lokasi) supaya job
// training bisa hitung estimasi_hari_sampai_habis = qty_saat_ini / rata2 prediksi harian.
async function syncStockQtyToSupabase(stocks, katalogList) {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    throw new Error("Supabase belum dikonfigurasi (cek VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY di .env)");
  }
  const headers = {
    "apikey": SUPABASE_KEY,
    "Authorization": `Bearer ${SUPABASE_KEY}`,
    "Content-Type": "application/json",
  };

  // Jumlahkan qty per katalog (1 katalog bisa ada di banyak lokasi/baris stok)
  const qtyMap = {};
  (stocks||[]).forEach(s => {
    if (!s.katalogId) return;
    qtyMap[s.katalogId] = (qtyMap[s.katalogId]||0) + (s.qty||0);
  });
  const katalogIds = Object.keys(qtyMap);
  if (katalogIds.length === 0) return { katalogCount: 0, stockCount: 0 };

  // Pastikan katalog-nya ada dulu (FK target)
  const katalogPayload = katalogIds.map(kid => {
    const kat = katalogList.find(k=>k.id===kid);
    return { id: kid, nama: kat?.name||kid, kategori: kat?.katalog||null, satuan: kat?.satuan||null, jenis_barang: kat?.jenisBarang||null };
  });
  const katRes = await fetch(`${SUPABASE_URL}/rest/v1/katalog?on_conflict=id`, {
    method: "POST",
    headers: { ...headers, "Prefer": "resolution=merge-duplicates" },
    body: JSON.stringify(katalogPayload),
  });
  if (!katRes.ok) throw new Error(`Gagal sync katalog: ${await katRes.text()}`);

  const stockPayload = katalogIds.map(kid => ({ katalog_id: kid, qty: qtyMap[kid], updated_at: new Date().toISOString() }));
  const stockRes = await fetch(`${SUPABASE_URL}/rest/v1/stock_current?on_conflict=katalog_id`, {
    method: "POST",
    headers: { ...headers, "Prefer": "resolution=merge-duplicates" },
    body: JSON.stringify(stockPayload),
  });
  if (!stockRes.ok) throw new Error(`Gagal sync stock_current: ${await stockRes.text()}`);

  return { katalogCount: katalogPayload.length, stockCount: stockPayload.length };
}

// ─── SUPABASE SYNC (Foto Material Keseluruhan → Supabase Storage) ───────
// Upload base64 dataURL ke bucket "material-photos" (lihat supabase/schema.sql
// untuk SQL pembuatan bucket + policy), lalu simpan URL publiknya di
// katalog.foto_keseluruhan_url supaya halaman scan QR (ScanPublicView) bisa
// menampilkan foto tanpa perlu login.
const FOTO_SYNCED_HASHES_STORAGE = "warnoto_synced_foto_hashes";

function dataUrlToBlob(dataUrl) {
  const match = dataUrl.match(/^data:(.*?);base64,(.*)$/);
  if (!match) throw new Error("Format foto tidak valid (bukan base64 dataURL).");
  const mime = match[1] || "image/jpeg";
  const binary = atob(match[2]);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

async function syncFotoMaterialToSupabase(stocks, katalogList) {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    throw new Error("Supabase belum dikonfigurasi (cek VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY di .env)");
  }
  const headers = { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}` };
  let synced = {};
  try { synced = JSON.parse(localStorage.getItem(FOTO_SYNCED_HASHES_STORAGE) || "{}"); } catch { synced = {}; }

  let uploadCount = 0;
  for (const kat of katalogList) {
    const stockRow = (stocks||[]).find(s => s.katalogId === kat.id && s.fotoKeseluruhan);
    if (!stockRow) continue;
    const img = stockRow.fotoKeseluruhan;
    const fingerprint = `${img.length}:${img.slice(0, 60)}`;
    if (synced[kat.id] === fingerprint) continue;

    const blob = dataUrlToBlob(img);
    const ext = (blob.type.split("/")[1] || "jpg").replace("jpeg", "jpg");
    const path = `${kat.id}.${ext}`;

    const upRes = await fetch(`${SUPABASE_URL}/storage/v1/object/material-photos/${path}`, {
      method: "POST",
      headers: { ...headers, "Content-Type": blob.type, "x-upsert": "true" },
      body: blob,
    });
    if (!upRes.ok) throw new Error(`Gagal upload foto ${kat.name}: ${await upRes.text()}`);

    const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/material-photos/${path}`;
    const katRes = await fetch(`${SUPABASE_URL}/rest/v1/katalog?on_conflict=id`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json", "Prefer": "resolution=merge-duplicates" },
      body: JSON.stringify([{ id: kat.id, nama: kat.name||kat.id, kategori: kat.katalog||null, satuan: kat.satuan||null, jenis_barang: stockRow.jenisBarang||null, foto_keseluruhan_url: publicUrl }]),
    });
    if (!katRes.ok) throw new Error(`Gagal simpan URL foto ke katalog: ${await katRes.text()}`);

    synced[kat.id] = fingerprint;
    uploadCount++;
  }
  localStorage.setItem(FOTO_SYNCED_HASHES_STORAGE, JSON.stringify(synced));
  return { uploadCount };
}

// ─── PUBLIC SCAN VIEW (HP scan QR → riwayat TUG-2, tanpa login) ──────────
// Dibuka lewat URL "?scan=<katalogId>". Ambil data langsung dari Supabase
// (anon key, read-only) — TIDAK butuh login/state aplikasi, supaya siapa pun
// yang scan QR fisik di rak bisa langsung lihat riwayat material itu dari HP.
function ScanPublicView({ katalogId }) {
  const [state, setState] = useState({ loading:true, error:"", katalog:null, qty:0, history:[] });

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!SUPABASE_URL || !SUPABASE_KEY) {
        setState({ loading:false, error:"Supabase belum dikonfigurasi.", katalog:null, qty:0, history:[] });
        return;
      }
      const headers = { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}` };
      try {
        const [katRes, histRes, stockRes] = await Promise.all([
          fetch(`${SUPABASE_URL}/rest/v1/katalog?id=eq.${encodeURIComponent(katalogId)}&select=*`, { headers }),
          fetch(`${SUPABASE_URL}/rest/v1/tug15_history?katalog_id=eq.${encodeURIComponent(katalogId)}&select=*&order=tanggal.asc,id.asc`, { headers }),
          fetch(`${SUPABASE_URL}/rest/v1/stock_current?katalog_id=eq.${encodeURIComponent(katalogId)}&select=qty`, { headers }),
        ]);
        if (!katRes.ok || !histRes.ok || !stockRes.ok) throw new Error("Gagal ambil data dari server.");
        const [katArr, histArr, stockArr] = await Promise.all([katRes.json(), histRes.json(), stockRes.json()]);
        if (cancelled) return;
        if (katArr.length === 0) {
          setState({ loading:false, error:"Material dengan kode ini tidak ditemukan.", katalog:null, qty:0, history:[] });
          return;
        }
        // Hitung Sisa MUNDUR dari qty stok nyata saat ini (stock_current, ground
        // truth), sama seperti buildKartuGantungHistory di web — bukan dijumlah
        // maju dari 0, supaya baris terbaru selalu pas dengan qty sebenarnya.
        const currentQty = stockArr[0]?.qty || 0;
        const historyWithSisa = new Array(histArr.length); // histArr sudah urut tanggal.asc,id.asc
        let running = currentQty;
        for (let i = histArr.length - 1; i >= 0; i--) {
          const h = histArr[i];
          historyWithSisa[i] = { ...h, sisa: running };
          running -= (h.jenis_transaksi === "MASUK" ? h.qty : -h.qty);
        }
        setState({ loading:false, error:"", katalog:katArr[0], qty:currentQty, history:historyWithSisa });
      } catch (err) {
        if (!cancelled) setState({ loading:false, error:err.message, katalog:null, qty:0, history:[] });
      }
    }
    load();
    return () => { cancelled = true; };
  }, [katalogId]);

  const wrap = { minHeight:"100vh", background:"#f1f5f9", fontFamily:"'Inter',system-ui,sans-serif", padding:16 };
  const card = { background:"white", borderRadius:14, padding:18, boxShadow:"0 4px 16px rgba(0,0,0,0.08)", maxWidth:560, margin:"0 auto" };

  if (state.loading) return <div style={wrap}><div style={card}>⏳ Memuat riwayat...</div></div>;
  if (state.error) return <div style={wrap}><div style={card}><b style={{color:"#dc2626"}}>⚠️ {state.error}</b></div></div>;

  const { katalog, qty, history } = state;
  return (
    <div style={wrap}>
      <div style={card}>
        <div style={{fontSize:11,color:"#6b7280",fontWeight:700,letterSpacing:.5}}>PT PLN (PERSERO) UPT SURABAYA — WARNOTO</div>
        <h2 style={{fontSize:17,fontWeight:800,margin:"4px 0 2px"}}>🏷️ {katalog.nama}</h2>
        <div style={{fontSize:12,color:"#6b7280",marginBottom:14}}>No. Katalog: {katalog.kategori||"-"} • Satuan: {katalog.satuan||"-"} • {katalog.jenis_barang||"-"}</div>
        {katalog.foto_keseluruhan_url && (
          <img src={katalog.foto_keseluruhan_url} alt="Foto Material Keseluruhan" style={{width:"100%",maxHeight:220,objectFit:"cover",borderRadius:10,marginBottom:14,border:"1px solid #e5e7eb"}}/>
        )}
        <div style={{background:"#ecfdf5",border:"1px solid #a7f3d0",borderRadius:10,padding:"10px 14px",marginBottom:16,textAlign:"center"}}>
          <div style={{fontSize:11,color:"#047857",fontWeight:700}}>QTY STOK SAAT INI</div>
          <div style={{fontSize:26,fontWeight:800,color:"#047857"}}>{fmtNum(qty)}</div>
        </div>
        <div style={{fontSize:12,fontWeight:800,color:"#003087",marginBottom:8}}>📋 Riwayat Mutasi (TUG-2)</div>
        {history.length===0 && <div style={{fontSize:12,color:"#9ca3af",textAlign:"center",padding:14}}>Belum ada riwayat mutasi untuk material ini.</div>}
        {history.length>0 && (
          <div style={{overflowX:"auto"}}>
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:10.5}}>
              <thead>
                <tr style={{background:"#003087",color:"white"}}>
                  <th style={{padding:"5px 6px",textAlign:"left"}}>TGL</th>
                  <th style={{padding:"5px 6px",textAlign:"left"}}>NO. BON</th>
                  <th style={{padding:"5px 6px",textAlign:"center"}}>MASUK</th>
                  <th style={{padding:"5px 6px",textAlign:"center"}}>KELUAR</th>
                  <th style={{padding:"5px 6px",textAlign:"center"}}>SISA</th>
                  <th style={{padding:"5px 6px",textAlign:"left"}}>RAK</th>
                  <th style={{padding:"5px 6px",textAlign:"left"}}>CATATAN</th>
                </tr>
              </thead>
              <tbody>
                {history.map((h,i)=>(
                  <tr key={i} style={{borderBottom:"1px solid #f1f5f9"}}>
                    <td style={{padding:"4px 6px"}}>{fmtDateOnly(h.tanggal)}</td>
                    <td style={{padding:"4px 6px"}}>{h.no_bon||"-"}</td>
                    <td style={{padding:"4px 6px",textAlign:"center",color:"#16a34a",fontWeight:700}}>{h.jenis_transaksi==="MASUK"?fmtNum(h.qty):""}</td>
                    <td style={{padding:"4px 6px",textAlign:"center",color:"#dc2626",fontWeight:700}}>{h.jenis_transaksi==="KELUAR"?fmtNum(h.qty):""}</td>
                    <td style={{padding:"4px 6px",textAlign:"center",fontWeight:700}}>{fmtNum(h.sisa)}</td>
                    <td style={{padding:"4px 6px"}}>{h.lokasi_kode||"-"}</td>
                    <td style={{padding:"4px 6px",color:"#6b7280"}}>{h.catatan||"-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function buildTUG15HTML(rows, filter, katalogList) {
  const { dateFrom, dateTo } = filter;
  const periodLabel = dateFrom && dateTo ? `${dateFrom} s/d ${dateTo}` : dateFrom ? `Mulai ${dateFrom}` : dateTo ? `S/d ${dateTo}` : "Semua Periode";
  const filterKatalogLabel = filter.katalogId==="ALL" ? "Semua Barang" : (katalogList.find(k=>k.id===filter.katalogId)?.name||"-");
  const filterSAPLabel = filter.sapStatus==="ALL" ? "SAP + Non-SAP" : filter.sapStatus;
  const filterJenisLabel = filter.jenisBarang==="ALL" ? "Semua Jenis" : filter.jenisBarang;
  const generated = fmtDateOnly(Date.now());
  const totalMasuk = rows.reduce((a,r)=>a+r.masuk, 0);
  const totalKeluar = rows.reduce((a,r)=>a+r.keluar, 0);

  const itemRows = rows.map(r=>`<tr>
    <td style="text-align:center">${r.no}</td>
    <td>${r.katalog}</td>
    <td>${r.deskripsi}</td>
    <td><span style="padding:2px 6px;border-radius:10px;font-size:8px;font-weight:700;background:${r.sapStatus==="SAP"?"#dbeafe":"#f3f4f6"};color:${r.sapStatus==="SAP"?"#1d4ed8":"#6b7280"}">${r.sapStatus||"-"}</span></td>
    <td>${r.jenisBarang||"-"}</td>
    <td>${r.merk}</td>
    <td>${r.type}</td>
    <td style="text-align:center">${r.satuan}</td>
    <td style="text-align:right">${r.valuasi>0?fmtRp(r.valuasi):"-"}</td>
    <td style="text-align:center">${fmtNum(r.saldoAwal)||0}</td>
    <td style="text-align:center;color:#16a34a;font-weight:${r.masuk>0?"700":"400"}">${r.masuk>0?fmtNum(r.masuk):"-"}</td>
    <td style="text-align:center;color:#dc2626;font-weight:${r.keluar>0?"700":"400"}">${r.keluar>0?fmtNum(r.keluar):"-"}</td>
    <td style="text-align:center;font-weight:700">${fmtNum(r.saldoAkhir)}</td>
    <td>${r.upt}</td>
    <td style="font-size:9px">${r.tugBaDoc}</td>
    <td style="font-size:9px">${r.keterangan}</td>
    <td style="text-align:center">${r.tanggalMutasi}</td>
  </tr>`).join("");

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>TUG-15 Laporan Mutasi Stok</title>
<style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:Arial,sans-serif;font-size:9px;color:#111;background:#e5e7eb}.page{padding:20px;background:white;max-width:1400px;margin:0 auto 16px}.topbar{height:5px;background:linear-gradient(90deg,#00377a,#0098da);margin-bottom:8px}.doctitle{text-align:center;margin-bottom:10px}.doctitle h2{font-size:13px;font-weight:800}.doctitle .sub{font-size:10px;color:#555;margin-top:2px}table.info{width:100%;margin-bottom:12px;font-size:9.5px}table.info td{padding:2px 4px}table.items{width:100%;border-collapse:collapse;margin-bottom:14px}table.items th{background:#003087;color:white;padding:5px 4px;font-size:8.5px;text-align:center;border:1px solid #ccc}table.items td{padding:4px 4px;border:1px solid #ddd;font-size:8.5px;vertical-align:top}.total-row td{background:#f1f5f9;font-weight:700}.print-bar{position:sticky;top:0;background:#003087;color:white;padding:8px 14px;text-align:center;font-size:12px;font-weight:700;z-index:10}.print-bar button{background:#16a34a;color:white;border:none;border-radius:6px;padding:6px 16px;font-size:12px;cursor:pointer;margin-left:10px}@media print{.print-bar{display:none}body{background:white}.page{max-width:none}}</style></head><body>
<div class="print-bar">📊 TUG-15 Laporan Mutasi Stok siap cetak <button onclick="window.print()">🖨️ Print / Save as PDF</button></div>
<div class="page">
<div class="topbar"></div>
<div class="doctitle">
  <h2>PT PLN (PERSERO) — ${UIT}</h2>
  <div class="sub">LAPORAN MUTASI STOK MATERIAL — TUG 15</div>
  <div class="sub" style="margin-top:4px">Periode: ${periodLabel} | Barang: ${filterKatalogLabel} | Kategori: ${filterSAPLabel} | Jenis: ${filterJenisLabel} | Digenerate: ${generated}</div>
</div>
<table class="items">
  <thead><tr>
    <th style="width:3%">No</th>
    <th style="width:7%">No Katalog</th>
    <th style="width:13%">Deskripsi Material</th>
    <th style="width:5%">Status SAP</th>
    <th style="width:5%">Jenis Barang</th>
    <th style="width:4%">Merk</th>
    <th style="width:4%">Type</th>
    <th style="width:4%">Satuan</th>
    <th style="width:6%">Valuasi</th>
    <th style="width:5%">Saldo Awal</th>
    <th style="width:5%">Stok Masuk</th>
    <th style="width:5%">Stok Keluar</th>
    <th style="width:5%">Saldo Akhir</th>
    <th style="width:6%">UPT</th>
    <th style="width:9%">TUG/BA & Tgl</th>
    <th style="width:9%">Keterangan</th>
    <th style="width:6%">Tanggal Mutasi</th>
  </tr></thead>
  <tbody>
    ${itemRows}
    <tr class="total-row">
      <td colspan="10" style="text-align:right;padding:5px 8px">TOTAL PERIODE</td>
      <td style="text-align:center;color:#16a34a">${fmtNum(totalMasuk)}</td>
      <td style="text-align:center;color:#dc2626">${fmtNum(totalKeluar)}</td>
      <td colspan="5"></td>
    </tr>
  </tbody>
</table>
<div style="font-size:9px;color:#6b7280;text-align:right">Total ${rows.length} baris mutasi • Digenerate otomatis dari sistem PLN TUG Digital</div>
</div></body></html>`;
}

// ─── TUG-15 TAB COMPONENT ────────────────────────────────────────────────
// ─── RENCANA KEDATANGAN BARANG TAB ───────────────────────────────────────
// ─── DASHBOARD ANALITIK SECTION (3 Widget) ───────────────────────────────
// ─── SHARED DASHBOARD BUILDING BLOCKS ────────────────────────────────────

function KPISaldoCards({ stocks, C, sty }) {
  const nilaiCadang         = stocks.filter(s=>s.jenisBarang==="Cadang").reduce((a,s)=>a+(s.qty||0)*(s.price||0),0);
  const nilaiPersediaan     = stocks.filter(s=>s.jenisBarang==="Persediaan").reduce((a,s)=>a+(s.qty||0)*(s.price||0),0);
  const nilaiPersediaanBursa= stocks.filter(s=>s.jenisBarang==="Persediaan Bursa").reduce((a,s)=>a+(s.qty||0)*(s.price||0),0);
  const nilaiPreMemory      = stocks.filter(s=>s.jenisBarang==="Pre Memory").reduce((a,s)=>a+(s.qty||0)*(s.price||0),0);

  const cards = [
    { label:"Saldo Material Cadang",          nilai:nilaiCadang,          count:stocks.filter(s=>s.jenisBarang==="Cadang").length,          color:"#dc2626", bg:"#fff5f5", icon:"🔴" },
    { label:"Saldo Material Persediaan",       nilai:nilaiPersediaan,      count:stocks.filter(s=>s.jenisBarang==="Persediaan").length,       color:"#16a34a", bg:"#f0fdf4", icon:"🟢" },
    { label:"Saldo Persediaan Bursa",          nilai:nilaiPersediaanBursa, count:stocks.filter(s=>s.jenisBarang==="Persediaan Bursa").length, color:"#ea580c", bg:"#fff7ed", icon:"🟠" },
    { label:"Saldo Pre Memory",                nilai:nilaiPreMemory,       count:stocks.filter(s=>s.jenisBarang==="Pre Memory").length,       color:"#1d4ed8", bg:"#eff6ff", icon:"🔵" },
  ];

  return (
    <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:12,marginBottom:20}}>
      {cards.map((c,i)=>(
        <div key={i} style={{...sty.card,borderLeft:`4px solid ${c.color}`,background:c.bg,padding:12}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontSize:9,color:C.muted,fontWeight:700,textTransform:"uppercase",marginBottom:3,lineHeight:1.3}}>{c.label}</div>
              <div style={{fontSize:16,fontWeight:900,color:c.color}}>{fmtRp(c.nilai)}</div>
              <div style={{fontSize:10,color:C.muted,marginTop:2}}>{c.count} item aktif</div>
            </div>
            <div style={{fontSize:20,marginLeft:6,flexShrink:0}}>{c.icon}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function PendingWidget({ myPendingApprovals, C, sty, setTab }) {
  if (myPendingApprovals.length===0) return null;
  return (
    <div style={{...sty.card,borderLeft:`4px solid #f59e0b`,marginBottom:16}}>
      <h3 style={{fontSize:13,fontWeight:700,color:"#92400e",marginBottom:10}}>⏳ Butuh Tindakan ({myPendingApprovals.length})</h3>
      {myPendingApprovals.slice(0,4).map(t=>{
        const docNo = t.docNumbers?.[t.docType==="TUG9"?"tug9":t.docType==="TUG8"?"tug8":t.docType==="TUG10"?"tug10":t.docType==="TUG5"?"tug5":t.docType==="TUG7"?"tug7":"tug3"]||t.id;
        const label = t.docType==="TUG5"?t.keteranganUmum||"Permintaan Material":t.docType==="TUG7"?`TUG-7 → ${t.unitPenerima||"UPT"}`:t.namaPekerjaan||"-";
        return (
          <div key={t.id} style={{padding:"7px 0",borderBottom:`1px solid ${C.border}`,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <div>
              <div style={{fontSize:12,fontWeight:600}}>{label}</div>
              <div style={{fontSize:10,color:"#0098da"}}>{t.docType.replace("TUG","TUG-")} • {docNo}</div>
            </div>
            <button style={sty.btn("primary","sm")} onClick={()=>setTab("approval")}>Review</button>
          </div>
        );
      })}
      {myPendingApprovals.length>4 && <div style={{fontSize:11,color:C.muted,marginTop:6,textAlign:"center"}}>+{myPendingApprovals.length-4} lainnya</div>}
    </div>
  );
}

function RencanaWidget({ rencanaKedatanganList, C, sty, setTab }) {
  const today = Date.now();
  const plus30 = today + 30*24*60*60*1000;
  const upcoming = rencanaKedatanganList
    .flatMap(r=>(r.items||[]).map(item=>({...item, noKontrak:r.noKontrak, supplier:r.supplier, tanggalSerahTerima:r.tanggalSerahTerima})))
    .filter(item=>{const d=item.tanggalSerahTerima?new Date(item.tanggalSerahTerima).getTime():0; return d<=plus30;})
    .sort((a,b)=>new Date(a.tanggalSerahTerima)-new Date(b.tanggalSerahTerima));
  return (
    <div style={{...sty.card,marginBottom:16}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
        <h3 style={{fontSize:13,fontWeight:700}}>📅 Rencana Kedatangan (30 Hari)</h3>
        <button style={sty.btn("ghost","sm")} onClick={()=>setTab("rencana")}>Lihat Semua</button>
      </div>
      {upcoming.length===0 && (
        <div style={{textAlign:"center",padding:"16px 0",color:C.muted,fontSize:12}}>
          Tidak ada rencana kedatangan barang dalam 30 hari ke depan.
        </div>
      )}
      {upcoming.slice(0,5).map((item,i)=>{
        const isLate = item.tanggalSerahTerima && new Date(item.tanggalSerahTerima).getTime()<today;
        return (
          <div key={i} style={{padding:"6px 0",borderBottom:`1px solid ${C.border}`,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <div>
              <div style={{fontSize:11,fontWeight:600}}>{item.namaBarang}</div>
              <div style={{fontSize:10,color:C.muted}}>{item.supplier} • {item.jumlah} {item.satuan}</div>
            </div>
            <div style={{textAlign:"right"}}>
              <div style={{fontSize:11,fontWeight:700,color:isLate?"#dc2626":"#16a34a"}}>{item.tanggalSerahTerima||"-"}</div>
              {isLate && <div style={{fontSize:9,color:"#dc2626",fontWeight:700}}>⚠️ Terlambat</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// Ringkasan 1 transaksi untuk widget "Transaksi Terbaru" di Dashboard: No TUG,
// pekerjaan, tanggal, lokasi terkait, dan pihak (penerima/supplier) — beda
// makna per docType (TUG9/8 keluar ke pihak luar, TUG10 retur internal,
// TUG3 penerimaan dari supplier).
function summarizeTxnDashboard(t, stocks, lokasiList) {
  const docKey = t.docType==="TUG9"?"tug9":t.docType==="TUG8"?"tug8":t.docType==="TUG10"?"tug10":t.docType==="TUG5"?"tug5":t.docType==="TUG7"?"tug7":"tug3";
  const noTugLabel = `${t.docType.replace("TUG","TUG-")} / ${t.docNumbers?.[docKey]||t.id}`;
  const pekerjaan = t.namaPekerjaan || t.keteranganUmum || (t.docType==="TUG7"?`Pemakaian Unit Lain → ${t.unitPenerima||"UPT"}`:"-");
  const tanggal = fmtDate(t.createdAt);
  let lokasiLabel = "-", pihakLabel = "-";
  if (t.docType==="TUG9" || t.docType==="TUG8") {
    const stockRow = (stocks||[]).find(s=>s.id===t.stockItems?.[0]?.stockId);
    lokasiLabel = stockRow?.lokasi || "-";
    pihakLabel = t.penerimaNama ? `${t.penerimaNama}${t.penerimaUnit?` (${t.penerimaUnit})`:""}` : "-";
  } else if (t.docType==="TUG10") {
    lokasiLabel = (lokasiList||[]).find(l=>l.id===t.lokasiTujuanId)?.kode || "-";
    pihakLabel = "Retur material (internal)";
  } else if (t.docType==="TUG3") {
    lokasiLabel = (lokasiList||[]).find(l=>l.id===t.stockItems?.[0]?.lokasiTujuanId)?.kode || "-";
    pihakLabel = t.dariSupplier || "-";
  } else if (t.docType==="TUG7") {
    pihakLabel = t.unitPenerima || "-";
  } else if (t.docType==="TUG5") {
    pihakLabel = "Permintaan internal UPT/UIT";
  }
  return { noTugLabel, pekerjaan, tanggal, lokasiLabel, pihakLabel };
}

// ─── DASHBOARD DEFAULT (Admin, TL, Viewer, Pengadaan) ────────────────────
function getEquipmentCategory(e) {
  const n = String(e.nama||"").toUpperCase().replace(/\s+/g," ").trim();
  if (n.includes("CRANE")) return "crane";
  if (n.includes("FORKLIFT")) return "forklift";
  if (n.includes("MANLIFT")) return "manlift";
  return "pendukung";
}

function HeavyEquipmentDashboardSummary({ equipmentList = [], loans = [], C, sty, setTab, currentUser }) {
  const appUptShort = (typeof UPT !== "undefined" ? UPT : "").replace(/^UPT\s+/i,"").trim();
  const myUpt = currentUser?.upt || currentUser?.uptName || appUptShort || "";
  const isMSB = ["MSB","Manager UIT"].includes(currentUser?.role);
  const scopedEquipment = isMSB ? equipmentList : equipmentList.filter(e=>e.upt===myUpt);
  const scopedLoans = isMSB ? loans : loans.filter(l=>
    (getHeavyEquipmentLoanOwnerUpt(l)===myUpt)||(getHeavyEquipmentLoanRequesterUpt(l)===myUpt)
  );
  const scopeLabel = isMSB ? "Semua UPT" : (myUpt || "UPT");
  const overdueLoans = scopedLoans.filter(l=>getHeavyEquipmentLoanRuntimeStatus(l)==="OVERDUE");
  const pendingLoans = scopedLoans.filter(isPendingHeavyEquipmentLoan);
  const borrowedLoans = scopedLoans.filter(l=>getHeavyEquipmentLoanRuntimeStatus(l)==="DIPINJAM");
  const availableCount = scopedEquipment.filter(e=>e.availabilityStatus!=="DIPINJAM").length;
  const issueCount = scopedEquipment.filter(e=>["PERLU_SERVICE","BUTUH_PERBAIKAN","BUTUH_PEREMAJAAN"].includes(e.statusAlat)).length;
  const catIcons = {
    crane:(
      <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
        <rect x="12" y="4" width="2.5" height="18" rx="1" fill="currentColor"/>
        <rect x="2" y="4" width="12" height="2" rx="1" fill="currentColor" opacity=".85"/>
        <line x1="12" y1="5" x2="24" y2="22" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        <rect x="10" y="20" width="6" height="5" rx="1" fill="currentColor" opacity=".7"/>
        <rect x="5" y="22" width="16" height="2.5" rx="1" fill="currentColor" opacity=".5"/>
      </svg>
    ),
    forklift:(
      <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
        <rect x="2" y="10" width="14" height="10" rx="2" fill="currentColor" opacity=".85"/>
        <rect x="16" y="14" width="8" height="6" rx="1" fill="currentColor" opacity=".6"/>
        <rect x="2" y="3" width="2.5" height="14" rx="1" fill="currentColor"/>
        <rect x="6" y="3" width="2.5" height="14" rx="1" fill="currentColor"/>
        <circle cx="6" cy="23" r="2.5" fill="currentColor"/>
        <circle cx="18" cy="23" r="2.5" fill="currentColor"/>
      </svg>
    ),
    manlift:(
      <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
        <rect x="9" y="2" width="10" height="8" rx="1.5" fill="currentColor" opacity=".85"/>
        <rect x="11" y="10" width="6" height="10" rx="1" fill="currentColor" opacity=".7"/>
        <rect x="6" y="18" width="16" height="4" rx="1.5" fill="currentColor" opacity=".5"/>
        <circle cx="9" cy="25" r="2" fill="currentColor"/>
        <circle cx="19" cy="25" r="2" fill="currentColor"/>
      </svg>
    ),
    pendukung:(
      <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
        <rect x="2" y="12" width="18" height="4" rx="1" fill="currentColor" opacity=".85"/>
        <path d="M18 14 Q22 14 22 8 L24 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none"/>
        <rect x="3" y="16" width="6" height="8" rx="0.5" fill="currentColor" opacity=".7"/>
        <rect x="11" y="16" width="6" height="8" rx="0.5" fill="currentColor" opacity=".7"/>
        <circle cx="5" cy="25" r="2" fill="currentColor"/>
        <circle cx="14" cy="25" r="2" fill="currentColor"/>
      </svg>
    ),
  };
  const catBreakdown = [
    {key:"crane",    label:"Crane"},
    {key:"forklift", label:"Forklift"},
    {key:"manlift",  label:"Manlift"},
    {key:"pendukung",label:"Alat Pendukung"},
  ].map(c=>({...c, count:scopedEquipment.filter(e=>getEquipmentCategory(e)===c.key).length}));

  if (equipmentList.length === 0 && loans.length === 0) return null;
  return (
    <div style={{...sty.card,marginBottom:16,borderLeft:`4px solid ${overdueLoans.length?C.red:C.accent}`,cursor:"pointer"}} onClick={()=>setTab("heavyEquipment")}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:12,marginBottom:12}}>
        <div>
          <div style={{fontSize:14,fontWeight:900}}>🚜 Ringkasan Alat Berat</div>
          <div style={{fontSize:11,color:C.muted}}>Scope: <b>{scopeLabel}</b> — status peminjaman, ketersediaan &amp; kondisi alat.</div>
        </div>
        <button style={sty.btn("ghost","sm")} onClick={(e)=>{e.stopPropagation(); setTab("heavyEquipment");}}>Buka Menu</button>
      </div>

      {/* Kategori alat dengan icon */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8,marginBottom:12}}>
        {catBreakdown.map(c=>(
          <div key={c.key} style={{display:"flex",flexDirection:"column",alignItems:"center",gap:4,padding:"10px 8px",background:"#f0f9ff",border:`1px solid #bae6fd`,borderRadius:10}}>
            <span style={{color:C.accent}}>{catIcons[c.key]}</span>
            <span style={{fontSize:20,fontWeight:900,color:C.accent}}>{c.count}</span>
            <span style={{fontSize:10,fontWeight:700,color:C.muted,textAlign:"center"}}>{c.label}</span>
          </div>
        ))}
      </div>

      {/* KPI status */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(100px,1fr))",gap:8}}>
        {[
          {label:"Total", val:scopedEquipment.length, color:C.accent},
          {label:"Tersedia", val:availableCount, color:C.green},
          {label:"Dipinjam", val:borrowedLoans.length, color:"#c2410c"},
          {label:"Overdue", val:overdueLoans.length, color:overdueLoans.length?C.red:C.green},
          {label:"Pending", val:pendingLoans.length, color:pendingLoans.length?"#92400e":C.green},
          {label:"Perlu Tindakan", val:issueCount, color:issueCount?C.red:C.green},
        ].map(k=>(
          <div key={k.label} style={{background:"#f9fafb",border:`1px solid ${C.border}`,borderRadius:8,padding:10}}>
            <div style={{fontSize:10,color:C.muted,fontWeight:800,textTransform:"uppercase"}}>{k.label}</div>
            <div style={{fontSize:20,fontWeight:900,color:k.color}}>{k.val}</div>
          </div>
        ))}
      </div>
      {/* Dipinjam aktif list */}
      {(borrowedLoans.length > 0 || overdueLoans.length > 0) && (
        <div style={{marginTop:10,display:"flex",flexDirection:"column",gap:4}}>
          {[...overdueLoans, ...borrowedLoans].slice(0,3).map(l=>{
            const status = getHeavyEquipmentLoanRuntimeStatus(l);
            const ownerUpt = getHeavyEquipmentLoanOwnerUpt(l);
            const requesterUpt = getHeavyEquipmentLoanRequesterUpt(l);
            const returnDate = getHeavyEquipmentLoanReturnDate(l);
            const jobName = getHeavyEquipmentLoanJobName(l);
            return (
              <div key={l.id} style={{fontSize:11,display:"flex",gap:6,alignItems:"center",padding:"4px 8px",borderRadius:6,background:status==="OVERDUE"?"#fef2f2":"#fff7ed"}}>
                <span style={{fontWeight:700,color:status==="OVERDUE"?C.red:"#c2410c",minWidth:54}}>{status==="OVERDUE"?"⚠ OVERDUE":"📌 Dipinjam"}</span>
                <span style={{color:C.text}}>{l.equipmentId||"-"}</span>
                <span style={{color:C.muted}}>→ {requesterUpt}</span>
                {!isManager && ownerUpt!==myUpt && <span style={{color:C.muted,fontStyle:"italic"}}>dari {ownerUpt}</span>}
                <span style={{marginLeft:"auto",color:C.muted}}>s/d {returnDate||"-"}</span>
              </div>
            );
          })}
          {(borrowedLoans.length+overdueLoans.length)>3&&<div style={{fontSize:11,color:C.muted,paddingLeft:8}}>+{borrowedLoans.length+overdueLoans.length-3} peminjaman lainnya</div>}
        </div>
      )}
    </div>
  );
}

function DashboardDefault({ stocks, txns, katalogList, lokasiList, rencanaKedatanganList, myPendingApprovals, lowStocks, totalVal, topN, setTopN, pemakaianMode, setPemakaianMode, C, sty, setTab, currentUser, heavyEquipmentList, heavyEquipmentLoans, materialCadangData }) {
  const [dashModal, setDashModal] = useState(null); // null | "totalItem" | "nilai" | "kritis" | "tindakan"

  const jenisBreakdown = JENIS_BARANG.map(jb => ({
    jenis: jb,
    count: stocks.filter(s=>s.jenisBarang===jb).length,
    qty: stocks.filter(s=>s.jenisBarang===jb).reduce((a,s)=>a+(s.qty||0),0),
    nilai: stocks.filter(s=>s.jenisBarang===jb).reduce((a,s)=>a+(s.qty||0)*(s.price||0),0),
  })).filter(r=>r.count>0);

  const kpiCards = [
    {key:"totalItem",label:"Total Item",val:stocks.length,icon:"📦",color:C.accent,sub:"jenis barang"},
    {key:"nilai",label:"Nilai Inventory",val:fmtRp(totalVal),icon:"💰",color:"#16a34a",sub:"estimasi total"},
    {key:"kritis",label:"Stok Kritis",val:lowStocks.length,icon:"⚠️",color:lowStocks.length>0?"#dc2626":"#16a34a",sub:"perlu reorder"},
    {key:"tindakan",label:"Butuh Tindakan",val:myPendingApprovals.length,icon:"⏳",color:myPendingApprovals.length>0?"#f59e0b":"#16a34a",sub:"menunggu kamu"},
  ];

  return (
    <div>
      <div style={{marginBottom:16}}>
        <h1 style={{fontSize:22,fontWeight:900}}>Dashboard Gudang</h1>
        <p style={{color:C.muted,fontSize:13}}>{WAREHOUSE} • {new Date().toLocaleDateString("id-ID",{weekday:"long",day:"numeric",month:"long",year:"numeric"})}</p>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:14,marginBottom:20}}>
        {kpiCards.map((s,i)=>(
          <div key={i} style={{...sty.card,borderLeft:`4px solid ${s.color}`,cursor:"pointer"}} onClick={()=>setDashModal(s.key)} title="Klik untuk lihat ringkasan">
            <div style={{display:"flex",justifyContent:"space-between"}}>
              <div><div style={{fontSize:20,fontWeight:900,color:s.color}}>{s.val}</div><div style={{fontSize:12,fontWeight:700,marginTop:2}}>{s.label}</div><div style={{fontSize:10,color:C.muted}}>{s.sub}</div></div>
              <div style={{fontSize:26}}>{s.icon}</div>
            </div>
          </div>
        ))}
      </div>
      <KPISaldoCards stocks={stocks} C={C} sty={sty}/>
      <HeavyEquipmentDashboardSummary equipmentList={heavyEquipmentList} loans={heavyEquipmentLoans} C={C} sty={sty} setTab={setTab} currentUser={currentUser}/>
      {(()=>{
        const results = materialCadangData?.analyses?.slice(-1)[0]?.results || [];
        if (!results.length) return null;
        const cadang = results.filter(r=>r.treatment==="Material Cadang");
        const aman = cadang.filter(r=>r.currentQty>=r.recommendedQty&&r.recommendedQty>0).length;
        const kurang = cadang.filter(r=>r.currentQty>0&&r.currentQty<r.recommendedQty).length;
        const kosong = cadang.filter(r=>r.recommendedQty>0&&r.currentQty===0).length;
        const gapVal = cadang.reduce((s,r)=>s+r.gapQty*(r.harga||0),0);
        const topGap = [...cadang].filter(r=>r.gapQty>0).sort((a,b)=>b.gapQty*b.harga-a.gapQty*a.harga).slice(0,3);
        return (
          <div style={{...sty.card,marginBottom:16,borderLeft:`4px solid #7c3aed`}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
              <div style={{fontWeight:800,fontSize:13,color:"#7c3aed"}}>🔩 Material Cadang — Ringkasan Analisis</div>
              <button style={{...sty.btn("ghost","sm"),fontSize:11}} onClick={()=>setTab("forecastStok")}>Lihat detail →</button>
            </div>
            <div style={{display:"flex",gap:20,flexWrap:"wrap",marginBottom:10}}>
              {[
                {label:"Total Analisis",val:cadang.length,color:C.accent},
                {label:"Aman ✅",val:aman,color:C.green},
                {label:"Kurang ⚠️",val:kurang,color:"#f59e0b"},
                {label:"Kosong 🔴",val:kosong,color:C.red},
                {label:"Est. Gap Nilai",val:"Rp "+fmtNum(gapVal),color:"#7c3aed"},
              ].map(k=>(
                <div key={k.label}>
                  <div style={{fontSize:10,color:C.muted}}>{k.label}</div>
                  <div style={{fontSize:15,fontWeight:800,color:k.color}}>{k.val}</div>
                </div>
              ))}
            </div>
            {topGap.length>0 && <div style={{fontSize:11,color:C.muted}}>
              Prioritas: {topGap.map(r=><span key={r.noKat} style={{marginRight:8}}><b style={{color:C.red}}>{r.noKat}</b> gap {r.gapQty} pcs</span>)}
            </div>}
          </div>
        );
      })()}
      <div style={{display:"grid",gridTemplateColumns:"2fr 1fr",gap:16,marginBottom:20}}>
        <div>
          <PendingWidget myPendingApprovals={myPendingApprovals} C={C} sty={sty} setTab={setTab}/>
          <div style={sty.card}>
            <h3 style={{fontSize:13,fontWeight:700,marginBottom:10}}>Transaksi Terbaru</h3>
            {txns.length===0 && <div style={{textAlign:"center",padding:"16px 0",color:C.muted,fontSize:12}}>Belum ada transaksi.</div>}
            {txns.slice().sort((a,b)=>b.createdAt-a.createdAt).slice(0,6).map(t=>{
              const r = summarizeTxnDashboard(t, stocks, lokasiList);
              return (
                <div key={t.id} style={{padding:"8px 0",borderBottom:`1px solid ${C.border}`}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:11,fontWeight:700}}>{r.noTugLabel}</div>
                      <div style={{fontSize:11,color:C.text,marginTop:1}}>{r.pekerjaan}</div>
                    </div>
                    <span style={sty.statusBadge(t.status)}>{t.status}</span>
                  </div>
                  <div style={{fontSize:10,color:C.muted,marginTop:3}}>
                    📅 {r.tanggal} • 📍 {r.lokasiLabel} • 🏢 {r.pihakLabel}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        <div><RencanaWidget rencanaKedatanganList={rencanaKedatanganList} C={C} sty={sty} setTab={setTab}/></div>
      </div>
      <DashboardAnalitikSection txns={txns} stocks={stocks} katalogList={katalogList} topN={topN} setTopN={setTopN} pemakaianMode={pemakaianMode} setPemakaianMode={setPemakaianMode} C={C} sty={sty}/>

      {/* ── POPUP RINGKASAN KPI ── */}
      {dashModal && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1500,padding:20}} onClick={()=>setDashModal(null)}>
          <div style={{...sty.card,width:480,maxHeight:"80vh",overflowY:"auto"}} onClick={e=>e.stopPropagation()}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
              <h3 style={{fontSize:15,fontWeight:800}}>
                {dashModal==="totalItem"&&"📦 Ringkasan Total Item"}
                {dashModal==="nilai"&&"💰 Ringkasan Nilai Inventory"}
                {dashModal==="kritis"&&"⚠️ Material Stok Kritis"}
                {dashModal==="tindakan"&&"⏳ Butuh Tindakan Anda"}
              </h3>
              <button style={{background:"transparent",border:"none",fontSize:18,cursor:"pointer",color:C.muted}} onClick={()=>setDashModal(null)}>✕</button>
            </div>

            {(dashModal==="totalItem"||dashModal==="nilai") && (
              <div>
                {jenisBreakdown.length===0 && <div style={{textAlign:"center",color:C.muted,fontSize:12,padding:20}}>Belum ada data stok.</div>}
                {jenisBreakdown.map(r=>(
                  <div key={r.jenis} style={{display:"flex",justifyContent:"space-between",padding:"8px 0",borderBottom:`1px solid ${C.border}`}}>
                    <div style={{fontSize:12,fontWeight:600}}>{r.jenis}</div>
                    <div style={{textAlign:"right"}}>
                      <div style={{fontSize:12,fontWeight:700}}>{dashModal==="nilai"?fmtRp(r.nilai):`${r.count} item`}</div>
                      <div style={{fontSize:10,color:C.muted}}>{fmtNum(r.qty)} qty total</div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {dashModal==="kritis" && (
              <div>
                {lowStocks.length===0 && <div style={{textAlign:"center",color:C.muted,fontSize:12,padding:20}}>✅ Tidak ada material kritis saat ini.</div>}
                {lowStocks.map(s=>(
                  <div key={s.id} style={{display:"flex",justifyContent:"space-between",padding:"8px 0",borderBottom:`1px solid ${C.border}`}}>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:12,fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{s.name}</div>
                      <div style={{fontSize:10,color:C.muted}}>📍 {s.lokasi||"-"}</div>
                    </div>
                    <div style={{textAlign:"right",flexShrink:0,marginLeft:8}}>
                      <div style={{fontSize:12,fontWeight:700,color:"#dc2626"}}>{fmtNum(s.qty)} / min {fmtNum(s.minQty)}</div>
                      <div style={{fontSize:10,color:C.muted}}>{s.unit}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {dashModal==="tindakan" && (
              <div>
                {myPendingApprovals.length===0 && <div style={{textAlign:"center",color:C.muted,fontSize:12,padding:20}}>✅ Tidak ada yang menunggu tindakan Anda.</div>}
                {myPendingApprovals.map(t=>{
                  const r = summarizeTxnDashboard(t, stocks, lokasiList);
                  return (
                    <div key={t.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"8px 0",borderBottom:`1px solid ${C.border}`}}>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{fontSize:12,fontWeight:600}}>{r.noTugLabel}</div>
                        <div style={{fontSize:10,color:C.muted}}>{r.pekerjaan}</div>
                      </div>
                      <button style={sty.btn("primary","sm")} onClick={()=>{setDashModal(null);setTab("approval");}}>Review</button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── DASHBOARD ASMAN (Operasional UPT Surabaya) ──────────────────────────
function DashboardAsman({ stocks, txns, katalogList, rencanaKedatanganList, myPendingApprovals, topN, setTopN, pemakaianMode, setPemakaianMode, C, sty, setTab, heavyEquipmentList, heavyEquipmentLoans, currentUser }) {
  const nilaiTotal = stocks.reduce((a,s)=>a+(s.qty||0)*(s.price||0),0);
  const stokKritis = stocks.filter(s=>s.minQty>0 && s.qty<=s.minQty);
  const akanHabis = getMaterialAkanHabis(stocks, katalogList, txns, 5);
  const txnBulanIni = txns.filter(t=>{const d=new Date(t.createdAt); const now=new Date(); return d.getMonth()===now.getMonth()&&d.getFullYear()===now.getFullYear();});

  return (
    <div>
      <div style={{marginBottom:16}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
          <div>
            <h1 style={{fontSize:22,fontWeight:900}}>Dashboard Operasional — Asman Konstruksi</h1>
            <p style={{color:C.muted,fontSize:13}}>UPT Surabaya • {new Date().toLocaleDateString("id-ID",{weekday:"long",day:"numeric",month:"long",year:"numeric"})}</p>
          </div>
          <span style={{padding:"4px 12px",borderRadius:20,background:"#dbeafe",color:"#1d4ed8",fontSize:11,fontWeight:700}}>UPT Surabaya</span>
        </div>
      </div>

      {/* KPI Row */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:12,marginBottom:16}}>
        {[
          {label:"Total Nilai Inventori",val:fmtRp(nilaiTotal),icon:"💰",color:"#16a34a"},
          {label:"Total Item Stok",val:stocks.length,icon:"📦",color:C.accent},
          {label:"Stok Kritis",val:stokKritis.length,icon:"🔴",color:stokKritis.length>0?"#dc2626":"#16a34a"},
          {label:"Transaksi Bulan Ini",val:txnBulanIni.length,icon:"📋",color:"#7c3aed"},
          {label:"Butuh Approval Saya",val:myPendingApprovals.length,icon:"⏳",color:myPendingApprovals.length>0?"#f59e0b":"#16a34a"},
        ].map((s,i)=>(
          <div key={i} style={{...sty.card,borderTop:`3px solid ${s.color}`,padding:12}}>
            <div style={{fontSize:18,marginBottom:4}}>{s.icon}</div>
            <div style={{fontSize:16,fontWeight:900,color:s.color}}>{s.val}</div>
            <div style={{fontSize:10,color:C.muted,marginTop:2}}>{s.label}</div>
          </div>
        ))}
      </div>

      <KPISaldoCards stocks={stocks} C={C} sty={sty}/>

      <div style={{display:"grid",gridTemplateColumns:"2fr 1fr",gap:16,marginBottom:16}}>
        <div>
          <PendingWidget myPendingApprovals={myPendingApprovals} C={C} sty={sty} setTab={setTab}/>
          <HeavyEquipmentDashboardSummary equipmentList={heavyEquipmentList} loans={heavyEquipmentLoans} C={C} sty={sty} setTab={setTab} currentUser={currentUser}/>
          {/* Material Kritis */}
          {stokKritis.length>0 && (
            <div style={{...sty.card,borderLeft:`4px solid #dc2626`,marginBottom:16}}>
              <h3 style={{fontSize:13,fontWeight:700,color:"#dc2626",marginBottom:10}}>🔴 Material Stok Kritis ({stokKritis.length})</h3>
              {stokKritis.slice(0,5).map((s,i)=>(
                <div key={i} style={{padding:"6px 0",borderBottom:`1px solid ${C.border}`,display:"flex",justifyContent:"space-between"}}>
                  <div><div style={{fontSize:11,fontWeight:600}}>{s.name}</div><div style={{fontSize:10,color:C.muted}}>{s.katalog}</div></div>
                  <div style={{textAlign:"right"}}><div style={{fontSize:12,fontWeight:700,color:"#dc2626"}}>{fmtNum(s.qty)} {s.unit}</div><div style={{fontSize:10,color:C.muted}}>min: {fmtNum(s.minQty)}</div></div>
                </div>
              ))}
            </div>
          )}
        </div>
        <div>
          <RencanaWidget rencanaKedatanganList={rencanaKedatanganList} C={C} sty={sty} setTab={setTab}/>
          {/* Material Akan Habis */}
          {akanHabis.length>0 && (
            <div style={{...sty.card}}>
              <h3 style={{fontSize:13,fontWeight:700,marginBottom:10}}>⚠️ Akan Habis</h3>
              {akanHabis.slice(0,4).map((item,i)=>(
                <div key={i} style={{padding:"6px 0",borderBottom:`1px solid ${C.border}`}}>
                  <div style={{display:"flex",justifyContent:"space-between"}}>
                    <div style={{fontSize:11,fontWeight:600,flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{item.nama}</div>
                    <span style={{fontSize:10,fontWeight:700,color:item.isKritis?"#dc2626":"#d97706",marginLeft:6}}>{item.badge}</span>
                  </div>
                  <div style={{fontSize:10,color:C.muted}}>{fmtNum(item.totalQty)} {item.satuan} • {item.estimasiHari===Infinity?"tidak ada data":`~${item.estimasiHari} hari`}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <DashboardAnalitikSection txns={txns} stocks={stocks} katalogList={katalogList} topN={topN} setTopN={setTopN} pemakaianMode={pemakaianMode} setPemakaianMode={setPemakaianMode} C={C} sty={sty}/>
    </div>
  );
}

// ─── DASHBOARD MANAGER (Eksekutif Multi-UPT) ─────────────────────────────
function DashboardManager({ stocks, txns, katalogList, uptList, rencanaKedatanganList, myPendingApprovals, topN, setTopN, pemakaianMode, setPemakaianMode, C, sty, setTab, heavyEquipmentList, heavyEquipmentLoans }) {
  const nilaiTotal = stocks.reduce((a,s)=>a+(s.qty||0)*(s.price||0),0);
  const nilaiCadang = stocks.filter(s=>s.jenisBarang==="Cadang").reduce((a,s)=>a+(s.qty||0)*(s.price||0),0);
  const nilaiPersediaan = stocks.filter(s=>s.jenisBarang==="Persediaan").reduce((a,s)=>a+(s.qty||0)*(s.price||0),0);
  const nilaiPersediaanBursa = stocks.filter(s=>s.jenisBarang==="Persediaan Bursa").reduce((a,s)=>a+(s.qty||0)*(s.price||0),0);
  const nilaiPreMemory = stocks.filter(s=>s.jenisBarang==="Pre Memory").reduce((a,s)=>a+(s.qty||0)*(s.price||0),0);
  const stokKritis = stocks.filter(s=>s.minQty>0 && s.qty<=s.minQty);
  const terlambat = rencanaKedatanganList.flatMap(r=>(r.items||[]).map(i=>({...i,tanggalSerahTerima:r.tanggalSerahTerima}))).filter(i=>i.tanggalSerahTerima && new Date(i.tanggalSerahTerima).getTime()<Date.now());
  const txnBulanIni = txns.filter(t=>{const d=new Date(t.createdAt); const now=new Date(); return d.getMonth()===now.getMonth()&&d.getFullYear()===now.getFullYear();});

  return (
    <div>
      {/* Header Eksekutif */}
      <div style={{background:"linear-gradient(135deg,#003087,#0098da)",borderRadius:12,padding:"20px 24px",marginBottom:20,color:"white"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
          <div>
            <div style={{fontSize:11,opacity:0.7,fontWeight:600,textTransform:"uppercase",letterSpacing:1,marginBottom:4}}>PT PLN (Persero) UIT-JBM</div>
            <div style={{fontSize:20,fontWeight:900}}>Dashboard Eksekutif Material</div>
            <div style={{fontSize:12,opacity:0.8,marginTop:4}}>{new Date().toLocaleDateString("id-ID",{weekday:"long",day:"numeric",month:"long",year:"numeric"})}</div>
          </div>
          <div style={{textAlign:"right"}}>
            <div style={{fontSize:11,opacity:0.7,marginBottom:4}}>Total Nilai Inventori (UPT Surabaya)</div>
            <div style={{fontSize:26,fontWeight:900,marginBottom:8}}>{fmtRp(nilaiTotal)}</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6}}>
              {[
                {label:"Cadang",val:nilaiCadang,color:"#fca5a5"},
                {label:"Persediaan",val:nilaiPersediaan,color:"#86efac"},
                {label:"Bursa",val:nilaiPersediaanBursa,color:"#fdba74"},
                {label:"Pre Memory",val:nilaiPreMemory,color:"#93c5fd"},
              ].map((b,i)=>(
                <div key={i} style={{background:"rgba(255,255,255,0.15)",borderRadius:6,padding:"4px 8px",textAlign:"right"}}>
                  <div style={{fontSize:9,opacity:0.8}}>{b.label}</div>
                  <div style={{fontSize:11,fontWeight:700,color:b.color}}>{fmtRp(b.val)}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* KPI Row */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:12,marginBottom:16}}>
        {[
          {label:"Total Item Stok",val:stocks.length,icon:"📦",color:C.accent},
          {label:"Stok Kritis",val:stokKritis.length,icon:"🔴",color:stokKritis.length>0?"#dc2626":"#16a34a"},
          {label:"TUG Pending",val:myPendingApprovals.length,icon:"⏳",color:myPendingApprovals.length>0?"#f59e0b":"#16a34a"},
          {label:"Rencana Terlambat",val:terlambat.length,icon:"⚠️",color:terlambat.length>0?"#dc2626":"#16a34a"},
          {label:"Transaksi Bulan Ini",val:txnBulanIni.length,icon:"📋",color:"#7c3aed"},
        ].map((s,i)=>(
          <div key={i} style={{...sty.card,borderTop:`3px solid ${s.color}`,padding:12}}>
            <div style={{fontSize:18,marginBottom:4}}>{s.icon}</div>
            <div style={{fontSize:18,fontWeight:900,color:s.color}}>{s.val}</div>
            <div style={{fontSize:10,color:C.muted,marginTop:2}}>{s.label}</div>
          </div>
        ))}
      </div>

      <KPISaldoCards stocks={stocks} C={C} sty={sty}/>
      <HeavyEquipmentDashboardSummary equipmentList={heavyEquipmentList} loans={heavyEquipmentLoans} C={C} sty={sty} setTab={setTab} currentUser={currentUser}/>

      {/* Tabel per UPT */}
      <div style={{...sty.card,marginBottom:20}}>
        <h3 style={{fontSize:14,fontWeight:800,marginBottom:14}}>📊 Ringkasan per UPT — UIT JBM</h3>
        <div style={{overflowX:"auto"}}>
          <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
            <thead>
              <tr style={{background:"#003087",color:"white"}}>
                {["UPT","Total Item","Nilai Stok","Stok Kritis","Aktivitas Bulan Ini","Status"].map(h=>(
                  <th key={h} style={{padding:"8px 10px",textAlign:"left",fontWeight:600}}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {uptList.map((upt,i)=>{
                const isSurabaya = upt.id==="UPT-SBY";
                const uptStocks = isSurabaya ? stocks : [];
                const uptNilai = uptStocks.reduce((a,s)=>a+(s.qty||0)*(s.price||0),0);
                const uptKritis = uptStocks.filter(s=>s.minQty>0&&s.qty<=s.minQty).length;
                const uptTxn = isSurabaya ? txnBulanIni.length : 0;
                return (
                  <tr key={upt.id} style={{borderBottom:`1px solid ${C.border}`,background:i%2===0?"white":"#f9fafb"}}>
                    <td style={{padding:"10px 10px",fontWeight:700}}>{upt.nama}</td>
                    <td style={{padding:"10px 10px"}}>{isSurabaya?stocks.length:"—"}</td>
                    <td style={{padding:"10px 10px"}}>{isSurabaya?fmtRp(uptNilai):"—"}</td>
                    <td style={{padding:"10px 10px",color:uptKritis>0?"#dc2626":C.muted}}>{isSurabaya?uptKritis:"—"}</td>
                    <td style={{padding:"10px 10px"}}>{isSurabaya?`${uptTxn} TUG`:"—"}</td>
                    <td style={{padding:"10px 10px"}}>
                      {isSurabaya
                        ? <span style={{padding:"3px 8px",borderRadius:20,fontSize:10,fontWeight:700,background:"#dcfce7",color:"#166534"}}>🟢 Aktif</span>
                        : <span style={{padding:"3px 8px",borderRadius:20,fontSize:10,fontWeight:700,background:"#f3f4f6",color:"#6b7280"}}>⚪ Belum terhubung</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div style={{fontSize:10,color:C.muted,marginTop:8}}>* Data real hanya tersedia untuk UPT Surabaya (Fase 1). UPT lain akan terhubung di Fase 2.</div>
      </div>

      <div style={{display:"grid",gridTemplateColumns:"2fr 1fr",gap:16,marginBottom:16}}>
        <div>
          <PendingWidget myPendingApprovals={myPendingApprovals} C={C} sty={sty} setTab={setTab}/>
          {/* Compliance — TUG pending lama */}
          {(()=>{
            const overdue = txns.filter(t=>t.status==="PENDING"&&(Date.now()-t.createdAt)>2*24*60*60*1000);
            if (overdue.length===0) return null;
            return (
              <div style={{...sty.card,borderLeft:`4px solid #dc2626`}}>
                <h3 style={{fontSize:13,fontWeight:700,color:"#dc2626",marginBottom:10}}>🚨 TUG Pending &gt; 2 Hari ({overdue.length})</h3>
                {overdue.slice(0,4).map((t,i)=>{
                  const days = Math.floor((Date.now()-t.createdAt)/(24*60*60*1000));
                  return (
                    <div key={i} style={{padding:"6px 0",borderBottom:`1px solid ${C.border}`,display:"flex",justifyContent:"space-between"}}>
                      <div><div style={{fontSize:11,fontWeight:600}}>{t.namaPekerjaan}</div><div style={{fontSize:10,color:C.muted}}>{t.docType.replace("TUG","TUG-")}</div></div>
                      <div style={{fontSize:11,fontWeight:700,color:"#dc2626"}}>{days} hari</div>
                    </div>
                  );
                })}
              </div>
            );
          })()}
        </div>
        <div><RencanaWidget rencanaKedatanganList={rencanaKedatanganList} C={C} sty={sty} setTab={setTab}/></div>
      </div>

      <DashboardAnalitikSection txns={txns} stocks={stocks} katalogList={katalogList} topN={topN} setTopN={setTopN} pemakaianMode={pemakaianMode} setPemakaianMode={setPemakaianMode} C={C} sty={sty}/>
    </div>
  );
}

// ─── AI AGENT PAGE (Forecast + Chat terintegrasi) ────────────────────────
// Panel kurasi FAQ Bot (Admin only) — tampilkan pertanyaan nyata dari bot WA/Telegram
// yang dijawab buruk (kena feedback 👎 atau jawabannya kedengaran "menyerah"), Admin
// tulis jawaban resmi → tersimpan ke ai_faq_curated → ikut di-embed ke rag_chunks
// (lewat syncRagChunks) supaya pertanyaan serupa besok-besok langsung dijawab benar.
const BAD_ANSWER_KEYWORDS = ["maaf","tidak ada data","tidak bisa","tidak tersedia","kendala","tidak ditemukan"];
function AIFaqPanel({ sty, C, onSaved }) {
  const [loading, setLoading] = useState(true);
  const [badLogs, setBadLogs] = useState([]);
  const [faqList, setFaqList] = useState([]);
  const [answeringId, setAnsweringId] = useState(null);
  const [answerDraft, setAnswerDraft] = useState("");
  const [saving, setSaving] = useState(false);

  async function loadData() {
    setLoading(true);
    try {
      const [{data: waLogs}, {data: tgLogs}, {data: faq}] = await Promise.all([
        supabase.from("wa_agent_logs").select("*").eq("intent","rag_query").order("created_at",{ascending:false}).limit(100),
        supabase.from("tg_agent_logs").select("*").eq("intent","rag_query").order("created_at",{ascending:false}).limit(100),
        supabase.from("ai_faq_curated").select("*").eq("is_active",true).order("created_at",{ascending:false}),
      ]);
      const combined = [
        ...(waLogs||[]).map(l=>({...l, _table:"wa_agent_logs", _channel:"WA"})),
        ...(tgLogs||[]).map(l=>({...l, _table:"tg_agent_logs", _channel:"Telegram"})),
      ];
      const bad = combined.filter(l=>
        l.feedback==="down" ||
        BAD_ANSWER_KEYWORDS.some(kw=>(l.answer_summary||"").toLowerCase().includes(kw))
      ).sort((a,b)=>new Date(b.created_at)-new Date(a.created_at));
      setBadLogs(bad);
      setFaqList(faq||[]);
    } catch (e) {
      console.error("Gagal load data FAQ panel:", e);
    }
    setLoading(false);
  }

  useEffect(() => { loadData(); }, []);

  async function saveFaq(log) {
    if (!answerDraft.trim()) return;
    setSaving(true);
    try {
      const { error } = await supabase.from("ai_faq_curated").insert({
        pertanyaan: log.message_in,
        jawaban: answerDraft.trim(),
        source_log_table: log._table,
        source_log_id: log.id,
        created_by: "web-admin",
      });
      if (error) throw error;
      setAnsweringId(null); setAnswerDraft("");
      await loadData();
      if (onSaved) await onSaved();
    } catch (e) {
      alert("Gagal simpan FAQ: " + e.message);
    }
    setSaving(false);
  }

  async function deactivateFaq(id) {
    await supabase.from("ai_faq_curated").update({is_active:false}).eq("id", id);
    loadData();
  }

  return (
    <div style={{...sty.card, marginBottom:16}}>
      <div style={{fontWeight:800,fontSize:14,marginBottom:4}}>🧠 Kelola FAQ Bot</div>
      <p style={{fontSize:12,color:C.muted,marginBottom:12}}>Pertanyaan nyata dari bot WA/Telegram yang dijawab kurang baik — tulis jawaban resmi supaya besok bot langsung tahu.</p>

      {loading ? <div style={{fontSize:12,color:C.muted}}>Memuat...</div> : (
        <>
          <div style={{fontSize:12,fontWeight:700,marginBottom:8}}>⚠️ Perlu Jawaban Resmi ({badLogs.length})</div>
          {badLogs.length===0 && <div style={{fontSize:12,color:C.muted,marginBottom:16}}>Tidak ada pertanyaan yang perlu diperbaiki saat ini. 👍</div>}
          {badLogs.slice(0,20).map(log=>(
            <div key={`${log._table}_${log.id}`} style={{border:`1px solid ${C.border}`,borderRadius:8,padding:10,marginBottom:8,background:"#fffbeb"}}>
              <div style={{display:"flex",justifyContent:"space-between",gap:8,marginBottom:4}}>
                <div style={{fontSize:12,fontWeight:700}}>{log.message_in}</div>
                <span style={{fontSize:10,color:C.muted,whiteSpace:"nowrap"}}>{log._channel} • {log.display_name||log.telegram_username||log.phone_number||"-"}</span>
              </div>
              <div style={{fontSize:11,color:C.muted,marginBottom:6}}>Jawaban bot: "{(log.answer_summary||"").slice(0,150)}{(log.answer_summary||"").length>150?"...":""}"{log.feedback==="down" && " (ditandai 👎 oleh user)"}</div>
              {answeringId===`${log._table}_${log.id}` ? (
                <div>
                  <textarea style={{...sty.input,minHeight:70,marginBottom:6}} placeholder="Tulis jawaban resmi yang benar..." value={answerDraft} onChange={e=>setAnswerDraft(e.target.value)}/>
                  <div style={{display:"flex",gap:6}}>
                    <button style={sty.btn("success","sm")} disabled={saving} onClick={()=>saveFaq(log)}>{saving?"Menyimpan...":"💾 Simpan Jawaban Resmi"}</button>
                    <button style={sty.btn("ghost","sm")} onClick={()=>{setAnsweringId(null);setAnswerDraft("");}}>Batal</button>
                  </div>
                </div>
              ) : (
                <button style={sty.btn("ghost","sm")} onClick={()=>{setAnsweringId(`${log._table}_${log.id}`);setAnswerDraft("");}}>✏️ Tulis Jawaban Resmi</button>
              )}
            </div>
          ))}

          <div style={{fontSize:12,fontWeight:700,marginTop:16,marginBottom:8}}>📚 FAQ Terkurasi ({faqList.length})</div>
          {faqList.length===0 && <div style={{fontSize:12,color:C.muted}}>Belum ada FAQ yang dikurasi.</div>}
          {faqList.map(f=>(
            <div key={f.id} style={{display:"flex",justifyContent:"space-between",gap:8,padding:"8px 0",borderBottom:`1px solid ${C.border}`}}>
              <div>
                <div style={{fontSize:12,fontWeight:700}}>{f.pertanyaan}</div>
                <div style={{fontSize:11,color:C.muted}}>{f.jawaban}</div>
              </div>
              <button style={{...sty.btn("ghost","sm"),flexShrink:0}} onClick={()=>deactivateFaq(f.id)}>🗑️ Nonaktifkan</button>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

function AIAgentPage({ enrichedStocks, katalogList, stocks, txns,
  rencanaKedatanganList, chatHistory, setChatHistory, chatInput, setChatInput,
  chatLoading, chatEndRef, sendChat, syncRagChunks, syncWarnotoState, syncStocksSnapshot, ragSyncing, ragLastSync, currentUser, C, sty }) {

  const [showFaqPanel, setShowFaqPanel] = useState(false);

  const SUGGESTED = [
    "Analisa kondisi stok sekarang dan material yang perlu perhatian",
    "Material apa yang paling sering dipakai 3 bulan terakhir?",
    "Ada berapa TUG yang masih pending approval?",
    "Material apa yang stoknya hampir habis?",
    "Forecast kebutuhan material 3 bulan ke depan",
    "Kapan terakhir kita terima material dari rencana kedatangan?",
  ];

  return (
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:16,flexWrap:"wrap",gap:10}}>
        <div>
          <h1 style={{fontSize:22,fontWeight:900}}>🤖 AI Agent</h1>
          <p style={{color:C.muted,fontSize:13}}>Powered by Claude AI • Data real-time {WAREHOUSE} • Untuk prediksi stok/forecast, lihat menu "📈 Forecast Stok"</p>
        </div>
        {currentUser?.role==="ADMIN" && (
          <div style={{textAlign:"right"}}>
            <div style={{display:"flex",gap:8,justifyContent:"flex-end",flexWrap:"wrap"}}>
              <button style={{...sty.btn("ghost","sm"),opacity:ragSyncing?0.6:1}} disabled={ragSyncing} onClick={async()=>{await syncStocksSnapshot(); await syncRagChunks(); await syncWarnotoState();}}>
                {ragSyncing?"Menyinkron...":"🔄 Sync Knowledge Base (RAG + Bot WA/Telegram)"}
              </button>
              <button style={sty.btn(showFaqPanel?"primary":"ghost","sm")} onClick={()=>setShowFaqPanel(v=>!v)}>
                🧠 Kelola FAQ Bot
              </button>
            </div>
            {ragLastSync && <div style={{fontSize:10,color:C.muted,marginTop:4}}>Terakhir sync: {fmtDate(ragLastSync)}</div>}
          </div>
        )}
      </div>

      {showFaqPanel && currentUser?.role==="ADMIN" && <AIFaqPanel sty={sty} C={C} onSaved={async()=>{await syncRagChunks(true);}}/>}

      {/* ── CHAT AI ── */}
      <div style={{display:"flex",flexDirection:"column",height:"calc(100vh - 180px)"}}>
          {/* Suggested questions */}
          {chatHistory.length<=1 && (
            <div style={{marginBottom:12}}>
              <div style={{fontSize:11,color:C.muted,fontWeight:700,marginBottom:8}}>💡 PERTANYAAN YANG SERING DITANYAKAN</div>
              <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                {SUGGESTED.map((q,i)=>(
                  <button key={i} style={{padding:"6px 12px",borderRadius:20,border:`1px solid ${C.border}`,background:"white",color:C.text,fontSize:11,cursor:"pointer",transition:"all 0.15s"}}
                    onClick={()=>sendChat(q)}>{q}</button>
                ))}
              </div>
            </div>
          )}
          {/* Chat history */}
          <div style={{flex:1,overflowY:"auto",background:"white",borderRadius:12,padding:16,border:`1px solid ${C.border}`,marginBottom:10}}>
            {chatHistory.map((m,i)=>(
              <div key={i} style={{display:"flex",justifyContent:m.role==="user"?"flex-end":"flex-start",marginBottom:14}}>
                {m.role==="ai" && (
                  <div style={{width:34,height:34,borderRadius:"50%",background:"#003087",display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,marginRight:8,flexShrink:0}}>⚡</div>
                )}
                <div style={{maxWidth:"78%",padding:"10px 14px",
                  borderRadius:m.role==="user"?"12px 12px 2px 12px":"12px 12px 12px 2px",
                  background:m.role==="user"?C.accent:"#f8fafc",
                  color:m.role==="user"?"white":C.text,
                  fontSize:12,lineHeight:1.7,whiteSpace:"pre-wrap",
                  border:m.role==="ai"?`1px solid ${C.border}`:"none"}}>
                  {m.text}
                </div>
                {m.role==="user" && (
                  <div style={{width:34,height:34,borderRadius:"50%",background:C.accent,display:"flex",alignItems:"center",justifyContent:"center",fontSize:14,marginLeft:8,flexShrink:0,color:"white",fontWeight:700}}>U</div>
                )}
              </div>
            ))}
            {chatLoading && (
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                <div style={{width:34,height:34,borderRadius:"50%",background:"#003087",display:"flex",alignItems:"center",justifyContent:"center"}}>⚡</div>
                <div style={{background:"#f8fafc",border:`1px solid ${C.border}`,borderRadius:12,padding:"10px 14px",fontSize:12,color:C.muted}}>
                  Menganalisa data gudang... ⏳
                </div>
              </div>
            )}
            <div ref={chatEndRef}/>
          </div>
          {/* Input */}
          <div style={{display:"flex",gap:8}}>
            <button style={{...sty.btn("ghost","sm"),flexShrink:0}} onClick={()=>setChatHistory([{role:"ai",text:`Halo! Ada yang bisa saya bantu tentang data gudang ${WAREHOUSE}?`}])}>🗑️</button>
            <input style={{...sty.input,flex:1}}
              placeholder="Tanya AI tentang stok, forecast, atau analisa gudang... (Enter untuk kirim)"
              value={chatInput}
              onChange={e=>setChatInput(e.target.value)}
              onKeyDown={e=>e.key==="Enter"&&!e.shiftKey&&sendChat()}/>
            <button style={sty.btn("primary")} onClick={()=>sendChat()} disabled={chatLoading}>
              {chatLoading?"...":"Kirim 🚀"}
            </button>
          </div>
        </div>
    </div>
  );
}

// ─── FORECAST STOK PAGE — heuristik lokal + AI Groq (kiri) vs ML Prophet (kanan), berdampingan ──
function ForecastStokPage({ katalogList, stocks, txns, forecastDetail, setForecastDetail,
  forecastDetailResult, setForecastDetailResult, forecastDetailLoading, forecastDrillDown,
  setTab, sendChat,
  materialCadangData, setMaterialCadangData, maraReference, setMaraReference,
  catalogMasterRef, setCatalogMasterRef, saveToCloud, showToast, currentUser,
  C, sty }) {
  const [forecastView, setForecastView] = useState("forecast"); // "forecast" | "material_cadang"

  // Prediksi ML (Prophet, dihitung tiap malam via GitHub Actions job
  // ml/train_forecast.py) — diambil dari forecast_predictions, terpisah dari
  // heuristik lokal getRiskBadge() di bawah. Cuma terisi untuk katalog yang
  // sudah punya >=10 baris histori KELUAR (lihat MIN_DATA_POINTS di skrip);
  // katalog lain akan tampil "Belum cukup data historis" sampai cukup.
  const [mlForecasts, setMlForecasts] = useState({}); // katalogId -> {estimasiHari, avgQtyPrediksiHarian, modelVersion, updatedAt, series:[qty,...]}
  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase.from("forecast_predictions").select("katalog_id,tanggal_prediksi,qty_prediksi,estimasi_hari_sampai_habis,model_version,updated_at").order("tanggal_prediksi", { ascending: true });
      if (cancelled || error || !data) return;
      const grouped = {};
      data.forEach(row => {
        if (!grouped[row.katalog_id]) grouped[row.katalog_id] = { qtySum:0, qtyCount:0, estimasiHari:row.estimasi_hari_sampai_habis, modelVersion:row.model_version, updatedAt:row.updated_at, series:[] };
        const g = grouped[row.katalog_id];
        g.qtySum += row.qty_prediksi||0; g.qtyCount += 1;
        g.series.push(row.qty_prediksi||0);
        if (row.estimasi_hari_sampai_habis != null) g.estimasiHari = row.estimasi_hari_sampai_habis;
      });
      const result = {};
      Object.entries(grouped).forEach(([kid,g]) => { result[kid] = { estimasiHari:g.estimasiHari, avgQtyPrediksiHarian:g.qtyCount>0?g.qtySum/g.qtyCount:0, modelVersion:g.modelVersion, updatedAt:g.updatedAt, series:g.series }; });
      setMlForecasts(result);
    })();
    return () => { cancelled = true; };
  }, []);

  // Heuristik lokal: rata-rata pemakaian historis TUG-9/8 vs stok saat ini
  function getRiskBadge(katalog) {
    const stockRows = stocks.filter(s=>s.katalogId===katalog.id);
    const totalQty = stockRows.reduce((a,s)=>a+(s.qty||0),0);
    const minQty = stockRows.reduce((a,s)=>Math.max(a,s.minQty||0),0);

    const usageItems = [];
    txns.filter(t=>["TUG9","TUG8"].includes(t.docType)&&t.status==="APPROVED").forEach(t=>{
      (t.stockItems||[]).forEach(si=>{
        const s = stocks.find(x=>x.id===si.stockId);
        if(s?.katalogId===katalog.id) usageItems.push({qty:si.qty||0,ts:t.approvedAt||t.createdAt});
      });
    });
    const totalUsage = usageItems.reduce((a,i)=>a+i.qty,0);
    const oldest = usageItems.length?Math.min(...usageItems.map(i=>i.ts)):Date.now();
    const bulan = Math.max(1,(Date.now()-oldest)/(30*24*60*60*1000));
    const avgPerBulan = totalUsage/bulan;
    const estimasiHari = avgPerBulan>0?Math.round(totalQty/(avgPerBulan/30)):Infinity;

    const isKritis = minQty>0&&totalQty<=minQty;
    if(isKritis||estimasiHari<=30) return {label:"🔴 KRITIS",color:"#dc2626",bg:"#fee2e2",hari:estimasiHari};
    if(estimasiHari<=90) return {label:"🟡 PERHATIAN",color:"#d97706",bg:"#fef3c7",hari:estimasiHari};
    if(estimasiHari<=180) return {label:"🟠 WASPADA",color:"#ea580c",bg:"#fff7ed",hari:estimasiHari};
    return {label:"🟢 AMAN",color:"#16a34a",bg:"#f0fdf4",hari:estimasiHari};
  }

  function lanjutkanDiChat(prompt) {
    setTab("ai");
    setTimeout(()=>sendChat(prompt), 100);
  }

  const [statusFilter, setStatusFilter] = useState("ALL"); // "ALL" | label risk (cth "🔴 KRITIS")

  const katalogWithStock = katalogList.filter(k=>stocks.some(s=>s.katalogId===k.id));

  // Hitung risk sekali per katalog (dipakai untuk render kartu + filter + counter)
  const enriched = katalogWithStock.map(kat => {
    const stockRows = stocks.filter(s=>s.katalogId===kat.id);
    return { kat, stockRows, risk: getRiskBadge(kat), ml: mlForecasts[kat.id] };
  });
  const STATUS_FILTERS = ["🔴 KRITIS","🟡 PERHATIAN","🟠 WASPADA","🟢 AMAN"];
  const statusCounts = STATUS_FILTERS.reduce((acc,label) => { acc[label] = enriched.filter(e=>e.risk.label===label).length; return acc; }, {});
  const visibleList = statusFilter==="ALL" ? enriched : enriched.filter(e=>e.risk.label===statusFilter);

  // ── DETAIL DRILL-DOWN ──
  if (forecastDetail) {
    const kat = forecastDetail.kat;
    const ml = mlForecasts[kat.id];
    return (
      <div>
        <button style={{...sty.btn("ghost","sm"),marginBottom:14}} onClick={()=>{setForecastDetail(null);setForecastDetailResult(null);}}>← Kembali ke Semua Material</button>
        <div style={{...sty.card,marginBottom:16}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:8}}>
            <div>
              <div style={{fontSize:18,fontWeight:900}}>{kat.name}</div>
              <div style={{fontSize:11,color:C.muted,fontFamily:"monospace"}}>{kat.katalog} • {kat.satuan}</div>
            </div>
            <button style={sty.btn("ghost","sm")} onClick={()=>lanjutkanDiChat(`Berikan saran pengadaan untuk material: ${kat.name}`)}>💬 Lanjutkan di Chat AI</button>
          </div>
        </div>

        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(340px,1fr))",gap:16}}>
          {/* KIRI: Heuristik + AI Groq */}
          <div style={{...sty.card,borderTop:"4px solid #2563eb"}}>
            <div style={{fontSize:12,fontWeight:800,color:"#2563eb",marginBottom:10}}>📊 Analisis Cepat (Heuristik + AI)</div>
            {forecastDetailLoading && (
              <div style={{textAlign:"center",padding:30}}>
                <div style={{fontSize:28,marginBottom:10}}>⏳</div>
                <div style={{fontSize:13,fontWeight:700,color:C.accent}}>AI sedang menganalisis...</div>
                <div style={{fontSize:11,color:C.muted,marginTop:4}}>Biasanya 5-10 detik</div>
              </div>
            )}
            {forecastDetailResult && !forecastDetailLoading && (
              <div style={{fontSize:12.5,lineHeight:1.8,whiteSpace:"pre-wrap",color:C.text}}>{forecastDetailResult}</div>
            )}
          </div>

          {/* KANAN: ML Prophet */}
          <div style={{...sty.card,borderTop:"4px solid #7c3aed"}}>
            <div style={{fontSize:12,fontWeight:800,color:"#7c3aed",marginBottom:10}}>🧠 Prediksi ML (Prophet)</div>
            {ml ? (
              <>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:12}}>
                  <div style={{background:"#f5f3ff",borderRadius:6,padding:"8px 10px"}}>
                    <div style={{fontSize:9,color:C.muted,fontWeight:700}}>ESTIMASI HABIS</div>
                    <div style={{fontSize:16,fontWeight:800,color:"#7c3aed"}}>{ml.estimasiHari!=null ? `~${fmtNum(ml.estimasiHari)} hari` : "Tdk ada data"}</div>
                  </div>
                  <div style={{background:"#f5f3ff",borderRadius:6,padding:"8px 10px"}}>
                    <div style={{fontSize:9,color:C.muted,fontWeight:700}}>RATA² PREDIKSI/HARI</div>
                    <div style={{fontSize:16,fontWeight:800,color:"#7c3aed"}}>{fmtNum(Math.round(ml.avgQtyPrediksiHarian))} {kat.satuan}</div>
                  </div>
                </div>
                <div style={{fontSize:9,color:C.muted,fontWeight:700,marginBottom:4}}>TREN PREDIKSI 30 HARI KE DEPAN</div>
                <div style={{background:"#f5f3ff",borderRadius:8,padding:"10px 10px 4px"}}>
                  <Sparkline data={ml.series} color="#7c3aed" w={280} h={50}/>
                </div>
                <div style={{fontSize:10,color:C.muted,marginTop:8}}>
                  Model: {ml.modelVersion||"-"} • Update terakhir: {fmtDate(new Date(ml.updatedAt).getTime())}
                </div>
              </>
            ) : (
              <div style={{fontSize:12,color:C.muted}}>Belum cukup histori transaksi KELUAR (minimal 10 baris) untuk material ini — prediksi ML akan otomatis muncul begitu data historisnya cukup, tanpa perlu konfigurasi tambahan.</div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ── LIST SEMUA MATERIAL ──
  return (
    <div>
      {/* Toggle: Forecast Stok vs Material Cadang */}
      <div style={{display:"flex",gap:8,marginBottom:16}}>
        <button style={{padding:"8px 18px",borderRadius:8,border:`1px solid ${forecastView==="forecast"?C.accent:C.border}`,background:forecastView==="forecast"?C.accent:"white",color:forecastView==="forecast"?"white":C.muted,fontWeight:700,fontSize:13,cursor:"pointer"}}
          onClick={()=>setForecastView("forecast")}>📈 Forecast Stok</button>
        <button style={{padding:"8px 18px",borderRadius:8,border:`1px solid ${forecastView==="material_cadang"?C.accent:C.border}`,background:forecastView==="material_cadang"?C.accent:"white",color:forecastView==="material_cadang"?"white":C.muted,fontWeight:700,fontSize:13,cursor:"pointer"}}
          onClick={()=>setForecastView("material_cadang")}>🔩 Material Cadang</button>
      </div>

      {forecastView==="material_cadang" && (
        <MaterialCadangTab
          materialCadangData={materialCadangData}
          setMaterialCadangData={setMaterialCadangData}
          maraReference={maraReference}
          setMaraReference={setMaraReference}
          catalogMasterRef={catalogMasterRef}
          setCatalogMasterRef={setCatalogMasterRef}
          katalogList={katalogList}
          setKatalogList={setKatalogList}
          stocks={stocks}
          currentUser={currentUser}
          sty={sty} C={C}
          saveToCloud={saveToCloud}
          showToast={showToast}
        />
      )}

      {forecastView==="forecast" && <div>
      <div style={{marginBottom:16}}>
        <h1 style={{fontSize:22,fontWeight:900}}>📈 Forecast Stok</h1>
        <p style={{color:C.muted,fontSize:13}}>Perbandingan 2 metode: heuristik pemakaian historis vs ML Prophet • {WAREHOUSE}</p>
      </div>
      <div style={{background:"#eff6ff",border:`1px solid #bfdbfe`,borderRadius:10,padding:"10px 14px",marginBottom:16,fontSize:12,color:"#1d4ed8"}}>
        ℹ️ <b>📊 Heuristik</b> = rata-rata pemakaian historis TUG-9/8 vs stok saat ini (selalu tersedia). <b>🧠 ML Prophet</b> = model statistik dari histori TUG-15, lebih presisi tapi butuh minimal 10 transaksi keluar per material. Klik kartu untuk analisis AI mendalam + tren prediksi.
      </div>

      {/* Filter status — klik buat menyaring list di bawah */}
      <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:16}}>
        <button onClick={()=>setStatusFilter("ALL")}
          style={{padding:"6px 14px",borderRadius:20,border:`1px solid ${statusFilter==="ALL"?C.accent:C.border}`,background:statusFilter==="ALL"?C.accent:"white",color:statusFilter==="ALL"?"white":C.muted,fontSize:12,fontWeight:700,cursor:"pointer"}}>
          Semua ({enriched.length})
        </button>
        {STATUS_FILTERS.map(label=>(
          <button key={label} onClick={()=>setStatusFilter(statusFilter===label?"ALL":label)}
            style={{padding:"6px 14px",borderRadius:20,border:`1px solid ${statusFilter===label?C.accent:C.border}`,background:statusFilter===label?C.accent:"white",color:statusFilter===label?"white":C.muted,fontSize:12,fontWeight:700,cursor:"pointer"}}>
            {label} ({statusCounts[label]})
          </button>
        ))}
      </div>

      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(310px,1fr))",gap:14}}>
        {visibleList.map(({kat,stockRows,risk,ml})=>{
          const totalQty = stockRows.reduce((a,s)=>a+(s.qty||0),0);
          // Tandai kalau heuristik & ML berbeda jauh (>40% relatif) — sinyal buat ditelusuri lebih lanjut
          const divergent = ml?.estimasiHari!=null && risk.hari!==Infinity && Math.abs(ml.estimasiHari-risk.hari) / Math.max(risk.hari,1) > 0.4;
          return (
            <div key={kat.id} style={{...sty.card,borderLeft:`4px solid ${risk.color}`,cursor:"pointer"}}
              onClick={()=>{setForecastDetail({kat,stockRows});setForecastDetailResult(null);forecastDrillDown(kat,stockRows);}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:8}}>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontWeight:700,fontSize:13,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{kat.name}</div>
                  <div style={{fontSize:10,color:C.muted,fontFamily:"monospace"}}>{kat.katalog}</div>
                </div>
                <span style={{padding:"3px 8px",borderRadius:20,fontSize:10,fontWeight:700,background:risk.bg,color:risk.color,marginLeft:8,flexShrink:0}}>{risk.label}</span>
              </div>
              <div style={{background:"#f9fafb",borderRadius:6,padding:"6px 8px",marginBottom:8}}>
                <div style={{fontSize:9,color:C.muted,fontWeight:700}}>STOK SAAT INI</div>
                <div style={{fontSize:14,fontWeight:800,color:C.text}}>{fmtNum(totalQty)} <span style={{fontSize:10,fontWeight:400}}>{kat.satuan}</span></div>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6,marginBottom:8}}>
                <div style={{background:"#eff6ff",borderRadius:6,padding:"6px 8px"}}>
                  <div style={{fontSize:8.5,color:"#1d4ed8",fontWeight:700}}>📊 HEURISTIK</div>
                  <div style={{fontSize:12.5,fontWeight:800,color:"#1d4ed8"}}>{risk.hari===Infinity?"Tdk ada data":risk.hari>365?">1 thn":`~${risk.hari} hr`}</div>
                </div>
                <div style={{background:"#f5f3ff",borderRadius:6,padding:"6px 8px"}}>
                  <div style={{fontSize:8.5,color:"#7c3aed",fontWeight:700}}>🧠 ML PROPHET</div>
                  <div style={{fontSize:12.5,fontWeight:800,color:"#7c3aed"}}>{ml?.estimasiHari!=null?`~${fmtNum(ml.estimasiHari)} hr`:"Data kurang"}</div>
                </div>
              </div>
              {divergent && <div style={{fontSize:10,color:"#b45309",background:"#fef3c7",borderRadius:6,padding:"4px 8px",marginBottom:8}}>⚠️ Heuristik & ML beda jauh — perlu ditelusuri</div>}
              <div style={{display:"flex",gap:6}}>
                <button style={{...sty.btn("primary","sm"),flex:2}} onClick={e=>{e.stopPropagation();setForecastDetail({kat,stockRows});setForecastDetailResult(null);forecastDrillDown(kat,stockRows);}}>
                  🔮 Analisis AI Detail
                </button>
                <button style={{...sty.btn("ghost","sm"),flex:1}} onClick={e=>{e.stopPropagation();lanjutkanDiChat(`Analisis dan forecast stok untuk material: ${kat.name} [${kat.katalog}]`);}}>
                  💬 Tanya AI
                </button>
              </div>
            </div>
          );
        })}
      </div>
      {katalogWithStock.length===0 && (
        <div style={{...sty.card,textAlign:"center",padding:50,color:C.muted}}>
          <div style={{fontSize:40,marginBottom:12}}>📈</div>
          <div style={{fontSize:14,fontWeight:700}}>Belum ada data stok untuk dianalisis</div>
        </div>
      )}
      {katalogWithStock.length>0 && visibleList.length===0 && (
        <div style={{...sty.card,textAlign:"center",padding:50,color:C.muted}}>
          <div style={{fontSize:40,marginBottom:12}}>🔍</div>
          <div style={{fontSize:14,fontWeight:700}}>Tidak ada material dengan status "{statusFilter}"</div>
        </div>
      )}
      </div>} {/* end forecastView==="forecast" */}
    </div>
  );
}

function DashboardAnalitikSection({ txns, stocks, katalogList, topN, setTopN, pemakaianMode, setPemakaianMode, C, sty }) {
  const topPemakaian = getTopPemakaian(txns, stocks, katalogList, pemakaianMode, topN);
  const topStok = getTopStokTerbanyak(stocks, katalogList, topN);
  const akanHabis = getMaterialAkanHabis(stocks, katalogList, txns, topN);

  const maxPemakaian = topPemakaian[0]?.[pemakaianMode==="frekuensi"?"frekuensi":"totalQty"] || 1;
  const maxStok = topStok[0]?.totalQty || 1;

  function BarRow({ label, sub, value, maxVal, badge, extra, color="#3b82f6" }) {
    const pct = Math.round((value/maxVal)*100);
    return (
      <div style={{marginBottom:10}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:3}}>
          <div style={{flex:1,minWidth:0}}>
            <div style={{fontSize:12,fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{label}</div>
            {sub && <div style={{fontSize:10,color:C.muted}}>{sub}</div>}
          </div>
          <div style={{textAlign:"right",marginLeft:8,flexShrink:0}}>
            <div style={{fontSize:12,fontWeight:700,color}}>{fmtNum(value)}</div>
            {extra && <div style={{fontSize:10,color:C.muted}}>{extra}</div>}
          </div>
        </div>
        <div style={{background:"#f1f5f9",borderRadius:4,height:6}}>
          <div style={{width:`${pct}%`,height:6,borderRadius:4,background:color,transition:"width 0.3s"}}/>
        </div>
        {badge && <span style={{fontSize:9,padding:"1px 5px",borderRadius:10,background:color+"22",color,fontWeight:700,marginTop:2,display:"inline-block"}}>{badge}</span>}
      </div>
    );
  }

  return (
    <div style={{marginTop:20}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
        <h2 style={{fontSize:16,fontWeight:800}}>📊 Analitik Material</h2>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          <span style={{fontSize:11,color:C.muted}}>Tampilkan</span>
          <select style={{...sty.select,width:80,paddingTop:4,paddingBottom:4,paddingLeft:8,paddingRight:8,fontSize:12}} value={topN} onChange={e=>setTopN(Number(e.target.value))}>
            <option value={5}>Top 5</option>
            <option value={10}>Top 10</option>
            <option value={20}>Top 20</option>
          </select>
        </div>
      </div>

      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:16}}>
        {/* Widget 1 — Paling Sering Dipakai */}
        <div style={{...sty.card}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
            <div style={{fontWeight:700,fontSize:13}}>🔥 Paling Sering Dipakai</div>
            <div style={{display:"flex",gap:4}}>
              {["frekuensi","qty"].map(m=>(
                <button key={m} style={{padding:"3px 8px",borderRadius:20,border:`1px solid ${pemakaianMode===m?C.accent:C.border}`,background:pemakaianMode===m?C.accent:"white",color:pemakaianMode===m?"white":C.muted,fontSize:10,cursor:"pointer",fontWeight:pemakaianMode===m?700:400}} onClick={()=>setPemakaianMode(m)}>
                  {m==="frekuensi"?"Frekuensi":"Qty Keluar"}
                </button>
              ))}
            </div>
          </div>
          {topPemakaian.length===0
            ? <div style={{textAlign:"center",color:C.muted,fontSize:12,padding:20}}>Belum ada data pemakaian</div>
            : topPemakaian.map((item,i)=>(
                <BarRow key={item.katalogId}
                  label={`${i+1}. ${item.nama}`}
                  sub={`${item.katalog} • ${getSAPLabel(item.katalog)}`}
                  value={pemakaianMode==="frekuensi"?item.frekuensi:item.totalQty}
                  maxVal={maxPemakaian}
                  extra={pemakaianMode==="frekuensi"?`${item.frekuensi}x bon`:item.satuan}
                  color="#f59e0b"
                />
              ))
          }
        </div>

        {/* Widget 2 — Stok Terbanyak */}
        <div style={{...sty.card}}>
          <div style={{fontWeight:700,fontSize:13,marginBottom:12}}>📦 Stok Terbanyak di Gudang</div>
          {topStok.length===0
            ? <div style={{textAlign:"center",color:C.muted,fontSize:12,padding:20}}>Belum ada data stok</div>
            : topStok.map((item,i)=>{
                const sapBs = getSAPBadgeStyle(item.katalog);
                return (
                  <BarRow key={item.katalogId}
                    label={`${i+1}. ${item.nama}`}
                    sub={<span style={{padding:"1px 5px",borderRadius:10,fontSize:9,fontWeight:700,background:sapBs.bg,color:sapBs.fg}}>{getSAPStatus(item.katalog)}</span>}
                    value={item.totalQty}
                    maxVal={maxStok}
                    extra={`${fmtNum(item.totalQty)} ${item.satuan}`}
                    badge={item.jenisBarang}
                    color={C.accent}
                  />
                );
              })
          }
        </div>

        {/* Widget 3 — Akan Habis */}
        <div style={{...sty.card}}>
          <div style={{fontWeight:700,fontSize:13,marginBottom:12}}>⚠️ Material Akan Habis</div>
          {akanHabis.length===0
            ? <div style={{textAlign:"center",color:C.muted,fontSize:12,padding:20}}>✅ Semua stok dalam kondisi aman</div>
            : akanHabis.map((item,i)=>{
                const badgeColor = item.isKritis?"#dc2626":item.estimasiHari<=30?"#d97706":"#ea580c";
                const hariLabel = item.estimasiHari===Infinity?"Tidak ada data pakai":item.estimasiHari>365?">1 tahun":`~${item.estimasiHari} hari`;
                return (
                  <div key={item.katalogId} style={{marginBottom:10,padding:"8px 10px",borderRadius:8,border:`1px solid ${badgeColor}22`,background:`${badgeColor}0a`}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{fontSize:12,fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{item.nama}</div>
                        <div style={{fontSize:10,color:C.muted}}>{item.katalog}</div>
                      </div>
                      <span style={{fontSize:10,fontWeight:700,color:badgeColor,marginLeft:6,flexShrink:0}}>{item.badge}</span>
                    </div>
                    <div style={{display:"flex",justifyContent:"space-between",marginTop:4,fontSize:11}}>
                      <span style={{color:C.muted}}>Stok: <b style={{color:"#111"}}>{fmtNum(item.totalQty)}</b> {item.satuan}</span>
                      <span style={{color:badgeColor,fontWeight:600}}>{hariLabel}</span>
                    </div>
                    {item.avgPerBulan>0 && <div style={{fontSize:10,color:C.muted}}>Rata-rata pakai: {item.avgPerBulan.toFixed(1)}/bulan</div>}
                  </div>
                );
              })
          }
        </div>
      </div>
    </div>
  );
}

// ─── STOCK OPNAME TAB ────────────────────────────────────────────────────
// ─── STOCK OPNAME TAB (Fase 1 — tanpa foto, paginasi 10 item/halaman) ──────
// ─── IMPORT SAP MODAL ────────────────────────────────────────────────────
function ImportSAPModal({ lokasiList, sty, C, onImport, onClose }) {
  const [step, setStep] = useState("upload");
  const [previewData, setPreviewData] = useState([]);
  const [sapRows, setSapRows] = useState([]);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState(null);
  const [filterJenis, setFilterJenis] = useState("semua");


  async function handleFile(e) {
    const f = e.target.files[0]; if(!f) return;
    setPreviewData([]); setSapRows([]);
    try {
      const rows = await parseSAPFile(f);
      setSapRows(rows);
      setPreviewData(rows);
      setStep("preview");
    } catch(err) {
      alert("Gagal membaca file: " + err.message);
    }
  }

  async function confirmImport() {
    setImporting(true);
    const res = await onImport(sapRows);
    setResult(res);
    setStep("done");
    setImporting(false);
  }

  const filtered = filterJenis==="semua" ? previewData : previewData.filter(r=>r.jenisBarang===filterJenis);
  const totalNilai = previewData.reduce((a,r)=>a+r.qty*r.harga,0);
  const byJenis = previewData.reduce((a,r)=>({...a,[r.jenisBarang]:(a[r.jenisBarang]||0)+1}),{});

  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.6)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:2000,padding:20}}>
      <div style={{...sty.card,width:"90vw",maxWidth:900,maxHeight:"92vh",overflowY:"auto"}}>

        {/* Header */}
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
          <div>
            <h2 style={{fontSize:18,fontWeight:900}}>⬆️ Import Data Stok dari SAP</h2>
            <p style={{fontSize:12,color:C.muted}}>Format: CSV export SAP MM (PEMAT_DDMMYYYY.csv) • Lokasi diisi manual setelah import</p>
          </div>
          <button style={{background:"#dc2626",color:"white",border:"none",borderRadius:8,padding:"6px 14px",cursor:"pointer"}} onClick={onClose}>✕ Tutup</button>
        </div>

        {/* Step indicator */}
        <div style={{display:"flex",gap:0,marginBottom:20}}>
          {["upload","preview","done"].map((s,i)=>(
            <div key={s} style={{flex:1,display:"flex",alignItems:"center"}}>
              <div style={{width:28,height:28,borderRadius:"50%",
                background:step===s?"#003087":(["preview","done"].includes(step)&&i===0)||(step==="done"&&i===1)?"#16a34a":"#e5e7eb",
                color:step===s||(["preview","done"].includes(step)&&i===0)||(step==="done"&&i===1)?"white":"#9ca3af",
                display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,fontWeight:700,flexShrink:0}}>
                {(["preview","done"].includes(step)&&i===0)||(step==="done"&&i===1)?"✓":i+1}
              </div>
              <div style={{fontSize:11,fontWeight:600,marginLeft:6,color:step===s?C.accent:C.muted}}>
                {s==="upload"?"Upload File":s==="preview"?"Preview & Konfirmasi":"Selesai"}
              </div>
              {i<2 && <div style={{flex:1,height:1,background:C.border,margin:"0 8px"}}/>}
            </div>
          ))}
        </div>

        {/* STEP 1: Upload */}
        {step==="upload" && (
          <div>
            <div style={{border:`2px dashed ${C.border}`,borderRadius:12,padding:40,textAlign:"center",marginBottom:16}}>
              <div style={{fontSize:36,marginBottom:12}}>📂</div>
              <div style={{fontSize:14,fontWeight:700,marginBottom:8}}>Upload File CSV SAP (PEMAT)</div>
              <div style={{fontSize:11,color:C.muted,marginBottom:16}}>Format: PEMAT_DDMMYYYY.csv • Export dari SAP MM modul Material Management</div>
              <input type="file" accept=".csv,.CSV,.xlsx,.XLSX,.xls" onChange={handleFile} style={{fontSize:13}}/>
            </div>
            <div style={{background:"#fef3c7",border:`1px solid #fde68a`,borderRadius:8,padding:12,fontSize:12,color:"#92400e",marginBottom:10}}>
              ⚠️ <b>Perhatian:</b> Import ini akan <b>mengganti semua Data Stok yang ada</b> dengan data dari SAP. Pastikan file CSV sudah benar sebelum melanjutkan.
            </div>
            <div style={{background:"#eff6ff",border:`1px solid #bfdbfe`,borderRadius:8,padding:12,fontSize:12,color:"#1d4ed8"}}>
              ℹ️ <b>Lokasi material</b> tidak perlu diisi saat import. Admin Gudang akan mengisi lokasi masing-masing material secara manual di halaman Data Stok setelah import selesai.
            </div>
          </div>
        )}

        {/* STEP 2: Preview */}
        {step==="preview" && (
          <div>
            {/* Summary cards */}
            <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:10,marginBottom:16}}>
              {[
                {label:"Total Material",val:previewData.length,color:C.accent},
                {label:"Cadang",val:byJenis["Cadang"]||0,color:"#dc2626"},
                {label:"Persediaan",val:byJenis["Persediaan"]||0,color:"#16a34a"},
                {label:"Persediaan Bursa",val:byJenis["Persediaan Bursa"]||0,color:"#ea580c"},
                {label:"Pre Memory",val:byJenis["Pre Memory"]||0,color:"#1d4ed8"},
              ].map((s,i)=>(
                <div key={i} style={{...sty.card,borderTop:`3px solid ${s.color}`,padding:12,textAlign:"center"}}>
                  <div style={{fontSize:18,fontWeight:900,color:s.color}}>{s.val}</div>
                  <div style={{fontSize:10,color:C.muted}}>{s.label}</div>
                </div>
              ))}
            </div>

            {/* Info lokasi */}
            <div style={{background:"#eff6ff",border:`1px solid #bfdbfe`,borderRadius:8,padding:10,marginBottom:14,fontSize:12,color:"#1d4ed8"}}>
              📍 Semua material akan diimport <b>tanpa lokasi</b>. Setelah import, Admin Gudang mengisi lokasi per material di halaman Data Stok.
            </div>

            {/* Filter */}
            <div style={{display:"flex",gap:6,marginBottom:10,flexWrap:"wrap"}}>
              {["semua","Cadang","Persediaan","Persediaan Bursa","Pre Memory"].map(j=>{
                const count = j==="semua" ? previewData.length : (byJenis[j]||0);
                return (
                  <button key={j} onClick={()=>setFilterJenis(j)}
                    style={{padding:"4px 12px",borderRadius:20,border:`1px solid ${filterJenis===j?C.accent:C.border}`,
                      background:filterJenis===j?C.accent:"white",color:filterJenis===j?"white":C.muted,fontSize:11,cursor:"pointer"}}>
                    {j==="semua"?"Semua":j} ({count})
                  </button>
                );
              })}
            </div>

            {/* Preview table */}
            <div style={{maxHeight:320,overflow:"auto",marginBottom:14,border:`1px solid ${C.border}`,borderRadius:8}}>
              <table style={{width:"100%",borderCollapse:"collapse",fontSize:11,minWidth:680}}>
                <thead style={{position:"sticky",top:0}}>
                  <tr style={{background:"#003087",color:"white"}}>
                    {["No","No Katalog","Nama Material","Sat","Qty SAP","Harga Satuan","Jenis Barang","Kategori SAP"].map(h=>(
                      <th key={h} style={{padding:"7px 8px",textAlign:"left",whiteSpace:"nowrap"}}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((row,i)=>(
                    <tr key={i} style={{borderBottom:`1px solid ${C.border}`,background:i%2===0?"white":"#f9fafb"}}>
                      <td style={{padding:"5px 8px",color:C.muted}}>{i+1}</td>
                      <td style={{padding:"5px 8px",fontFamily:"monospace",fontSize:10}}>{row.katalog}</td>
                      <td style={{padding:"5px 8px",maxWidth:220,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}} title={row.nama}>{row.nama}</td>
                      <td style={{padding:"5px 8px",textAlign:"center"}}>{row.satuan}</td>
                      <td style={{padding:"5px 8px",textAlign:"center",fontWeight:700}}>{row.qty}</td>
                      <td style={{padding:"5px 8px",textAlign:"right"}}>{row.harga>0?`Rp ${fmtNum(row.harga)}`:"—"}</td>
                      <td style={{padding:"5px 8px"}}>
                        <span style={{padding:"2px 6px",borderRadius:10,fontSize:9,fontWeight:700,
                          background:row.jenisBarang==="Cadang"?"#f3e8ff":row.jenisBarang==="Pre Memory"?"#dbeafe":row.jenisBarang==="Persediaan Bursa"?"#fff7ed":"#dcfce7",
                          color:row.jenisBarang==="Cadang"?"#7c3aed":row.jenisBarang==="Pre Memory"?"#1d4ed8":row.jenisBarang==="Persediaan Bursa"?"#ea580c":"#166534"}}>
                          {row.jenisBarang}
                        </span>
                      </td>
                      <td style={{padding:"5px 8px",fontSize:10,color:C.muted}}>{row.valuationDesc||"-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Action buttons */}
            <div style={{display:"flex",gap:10}}>
              <button style={{...sty.btn("ghost"),flex:1}} onClick={()=>setStep("upload")}>← Ganti File</button>
              <button style={{...sty.btn("primary"),flex:3}} disabled={importing} onClick={confirmImport}>
                {importing?"⏳ Mengimport...":"✅ Konfirmasi Import — Masukkan ke Database"}
              </button>
            </div>
          </div>
        )}

        {/* STEP 3: Done */}
        {step==="done" && result && (
          <div style={{textAlign:"center",padding:30}}>
            <div style={{fontSize:48,marginBottom:16}}>✅</div>
            <div style={{fontSize:20,fontWeight:900,color:C.green,marginBottom:8}}>Import Berhasil!</div>
            <div style={{fontSize:13,color:C.muted,marginBottom:6}}>{result.sapRows?.length||0} material dari SAP berhasil dimuat ke sistem.</div>
            <div style={{background:"#eff6ff",border:`1px solid #bfdbfe`,borderRadius:8,padding:10,marginBottom:20,fontSize:12,color:"#1d4ed8"}}>
              📍 <b>Langkah selanjutnya:</b> Buka halaman Data Stok dan isi lokasi untuk masing-masing material.
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:12,marginBottom:24}}>
              {[
                {label:"Master Katalog",val:result.katalogCount,icon:"🗂️"},
                {label:"Data Stok",val:result.stockCount,icon:"📦"},
                {label:"Nilai Total",val:`Rp ${fmtNum(Math.round((result.sapRows||[]).reduce((a,r)=>a+r.qty*r.harga,0)/1e6))}M`,icon:"💰"},
              ].map((s,i)=>(
                <div key={i} style={{...sty.card,padding:14}}>
                  <div style={{fontSize:24,marginBottom:4}}>{s.icon}</div>
                  <div style={{fontSize:18,fontWeight:900}}>{s.val}</div>
                  <div style={{fontSize:11,color:C.muted}}>{s.label}</div>
                </div>
              ))}
            </div>
            <button style={{...sty.btn("primary"),padding:"12px 32px"}} onClick={onClose}>
              Buka Data Stok → Isi Lokasi
            </button>
          </div>
        )}
      </div>
    </div>
  );
}


function StockOpnameTab({ opnameList, stocks, katalogList, currentUser, users, sty, C,
  saveOpname, submitOpname, approveOpname_Asman, approveOpname_Manager, rejectOpname, deleteOpname }) {

  const [activeTab, setActiveTab] = useState("list"); // "list"|"form-sap"|"form-nonsap"|"detail"
  const [activeOpname, setActiveOpname] = useState(null);
  const [page, setPage] = useState(0);
  const [filterStatus, setFilterStatus] = useState("semua");
  const [rejectingId, setRejectingId] = useState(null);
  const [rejectReason, setRejectReason] = useState("");
  const [catatanApproval, setCatatanApproval] = useState("");
  const [csvLoading, setCsvLoading] = useState(false);
  const [validationErrors, setValidationErrors] = useState([]);
  const PAGE_SIZE = 10;

  // ── SAP CSV Parser ──────────────────────────────────────────────────────
  function buildItemsFromSAP(sapRows) {
    const items = [];
    const katalogByNo = {};
    katalogList.forEach(k=>{ if(k.katalog) katalogByNo[k.katalog]=k; });

    // Items from Data Stok — try match to SAP
    const allKids = [...new Set(stocks.map(s=>s.katalogId).filter(Boolean))];
    allKids.forEach(kid=>{
      const kat = katalogList.find(k=>k.id===kid); if(!kat) return;
      const qtySistem = stocks.filter(s=>s.katalogId===kid).reduce((a,s)=>a+(s.qty||0),0);
      const sapRow = sapRows.find(r=>r.katalog===kat.katalog);
      items.push({
        katalogId: kid, namaBarang: kat.name, noKatalog: kat.katalog||"-", satuan: kat.satuan||"-",
        qtySistem, qtySAP: sapRow?.qty??null,
        qtsFisik: qtySistem, selisih: 0,
        statusItem: sapRow==null?"TIDAK_ADA_DI_SAP":"SESUAI",
        keterangan: "",
      });
    });

    // Items in SAP but not in sistem
    sapRows.forEach(sr=>{
      const kat = katalogByNo[sr.katalogStripped];
      if(!kat) {
        items.push({
          katalogId: null, namaBarang: sr.namaBarangSAP, noKatalog: sr.katalogStripped, satuan: sr.satuanSAP,
          qtySistem: 0, qtySAP: sr.qtySAP, qtsFisik: 0, selisih: 0,
          statusItem: "TIDAK_ADA_DI_SISTEM", keterangan: "",
        });
      }
    });
    return items;
  }

  function buildItemsNonSAP() {
    // Only Non-SAP items from Data Stok
    return [...new Set(stocks.filter(s=>getSAPStatus(katalogList.find(k=>k.id===s.katalogId)?.katalog)==="Non-SAP").map(s=>s.katalogId))]
      .filter(Boolean).map(kid=>{
        const kat = katalogList.find(k=>k.id===kid);
        if(!kat) return null;
        const qtySistem = stocks.filter(s=>s.katalogId===kid).reduce((a,s)=>a+(s.qty||0),0);
        return { katalogId:kid, namaBarang:kat.name, noKatalog:kat.katalog||"-", satuan:kat.satuan||"-",
          qtySistem, qtsFisik:qtySistem, selisih:0, statusItem:"SESUAI", keterangan:"" };
      }).filter(Boolean);
  }

  function startOpname(jenisAlur) {
    const semester = (()=>{ const d=new Date(); return `${d.getFullYear()}-S${d.getMonth()<6?1:2}`; })();
    const id = "OPN-"+Date.now();
    const newOpn = {
      id, semester, jenisAlur, kategori: jenisAlur==="SAP"?"Material SAP":"Material Non-SAP",
      status:"DRAFT", items:jenisAlur==="NON_SAP"?buildItemsNonSAP():[],
      dibuatOleh:currentUser.id, dibuatAt:Date.now(),
      sapUploadedAt:null, totalRowsSAP:0,
      approvedByAsman:null, approvedAtAsman:null, catatanAsman:"",
      approvedByManager:null, approvedAtManager:null, catatanManager:"",
      submittedAt:null, rejectReason:"",
    };
    setActiveOpname(newOpn); setPage(0); setValidationErrors([]);
    setActiveTab(jenisAlur==="SAP"?"form-sap":"form-nonsap");
  }

  async function handleCSVUpload(e) {
    const f = e.target.files[0]; if(!f) return;
    setCsvLoading(true);
    try {
      const sapRows = await parseSAPFile(f);
      const items = buildItemsFromSAP(sapRows);
      setActiveOpname(prev=>({...prev, items, sapUploadedAt:Date.now(), totalRowsSAP:sapRows.length}));
    } catch(err) {
      alert("Gagal membaca file: " + err.message);
    }
    setCsvLoading(false);
  }

  function updateItem(realIdx, field, value) {
    setActiveOpname(prev=>{
      const items = [...prev.items];
      items[realIdx] = {...items[realIdx], [field]:value};
      if(field==="qtsFisik") {
        items[realIdx].selisih = Number(value) - items[realIdx].qtySistem;
        items[realIdx].statusItem = items[realIdx].selisih===0?"SESUAI":"SELISIH";
      }
      return {...prev, items};
    });
  }

  function validate() {
    const errors = [];
    (activeOpname.items||[]).forEach((item,i)=>{
      if(item.qtsFisik==null||item.qtsFisik==="") errors.push(`Baris ${i+1}: qty fisik belum diisi`);
      if(item.selisih!==0 && !item.keterangan?.trim()) errors.push(`Baris ${i+1} (${item.namaBarang}): keterangan wajib diisi jika ada selisih`);
    });
    setValidationErrors(errors);
    return errors.length===0;
  }

  // ── Progress calculation ─────────────────────────────────────────────
  function getProgress() {
    if(!activeOpname?.items?.length) return {filled:0, total:0, pct:0};
    const total = activeOpname.items.length;
    const filled = activeOpname.items.filter(i=>i.qtsFisik!=null&&i.qtsFisik!=="").length;
    return {filled, total, pct:Math.round(filled/total*100)};
  }

  const statusColor = {DRAFT:"#6b7280",PENDING_ASMAN:"#f59e0b",PENDING_MANAGER:"#3b82f6",SELESAI:"#16a34a",DITOLAK:"#dc2626"};
  const statusLabel = {DRAFT:"Draft",PENDING_ASMAN:"Menunggu Asman",PENDING_MANAGER:"Menunggu Manager",SELESAI:"✅ Selesai",DITOLAK:"❌ Ditolak"};

  // ── FORM VIEW (SAP & Non-SAP) ──────────────────────────────────────────
  if(["form-sap","form-nonsap","detail"].includes(activeTab) && activeOpname) {
    const isSAP = activeOpname.jenisAlur==="SAP";
    const isReadOnly = activeOpname.status!=="DRAFT";
    const items = activeOpname.items||[];
    const totalPages = Math.ceil(items.length/PAGE_SIZE);
    const pageItems = items.slice(page*PAGE_SIZE, (page+1)*PAGE_SIZE);
    const prog = getProgress();
    const selisihCount = items.filter(i=>i.selisih!==0).length;

    return (
      <div>
        {/* Header */}
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:16}}>
          <div>
            <button style={{...sty.btn("ghost","sm"),marginBottom:6}} onClick={()=>{setActiveTab("list");setActiveOpname(null);}}>← Kembali ke Daftar</button>
            <h1 style={{fontSize:20,fontWeight:900}}>Stock Opname — {activeOpname.jenisAlur}</h1>
            <p style={{color:C.muted,fontSize:12}}>Semester {activeOpname.semester} • {activeOpname.kategori}</p>
          </div>
          {!isReadOnly && (
            <div style={{display:"flex",gap:8}}>
              <button style={sty.btn("ghost")} onClick={()=>saveOpname(activeOpname)}>💾 Simpan Draft</button>
              <button style={{...sty.btn("primary"), opacity:prog.pct<100?0.5:1}}
                onClick={()=>{ if(!validate()) return; saveOpname(activeOpname); submitOpname(activeOpname); setActiveTab("list"); setActiveOpname(null); }}>
                📋 Submit ke Asman
              </button>
            </div>
          )}
          {isReadOnly && activeOpname.status==="SELESAI" && (
            <button style={sty.btn("ghost")} onClick={()=>downloadBeritaAcara(activeOpname)}>📄 Download Berita Acara</button>
          )}
        </div>

        {/* Upload CSV SAP */}
        {isSAP && !isReadOnly && (
          <div style={{...sty.card,marginBottom:14,background:"#eff6ff",border:`1px solid #bfdbfe`}}>
            <div style={{fontSize:12,fontWeight:800,color:"#1d4ed8",marginBottom:8}}>
              📂 Step 1: Upload File SAP (CSV format PEMAT)
            </div>
            <input type="file" accept=".csv,.CSV,.xlsx,.XLSX,.xls" onChange={handleCSVUpload} style={{fontSize:12}}/>
            {csvLoading && <div style={{fontSize:11,color:"#1d4ed8",marginTop:4}}>⏳ Membaca dan memproses file SAP...</div>}
            {activeOpname.sapUploadedAt && (
              <div style={{fontSize:11,color:C.green,marginTop:4}}>
                ✅ {activeOpname.totalRowsSAP} baris SAP dibaca • {items.length} item total • {fmtDate(activeOpname.sapUploadedAt)}
              </div>
            )}
            <div style={{fontSize:10,color:C.muted,marginTop:4}}>
              Format: CSV export SAP MM (PEMAT_DDMMYYYY.csv). Kolom yang dipakai: Material, Material Description, Base Unit of Measure, Unrestricted Use Stock, Valuation Type.
            </div>
          </div>
        )}

        {/* Progress bar + summary */}
        {items.length>0 && (
          <>
            <div style={{...sty.card,marginBottom:14,padding:12}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                <div style={{fontSize:12,fontWeight:700}}>Progress Pengisian: {prog.filled}/{prog.total} item ({prog.pct}%)</div>
                <div style={{fontSize:11,color:selisihCount>0?C.red:C.green,fontWeight:700}}>
                  {selisihCount>0?`⚠️ ${selisihCount} item selisih`:"✅ Belum ada selisih"}
                </div>
              </div>
              <div style={{background:"#f1f5f9",borderRadius:6,height:8}}>
                <div style={{width:`${prog.pct}%`,height:8,borderRadius:6,background:prog.pct===100?C.green:C.accent,transition:"width 0.3s"}}/>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8,marginTop:10}}>
                {[
                  {label:"Total Item",val:items.length,color:C.accent},
                  {label:"Sesuai",val:items.filter(i=>i.statusItem==="SESUAI").length,color:C.green},
                  {label:"Selisih",val:selisihCount,color:C.red},
                  {label:"Tidak di SAP/Sistem",val:items.filter(i=>["TIDAK_ADA_DI_SAP","TIDAK_ADA_DI_SISTEM"].includes(i.statusItem)).length,color:"#f59e0b"},
                ].map((s,i)=>(
                  <div key={i} style={{textAlign:"center",padding:"6px",borderRadius:6,background:"#f9fafb",border:`1px solid ${C.border}`}}>
                    <div style={{fontSize:16,fontWeight:800,color:s.color}}>{s.val}</div>
                    <div style={{fontSize:9,color:C.muted}}>{s.label}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Validation errors */}
            {validationErrors.length>0 && (
              <div style={{background:"#fee2e2",border:`1px solid #fca5a5`,borderRadius:8,padding:10,marginBottom:12}}>
                <div style={{fontSize:12,fontWeight:700,color:"#991b1b",marginBottom:4}}>❌ Perlu diperbaiki sebelum submit:</div>
                {validationErrors.slice(0,5).map((e,i)=><div key={i} style={{fontSize:11,color:"#991b1b"}}>• {e}</div>)}
                {validationErrors.length>5 && <div style={{fontSize:11,color:"#991b1b"}}>... dan {validationErrors.length-5} lainnya</div>}
              </div>
            )}

            {/* Tabel item */}
            <div style={{overflowX:"auto",marginBottom:12}}>
              <table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
                <thead>
                  <tr style={{background:"#003087",color:"white"}}>
                    <th style={{padding:"7px 8px",textAlign:"center",width:36}}>No</th>
                    <th style={{padding:"7px 8px",textAlign:"left"}}>Nama Barang</th>
                    <th style={{padding:"7px 8px",textAlign:"center"}}>No Katalog</th>
                    <th style={{padding:"7px 8px",textAlign:"center"}}>Sat</th>
                    <th style={{padding:"7px 8px",textAlign:"center"}}>Qty Sistem</th>
                    {isSAP && <th style={{padding:"7px 8px",textAlign:"center"}}>Qty SAP</th>}
                    <th style={{padding:"7px 8px",textAlign:"center"}}>Qty Fisik</th>
                    <th style={{padding:"7px 8px",textAlign:"center"}}>Selisih</th>
                    <th style={{padding:"7px 8px",textAlign:"center"}}>Status</th>
                    <th style={{padding:"7px 8px",textAlign:"left"}}>Keterangan</th>
                  </tr>
                </thead>
                <tbody>
                  {pageItems.map((item,pageIdx)=>{
                    const realIdx = page*PAGE_SIZE + pageIdx;
                    const rowBg = item.statusItem==="SESUAI"?"white":item.statusItem==="TIDAK_ADA_DI_SISTEM"?"#fefce8":item.statusItem==="TIDAK_ADA_DI_SAP"?"#f8fafc":"#fff5f5";
                    const statusBadge = item.statusItem==="SESUAI"
                      ? {bg:"#dcfce7",fg:"#166534",label:"✅ Sesuai"}
                      : item.statusItem==="TIDAK_ADA_DI_SAP"
                      ? {bg:"#f3f4f6",fg:"#6b7280",label:"○ Tdk di SAP"}
                      : item.statusItem==="TIDAK_ADA_DI_SISTEM"
                      ? {bg:"#fef3c7",fg:"#92400e",label:"⚠️ Tdk di Sistem"}
                      : {bg:"#fee2e2",fg:"#991b1b",label:"🔴 Selisih"};
                    return (
                      <tr key={realIdx} style={{borderBottom:`1px solid ${C.border}`,background:rowBg}}>
                        <td style={{padding:"6px 8px",textAlign:"center",color:C.muted,fontSize:10}}>{realIdx+1}</td>
                        <td style={{padding:"6px 8px",fontWeight:600,maxWidth:200,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{item.namaBarang}</td>
                        <td style={{padding:"6px 8px",textAlign:"center",fontFamily:"monospace",fontSize:10}}>{item.noKatalog}</td>
                        <td style={{padding:"6px 8px",textAlign:"center"}}>{item.satuan}</td>
                        <td style={{padding:"6px 8px",textAlign:"center",fontWeight:600}}>{fmtNum(item.qtySistem)}</td>
                        {isSAP && <td style={{padding:"6px 8px",textAlign:"center",color:item.qtySAP!=null?C.text:"#9ca3af"}}>{item.qtySAP!=null?fmtNum(item.qtySAP):"—"}</td>}
                        <td style={{padding:"4px 6px",textAlign:"center"}}>
                          {!isReadOnly
                            ? <input type="number" inputMode="decimal" min="0" value={item.qtsFisik}
                                onChange={e=>updateItem(realIdx,"qtsFisik",Number(e.target.value))}
                                style={{width:64,padding:"4px 6px",border:`1px solid ${C.border}`,borderRadius:4,fontSize:11,textAlign:"center"}}/>
                            : <span style={{fontWeight:700}}>{fmtNum(item.qtsFisik)}</span>}
                        </td>
                        <td style={{padding:"6px 8px",textAlign:"center",fontWeight:700,
                          color:item.selisih<0?"#dc2626":item.selisih>0?"#16a34a":"#6b7280"}}>
                          {item.selisih===0?"—":(item.selisih>0?"+":"")+fmtNum(item.selisih)}
                        </td>
                        <td style={{padding:"6px 8px"}}>
                          <span style={{padding:"2px 6px",borderRadius:10,fontSize:9,fontWeight:700,background:statusBadge.bg,color:statusBadge.fg}}>
                            {statusBadge.label}
                          </span>
                        </td>
                        <td style={{padding:"4px 6px"}}>
                          {!isReadOnly
                            ? <input value={item.keterangan||""}
                                onChange={e=>updateItem(realIdx,"keterangan",e.target.value)}
                                placeholder={item.selisih!==0?"Wajib diisi...":"Opsional"}
                                style={{width:130,padding:"3px 6px",border:`1px solid ${item.selisih!==0&&!item.keterangan?C.red:C.border}`,borderRadius:4,fontSize:10}}/>
                            : <span style={{fontSize:10,color:C.muted}}>{item.keterangan||"-"}</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {totalPages>1 && (
              <div style={{display:"flex",justifyContent:"center",alignItems:"center",gap:10,marginBottom:16}}>
                <button style={{...sty.btn("ghost","sm"),opacity:page===0?0.4:1}} disabled={page===0} onClick={()=>setPage(p=>p-1)}>← Sebelumnya</button>
                <div style={{display:"flex",gap:4}}>
                  {Array.from({length:Math.min(totalPages,7)}).map((_,i)=>{
                    const pg = totalPages<=7?i:(page<=3?i:page>=totalPages-4?totalPages-7+i:page-3+i);
                    return (
                      <button key={pg} onClick={()=>setPage(pg)}
                        style={{width:30,height:30,borderRadius:6,border:`1px solid ${pg===page?C.accent:C.border}`,background:pg===page?C.accent:"white",color:pg===page?"white":C.text,fontSize:11,cursor:"pointer",fontWeight:pg===page?700:400}}>
                        {pg+1}
                      </button>
                    );
                  })}
                </div>
                <button style={{...sty.btn("ghost","sm"),opacity:page===totalPages-1?0.4:1}} disabled={page===totalPages-1} onClick={()=>setPage(p=>p+1)}>Berikutnya →</button>
                <span style={{fontSize:11,color:C.muted}}>Hal {page+1} dari {totalPages}</span>
              </div>
            )}
          </>
        )}

        {/* Approval section for non-draft */}
        {isReadOnly && (
          <div style={{...sty.card,background:"#f0fdf4",marginTop:8}}>
            <div style={{fontSize:12,fontWeight:700,marginBottom:8}}>Status Approval</div>
            {activeOpname.approvedByAsman && <div style={{fontSize:11,color:C.green}}>✅ Asman: {users.find(u=>u.id===activeOpname.approvedByAsman)?.name} • {fmtDate(activeOpname.approvedAtAsman)} {activeOpname.catatanAsman&&`— "${activeOpname.catatanAsman}"`}</div>}
            {activeOpname.approvedByManager && <div style={{fontSize:11,color:C.green,marginTop:4}}>✅ Manager: {users.find(u=>u.id===activeOpname.approvedByManager)?.name} • {fmtDate(activeOpname.approvedAtManager)} {activeOpname.catatanManager&&`— "${activeOpname.catatanManager}"`}</div>}
            {activeOpname.rejectReason && <div style={{fontSize:11,color:C.red,marginTop:4}}>❌ Ditolak: {activeOpname.rejectReason}</div>}
          </div>
        )}
      </div>
    );
  }

  // ── LIST VIEW ────────────────────────────────────────────────────────────
  const pendingForMe = opnameList.filter(o=>
    (o.status==="PENDING_ASMAN"&&currentUser.role==="ASMAN")||
    (o.status==="PENDING_MANAGER"&&currentUser.role==="MANAGER")
  );

  return (
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
        <div>
          <h1 style={{fontSize:22,fontWeight:900}}>📋 Stock Opname</h1>
          <p style={{color:C.muted,fontSize:13}}>Dilakukan 1× per semester — bandingkan data sistem vs lapangan & SAP</p>
        </div>
        {["ADMIN","TL"].includes(currentUser.role) && (
          <div style={{display:"flex",gap:8}}>
            <button style={sty.btn("primary")} onClick={()=>startOpname("SAP")}>+ Opname SAP</button>
            <button style={sty.btn("ghost")} onClick={()=>startOpname("NON_SAP")}>+ Opname Non-SAP</button>
          </div>
        )}
      </div>

      {/* Pending approval cards */}
      {pendingForMe.map(opn=>(
        <div key={opn.id} style={{...sty.card,borderLeft:`4px solid #f59e0b`,marginBottom:12}}>
          <div style={{fontSize:11,fontWeight:700,color:"#92400e",marginBottom:4}}>⏳ Menunggu Approval Kamu ({ROLES[currentUser.role]})</div>
          <div style={{fontWeight:800,fontSize:14,marginBottom:2}}>Opname {opn.semester} — {opn.jenisAlur}</div>
          <div style={{fontSize:11,color:C.muted,marginBottom:10}}>
            {opn.items?.length||0} item • Selisih: {opn.items?.filter(i=>i.selisih!==0).length||0} item
          </div>
          <div style={{marginBottom:8}}>
            <input style={sty.input} placeholder="Catatan approval (opsional)..." value={catatanApproval} onChange={e=>setCatatanApproval(e.target.value)}/>
          </div>
          {rejectingId===opn.id
            ? <div style={{display:"flex",gap:8}}>
                <input style={{...sty.input,flex:1}} placeholder="Alasan penolakan (wajib)..." value={rejectReason} onChange={e=>setRejectReason(e.target.value)}/>
                <button style={sty.btn("danger")} onClick={()=>{rejectOpname(opn,rejectReason);setRejectingId(null);setRejectReason("");}}>Konfirmasi Tolak</button>
                <button style={sty.btn("ghost")} onClick={()=>setRejectingId(null)}>Batal</button>
              </div>
            : <div style={{display:"flex",gap:8}}>
                <button style={sty.btn("ghost","sm")} onClick={()=>{setActiveOpname(opn);setPage(0);setActiveTab("detail");}}>🔍 Review Detail</button>
                <button style={sty.btn("success")} onClick={()=>{opn.status==="PENDING_ASMAN"?approveOpname_Asman(opn,catatanApproval):approveOpname_Manager(opn,catatanApproval);setCatatanApproval("");}}>✅ Setujui</button>
                <button style={{...sty.btn("ghost"),border:`1px solid ${C.red}`,color:C.red}} onClick={()=>setRejectingId(opn.id)}>❌ Tolak</button>
              </div>}
        </div>
      ))}

      {/* Filter status */}
      <div style={{display:"flex",gap:8,marginBottom:14,flexWrap:"wrap"}}>
        {["semua","DRAFT","PENDING_ASMAN","PENDING_MANAGER","SELESAI","DITOLAK"].map(s=>(
          <button key={s} style={{padding:"5px 14px",borderRadius:20,border:`1px solid ${filterStatus===s?C.accent:C.border}`,background:filterStatus===s?C.accent:"white",color:filterStatus===s?"white":C.muted,fontSize:11,cursor:"pointer"}}
            onClick={()=>setFilterStatus(s)}>
            {s==="semua"?"Semua":statusLabel[s]||s}
          </button>
        ))}
      </div>

      {/* Opname list */}
      {(filterStatus==="semua"?opnameList:opnameList.filter(o=>o.status===filterStatus))
        .slice().sort((a,b)=>b.dibuatAt-a.dibuatAt)
        .map(opn=>{
          const creator = users.find(u=>u.id===opn.dibuatOleh)||{};
          const selisihCount = (opn.items||[]).filter(i=>i.selisih!==0).length;
          return (
            <div key={opn.id} style={{...sty.card,marginBottom:10}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:6}}>
                <div>
                  <div style={{fontWeight:800,fontSize:14}}>Opname {opn.semester} — {opn.jenisAlur} <span style={{fontSize:11,fontWeight:400,color:C.muted}}>({opn.kategori})</span></div>
                  <div style={{fontSize:11,color:C.muted}}>{fmtDate(opn.dibuatAt)} • {creator.name||"-"} • {opn.items?.length||0} item • {selisihCount} selisih</div>
                </div>
                <span style={{padding:"3px 10px",borderRadius:20,fontSize:11,fontWeight:700,background:(statusColor[opn.status]||"#6b7280")+"22",color:statusColor[opn.status]||"#6b7280"}}>
                  {statusLabel[opn.status]||opn.status}
                </span>
              </div>
              <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                <button style={sty.btn("ghost","sm")} onClick={()=>{setActiveOpname(opn);setPage(0);setActiveTab(opn.status==="DRAFT"?(opn.jenisAlur==="SAP"?"form-sap":"form-nonsap"):"detail");}}>
                  🔍 {opn.status==="DRAFT"?"Edit":"Lihat Detail"}
                </button>
                {opn.status==="SELESAI" && <button style={sty.btn("ghost","sm")} onClick={()=>downloadBeritaAcara(opn)}>📄 Berita Acara</button>}
                {opn.status==="DRAFT" && ["ADMIN","TL"].includes(currentUser.role) && <button style={sty.btn("danger","sm")} onClick={()=>deleteOpname(opn.id)}>🗑️</button>}
              </div>
            </div>
          );
        })}

      {opnameList.length===0 && (
        <div style={{...sty.card,textAlign:"center",padding:50,color:C.muted}}>
          <div style={{fontSize:40,marginBottom:12}}>📋</div>
          <div style={{fontSize:14,fontWeight:700}}>Belum ada sesi Stock Opname</div>
          <div style={{fontSize:12,marginTop:4}}>Klik "+ Opname SAP" atau "+ Opname Non-SAP" untuk memulai</div>
        </div>
      )}
    </div>
  );

  function downloadBeritaAcara(opn) {
    const html = buildBeritaAcaraHTML(opn, katalogList, users);
    const blob = new Blob([html],{type:"text/html"});
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href=url; a.download=`BA_Opname_${opn.semester}_${opn.jenisAlur}.html`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(()=>URL.revokeObjectURL(url),2000);
  }
}

function StockCountTab({ stockCountList, currentUser, sty, C, previewStockCount, saveStockCountSession, approveStockCountItem, rejectStockCountItem, deleteStockCountSession }) {
  const [uploading, setUploading] = useState(false);
  const [expandedId, setExpandedId] = useState(stockCountList[0]?.id || null);
  const [catatanDraft, setCatatanDraft] = useState({}); // itemId -> teks catatan sedang diketik
  const [draftItems, setDraftItems] = useState(null); // hasil baca file, BELUM disimpan — masih bisa direview/dicoret per item
  const [saving, setSaving] = useState(false);
  const [rejectingItemId, setRejectingItemId] = useState(null); // itemId yang sedang dikonfirmasi penolakannya (bisa Batal)

  async function handleFile(e) {
    const f = e.target.files[0]; if (!f) return;
    setUploading(true);
    try {
      const sapRows = await parseSAPFile(f);
      const items = previewStockCount(sapRows).map(it => ({ ...it, included: true }));
      setDraftItems(items);
    } catch (err) {
      alert("Gagal membaca file: " + err.message);
    }
    setUploading(false);
    e.target.value = "";
  }

  function toggleDraftItem(id) {
    setDraftItems(items => items.map(it => it.id===id ? {...it, included: !it.included} : it));
  }

  async function confirmSaveDraft() {
    const included = draftItems.filter(it => it.included).map(({included, ...it}) => it);
    setSaving(true);
    const session = await saveStockCountSession(included);
    setSaving(false);
    setDraftItems(null);
    setExpandedId(session.id);
  }

  const REKOMENDASI_LABEL = {
    TAMBAH_STOK: "➕ Disarankan: tambah stok baru di Data Stok (selisih kurang dari SAP)",
    BUAT_TUG_KELUAR: "📤 Disarankan: buat TUG-9/8 (kemungkinan ada pemakaian belum tercatat)",
  };

  return (
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
        <div>
          <h1 style={{fontSize:22,fontWeight:900}}>Stock Count</h1>
          <p style={{color:C.muted,fontSize:13}}>Banding qty SAP vs Aplikasi untuk material ber-status SAP — temuan selisih perlu approval Asman.</p>
        </div>
        {currentUser.role==="ADMIN" && !draftItems && (
          <label style={{...sty.btn("primary"),cursor:uploading?"default":"pointer",opacity:uploading?0.6:1}}>
            {uploading ? "Memproses..." : "📂 Upload CSV/XLSX SAP"}
            <input type="file" accept=".csv,.CSV,.xlsx,.XLSX,.xls" onChange={handleFile} disabled={uploading} style={{display:"none"}}/>
          </label>
        )}
      </div>
      <div style={{background:"#eff6ff",border:`1px solid #bfdbfe`,borderRadius:8,padding:"10px 12px",fontSize:12,color:"#1d4ed8",marginBottom:16}}>
        ℹ️ Stock Count ini cuma membaca & membandingkan — <b>tidak mengubah</b> Data Stok atau Master Katalog. Rekomendasi (tambah stok / buat TUG) cuma saran, tidak otomatis membuat apa pun.
      </div>

      {/* DRAFT REVIEW — hasil upload belum tersimpan, belum terlihat Asman.
          Admin review satu per satu (termasuk material baru yang belum ada
          di Master Katalog) sebelum klik Simpan & Kirim. */}
      {draftItems && (
        <div style={{...sty.card,marginBottom:20,border:`2px solid #f59e0b`}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
            <div style={{fontWeight:800,fontSize:15}}>📝 Review Draft Stock Count ({draftItems.length} item)</div>
            <button style={sty.btn("ghost","sm")} onClick={()=>setDraftItems(null)}>✕ Batal</button>
          </div>
          <div style={{fontSize:12,color:C.muted,marginBottom:12}}>Centang item yang mau disertakan. Item yang akurat tetap ditampilkan sebagai informasi, tidak akan masuk approval Asman.</div>
          <div style={{maxHeight:380,overflowY:"auto",marginBottom:14}}>
            {draftItems.map(item => (
              <label key={item.id} style={{display:"flex",alignItems:"flex-start",gap:10,padding:"8px 10px",borderBottom:`1px solid ${C.border}`,cursor:"pointer",opacity:item.included?1:0.45}}>
                <input type="checkbox" checked={item.included} onChange={()=>toggleDraftItem(item.id)} style={{marginTop:3}}/>
                <div style={{flex:1}}>
                  <div style={{display:"flex",justifyContent:"space-between",gap:8}}>
                    <span style={{fontWeight:700,fontSize:12}}>{item.nama}{!item.katalogId && <span style={{marginLeft:6,fontSize:9,fontWeight:800,color:"#7c3aed",background:"#f3e8ff",padding:"1px 6px",borderRadius:10}}>MATERIAL BARU</span>}</span>
                    {item.status==="AKURAT"
                      ? <span style={{fontSize:11,fontWeight:700,color:C.green}}>✓ Akurat</span>
                      : <span style={{fontSize:11,fontWeight:800,color:item.status==="APP_KURANG"?"#b45309":"#dc2626"}}>{item.selisih>0?"+":""}{fmtNum(item.selisih)} {item.satuan} ({item.selisihPct}%)</span>}
                  </div>
                  <div style={{fontSize:10,color:C.muted}}>No. Katalog: {item.katalogKode} • SAP {fmtNum(item.qtySap)} {item.satuan} • App {fmtNum(item.qtyApp)} {item.satuan}</div>
                  {item.rekomendasi && <div style={{fontSize:10,color:"#1d4ed8",marginTop:2}}>{REKOMENDASI_LABEL[item.rekomendasi]}</div>}
                </div>
              </label>
            ))}
          </div>
          <button style={{...sty.btn("primary"),width:"100%"}} disabled={saving} onClick={confirmSaveDraft}>
            {saving ? "Menyimpan..." : `💾 Simpan & Kirim ke Asman (${draftItems.filter(i=>i.included).length} item)`}
          </button>
        </div>
      )}

      {stockCountList.length===0 ? (
        !draftItems && <div style={{...sty.card,textAlign:"center",color:C.muted,padding:30}}>Belum ada sesi Stock Count. {currentUser.role==="ADMIN" && "Klik \"Upload CSV/XLSX SAP\" untuk mulai."}</div>
      ) : stockCountList.map(session => {
        const isOpen = expandedId===session.id;
        const mismatch = session.items.filter(i=>i.status!=="AKURAT").sort((a,b)=>b.selisihPct-a.selisihPct);
        return (
          <div key={session.id} style={{...sty.card,marginBottom:12,padding:0,overflow:"hidden"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"14px 16px",cursor:"pointer",background:"#f9fafb"}} onClick={()=>setExpandedId(isOpen?null:session.id)}>
              <div>
                <div style={{fontWeight:800,fontSize:14}}>{fmtDate(session.uploadedAt)} — {session.summary.totalItem} item dibandingkan</div>
                <div style={{fontSize:11,color:C.muted}}>{session.summary.akuratCount} akurat • {mismatch.length} selisih{mismatch.some(i=>i.approval==="PENDING")&&` • ${mismatch.filter(i=>i.approval==="PENDING").length} menunggu approval`}</div>
              </div>
              <div style={{display:"flex",alignItems:"center",gap:10}}>
                <span style={{fontSize:22,fontWeight:900,color:session.summary.akuratPct>=90?C.green:session.summary.akuratPct>=70?C.yellow:C.red}}>{session.summary.akuratPct}%</span>
                <span style={{fontSize:14,color:C.muted}}>{isOpen?"▲":"▼"}</span>
              </div>
            </div>
            {isOpen && (
              <div style={{padding:"0 16px 16px"}}>
                {currentUser.role==="ADMIN" && (
                  <div style={{textAlign:"right",marginBottom:8}}>
                    <button style={sty.btn("danger","sm")} onClick={()=>deleteStockCountSession(session.id)}>🗑️ Hapus Sesi</button>
                  </div>
                )}
                {mismatch.length===0 ? (
                  <div style={{fontSize:12,color:C.green,fontWeight:700}}>✅ Semua item akurat, tidak ada selisih &gt;5%.</div>
                ) : mismatch.map(item => (
                  <div key={item.id} style={{border:`1px solid ${C.border}`,borderRadius:8,padding:12,marginBottom:8,background:item.approval==="PENDING"?"#fffbeb":item.approval==="APPROVED"?"#f0fdf4":"#fef2f2"}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:10,marginBottom:6}}>
                      <div>
                        <div style={{fontWeight:700,fontSize:13}}>{item.nama}</div>
                        <div style={{fontSize:10,color:C.muted}}>No. Katalog: {item.katalogKode}{!item.katalogId && " — tidak ada di Master Katalog"}</div>
                      </div>
                      <span style={{fontSize:11,fontWeight:800,color:item.status==="APP_KURANG"?"#b45309":"#dc2626",whiteSpace:"nowrap"}}>{item.selisih>0?"+":""}{fmtNum(item.selisih)} {item.satuan} ({item.selisihPct}%)</span>
                    </div>
                    <div style={{fontSize:11,color:C.muted,marginBottom:6}}>SAP: {fmtNum(item.qtySap)} {item.satuan} • Aplikasi: {fmtNum(item.qtyApp)} {item.satuan}</div>
                    <div style={{fontSize:11,fontWeight:600,color:"#1d4ed8",marginBottom:8}}>{REKOMENDASI_LABEL[item.rekomendasi]}</div>
                    {item.approval==="PENDING" ? (
                      currentUser.role==="ASMAN" ? (
                        <div>
                          <input style={{...sty.input,fontSize:12,marginBottom:6}} placeholder="Catatan (opsional)" value={catatanDraft[item.id]||""} onChange={e=>setCatatanDraft(d=>({...d,[item.id]:e.target.value}))}/>
                          {rejectingItemId===item.id ? (
                            <div style={{display:"flex",gap:8}}>
                              <button style={{...sty.btn("danger","sm"),flex:1}} onClick={()=>{rejectStockCountItem(session.id, item.id, catatanDraft[item.id]); setRejectingItemId(null);}}>❌ Konfirmasi Tolak</button>
                              <button style={{...sty.btn("ghost","sm"),flex:1}} onClick={()=>setRejectingItemId(null)}>Batal</button>
                            </div>
                          ) : (
                            <div style={{display:"flex",gap:8}}>
                              <button style={{...sty.btn("success","sm"),flex:1}} onClick={()=>approveStockCountItem(session.id, item.id, catatanDraft[item.id])}>✓ Setuju</button>
                              <button style={{...sty.btn("danger","sm"),flex:1}} onClick={()=>setRejectingItemId(item.id)}>✕ Tolak</button>
                            </div>
                          )}
                        </div>
                      ) : (
                        <div style={{fontSize:11,fontWeight:700,color:"#92400e"}}>⏳ Menunggu approval Asman</div>
                      )
                    ) : (
                      <div style={{fontSize:11,fontWeight:700,color:item.approval==="APPROVED"?C.green:C.red}}>
                        {item.approval==="APPROVED"?"✓ Disetujui":"✕ Ditolak"} oleh Asman{item.catatan && ` — "${item.catatan}"`}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function RencanaKedatanganTab({ rencanaList, katalogList, currentUser, sty, C, saveRencana, deleteRencana, aiExtractKontrak }) {
  const [showForm, setShowForm] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState("");
  const [form, setForm] = useState({ id:"", noKontrak:"", tanggalKontrak:"", supplier:"", tanggalSerahTerima:"", items:[{namaBarang:"",jumlah:1,satuan:"unit",katalogId:"",keterangan:""}] });

  function newForm() {
    setForm({id:`RK-${Date.now()}`, noKontrak:"", tanggalKontrak:"", supplier:"", tanggalSerahTerima:"", items:[{namaBarang:"",jumlah:1,satuan:"unit",katalogId:"",keterangan:""}]});
    setShowForm(true); setAiError("");
  }
  function handlePdfUpload(e) {
    const f = e.target.files[0]; if(!f) return;
    const r = new FileReader();
    r.onload = ev => {
      const base64 = ev.target.result.split(",")[1];
      aiExtractKontrak(base64,
        (parsed) => {
          setForm(prev=>({
            ...prev,
            noKontrak: parsed.noKontrak||prev.noKontrak,
            tanggalKontrak: parsed.tanggalKontrak||prev.tanggalKontrak,
            supplier: parsed.supplier||prev.supplier,
            tanggalSerahTerima: parsed.tanggalSerahTerima||prev.tanggalSerahTerima,
            items: (parsed.items||[]).length>0
              ? parsed.items.map(it=>({namaBarang:it.namaBarang||"",jumlah:it.jumlah||1,satuan:it.satuan||"unit",katalogId:"",keterangan:""}))
              : prev.items
          }));
        },
        (err)=>setAiError(err),
        setAiLoading
      );
    };
    r.readAsDataURL(f);
  }
  function updateItem(i,k,v) { setForm(f=>({...f,items:f.items.map((it,idx)=>idx===i?{...it,[k]:v}:it)})); }
  function addItem() { setForm(f=>({...f,items:[...f.items,{namaBarang:"",jumlah:1,satuan:"unit",katalogId:"",keterangan:""}]})); }
  function removeItem(i) { setForm(f=>({...f,items:f.items.filter((_,idx)=>idx!==i)})); }

  const today = Date.now();
  const canEdit = ["ADMIN","TL","PENGADAAN"].includes(currentUser.role);

  return (
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
        <div>
          <h1 style={{fontSize:22,fontWeight:900}}>📅 Rencana Kedatangan Barang</h1>
          <p style={{color:C.muted,fontSize:13}}>Input dari kontrak pengadaan — AI ekstrak otomatis</p>
        </div>
        {canEdit && <button style={sty.btn("primary")} onClick={newForm}>+ Input Kontrak Baru</button>}
      </div>

      {/* Form input kontrak */}
      {showForm && (
        <div style={{...sty.card,marginBottom:20,borderLeft:`4px solid ${C.accent}`}}>
          <h3 style={{fontSize:15,fontWeight:800,marginBottom:12}}>Input Rencana Kedatangan</h3>
          <div style={{background:"#eff6ff",border:`1px solid #bfdbfe`,borderRadius:8,padding:10,marginBottom:14}}>
            <div style={{fontSize:12,fontWeight:700,color:"#1d4ed8",marginBottom:6}}>🤖 Upload PDF Kontrak — AI akan ekstrak otomatis</div>
            <input type="file" accept=".pdf" onChange={handlePdfUpload} style={{fontSize:12}}/>
            {aiLoading && <div style={{fontSize:11,color:"#1d4ed8",marginTop:6}}>⏳ AI sedang membaca kontrak...</div>}
            {aiError && <div style={{fontSize:11,color:C.red,marginTop:6}}>❌ {aiError}</div>}
            <div style={{fontSize:10,color:C.muted,marginTop:4}}>Setelah upload, review hasilnya di bawah dan edit jika perlu.</div>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:12}}>
            <div><label style={sty.label}>No. Kontrak</label><input style={sty.input} value={form.noKontrak} onChange={e=>setForm(f=>({...f,noKontrak:e.target.value}))}/></div>
            <div><label style={sty.label}>Supplier</label><input style={sty.input} value={form.supplier} onChange={e=>setForm(f=>({...f,supplier:e.target.value}))}/></div>
            <div><label style={sty.label}>Tanggal Kontrak</label><input type="date" style={sty.input} value={form.tanggalKontrak} onChange={e=>setForm(f=>({...f,tanggalKontrak:e.target.value}))}/></div>
            <div><label style={sty.label}>Tanggal Serah Terima / Delivery</label><input type="date" style={sty.input} value={form.tanggalSerahTerima} onChange={e=>setForm(f=>({...f,tanggalSerahTerima:e.target.value}))}/></div>
          </div>
          <div style={{fontSize:12,fontWeight:800,color:C.accent,marginBottom:8}}>Daftar Item Barang</div>
          {form.items.map((item,i)=>(
            <div key={i} style={{border:`1px solid ${C.border}`,borderRadius:8,padding:10,marginBottom:8,background:"#f9fafb"}}>
              <div style={{display:"grid",gridTemplateColumns:"2fr 1fr 1fr",gap:8,marginBottom:6}}>
                <div><label style={sty.label}>Nama Barang</label><input style={sty.input} value={item.namaBarang} onChange={e=>updateItem(i,"namaBarang",e.target.value)}/></div>
                <div><label style={sty.label}>Jumlah</label><input type="number" inputMode="decimal" min="1" style={sty.input} value={item.jumlah} onChange={e=>updateItem(i,"jumlah",Number(e.target.value))}/></div>
                <div><label style={sty.label}>Satuan</label><input style={sty.input} value={item.satuan} onChange={e=>updateItem(i,"satuan",e.target.value)}/></div>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr auto",gap:8,alignItems:"flex-end"}}>
                <div>
                  <label style={sty.label}>Link ke Master Katalog (opsional)</label>
                  <SearchableSelect
                    options={katalogList}
                    value={item.katalogId||""}
                    onChange={v=>updateItem(i,"katalogId",v)}
                    getLabel={k=>`${k.name} [${k.katalog||"-"}]`}
                    getSearchText={k=>`${k.name} ${k.katalog||""}`}
                    placeholder="-- Cari & pilih jika ada --"
                    sty={sty} C={C}
                  />
                </div>
                <div><label style={sty.label}>Keterangan</label><input style={sty.input} value={item.keterangan||""} onChange={e=>updateItem(i,"keterangan",e.target.value)}/></div>
                {form.items.length>1 && <button style={{...sty.btn("danger","sm"),height:36}} onClick={()=>removeItem(i)}>✕</button>}
              </div>
            </div>
          ))}
          <button style={{...sty.btn("ghost","sm"),marginBottom:14}} onClick={addItem}>+ Tambah Item</button>
          <div style={{display:"flex",gap:10}}>
            <button style={{...sty.btn("ghost"),flex:1}} onClick={()=>setShowForm(false)}>Batal</button>
            <button style={{...sty.btn("primary"),flex:2}} onClick={()=>{saveRencana(form);setShowForm(false);}}>💾 Simpan Rencana Kedatangan</button>
          </div>
        </div>
      )}

      {/* List Rencana */}
      {rencanaList.length===0 && !showForm && (
        <div style={{...sty.card,textAlign:"center",color:C.muted,padding:40}}>
          <div style={{fontSize:36,marginBottom:12}}>📅</div>
          <div style={{fontSize:14,fontWeight:700}}>Belum ada rencana kedatangan barang</div>
          {canEdit && <div style={{fontSize:12,marginTop:4}}>Klik "+ Input Kontrak Baru" untuk menambahkan</div>}
        </div>
      )}
      {rencanaList.slice().sort((a,b)=>new Date(a.tanggalSerahTerima)-new Date(b.tanggalSerahTerima)).map(r=>{
        const tglMs = r.tanggalSerahTerima ? new Date(r.tanggalSerahTerima).getTime() : 0;
        const isLate = tglMs > 0 && tglMs < today;
        return (
          <div key={r.id} style={{...sty.card,marginBottom:12,borderLeft:`4px solid ${isLate?C.red:C.green}`}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:8}}>
              <div>
                <div style={{fontWeight:800,fontSize:14}}>{r.noKontrak||"No Kontrak -"}</div>
                <div style={{fontSize:12,color:C.muted}}>Supplier: {r.supplier||"-"} • Kontrak: {r.tanggalKontrak||"-"}</div>
                <div style={{fontSize:12,fontWeight:700,color:isLate?C.red:C.green,marginTop:2}}>
                  📅 Serah Terima: {r.tanggalSerahTerima||"-"} {isLate && "⚠️ TERLAMBAT"}
                </div>
              </div>
              {canEdit && <button style={{...sty.btn("danger","sm")}} onClick={()=>deleteRencana(r.id)}>🗑️</button>}
            </div>
            <div style={{background:"#f9fafb",borderRadius:8,padding:8}}>
              {(r.items||[]).map((item,i)=>{
                const kat = katalogList.find(k=>k.id===item.katalogId);
                return (
                  <div key={i} style={{fontSize:12,padding:"3px 0",display:"flex",justifyContent:"space-between"}}>
                    <span>📦 {item.namaBarang} <b>x{item.jumlah}</b> {item.satuan}</span>
                    {kat && <span style={{fontSize:10,color:"#0098da"}}>→ {kat.name}</span>}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function TUG15Tab({ txns, katalogList, stocks, sty, C, filter, setFilter, lokasiList }) {
  const rows = buildMutasiRows(txns, katalogList, stocks, filter, lokasiList);
  const [syncState, setSyncState] = useState({ loading:false, msg:"" });

  async function handleSyncSupabase() {
    setSyncState({ loading:true, msg:"" });
    try {
      const histRes = await syncTUG15ToSupabase(rows, katalogList);
      const stockRes = await syncStockQtyToSupabase(stocks, katalogList);
      const fotoRes = await syncFotoMaterialToSupabase(stocks, katalogList);
      const parts = [];
      parts.push(histRes.historyCount>0 ? `${histRes.historyCount} baris histori baru` : "tidak ada histori baru");
      parts.push(`qty ${stockRes.stockCount} katalog`);
      if (fotoRes.uploadCount>0) parts.push(`${fotoRes.uploadCount} foto baru diupload`);
      setSyncState({ loading:false, msg: `✓ Tersinkron: ${parts.join(", ")}.` });
    } catch (err) {
      setSyncState({ loading:false, msg: `✗ Gagal sync: ${err.message}` });
    }
  }

  function downloadTUG15() {
    const html = buildTUG15HTML(rows, filter, katalogList);
    const blob = new Blob([html], {type:"text/html"});
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `TUG15_Mutasi_${filter.dateFrom||"all"}_${filter.dateTo||"all"}.html`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(()=>URL.revokeObjectURL(url), 2000);
  }

  function downloadTUG15Excel() {
    try {
      const headers = ["No","No Katalog","Deskripsi Material","Status SAP","Jenis Barang","Merk","Type","Satuan","Valuasi","Saldo Awal","Stok Masuk","Stok Keluar","Saldo Akhir","UPT","TUG/BA & Tgl","Keterangan","Tanggal Mutasi"];
      const dataRows = rows.map(r=>[
        r.no, r.katalog, r.deskripsi, r.sapStatus||"", r.jenisBarang||"",
        r.merk||"-", r.type||"-", r.satuan, r.valuasi||0,
        r.saldoAwal, r.masuk, r.keluar, r.saldoAkhir,
        r.upt, r.tugBaDoc, r.keterangan, r.tanggalMutasi
      ]);
      const totalRow = ["TOTAL","","","","","","","","","",
        rows.reduce((a,r)=>a+r.masuk,0),
        rows.reduce((a,r)=>a+r.keluar,0),
        "","","","",""
      ];
      const wsData = [headers, ...dataRows, totalRow];
      const ws = XLSX.utils.aoa_to_sheet(wsData);
      ws["!cols"] = [5,12,30,10,12,8,8,7,14,10,10,10,10,12,18,20,12].map(w=>({wch:w}));
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "TUG-15 Mutasi Stok");
      const infoData = [
        ["LAPORAN MUTASI STOK MATERIAL - TUG 15"],
        ["PT PLN (PERSERO) UPT SURABAYA"],
        [""],
        ["Periode", `${filter.dateFrom||"Semua"} s/d ${filter.dateTo||"Semua"}`],
        ["Kategori SAP", filter.sapStatus==="ALL"?"SAP + Non-SAP":filter.sapStatus],
        ["Jenis Barang", filter.jenisBarang==="ALL"?"Semua":filter.jenisBarang],
        ["Total Baris", rows.length],
        ["Total Masuk", rows.reduce((a,r)=>a+r.masuk,0)],
        ["Total Keluar", rows.reduce((a,r)=>a+r.keluar,0)],
        ["Digenerate", new Date().toLocaleString("id-ID")],
      ];
      const wsInfo = XLSX.utils.aoa_to_sheet(infoData);
      wsInfo["!cols"] = [{wch:20},{wch:40}];
      XLSX.utils.book_append_sheet(wb, wsInfo, "Info Laporan");
      XLSX.writeFile(wb, `TUG15_Mutasi_${filter.dateFrom||"all"}_${filter.dateTo||"all"}.xlsx`);
    } catch(err) {
      alert("Export Excel gagal: " + err.message + ". Gunakan format HTML/PDF sebagai alternatif.");
    }
  }

  const docTypeLabels = {TUG9:"TUG-9",TUG8:"TUG-8",TUG10:"TUG-10",TUG3:"TUG-3"};

  return (
    <div>
      {/* Filter Panel */}
      <div style={{...sty.card,marginBottom:16,background:"#f8fafc"}}>
        <div style={{fontSize:12,fontWeight:800,color:C.accent,marginBottom:12}}>🔍 Filter Laporan TUG-15</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:12}}>
          <div>
            <label style={sty.label}>Dari Tanggal</label>
            <input type="date" style={sty.input} value={filter.dateFrom} onChange={e=>setFilter(f=>({...f,dateFrom:e.target.value}))}/>
          </div>
          <div>
            <label style={sty.label}>Sampai Tanggal</label>
            <input type="date" style={sty.input} value={filter.dateTo} onChange={e=>setFilter(f=>({...f,dateTo:e.target.value}))}/>
          </div>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:12,marginBottom:12}}>
          <div>
            <label style={sty.label}>Kategori SAP</label>
            <select style={sty.select} value={filter.sapStatus||"ALL"} onChange={e=>setFilter(f=>({...f,sapStatus:e.target.value}))}>
              <option value="ALL">Semua (SAP + Non-SAP)</option>
              <option value="SAP">Material SAP</option>
              <option value="Non-SAP">Material Non-SAP</option>
            </select>
          </div>
          <div>
            <label style={sty.label}>Jenis Barang</label>
            <select style={sty.select} value={filter.jenisBarang||"ALL"} onChange={e=>setFilter(f=>({...f,jenisBarang:e.target.value}))}>
              <option value="ALL">Semua Jenis Barang</option>
              {JENIS_BARANG.map(jb=><option key={jb} value={jb}>{jb}</option>)}
            </select>
          </div>
          <div>
            <label style={sty.label}>Filter Barang Spesifik</label>
            <select style={sty.select} value={filter.katalogId} onChange={e=>setFilter(f=>({...f,katalogId:e.target.value}))}>
              <option value="ALL">Semua Barang</option>
              {katalogList.map(k=><option key={k.id} value={k.id}>{k.name} [{k.katalog||"-"}]</option>)}
            </select>
          </div>
        </div>
        <div style={{marginBottom:12}}>
          <label style={sty.label}>Filter Jenis Transaksi</label>
          <div style={{display:"flex",gap:8,marginTop:6,flexWrap:"wrap"}}>
            {["TUG9","TUG8","TUG10","TUG3"].map(dt=>{
              const active = filter.docTypes.includes(dt);
              return (
                <button key={dt} type="button" style={{padding:"5px 14px",borderRadius:20,border:`1px solid ${active?C.accent:C.border}`,background:active?C.accent:"white",color:active?"white":C.muted,fontSize:12,cursor:"pointer",fontWeight:active?700:400}}
                  onClick={()=>setFilter(f=>({...f,docTypes:active?f.docTypes.filter(x=>x!==dt):[...f.docTypes,dt]}))}>
                  {docTypeLabels[dt]}
                </button>
              );
            })}
          </div>
        </div>
        <div style={{display:"flex",gap:10,alignItems:"center"}}>
          <button style={{...sty.btn("ghost","sm")}} onClick={()=>setFilter({dateFrom:"",dateTo:"",katalogId:"ALL",jenisBarang:"ALL",sapStatus:"ALL",docTypes:["TUG9","TUG8","TUG10","TUG3"]})}>↺ Reset Filter</button>
          <span style={{fontSize:11,color:C.muted}}>{rows.length} baris ditemukan</span>
          <div style={{marginLeft:"auto",display:"flex",gap:8}}>
            <button style={{...sty.btn("ghost"),border:`1px solid #0ea5e9`,color:"#0ea5e9"}} onClick={handleSyncSupabase} disabled={rows.length===0||syncState.loading}>
              {syncState.loading?"⏳ Sinkron...":"☁️ Sync ke Supabase"}
            </button>
            <button style={{...sty.btn("ghost"),border:`1px solid ${C.green}`,color:C.green}} onClick={downloadTUG15Excel} disabled={rows.length===0}>📊 Download Excel (.xlsx)</button>
            <button style={sty.btn("success")} onClick={downloadTUG15} disabled={rows.length===0}>⬇️ Download HTML/PDF</button>
          </div>
        </div>
        {syncState.msg && <div style={{marginTop:10,fontSize:12,color:syncState.msg.startsWith("✗")?C.red||"#dc2626":"#0ea5e9",fontWeight:600}}>{syncState.msg}</div>}
      </div>

      {/* Preview Tabel */}
      {rows.length===0 ? (
        <div style={{...sty.card,textAlign:"center",color:C.muted,padding:40}}>
          <div style={{fontSize:36,marginBottom:12}}>📊</div>
          <div style={{fontSize:14,fontWeight:700}}>Tidak ada data mutasi untuk filter ini</div>
          <div style={{fontSize:12,color:C.muted,marginTop:4}}>Coba ubah rentang tanggal atau jenis transaksi</div>
        </div>
      ) : (
        <div style={{overflowX:"auto"}}>
          <div style={{fontSize:11,color:C.muted,marginBottom:8}}>Preview {rows.length} baris — scroll kanan untuk lihat semua kolom</div>
          <table style={{width:"100%",borderCollapse:"collapse",fontSize:11,minWidth:1050}}>
            <thead>
              <tr style={{background:"#003087",color:"white"}}>
                {["No","No Katalog","Deskripsi","Status SAP","Jenis","Satuan","Saldo Awal","Masuk","Keluar","Saldo Akhir","TUG/BA","Keterangan","Tgl Mutasi"].map(h=>(
                  <th key={h} style={{padding:"6px 8px",textAlign:["No","Saldo Awal","Masuk","Keluar","Saldo Akhir"].includes(h)?"center":"left",whiteSpace:"nowrap"}}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r,i)=>{
                const sapBs = getSAPBadgeStyle(r.katalog);
                return (
                  <tr key={i} style={{borderBottom:`1px solid ${C.border}`,background:i%2===0?"white":"#f9fafb"}}>
                    <td style={{padding:"5px 8px",textAlign:"center",color:C.muted}}>{r.no}</td>
                    <td style={{padding:"5px 8px",fontFamily:"monospace",fontSize:10}}>{r.katalog}</td>
                    <td style={{padding:"5px 8px",fontWeight:600,maxWidth:160,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{r.deskripsi}</td>
                    <td style={{padding:"5px 8px"}}><span style={{padding:"2px 6px",borderRadius:20,fontSize:10,fontWeight:700,background:sapBs.bg,color:sapBs.fg}}>{r.sapStatus}</span></td>
                    <td style={{padding:"5px 8px",fontSize:10}}>{r.jenisBarang||"-"}</td>
                    <td style={{padding:"5px 8px",textAlign:"center"}}>{r.satuan}</td>
                    <td style={{padding:"5px 8px",textAlign:"center",color:C.muted}}>{fmtNum(r.saldoAwal)}</td>
                    <td style={{padding:"5px 8px",textAlign:"center",color:C.green,fontWeight:r.masuk>0?700:400}}>{r.masuk>0?fmtNum(r.masuk):"-"}</td>
                    <td style={{padding:"5px 8px",textAlign:"center",color:C.red,fontWeight:r.keluar>0?700:400}}>{r.keluar>0?fmtNum(r.keluar):"-"}</td>
                    <td style={{padding:"5px 8px",textAlign:"center",fontWeight:700}}>{fmtNum(r.saldoAkhir)}</td>
                    <td style={{padding:"5px 8px",fontSize:10,color:"#0098da",whiteSpace:"nowrap"}}>{r.tugBaDoc}</td>
                    <td style={{padding:"5px 8px",fontSize:10,color:C.muted,maxWidth:140,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{r.keterangan}</td>
                    <td style={{padding:"5px 8px",textAlign:"center",fontSize:10,whiteSpace:"nowrap"}}>{r.tanggalMutasi}</td>
                  </tr>
                );
              })}
              <tr style={{background:"#f1f5f9",fontWeight:700,borderTop:`2px solid ${C.border}`}}>
                <td colSpan={7} style={{padding:"6px 8px",textAlign:"right"}}>TOTAL</td>
                <td style={{padding:"6px 8px",textAlign:"center",color:C.green}}>{fmtNum(rows.reduce((a,r)=>a+r.masuk,0))}</td>
                <td style={{padding:"6px 8px",textAlign:"center",color:C.red}}>{fmtNum(rows.reduce((a,r)=>a+r.keluar,0))}</td>
                <td colSpan={4}></td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── PETA GUDANG TAB ─────────────────────────────────────────────────────
function HeavyEquipmentTabV2({ equipmentList, loans, currentUser, users, sty, C, handleImg, savePhoto, createLoan, approveLoan, rejectLoan, completeLoan, showToast }) {
  const [activeTab, setActiveTab] = useState("list");
  const appUptShort = (typeof UPT !== "undefined" ? UPT : "").replace(/^UPT\s+/i, "").trim();
  const myUpt = currentUser?.upt || currentUser?.uptName || appUptShort || "";
  const isMSB = ["MSB","Manager UIT"].includes(currentUser?.role);
  const [myUptSelected, setMyUptSelected] = useState(isMSB ? "" : (myUpt || ""));
  const [uptFilter, setUptFilter] = useState("ALL");

  useEffect(() => {
    if (activeTab === "list") setMyUptSelected(isMSB ? "" : (myUpt || ""));
    else setMyUptSelected("");
  }, [activeTab]);
  const [categoryFilter, setCategoryFilter] = useState("ALL");
  const [kondisiFilter, setKondisiFilter] = useState("ALL");
  const [loanCategoryFilter, setLoanCategoryFilter] = useState("ALL");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [loanForm, setLoanForm] = useState({equipmentId:"", requesterUpt:myUpt||"", namaPekerjaan:"", tanggalAmbil:"", tanggalKembali:"", keperluan:"", catatan:""});
  const [historyFilter, setHistoryFilter] = useState({ownerUpt:"ALL", requesterUpt:"ALL", equipmentId:"ALL", status:"ALL", from:"", to:""});
  const [rejectingId, setRejectingId] = useState(null);
  const [reason, setReason] = useState("");

  const normalizedLoans = loans.map(l=>({
    ...l,
    ownerUpt:getHeavyEquipmentLoanOwnerUpt(l),
    requesterUpt:getHeavyEquipmentLoanRequesterUpt(l),
    tanggalAmbil:getHeavyEquipmentLoanStartDate(l),
    tanggalKembali:getHeavyEquipmentLoanReturnDate(l),
    namaPekerjaan:getHeavyEquipmentLoanJobName(l),
    runtimeStatus:getHeavyEquipmentLoanRuntimeStatus(l),
  })).sort((a,b)=>(b.requestedAt||0)-(a.requestedAt||0));
  const uptOptions = Array.from(new Set([
    ...equipmentList.map(e=>e.upt),
    ...normalizedLoans.map(l=>l.ownerUpt),
    ...normalizedLoans.map(l=>l.requesterUpt),
  ].filter(Boolean))).sort();
  const canManage = ["ADMIN","TL"].includes(currentUser.role);
  const selectedEquipment = equipmentList.find(e=>e.id===loanForm.equipmentId);
  const requesterOptions = selectedEquipment ? uptOptions.filter(u=>u!==selectedEquipment.upt) : uptOptions;
  const pendingCount = normalizedLoans.filter(isPendingHeavyEquipmentLoan).length;
  const dipinjamCount = normalizedLoans.filter(l=>l.runtimeStatus==="DIPINJAM").length;
  const overdueCount = normalizedLoans.filter(l=>l.runtimeStatus==="OVERDUE").length;
  const issueCount = equipmentList.filter(e=>["PERLU_SERVICE","BUTUH_PERBAIKAN","BUTUH_PEREMAJAAN"].includes(e.statusAlat)).length;
  const availableCount = equipmentList.filter(e=>e.availabilityStatus!=="DIPINJAM").length;

  const statusMeta = {
    LAYAK:{label:"Layak", bg:"#dcfce7", fg:C.green},
    PERLU_SERVICE:{label:"Perlu Service", bg:"#fef3c7", fg:"#92400e"},
    BUTUH_PERBAIKAN:{label:"Butuh Perbaikan", bg:"#fee2e2", fg:C.red},
    BUTUH_PEREMAJAAN:{label:"Butuh Peremajaan", bg:"#f3e8ff", fg:"#7c3aed"},
    TERSEDIA:{label:"Tersedia", bg:"#e0f2fe", fg:"#0369a1"},
    DIPINJAM:{label:"Dipinjam", bg:"#ffedd5", fg:"#c2410c"},
    PENDING_OWNER_ASMAN:{label:"Menunggu Asman Pemilik", bg:"#fef3c7", fg:"#92400e"},
    OVERDUE:{label:"Overdue", bg:"#fee2e2", fg:C.red},
    REJECTED:{label:"Ditolak", bg:"#fee2e2", fg:C.red},
    SELESAI:{label:"Selesai", bg:"#e0f2fe", fg:"#0369a1"},
  };
  const Badge = ({metaKey}) => {
    const key = normalizeHeavyEquipmentLoanStatus(metaKey);
    const m = statusMeta[key] || {label:key, bg:"#f3f4f6", fg:C.muted};
    return <span style={{padding:"3px 9px",borderRadius:20,fontSize:10,fontWeight:800,background:m.bg,color:m.fg,whiteSpace:"nowrap"}}>{m.label}</span>;
  };
  const loanBorderColor = status => status==="OVERDUE" ? C.red : status==="PENDING_OWNER_ASMAN" ? C.yellow : status==="DIPINJAM" ? "#c2410c" : status==="REJECTED" ? C.red : "#0369a1";
  const loanUserName = userId => users.find(u=>u.id===userId)?.name || "-";
  const latestLoanForEquipment = equipmentId => normalizedLoans.find(l=>l.equipmentId===equipmentId);
  const activeLoanForEquipment = equipmentId => normalizedLoans.find(l=>l.equipmentId===equipmentId && ["DIPINJAM","OVERDUE"].includes(l.runtimeStatus));

  const EQUIPMENT_CATEGORIES = [
    { id:"ALL", label:"Semua", icon:(
      <svg width="28" height="28" viewBox="0 0 28 28" fill="none"><rect x="2" y="2" width="10" height="10" rx="2" fill="currentColor" opacity=".7"/><rect x="16" y="2" width="10" height="10" rx="2" fill="currentColor" opacity=".5"/><rect x="2" y="16" width="10" height="10" rx="2" fill="currentColor" opacity=".5"/><rect x="16" y="16" width="10" height="10" rx="2" fill="currentColor" opacity=".3"/></svg>
    )},
    { id:"crane", label:"Crane", icon:(
      <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
        {/* Truck body */}
        <rect x="2" y="17" width="16" height="7" rx="1.5" fill="currentColor" opacity=".85"/>
        {/* Cab */}
        <rect x="14" y="14" width="7" height="10" rx="1" fill="currentColor" opacity=".7"/>
        {/* Wheels */}
        <circle cx="6" cy="25" r="2.5" fill="currentColor"/>
        <circle cx="17" cy="25" r="2.5" fill="currentColor"/>
        {/* Crane arm */}
        <line x1="8" y1="17" x2="8" y2="4" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
        <line x1="8" y1="4" x2="22" y2="8" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
        <line x1="22" y1="8" x2="22" y2="14" stroke="currentColor" strokeWidth="1.5" strokeDasharray="2 1"/>
        {/* Hook */}
        <circle cx="22" cy="15" r="1.5" fill="currentColor" opacity=".6"/>
      </svg>
    )},
    { id:"forklift", label:"Forklift", icon:(
      <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
        {/* Body */}
        <rect x="7" y="11" width="14" height="11" rx="2" fill="currentColor" opacity=".85"/>
        {/* Mast */}
        <rect x="4" y="4" width="3" height="18" rx="1" fill="currentColor" opacity=".7"/>
        {/* Forks */}
        <rect x="1" y="19" width="6" height="2" rx="0.5" fill="currentColor"/>
        <rect x="1" y="22" width="6" height="2" rx="0.5" fill="currentColor"/>
        {/* Wheels */}
        <circle cx="10" cy="24" r="2.5" fill="currentColor"/>
        <circle cx="20" cy="24" r="2.5" fill="currentColor"/>
        {/* Cab detail */}
        <rect x="14" y="13" width="5" height="5" rx="1" fill="white" opacity=".3"/>
      </svg>
    )},
    { id:"manlift", label:"Manlift", icon:(
      <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
        {/* Base / truck */}
        <rect x="2" y="18" width="18" height="7" rx="1.5" fill="currentColor" opacity=".85"/>
        {/* Wheels */}
        <circle cx="6" cy="26" r="2" fill="currentColor"/>
        <circle cx="16" cy="26" r="2" fill="currentColor"/>
        {/* Boom arm (telescopic) */}
        <line x1="10" y1="18" x2="10" y2="8" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/>
        <line x1="10" y1="8" x2="20" y2="4" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
        {/* Basket */}
        <rect x="18" y="1" width="8" height="6" rx="1" fill="currentColor" opacity=".7"/>
        {/* Person */}
        <circle cx="22" cy="3" r="1.2" fill="white" opacity=".8"/>
      </svg>
    )},
    { id:"pendukung", label:"Alat Pendukung", icon:(
      <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
        {/* Hand pallet silhouette */}
        {/* Platform */}
        <rect x="2" y="12" width="18" height="4" rx="1" fill="currentColor" opacity=".85"/>
        {/* Handle */}
        <path d="M18 14 Q22 14 22 8 L24 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none"/>
        {/* Forks */}
        <rect x="3" y="16" width="6" height="8" rx="0.5" fill="currentColor" opacity=".7"/>
        <rect x="11" y="16" width="6" height="8" rx="0.5" fill="currentColor" opacity=".7"/>
        {/* Wheels */}
        <circle cx="5" cy="25" r="2" fill="currentColor"/>
        <circle cx="14" cy="25" r="2" fill="currentColor"/>
        <circle cx="22" cy="7" r="1.5" fill="currentColor" opacity=".5"/>
      </svg>
    )},
  ];

  const categoryCounts = EQUIPMENT_CATEGORIES.reduce((acc, cat) => {
    acc[cat.id] = cat.id==="ALL" ? equipmentList.length : equipmentList.filter(e=>getEquipmentCategory(e)===cat.id).length;
    return acc;
  }, {});

  const filteredEquipment = equipmentList.filter(e =>
    (!myUptSelected || e.upt===myUptSelected) &&
    (categoryFilter==="ALL" || getEquipmentCategory(e)===categoryFilter) &&
    (kondisiFilter==="ALL" || e.statusAlat===kondisiFilter || (kondisiFilter==="DIPINJAM" && !!activeLoanForEquipment(e.id)))
  );
  const unifiedLoans = normalizedLoans
    .filter(l=>(loanCategoryFilter==="ALL"||getEquipmentCategory(equipmentList.find(e=>e.id===l.equipmentId)||{})===loanCategoryFilter))
    .sort((a,b)=>(b.requestedAt||0)-(a.requestedAt||0));


  async function submitLoan() {
    await createLoan(loanForm);
    setLoanForm({equipmentId:"", requesterUpt:myUpt||"", namaPekerjaan:"", tanggalAmbil:"", tanggalKembali:"", keperluan:"", catatan:""});
  }

  // Kondisi overview data
  const kondisiGroups = [
    {id:"ALL",      label:"Semua Alat",     color:C.accent,   count:equipmentList.filter(e=>!myUptSelected||e.upt===myUptSelected).length},
    {id:"LAYAK",    label:"Layak",          color:C.green,    count:equipmentList.filter(e=>(!myUptSelected||e.upt===myUptSelected)&&e.statusAlat==="LAYAK").length},
    {id:"DIPINJAM", label:"Dipinjam",       color:"#c2410c",  count:equipmentList.filter(e=>(!myUptSelected||e.upt===myUptSelected)&&activeLoanForEquipment(e.id)).length},
    {id:"PERLU_SERVICE",    label:"Perlu Service",    color:"#f59e0b", count:equipmentList.filter(e=>(!myUptSelected||e.upt===myUptSelected)&&e.statusAlat==="PERLU_SERVICE").length},
    {id:"BUTUH_PERBAIKAN",  label:"Butuh Perbaikan",  color:C.red,     count:equipmentList.filter(e=>(!myUptSelected||e.upt===myUptSelected)&&e.statusAlat==="BUTUH_PERBAIKAN").length},
    {id:"BUTUH_PEREMAJAAN", label:"Butuh Peremajaan", color:"#7c3aed", count:equipmentList.filter(e=>(!myUptSelected||e.upt===myUptSelected)&&e.statusAlat==="BUTUH_PEREMAJAAN").length},
  ].filter(g=>g.id==="ALL"||g.count>0);

  return (
    <div>
      {/* Header */}
      <h1 style={{fontSize:20,fontWeight:900,marginBottom:12}}>🚜 Alat Berat & Peminjaman UPT</h1>

      {/* Filter UPT — hanya tampil di tab Peminjaman & Histori */}
      {activeTab === "loans" ? (
        <div style={{display:"flex",gap:10,alignItems:"flex-end",flexWrap:"wrap",marginBottom:12}}>
          <div style={{minWidth:180}}>
            <label style={{...sty.label,marginBottom:3}}>Filter UPT</label>
            <select style={sty.select} value={myUptSelected} onChange={e=>setMyUptSelected(e.target.value)}>
              <option value="">Semua UPT</option>
              {uptOptions.map(u=><option key={u} value={u}>{u}</option>)}
            </select>
          </div>
          <div style={{fontSize:12,color:C.muted,paddingBottom:6}}>
            {myUptSelected ? <><b style={{color:C.accent}}>{myUptSelected}</b></> : "Menampilkan semua UPT"}
          </div>
        </div>
      ) : (
        <div style={{fontSize:12,color:C.muted,marginBottom:12}}>
          {isMSB
            ? <>Menampilkan <b style={{color:C.accent}}>semua UPT</b> — {equipmentList.length} alat</>
            : <>Menampilkan alat <b style={{color:C.accent}}>UPT {myUpt||"Surabaya"}</b> — {equipmentList.filter(e=>e.upt===(myUpt||"Surabaya")).length} alat</>
          }
        </div>
      )}

      {/* Overview kondisi — clickable chips */}
      <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:12}}>
        {kondisiGroups.map(g=>{
          const active = kondisiFilter===g.id;
          return (
            <button key={g.id} onClick={()=>{setKondisiFilter(g.id); if(activeTab!=="list") setActiveTab("list");}}
              style={{display:"flex",alignItems:"center",gap:6,padding:"6px 14px",borderRadius:20,border:`2px solid ${active?g.color:C.border}`,background:active?g.color:"white",color:active?"white":g.color,fontWeight:700,fontSize:12,cursor:"pointer",boxShadow:active?"0 2px 8px rgba(0,0,0,.12)":"none"}}>
              <span style={{fontWeight:900,fontSize:14}}>{g.count}</span>
              <span>{g.label}</span>
            </button>
          );
        })}
      </div>

      {/* Tab buttons — di bawah overview kondisi */}
      <div style={{display:"flex",gap:6,marginBottom:14}}>
        {[{id:"list",label:"List Alat"},{id:"loans",label:"Peminjaman & Histori"}].map(t=>(
          <button key={t.id} style={{padding:"6px 16px",borderRadius:8,border:`1px solid ${activeTab===t.id?C.accent:C.border}`,background:activeTab===t.id?C.accent:"white",color:activeTab===t.id?"white":C.muted,fontSize:12,fontWeight:700,cursor:"pointer"}} onClick={()=>setActiveTab(t.id)}>
            {t.label}{t.id==="loans"&&pendingCount>0&&<span style={{marginLeft:5,background:"#dc2626",color:"white",borderRadius:10,padding:"0 5px",fontSize:10}}>{pendingCount}</span>}
          </button>
        ))}
      </div>

      {activeTab==="list" && (
        <>
          {/* Filter Kategori — di bawah tab */}
          <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:10}}>
            {EQUIPMENT_CATEGORIES.map(cat=>{
              const active = categoryFilter===cat.id;
              const count = equipmentList.filter(e=>
                (!myUptSelected||e.upt===myUptSelected)&&
                (cat.id==="ALL"||getEquipmentCategory(e)===cat.id)&&
                (kondisiFilter==="ALL"||e.statusAlat===kondisiFilter||(kondisiFilter==="DIPINJAM"&&!!activeLoanForEquipment(e.id)))
              ).length;
              return (
                <button key={cat.id} onClick={()=>setCategoryFilter(cat.id)} style={{display:"flex",flexDirection:"column",alignItems:"center",gap:2,padding:"6px 12px",minWidth:64,borderRadius:10,border:`2px solid ${active?C.accent:C.border}`,background:active?"#eff6ff":"white",color:active?C.accent:C.muted,cursor:"pointer",boxShadow:active?"0 2px 8px rgba(0,152,218,.15)":"none"}}>
                  <span style={{color:active?C.accent:"#9ca3af",display:"flex"}}>{cat.icon}</span>
                  <span style={{fontSize:10,fontWeight:active?800:500,whiteSpace:"nowrap"}}>{cat.label}</span>
                  <span style={{fontSize:10,fontWeight:700,color:active?C.accent:C.muted}}>{count}</span>
                </button>
              );
            })}
          </div>
          {/* Keterangan filter aktif */}
          <div style={{fontSize:11,color:C.muted,marginBottom:10}}>
            Menampilkan <b style={{color:C.text}}>{filteredEquipment.length}</b> alat
            {kondisiFilter!=="ALL"&&<span> • Kondisi: <b style={{color:C.accent}}>{kondisiGroups.find(g=>g.id===kondisiFilter)?.label}</b></span>}
            {categoryFilter!=="ALL"&&<span> • Kategori: <b style={{color:C.accent}}>{EQUIPMENT_CATEGORIES.find(c=>c.id===categoryFilter)?.label}</b></span>}
          </div>

          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(300px,1fr))",gap:12}}>
            {filteredEquipment.map(eq=>{
              const activeLoan = activeLoanForEquipment(eq.id);
              const lastLoan = latestLoanForEquipment(eq.id);
              return (
                <div key={eq.id} style={{...sty.card,padding:14,display:"flex",flexDirection:"column",gap:10,borderLeft:activeLoan?`4px solid ${loanBorderColor(activeLoan.runtimeStatus)}`:undefined}}>
                  <div style={{height:150,borderRadius:10,background:"#f3f4f6",border:`1px solid ${C.border}`,overflow:"hidden",display:"flex",alignItems:"center",justifyContent:"center"}}>
                    {eq.foto ? <img src={eq.foto} alt={eq.nama} style={{width:"100%",height:"100%",objectFit:"cover"}}/> : <div style={{fontSize:38,color:"#9ca3af"}}>🚜</div>}
                  </div>
                  <div style={{display:"flex",justifyContent:"space-between",gap:8,alignItems:"flex-start"}}>
                    <div><div style={{fontSize:14,fontWeight:900}}>{eq.nama}</div><div style={{fontSize:11,color:C.muted}}>{eq.upt} • {eq.lokasi}</div></div>
                    <Badge metaKey={activeLoan?.runtimeStatus || eq.availabilityStatus || "TERSEDIA"}/>
                  </div>
                  <div style={{display:"flex",gap:6,flexWrap:"wrap"}}><Badge metaKey={eq.statusAlat}/><span style={{padding:"3px 9px",borderRadius:20,fontSize:10,fontWeight:700,background:"#f3f4f6",color:C.muted}}>{eq.jenis}</span></div>
                  <div style={{fontSize:11,color:C.muted,lineHeight:1.6}}>Merk/Type: <b>{eq.merkType||"-"}</b><br/>Kapasitas: <b>{eq.kapasitas||"-"}</b> • Tahun: <b>{eq.tahun||"-"}</b><br/>No Seri: <b>{eq.nomorSeri||"-"}</b><br/>Kondisi: <b>{eq.kondisi||"-"}</b><br/>Surat Izin: <b>{eq.suratIzinAlat||"Belum ada data"}</b></div>
                  {activeLoan && <div style={{background:activeLoan.runtimeStatus==="OVERDUE"?"#fef2f2":"#fff7ed",border:`1px solid ${activeLoan.runtimeStatus==="OVERDUE"?"#fecaca":"#fed7aa"}`,borderRadius:8,padding:10,fontSize:11,lineHeight:1.5}}><div style={{fontWeight:900,color:activeLoan.runtimeStatus==="OVERDUE"?C.red:"#c2410c"}}>{activeLoan.runtimeStatus==="OVERDUE"?"OVERDUE":"Sedang dipinjam"}</div><div>{activeLoan.requesterUpt} • {activeLoan.namaPekerjaan || "-"}</div><div style={{color:C.muted}}>Rencana kembali: {activeLoan.tanggalKembali || "-"}</div></div>}
                  {lastLoan && <div style={{fontSize:11,color:C.muted,borderTop:`1px solid ${C.border}`,paddingTop:8}}>Terakhir dipinjam oleh <b>{lastLoan.requesterUpt || "-"}</b> untuk pekerjaan <b>{lastLoan.namaPekerjaan || "-"}</b>.</div>}
                  {canManage && <label style={{...sty.btn("ghost","sm"),textAlign:"center"}}>📷 Upload Foto<input type="file" accept="image/*" capture="environment" style={{display:"none"}} onChange={e=>handleImg(e, img=>savePhoto(eq.id, img))}/></label>}
                </div>
              );
            })}
          </div>
        </>
      )}

      {activeTab==="loans" && (
        <div>
          {/* Category filter pills */}
          <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:10}}>
            {EQUIPMENT_CATEGORIES.map(cat=>{
              const active = loanCategoryFilter===cat.id;
              const base = equipmentList.filter(e=>(cat.id==="ALL"||getEquipmentCategory(e)===cat.id));
              const countActive = base.filter(e=>activeLoanForEquipment(e.id)).length;
              const countTotal = base.length;
              return (
                <button key={cat.id} onClick={()=>setLoanCategoryFilter(cat.id)}
                  style={{display:"flex",flexDirection:"column",alignItems:"center",gap:2,padding:"6px 12px",minWidth:64,borderRadius:10,border:`2px solid ${active?C.accent:C.border}`,background:active?"#eff6ff":"white",color:active?C.accent:C.muted,cursor:"pointer",boxShadow:active?"0 2px 8px rgba(0,152,218,.15)":"none"}}>
                  <span style={{color:active?C.accent:"#9ca3af"}}>{cat.icon}</span>
                  <span style={{fontSize:10,fontWeight:active?800:500,whiteSpace:"nowrap"}}>{cat.label}</span>
                  <span style={{fontSize:10,color:active?C.accent:C.muted}}><b>{countActive}</b>/{countTotal}</span>
                </button>
              );
            })}
            <div style={{display:"flex",alignItems:"center",fontSize:11,color:C.muted,paddingLeft:4}}>dipinjam/total</div>
          </div>

          {/* Ringkasan 1 baris */}
          <div style={{display:"flex",gap:16,flexWrap:"wrap",marginBottom:14,padding:"9px 14px",background:"#f8fafc",borderRadius:10,border:`1px solid ${C.border}`,fontSize:12,alignItems:"center"}}>
            {(()=>{
              const base = equipmentList.filter(e=>(loanCategoryFilter==="ALL"||getEquipmentCategory(e)===loanCategoryFilter));
              const avail = base.filter(e=>!activeLoanForEquipment(e.id)).length;
              const pinjam = base.filter(e=>{ const l=activeLoanForEquipment(e.id); return l&&l.runtimeStatus==="DIPINJAM"; }).length;
              const overdue = base.filter(e=>{ const l=activeLoanForEquipment(e.id); return l&&l.runtimeStatus==="OVERDUE"; }).length;
              return [
                {label:"Total",val:base.length,color:C.accent},
                {label:"Tersedia",val:avail,color:C.green},
                {label:"Dipinjam",val:pinjam,color:"#c2410c"},
                {label:"Overdue",val:overdue,color:overdue?C.red:C.muted},
                {label:"Pending",val:pendingCount,color:pendingCount?"#92400e":C.muted},
              ].map(k=>(
                <div key={k.label} style={{display:"flex",alignItems:"baseline",gap:4}}>
                  <span style={{color:C.muted}}>{k.label}:</span>
                  <span style={{fontWeight:900,fontSize:14,color:k.color}}>{k.val}</span>
                </div>
              ));
            })()}
          </div>

          {/* 2-column: Form | Unified loan list */}
          <div style={{display:"grid",gridTemplateColumns:canManage?"minmax(260px,300px) 1fr":"1fr",gap:14,alignItems:"start"}}>

            {/* Form ajukan (Admin/TL only) */}
            {canManage && (
              <div style={sty.card}>
                <div style={{fontSize:13,fontWeight:900,marginBottom:10}}>Ajukan Peminjaman</div>
                <div style={{marginBottom:8}}><label style={sty.label}>Alat</label><select style={sty.select} value={loanForm.equipmentId} onChange={e=>setLoanForm(f=>({...f,equipmentId:e.target.value,requesterUpt:""}))}><option value="">-- Pilih alat --</option>{equipmentList.filter(e=>e.availabilityStatus!=="DIPINJAM").map(e=><option key={e.id} value={e.id}>{e.upt} — {e.nama} ({e.kapasitas||"-"})</option>)}</select>{selectedEquipment&&<div style={{fontSize:10,color:C.muted,marginTop:3}}>Pemilik: <b>{selectedEquipment.upt}</b></div>}</div>
                <div style={{marginBottom:8}}><label style={sty.label}>UPT Peminjam</label><select style={sty.select} value={loanForm.requesterUpt} onChange={e=>setLoanForm(f=>({...f,requesterUpt:e.target.value}))}><option value="">-- Pilih UPT --</option>{requesterOptions.map(u=><option key={u} value={u}>{u}</option>)}</select></div>
                <div style={{marginBottom:8}}><label style={sty.label}>Nama Pekerjaan</label><input style={sty.input} value={loanForm.namaPekerjaan} onChange={e=>setLoanForm(f=>({...f,namaPekerjaan:e.target.value}))} placeholder="Contoh: Penggantian PMT Bay Trafo 1"/></div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6,marginBottom:8}}><div><label style={sty.label}>Tgl Ambil</label><input style={sty.input} type="date" value={loanForm.tanggalAmbil} onChange={e=>setLoanForm(f=>({...f,tanggalAmbil:e.target.value}))}/></div><div><label style={sty.label}>Tgl Kembali</label><input style={sty.input} type="date" value={loanForm.tanggalKembali} onChange={e=>setLoanForm(f=>({...f,tanggalKembali:e.target.value}))}/></div></div>
                <div style={{marginBottom:8}}><label style={sty.label}>Keperluan</label><textarea style={{...sty.input,minHeight:60}} value={loanForm.keperluan} onChange={e=>setLoanForm(f=>({...f,keperluan:e.target.value}))}/></div>
                <div style={{marginBottom:10}}><label style={sty.label}>Catatan</label><input style={sty.input} value={loanForm.catatan} onChange={e=>setLoanForm(f=>({...f,catatan:e.target.value}))}/></div>
                <button style={{...sty.btn("primary"),width:"100%"}} onClick={submitLoan}>Ajukan Peminjaman</button>
              </div>
            )}

            {/* Unified loan list: aktif + histori, Surabaya only, newest first */}
            <div>
              <div style={{fontSize:12,fontWeight:800,color:C.muted,textTransform:"uppercase",letterSpacing:1,marginBottom:8}}>
                Peminjaman & Histori — Semua UPT
              </div>
              <div style={{display:"flex",flexDirection:"column",gap:8,maxHeight:640,overflowY:"auto"}}>
                {unifiedLoans.length===0 && <div style={{...sty.card,textAlign:"center",color:C.muted,padding:20,fontSize:13}}>Belum ada data peminjaman.</div>}
                {unifiedLoans.map(loan=>{
                  const eq=equipmentList.find(e=>e.id===loan.equipmentId);
                  const isActive=["PENDING_OWNER_ASMAN","DIPINJAM","OVERDUE"].includes(loan.runtimeStatus);
                  return (
                    <div key={loan.id} style={{...sty.card,padding:12,borderLeft:`4px solid ${loanBorderColor(loan.runtimeStatus)}`,opacity:isActive?1:0.85}}>
                      <div style={{display:"flex",justifyContent:"space-between",gap:8,alignItems:"flex-start",marginBottom:4}}>
                        <div>
                          <div style={{fontWeight:900,fontSize:13}}>{eq?.nama||loan.equipmentId}</div>
                          <div style={{fontSize:11,color:C.muted}}>{loan.ownerUpt} → {loan.requesterUpt}</div>
                        </div>
                        <Badge metaKey={loan.runtimeStatus}/>
                      </div>
                      <div style={{fontSize:12,fontWeight:700,marginBottom:2}}>{loan.namaPekerjaan||"-"}</div>
                      <div style={{fontSize:11,color:C.muted,marginBottom:isActive?6:0}}>{loan.tanggalAmbil} s/d {loan.tanggalKembali}</div>
                      {isActive&&isPendingHeavyEquipmentLoan(loan)&&canApproveHeavyEquipmentLoan(currentUser,loan)&&(
                        <div style={{display:"flex",gap:6,flexWrap:"wrap",marginTop:6}}>
                          {rejectingId===loan.id
                            ?<><input style={{...sty.input,flex:"1 1 160px"}} value={reason} onChange={e=>setReason(e.target.value)} placeholder="Alasan penolakan"/><button style={sty.btn("danger","sm")} onClick={()=>{rejectLoan(loan.id,reason);setRejectingId(null);setReason("");}}>Tolak</button><button style={sty.btn("ghost","sm")} onClick={()=>{setRejectingId(null);setReason("");}}>Batal</button></>
                            :<><button style={sty.btn("success","sm")} onClick={()=>approveLoan(loan.id)}>Setujui</button><button style={sty.btn("danger","sm")} onClick={()=>setRejectingId(loan.id)}>Tolak</button></>}
                        </div>
                      )}
                      {isActive&&["DIPINJAM","OVERDUE"].includes(loan.runtimeStatus)&&["ADMIN","TL","ASMAN"].includes(currentUser.role)&&(
                        <button style={{...sty.btn("ghost","sm"),marginTop:6}} onClick={()=>completeLoan(loan.id)}>Tandai Kembali</button>
                      )}
                      {["DIPINJAM","OVERDUE","SELESAI"].includes(loan.runtimeStatus) && (
                        <button style={{...sty.btn("ghost","sm"),marginTop:6,marginLeft:isActive&&["DIPINJAM","OVERDUE"].includes(loan.runtimeStatus)&&["ADMIN","TL","ASMAN"].includes(currentUser.role)?6:0}} onClick={()=>downloadHeavyEquipmentLoanHTML(loan, eq, users, showToast)}>📄 Cetak Dokumen</button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

          </div>
        </div>
      )}
    </div>
  );
}

// Legacy implementasi awal. Menu aktif sekarang memakai HeavyEquipmentTabV2,
// fungsi ini sengaja belum dihapus agar mudah dibandingkan saat migrasi ke Claude.
function HeavyEquipmentTab({ equipmentList, loans, currentUser, users, sty, C, handleImg, savePhoto, createLoan, approveLoan, rejectLoan, completeLoan }) {
  const [activeTab, setActiveTab] = useState("list");
  const [uptFilter, setUptFilter] = useState("ALL");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [loanForm, setLoanForm] = useState({equipmentId:"", toUpt:"", tanggalMulai:"", tanggalSelesai:"", keperluan:"", catatan:""});
  const [rejectingId, setRejectingId] = useState(null);
  const [reason, setReason] = useState("");

  const uptOptions = Array.from(new Set(equipmentList.map(e=>e.upt).filter(Boolean))).sort();
  const filtered = equipmentList.filter(e =>
    (uptFilter==="ALL" || e.upt===uptFilter) &&
    (statusFilter==="ALL" || e.statusAlat===statusFilter || e.availabilityStatus===statusFilter)
  );
  const pendingCount = loans.filter(l=>l.status==="PENDING_ASMAN").length;
  const borrowedCount = equipmentList.filter(e=>e.availabilityStatus==="DIPINJAM").length;
  const issueCount = equipmentList.filter(e=>["PERLU_SERVICE","BUTUH_PERBAIKAN","BUTUH_PEREMAJAAN"].includes(e.statusAlat)).length;
  const noPermitCount = equipmentList.filter(e=>!e.suratIzinAlat).length;
  const canManage = ["ADMIN","TL"].includes(currentUser.role);

  const statusMeta = {
    LAYAK:{label:"Layak", bg:"#dcfce7", fg:C.green},
    PERLU_SERVICE:{label:"Perlu Service", bg:"#fef3c7", fg:"#92400e"},
    BUTUH_PERBAIKAN:{label:"Butuh Perbaikan", bg:"#fee2e2", fg:C.red},
    BUTUH_PEREMAJAAN:{label:"Butuh Peremajaan", bg:"#f3e8ff", fg:"#7c3aed"},
    TERSEDIA:{label:"Tersedia", bg:"#e0f2fe", fg:"#0369a1"},
    DIPINJAM:{label:"Dipinjam", bg:"#ffedd5", fg:"#c2410c"},
  };
  const loanMeta = {
    PENDING_ASMAN:{label:"Menunggu Asman", bg:"#fef3c7", fg:"#92400e"},
    APPROVED:{label:"Disetujui", bg:"#dcfce7", fg:C.green},
    REJECTED:{label:"Ditolak", bg:"#fee2e2", fg:C.red},
    SELESAI:{label:"Selesai", bg:"#e0f2fe", fg:"#0369a1"},
  };
  const Badge = ({metaKey}) => {
    const m = statusMeta[metaKey] || loanMeta[metaKey] || {label:metaKey, bg:"#f3f4f6", fg:C.muted};
    return <span style={{padding:"3px 9px",borderRadius:20,fontSize:10,fontWeight:800,background:m.bg,color:m.fg,whiteSpace:"nowrap"}}>{m.label}</span>;
  };

  function resetLoanForm() {
    setLoanForm({equipmentId:"", toUpt:"", tanggalMulai:"", tanggalSelesai:"", keperluan:"", catatan:""});
  }

  return (
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:12,marginBottom:16,flexWrap:"wrap"}}>
        <div>
          <h1 style={{fontSize:22,fontWeight:900}}>🚜 Alat Berat & Peminjaman UPT</h1>
          <p style={{color:C.muted,fontSize:13}}>Monitoring alat angkat/angkut per UPT, status kelayakan, foto alat, dan peminjaman antar UPT dengan approval Asman.</p>
        </div>
      </div>

      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))",gap:12,marginBottom:16}}>
        {[
          {label:"Total Alat", val:equipmentList.length, color:C.accent},
          {label:"Dipinjam", val:borrowedCount, color:"#c2410c"},
          {label:"Perlu Tindakan", val:issueCount, color:C.red},
          {label:"Izin Kosong", val:noPermitCount, color:C.yellow},
          {label:"Pending Asman", val:pendingCount, color:"#92400e"},
        ].map(k=>(
          <div key={k.label} style={{...sty.card,padding:14}}>
            <div style={{fontSize:11,color:C.muted,fontWeight:700,textTransform:"uppercase"}}>{k.label}</div>
            <div style={{fontSize:26,fontWeight:900,color:k.color}}>{k.val}</div>
          </div>
        ))}
      </div>

      <div style={{display:"flex",gap:8,marginBottom:14,flexWrap:"wrap"}}>
        {[{id:"list",label:"List Alat"},{id:"loans",label:"Peminjaman"}].map(t=>(
          <button key={t.id} style={{padding:"7px 14px",borderRadius:20,border:`1px solid ${activeTab===t.id?C.accent:C.border}`,background:activeTab===t.id?C.accent:"white",color:activeTab===t.id?"white":C.muted,fontSize:12,fontWeight:700,cursor:"pointer"}} onClick={()=>setActiveTab(t.id)}>{t.label}</button>
        ))}
      </div>

      {activeTab==="list" && (
        <>
          <div style={{...sty.card,marginBottom:14,padding:14}}>
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(180px,1fr))",gap:10}}>
              <div>
                <label style={sty.label}>Filter UPT</label>
                <select style={sty.select} value={uptFilter} onChange={e=>setUptFilter(e.target.value)}>
                  <option value="ALL">Semua UPT</option>
                  {uptOptions.map(u=><option key={u} value={u}>{u}</option>)}
                </select>
              </div>
              <div>
                <label style={sty.label}>Filter Status</label>
                <select style={sty.select} value={statusFilter} onChange={e=>setStatusFilter(e.target.value)}>
                  <option value="ALL">Semua Status</option>
                  <option value="LAYAK">Layak</option>
                  <option value="PERLU_SERVICE">Perlu Service</option>
                  <option value="BUTUH_PERBAIKAN">Butuh Perbaikan</option>
                  <option value="BUTUH_PEREMAJAAN">Butuh Peremajaan</option>
                  <option value="TERSEDIA">Tersedia</option>
                  <option value="DIPINJAM">Dipinjam</option>
                </select>
              </div>
            </div>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(280px,1fr))",gap:12}}>
            {filtered.map(eq=>(
              <div key={eq.id} style={{...sty.card,padding:14,display:"flex",flexDirection:"column",gap:10}}>
                <div style={{height:150,borderRadius:10,background:"#f3f4f6",border:`1px solid ${C.border}`,overflow:"hidden",display:"flex",alignItems:"center",justifyContent:"center"}}>
                  {eq.foto ? <img src={eq.foto} alt={eq.nama} style={{width:"100%",height:"100%",objectFit:"cover"}}/> : <div style={{fontSize:38,color:"#9ca3af"}}>🚜</div>}
                </div>
                <div>
                  <div style={{display:"flex",justifyContent:"space-between",gap:8,alignItems:"flex-start"}}>
                    <div>
                      <div style={{fontSize:14,fontWeight:900}}>{eq.nama}</div>
                      <div style={{fontSize:11,color:C.muted}}>{eq.upt} • {eq.lokasi}</div>
                    </div>
                    <Badge metaKey={eq.availabilityStatus || "TERSEDIA"}/>
                  </div>
                  <div style={{display:"flex",gap:6,flexWrap:"wrap",marginTop:8}}>
                    <Badge metaKey={eq.statusAlat}/>
                    <span style={{padding:"3px 9px",borderRadius:20,fontSize:10,fontWeight:700,background:"#f3f4f6",color:C.muted}}>{eq.jenis}</span>
                  </div>
                </div>
                <div style={{fontSize:11,color:C.muted,lineHeight:1.6}}>
                  Merk/Type: <b>{eq.merkType||"-"}</b><br/>
                  Kapasitas: <b>{eq.kapasitas||"-"}</b> • Tahun: <b>{eq.tahun||"-"}</b><br/>
                  No Seri: <b>{eq.nomorSeri||"-"}</b><br/>
                  Kondisi: <b>{eq.kondisi||"-"}</b><br/>
                  Surat Izin: <b>{eq.suratIzinAlat||"Belum ada data"}</b>
                </div>
                {canManage && (
                  <label style={{...sty.btn("ghost","sm"),textAlign:"center"}}>
                    📷 Upload Foto
                    <input type="file" accept="image/*" capture="environment" style={{display:"none"}} onChange={e=>handleImg(e, img=>savePhoto(eq.id, img))}/>
                  </label>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {activeTab==="loans" && (
        <div style={{display:"grid",gridTemplateColumns:canManage?"minmax(280px,360px) 1fr":"1fr",gap:16,alignItems:"start"}}>
          {canManage && (
            <div style={sty.card}>
              <div style={{fontSize:15,fontWeight:900,marginBottom:12}}>Ajukan Peminjaman Alat</div>
              <div style={{marginBottom:10}}>
                <label style={sty.label}>Alat</label>
                <select style={sty.select} value={loanForm.equipmentId} onChange={e=>setLoanForm(f=>({...f,equipmentId:e.target.value}))}>
                  <option value="">-- Pilih alat tersedia --</option>
                  {equipmentList.filter(e=>e.availabilityStatus!=="DIPINJAM").map(e=><option key={e.id} value={e.id}>{e.upt} - {e.nama} ({e.kapasitas||"-"}) @ {e.lokasi}</option>)}
                </select>
              </div>
              <div style={{marginBottom:10}}>
                <label style={sty.label}>UPT Peminjam</label>
                <select style={sty.select} value={loanForm.toUpt} onChange={e=>setLoanForm(f=>({...f,toUpt:e.target.value}))}>
                  <option value="">-- Pilih UPT --</option>
                  {uptOptions.map(u=><option key={u} value={u}>{u}</option>)}
                </select>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:10}}>
                <div><label style={sty.label}>Mulai</label><input style={sty.input} type="date" value={loanForm.tanggalMulai} onChange={e=>setLoanForm(f=>({...f,tanggalMulai:e.target.value}))}/></div>
                <div><label style={sty.label}>Selesai</label><input style={sty.input} type="date" value={loanForm.tanggalSelesai} onChange={e=>setLoanForm(f=>({...f,tanggalSelesai:e.target.value}))}/></div>
              </div>
              <div style={{marginBottom:10}}><label style={sty.label}>Keperluan</label><textarea style={{...sty.input,minHeight:70}} value={loanForm.keperluan} onChange={e=>setLoanForm(f=>({...f,keperluan:e.target.value}))}/></div>
              <div style={{marginBottom:12}}><label style={sty.label}>Catatan</label><input style={sty.input} value={loanForm.catatan} onChange={e=>setLoanForm(f=>({...f,catatan:e.target.value}))}/></div>
              <button style={{...sty.btn("primary"),width:"100%"}} onClick={async()=>{await createLoan(loanForm); resetLoanForm();}}>Ajukan ke Asman</button>
            </div>
          )}
          <div style={{display:"flex",flexDirection:"column",gap:10}}>
            {loans.length===0 && <div style={{...sty.card,textAlign:"center",color:C.muted}}>Belum ada peminjaman alat.</div>}
            {loans.map(loan=>{
              const eq = equipmentList.find(e=>e.id===loan.equipmentId);
              const requester = users.find(u=>u.id===loan.requestedBy);
              return (
                <div key={loan.id} style={{...sty.card,padding:14,borderLeft:`4px solid ${loan.status==="PENDING_ASMAN"?C.yellow:loan.status==="APPROVED"?C.green:loan.status==="REJECTED"?C.red:"#0369a1"}`}}>
                  <div style={{display:"flex",justifyContent:"space-between",gap:10,alignItems:"flex-start",marginBottom:8}}>
                    <div>
                      <div style={{fontWeight:900,fontSize:14}}>{eq?.nama||loan.equipmentId}</div>
                      <div style={{fontSize:11,color:C.muted}}>{loan.fromUpt} → {loan.toUpt} • {loan.tanggalMulai} s/d {loan.tanggalSelesai}</div>
                    </div>
                    <Badge metaKey={loan.status}/>
                  </div>
                  <div style={{fontSize:12,color:C.text,marginBottom:6}}>{loan.keperluan}</div>
                  <div style={{fontSize:11,color:C.muted,marginBottom:10}}>Diajukan oleh {requester?.name||"-"} • {fmtDate(loan.requestedAt)}{loan.catatan ? ` • ${loan.catatan}` : ""}</div>
                  {loan.status==="PENDING_ASMAN" && currentUser.role==="ASMAN" && (
                    <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
                      {rejectingId===loan.id ? (
                        <>
                          <input style={{...sty.input,flex:"1 1 220px"}} value={reason} onChange={e=>setReason(e.target.value)} placeholder="Alasan penolakan"/>
                          <button style={sty.btn("danger","sm")} onClick={()=>{rejectLoan(loan.id, reason); setRejectingId(null); setReason("");}}>Konfirmasi Tolak</button>
                          <button style={sty.btn("ghost","sm")} onClick={()=>{setRejectingId(null); setReason("");}}>Batal</button>
                        </>
                      ) : (
                        <>
                          <button style={sty.btn("success","sm")} onClick={()=>approveLoan(loan.id)}>Setujui</button>
                          <button style={sty.btn("danger","sm")} onClick={()=>setRejectingId(loan.id)}>Tolak</button>
                        </>
                      )}
                    </div>
                  )}
                  {loan.status==="APPROVED" && ["ADMIN","TL","ASMAN"].includes(currentUser.role) && (
                    <button style={sty.btn("ghost","sm")} onClick={()=>completeLoan(loan.id)}>Tandai Sudah Kembali</button>
                  )}
                  {loan.status==="REJECTED" && <div style={{fontSize:11,color:C.red}}>Alasan: {loan.rejectReason}</div>}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function PetaGudangTab({ gudangList, subGudangList, lokasiList, stocks, sty, C, currentUser, gudangCapacityList }) {
  const [selectedGudangId, setSelectedGudangId] = useState(gudangList[0]?.id||"");
  const [hoveredLokasi, setHoveredLokasi] = useState(null);
  const [filterHanyaBerisi, setFilterHanyaBerisi] = useState(false);

  // gudangList dimuat async dari Supabase — kalau saat mount masih kosong,
  // selectedGudangId ke-stuck di "" dan peta tidak pernah tampil walau data sudah ada.
  // Kalau belum ada pilihan valid, prioritaskan Gudang yang sudah punya konten (denah sendiri
  // atau denah Sub Gudang) — supaya user tidak mendarat di gudang kosong lalu mengira peta belum tampil.
  useEffect(() => {
    const stillValid = gudangList.some(g=>g.id===selectedGudangId);
    if (selectedGudangId && stillValid) return;
    if (gudangList.length === 0) return;
    const withContent = gudangList.find(g => g.denahImageData || subGudangList.some(sg=>sg.gudangId===g.id && sg.denahImageData));
    setSelectedGudangId((withContent || gudangList[0]).id);
  }, [gudangList, subGudangList, selectedGudangId]);

  const gudang = gudangList.find(g=>g.id===selectedGudangId);
  const blokDiGudang = lokasiList.filter(l=>l.gudangId===selectedGudangId && l.mapX!=null);

  function stokDiBlok(lokasiId) {
    return stocks.filter(s=>s.lokasiId===lokasiId);
  }

  const blokTampil = filterHanyaBerisi
    ? blokDiGudang.filter(l=>stokDiBlok(l.id).length>0)
    : blokDiGudang;

  return (
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
        <div>
          <h1 style={{fontSize:22,fontWeight:900}}>🗺️ Peta Gudang</h1>
          <p style={{color:C.muted,fontSize:13}}>Visualisasi lokasi blok dan material di denah gudang</p>
        </div>
        <div style={{display:"flex",gap:10,alignItems:"center"}}>
          <label style={{fontSize:12,color:C.muted,display:"flex",alignItems:"center",gap:6,cursor:"pointer"}}>
            <input type="checkbox" checked={filterHanyaBerisi} onChange={e=>setFilterHanyaBerisi(e.target.checked)}/>
            Hanya blok berisi barang
          </label>
          <select style={{...sty.select,width:200}} value={selectedGudangId} onChange={e=>setSelectedGudangId(e.target.value)}>
            {gudangList.map(g=><option key={g.id} value={g.id}>{g.nama}</option>)}
          </select>
        </div>
      </div>

      {gudangList.length===0 && (
        <div style={{...sty.card,textAlign:"center",padding:60,color:C.muted}}>
          <div style={{fontSize:48,marginBottom:12}}>🏭</div>
          <div style={{fontSize:14,fontWeight:700}}>Belum ada Gudang</div>
          <div style={{fontSize:12,marginTop:4}}>Tambahkan Gudang di Master Data → Master Gudang</div>
        </div>
      )}

      {gudang && !gudang.denahImageData && (
        <div style={{...sty.card,textAlign:"center",padding:60,color:C.muted}}>
          <div style={{fontSize:48,marginBottom:12}}>🗺️</div>
          <div style={{fontSize:14,fontWeight:700}}>Denah {gudang.nama} belum diupload</div>
          <div style={{fontSize:12,marginTop:4}}>Upload gambar denah (PNG/JPG) di Master Data → Master Gudang</div>
          <div style={{fontSize:11,color:C.muted,marginTop:4}}>💡 Convert PDF denah ke gambar (screenshot/foto) sebelum upload</div>
        </div>
      )}

      {gudang && gudang.denahImageData && (() => {
        const totalBlok = blokDiGudang.length;
        const blokBerisi = blokDiGudang.filter(l=>stokDiBlok(l.id).length>0).length;
        const blokKosong = totalBlok - blokDiGudang.filter(l=>l.status==="PENDING").length - blokBerisi;
        const blokPending = blokDiGudang.filter(l=>l.status==="PENDING").length;
        const totalItem = blokDiGudang.reduce((a,l)=>a+stokDiBlok(l.id).length,0);
        return (
        <div>
          {blokDiGudang.length===0 && (
            <div style={{background:"#fef3c7",border:`1px solid #fde68a`,borderRadius:8,padding:"10px 14px",fontSize:12,color:"#92400e",marginBottom:14}}>
              ⚠️ Belum ada blok yang di-assign koordinat di peta ini. Pergi ke Master Data → Master Gudang → Konfigurasi Koordinat Blok.
            </div>
          )}

          <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:14}}>
            {[
              {label:"Total Blok",val:totalBlok,color:C.text},
              {label:"Berisi Barang",val:blokBerisi,color:C.green},
              {label:"Kosong",val:blokKosong,color:C.muted},
              {label:"Pending Approval",val:blokPending,color:"#92400e"},
              {label:"Total Item Tersimpan",val:totalItem,color:C.accent},
            ].map((s,i)=>(
              <div key={i} style={{...sty.card,padding:"8px 14px",display:"flex",flexDirection:"column",minWidth:110}}>
                <div style={{fontSize:9,color:C.muted,fontWeight:700,textTransform:"uppercase"}}>{s.label}</div>
                <div style={{fontSize:18,fontWeight:800,color:s.color}}>{s.val}</div>
              </div>
            ))}
          </div>

          <div style={{display:"grid",gridTemplateColumns:"minmax(0,1fr) 280px",gap:16}}>
            {/* Peta utama */}
            <div style={{position:"relative",...sty.card,padding:10,display:"flex",justifyContent:"center"}}>
              {/* Lebar wrapper dibatasi via maxWidth SAJA (bukan maxHeight/object-fit
                  pada img) — img tetap width:100% height:auto supaya gambar selalu
                  mengisi penuh box-nya tanpa letterbox, karena marker titik diposisikan
                  pakai persen (%) relatif ke box ini; kalau ada letterbox, persen jadi
                  tidak sinkron dengan piksel asli gambar dan titik jadi melebar/salah posisi. */}
              <div style={{position:"relative",maxWidth:680,width:"100%"}}>
              <img src={gudang.denahImageData} alt="Denah Gudang" style={{width:"100%",height:"auto",display:"block",borderRadius:10,border:`1px solid ${C.border}`}}/>
              {blokTampil.map(l=>{
                const stokList = stokDiBlok(l.id);
                const isEmpty = stokList.length===0;
                const isHovered = hoveredLokasi===l.id;
                const isPending = l.status==="PENDING";
                return (
                  <div key={l.id}
                    style={{position:"absolute",left:`${l.mapX}%`,top:`${l.mapY}%`,transform:"translate(-50%,-50%)",cursor:"pointer",zIndex:isHovered?10:5,
                      // Area sentuh dibuat lebih besar (36x36) dari titik visualnya
                      // (14-20px) — di HP jari lebih besar dari kursor mouse, kalau
                      // area klik sama persis dengan ukuran titik kecilnya, gampang
                      // tap-miss. Titik visual tetap kecil, cuma "hit area" yang dibesarkan.
                      width:36,height:36,display:"flex",alignItems:"center",justifyContent:"center"}}
                    onMouseEnter={()=>setHoveredLokasi(l.id)}
                    onMouseLeave={()=>setHoveredLokasi(null)}
                    onClick={()=>setHoveredLokasi(isHovered?null:l.id)}>
                    {/* Titik marker */}
                    <div style={{width:isHovered?20:14,height:isHovered?20:14,borderRadius:"50%",background:isPending?"#9ca3af":(isEmpty?"#9ca3af":"#dc2626"),border:isPending?"2px dashed white":"2px solid white",boxShadow:"0 2px 6px rgba(0,0,0,0.4)",transition:"all 0.15s"}}/>
                    {/* Label selalu tampil */}
                    <div style={{position:"absolute",top:-12,left:"50%",transform:"translateX(-50%)",background:isPending?"rgba(146,64,14,0.9)":"rgba(0,0,0,0.75)",color:"white",fontSize:9,fontWeight:700,padding:"1px 5px",borderRadius:3,whiteSpace:"nowrap",pointerEvents:"none"}}>
                      {l.kode}{isPending?" ⏳ Menunggu Approval":""}
                    </div>
                    {/* Popup saat hover/tap */}
                    {isHovered && (
                      <div style={{position:"absolute",top:32,left:"50%",transform:"translateX(-50%)",background:"white",border:`1px solid ${C.border}`,borderRadius:8,padding:10,minWidth:200,maxWidth:280,boxShadow:"0 4px 16px rgba(0,0,0,0.15)",zIndex:20}}>
                        <div style={{fontWeight:800,fontSize:12,marginBottom:6,borderBottom:`1px solid ${C.border}`,paddingBottom:4}}>📍 {l.kode} — {l.nama}</div>
                        {isPending && <div style={{fontSize:10,color:"#92400e",fontWeight:700,marginBottom:6}}>⏳ Blok ini belum final, menunggu approval TL</div>}
                        {isEmpty
                          ? <div style={{fontSize:11,color:C.muted,fontStyle:"italic"}}>Tidak ada barang di blok ini</div>
                          : stokList.slice(0,5).map((st,i)=>(
                              <div key={i} style={{fontSize:11,padding:"2px 0",display:"flex",justifyContent:"space-between"}}>
                                <span style={{color:"#111",maxWidth:150,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{st.name}</span>
                                <span style={{fontWeight:700,color:C.accent,marginLeft:8}}>{fmtNum(st.qty)} {st.unit}</span>
                              </div>
                            ))
                        }
                        {stokList.length>5 && <div style={{fontSize:10,color:C.muted,marginTop:4}}>+{stokList.length-5} item lainnya</div>}
                      </div>
                    )}
                  </div>
                );
              })}
              </div>
            </div>

            {/* Panel legend kanan */}
            <div>
              <div style={{...sty.card,marginBottom:12}}>
                <div style={{fontSize:12,fontWeight:700,marginBottom:8}}>Legenda</div>
                <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:6}}>
                  <div style={{width:12,height:12,borderRadius:"50%",background:"#dc2626",border:"2px solid white",boxShadow:"0 1px 3px rgba(0,0,0,0.3)"}}/>
                  <span style={{fontSize:11}}>Blok berisi barang</span>
                </div>
                <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:6}}>
                  <div style={{width:12,height:12,borderRadius:"50%",background:"#9ca3af",border:"2px solid white",boxShadow:"0 1px 3px rgba(0,0,0,0.3)"}}/>
                  <span style={{fontSize:11}}>Blok kosong</span>
                </div>
                <div style={{display:"flex",alignItems:"center",gap:8}}>
                  <div style={{width:12,height:12,borderRadius:"50%",background:"#9ca3af",border:"2px dashed white",boxShadow:"0 1px 3px rgba(0,0,0,0.3)"}}/>
                  <span style={{fontSize:11}}>Menunggu approval TL</span>
                </div>
              </div>
              <div style={{...sty.card}}>
                <div style={{fontSize:12,fontWeight:700,marginBottom:8}}>Daftar Blok ({blokTampil.length})</div>
                <div style={{maxHeight:400,overflowY:"auto"}}>
                  {blokTampil.map(l=>{
                    const n = stokDiBlok(l.id).length;
                    return (
                      <div key={l.id} style={{padding:"6px 0",borderBottom:`1px solid ${C.border}`,cursor:"pointer",background:hoveredLokasi===l.id?"#eff6ff":"transparent"}}
                        onMouseEnter={()=>setHoveredLokasi(l.id)}
                        onMouseLeave={()=>setHoveredLokasi(null)}>
                        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                          <div>
                            <div style={{fontSize:12,fontWeight:600}}>{l.kode}</div>
                            <div style={{fontSize:10,color:C.muted}}>{l.nama||"-"}</div>
                          </div>
                          <span style={{fontSize:10,fontWeight:700,color:n>0?C.accent:C.muted}}>{n} item</span>
                        </div>
                      </div>
                    );
                  })}
                  {blokTampil.length===0 && <div style={{fontSize:11,color:C.muted,textAlign:"center",padding:16}}>Tidak ada blok untuk ditampilkan</div>}
                </div>
              </div>
            </div>
          </div>
        </div>
        );
      })()}

      {/* Galeri denah Sub Gudang (read-only) — hanya sub gudang yang sudah upload denah sendiri */}
      {gudang && (() => {
        const subsWithDenah = subGudangList.filter(sg=>sg.gudangId===gudang.id && sg.denahImageData);
        if (subsWithDenah.length===0) return null;
        return (
          <div style={{marginTop:24}}>
            <div style={{fontSize:14,fontWeight:800,marginBottom:10}}>🏢 Denah Sub Gudang</div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(320px,1fr))",gap:16}}>
              {subsWithDenah.map(sg=>{
                const blokSub = lokasiList.filter(l=>l.subGudangId===sg.id && l.subMapX!=null);
                const blokBerisi = blokSub.filter(l=>stokDiBlok(l.id).length>0).length;
                return (
                  <div key={sg.id} style={{...sty.card,padding:12}}>
                    <div style={{fontWeight:700,fontSize:13,marginBottom:2}}>{sg.nama}</div>
                    <div style={{fontSize:11,color:C.muted,marginBottom:8}}>
                      {gudang.nama} • {blokSub.length} blok terpetakan • {blokBerisi} berisi barang
                      {sg.denahUploadedAt && <> • diupdate {fmtDate(sg.denahUploadedAt)}</>}
                    </div>
                    <div style={{position:"relative",width:"100%"}}>
                      <img src={sg.denahImageData} alt={`Denah ${sg.nama}`} style={{width:"100%",height:"auto",display:"block",borderRadius:8,border:`1px solid ${C.border}`}}/>
                      {blokSub.map(l=>{
                        const stokList = stokDiBlok(l.id);
                        const isEmpty = stokList.length===0;
                        const isPending = l.status==="PENDING";
                        return (
                          <div key={l.id} title={`${l.kode}${isEmpty?" (kosong)":` — ${stokList.length} item`}`}
                            style={{position:"absolute",left:`${l.subMapX}%`,top:`${l.subMapY}%`,transform:"translate(-50%,-50%)",width:12,height:12,borderRadius:"50%",background:isPending?"#9ca3af":(isEmpty?"#9ca3af":"#dc2626"),border:isPending?"2px dashed white":"2px solid white",boxShadow:"0 1px 4px rgba(0,0,0,0.4)"}}/>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// MATERIAL CADANG TAB
// ════════════════════════════════════════════════════════════════════

// Helper: hitung Poisson CDF P(X <= s) untuk lambda tertentu
function poissonCDF(lambda, s) {
  if (lambda <= 0) return 1;
  let sum = 0, term = Math.exp(-lambda);
  for (let k = 0; k <= s; k++) {
    sum += term;
    term *= lambda / (k + 1);
  }
  return sum;
}

// Helper: cari qty terkecil yg memenuhi service level (Poisson)
function poissonQtyForServiceLevel(lambda, serviceLevel) {
  if (lambda <= 0) return 0;
  for (let s = 0; s <= 50; s++) {
    if (poissonCDF(lambda, s) >= serviceLevel) return s;
  }
  return 50;
}

// Normalisasi nomor katalog (hapus leading zero)
function normalizeKatalog(k) { return String(k||"").trim().replace(/^0+/, "") || ""; }

// Parse baris Material Cadang dari rows XLSX/CSV
function parseMaterialCadangRows(rows, katalogList) {
  const COL = {
    noKatalog: ["No Katalog","NO KATALOG","no katalog"],
    namaMaterial: ["Nama Material","NAMA MATERIAL"],
    equipmentCluster: ["Equipment Cluster","EQUIPMENT CLUSTER"],
    populasi: ["Populasi Cluster","POPULASI CLUSTER"],
    failure5y: ["Failure 5 Tahun","FAILURE 5 TAHUN"],
    penggantian5y: ["Penggantian 5 Tahun","PENGGANTIAN 5 TAHUN"],
    emergency5y: ["Emergency Replacement 5 Tahun","EMERGENCY REPLACEMENT 5 TAHUN"],
    leadTime: ["Lead Time Hari","LEAD TIME HARI"],
    ttf: ["Time To Failure Hari","TIME TO FAILURE HARI"],
    breakdown: ["Breakdown","BREAKDOWN"],
    harga: ["Harga Satuan","HARGA SATUAN"],
  };
  function findCol(row, keys) {
    for (const k of keys) { if (row[k] !== undefined) return row[k]; }
    return undefined;
  }
  const parsed = rows.map((row, idx) => {
    const noKat = normalizeKatalog(findCol(row, COL.noKatalog));
    const namaMaterial = String(findCol(row, COL.namaMaterial)||"").trim();
    const cluster = String(findCol(row, COL.equipmentCluster)||"").trim();
    const populasi = parseFloat(String(findCol(row, COL.populasi)||"0").replace(",",".")) || 0;
    const failure5y = parseFloat(String(findCol(row, COL.failure5y)||"0").replace(",",".")) || 0;
    const penggantian5y = parseFloat(String(findCol(row, COL.penggantian5y)||"0").replace(",",".")) || 0;
    const emergency5y = parseFloat(String(findCol(row, COL.emergency5y)||"0").replace(",",".")) || 0;
    const leadTime = parseFloat(String(findCol(row, COL.leadTime)||"0").replace(",",".")) || 0;
    const ttf = parseFloat(String(findCol(row, COL.ttf)||"0").replace(",",".")) || 0;
    const breakdownRaw = String(findCol(row, COL.breakdown)||"TIDAK").trim().toUpperCase();
    const breakdown = ["YA","Y","YES","TRUE","1"].includes(breakdownRaw);
    const hargaInput = parseFloat(String(findCol(row, COL.harga)||"0").replace(/\./g,"").replace(",",".")) || 0;

    if (!noKat) return { _idx:idx, status:"INVALID", error:"No Katalog kosong", noKat:"", namaMaterial, cluster, populasi, failure5y, penggantian5y, emergency5y, leadTime, ttf, breakdown, hargaInput };
    if (populasi <= 0) return { _idx:idx, status:"INVALID", error:"Populasi harus > 0", noKat, namaMaterial, cluster, populasi, failure5y, penggantian5y, emergency5y, leadTime, ttf, breakdown, hargaInput };
    if (leadTime <= 0) return { _idx:idx, status:"INVALID", error:"Lead Time harus > 0", noKat, namaMaterial, cluster, populasi, failure5y, penggantian5y, emergency5y, leadTime, ttf, breakdown, hargaInput };
    if (ttf <= 0) return { _idx:idx, status:"INVALID", error:"Time To Failure harus > 0", noKat, namaMaterial, cluster, populasi, failure5y, penggantian5y, emergency5y, leadTime, ttf, breakdown, hargaInput };

    const katalogMatch = katalogList.find(k => normalizeKatalog(k.katalog) === noKat);
    let status = "UNMATCHED";
    let warnings = [];
    if (katalogMatch) {
      status = "MATCH";
      if (namaMaterial && katalogMatch.name && namaMaterial.toUpperCase() !== katalogMatch.name.toUpperCase()) {
        status = "WARNING_NAME_DIFF";
        warnings.push(`Nama beda: file="${namaMaterial}", sistem="${katalogMatch.name}"`);
      }
    }
    return { _idx:idx, status, noKat, namaMaterial, cluster, populasi, failure5y, penggantian5y, emergency5y, leadTime, ttf, breakdown, hargaInput, katalogId: katalogMatch?.id, katalogName: katalogMatch?.name, katalogSatuan: katalogMatch?.satuan, katalogHarga: katalogMatch ? (hargaInput || 0) : 0, warnings };
  });

  // Dedup: gabung baris dengan No Katalog + Equipment Cluster yang sama
  const merged = [];
  const seen = {};
  for (const r of parsed) {
    if (r.status === "INVALID") { merged.push(r); continue; }
    const key = `${r.noKat}||${r.cluster}`;
    if (seen[key] !== undefined) {
      const ex = merged[seen[key]];
      ex.populasi = Math.max(ex.populasi, r.populasi);
      ex.failure5y += r.failure5y;
      ex.penggantian5y += r.penggantian5y;
      ex.emergency5y += r.emergency5y;
      ex.leadTime = Math.max(ex.leadTime, r.leadTime);
      ex.ttf = Math.max(ex.ttf, r.ttf);
      ex.hargaInput = Math.max(ex.hargaInput, r.hargaInput);
      if (!ex.warnings) ex.warnings = [];
      ex.warnings.push("DUPLICATE_MERGED");
      if (ex.status === "MATCH") ex.status = "WARNING_NAME_DIFF";
    } else {
      seen[key] = merged.length;
      merged.push({...r});
    }
  }
  return merged;
}

// Hitung ABC analysis + policy + rekomendasi qty
function hitungMaterialCadang(rows, stocks, katalogList, params = {}) {
  const { periodYears=5, slMandatory=0.99, slOptimum=0.95, slEconomic=0.90, threshA1Val=50, threshA1Item=3, threshA2Val=75, threshA2Item=10, threshBVal=95 } = params;

  // Hanya baris yang bisa dihitung
  const valid = rows.filter(r => ["MATCH","WARNING_NAME_DIFF","DUPLICATE_MERGED"].includes(r.status) && r.katalogId);

  // Harga dari stok jika tidak ada di file
  function getHarga(r) {
    if (r.hargaInput > 0) return r.hargaInput;
    const s = stocks.find(s => s.katalogId === r.katalogId);
    return s?.price || 0;
  }

  // Hitung riskUsageValue per baris
  const withRisk = valid.map(r => ({
    ...r,
    harga: getHarga(r),
    riskUsageValue: getHarga(r) * Math.max(r.failure5y, r.penggantian5y),
  }));

  // Sort descending riskUsageValue
  withRisk.sort((a,b) => b.riskUsageValue - a.riskUsageValue);
  const totalRisk = withRisk.reduce((s,r) => s + r.riskUsageValue, 0);

  // Kumulatif dan kelas ABC
  let cumulVal = 0, cumulItem = 0;
  const totalItem = withRisk.length;
  const results = withRisk.map((r, i) => {
    cumulVal += totalRisk > 0 ? (r.riskUsageValue / totalRisk * 100) : 0;
    cumulItem += totalItem > 0 ? (1 / totalItem * 100) : 0;

    let abcClass;
    if (cumulVal <= threshA1Val && cumulItem <= threshA1Item) abcClass = "A1";
    else if (cumulVal <= threshA2Val && cumulItem <= threshA2Item) abcClass = "A2";
    else if (cumulVal <= threshBVal) abcClass = "B1";
    else if (i < totalItem * 0.85) abcClass = "B2";
    else abcClass = "C";

    // Policy dan treatment
    let treatment, policy, mandatoryQty=null, poissonQty=null, economicQty=null, recommendedQty=0;
    const serviceLevel = abcClass==="A1" ? slMandatory : abcClass==="A2" ? slOptimum : slEconomic;

    if (abcClass === "C") {
      treatment = "Persediaan/Rutin"; policy = "Persediaan";
    } else if (abcClass === "A1") {
      treatment = "Material Cadang"; policy = "Mandatory";
      mandatoryQty = Math.max(1, Math.ceil(r.populasi * 0.02));
      recommendedQty = mandatoryQty;
    } else if (abcClass === "A2") {
      const isPersediaan = r.ttf >= r.leadTime && !r.breakdown && r.emergency5y === 0;
      if (isPersediaan) {
        treatment = "Persediaan/Rutin"; policy = "Persediaan";
      } else {
        treatment = "Material Cadang"; policy = "Optimum";
        const lambda = (r.failure5y / (periodYears * 365)) * r.leadTime;
        poissonQty = poissonQtyForServiceLevel(lambda, serviceLevel);
        recommendedQty = Math.max(poissonQty > 0 ? 1 : 0, poissonQty);
      }
    } else { // B1 / B2
      treatment = "Material Cadang"; policy = "Optimum & Economic";
      const lambda = (r.failure5y / (periodYears * 365)) * r.leadTime;
      poissonQty = poissonQtyForServiceLevel(lambda, serviceLevel);
      const rate = r.populasi > 0 ? r.penggantian5y / r.populasi : 0;
      economicQty = Math.ceil(rate * r.populasi);
      const finalQty = Math.max(poissonQty, economicQty);
      recommendedQty = finalQty > 0 ? Math.max(1, Math.ceil(finalQty)) : 0;
    }

    // Stok saat ini
    const currentQty = stocks.filter(s => s.katalogId === r.katalogId).reduce((a,s) => a + (s.qty||0), 0);
    const gapQty = Math.max(0, recommendedQty - currentQty);

    return {
      ...r, abcClass, treatment, policy, serviceLevel,
      mandatoryQty, poissonQty, economicQty, recommendedQty,
      currentQty, gapQty,
      cumulativeValuePct: parseFloat(cumulVal.toFixed(1)),
      cumulativeItemPct: parseFloat(cumulItem.toFixed(1)),
    };
  });

  return results;
}

function UsulanKatalogTab({ maraReference, setMaraReference, katalogList, setKatalogList, currentUser, sty, C, saveToCloud, showToast }) {
  const [maraLoading, setMaraLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedRows, setSelectedRows] = useState([]); // { katalog, description, satuan, materialGroup }
  const [drafts, setDrafts] = useState([]); // usulan pending approval
  const [rejectingId, setRejectingId] = useState(null);
  const [rejectReason, setRejectReason] = useState("");

  const canApprove = ["ASMAN","TL"].includes(currentUser.role);
  const canEdit = ["ADMIN","TL"].includes(currentUser.role);

  const existingKatalogs = new Set(katalogList.map(k => normalizeKatalog(String(k.katalog||""))));

  async function handleLoadMara(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setMaraLoading(true);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf);
      const sheet1 = wb.Sheets["Sheet1"] || wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet1, { defval:"" });
      const ref = rows.map(r => {
        const raw = String(r["Material"]||"").trim();
        const kat = normalizeKatalog(raw);
        return { materialRaw:raw, katalog:kat, materialType:String(r["Material Type"]||"").trim(), materialGroup:String(r["Material Group"]||"").trim(), satuan:String(r["Base Unit of Measure"]||"").trim(), description:String(r["Material Description"]||"").trim(), status:String(r["X-plant matl status"]||"").trim() };
      });
      setMaraReference(ref);
      showToast(`MARA dimuat: ${ref.length} material (session-only, tidak disimpan).`, "success");
    } catch(err) { showToast("Gagal load MARA: "+err.message,"error"); }
    setMaraLoading(false); e.target.value="";
  }

  const maraFiltered = (maraReference||[]).filter(r => {
    if (!search.trim()) return false;
    const q = search.toLowerCase();
    return r.description.toLowerCase().includes(q) || r.katalog.includes(q) || r.materialGroup.toLowerCase().includes(q);
  }).slice(0,100);

  function toggleSelect(row) {
    setSelectedRows(prev => prev.find(r=>r.katalog===row.katalog) ? prev.filter(r=>r.katalog!==row.katalog) : [...prev, row]);
  }

  async function ajukanUsulan() {
    if (!selectedRows.length) return;
    const newDrafts = selectedRows.map(r => ({
      id:"UKAT-"+Date.now()+"-"+Math.random().toString(36).slice(2,6),
      katalog: r.katalog, namaBarang: r.description, satuan: r.satuan,
      materialGroup: r.materialGroup, materialType: r.materialType,
      status:"PENDING", requestedBy:currentUser.id, requestedAt:Date.now(),
    }));
    const all = [...drafts, ...newDrafts];
    setDrafts(all); setSelectedRows([]);
    showToast(`${newDrafts.length} usulan dikirim ke Asman/TL untuk review.`,"success");
  }

  async function approveUsulan(id) {
    const d = drafts.find(x=>x.id===id);
    if (!d) return;
    const newKatalog = { id:"K-"+Date.now(), katalog:d.katalog, namaBarang:d.namaBarang, satuan:d.satuan, jenisBarang:"Cadang", harga:0, minQty:0, keterangan:"Dari usulan MARA #"+d.id };
    const updatedList = [...katalogList, newKatalog];
    setKatalogList(updatedList);
    setDrafts(prev=>prev.map(x=>x.id===id?{...x,status:"APPROVED",approvedBy:currentUser.id,approvedAt:Date.now()}:x));
    await saveToCloud({ katalogList: updatedList });
    showToast(`Katalog ${d.namaBarang} berhasil ditambahkan ke Master Katalog.`,"success");
  }

  function rejectUsulan(id) {
    setDrafts(prev=>prev.map(x=>x.id===id?{...x,status:"REJECTED",rejectedBy:currentUser.id,rejectedAt:Date.now(),rejectReason}:x));
    setRejectingId(null); setRejectReason("");
  }

  const pendingDrafts = drafts.filter(d=>d.status==="PENDING");
  const doneDrafts = drafts.filter(d=>d.status!=="PENDING");

  return (
    <div>
      <div style={{marginBottom:14}}>
        <h2 style={{fontSize:16,fontWeight:900,marginBottom:4}}>➕ Usulan Penambahan Katalog</h2>
        <p style={{fontSize:12,color:C.muted}}>Cari material dari referensi MARA yang belum ada di Master Katalog, lalu usulkan penambahan. Memerlukan persetujuan Asman/TL.</p>
      </div>

      {/* Load MARA */}
      {!maraReference?.length ? (
        <div style={{...sty.card,marginBottom:16,textAlign:"center",padding:28}}>
          <div style={{fontSize:32,marginBottom:8}}>📂</div>
          <div style={{fontWeight:700,marginBottom:6}}>Muat file referensi MARA terlebih dahulu</div>
          <div style={{fontSize:12,color:C.muted,marginBottom:14}}>File <b>Katalog MARA (01-2026).xlsx</b> — session only, tidak disimpan ke cloud.</div>
          <label style={{...sty.btn("primary"),cursor:"pointer"}}>
            {maraLoading?"⏳ Memuat...":"📂 Upload Katalog MARA (.xlsx)"}
            <input type="file" accept=".xlsx" style={{display:"none"}} onChange={handleLoadMara} disabled={maraLoading}/>
          </label>
        </div>
      ) : (
        <div style={{...sty.card,marginBottom:12,padding:12,background:"#f0fdf4",border:`1px solid #bbf7d0`}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <span style={{fontSize:12,color:C.green,fontWeight:700}}>✅ MARA dimuat: {maraReference.length.toLocaleString()} material (session-only)</span>
            <label style={{...sty.btn("ghost","sm"),cursor:"pointer",fontSize:11}}>Ganti file<input type="file" accept=".xlsx" style={{display:"none"}} onChange={handleLoadMara}/></label>
          </div>
        </div>
      )}

      {maraReference?.length>0 && (
        <div style={{display:"grid",gridTemplateColumns:"1fr 360px",gap:14,alignItems:"start"}}>
          {/* Kolom kiri: Cari + hasil */}
          <div>
            <div style={{display:"flex",gap:8,marginBottom:10}}>
              <input style={{...sty.input,flex:1}} placeholder="Cari nama material, no katalog, material group…" value={search} onChange={e=>setSearch(e.target.value)}/>
              {selectedRows.length>0 && canEdit && (
                <button style={sty.btn("primary")} onClick={ajukanUsulan}>Usulkan {selectedRows.length} item →</button>
              )}
            </div>
            {search.trim() && (
              <div style={{...sty.card,padding:0,overflowX:"auto",maxHeight:440,overflowY:"auto"}}>
                <table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
                  <thead style={{background:"#003087",color:"white",position:"sticky",top:0}}>
                    <tr>{["","No Katalog","Nama Material","Group","Satuan","Status di Master"].map(h=><th key={h} style={{padding:"7px 8px",textAlign:"left",whiteSpace:"nowrap"}}>{h}</th>)}</tr>
                  </thead>
                  <tbody>
                    {maraFiltered.length===0 && <tr><td colSpan={6} style={{padding:16,textAlign:"center",color:C.muted}}>Tidak ada hasil untuk "{search}"</td></tr>}
                    {maraFiltered.map(r=>{
                      const ada = existingKatalogs.has(r.katalog);
                      const dipilih = !!selectedRows.find(x=>x.katalog===r.katalog);
                      return (
                        <tr key={r.katalog} style={{borderBottom:`1px solid ${C.border}`,background:dipilih?"#eff6ff":ada?"#f9fafb":"white",opacity:ada?0.55:1}}>
                          <td style={{padding:"5px 8px"}}><input type="checkbox" checked={dipilih} disabled={ada} onChange={()=>toggleSelect(r)}/></td>
                          <td style={{padding:"5px 8px",fontWeight:700,color:C.accent}}>{r.katalog}</td>
                          <td style={{padding:"5px 8px",maxWidth:220,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{r.description}</td>
                          <td style={{padding:"5px 8px",fontSize:10,color:C.muted}}>{r.materialGroup}</td>
                          <td style={{padding:"5px 8px"}}>{r.satuan}</td>
                          <td style={{padding:"5px 8px"}}>{ada?<span style={{color:C.green,fontWeight:700,fontSize:10}}>✅ Sudah ada</span>:<span style={{fontSize:10,color:C.muted}}>Belum ada</span>}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {!search.trim() && <div style={{...sty.card,textAlign:"center",padding:24,color:C.muted,fontSize:13}}>Ketik nama atau nomor material untuk mulai mencari dari referensi MARA.</div>}
          </div>

          {/* Kolom kanan: Usulan pending + riwayat */}
          <div>
            <div style={{fontWeight:800,fontSize:12,color:C.muted,textTransform:"uppercase",letterSpacing:1,marginBottom:8}}>Usulan Menunggu Persetujuan ({pendingDrafts.length})</div>
            {pendingDrafts.length===0 && <div style={{...sty.card,textAlign:"center",padding:16,color:C.muted,fontSize:12,marginBottom:12}}>Belum ada usulan pending.</div>}
            {pendingDrafts.map(d=>(
              <div key={d.id} style={{...sty.card,padding:12,marginBottom:8,borderLeft:`4px solid ${C.yellow}`}}>
                <div style={{fontWeight:700,fontSize:12}}>{d.namaBarang}</div>
                <div style={{fontSize:11,color:C.muted,marginBottom:6}}>{d.katalog} • {d.satuan}</div>
                {canApprove && (
                  rejectingId===d.id
                    ? <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                        <input style={{...sty.input,flex:1,fontSize:11}} value={rejectReason} onChange={e=>setRejectReason(e.target.value)} placeholder="Alasan tolak"/>
                        <button style={sty.btn("danger","sm")} onClick={()=>rejectUsulan(d.id)}>Tolak</button>
                        <button style={sty.btn("ghost","sm")} onClick={()=>setRejectingId(null)}>Batal</button>
                      </div>
                    : <div style={{display:"flex",gap:6}}>
                        <button style={sty.btn("success","sm")} onClick={()=>approveUsulan(d.id)}>✅ Setujui & Tambah</button>
                        <button style={sty.btn("danger","sm")} onClick={()=>setRejectingId(d.id)}>Tolak</button>
                      </div>
                )}
                {!canApprove && <span style={{fontSize:10,color:"#92400e",fontWeight:700}}>⏳ Menunggu Asman/TL</span>}
              </div>
            ))}
            {doneDrafts.length>0 && (
              <>
                <div style={{fontWeight:800,fontSize:12,color:C.muted,textTransform:"uppercase",letterSpacing:1,marginBottom:6,marginTop:8}}>Riwayat ({doneDrafts.length})</div>
                {doneDrafts.slice(-5).reverse().map(d=>(
                  <div key={d.id} style={{...sty.card,padding:10,marginBottom:6,borderLeft:`4px solid ${d.status==="APPROVED"?C.green:C.red}`}}>
                    <div style={{fontSize:11,fontWeight:700}}>{d.namaBarang}</div>
                    <div style={{fontSize:10,color:C.muted}}>{d.katalog} • <span style={{color:d.status==="APPROVED"?C.green:C.red}}>{d.status}</span></div>
                  </div>
                ))}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function MaterialCadangTab({ materialCadangData, setMaterialCadangData, maraReference, setMaraReference, catalogMasterRef, setCatalogMasterRef, katalogList, setKatalogList, stocks, currentUser, sty, C, saveToCloud, showToast }) {
  const [subTab, setSubTab] = useState("dashboard");
  const [importing, setImporting] = useState(false);
  const [importPreview, setImportPreview] = useState(null); // { rows, stats, fileName }
  const [analisisResult, setAnalisisResult] = useState(null); // hasil hitung terbaru
  const [maraLoading, setMaraLoading] = useState(false);
  const [maraSearch, setMaraSearch] = useState("");
  const [applyConfirm, setApplyConfirm] = useState(null); // { item } yang akan di-apply ke minQty
  const [applyNotes, setApplyNotes] = useState("");
  const [detailItem, setDetailItem] = useState(null);

  const canEdit = ["ADMIN","TL"].includes(currentUser.role);
  const canApprove = currentUser.role === "ASMAN";

  // Analisis terakhir dari data tersimpan
  const latestAnalysis = materialCadangData.analyses.slice(-1)[0] || null;
  const latestResults = latestAnalysis?.results || [];

  // Summary dari hasil analisis
  const summary = latestResults.reduce((acc, r) => {
    acc.total++;
    if (r.treatment !== "Material Cadang") { acc.persediaan++; return acc; }
    if (r.currentQty >= r.recommendedQty && r.recommendedQty > 0) acc.aman++;
    else if (r.currentQty > 0 && r.currentQty < r.recommendedQty) acc.kurang++;
    else if (r.recommendedQty > 0 && r.currentQty === 0) acc.kosong++;
    acc.gapQty += r.gapQty;
    acc.gapNilai += r.gapQty * (r.harga || 0);
    return acc;
  }, { total:0, aman:0, kurang:0, kosong:0, persediaan:0, gapQty:0, gapNilai:0 });

  // Pending apply (menunggu Asman)
  const pendingApply = materialCadangData.applyHistory.filter(h => h.status === "PENDING_ASMAN");

  async function handleImportFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    try {
      let rows = [];
      if (file.name.toLowerCase().endsWith(".csv")) {
        const text = await file.text();
        const lines = text.replace(/\r/g,"").split("\n").filter(Boolean);
        // CSV: cari baris header (baris ke-1 atau yang mengandung "No Katalog")
        let hIdx = 0;
        for (let i=0; i<Math.min(5,lines.length); i++) {
          if (lines[i].toLowerCase().includes("no katalog")) { hIdx = i; break; }
        }
        const headers = lines[hIdx].split(",").map(h => h.trim().replace(/^"|"$/g,""));
        rows = lines.slice(hIdx+1).filter(l=>l.trim()).map(l => {
          const vals = l.split(",").map(v => v.trim().replace(/^"|"$/g,""));
          const obj = {};
          headers.forEach((h,i) => { obj[h] = vals[i] || ""; });
          return obj;
        });
      } else {
        const buf = await file.arrayBuffer();
        const wb = XLSX.read(buf);
        // Cari sheet Import Material Cadang, atau sheet pertama
        const sheetName = wb.SheetNames.find(s => s.toLowerCase().includes("import material cadang")) || wb.SheetNames[0];
        const ws = wb.Sheets[sheetName];
        // Header di baris ke-3 (index 2)
        const raw = XLSX.utils.sheet_to_json(ws, { header:1 });
        const hRowIdx = raw.findIndex((row,i) => i>=1 && Array.isArray(row) && row.some(c => String(c||"").toLowerCase().includes("no katalog")));
        const hRow = raw[hRowIdx >= 0 ? hRowIdx : 0];
        rows = raw.slice((hRowIdx >= 0 ? hRowIdx : 0) + 1).filter(r => r.some(Boolean)).map(r => {
          const obj = {};
          hRow.forEach((h,i) => { obj[String(h||"").trim()] = r[i] !== undefined ? r[i] : ""; });
          return obj;
        });
      }
      const parsed = parseMaterialCadangRows(rows, katalogList);
      const stats = {
        total: parsed.length,
        match: parsed.filter(r=>r.status==="MATCH").length,
        warning: parsed.filter(r=>r.status==="WARNING_NAME_DIFF"||r.status==="DUPLICATE_MERGED").length,
        unmatched: parsed.filter(r=>r.status==="UNMATCHED").length,
        invalid: parsed.filter(r=>r.status==="INVALID").length,
      };
      setImportPreview({ rows: parsed, stats, fileName: file.name });
    } catch(err) {
      showToast("Gagal baca file: " + err.message, "error");
    }
    setImporting(false);
    e.target.value = "";
  }

  async function handleHitung() {
    if (!importPreview) return;
    const results = hitungMaterialCadang(importPreview.rows, stocks, katalogList);
    const newAnalysis = {
      id: "MCANA-" + Date.now(),
      importFileName: importPreview.fileName,
      createdBy: currentUser.id,
      createdAt: Date.now(),
      results,
      params: { periodYears:5, slMandatory:0.99, slOptimum:0.95, slEconomic:0.90 },
    };
    const updated = { ...materialCadangData, analyses: [...materialCadangData.analyses, newAnalysis] };
    setMaterialCadangData(updated);
    await saveToCloud({ materialCadangData: updated });
    setAnalisisResult(results);
    setSubTab("hasil");
    showToast("Rekomendasi Material Cadang berhasil dihitung!", "success");
  }

  async function handleAjukanApply(item) {
    const existing = materialCadangData.applyHistory.find(h => h.katalogId === item.katalogId && h.status === "PENDING_ASMAN");
    if (existing) { showToast("Pengajuan untuk material ini sudah ada, tunggu keputusan Asman.", "error"); return; }
    const entry = {
      id: "MCAPPLY-" + Date.now(),
      katalogId: item.katalogId,
      namaBarang: item.katalogName || item.namaMaterial,
      noKatalog: item.noKat,
      recommendedQty: item.recommendedQty,
      abcClass: item.abcClass,
      policy: item.policy,
      status: "PENDING_ASMAN",
      requestedBy: currentUser.id,
      requestedAt: Date.now(),
      notes: applyNotes.trim(),
    };
    const updated = { ...materialCadangData, applyHistory: [...materialCadangData.applyHistory, entry] };
    setMaterialCadangData(updated);
    await saveToCloud({ materialCadangData: updated });
    setApplyConfirm(null); setApplyNotes("");
    showToast("Pengajuan apply minQty dikirim ke Asman.", "success");
  }

  async function handleApproveApply(applyId) {
    const entry = materialCadangData.applyHistory.find(h => h.id === applyId);
    if (!entry) return;
    // Update minQty di katalogList
    const updated = katalogList.map(k =>
      k.id === entry.katalogId ? { ...k, minQty: entry.recommendedQty, minQtyUpdatedAt: Date.now(), minQtyUpdatedBy: currentUser.id } : k
    );
    setKatalogList(updated);
    // Tandai apply sebagai APPROVED
    const updatedMC = {
      ...materialCadangData,
      applyHistory: materialCadangData.applyHistory.map(h =>
        h.id===applyId ? {...h, status:"APPROVED", approvedBy:currentUser.id, approvedAt:Date.now()} : h
      )
    };
    setMaterialCadangData(updatedMC);
    await saveToCloud({ katalogList: updated, materialCadangData: updatedMC });
    showToast(`Min Qty ${entry.namaBarang} berhasil diperbarui ke ${entry.recommendedQty}.`, "success");
  }

  async function handleRejectApply(applyId, reason) {
    const updated = {
      ...materialCadangData,
      applyHistory: materialCadangData.applyHistory.map(h => h.id===applyId ? {...h, status:"REJECTED", rejectedBy:currentUser.id, rejectedAt:Date.now(), rejectReason:reason} : h)
    };
    setMaterialCadangData(updated);
    await saveToCloud({ materialCadangData: updated });
    showToast("Pengajuan ditolak.", "success");
  }

  async function handleLoadMara(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setMaraLoading(true);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf);
      const sheet1 = wb.Sheets["Sheet1"] || wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet1, { defval:"" });
      const unblockSheet = wb.Sheets["Katalog Unblock"];
      const unblockSet = new Set();
      if (unblockSheet) {
        XLSX.utils.sheet_to_json(unblockSheet, {defval:""}).forEach(r => {
          const raw = String(r["Material"]||r[Object.keys(r)[0]]||"").trim();
          unblockSet.add(normalizeKatalog(raw));
        });
      }
      const ref = rows.map(r => {
        const raw = String(r["Material"]||"").trim();
        const kat = normalizeKatalog(raw);
        return {
          materialRaw: raw,
          katalog: kat,
          materialType: String(r["Material Type"]||"").trim(),
          materialGroup: String(r["Material Group"]||"").trim(),
          satuan: String(r["Base Unit of Measure"]||"").trim(),
          status: String(r["X-plant matl status"]||"").trim(),
          description: String(r["Material Description"]||"").trim(),
          prefix: String(r["Material Description"]||"").split(";")[0].trim(),
          isCadang: String(r["Material Type"]||"").trim()==="ZCAD" || kat.length===10,
          isUnblocked: unblockSet.has(kat),
        };
      });
      setMaraReference(ref);
      showToast(`MARA reference berhasil dimuat: ${ref.length} material (session-only, tidak disimpan ke cloud).`, "success");
    } catch(err) {
      showToast("Gagal load MARA: " + err.message, "error");
    }
    setMaraLoading(false);
    e.target.value = "";
  }

  const displayResults = analisisResult || latestResults;
  const TABS = [
    {id:"dashboard",label:"📊 Dashboard"},
    {id:"import",label:"📥 Import & Hitung"},
    {id:"hasil",label:"📋 Hasil Analisis"},
    {id:"apply",label:"✅ Apply Min Qty",badge:pendingApply.length},
  ];

  return (
    <div>
      <div style={{marginBottom:16}}>
        <h1 style={{fontSize:22,fontWeight:900,marginBottom:4}}>🔩 Material Cadang</h1>
        <p style={{color:C.muted,fontSize:13}}>Analisis ABC, inventory policy, dan rekomendasi jumlah ideal material cadang</p>
      </div>
      <div style={{display:"flex",gap:8,marginBottom:16,flexWrap:"wrap"}}>
        {TABS.map(t=>(
          <button key={t.id} style={{padding:"8px 16px",borderRadius:8,border:`1px solid ${subTab===t.id?C.accent:C.border}`,background:subTab===t.id?C.accent:"white",color:subTab===t.id?"white":C.muted,fontWeight:700,fontSize:12,cursor:"pointer",position:"relative"}}
            onClick={()=>setSubTab(t.id)}>
            {t.label}{t.badge>0 && <span style={{marginLeft:6,background:"#dc2626",color:"white",borderRadius:10,padding:"1px 6px",fontSize:10}}>{t.badge}</span>}
          </button>
        ))}
      </div>

      {/* DASHBOARD */}
      {subTab==="dashboard" && (
        <div>
          {latestResults.length === 0 ? (
            <div style={{...sty.card,textAlign:"center",padding:40,color:C.muted}}>
              <div style={{fontSize:40,marginBottom:12}}>🔩</div>
              <div style={{fontWeight:700,fontSize:16,marginBottom:8}}>Material Cadang belum dianalisis</div>
              <div style={{fontSize:13,marginBottom:20}}>Upload data populasi/failure terlebih dahulu di tab "Import & Hitung"</div>
              {canEdit && <button style={sty.btn("primary")} onClick={()=>setSubTab("import")}>📥 Upload Data Populasi/Failure</button>}
            </div>
          ) : (
            <div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(160px,1fr))",gap:12,marginBottom:16}}>
                {[
                  {label:"Total Dianalisis",val:summary.total,color:C.accent},
                  {label:"Aman ✅",val:summary.aman,color:C.green},
                  {label:"Kurang ⚠️",val:summary.kurang,color:"#f59e0b"},
                  {label:"Kosong/Kritis 🔴",val:summary.kosong,color:C.red},
                  {label:"Gap Qty",val:summary.gapQty,color:"#7c3aed"},
                  {label:"Estimasi Nilai Gap",val:"Rp "+fmtNum(summary.gapNilai),color:"#dc2626",small:true},
                ].map(kpi=>(
                  <div key={kpi.label} style={{...sty.card,borderTop:`3px solid ${kpi.color}`,padding:14}}>
                    <div style={{fontSize:11,color:C.muted,marginBottom:4}}>{kpi.label}</div>
                    <div style={{fontSize:kpi.small?14:22,fontWeight:800,color:kpi.color}}>{kpi.val}</div>
                  </div>
                ))}
              </div>
              <div style={{...sty.card,marginBottom:16}}>
                <div style={{fontWeight:700,fontSize:14,marginBottom:12}}>🏆 Prioritas Tindakan (Top 10)</div>
                <div style={{overflowX:"auto"}}>
                  <table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
                    <thead>
                      <tr style={{background:"#f9fafb"}}>
                        {["No Katalog","Nama","Kelas","Policy","Stok","Ideal","Gap","Status","Nilai Gap"].map(h=>(
                          <th key={h} style={{padding:"7px 8px",textAlign:"left",fontWeight:700,whiteSpace:"nowrap",borderBottom:`1px solid ${C.border}`}}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {[...displayResults]
                        .filter(r=>r.treatment==="Material Cadang")
                        .sort((a,b)=>{
                          if (a.abcClass!==b.abcClass) return a.abcClass.localeCompare(b.abcClass);
                          return b.gapQty - a.gapQty;
                        })
                        .slice(0,10)
                        .map((r,i)=>{
                          const status = r.currentQty===0?"Kosong/Kritis":r.currentQty<r.recommendedQty?"Kurang":"Aman";
                          const statusColor = r.currentQty===0?C.red:r.currentQty<r.recommendedQty?"#f59e0b":C.green;
                          return (
                            <tr key={i} style={{borderBottom:`1px solid ${C.border}`}}>
                              <td style={{padding:"6px 8px",color:"#0098da",fontWeight:700}}>{r.noKat}</td>
                              <td style={{padding:"6px 8px",maxWidth:180,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{r.katalogName||r.namaMaterial}</td>
                              <td style={{padding:"6px 8px"}}><span style={{background:r.abcClass==="A1"?"#fef2f2":r.abcClass==="A2"?"#fff7ed":r.abcClass==="B1"?"#eff6ff":"#f9fafb",color:r.abcClass==="A1"?C.red:r.abcClass==="A2"?"#ea580c":C.accent,padding:"2px 6px",borderRadius:4,fontWeight:700,fontSize:10}}>{r.abcClass}</span></td>
                              <td style={{padding:"6px 8px",fontSize:10,color:C.muted}}>{r.policy}</td>
                              <td style={{padding:"6px 8px",fontWeight:700}}>{r.currentQty}</td>
                              <td style={{padding:"6px 8px",fontWeight:700}}>{r.recommendedQty}</td>
                              <td style={{padding:"6px 8px",fontWeight:700,color:r.gapQty>0?C.red:C.green}}>{r.gapQty>0?"-"+r.gapQty:0}</td>
                              <td style={{padding:"6px 8px"}}><span style={{color:statusColor,fontWeight:700,fontSize:10}}>{status}</span></td>
                              <td style={{padding:"6px 8px",color:r.gapQty>0?"#7c3aed":C.muted}}>{r.gapQty>0?"Rp "+fmtNum(r.gapQty*(r.harga||0)):"-"}</td>
                            </tr>
                          );
                        })}
                    </tbody>
                  </table>
                </div>
                <div style={{marginTop:10,textAlign:"right"}}>
                  <button style={sty.btn("ghost","sm")} onClick={()=>setSubTab("hasil")}>Lihat semua hasil →</button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* IMPORT & HITUNG */}
      {subTab==="import" && (
        <div>
          {/* Keterangan cara perhitungan */}
          <div style={{...sty.card,marginBottom:16,background:"#f0f9ff",border:`1px solid #bae6fd`}}>
            <div style={{fontWeight:800,fontSize:13,color:"#0369a1",marginBottom:10}}>📐 Cara Perhitungan Material Cadang</div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(260px,1fr))",gap:14,fontSize:12}}>
              <div>
                <div style={{fontWeight:700,color:"#0369a1",marginBottom:4}}>1. Klasifikasi ABC</div>
                <div style={{color:"#374151",lineHeight:1.7}}>
                  <b>A1</b> — Kritis tinggi (failure besar, mahal, lead time panjang) → SL 99%<br/>
                  <b>A2</b> — Kritis sedang → SL 95%<br/>
                  <b>B1/B2</b> — Penting → SL 90%<br/>
                  <b>C</b> — Tidak kritikal → tidak direkomendasikan sebagai cadang<br/>
                  <span style={{color:C.muted,fontSize:11}}>Skor = (failure rate × 0.4) + (harga × 0.3) + (lead time × 0.3)</span>
                </div>
              </div>
              <div>
                <div style={{fontWeight:700,color:"#0369a1",marginBottom:4}}>2. Policy Inventory</div>
                <div style={{color:"#374151",lineHeight:1.7}}>
                  <b>Mandatory</b> — ceil(2% × populasi)<br/>
                  <b>Economic</b> — ceil(penggantian 5 tahun ÷ 5)<br/>
                  <b>Optimum</b> — Poisson CDF invers pada service level target<br/>
                  <span style={{color:C.muted,fontSize:11}}>λ = failure5y/5 × (leadTime/8760)</span>
                </div>
              </div>
              <div>
                <div style={{fontWeight:700,color:"#0369a1",marginBottom:4}}>3. A2 Split Rule</div>
                <div style={{color:"#374151",lineHeight:1.7}}>
                  A2 masuk <b>Persediaan</b> jika:<br/>
                  TTF ≥ Lead Time <b>DAN</b> tidak ada breakdown aktif <b>DAN</b> emergency = 0<br/>
                  Selain itu → <b>Material Cadang/Optimum</b>
                </div>
              </div>
              <div>
                <div style={{fontWeight:700,color:"#0369a1",marginBottom:4}}>4. Rekomendasi Min Qty</div>
                <div style={{color:"#374151",lineHeight:1.7}}>
                  Hasil akhir = <b>max(Mandatory, Economic, Optimum)</b><br/>
                  Gap = Rekomendasi − Stok Saat Ini<br/>
                  Apply ke <b>Min Qty</b> di Master Katalog memerlukan persetujuan Asman.
                </div>
              </div>
            </div>
          </div>
          <div style={{...sty.card,marginBottom:16}}>
            <div style={{fontWeight:700,fontSize:14,marginBottom:10}}>📥 Upload Data Populasi/Failure Material Cadang</div>
            <p style={{fontSize:12,color:C.muted,marginBottom:12}}>Format: CSV atau XLSX dengan header sesuai <code>TEMPLATE_IMPORT_MATERIAL_CADANG.xlsx</code>. Header XLSX di baris ke-3.</p>
            {canEdit && (
              <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
                <label style={{...sty.btn("primary"),cursor:"pointer"}}>
                  {importing?"⏳ Memproses...":"📂 Upload File CSV/XLSX"}
                  <input type="file" accept=".csv,.xlsx" style={{display:"none"}} onChange={handleImportFile} disabled={importing}/>
                </label>
                <a href={`data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,`} download="TEMPLATE_IMPORT_MATERIAL_CADANG.xlsx" style={{display:"none"}}></a>
              </div>
            )}
          </div>

          {importPreview && (
            <div style={{...sty.card,marginBottom:16}}>
              <div style={{fontWeight:700,marginBottom:10}}>Preview: {importPreview.fileName}</div>
              <div style={{display:"flex",gap:12,flexWrap:"wrap",marginBottom:14}}>
                {[
                  {label:"Total Baris",val:importPreview.stats.total,color:C.accent},
                  {label:"Match",val:importPreview.stats.match,color:C.green},
                  {label:"Warning",val:importPreview.stats.warning,color:"#f59e0b"},
                  {label:"Unmatched",val:importPreview.stats.unmatched,color:"#f59e0b"},
                  {label:"Invalid",val:importPreview.stats.invalid,color:C.red},
                ].map(s=>(
                  <div key={s.label} style={{padding:"8px 14px",borderRadius:8,background:"#f9fafb",border:`1px solid ${C.border}`,textAlign:"center"}}>
                    <div style={{fontSize:11,color:C.muted}}>{s.label}</div>
                    <div style={{fontSize:18,fontWeight:800,color:s.color}}>{s.val}</div>
                  </div>
                ))}
              </div>
              <div style={{overflowX:"auto",marginBottom:14,maxHeight:300,overflowY:"auto"}}>
                <table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
                  <thead style={{position:"sticky",top:0,background:"#003087",color:"white"}}>
                    <tr>
                      {["No Katalog","Nama Material","Cluster","Populasi","Failure","Penggantian","Lead Time","Status","Warning"].map(h=>(
                        <th key={h} style={{padding:"7px 8px",textAlign:"left",whiteSpace:"nowrap"}}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {importPreview.rows.map((r,i)=>(
                      <tr key={i} style={{background:r.status==="INVALID"?"#fef2f2":r.status==="UNMATCHED"?"#fefce8":"white",borderBottom:`1px solid ${C.border}`}}>
                        <td style={{padding:"5px 8px",fontWeight:700,color:"#0098da"}}>{r.noKat||"-"}</td>
                        <td style={{padding:"5px 8px",maxWidth:160,overflow:"hidden",textOverflow:"ellipsis"}}>{r.namaMaterial||"-"}</td>
                        <td style={{padding:"5px 8px"}}>{r.cluster||"-"}</td>
                        <td style={{padding:"5px 8px",textAlign:"right"}}>{r.populasi||0}</td>
                        <td style={{padding:"5px 8px",textAlign:"right"}}>{r.failure5y||0}</td>
                        <td style={{padding:"5px 8px",textAlign:"right"}}>{r.penggantian5y||0}</td>
                        <td style={{padding:"5px 8px",textAlign:"right"}}>{r.leadTime||0}h</td>
                        <td style={{padding:"5px 8px"}}>
                          <span style={{padding:"2px 6px",borderRadius:4,fontSize:10,fontWeight:700,background:r.status==="MATCH"?"#dcfce7":r.status==="INVALID"?"#fef2f2":"#fef9c3",color:r.status==="MATCH"?C.green:r.status==="INVALID"?C.red:"#92400e"}}>{r.status}</span>
                        </td>
                        <td style={{padding:"5px 8px",fontSize:10,color:C.muted,maxWidth:180}}>{r.error||(r.warnings||[]).join(", ")||"-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {canEdit && importPreview.stats.match + importPreview.stats.warning > 0 && (
                <button style={sty.btn("primary")} onClick={handleHitung}>🔢 Hitung Rekomendasi Material Cadang</button>
              )}
              {importPreview.stats.match + importPreview.stats.warning === 0 && (
                <div style={{color:C.red,fontWeight:700,fontSize:13}}>⚠️ Tidak ada baris yang bisa dihitung (semua UNMATCHED/INVALID). Periksa No Katalog di file.</div>
              )}
            </div>
          )}
        </div>
      )}

      {/* HASIL ANALISIS */}
      {subTab==="hasil" && (
        <div>
          {displayResults.length === 0 ? (
            <div style={{...sty.card,textAlign:"center",padding:30,color:C.muted}}>Belum ada hasil analisis. Upload dan hitung di tab "Import & Hitung".</div>
          ) : (
            <div style={{...sty.card,padding:0,overflowX:"auto"}}>
              <table style={{width:"100%",borderCollapse:"collapse",fontSize:11,minWidth:900}}>
                <thead style={{background:"#003087",color:"white"}}>
                  <tr>
                    {["No Katalog","Nama Material","Cluster","Kelas","Policy","Stok Saat Ini","Ideal","Gap","Status","Nilai Gap","Aksi"].map(h=>(
                      <th key={h} style={{padding:"8px 10px",textAlign:"left",whiteSpace:"nowrap"}}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {displayResults.map((r,i)=>{
                    const status = r.treatment!=="Material Cadang"?"Persediaan/Rutin":r.currentQty===0&&r.recommendedQty>0?"Kosong/Kritis":r.currentQty<r.recommendedQty?"Kurang":"Aman";
                    const statusColor = status==="Kosong/Kritis"?C.red:status==="Kurang"?"#f59e0b":status==="Aman"?C.green:C.muted;
                    const hasPending = materialCadangData.applyHistory.find(h=>h.katalogId===r.katalogId&&h.status==="PENDING_ASMAN");
                    return (
                      <tr key={i} style={{borderBottom:`1px solid ${C.border}`,cursor:"pointer"}} onClick={()=>setDetailItem(r)}>
                        <td style={{padding:"6px 10px",color:"#0098da",fontWeight:700}}>{r.noKat}</td>
                        <td style={{padding:"6px 10px",maxWidth:180,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{r.katalogName||r.namaMaterial}</td>
                        <td style={{padding:"6px 10px",fontSize:10}}>{r.cluster}</td>
                        <td style={{padding:"6px 10px"}}><span style={{background:r.abcClass==="A1"?"#fef2f2":r.abcClass==="A2"?"#fff7ed":r.abcClass==="B1"?"#eff6ff":"#f9fafb",color:r.abcClass==="A1"?C.red:r.abcClass==="A2"?"#ea580c":C.accent,padding:"2px 6px",borderRadius:4,fontWeight:700,fontSize:10}}>{r.abcClass}</span></td>
                        <td style={{padding:"6px 10px",fontSize:10,color:C.muted}}>{r.policy}</td>
                        <td style={{padding:"6px 10px",fontWeight:700}}>{r.currentQty}</td>
                        <td style={{padding:"6px 10px",fontWeight:700}}>{r.recommendedQty}</td>
                        <td style={{padding:"6px 10px",fontWeight:700,color:r.gapQty>0?C.red:C.green}}>{r.gapQty>0?"-"+r.gapQty:0}</td>
                        <td style={{padding:"6px 10px"}}><span style={{color:statusColor,fontWeight:700,fontSize:10}}>{status}</span></td>
                        <td style={{padding:"6px 10px",color:"#7c3aed"}}>{r.gapQty>0?"Rp "+fmtNum(r.gapQty*(r.harga||0)):"-"}</td>
                        <td style={{padding:"6px 10px"}} onClick={e=>e.stopPropagation()}>
                          {canEdit && r.treatment==="Material Cadang" && r.recommendedQty>0 && !hasPending && (
                            <button style={{...sty.btn("primary","sm"),fontSize:10}} onClick={()=>setApplyConfirm(r)}>Apply Min Qty</button>
                          )}
                          {hasPending && <span style={{fontSize:10,color:"#f59e0b",fontWeight:700}}>⏳ Pending</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* APPLY MIN QTY */}
      {subTab==="apply" && (
        <div>
          {pendingApply.length === 0 && !canApprove ? (
            <div style={{...sty.card,textAlign:"center",padding:30,color:C.muted}}>Tidak ada pengajuan apply minQty yang menunggu.</div>
          ) : null}
          {pendingApply.length > 0 && (
            <div style={{...sty.card}}>
              <div style={{fontWeight:700,marginBottom:12}}>⏳ Menunggu Approval Asman ({pendingApply.length})</div>
              {pendingApply.map(h=>(
                <div key={h.id} style={{padding:12,borderRadius:8,border:`1px solid ${C.border}`,marginBottom:10}}>
                  <div style={{fontWeight:700}}>{h.namaBarang} — No. Katalog: {h.noKatalog}</div>
                  <div style={{fontSize:12,color:C.muted,marginTop:4}}>Kelas: {h.abcClass} | Policy: {h.policy} | Recommended minQty: <strong>{h.recommendedQty}</strong></div>
                  {h.notes && <div style={{fontSize:11,color:C.muted,marginTop:4}}>Catatan: {h.notes}</div>}
                  <div style={{fontSize:11,color:C.muted,marginTop:4}}>Diajukan: {new Date(h.requestedAt).toLocaleDateString("id")}</div>
                  {canApprove && (
                    <div style={{display:"flex",gap:8,marginTop:10}}>
                      <button style={sty.btn("primary","sm")} onClick={async ()=>{
                        const updated = {...materialCadangData, applyHistory: materialCadangData.applyHistory.map(x=>x.id===h.id?{...x,status:"APPROVED_APPLIED",decidedBy:currentUser.id,decidedAt:Date.now()}:x)};
                        setMaterialCadangData(updated);
                        await saveToCloud({materialCadangData:updated});
                        showToast("Apply minQty disetujui.", "success");
                      }}>✅ Setuju</button>
                      <button style={sty.btn("danger","sm")} onClick={async ()=>{
                        const updated = {...materialCadangData, applyHistory: materialCadangData.applyHistory.map(x=>x.id===h.id?{...x,status:"REJECTED",decidedBy:currentUser.id,decidedAt:Date.now()}:x)};
                        setMaterialCadangData(updated);
                        await saveToCloud({materialCadangData:updated});
                        showToast("Pengajuan ditolak.", "success");
                      }}>❌ Tolak</button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* MARA LOOKUP */}
      {/* Modal detail item */}
      {detailItem && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:2000,padding:20}} onClick={()=>setDetailItem(null)}>
          <div style={{...sty.card,maxWidth:520,width:"100%",maxHeight:"90vh",overflowY:"auto"}} onClick={e=>e.stopPropagation()}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:12}}>
              <h3 style={{fontWeight:800,fontSize:16}}>{detailItem.katalogName||detailItem.namaMaterial}</h3>
              <button style={sty.btn("ghost","sm")} onClick={()=>setDetailItem(null)}>✕</button>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,fontSize:12}}>
              {[
                ["No Katalog",detailItem.noKat],["Equipment Cluster",detailItem.cluster],
                ["Kelas ABC",detailItem.abcClass],["Policy",detailItem.policy],
                ["Populasi",detailItem.populasi],["Failure 5th",detailItem.failure5y],
                ["Penggantian 5th",detailItem.penggantian5y],["Emergency 5th",detailItem.emergency5y],
                ["Lead Time",detailItem.leadTime+" hari"],["TTF",detailItem.ttf+" hari"],
                ["Breakdown",detailItem.breakdown?"YA":"TIDAK"],["Harga",detailItem.harga?"Rp "+fmtNum(detailItem.harga):"-"],
                ["Stok Saat Ini",detailItem.currentQty+" "+detailItem.katalogSatuan],["Rekomendasi Qty",detailItem.recommendedQty],
                ["Gap",detailItem.gapQty>0?"−"+detailItem.gapQty:"0 (cukup)"],["Cumul Value %",detailItem.cumulativeValuePct+"%"],
              ].map(([k,v])=>(
                <div key={k} style={{padding:"6px 8px",background:"#f9fafb",borderRadius:6}}>
                  <div style={{fontSize:10,color:C.muted}}>{k}</div>
                  <div style={{fontWeight:700,marginTop:2}}>{v}</div>
                </div>
              ))}
            </div>
            {(detailItem.warnings||[]).length > 0 && (
              <div style={{marginTop:12,padding:8,background:"#fef9c3",borderRadius:6,fontSize:11,color:"#92400e"}}>
                ⚠️ {detailItem.warnings.join(" | ")}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Modal konfirmasi apply minQty */}
      {applyConfirm && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:2000,padding:20}} onClick={()=>setApplyConfirm(null)}>
          <div style={{...sty.card,maxWidth:420,width:"100%"}} onClick={e=>e.stopPropagation()}>
            <h3 style={{fontWeight:800,marginBottom:12}}>Ajukan Apply Min Qty ke Asman</h3>
            <div style={{fontSize:13,marginBottom:12}}>
              <strong>{applyConfirm.katalogName||applyConfirm.namaMaterial}</strong> ({applyConfirm.noKat})<br/>
              Recommended minQty: <strong style={{color:C.accent}}>{applyConfirm.recommendedQty}</strong> (Kelas {applyConfirm.abcClass}, {applyConfirm.policy})
            </div>
            <textarea style={{...sty.input,height:70,resize:"vertical",marginBottom:12}} placeholder="Catatan untuk Asman (opsional)..." value={applyNotes} onChange={e=>setApplyNotes(e.target.value)}/>
            <div style={{display:"flex",gap:8}}>
              <button style={sty.btn("primary")} onClick={()=>handleAjukanApply(applyConfirm)}>📤 Kirim Pengajuan</button>
              <button style={sty.btn("ghost")} onClick={()=>setApplyConfirm(null)}>Batal</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// KAPASITAS GUDANG TAB
// ════════════════════════════════════════════════════════════════════

// Convert Excel serial date → string YYYY-MM-DD
function excelSerialToDate(serial) {
  if (!serial || isNaN(serial)) return String(serial||"");
  if (typeof serial === "string" && serial.includes("-")) return serial;
  const d = new Date((serial - 25569) * 86400 * 1000);
  return d.toISOString().split("T")[0];
}

// Parse sheet KAPASITAS GUDANG dari XLSX
function parseKapasitasGudangSheet(rows) {
  // Parse angka format Indonesia: "1.234,56" (titik ribuan, koma desimal) atau format polos "1234.56"
  function parseIdNumber(v) {
    let s = String(v==null?"":v).trim();
    if (!s) return NaN;
    const hasComma = s.includes(",");
    const hasDot = s.includes(".");
    if (hasComma && hasDot) {
      // titik = ribuan, koma = desimal -> buang titik, ganti koma jadi titik
      s = s.replace(/\./g,"").replace(",",".");
    } else if (hasComma && !hasDot) {
      // hanya koma -> anggap desimal
      s = s.replace(",",".");
    }
    // hasDot only (or neither): biarkan apa adanya, itu format desimal standar
    return parseFloat(s);
  }
  // Normalisasi persen: nilai bisa 0.95 (ratio) atau 95 (persen)
  function normPct(v) {
    const n = parseIdNumber(v);
    if (isNaN(n)) return 0;
    return n > 1 ? n / 100 : n; // store as 0-1
  }
  function normNum(v) { const n = parseIdNumber(v); return isNaN(n) ? 0 : n; }

  const COL_MAP = {
    upt: ["UPT"], gudang: ["GUDANG"], subGudang: ["SUB GUDANG"],
    typeGudang: ["SUB/TYPE GUDANG","TYPE GUDANG"], alamat: ["ALAMAT"],
    latitude: ["KOORDINAT LATITUDE","LATITUDE"], longitude: ["KOORDINAT LONGITUDE","LONGITUDE"],
    luasLahan: ["LUAS LAHAN (M2)","LUAS LAHAN"], luasTerpakai: ["LUAS TERPAKAI (M2)","LUAS TERPAKAI"],
    sisaLuas: ["SISA LUAS LAHAN (M2)","SISA LUAS"], pctTerpakai: ["PERSENTASE TERPAKAI (%)","PERSENTASE TERPAKAI"],
    persediaanPct: ["PERSEDIAAN (%)","PERSEDIAAN"], cadangPct: ["CADANG (%)","CADANG"],
    preMemoryPct: ["PRE-MEMORY (%)","PRE-MEMORY"], attbPct: ["ATTB (%)","ATTB"],
    lainnyaPct: ["LAINNYA (LIMBAH NON B3, ALAT ANGKUT, DLL) (%)","LAINNYA"],
    contactPerson: ["CONTACT PERSON"], waktuUpdate: ["WAKTU UPDATE"],
    keterangan: ["KETERANGAN"], linkGudang: ["LINK GUDANG"],
  };

  function getVal(row, aliases) {
    for (const a of aliases) {
      const k = Object.keys(row).find(k => k.trim().toUpperCase() === a.toUpperCase());
      if (k !== undefined && row[k] !== undefined && row[k] !== "") return row[k];
    }
    return "";
  }

  const results = [];
  for (const row of rows) {
    const upt = String(getVal(row, COL_MAP.upt)||"").trim();
    const gudang = String(getVal(row, COL_MAP.gudang)||"").trim();
    const subGudang = String(getVal(row, COL_MAP.subGudang)||"").trim();
    // Skip baris section-divider (merged cell nama UPT sebagai pemisah section) —
    // baris data asli selalu punya UPT dan GUDANG terisi bersamaan.
    if (!upt && !gudang) continue;
    if (!upt && !gudang && !subGudang) continue; // skip empty rows

    const luasLahan = normNum(getVal(row, COL_MAP.luasLahan));
    const luasTerpakai = normNum(getVal(row, COL_MAP.luasTerpakai));
    const sisaLuas = luasLahan > 0 ? luasLahan - luasTerpakai : normNum(getVal(row, COL_MAP.sisaLuas));
    const pctTerpakai = luasLahan > 0 ? luasTerpakai / luasLahan : normPct(getVal(row, COL_MAP.pctTerpakai));

    let statusKapasitas = "AMAN";
    if (pctTerpakai >= 0.90) statusKapasitas = "KRITIS";
    else if (pctTerpakai >= 0.75) statusKapasitas = "WASPADA";

    const errors = [];
    const warnings = [];
    if (!upt || !gudang || !subGudang) errors.push("UPT/GUDANG/SUB GUDANG wajib ada");
    if (luasLahan <= 0) errors.push("Luas lahan tidak valid");
    if (luasTerpakai < 0) errors.push("Luas terpakai negatif");

    const latRaw = parseIdNumber(getVal(row, COL_MAP.latitude));
    const lngRaw = parseIdNumber(getVal(row, COL_MAP.longitude));
    const lat = isNaN(latRaw) ? null : latRaw;
    const lng = isNaN(lngRaw) ? null : lngRaw;
    if (!lat || !lng) warnings.push("Koordinat kosong");

    const waktuRaw = getVal(row, COL_MAP.waktuUpdate);
    const waktuUpdate = typeof waktuRaw === "number" ? excelSerialToDate(waktuRaw) : String(waktuRaw||"").trim();

    results.push({
      id: `CAP-${upt}-${gudang}-${subGudang}`.replace(/\s+/g,"-").toUpperCase(),
      upt: upt.toUpperCase(),
      gudang, subGudang,
      typeGudang: String(getVal(row, COL_MAP.typeGudang)||"").trim(),
      alamat: String(getVal(row, COL_MAP.alamat)||"").trim(),
      latitude: lat, longitude: lng,
      luasLahanM2: luasLahan, luasTerpakaiM2: luasTerpakai, sisaLuasM2: sisaLuas,
      persentaseTerpakai: pctTerpakai,
      persediaanPct: normPct(getVal(row, COL_MAP.persediaanPct)),
      cadangPct: normPct(getVal(row, COL_MAP.cadangPct)),
      preMemoryPct: normPct(getVal(row, COL_MAP.preMemoryPct)),
      attbPct: normPct(getVal(row, COL_MAP.attbPct)),
      lainnyaPct: normPct(getVal(row, COL_MAP.lainnyaPct)),
      statusKapasitas,
      contactPerson: String(getVal(row, COL_MAP.contactPerson)||"").trim(),
      waktuUpdate,
      keterangan: String(getVal(row, COL_MAP.keterangan)||"").trim(),
      linkGudang: String(getVal(row, COL_MAP.linkGudang)||"").trim(),
      matchedGudangId: null, matchedLokasiId: null, mappingStatus: "UNMATCHED",
      _errors: errors, _warnings: warnings, _valid: errors.length === 0,
    });
  }
  return results;
}

// ════════════════════════════════════════════════════════════════════
// KAPASITAS GUDANG — IMPORT & REVIEW (dipasang di Master Data > Master Gudang)
// ════════════════════════════════════════════════════════════════════
function KapasitasGudangImportTab({ gudangCapacityImports, setGudangCapacityImports, currentUser, sty, C, saveToCloud, showToast }) {
  const [importing, setImporting] = useState(false);
  const [importPreview, setImportPreview] = useState(null);
  const canEdit = ["ADMIN","TL"].includes(currentUser.role);

  function revalidateRecord(r) {
    const luasLahan = Number(r.luasLahanM2) || 0;
    const luasTerpakai = Number(r.luasTerpakaiM2) || 0;
    const sisaLuas = luasLahan > 0 ? luasLahan - luasTerpakai : 0;
    const pctTerpakai = luasLahan > 0 ? luasTerpakai / luasLahan : 0;
    let statusKapasitas = "AMAN";
    if (pctTerpakai >= 0.90) statusKapasitas = "KRITIS";
    else if (pctTerpakai >= 0.75) statusKapasitas = "WASPADA";
    const errors = [];
    if (!r.upt?.trim() || !r.gudang?.trim() || !r.subGudang?.trim()) errors.push("UPT/GUDANG/SUB GUDANG wajib ada");
    if (luasLahan <= 0) errors.push("Luas lahan tidak valid");
    if (luasTerpakai < 0) errors.push("Luas terpakai negatif");
    const warnings = (!r.latitude || !r.longitude) ? ["Koordinat kosong"] : [];
    return { ...r, luasLahanM2:luasLahan, luasTerpakaiM2:luasTerpakai, sisaLuasM2:sisaLuas,
      persentaseTerpakai:pctTerpakai, statusKapasitas, _errors:errors, _warnings:warnings, _valid:errors.length===0 };
  }

  function updatePreviewField(idx, field, value) {
    setImportPreview(prev => {
      if (!prev) return prev;
      const records = prev.records.map((r,i) => i===idx ? revalidateRecord({...r, [field]:value}) : r);
      const valid = records.filter(r=>r._valid);
      const invalid = records.filter(r=>!r._valid);
      const warnings = records.filter(r=>r._valid && r._warnings.length>0);
      return { ...prev, records, valid, invalid, warnings };
    });
  }

  function addPreviewRow() {
    setImportPreview(prev => {
      if (!prev) return prev;
      const appUptShort = (typeof UPT !== "undefined" ? UPT : "").replace(/^UPT\s+/i,"").trim();
      const defaultUpt = currentUser?.upt || currentUser?.uptName || appUptShort || "";
      const blank = revalidateRecord({
        upt: defaultUpt.toUpperCase(), gudang:"", subGudang:"", typeGudang:"", alamat:"",
        latitude:null, longitude:null, luasLahanM2:0, luasTerpakaiM2:0, sisaLuasM2:0,
        persentaseTerpakai:0, persediaanPct:0, cadangPct:0, preMemoryPct:0, attbPct:0, lainnyaPct:0,
        statusKapasitas:"AMAN", contactPerson:"", waktuUpdate:"", keterangan:"Ditambahkan manual", linkGudang:"",
        matchedGudangId:null, matchedLokasiId:null, mappingStatus:"UNMATCHED",
      });
      const records = [...prev.records, blank];
      const valid = records.filter(r=>r._valid);
      const invalid = records.filter(r=>!r._valid);
      const warnings = records.filter(r=>r._valid && r._warnings.length>0);
      return { ...prev, records, valid, invalid, warnings };
    });
  }

  function deletePreviewRow(idx) {
    setImportPreview(prev => {
      if (!prev) return prev;
      const records = prev.records.filter((_,i)=>i!==idx);
      const valid = records.filter(r=>r._valid);
      const invalid = records.filter(r=>!r._valid);
      const warnings = records.filter(r=>r._valid && r._warnings.length>0);
      return { ...prev, records, valid, invalid, warnings };
    });
  }

  function deletePreviewByUpt(uptToRemove) {
    setImportPreview(prev => {
      if (!prev) return prev;
      const records = prev.records.filter(r=>r.upt!==uptToRemove);
      const valid = records.filter(r=>r._valid);
      const invalid = records.filter(r=>!r._valid);
      const warnings = records.filter(r=>r._valid && r._warnings.length>0);
      return { ...prev, records, valid, invalid, warnings };
    });
  }

  function keepOnlyUpt(uptToKeep) {
    setImportPreview(prev => {
      if (!prev) return prev;
      const records = prev.records.filter(r=>r.upt===uptToKeep);
      const valid = records.filter(r=>r._valid);
      const invalid = records.filter(r=>!r._valid);
      const warnings = records.filter(r=>r._valid && r._warnings.length>0);
      return { ...prev, records, valid, invalid, warnings };
    });
  }

  async function handleImportFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf);
      const sheetName = wb.SheetNames.find(s=>s.toUpperCase().includes("KAPASITAS GUDANG")) || wb.SheetNames[0];
      const ws = wb.Sheets[sheetName];
      const rawRows = XLSX.utils.sheet_to_json(ws, { header:1, defval:"", raw:false });
      let headerRowIdx = 0;
      for (let i=0; i<Math.min(15, rawRows.length); i++) {
        const hasUpt = rawRows[i].some(cell => String(cell||"").trim().toUpperCase()==="UPT");
        if (hasUpt) { headerRowIdx = i; break; }
      }
      const rows = XLSX.utils.sheet_to_json(ws, { defval:"", range: headerRowIdx });
      const parsed = parseKapasitasGudangSheet(rows);
      if (parsed.length === 0) {
        showToast("File terbaca tapi 0 baris data ditemukan. Cek apakah baris header (UPT, GUDANG, dst) ada di file.", "error");
      } else if (parsed.every(r=>!r._valid)) {
        showToast(`File terbaca (${parsed.length} baris) tapi semua tidak valid. Cek kolom UPT/GUDANG/SUB GUDANG/LUAS LAHAN.`, "error");
      }
      const valid = parsed.filter(r=>r._valid);
      const invalid = parsed.filter(r=>!r._valid);
      const warnings = parsed.filter(r=>r._valid && r._warnings.length>0);
      setImportPreview({ records: parsed, valid, invalid, warnings, fileName: file.name, sheetName });
    } catch(err) {
      showToast("Gagal baca file: " + err.message, "error");
    }
    setImporting(false);
    e.target.value = "";
  }

  async function handleSubmitForApproval() {
    if (!importPreview) return;
    const toPublish = importPreview.valid.map(r => ({...r, _errors:undefined, _warnings:undefined, _valid:undefined}));
    const batchId = "CAPIMP-"+Date.now();
    const importRecord = {
      id: batchId, sourceFile: importPreview.fileName, sheetName: importPreview.sheetName,
      importedBy: currentUser.id, importedAt: Date.now(),
      totalRows: importPreview.records.length, validRows: importPreview.valid.length,
      invalidRows: importPreview.invalid.length, warningRows: importPreview.warnings.length,
      status: "PENDING_ASMAN", records: toPublish,
    };
    const newImports = [...gudangCapacityImports, importRecord];
    setGudangCapacityImports(newImports);
    await saveToCloud({ gudangCapacityImports: newImports });
    setImportPreview(null);
    showToast(`Diajukan ke Asman untuk approval (${toPublish.length} record). Lihat status di menu Approval.`, "success");
  }

  return (
    <div>
      <div style={{...sty.card,marginBottom:16}}>
        <div style={{fontWeight:700,fontSize:14,marginBottom:8}}>📥 Import Laporan Kapasitas Gudang (XLSX)</div>
        <p style={{fontSize:12,color:C.muted,marginBottom:12}}>Upload file KAPASITAS GUDANG UIT JBM.xlsx. Sheet yang dibaca: <strong>KAPASITAS GUDANG</strong>.</p>
        {canEdit && (
          <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
            <label style={{...sty.btn("primary"),cursor:"pointer"}}>
              {importing?"⏳ Memproses...":"📂 Upload XLSX Kapasitas Gudang"}
              <input type="file" accept=".xlsx" style={{display:"none"}} onChange={handleImportFile} disabled={importing}/>
            </label>
            {!importPreview && (
              <button style={sty.btn("ghost")} onClick={()=>setImportPreview({records:[],valid:[],invalid:[],warnings:[],fileName:"(manual, tanpa file)",sheetName:"-"})}>
                ➕ Buat Manual (tanpa file)
              </button>
            )}
          </div>
        )}
      </div>

      {importPreview && (
        <div style={{...sty.card}}>
          <div style={{fontWeight:700,marginBottom:10}}>Preview: {importPreview.fileName} (Sheet: {importPreview.sheetName})</div>
          <div style={{display:"flex",gap:10,flexWrap:"wrap",marginBottom:14}}>
            {[
              {label:"Total",val:importPreview.records.length,color:C.accent},
              {label:"Valid",val:importPreview.valid.length,color:C.green},
              {label:"Warning",val:importPreview.warnings.length,color:"#f59e0b"},
              {label:"Invalid",val:importPreview.invalid.length,color:C.red},
            ].map(s=>(
              <div key={s.label} style={{padding:"8px 14px",borderRadius:8,background:"#f9fafb",border:`1px solid ${C.border}`,textAlign:"center"}}>
                <div style={{fontSize:11,color:C.muted}}>{s.label}</div>
                <div style={{fontSize:18,fontWeight:800,color:s.color}}>{s.val}</div>
              </div>
            ))}
          </div>
          {importPreview.invalid.length > 0 && (
            <div style={{color:C.red,fontWeight:700,fontSize:12,marginBottom:8}}>⚠️ Ada {importPreview.invalid.length} baris invalid — edit langsung di tabel (sel putih = bisa diedit) untuk memperbaiki, atau baris akan diabaikan saat submit.</div>
          )}
          {canEdit && (()=>{
            const uptsInPreview = [...new Set(importPreview.records.map(r=>r.upt))].filter(Boolean).sort();
            if (uptsInPreview.length <= 1) return null;
            return (
              <div style={{display:"flex",gap:6,flexWrap:"wrap",alignItems:"center",marginBottom:10,padding:"8px 10px",background:"#f9fafb",border:`1px solid ${C.border}`,borderRadius:8}}>
                <span style={{fontSize:11,color:C.muted,fontWeight:700}}>File berisi {uptsInPreview.length} UPT — hapus cepat:</span>
                {uptsInPreview.map(u=>(
                  <span key={u} style={{display:"inline-flex",alignItems:"center",gap:4}}>
                    <button style={{...sty.btn("ghost","sm"),padding:"3px 8px",fontSize:11}} onClick={()=>keepOnlyUpt(u)} title={`Hanya simpan ${u}, hapus sisanya`}>Hanya {u}</button>
                    <button style={{...sty.btn("danger","sm"),padding:"3px 8px",fontSize:11}} onClick={()=>deletePreviewByUpt(u)} title={`Hapus semua baris ${u}`}>🗑️ {u}</button>
                  </span>
                ))}
              </div>
            );
          })()}
          <div style={{overflowX:"auto",maxHeight:440,overflowY:"auto",marginBottom:14}}>
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:11,minWidth:1050}}>
              <thead style={{background:"#003087",color:"white",position:"sticky",top:0}}>
                <tr>
                  {["UPT","Gudang","Sub Gudang","Luas Lahan (m²)","Terpakai (m²)","Utilization","Status","Warning","Aksi"].map(h=>(
                    <th key={h} style={{padding:"7px 8px",textAlign:"left",whiteSpace:"nowrap"}}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {importPreview.records.map((r,i)=>{
                  const cellStyle = {padding:"3px 6px",border:`1px solid ${C.border}`,borderRadius:5,fontSize:11,width:"100%",background:"white"};
                  return (
                  <tr key={i} style={{borderBottom:`1px solid ${C.border}`,background:!r._valid?"#fef2f2":r._warnings.length>0?"#fefce8":"white"}}>
                    <td style={{padding:"4px 6px"}}><input style={cellStyle} value={r.upt} onChange={e=>updatePreviewField(i,"upt",e.target.value.toUpperCase())} disabled={!canEdit}/></td>
                    <td style={{padding:"4px 6px"}}><input style={cellStyle} value={r.gudang} onChange={e=>updatePreviewField(i,"gudang",e.target.value)} disabled={!canEdit}/></td>
                    <td style={{padding:"4px 6px"}}><input style={{...cellStyle,fontWeight:600,minWidth:160}} value={r.subGudang} onChange={e=>updatePreviewField(i,"subGudang",e.target.value)} disabled={!canEdit}/></td>
                    <td style={{padding:"4px 6px"}}><input style={{...cellStyle,textAlign:"right",width:80}} type="number" value={r.luasLahanM2} onChange={e=>updatePreviewField(i,"luasLahanM2",parseFloat(e.target.value)||0)} disabled={!canEdit}/></td>
                    <td style={{padding:"4px 6px"}}><input style={{...cellStyle,textAlign:"right",width:80}} type="number" value={r.luasTerpakaiM2} onChange={e=>updatePreviewField(i,"luasTerpakaiM2",parseFloat(e.target.value)||0)} disabled={!canEdit}/></td>
                    <td style={{padding:"5px 8px",fontWeight:700,color:r.statusKapasitas==="KRITIS"?C.red:r.statusKapasitas==="WASPADA"?"#f59e0b":C.green}}>{(r.persentaseTerpakai*100).toFixed(1)}%</td>
                    <td style={{padding:"5px 8px"}}><span style={{fontSize:10,fontWeight:700,color:r.statusKapasitas==="KRITIS"?C.red:r.statusKapasitas==="WASPADA"?"#f59e0b":C.green}}>{r.statusKapasitas}</span></td>
                    <td style={{padding:"5px 8px",fontSize:10,color:C.muted,maxWidth:200}}>{[...r._errors,...r._warnings].join(", ")||"-"}</td>
                    <td style={{padding:"4px 6px"}}>{canEdit && <button style={{...sty.btn("danger","sm"),padding:"3px 8px"}} onClick={()=>deletePreviewRow(i)} title="Hapus baris ini">🗑️</button>}</td>
                  </tr>
                );})}
              </tbody>
            </table>
          </div>
          {canEdit && (
            <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
              <button style={sty.btn("ghost")} onClick={addPreviewRow}>➕ Tambah Gudang</button>
              <button style={sty.btn("primary")} disabled={importPreview.valid.length===0} onClick={handleSubmitForApproval}>
                📤 Kirim ke Asman untuk Approval ({importPreview.valid.length} record valid)
              </button>
            </div>
          )}
          {importPreview.invalid.length > 0 && (
            <div style={{color:C.red,fontSize:11,marginTop:6}}>Baris invalid ({importPreview.invalid.length}) akan diabaikan otomatis — perbaiki dulu di tabel jika ingin ikut disertakan.</div>
          )}
        </div>
      )}

      {gudangCapacityImports.length > 0 && (
        <div style={{...sty.card,marginTop:16}}>
          <div style={{fontWeight:700,marginBottom:8}}>Riwayat Import</div>
          {[...gudangCapacityImports].reverse().map(imp=>{
            const statusMeta = {
              PENDING_ASMAN:{label:"⏳ Menunggu Asman",bg:"#fefce8",fg:"#92400e"},
              APPROVED:{label:"✅ Disetujui",bg:"#f0fdf4",fg:C.green},
              REJECTED:{label:"❌ Ditolak",bg:"#fef2f2",fg:C.red},
            }[imp.status] || {label:"— (legacy, langsung publish)",bg:"#f9fafb",fg:C.muted};
            return (
            <div key={imp.id} style={{padding:"8px 0",borderBottom:`1px solid ${C.border}`,fontSize:12}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <div style={{fontWeight:700}}>{imp.sourceFile}</div>
                <span style={{padding:"2px 8px",borderRadius:10,fontSize:10,fontWeight:700,background:statusMeta.bg,color:statusMeta.fg}}>{statusMeta.label}</span>
              </div>
              <div style={{color:C.muted,fontSize:11}}>{new Date(imp.importedAt).toLocaleString("id")} — {imp.validRows} valid / {imp.invalidRows} invalid</div>
              {imp.status==="REJECTED" && imp.rejectReason && <div style={{color:C.red,fontSize:11,marginTop:2}}>Alasan: {imp.rejectReason}</div>}
            </div>
          );})}
        </div>
      )}
    </div>
  );
}

function KapasitasGudangTab({ gudangCapacityList, gudangList, subGudangList, lokasiList, stocks, currentUser, sty, C, setTab, setStockSubTab }) {
  const [subTab, setSubTab] = useState("dashboard");
  const [filterUPT, setFilterUPT] = useState("ALL");
  const [filterStatus, setFilterStatus] = useState("ALL");
  const [detailRecord, setDetailRecord] = useState(null);

  const canEdit = ["ADMIN","TL"].includes(currentUser.role);

  // Daftar UPT unik dari data (string label, bukan Master UPT)
  const uptLabelList = [...new Set(gudangCapacityList.map(r=>r.upt))].sort();

  const filtered = gudangCapacityList.filter(r =>
    (filterUPT==="ALL" || r.upt===filterUPT) &&
    (filterStatus==="ALL" || r.statusKapasitas===filterStatus)
  );

  // KPI aggregat
  const totalLahan = gudangCapacityList.reduce((s,r)=>s+r.luasLahanM2,0);
  const totalTerpakai = gudangCapacityList.reduce((s,r)=>s+r.luasTerpakaiM2,0);
  const totalSisa = totalLahan - totalTerpakai;
  const utilTotal = totalLahan > 0 ? totalTerpakai / totalLahan : 0;
  const kritis = gudangCapacityList.filter(r=>r.statusKapasitas==="KRITIS").length;
  const waspada = gudangCapacityList.filter(r=>r.statusKapasitas==="WASPADA").length;
  const aman = gudangCapacityList.filter(r=>r.statusKapasitas==="AMAN").length;

  // Ranking UPT (weighted utilization)
  const uptRanking = Object.entries(
    gudangCapacityList.reduce((acc,r) => {
      if (!acc[r.upt]) acc[r.upt] = {lahan:0,terpakai:0};
      acc[r.upt].lahan += r.luasLahanM2;
      acc[r.upt].terpakai += r.luasTerpakaiM2;
      return acc;
    }, {})
  ).map(([upt,v])=>({upt, util: v.lahan>0?v.terpakai/v.lahan:0, lahan:v.lahan, terpakai:v.terpakai}))
   .sort((a,b)=>b.util-a.util);

  const TABS = [
    {id:"dashboard",label:"📊 Dashboard"},
    {id:"data",label:"📋 Data Kapasitas"},
    {id:"peta",label:"🗺️ Peta Gudang"},
  ];

  return (
    <div>
      <div style={{marginBottom:16}}>
        <h1 style={{fontSize:22,fontWeight:900,marginBottom:4}}>📐 Monitoring Kapasitas Gudang</h1>
        <p style={{color:C.muted,fontSize:13}}>Laporan utilization luas gudang berbasis m2 — UIT JBM</p>
      </div>
      <div style={{display:"flex",gap:8,marginBottom:16,flexWrap:"wrap"}}>
        {TABS.map(t=>(
          <button key={t.id} style={{padding:"8px 16px",borderRadius:8,border:`1px solid ${subTab===t.id?C.accent:C.border}`,background:subTab===t.id?C.accent:"white",color:subTab===t.id?"white":C.muted,fontWeight:700,fontSize:12,cursor:"pointer"}}
            onClick={()=>setSubTab(t.id)}>{t.label}</button>
        ))}
      </div>

      {/* DASHBOARD */}
      {subTab==="dashboard" && (
        <div>
          {gudangCapacityList.length === 0 ? (
            <div style={{...sty.card,textAlign:"center",padding:40,color:C.muted}}>
              <div style={{fontSize:40,marginBottom:12}}>📐</div>
              <div style={{fontWeight:700,fontSize:16,marginBottom:8}}>Data kapasitas gudang belum tersedia</div>
              <div style={{fontSize:13,marginBottom:20}}>Import file KAPASITAS GUDANG UIT JBM.xlsx di menu Master Data → Master Gudang</div>
              {canEdit && <button style={sty.btn("primary")} onClick={()=>{setTab("master");setStockSubTab("gudang");}}>📥 Buka Master Gudang untuk Import</button>}
            </div>
          ) : (
            <div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(160px,1fr))",gap:12,marginBottom:16}}>
                {[
                  {label:"Total Luas Lahan",val:fmtNum(Math.round(totalLahan))+" m²",color:C.accent},
                  {label:"Total Terpakai",val:fmtNum(Math.round(totalTerpakai))+" m²",color:"#7c3aed"},
                  {label:"Sisa Luas",val:fmtNum(Math.round(totalSisa))+" m²",color:C.green},
                  {label:"Utilization Total",val:(utilTotal*100).toFixed(1)+"%",color:utilTotal>=0.9?C.red:utilTotal>=0.75?"#f59e0b":C.green},
                  {label:"🔴 Kritis (≥90%)",val:kritis,color:C.red},
                  {label:"🟡 Waspada (75-89%)",val:waspada,color:"#f59e0b"},
                  {label:"🟢 Aman (<75%)",val:aman,color:C.green},
                ].map(kpi=>(
                  <div key={kpi.label} style={{...sty.card,borderTop:`3px solid ${kpi.color}`,padding:14}}>
                    <div style={{fontSize:11,color:C.muted,marginBottom:4}}>{kpi.label}</div>
                    <div style={{fontSize:16,fontWeight:800,color:kpi.color}}>{kpi.val}</div>
                  </div>
                ))}
              </div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16,marginBottom:16}}>
                <div style={{...sty.card}}>
                  <div style={{fontWeight:700,marginBottom:10}}>🏆 Ranking UPT (Utilization)</div>
                  {uptRanking.map((u,i)=>(
                    <div key={u.upt} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"8px 0",borderBottom:`1px solid ${C.border}`}}>
                      <div>
                        <div style={{fontWeight:700,fontSize:12}}>#{i+1} {u.upt}</div>
                        <div style={{fontSize:10,color:C.muted}}>{fmtNum(Math.round(u.terpakai))} / {fmtNum(Math.round(u.lahan))} m²</div>
                      </div>
                      <div style={{textAlign:"right"}}>
                        <div style={{fontWeight:800,color:u.util>=0.9?C.red:u.util>=0.75?"#f59e0b":C.green}}>{(u.util*100).toFixed(1)}%</div>
                        <div style={{width:80,height:6,background:"#e5e7eb",borderRadius:3,marginTop:3}}>
                          <div style={{width:(u.util*100)+"%",height:"100%",background:u.util>=0.9?C.red:u.util>=0.75?"#f59e0b":C.green,borderRadius:3}}/>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                <div style={{...sty.card}}>
                  <div style={{fontWeight:700,marginBottom:10}}>🔴 Sub-Gudang Paling Kritis</div>
                  {gudangCapacityList.filter(r=>r.statusKapasitas==="KRITIS").sort((a,b)=>b.persentaseTerpakai-a.persentaseTerpakai).slice(0,8).map((r,i)=>(
                    <div key={i} style={{padding:"7px 0",borderBottom:`1px solid ${C.border}`}}>
                      <div style={{display:"flex",justifyContent:"space-between"}}>
                        <div style={{fontSize:12,fontWeight:600}}>{r.subGudang}</div>
                        <span style={{color:C.red,fontWeight:800,fontSize:12}}>{(r.persentaseTerpakai*100).toFixed(1)}%</span>
                      </div>
                      <div style={{fontSize:10,color:C.muted}}>{r.upt} — {r.gudang}</div>
                    </div>
                  ))}
                  {gudangCapacityList.filter(r=>r.statusKapasitas==="KRITIS").length===0 && <div style={{color:C.muted,fontSize:12}}>Tidak ada sub-gudang kritis saat ini.</div>}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* DATA KAPASITAS */}
      {subTab==="data" && (
        <div>
          <div style={{display:"flex",gap:8,marginBottom:12,flexWrap:"wrap"}}>
            <select style={{...sty.select,maxWidth:180}} value={filterUPT} onChange={e=>setFilterUPT(e.target.value)}>
              <option value="ALL">Semua UPT</option>
              {uptLabelList.map(u=><option key={u}>{u}</option>)}
            </select>
            <select style={{...sty.select,maxWidth:180}} value={filterStatus} onChange={e=>setFilterStatus(e.target.value)}>
              <option value="ALL">Semua Status</option>
              <option value="KRITIS">🔴 Kritis</option>
              <option value="WASPADA">🟡 Waspada</option>
              <option value="AMAN">🟢 Aman</option>
            </select>
            <span style={{color:C.muted,fontSize:12,alignSelf:"center"}}>{filtered.length} record</span>
          </div>
          <div style={{...sty.card,padding:0,overflowX:"auto"}}>
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:11,minWidth:900}}>
              <thead style={{background:"#003087",color:"white"}}>
                <tr>
                  {["UPT","Gudang","Sub Gudang","Luas Lahan (m²)","Terpakai (m²)","Sisa (m²)","Utilization","Status","Update","Detail"].map(h=>(
                    <th key={h} style={{padding:"8px 10px",textAlign:"left",whiteSpace:"nowrap"}}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((r,i)=>(
                  <tr key={i} style={{borderBottom:`1px solid ${C.border}`,background:r.statusKapasitas==="KRITIS"?"#fef2f2":r.statusKapasitas==="WASPADA"?"#fefce8":"white"}}>
                    <td style={{padding:"6px 10px",fontWeight:700}}>{r.upt}</td>
                    <td style={{padding:"6px 10px"}}>{r.gudang}</td>
                    <td style={{padding:"6px 10px",fontWeight:600}}>{r.subGudang}</td>
                    <td style={{padding:"6px 10px",textAlign:"right"}}>{fmtNum(Math.round(r.luasLahanM2))}</td>
                    <td style={{padding:"6px 10px",textAlign:"right"}}>{fmtNum(Math.round(r.luasTerpakaiM2))}</td>
                    <td style={{padding:"6px 10px",textAlign:"right"}}>{fmtNum(Math.round(r.sisaLuasM2))}</td>
                    <td style={{padding:"6px 10px"}}>
                      <div style={{display:"flex",alignItems:"center",gap:6}}>
                        <div style={{width:60,height:6,background:"#e5e7eb",borderRadius:3}}>
                          <div style={{width:Math.min(100,(r.persentaseTerpakai*100))+"%",height:"100%",background:r.statusKapasitas==="KRITIS"?C.red:r.statusKapasitas==="WASPADA"?"#f59e0b":C.green,borderRadius:3}}/>
                        </div>
                        <span style={{fontWeight:700,color:r.statusKapasitas==="KRITIS"?C.red:r.statusKapasitas==="WASPADA"?"#f59e0b":C.green}}>{(r.persentaseTerpakai*100).toFixed(1)}%</span>
                      </div>
                    </td>
                    <td style={{padding:"6px 10px"}}>
                      <span style={{padding:"2px 8px",borderRadius:10,fontSize:10,fontWeight:700,background:r.statusKapasitas==="KRITIS"?"#fef2f2":r.statusKapasitas==="WASPADA"?"#fefce8":"#f0fdf4",color:r.statusKapasitas==="KRITIS"?C.red:r.statusKapasitas==="WASPADA"?"#92400e":C.green}}>{r.statusKapasitas}</span>
                    </td>
                    <td style={{padding:"6px 10px",fontSize:10,color:C.muted}}>{r.waktuUpdate||"-"}</td>
                    <td style={{padding:"6px 10px"}}>
                      <button style={sty.btn("ghost","sm")} onClick={()=>setDetailRecord(r)}>Detail</button>
                    </td>
                  </tr>
                ))}
                {filtered.length===0 && <tr><td colSpan={10} style={{padding:20,textAlign:"center",color:C.muted}}>Tidak ada data</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}


      {/* Detail modal */}
      {/* SUB-TAB PETA GUDANG */}
      {subTab==="peta" && (
        <PetaGudangTab
          gudangList={gudangList}
          subGudangList={subGudangList}
          lokasiList={lokasiList}
          stocks={stocks||[]}
          sty={sty} C={C}
          currentUser={currentUser}
          gudangCapacityList={gudangCapacityList}
        />
      )}

      {detailRecord && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:2000,padding:20}} onClick={()=>setDetailRecord(null)}>
          <div style={{...sty.card,maxWidth:480,width:"100%",maxHeight:"90vh",overflowY:"auto"}} onClick={e=>e.stopPropagation()}>
            <div style={{display:"flex",justifyContent:"space-between",marginBottom:12}}>
              <h3 style={{fontWeight:800}}>{detailRecord.subGudang}</h3>
              <button style={sty.btn("ghost","sm")} onClick={()=>setDetailRecord(null)}>✕</button>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,fontSize:12,marginBottom:12}}>
              {[["UPT",detailRecord.upt],["Gudang",detailRecord.gudang],["Type",detailRecord.typeGudang||"-"],["Alamat",detailRecord.alamat||"-"],
                ["Luas Lahan",fmtNum(Math.round(detailRecord.luasLahanM2))+" m²"],["Terpakai",fmtNum(Math.round(detailRecord.luasTerpakaiM2))+" m²"],
                ["Sisa",fmtNum(Math.round(detailRecord.sisaLuasM2))+" m²"],["Utilization",(detailRecord.persentaseTerpakai*100).toFixed(1)+"%"],
                ["Komposisi Persediaan",(detailRecord.persediaanPct*100).toFixed(0)+"%"],["Komposisi Cadang",(detailRecord.cadangPct*100).toFixed(0)+"%"],
                ["Contact Person",detailRecord.contactPerson||"-"],["Waktu Update",detailRecord.waktuUpdate||"-"],
              ].map(([k,v])=>(
                <div key={k} style={{padding:"6px 8px",background:"#f9fafb",borderRadius:6}}>
                  <div style={{fontSize:10,color:C.muted}}>{k}</div>
                  <div style={{fontWeight:700,marginTop:2}}>{v}</div>
                </div>
              ))}
            </div>
            {detailRecord.keterangan && <div style={{fontSize:12,color:C.muted,marginBottom:8}}>📝 {detailRecord.keterangan}</div>}
            {detailRecord.linkGudang && <a href={detailRecord.linkGudang} target="_blank" rel="noreferrer" style={{fontSize:12,color:C.accent}}>🔗 Link Gudang</a>}
          </div>
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// MIGRASI DATA TAB
// ════════════════════════════════════════════════════════════════════
function MigrasiDataTab({ stocks, katalogList, lokasiList, txns, migratedTug15History, setMigratedTug15History, maraReference, setMaraReference, maraUploadLoading, maraUploadProgress, uploadMaraToDB, currentUser, sty, C, saveToCloud, setStocks, setKatalogList, setTxns, showToast }) {
  const [step, setStep] = useState("upload"); // "upload" | "preview" | "backup" | "done"
  const [sapFile, setSapFile] = useState(null);
  const [sapRows, setSapRows] = useState([]);
  const [nonSapRows, setNonSapRows] = useState([]);
  const [parsedSAP, setParsedSAP] = useState([]);
  const [parsedNonSAP, setParsedNonSAP] = useState([]);
  const [previewStats, setPreviewStats] = useState(null);
  const [busy, setBusy] = useState(false);
  const [maraLoading, setMaraLoading] = useState(false);

  // Parse CSV SAP format PEMAT
  function parseSAPMigration(rows) {
    return rows.map(row => {
      const material = String(row["Material"]||row["material"]||"").trim();
      const noKat = normalizeKatalog(material);
      const desc = String(row["Material Description"]||row["material description"]||"").trim();
      const satuan = String(row["Base Unit of Measure"]||"").trim() || "BH";
      const qtyRaw = String(row["Unrestricted Use Stock"]||row["unrestricted use stock"]||"0").replace(/\./g,"").replace(",",".");
      const qty = parseFloat(qtyRaw) || 0;
      const valType = String(row["Valuation Type"]||"").trim().toUpperCase();
      const harga = parseFloat(String(row["Harga Satuan"]||"0").replace(/\./g,"").replace(",",".")) || 0;

      let jenisBarang = "Persediaan";
      if (noKat.length === 10) jenisBarang = "Cadang";
      else if (valType === "BURSA") jenisBarang = "Persediaan Bursa";
      else if (valType === "PRE-MEMORY") jenisBarang = "Pre Memory";

      return { noKat, material, desc, satuan, qty, jenisBarang, harga, valType, _valid: noKat.length > 0 && qty >= 0 };
    }).filter(r => r.noKat);
  }

  async function handleSAPFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    try {
      let rows = [];
      if (file.name.toLowerCase().endsWith(".csv")) {
        const text = await file.text();
        const clean = text.replace(/^﻿/, ""); // strip BOM
        const lines = clean.replace(/\r/g,"").split("\n").filter(Boolean);
        const sep = lines[0].includes(";") ? ";" : ",";
        const headers = lines[0].split(sep).map(h=>h.trim().replace(/^"|"$/g,""));
        rows = lines.slice(1).map(l => {
          const vals = l.split(sep).map(v=>v.trim().replace(/^"|"$/g,""));
          const obj = {}; headers.forEach((h,i)=>{ obj[h]=vals[i]||""; }); return obj;
        });
      } else {
        const buf = await file.arrayBuffer();
        const wb = XLSX.read(buf);
        rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], {defval:""});
      }
      const parsed = parseSAPMigration(rows);
      setSapRows(parsed);
      setSapFile(file.name);
      showToast(`SAP: ${parsed.length} baris berhasil diparse.`, "success");
    } catch(err) { showToast("Gagal parse SAP: " + err.message, "error"); }
    setBusy(false);
    e.target.value = "";
  }

  async function handleLoadMara(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setMaraLoading(true);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf);
      const sheet1 = wb.Sheets["Sheet1"] || wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet1, {defval:""});
      const ref = rows.map(r => ({
        katalog: normalizeKatalog(String(r["Material"]||"").trim()),
        description: String(r["Material Description"]||"").trim(),
        satuan: String(r["Base Unit of Measure"]||"").trim(),
        materialType: String(r["Material Type"]||"").trim(),
      }));
      setMaraReference(ref);
      showToast(`MARA dimuat: ${ref.length} material (session-only).`, "success");
    } catch(err) { showToast("Gagal load MARA: " + err.message, "error"); }
    setMaraLoading(false);
    e.target.value = "";
  }

  function buildPreview() {
    const maraSet = new Set((maraReference||[]).map(r=>r.katalog));
    const warnotoSet = new Set(katalogList.map(k=>normalizeKatalog(k.katalog)));

    const sapResult = sapRows.map(r => ({
      ...r,
      matchWarnoto: warnotoSet.has(r.noKat),
      matchMara: maraSet.has(r.noKat),
    }));

    const byJenis = {};
    sapResult.forEach(r => { byJenis[r.jenisBarang] = (byJenis[r.jenisBarang]||0) + 1; });

    const totalQty = sapResult.reduce((s,r)=>s+r.qty,0);
    const totalNilai = sapResult.reduce((s,r)=>s+(r.qty*r.harga),0);

    setPreviewStats({ sapResult, byJenis, totalQty, totalNilai });
    setStep("preview");
  }

  async function handleBackupAndApply() {
    if (!previewStats) return;
    setBusy(true);
    try {
      // 1. Backup data sebelum cutover
      const backup = {
        stocks, katalogList, lokasiList, txns,
        backupAt: Date.now(), by: currentUser.id,
        note: "Pre-migration backup sebelum cutover SAP " + (sapFile||""),
      };
      const backupStr = JSON.stringify(backup, null, 2);
      const blobBackup = new Blob([backupStr], {type:"application/json"});
      const aBackup = document.createElement("a");
      aBackup.href = URL.createObjectURL(blobBackup);
      aBackup.download = `warnoto_backup_pre_migrasi_${new Date().toISOString().slice(0,10)}.json`;
      aBackup.click();

      // 2. Build katalog baru dari SAP
      const now = Date.now();
      const newKatalog = previewStats.sapResult.map(r => {
        const existing = katalogList.find(k=>normalizeKatalog(k.katalog)===r.noKat);
        if (existing) return { ...existing, jenisBarang: r.jenisBarang, satuan: r.satuan || existing.satuan };
        return {
          id: "KAT-MIG-"+r.noKat,
          katalog: r.noKat,
          name: r.desc,
          category: r.desc.split(";")[0].trim() || "Material",
          jenisBarang: r.jenisBarang,
          satuan: r.satuan,
          keterangan: "Import migrasi SAP " + (sapFile||""),
          createdAt: now,
        };
      });

      // 3. Build stocks baru (satu lokasi default per item)
      const defaultLokasi = lokasiList[0];
      const newStocks = previewStats.sapResult.filter(r=>r.qty>0).map(r => {
        const kat = newKatalog.find(k=>k.katalog===r.noKat);
        const existing = stocks.find(s=>{
          const k = katalogList.find(kk=>kk.id===s.katalogId);
          return k && normalizeKatalog(k.katalog)===r.noKat;
        });
        return {
          id: existing?.id || ("STK-MIG-"+r.noKat+"-"+now),
          katalogId: kat?.id || ("KAT-MIG-"+r.noKat),
          lokasiId: existing?.lokasiId || defaultLokasi?.id || null,
          qty: r.qty,
          price: r.harga || existing?.price || 0,
          minQty: existing?.minQty || 0,
          unit: r.satuan,
          jenisBarang: r.jenisBarang,
          name: r.desc,
          katalog: r.noKat,
          category: r.desc.split(";")[0].trim()||"Material",
          sapBaselineQty: r.qty,
          sapBaselineAt: now,
          createdAt: existing?.createdAt || now,
          updatedAt: now,
        };
      });

      // 4. Simpan histori TUG-15 lama sebagai migrasi
      const migHistory = txns.map(t => ({...t, _migrasiSource:"WARNOTO_TEST"}));
      setMigratedTug15History(migHistory);

      // 5. Apply cutover
      setKatalogList(newKatalog);
      setStocks(newStocks);
      setTxns([]);
      await saveToCloud({
        katalogList: newKatalog,
        stocks: newStocks,
        txns: [],
        migratedTug15History: migHistory,
      });

      setStep("done");
      showToast(`Cutover berhasil! ${newKatalog.length} katalog, ${newStocks.length} baris stok.`, "success");
    } catch(err) {
      showToast("Cutover gagal: " + err.message, "error");
    }
    setBusy(false);
  }

  return (
    <div>
      <div style={{marginBottom:16}}>
        <h1 style={{fontSize:22,fontWeight:900,marginBottom:4}}>🔄 Migrasi Data SAP/Non-SAP</h1>
        <p style={{color:C.muted,fontSize:13}}>Cutover terkontrol data stok dari SAP ke WARNOTO. <strong style={{color:C.red}}>⚠️ Hanya untuk ADMIN — backup wajib sebelum apply!</strong></p>
      </div>

      {/* Step indicator */}
      <div style={{display:"flex",gap:4,marginBottom:20,flexWrap:"wrap"}}>
        {["upload","preview","backup","done"].map((s,i)=>(
          <div key={s} style={{display:"flex",alignItems:"center",gap:4}}>
            <div style={{width:28,height:28,borderRadius:"50%",background:step===s?C.accent:["upload","preview","backup","done"].indexOf(step)>i?"#16a34a":"#e5e7eb",color:step===s?"white":["upload","preview","backup","done"].indexOf(step)>i?"white":"#9ca3af",display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,fontWeight:700}}>{i+1}</div>
            <span style={{fontSize:11,fontWeight:step===s?700:400,color:step===s?C.accent:C.muted,textTransform:"capitalize"}}>{s==="backup"?"Backup & Apply":s}</span>
            {i<3 && <span style={{color:C.border,marginLeft:4}}>→</span>}
          </div>
        ))}
      </div>

      {step==="upload" && (
        <div>
          <div style={{...sty.card,marginBottom:12}}>
            <div style={{fontWeight:700,marginBottom:8}}>1. Upload File SAP (PEMAT format)</div>
            <p style={{fontSize:12,color:C.muted,marginBottom:10}}>Format CSV atau XLSX dengan kolom: Material, Material Description, Base Unit of Measure, Unrestricted Use Stock, Valuation Type, Harga Satuan.</p>
            <div style={{display:"flex",gap:10,alignItems:"center",flexWrap:"wrap"}}>
              <label style={{...sty.btn("primary"),cursor:"pointer"}}>
                {busy?"⏳ Memproses...":"📂 Upload File SAP (CSV/XLSX)"}
                <input type="file" accept=".csv,.xlsx" style={{display:"none"}} onChange={handleSAPFile} disabled={busy}/>
              </label>
              {sapFile && <span style={{fontSize:12,color:C.green,fontWeight:700}}>✅ {sapFile} ({sapRows.length} baris)</span>}
            </div>
          </div>
          {sapRows.length===0 && (
            <div style={{fontSize:12,color:"#92400e",background:"#fef3c7",border:"1px solid #fcd34d",borderRadius:8,padding:"8px 12px",marginBottom:8}}>
              ⚠️ Upload file SAP terlebih dahulu (langkah 1) agar tombol aktif.
            </div>
          )}
          <button style={sty.btn("primary")} disabled={sapRows.length===0||busy} onClick={buildPreview}>
            {busy ? "⏳ Memproses..." : "Lanjut → Preview Rekonsiliasi"}
          </button>
          {busy && <button style={{...sty.btn("ghost","sm"),marginLeft:8}} onClick={()=>setBusy(false)}>Reset (jika stuck)</button>}
        </div>
      )}

      {step==="preview" && previewStats && (
        <div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(160px,1fr))",gap:12,marginBottom:16}}>
            {[
              {label:"Total Baris SAP",val:previewStats.sapResult.length,color:C.accent},
              {label:"Total Qty",val:fmtNum(Math.round(previewStats.totalQty)),color:"#7c3aed"},
              {label:"Total Nilai",val:"Rp "+fmtNum(previewStats.totalNilai),color:C.green,small:true},
              {label:"Match WARNOTO",val:previewStats.sapResult.filter(r=>r.matchWarnoto).length,color:C.green},
              {label:"Baru (tidak di WARNOTO)",val:previewStats.sapResult.filter(r=>!r.matchWarnoto).length,color:"#f59e0b"},
            ].map(kpi=>(
              <div key={kpi.label} style={{...sty.card,borderTop:`3px solid ${kpi.color}`,padding:14}}>
                <div style={{fontSize:11,color:C.muted,marginBottom:4}}>{kpi.label}</div>
                <div style={{fontSize:kpi.small?13:20,fontWeight:800,color:kpi.color}}>{kpi.val}</div>
              </div>
            ))}
          </div>
          <div style={{...sty.card,marginBottom:12}}>
            <div style={{fontWeight:700,marginBottom:8}}>Distribusi Jenis Barang</div>
            <div style={{display:"flex",gap:12,flexWrap:"wrap"}}>
              {Object.entries(previewStats.byJenis).map(([j,n])=>(
                <div key={j} style={{padding:"6px 12px",borderRadius:8,background:"#f9fafb",border:`1px solid ${C.border}`,fontSize:12}}>
                  <strong>{j}:</strong> {n} item
                </div>
              ))}
            </div>
          </div>
          <div style={{...sty.card,padding:0,overflowX:"auto",marginBottom:16,maxHeight:350,overflowY:"auto"}}>
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:11,minWidth:700}}>
              <thead style={{background:"#003087",color:"white",position:"sticky",top:0}}>
                <tr>
                  {["No Katalog","Deskripsi","Jenis","Qty","Harga","Match WARNOTO","Match MARA"].map(h=>(
                    <th key={h} style={{padding:"7px 8px",textAlign:"left",whiteSpace:"nowrap"}}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {previewStats.sapResult.slice(0,200).map((r,i)=>(
                  <tr key={i} style={{borderBottom:`1px solid ${C.border}`,background:!r.matchWarnoto?"#fefce8":"white"}}>
                    <td style={{padding:"5px 8px",fontWeight:700,color:"#0098da"}}>{r.noKat}</td>
                    <td style={{padding:"5px 8px",maxWidth:200,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{r.desc}</td>
                    <td style={{padding:"5px 8px",fontSize:10}}>{r.jenisBarang}</td>
                    <td style={{padding:"5px 8px",textAlign:"right"}}>{r.qty}</td>
                    <td style={{padding:"5px 8px",textAlign:"right"}}>{r.harga?fmtNum(r.harga):"-"}</td>
                    <td style={{padding:"5px 8px",textAlign:"center"}}>{r.matchWarnoto?"✅":"🆕"}</td>
                    <td style={{padding:"5px 8px",textAlign:"center"}}>{r.matchMara?"✅":"-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{display:"flex",gap:8}}>
            <button style={sty.btn("ghost")} onClick={()=>setStep("upload")}>← Kembali</button>
            <button style={sty.btn("primary")} onClick={()=>setStep("backup")}>Lanjut → Backup & Apply</button>
          </div>
        </div>
      )}

      {step==="backup" && (
        <div style={{...sty.card}}>
          <div style={{fontWeight:700,fontSize:16,marginBottom:12}}>⚠️ Konfirmasi Backup & Apply Cutover</div>
          <div style={{background:"#fef9c3",border:"1px solid #fbbf24",borderRadius:8,padding:14,marginBottom:16,fontSize:13}}>
            <strong>Tindakan ini akan:</strong>
            <ul style={{marginTop:8,paddingLeft:20,lineHeight:1.8}}>
              <li>Mendownload backup JSON lengkap data sebelum cutover</li>
              <li>Mengganti Master Katalog ({katalogList.length} → {sapRows.length} katalog)</li>
              <li>Mengganti Data Stok dengan data dari SAP</li>
              <li>Mengosongkan transaksi TUG test lama (disimpan ke histori migrasi)</li>
              <li>Data yang di-replace <strong>tidak bisa di-undo</strong> kecuali restore dari backup</li>
            </ul>
          </div>
          <div style={{display:"flex",gap:10}}>
            <button style={{...sty.btn("danger"),opacity:busy?0.6:1}} onClick={handleBackupAndApply} disabled={busy}>
              {busy?"⏳ Memproses...":"📥 Download Backup & Apply Cutover"}
            </button>
            <button style={sty.btn("ghost")} onClick={()=>setStep("preview")} disabled={busy}>← Batal</button>
          </div>
        </div>
      )}

      {step==="done" && (
        <div style={{...sty.card,textAlign:"center",padding:40}}>
          <div style={{fontSize:40,marginBottom:12}}>✅</div>
          <div style={{fontWeight:800,fontSize:18,marginBottom:8,color:C.green}}>Cutover Berhasil!</div>
          <div style={{fontSize:13,color:C.muted,marginBottom:20}}>Data stok dan katalog sudah diganti dengan data SAP. Histori TUG lama tersimpan di "Migrasi TUG-15".</div>
          <div style={{display:"flex",gap:10,justifyContent:"center"}}>
            <button style={sty.btn("primary")} onClick={()=>setStep("upload")}>Lakukan Migrasi Lagi</button>
          </div>
        </div>
      )}

      {/* Riwayat migrasi TUG-15 */}
      {migratedTug15History.length > 0 && (
        <div style={{...sty.card,marginTop:16}}>
          <div style={{fontWeight:700,marginBottom:8}}>📋 Histori TUG-15 Migrasi ({migratedTug15History.length} transaksi)</div>
          <p style={{fontSize:12,color:C.muted,marginBottom:8}}>Data histori dari sebelum cutover — tampil di TUG-15 dengan badge "MIGRASI", tidak mempengaruhi stok aktif.</p>
          <div style={{maxHeight:200,overflowY:"auto"}}>
            {migratedTug15History.slice(0,20).map((t,i)=>(
              <div key={i} style={{padding:"6px 0",borderBottom:`1px solid ${C.border}`,fontSize:11,display:"flex",gap:12}}>
                <span style={{fontWeight:700,color:C.accent}}>{t.id}</span>
                <span style={{color:C.muted}}>{t.docType} — {fmtDateOnly(t.createdAt)}</span>
                <span style={{padding:"1px 6px",borderRadius:4,background:"#f3f4f6",fontSize:10}}>MIGRASI</span>
              </div>
            ))}
            {migratedTug15History.length > 20 && <div style={{padding:8,color:C.muted,fontSize:11,textAlign:"center"}}>...dan {migratedTug15History.length-20} transaksi lainnya</div>}
          </div>
        </div>
      )}
    </div>
  );
}

function KartuGantungModal({ katalog, stocks, txns, lokasiList, sty, C, onClose }) {
  const [view, setView] = useState("riwayat"); // "riwayat" | "label"
  const history = buildKartuGantungHistory(katalog, txns, stocks, lokasiList);
  const lokasiTerkait = [...new Set(stocks.filter(s=>s.katalogId===katalog.id).map(s=>s.lokasiId))].map(lid=>lokasiList.find(l=>l.id===lid)?.kode).filter(Boolean);
  const dominantJenis = stocks.find(s=>s.katalogId===katalog.id)?.jenisBarang || "Persediaan";
  const accent = jenisBarangAccentColor(dominantJenis);
  const sampleFoto = stocks.find(s=>s.katalogId===katalog.id && s.img)?.img || null;

  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.6)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1500,padding:20}}>
      <div style={{...sty.card,width:560,maxHeight:"92vh",overflowY:"auto"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:10}}>
          <div>
            <h3 style={{fontSize:17,fontWeight:800}}>🏷️ Kartu Gantung Digital — TUG.2</h3>
            <p style={{fontSize:12,color:C.muted}}>No. Katalog: {katalog.katalog||"-"}</p>
            <div style={{display:"flex",gap:6,marginTop:4}}>
              <span style={{padding:"2px 8px",borderRadius:20,fontSize:10,fontWeight:700,background:"#f3f4f6",color:"#374151"}}>{dominantJenis}</span>
              {(()=>{const bs=getSAPBadgeStyle(katalog.katalog);return <span style={{padding:"2px 8px",borderRadius:20,fontSize:10,fontWeight:700,background:bs.bg,color:bs.fg}}>{getSAPLabel(katalog.katalog)}</span>;})()}
            </div>
          </div>
          <button style={{background:"#dc2626",color:"white",border:"none",borderRadius:8,padding:"6px 14px",cursor:"pointer",fontSize:12,fontWeight:600}} onClick={onClose}>✕ Tutup</button>
        </div>

        <div style={{display:"flex",gap:8,marginBottom:14}}>
          {[{id:"riwayat",label:"📋 Riwayat Keluar-Masuk"},{id:"label",label:"🏷️ Label QR Print"}].map(v=>(
            <button key={v.id} style={{padding:"6px 14px",borderRadius:20,border:`1px solid ${view===v.id?C.accent:C.border}`,background:view===v.id?C.accent:"white",color:view===v.id?"white":C.muted,fontSize:12,cursor:"pointer",fontWeight:view===v.id?700:400}} onClick={()=>setView(v.id)}>{v.label}</button>
          ))}
        </div>

        {view==="riwayat" && (
          <div>
            <div style={{background:"#f9fafb",border:`1px solid ${C.border}`,borderRadius:8,padding:10,marginBottom:14}}>
              <div style={{fontWeight:800,fontSize:14,marginBottom:4}}>{katalog.name}</div>
              <div style={{fontSize:11,color:C.muted}}>Satuan: {katalog.satuan} • Lokasi: {lokasiTerkait.length>0?lokasiTerkait.join(", "):"Belum ada"}</div>
            </div>
            <div style={{overflowX:"auto"}}>
              <table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
                <thead>
                  <tr style={{background:"#003087",color:"white"}}>
                    <th style={{padding:"6px 8px",textAlign:"left"}}>TGL</th>
                    <th style={{padding:"6px 8px",textAlign:"left"}}>NO. BON</th>
                    <th style={{padding:"6px 8px",textAlign:"center"}}>MASUK</th>
                    <th style={{padding:"6px 8px",textAlign:"center"}}>KELUAR</th>
                    <th style={{padding:"6px 8px",textAlign:"center"}}>SISA</th>
                    <th style={{padding:"6px 8px",textAlign:"left"}}>RAK</th>
                    <th style={{padding:"6px 8px",textAlign:"left"}}>CATATAN</th>
                  </tr>
                </thead>
                <tbody>
                  {history.length===0 && <tr><td colSpan={7} style={{padding:14,textAlign:"center",color:C.muted}}>Belum ada riwayat transaksi untuk barang ini.</td></tr>}
                  {history.map((h,idx)=>(
                    <tr key={idx} style={{borderBottom:`1px solid ${C.border}`}}>
                      <td style={{padding:"5px 8px"}}>{fmtDate(h.tgl)}</td>
                      <td style={{padding:"5px 8px"}}>{h.noBon||"-"}</td>
                      <td style={{padding:"5px 8px",textAlign:"center",color:C.green,fontWeight:700}}>{h.masuk>0?fmtNum(h.masuk):""}</td>
                      <td style={{padding:"5px 8px",textAlign:"center",color:C.red,fontWeight:700}}>{h.keluar>0?fmtNum(h.keluar):""}</td>
                      <td style={{padding:"5px 8px",textAlign:"center",fontWeight:700}}>{fmtNum(h.sisa)}</td>
                      <td style={{padding:"5px 8px"}}>{h.lokasi}</td>
                      <td style={{padding:"5px 8px",color:C.muted}}>{h.catatan}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {view==="label" && (()=>{
          const scanUrl = `${window.location.origin}/?scan=${encodeURIComponent(katalog.id)}`;
          const qrImgUrl = `https://api.qrserver.com/v1/create-qr-code/?size=280x280&data=${encodeURIComponent(scanUrl)}`;
          return (
            <div style={{display:"flex",flexDirection:"column",alignItems:"center"}}>
              <div style={{border:`3px solid ${accent}`,borderRadius:10,padding:16,background:"white",width:260,textAlign:"center",marginBottom:16}}>
                <img src={qrImgUrl} alt="QR Scan TUG-2" width={140} height={140} style={{display:"block",margin:"0 auto"}}/>
                <div style={{fontSize:12,fontWeight:800,marginTop:10,lineHeight:1.3}}>{katalog.name}</div>
                <div style={{fontSize:10,color:C.muted,marginTop:4}}>No. Katalog: {katalog.katalog||"-"}</div>
                <span style={{display:"inline-block",marginTop:8,padding:"3px 10px",borderRadius:20,fontSize:10,fontWeight:700,background:accent,color:dominantJenis==="Pre Memory"?"#111":"white",border:dominantJenis==="Pre Memory"?`1px solid #d1d5db`:"none"}}>{dominantJenis}</span>
              </div>
              <div style={{fontSize:11,color:C.muted,textAlign:"center",marginBottom:14,maxWidth:320}}>
                Scan QR ini dari HP (lewat kamera/aplikasi browser) untuk melihat riwayat TUG-2 material ini — tanpa perlu login. Label bisa di-screenshot untuk diprint dan ditempel di material.
              </div>
              <div style={{fontSize:11,color:"#0369a1",background:"#f0f9ff",border:`1px solid #bae6fd`,borderRadius:8,padding:"8px 10px",maxWidth:340,textAlign:"center",wordBreak:"break-all"}}>
                🔗 {scanUrl}
              </div>
            </div>
          );
        })()}
      </div>
    </div>
  );
}

// ─── TUG-5 TAB COMPONENT ─────────────────────────────────────────────────
function TUG5Tab({ txns, filterStatus, users, sty, C, currentUser, katalogList, uitList, uptList,
  approveTUG5_Asman, rejectTUG5_Asman, approveTUG5_Manager, rejectTUG5_Manager,
  submitTUG7_AdminUIT, approveTUG7_MgrLogistik, rejectTUG7_MgrLogistik,
  konfirmasiDraftTUG8, setDocPreview,
  ultgList, approveTUG5_MgrULTG, rejectTUG5_MgrULTG, adoptTUG5ULTG, openDraftTug9 }) {
  const [rejectingId, setRejectingId] = useState(null);
  const [reason, setReason] = useState("");
  const [tug7Modal, setTug7Modal] = useState(null);
  const [tug7Form, setTug7Form] = useState({});
  const [ultgExpandedId, setUltgExpandedId] = useState(null); // id TUG-5 ULTG yang sedang dibuka penuh
  const [ultgListPage, setUltgListPage] = useState(0); // 5 per halaman

  // Show TUG-5 + TUG-7 drafts + TUG-8 drafts (from TUG-7) all in one view
  const tug5Txns = txns.filter(t=>t.docType==="TUG5"&&!t.docSubType&&t.sourceType!=="ULTG");
  const tug5UltgTxns = txns.filter(t=>t.docType==="TUG5"&&t.sourceType==="ULTG").sort((a,b)=>(b.createdAt||0)-(a.createdAt||0));
  const tug7Txns = txns.filter(t=>t.docType==="TUG7");
  const tug8Drafts = txns.filter(t=>t.docType==="TUG8"&&t.stage==="DRAFT_TUG8");

  // Pool pengajuan ULTG yang sudah disetujui Manager ULTG, siap di-adopt Admin/TL UPT induknya.
  // currentUser.uptId biasanya kosong untuk akun ADMIN/TL biasa — fallback cocokkan nama UPT
  // konstan global ke Master UPT (sama seperti pola appUptShort di komponen lain).
  const appUptShort5 = (typeof UPT !== "undefined" ? UPT : "").replace(/^UPT\s+/i,"").trim();
  const currentUserUptId = currentUser?.uptId
    || (ultgList||[]).find(u=>u.id===currentUser?.ultgId)?.parentUptId
    || (uptList||[]).find(u=>String(u.nama||"").toUpperCase().includes(appUptShort5.toUpperCase()))?.id;
  const ultgPoolAdopt = ["ADMIN","TL"].includes(currentUser?.role) ? tug5UltgTxns.filter(t =>
    t.stage==="APPROVED_ULTG" && !t.adoptedBy &&
    (ultgList||[]).find(u=>u.id===t.ultgId)?.parentUptId === currentUserUptId
  ) : [];

  function stageBadge5(t) {
    const map = {
      PENDING_ASMAN:{label:"Menunggu Asman",bg:"#fef3c7",fg:"#92400e"},
      PENDING_MANAGER:{label:"Menunggu Manager",bg:"#fef3c7",fg:"#92400e"},
      PENDING_MGR_ULTG:{label:"Menunggu Manager ULTG",bg:"#fef3c7",fg:"#92400e"},
      APPROVED_ULTG:{label:t.adoptedBy?"Sudah Diadopsi":"Siap Diadopsi UPT",bg:t.adoptedBy?"#dcfce7":"#e0f2fe",fg:t.adoptedBy?"#166534":"#0369a1"},
      APPROVED:{label:"APPROVED",bg:"#dcfce7",fg:"#166534"},
      REJECTED:{label:"DITOLAK",bg:"#fee2e2",fg:"#991b1b"},
    };
    const m = map[t.stage]||{label:t.stage,bg:"#f3f4f6",fg:"#6b7280"};
    return <span style={{padding:"3px 10px",borderRadius:20,fontSize:11,fontWeight:700,background:m.bg,color:m.fg}}>{m.label}</span>;
  }

  return (
    <div style={{display:"flex",flexDirection:"column",gap:12}}>
      {/* TUG-5 Permintaan UPT — disembunyikan untuk role ULTG (tidak relevan bagi mereka) */}
      {!["ADMIN_ULTG","MGR_ULTG"].includes(currentUser.role) && (
      <>
      <div style={{fontSize:13,fontWeight:800,color:C.accent,borderBottom:`1px solid ${C.border}`,paddingBottom:6,marginBottom:4}}>📋 TUG-5 — Permintaan Barang UPT</div>
      {tug5Txns.length===0 && <div style={{...sty.card,textAlign:"center",color:C.muted,padding:20}}>Belum ada TUG-5.</div>}
      {tug5Txns.map(t=>{
        const uit = uitList.find(u=>u.id===t.uitId);
        const creator = users.find(u=>u.id===t.createdBy)||{};
        return (
          <div key={t.id} style={{...sty.card}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:8}}>
              <div>
                <div style={{fontWeight:800,fontSize:14}}>{t.docNumbers?.tug5}</div>
                <div style={{fontSize:11,color:C.muted}}>Kepada: {uit?.kode||"-"} • {t.jenisTransfer} • {fmtDate(t.createdAt)}</div>
                <div style={{fontSize:11,color:C.muted}}>👷 {creator.name} • {t.keteranganUmum||"-"}</div>
              </div>
              {stageBadge5(t)}
            </div>
            <div style={{background:"#f9fafb",borderRadius:8,padding:8,marginBottom:8}}>
              {(t.stockItems||[]).map((si,idx)=>{
                const kat = katalogList.find(k=>k.id===si.katalogId);
                return <div key={idx} style={{fontSize:12,padding:"3px 0"}}>📦 {kat?.name||"-"} <b>Permintaan: {si.permintaan}</b> {kat?.satuan} {si.keterangan&&<span style={{color:C.muted}}>— {si.keterangan}</span>}</div>;
              })}
            </div>
            {t.status==="REJECTED" && <div style={{fontSize:11,color:C.red,marginBottom:8}}>❌ {t.rejectReason}</div>}
            {rejectingId===t.id && <div style={{marginBottom:8}}><input style={sty.input} placeholder="Alasan penolakan..." value={reason} onChange={e=>setReason(e.target.value)}/></div>}
            <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
              {t.stage==="PENDING_ASMAN" && currentUser.role==="ASMAN" && (
                rejectingId===t.id
                  ? <><button style={sty.btn("danger","sm")} onClick={()=>{rejectTUG5_Asman(t,reason);setRejectingId(null);setReason("");}}>Konfirmasi Tolak</button><button style={sty.btn("ghost","sm")} onClick={()=>setRejectingId(null)}>Batal</button></>
                  : <><button style={sty.btn("success","sm")} onClick={()=>approveTUG5_Asman(t)}>✅ Setujui (Asman)</button><button style={{...sty.btn("ghost","sm"),border:`1px solid ${C.red}`,color:C.red}} onClick={()=>{setRejectingId(t.id);setReason("");}}>❌ Tolak</button></>
              )}
              {t.stage==="PENDING_MANAGER" && currentUser.role==="MANAGER" && (
                rejectingId===t.id
                  ? <><button style={sty.btn("danger","sm")} onClick={()=>{rejectTUG5_Manager(t,reason);setRejectingId(null);setReason("");}}>Konfirmasi Tolak</button><button style={sty.btn("ghost","sm")} onClick={()=>setRejectingId(null)}>Batal</button></>
                  : <><button style={sty.btn("success","sm")} onClick={()=>approveTUG5_Manager(t)}>✅ Setujui (Manager) → Generate {t.jenisTransfer==="INTRACOMPANY"?"TUG-7":"TUG-5 UIT"}</button><button style={{...sty.btn("ghost","sm"),border:`1px solid ${C.red}`,color:C.red}} onClick={()=>{setRejectingId(t.id);setReason("");}}>❌ Tolak</button></>
              )}
              {t.stage==="APPROVED" && <button style={sty.btn("ghost","sm")} onClick={()=>setDocPreview(t)}>📄 Lihat Dokumen TUG-5</button>}
            </div>
          </div>
        );
      })}
      </>
      )}

      {/* TUG-5 dari ULTG */}
      {(["ADMIN_ULTG","MGR_ULTG","ADMIN","TL"].includes(currentUser.role)) && (
        <>
          <div style={{fontSize:13,fontWeight:800,color:"#0369a1",borderBottom:`1px solid ${C.border}`,paddingBottom:6,marginTop:8,marginBottom:4}}>🏘️ TUG-5 — Permintaan Material dari ULTG</div>
          {tug5UltgTxns.length===0 && <div style={{...sty.card,textAlign:"center",color:C.muted,padding:20}}>Belum ada TUG-5 dari ULTG.</div>}
          {tug5UltgTxns.slice(ultgListPage*5, ultgListPage*5+5).map(t=>{
            const ultg = (ultgList||[]).find(u=>u.id===t.ultgId);
            const creator = users.find(u=>u.id===t.createdBy)||{};
            const canApprove = t.stage==="PENDING_MGR_ULTG" && currentUser.role==="MGR_ULTG" && t.ultgId===currentUser.ultgId;
            const canAdopt = t.stage==="APPROVED_ULTG" && !t.adoptedBy && ["ADMIN","TL"].includes(currentUser.role) &&
              ultg?.parentUptId === currentUserUptId;
            const isExpanded = ultgExpandedId===t.id;

            if (!isExpanded) {
              return (
                <div key={t.id} style={{display:"flex",alignItems:"center",gap:10,border:`1px solid ${C.border}`,borderLeft:"3px solid #0369a1",borderRadius:8,padding:"8px 12px",marginBottom:6,background:"white",cursor:"pointer"}} onClick={()=>setUltgExpandedId(t.id)}>
                  <span style={{fontWeight:700,fontSize:12}}>{t.docNumbers?.tug5}</span>
                  <span style={{fontSize:11,color:C.muted,flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{ultg?.nama||t.ultgId} • {t.namaPekerjaan||t.keteranganUmum||"-"} • {fmtDate(t.createdAt)}</span>
                  {stageBadge5(t)}
                  {canAdopt && <span style={{fontSize:10,fontWeight:700,color:"#0369a1"}}>👉 Siap Diadopsi</span>}
                </div>
              );
            }

            return (
              <div key={t.id} style={{...sty.card,borderLeft:"3px solid #0369a1"}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:8}}>
                  <div>
                    <div style={{fontWeight:800,fontSize:14}}>{t.docNumbers?.tug5}</div>
                    <div style={{fontSize:11,color:C.muted}}>Dari: {ultg?.nama||t.ultgId} • {fmtDate(t.createdAt)}</div>
                    <div style={{fontSize:11,color:C.muted}}>👤 {creator.name} • {t.namaPekerjaan||t.keteranganUmum||"-"}</div>
                  </div>
                  <div style={{display:"flex",alignItems:"center",gap:8}}>
                    {stageBadge5(t)}
                    <button type="button" style={{...sty.btn("ghost","sm"),padding:"3px 8px"}} onClick={()=>setUltgExpandedId(null)}>▲ Tutup</button>
                  </div>
                </div>
                <div style={{background:"#f9fafb",borderRadius:8,padding:8,marginBottom:8}}>
                  {(t.stockItems||[]).map((si,idx)=>{
                    const kat = katalogList.find(k=>k.id===si.katalogId);
                    return <div key={idx} style={{fontSize:12,padding:"3px 0"}}>📦 {kat?.name||"-"} <b>Permintaan: {si.permintaan}</b> {kat?.satuan} {si.keterangan&&<span style={{color:C.muted}}>— {si.keterangan}</span>}</div>;
                  })}
                </div>
                {t.status==="REJECTED" && <div style={{fontSize:11,color:C.red,marginBottom:8}}>❌ {t.rejectReason}</div>}
                {t.adoptedBy && <div style={{fontSize:11,color:C.green,marginBottom:8}}>✅ Sudah diadopsi, jadi draft TUG-9</div>}
                {rejectingId===t.id && <div style={{marginBottom:8}}><input style={sty.input} placeholder="Alasan penolakan..." value={reason} onChange={e=>setReason(e.target.value)}/></div>}
                <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                  {canApprove && (
                    rejectingId===t.id
                      ? <><button style={sty.btn("danger","sm")} onClick={()=>{rejectTUG5_MgrULTG(t,reason);setRejectingId(null);setReason("");}}>Konfirmasi Tolak</button><button style={sty.btn("ghost","sm")} onClick={()=>setRejectingId(null)}>Batal</button></>
                      : <><button style={sty.btn("success","sm")} onClick={()=>approveTUG5_MgrULTG(t)}>✅ Setujui (Manager ULTG)</button><button style={{...sty.btn("ghost","sm"),border:`1px solid ${C.red}`,color:C.red}} onClick={()=>{setRejectingId(t.id);setReason("");}}>❌ Tolak</button></>
                  )}
                  {canAdopt && (
                    <button style={sty.btn("primary","sm")} onClick={async()=>{ const draft = await adoptTUG5ULTG(t); if(draft) openDraftTug9(draft); }}>📋 Adopt → Buat Draft TUG-9</button>
                  )}
                  {(t.stage==="APPROVED_ULTG"||t.status==="APPROVED") && <button style={sty.btn("ghost","sm")} onClick={()=>setDocPreview(t)}>📄 Lihat Dokumen TUG-5</button>}
                </div>
              </div>
            );
          })}
          {tug5UltgTxns.length>5 && (
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginTop:4,marginBottom:8}}>
              <button type="button" style={sty.btn("ghost","sm")} disabled={ultgListPage===0} onClick={()=>setUltgListPage(p=>Math.max(0,p-1))}>← Sebelumnya</button>
              <span style={{fontSize:11,color:C.muted}}>Halaman {ultgListPage+1} dari {Math.ceil(tug5UltgTxns.length/5)}</span>
              <button type="button" style={sty.btn("ghost","sm")} disabled={(ultgListPage+1)*5>=tug5UltgTxns.length} onClick={()=>setUltgListPage(p=>p+1)}>Selanjutnya →</button>
            </div>
          )}
        </>
      )}

      {/* TUG-7 Perintah Penyerahan (UIT) */}
      {(["ADMIN_UIT","MGR_LOGISTIK_UIT","ADMIN","TL","ASMAN","MANAGER"].includes(currentUser.role)) && (
        <>
          <div style={{fontSize:13,fontWeight:800,color:"#7c3aed",borderBottom:`1px solid ${C.border}`,paddingBottom:6,marginTop:8,marginBottom:4}}>🏢 TUG-7 — Perintah Penyerahan Barang (Level UIT)</div>
          {tug7Txns.length===0 && <div style={{...sty.card,textAlign:"center",color:C.muted,padding:20}}>Belum ada TUG-7.</div>}
          {tug7Txns.map(t=>{
            const uptPengirim = uptList.find(u=>u.id===t.uptPengirimId);
            const tug5Ref = txns.find(x=>x.id===t.tug5Id);
            return (
              <div key={t.id} style={{...sty.card,borderLeft:`3px solid #7c3aed`}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:8}}>
                  <div>
                    <div style={{fontWeight:800,fontSize:14}}>{t.docNumbers?.tug7||t.id}</div>
                    <div style={{fontSize:11,color:C.muted}}>Ref TUG-5: {tug5Ref?.docNumbers?.tug5||t.tug5DocNo||"-"}</div>
                    <div style={{fontSize:11,color:C.muted}}>UPT Pengirim: {uptPengirim?.nama||"Belum ditentukan"} • Penerima: {t.unitPenerima}</div>
                  </div>
                  <span style={{padding:"3px 10px",borderRadius:20,fontSize:11,fontWeight:700,background:t.stage==="APPROVED"?"#dcfce7":t.stage==="DRAFT_UIT"?"#f3e8ff":"#fef3c7",color:t.stage==="APPROVED"?"#166534":t.stage==="DRAFT_UIT"?"#7c3aed":"#92400e"}}>
                    {t.stage==="DRAFT_UIT"?"Draft (Perlu dilengkapi Admin UIT)":t.stage==="PENDING_MGR_LOGISTIK"?"Menunggu Mgr Logistik":t.stage==="APPROVED"?"APPROVED":"DITOLAK"}
                  </span>
                </div>
                <div style={{background:"#f9fafb",borderRadius:8,padding:8,marginBottom:8}}>
                  {(t.stockItems||[]).map((si,idx)=>{
                    const kat = katalogList.find(k=>k.id===si.katalogId);
                    return <div key={idx} style={{fontSize:12,padding:"3px 0"}}>📦 {kat?.name||"-"} <b>x{si.qty||si.permintaan}</b> {kat?.satuan}</div>;
                  })}
                </div>
                {rejectingId===t.id && <div style={{marginBottom:8}}><input style={sty.input} placeholder="Alasan penolakan..." value={reason} onChange={e=>setReason(e.target.value)}/></div>}
                <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                  {t.stage==="DRAFT_UIT" && currentUser.role==="ADMIN_UIT" && (
                    <button style={sty.btn("primary","sm")} onClick={()=>{setTug7Form({uptPengirimId:t.uptPengirimId||"",atasBebanRekening:t.atasBebanRekening||"",perintahKerja:t.perintahKerja||"",kodeAkun:t.kodeAkun||"",fungsi:t.fungsi||""});setTug7Modal(t);}}>📝 Lengkapi TUG-7</button>
                  )}
                  {t.stage==="PENDING_MGR_LOGISTIK" && currentUser.role==="MGR_LOGISTIK_UIT" && (
                    rejectingId===t.id
                      ? <><button style={sty.btn("danger","sm")} onClick={()=>{rejectTUG7_MgrLogistik(t,reason);setRejectingId(null);setReason("");}}>Konfirmasi Tolak</button><button style={sty.btn("ghost","sm")} onClick={()=>setRejectingId(null)}>Batal</button></>
                      : <><button style={sty.btn("success","sm")} onClick={()=>approveTUG7_MgrLogistik(t)}>✅ Setujui TUG-7 → Generate Draft TUG-8</button><button style={{...sty.btn("ghost","sm"),border:`1px solid ${C.red}`,color:C.red}} onClick={()=>{setRejectingId(t.id);setReason("");}}>❌ Tolak</button></>
                  )}
                  {t.stage==="APPROVED" && <button style={sty.btn("ghost","sm")} onClick={()=>setDocPreview(t)}>📄 Lihat TUG-7</button>}
                </div>
              </div>
            );
          })}
        </>
      )}

      {/* Draft TUG-8 dari TUG-7 (perlu konfirmasi UPT Pengirim) */}
      {tug8Drafts.length>0 && (
        <>
          <div style={{fontSize:13,fontWeight:800,color:C.green,borderBottom:`1px solid ${C.border}`,paddingBottom:6,marginTop:8,marginBottom:4}}>📦 Draft TUG-8 — Perlu Konfirmasi UPT Pengirim</div>
          {tug8Drafts.map(t=>(
            <div key={t.id} style={{...sty.card,borderLeft:`3px solid ${C.green}`}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:8}}>
                <div>
                  <div style={{fontWeight:800,fontSize:14}}>{t.docNumbers?.tug8||t.id}</div>
                  <div style={{fontSize:11,color:C.muted}}>Berdasarkan: {t.noReferensiTug7} • Tujuan: {t.unitTujuan}</div>
                  <div style={{fontSize:11,color:C.muted}}>UPT Pengirim: {t.lokasiPekerjaan}</div>
                </div>
                <span style={{padding:"3px 10px",borderRadius:20,fontSize:11,fontWeight:700,background:"#dcfce7",color:"#166534"}}>DRAFT</span>
              </div>
              <div style={{background:"#f9fafb",borderRadius:8,padding:8,marginBottom:8}}>
                {(t.stockItems||[]).map((si,idx)=>{
                  const kat = katalogList.find(k=>k.id===si.katalogId);
                  return <div key={idx} style={{fontSize:12,padding:"3px 0"}}>📦 {kat?.name||"-"} <b>x{si.qty}</b> {kat?.satuan}</div>;
                })}
              </div>
              <div style={{fontSize:11,color:"#92400e",background:"#fef3c7",borderRadius:6,padding:"6px 10px",marginBottom:8}}>⚠️ Draft ini perlu dikonfirmasi oleh Admin Gudang / TL UPT Pengirim sebelum masuk antrian approval TUG-8.</div>
              {["ADMIN","TL"].includes(currentUser.role) && (
                <button style={sty.btn("success","sm")} onClick={()=>konfirmasiDraftTUG8(t)}>✅ Konfirmasi — Aktifkan TUG-8 ini</button>
              )}
            </div>
          ))}
        </>
      )}

      {/* TUG-7 lengkapi modal */}
      {tug7Modal && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1500,padding:20}}>
          <div style={{...sty.card,width:480,maxHeight:"90vh",overflowY:"auto"}}>
            <h3 style={{fontSize:18,fontWeight:800,marginBottom:6}}>Lengkapi TUG-7</h3>
            <p style={{fontSize:12,color:C.muted,marginBottom:16}}>Pilih UPT Pengirim dan lengkapi administrasi.</p>
            <div style={{marginBottom:12}}>
              <label style={sty.label}>UPT Pengirim *</label>
              <select style={sty.select} value={tug7Form.uptPengirimId||""} onChange={e=>setTug7Form(f=>({...f,uptPengirimId:e.target.value}))}>
                <option value="">-- Pilih UPT --</option>
                {uptList.filter(u=>u.uitId===tug7Modal.uitId).map(u=><option key={u.id} value={u.id}>{u.kode} — {u.nama}</option>)}
              </select>
            </div>
            <div style={{marginBottom:12}}><label style={sty.label}>Atas Beban Rekening</label><input style={sty.input} value={tug7Form.atasBebanRekening||""} onChange={e=>setTug7Form(f=>({...f,atasBebanRekening:e.target.value}))}/></div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:16}}>
              <div><label style={sty.label}>Perintah Kerja</label><input style={sty.input} value={tug7Form.perintahKerja||""} onChange={e=>setTug7Form(f=>({...f,perintahKerja:e.target.value}))}/></div>
              <div><label style={sty.label}>Kode Akun</label><input style={sty.input} value={tug7Form.kodeAkun||""} onChange={e=>setTug7Form(f=>({...f,kodeAkun:e.target.value}))}/></div>
              <div><label style={sty.label}>Fungsi</label><input style={sty.input} value={tug7Form.fungsi||""} onChange={e=>setTug7Form(f=>({...f,fungsi:e.target.value}))}/></div>
            </div>
            <div style={{display:"flex",gap:10}}>
              <button style={{...sty.btn("ghost"),flex:1}} onClick={()=>setTug7Modal(null)}>Batal</button>
              <button style={{...sty.btn("primary"),flex:2}} onClick={()=>{submitTUG7_AdminUIT(tug7Modal,tug7Form);setTug7Modal(null);}}>📋 Submit TUG-7 → Menunggu Manager Logistik</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function TUG3Tab({ txns, filterStatus, users, sty, C, currentUser, katalogList, lokasiList, timMutuList, approveTUG3_TL, rejectTUG3_TL, submitTUG4Form, approveTUG4_Manager, rejectTUG4_Manager, submitTUG3FinalLampiran, approveTUG3Final_Asman, rejectTUG3Final_Asman, handleImg, setDocPreview }) {
  const [rejectingId, setRejectingId] = useState(null);
  const [reason, setReason] = useState("");
  const [tug4Modal, setTug4Modal] = useState(null); // txn being filled
  const [tug4Form, setTug4Form] = useState({});
  const [finalModal, setFinalModal] = useState(null); // txn being finalized
  const [finalForm, setFinalForm] = useState({});

  const filtered = filterStatus==="ALL" ? txns : txns.filter(t=>t.status===filterStatus || (filterStatus==="PENDING" && t.status==="PENDING"));

  function stageBadge(stage) {
    const map = {
      PENDING_TL: { label:"Menunggu TL Logistik", bg:"#fef3c7", fg:"#92400e" },
      MENUNGGU_TUG4: { label:"Isi Form TUG-4", bg:"#dbeafe", fg:"#1e40af" },
      PENDING_MANAGER: { label:"Menunggu Manager", bg:"#fef3c7", fg:"#92400e" },
      MENUNGGU_FINAL: { label:"Lengkapi Lampiran Final", bg:"#dbeafe", fg:"#1e40af" },
      PENDING_ASMAN: { label:"Menunggu Asman Konstruksi", bg:"#fef3c7", fg:"#92400e" },
      APPROVED: { label:"APPROVED — Stok Bertambah", bg:"#dcfce7", fg:"#166534" },
      REJECTED: { label:"DITOLAK", bg:"#fee2e2", fg:"#991b1b" },
    };
    const m = map[stage] || { label:stage, bg:"#f3f4f6", fg:C.muted };
    return <span style={{padding:"3px 10px",borderRadius:20,fontSize:11,fontWeight:700,background:m.bg,color:m.fg}}>{m.label}</span>;
  }

  function openTug4Modal(txn) { setTug4Form({ timMutuId:"", lokasiPenyerahan:"", hasilPemeriksaan:"Barang Diterima Sesuai Pengadaan" }); setTug4Modal(txn); }
  function openFinalModal(txn) { setFinalForm({ fotoKendaraan:null, fotoSimKtp:null, fotoSuratJalanImg:null, fotoKontrak:null }); setFinalModal(txn); }

  return (
    <div>
      <div style={{display:"flex",flexDirection:"column",gap:10}}>
        {filtered.length===0 && <div style={{...sty.card,textAlign:"center",color:C.muted,padding:30}}>Belum ada transaksi TUG-3</div>}
        {filtered.map(t=>{
          const creator = users.find(u=>u.id===t.createdBy)||{};
          const tlUser = users.find(u=>u.id===t.approvedByTL)||{};
          const mgrUser = users.find(u=>u.id===t.approvedByManager)||{};
          const asmanUser = users.find(u=>u.id===t.approvedByAsman)||{};
          const tm = timMutuList.find(x=>x.id===t.timMutuId);
          return (
            <div key={t.id} style={{...sty.card}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:8}}>
                <div>
                  <div style={{fontWeight:800,fontSize:14}}>{t.dariSupplier}</div>
                  <div style={{fontSize:11,color:"#0098da",fontWeight:700}}>{t.docNumbers.tug3}</div>
                </div>
                {stageBadge(t.stage)}
              </div>
              <div style={{fontSize:11,color:C.muted,display:"flex",gap:16,flexWrap:"wrap",marginBottom:8}}>
                <span>📅 Diterima: {t.tanggalDiterima||"-"}</span>
                <span>🚚 {t.denganKirim}</span>
                <span>👷 Diajukan oleh {creator.name||"-"}</span>
              </div>
              <div style={{background:"#f9fafb",borderRadius:8,padding:8,marginBottom:8}}>
                {t.stockItems.map((si,idx)=>{
                  const namaBarang = si.katalogMode==="existing" ? (katalogList.find(k=>k.id===si.katalogId)?.name||"?") : si.namaBaru;
                  return <div key={idx} style={{fontSize:12,padding:"3px 0"}}>📦 {namaBarang} <b>x{si.qty}</b></div>;
                })}
              </div>

              {t.approvedByTL && <div style={{fontSize:11,color:C.green,marginBottom:4}}>✅ TUG-3 Karantina disetujui TL: {tlUser.name} • {fmtDate(t.approvedAtTL)}</div>}
              {t.approvedByManager && <div style={{fontSize:11,color:C.green,marginBottom:4}}>✅ TUG-4 disetujui Manager: {mgrUser.name} • {fmtDate(t.approvedAtManager)} {tm && `(Tim: ${tm.label})`}</div>}
              {t.approvedByAsman && <div style={{fontSize:11,color:C.green,marginBottom:4}}>✅ TUG-3 Final disetujui Asman: {asmanUser.name} • {fmtDate(t.approvedAtAsman)}</div>}
              {t.status==="REJECTED" && <div style={{fontSize:11,color:C.red,marginBottom:8}}>❌ Ditolak: {t.rejectReason}</div>}

              {rejectingId===t.id && (
                <div style={{marginBottom:10}}>
                  <input style={sty.input} placeholder="Alasan penolakan..." value={reason} onChange={e=>setReason(e.target.value)}/>
                </div>
              )}

              <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                {/* Stage 1: TL approves Karantina */}
                {t.stage==="PENDING_TL" && currentUser.role==="TL" && (
                  rejectingId===t.id ? (
                    <>
                      <button style={{...sty.btn("danger","sm")}} onClick={()=>{rejectTUG3_TL(t,reason); setRejectingId(null); setReason("");}}>Konfirmasi Tolak</button>
                      <button style={{...sty.btn("ghost","sm")}} onClick={()=>setRejectingId(null)}>Batal</button>
                    </>
                  ) : (
                    <>
                      <button style={sty.btn("success","sm")} onClick={()=>approveTUG3_TL(t)}>✅ Setujui TUG-3 Karantina</button>
                      <button style={{...sty.btn("ghost","sm"),border:`1px solid ${C.red}`,color:C.red}} onClick={()=>{setRejectingId(t.id);setReason("");}}>❌ Tolak</button>
                    </>
                  )
                )}
                {/* Stage 2a: Admin/TL fills TUG-4 form */}
                {t.stage==="MENUNGGU_TUG4" && ["ADMIN","TL"].includes(currentUser.role) && (
                  <button style={sty.btn("primary","sm")} onClick={()=>openTug4Modal(t)}>📋 Isi Form TUG-4</button>
                )}
                {/* Stage 2b: Manager approves TUG-4 */}
                {t.stage==="PENDING_MANAGER" && currentUser.role==="MANAGER" && (
                  rejectingId===t.id ? (
                    <>
                      <button style={{...sty.btn("danger","sm")}} onClick={()=>{rejectTUG4_Manager(t,reason); setRejectingId(null); setReason("");}}>Konfirmasi Tolak</button>
                      <button style={{...sty.btn("ghost","sm")}} onClick={()=>setRejectingId(null)}>Batal</button>
                    </>
                  ) : (
                    <>
                      <button style={sty.btn("success","sm")} onClick={()=>approveTUG4_Manager(t)}>✅ Setujui TUG-4</button>
                      <button style={{...sty.btn("ghost","sm"),border:`1px solid ${C.red}`,color:C.red}} onClick={()=>{setRejectingId(t.id);setReason("");}}>❌ Tolak</button>
                    </>
                  )
                )}
                {/* Stage 3a: Admin/TL completes final lampiran */}
                {t.stage==="MENUNGGU_FINAL" && ["ADMIN","TL"].includes(currentUser.role) && (
                  <button style={sty.btn("primary","sm")} onClick={()=>openFinalModal(t)}>📎 Lengkapi Lampiran Final</button>
                )}
                {/* Stage 3b: Asman approves final */}
                {t.stage==="PENDING_ASMAN" && currentUser.role==="ASMAN" && (
                  rejectingId===t.id ? (
                    <>
                      <button style={{...sty.btn("danger","sm")}} onClick={()=>{rejectTUG3Final_Asman(t,reason); setRejectingId(null); setReason("");}}>Konfirmasi Tolak</button>
                      <button style={{...sty.btn("ghost","sm")}} onClick={()=>setRejectingId(null)}>Batal</button>
                    </>
                  ) : (
                    <>
                      <button style={sty.btn("success","sm")} onClick={()=>approveTUG3Final_Asman(t)}>✅ Setujui Final (Stok Masuk)</button>
                      <button style={{...sty.btn("ghost","sm"),border:`1px solid ${C.red}`,color:C.red}} onClick={()=>{setRejectingId(t.id);setReason("");}}>❌ Tolak</button>
                    </>
                  )
                )}
                {t.stage==="APPROVED" && <button style={sty.btn("ghost","sm")} onClick={()=>setDocPreview(t)}>📄 Lihat Dokumen TUG-3</button>}
              </div>
            </div>
          );
        })}
      </div>

      {/* TUG-4 FORM MODAL */}
      {tug4Modal && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000,padding:20}}>
          <div style={{...sty.card,width:480,maxHeight:"90vh",overflowY:"auto"}}>
            <h3 style={{fontSize:18,fontWeight:800,marginBottom:6}}>Formulir TUG-4 — Pemeriksaan Mutu</h3>
            <p style={{fontSize:12,color:C.muted,marginBottom:16}}>untuk {tug4Modal.docNumbers.tug3}</p>
            <div style={{marginBottom:12}}>
              <label style={sty.label}>Paket Tim Mutu</label>
              <select style={sty.select} value={tug4Form.timMutuId||""} onChange={e=>setTug4Form(f=>({...f,timMutuId:e.target.value}))}>
                <option value="">-- Pilih Paket --</option>
                {timMutuList.map(tm=><option key={tm.id} value={tm.id}>{tm.label}</option>)}
              </select>
            </div>
            <div style={{marginBottom:12}}>
              <label style={sty.label}>Lokasi Penyerahan</label>
              <input style={sty.input} value={tug4Form.lokasiPenyerahan||""} onChange={e=>setTug4Form(f=>({...f,lokasiPenyerahan:e.target.value}))} placeholder="cth: Gudang UPT Ketintang Surabaya"/>
            </div>
            <div style={{marginBottom:16}}>
              <label style={sty.label}>Hasil Pemeriksaan</label>
              <input style={sty.input} value={tug4Form.hasilPemeriksaan||""} onChange={e=>setTug4Form(f=>({...f,hasilPemeriksaan:e.target.value}))} placeholder="Barang Diterima Sesuai Pengadaan"/>
            </div>
            <div style={{display:"flex",gap:10}}>
              <button style={{...sty.btn("ghost"),flex:1}} onClick={()=>setTug4Modal(null)}>Batal</button>
              <button style={{...sty.btn("primary"),flex:2}} onClick={()=>{submitTUG4Form(tug4Modal, tug4Form); setTug4Modal(null);}}>📋 Submit TUG-4</button>
            </div>
          </div>
        </div>
      )}

      {/* TUG-3 FINAL LAMPIRAN MODAL */}
      {finalModal && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000,padding:20}}>
          <div style={{...sty.card,width:500,maxHeight:"90vh",overflowY:"auto"}}>
            <h3 style={{fontSize:18,fontWeight:800,marginBottom:6}}>Lampiran Final TUG-3</h3>
            <p style={{fontSize:12,color:C.muted,marginBottom:16}}>untuk {finalModal.docNumbers.tug3}</p>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:14}}>
              <div>
                <label style={sty.label}>Foto Kendaraan</label>
                <input type="file" accept="image/*" capture="environment" onChange={e=>handleImg(e, img=>setFinalForm(f=>({...f,fotoKendaraan:img})))} style={{fontSize:11,color:C.muted}}/>
                {finalForm.fotoKendaraan && <img src={finalForm.fotoKendaraan} alt="kendaraan" style={{width:"100%",height:70,objectFit:"cover",borderRadius:6,marginTop:6}}/>}
              </div>
              <div>
                <label style={sty.label}>SIM / KTP</label>
                <input type="file" accept="image/*" capture="environment" onChange={e=>handleImg(e, img=>setFinalForm(f=>({...f,fotoSimKtp:img})))} style={{fontSize:11,color:C.muted}}/>
                {finalForm.fotoSimKtp && <img src={finalForm.fotoSimKtp} alt="sim ktp" style={{width:"100%",height:70,objectFit:"cover",borderRadius:6,marginTop:6}}/>}
              </div>
              <div>
                <label style={sty.label}>Surat Jalan</label>
                <input type="file" accept="image/*" capture="environment" onChange={e=>handleImg(e, img=>setFinalForm(f=>({...f,fotoSuratJalanImg:img})))} style={{fontSize:11,color:C.muted}}/>
                {finalForm.fotoSuratJalanImg && <img src={finalForm.fotoSuratJalanImg} alt="surat jalan" style={{width:"100%",height:70,objectFit:"cover",borderRadius:6,marginTop:6}}/>}
              </div>
              <div>
                <label style={sty.label}>Foto Kontrak</label>
                <input type="file" accept="image/*" capture="environment" onChange={e=>handleImg(e, img=>setFinalForm(f=>({...f,fotoKontrak:img})))} style={{fontSize:11,color:C.muted}}/>
                {finalForm.fotoKontrak && <img src={finalForm.fotoKontrak} alt="kontrak" style={{width:"100%",height:70,objectFit:"cover",borderRadius:6,marginTop:6}}/>}
              </div>
            </div>
            <div style={{display:"flex",gap:10}}>
              <button style={{...sty.btn("ghost"),flex:1}} onClick={()=>setFinalModal(null)}>Batal</button>
              <button style={{...sty.btn("primary"),flex:2}} onClick={()=>{submitTUG3FinalLampiran(finalModal, finalForm); setFinalModal(null);}}>📎 Submit Lampiran Final</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ApprovalTab({ pendingTxns, stocks, katalogList, lokasiList, users, sty, C, approveTxn, rejectTxn, currentUser, uptList, submitTUG7_AdminUIT, approveTUG7_MgrLogistik, rejectTUG7_MgrLogistik, konfirmasiDraftTUG8, gudangCapacityImports, approveCapacityImport, rejectCapacityImport, approveLokasiChange, rejectLokasiChange, ultgList, approveTUG5_MgrULTG, rejectTUG5_MgrULTG, heavyEquipmentPendingCount }) {
  const [rejectingId, setRejectingId] = useState(null);
  const [reason, setReason] = useState("");
  const [tug7Form, setTug7Form] = useState({});
  const [tug7Modal, setTug7Modal] = useState(null);
  const [rejectingCapId, setRejectingCapId] = useState(null);
  const [capReason, setCapReason] = useState("");
  const canApproveCap = ["TL","ASMAN"].includes(currentUser.role);
  const pendingCapacityImports = (gudangCapacityImports||[]).filter(i=>i.status==="PENDING_ASMAN");
  const pendingLokasiChanges = currentUser.role==="TL" ? (lokasiList||[]).filter(l=>l.status==="PENDING") : [];

  function stageLabelOf(t) {
    if (t.docType==="TUG5") return t.stage==="PENDING_ASMAN"?"Menunggu Asman":"Menunggu Manager";
    if (t.docType==="TUG7") return t.stage==="DRAFT_UIT"?"Draft — Perlu dilengkapi Admin UIT":"Menunggu Mgr Logistik UIT";
    if (t.docType==="TUG8" && t.stage==="DRAFT_TUG8") return "Draft TUG-8 — Perlu Konfirmasi";
    if (t.docType==="TUG3") {
      if (t.stage==="PENDING_TL") return "Menunggu TL Logistik";
      if (t.stage==="PENDING_MANAGER") return "Menunggu Manager (TUG-4)";
      if (t.stage==="PENDING_ASMAN") return "Menunggu Asman Final";
    }
    return "PENDING";
  }

  function docNoOf(t) {
    if (!t.docNumbers) return t.id;
    if (t.docType==="TUG5") return t.docNumbers.tug5||t.id;
    if (t.docType==="TUG7") return t.docNumbers.tug7||t.id;
    if (t.docType==="TUG9") return t.docNumbers.tug9||t.id;
    if (t.docType==="TUG8") return t.docNumbers.tug8||t.id;
    if (t.docType==="TUG10") return t.docNumbers.tug10||t.id;
    if (t.docType==="TUG3") return t.docNumbers.tug3||t.id;
    return t.id;
  }

  function itemsOf(t) {
    if (t.docType==="TUG10") return (t.stockItems||[]).map((si,i)=>{
      const nama = si.katalogMode==="existing" ? ((katalogList||[]).find(k=>k.id===si.katalogId)?.name||"?") : si.namaBaru;
      const bs = statusMaterialBadgeStyle(si.statusMaterial);
      return <div key={i} style={{fontSize:12,padding:"3px 0"}}>📦 {nama} <b>x{si.qty}</b> <span style={{padding:"2px 6px",borderRadius:20,fontSize:10,background:bs.bg,color:bs.fg,fontWeight:700}}>{si.statusMaterial}</span></div>;
    });
    if (t.docType==="TUG5") return (t.stockItems||[]).map((si,i)=>{
      const kat = (katalogList||[]).find(k=>k.id===si.katalogId);
      return <div key={i} style={{fontSize:12,padding:"3px 0"}}>📦 {kat?.name||"-"} <b>Permintaan: {si.permintaan}</b> {kat?.satuan}</div>;
    });
    if (t.docType==="TUG7") return (t.stockItems||[]).map((si,i)=>{
      const kat = (katalogList||[]).find(k=>k.id===si.katalogId);
      return <div key={i} style={{fontSize:12,padding:"3px 0"}}>📦 {kat?.name||"-"} <b>x{si.qty||si.permintaan}</b> {kat?.satuan}</div>;
    });
    if (t.docType==="TUG3") return (t.stockItems||[]).map((si,i)=>{
      const nama = si.katalogMode==="existing" ? ((katalogList||[]).find(k=>k.id===si.katalogId)?.name||"?") : si.namaBaru;
      return <div key={i} style={{fontSize:12,padding:"3px 0"}}>📦 {nama} <b>x{si.qty}</b></div>;
    });
    return (t.stockItems||[]).map((si,i)=>{
      const stock = stocks.find(s=>s.id===si.stockId);
      return <div key={i} style={{fontSize:12,padding:"3px 0"}}>📦 {stock?.name||"?"} <b>x{si.qty}</b> {stock?.unit}</div>;
    });
  }

  return (
    <div>
      <div style={{marginBottom:16}}>
        <h1 style={{fontSize:22,fontWeight:900}}>Approval</h1>
        <p style={{color:C.muted,fontSize:13}}>{pendingTxns.length + pendingCapacityImports.length + pendingLokasiChanges.length + (heavyEquipmentPendingCount||0)} item menunggu persetujuan atau tindakan kamu ({ROLES[currentUser.role]})</p>
      </div>

      {pendingTxns.length===0 && pendingCapacityImports.length===0 && pendingLokasiChanges.length===0 && !(heavyEquipmentPendingCount>0) ? (
        <div style={{...sty.card,textAlign:"center",padding:40}}>
          <div style={{fontSize:48,marginBottom:12}}>✅</div>
          <div style={{fontSize:16,fontWeight:700}}>Semua sudah diproses</div>
        </div>
      ) : pendingTxns.map(t=>{
        const creator = users.find(u=>u.id===t.createdBy)||{};
        const isTUG8Draft = t.docType==="TUG8" && t.stage==="DRAFT_TUG8";
        const isTUG7Draft = t.docType==="TUG7" && t.stage==="DRAFT_UIT";
        const isTUG10 = t.docType==="TUG10";
        const stageColor = isTUG7Draft||isTUG8Draft?"#7c3aed":C.yellow;
        return (
          <div key={t.id} style={{...sty.card,marginBottom:12,borderLeft:`4px solid ${stageColor}`}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:8}}>
              <div>
                <div style={{fontSize:11,color:stageColor,fontWeight:800,textTransform:"uppercase"}}>{t.docType.replace("TUG","TUG-")} — {stageLabelOf(t)}</div>
                <div style={{fontSize:15,fontWeight:800}}>{t.namaPekerjaan||t.keteranganUmum||docNoOf(t)}</div>
                <div style={{fontSize:11,color:"#0098da",fontWeight:700}}>{docNoOf(t)}</div>
                {creator.name && <div style={{fontSize:11,color:C.muted}}>Diajukan: {creator.name} ({ROLES[creator.role]}) • {fmtDate(t.createdAt)}</div>}
              </div>
              <span style={{padding:"3px 10px",borderRadius:20,fontSize:11,fontWeight:700,background:"#fef3c7",color:"#92400e"}}>
                {isTUG8Draft?"DRAFT":isTUG7Draft?"DRAFT UIT":"PENDING"}
              </span>
            </div>

            {/* Info khusus per tipe */}
            {isTUG8Draft && (
              <div style={{background:"#f3e8ff",border:`1px solid #c4b5fd`,borderRadius:6,padding:"6px 10px",fontSize:11,color:"#7c3aed",marginBottom:8}}>
                📦 Draft TUG-8 dari TUG-7 {t.noReferensiTug7} — UPT Pengirim: {t.lokasiPekerjaan}. Konfirmasi untuk aktifkan ke antrian approval TUG-8 biasa.
              </div>
            )}
            {isTUG10 && (
              <div style={{background:"#dcfce7",border:`1px solid #86efac`,borderRadius:6,padding:"6px 10px",fontSize:11,color:"#166534",marginBottom:8}}>
                ℹ️ Pengembalian material — stok akan BERTAMBAH saat disetujui.
              </div>
            )}
            {t.docType==="TUG5" && t.sourceType==="ULTG" && (
              <div style={{background:"#eff6ff",border:`1px solid #bfdbfe`,borderRadius:6,padding:"6px 10px",fontSize:11,color:"#1d4ed8",marginBottom:8}}>
                🏘️ Dari ULTG {(ultgList||[]).find(u=>u.id===t.ultgId)?.nama||t.ultgId||"-"} — setelah disetujui, siap di-adopt Admin/TL UPT induk menjadi TUG-9.
              </div>
            )}
            {t.docType==="TUG5" && t.sourceType!=="ULTG" && (
              <div style={{background:"#eff6ff",border:`1px solid #bfdbfe`,borderRadius:6,padding:"6px 10px",fontSize:11,color:"#1d4ed8",marginBottom:8}}>
                {t.jenisTransfer==="INTRACOMPANY"?"🔄 Intracompany — setelah approved akan generate draft TUG-7 di UIT":"🌐 Intercompany — setelah approved akan generate draft TUG-5 UIT"}
              </div>
            )}

            {/* Items */}
            <div style={{background:"#f9fafb",borderRadius:8,padding:8,border:`1px solid ${C.border}`,marginBottom:10}}>
              {itemsOf(t)}
            </div>

            {/* Reject reason input */}
            {rejectingId===t.id && (
              <div style={{marginBottom:10}}>
                <label style={sty.label}>Alasan Penolakan *</label>
                <input style={sty.input} placeholder="Jelaskan alasan..." value={reason} onChange={e=>setReason(e.target.value)}/>
              </div>
            )}

            {/* Action buttons */}
            <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
              {/* TUG-9/8/10 standard approval */}
              {["TUG9","TUG8"].includes(t.docType) && !isTUG8Draft && (
                rejectingId===t.id
                  ? <><button style={{...sty.btn("danger"),flex:1}} onClick={()=>{rejectTxn(t,reason);setRejectingId(null);setReason("");}}>❌ Konfirmasi Tolak</button><button style={{...sty.btn("ghost"),flex:1}} onClick={()=>setRejectingId(null)}>Batal</button></>
                  : <><button style={{...sty.btn("success"),flex:1}} onClick={()=>approveTxn(t)}>✅ SETUJUI</button><button style={{...sty.btn("ghost"),flex:1,border:`1px solid ${C.red}`,color:C.red}} onClick={()=>{setRejectingId(t.id);setReason("");}}>❌ TOLAK</button></>
              )}
              {t.docType==="TUG10" && (
                rejectingId===t.id
                  ? <><button style={{...sty.btn("danger"),flex:1}} onClick={()=>{rejectTxn(t,reason);setRejectingId(null);setReason("");}}>❌ Konfirmasi Tolak</button><button style={{...sty.btn("ghost"),flex:1}} onClick={()=>setRejectingId(null)}>Batal</button></>
                  : <><button style={{...sty.btn("success"),flex:1}} onClick={()=>approveTxn(t)}>✅ SETUJUI — Stok Masuk</button><button style={{...sty.btn("ghost"),flex:1,border:`1px solid ${C.red}`,color:C.red}} onClick={()=>{setRejectingId(t.id);setReason("");}}>❌ TOLAK</button></>
              )}
              {/* TUG-8 Draft dari TUG-7 */}
              {isTUG8Draft && ["ADMIN","TL"].includes(currentUser.role) && (
                <button style={{...sty.btn("success"),flex:1}} onClick={()=>konfirmasiDraftTUG8(t)}>✅ Konfirmasi Draft TUG-8 — Aktifkan</button>
              )}
              {/* TUG-7 Draft UIT */}
              {isTUG7Draft && currentUser.role==="ADMIN_UIT" && (
                <button style={{...sty.btn("primary"),flex:1}} onClick={()=>{setTug7Form({uptPengirimId:"",atasBebanRekening:"",perintahKerja:t.perintahKerja||"",kodeAkun:t.kodeAkun||"",fungsi:t.fungsi||""});setTug7Modal(t);}}>📝 Lengkapi TUG-7 (Pilih UPT Pengirim)</button>
              )}
              {t.docType==="TUG7" && t.stage==="PENDING_MGR_LOGISTIK" && currentUser.role==="MGR_LOGISTIK_UIT" && (
                rejectingId===t.id
                  ? <><button style={{...sty.btn("danger"),flex:1}} onClick={()=>{rejectTUG7_MgrLogistik(t,reason);setRejectingId(null);setReason("");}}>❌ Konfirmasi Tolak</button><button style={{...sty.btn("ghost"),flex:1}} onClick={()=>setRejectingId(null)}>Batal</button></>
                  : <><button style={{...sty.btn("success"),flex:1}} onClick={()=>approveTUG7_MgrLogistik(t)}>✅ SETUJUI TUG-7 → Generate Draft TUG-8</button><button style={{...sty.btn("ghost"),flex:1,border:`1px solid ${C.red}`,color:C.red}} onClick={()=>{setRejectingId(t.id);setReason("");}}>❌ TOLAK</button></>
              )}
              {/* TUG-5 dari ULTG — approval Manager ULTG */}
              {t.docType==="TUG5" && t.sourceType==="ULTG" && t.stage==="PENDING_MGR_ULTG" && currentUser.role==="MGR_ULTG" && (
                rejectingId===t.id
                  ? <><button style={{...sty.btn("danger"),flex:1}} onClick={()=>{rejectTUG5_MgrULTG(t,reason);setRejectingId(null);setReason("");}}>❌ Konfirmasi Tolak</button><button style={{...sty.btn("ghost"),flex:1}} onClick={()=>setRejectingId(null)}>Batal</button></>
                  : <><button style={{...sty.btn("success"),flex:1}} onClick={()=>approveTUG5_MgrULTG(t)}>✅ SETUJUI (Manager ULTG)</button><button style={{...sty.btn("ghost"),flex:1,border:`1px solid ${C.red}`,color:C.red}} onClick={()=>{setRejectingId(t.id);setReason("");}}>❌ TOLAK</button></>
              )}
            </div>
          </div>
        );
      })}

      {/* Approval Import Kapasitas Gudang — TL/Asman saja */}
      {canApproveCap && pendingCapacityImports.map(imp=>(
        <div key={imp.id} style={{...sty.card,marginBottom:12,borderLeft:"4px solid #f59e0b"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:8}}>
            <div>
              <div style={{fontSize:11,color:"#92400e",fontWeight:800,textTransform:"uppercase"}}>Kapasitas Gudang — Menunggu Approval</div>
              <div style={{fontWeight:800,fontSize:13,marginTop:2}}>{imp.sourceFile}</div>
              <div style={{fontSize:11,color:C.muted}}>Diajukan {new Date(imp.importedAt).toLocaleString("id")} oleh {imp.importedBy}</div>
            </div>
            <span style={{padding:"3px 10px",borderRadius:20,fontSize:11,fontWeight:700,background:"#fefce8",color:"#92400e"}}>⏳ Pending</span>
          </div>
          <div style={{display:"flex",gap:14,fontSize:12,marginBottom:10}}>
            <span>Total: <b>{imp.totalRows}</b></span>
            <span style={{color:C.green}}>Valid: <b>{imp.validRows}</b></span>
            <span style={{color:C.red}}>Invalid: <b>{imp.invalidRows}</b></span>
          </div>
          <div style={{overflowX:"auto",maxHeight:200,overflowY:"auto",marginBottom:10,border:`1px solid ${C.border}`,borderRadius:8}}>
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
              <thead style={{background:"#f9fafb",position:"sticky",top:0}}>
                <tr>{["UPT","Gudang","Sub Gudang","Luas Lahan","Terpakai","Status"].map(h=><th key={h} style={{padding:"6px 8px",textAlign:"left"}}>{h}</th>)}</tr>
              </thead>
              <tbody>
                {imp.records.slice(0,50).map((r,i)=>(
                  <tr key={i} style={{borderTop:`1px solid ${C.border}`}}>
                    <td style={{padding:"4px 8px"}}>{r.upt}</td>
                    <td style={{padding:"4px 8px"}}>{r.gudang}</td>
                    <td style={{padding:"4px 8px"}}>{r.subGudang}</td>
                    <td style={{padding:"4px 8px",textAlign:"right"}}>{fmtNum(Math.round(r.luasLahanM2))}</td>
                    <td style={{padding:"4px 8px",textAlign:"right"}}>{fmtNum(Math.round(r.luasTerpakaiM2))}</td>
                    <td style={{padding:"4px 8px",fontWeight:700,color:r.statusKapasitas==="KRITIS"?C.red:r.statusKapasitas==="WASPADA"?"#f59e0b":C.green}}>{r.statusKapasitas}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {imp.records.length>50 && <div style={{fontSize:10,color:C.muted,padding:6,textAlign:"center"}}>+{imp.records.length-50} baris lainnya</div>}
          </div>
          {rejectingCapId===imp.id ? (
            <div style={{display:"flex",gap:8}}>
              <input style={{...sty.input,flex:1}} placeholder="Alasan penolakan..." value={capReason} onChange={e=>setCapReason(e.target.value)}/>
              <button style={sty.btn("danger","sm")} onClick={()=>{rejectCapacityImport(imp.id, capReason); setRejectingCapId(null); setCapReason("");}}>Kirim Penolakan</button>
              <button style={sty.btn("ghost","sm")} onClick={()=>{setRejectingCapId(null);setCapReason("");}}>Batal</button>
            </div>
          ) : (
            <div style={{display:"flex",gap:8}}>
              <button style={sty.btn("success","sm")} onClick={()=>approveCapacityImport(imp.id)}>✅ Setujui & Publish</button>
              <button style={sty.btn("danger","sm")} onClick={()=>setRejectingCapId(imp.id)}>❌ Tolak</button>
            </div>
          )}
        </div>
      ))}

      {/* Approval Perubahan Lokasi/Blok — TL saja */}
      {pendingLokasiChanges.map(l=>{
        const pemohon = users.find(u=>u.id===l.requestedBy);
        const aksiLabel = {ADD:"Tambah Blok Baru",EDIT:"Ubah Data Blok",DELETE:"Hapus Blok"}[l.pendingAction]||l.pendingAction;
        return (
          <div key={l.id} style={{...sty.card,marginBottom:12,borderLeft:`4px solid ${C.yellow}`}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:10}}>
              <div>
                <div style={{fontSize:11,color:"#92400e",fontWeight:800,textTransform:"uppercase"}}>Perubahan Lokasi/Blok</div>
                <div style={{fontSize:13,fontWeight:700,marginTop:2}}>{aksiLabel}: {l.pendingAction==="EDIT"?l.pendingData?.kode:l.kode}</div>
                <div style={{fontSize:11,color:C.muted}}>Diajukan oleh {pemohon?.name||"?"} • {fmtDate(l.requestedAt)}</div>
              </div>
              <div style={{display:"flex",gap:6,flexShrink:0}}>
                <button style={sty.btn("primary","sm")} onClick={()=>approveLokasiChange(l.id)}>✓ Setuju</button>
                <button style={sty.btn("danger","sm")} onClick={()=>rejectLokasiChange(l.id)}>✕ Tolak</button>
              </div>
            </div>
          </div>
        );
      })}

      {/* TUG-7 lengkapi modal */}
      {tug7Modal && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1500,padding:20}}>
          <div style={{...sty.card,width:480,maxHeight:"90vh",overflowY:"auto"}}>
            <h3 style={{fontSize:17,fontWeight:800,marginBottom:6}}>Lengkapi TUG-7</h3>
            <p style={{fontSize:12,color:C.muted,marginBottom:14}}>Pilih UPT Pengirim dan lengkapi administrasi.</p>
            <div style={{marginBottom:12}}>
              <label style={sty.label}>UPT Pengirim *</label>
              <select style={sty.select} value={tug7Form.uptPengirimId||""} onChange={e=>setTug7Form(f=>({...f,uptPengirimId:e.target.value}))}>
                <option value="">-- Pilih UPT --</option>
                {(uptList||[]).map(u=><option key={u.id} value={u.id}>{u.kode} — {u.nama}</option>)}
              </select>
            </div>
            <div style={{marginBottom:12}}><label style={sty.label}>Atas Beban Rekening</label><input style={sty.input} value={tug7Form.atasBebanRekening||""} onChange={e=>setTug7Form(f=>({...f,atasBebanRekening:e.target.value}))}/></div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:14}}>
              <div><label style={sty.label}>Perintah Kerja</label><input style={sty.input} value={tug7Form.perintahKerja||""} onChange={e=>setTug7Form(f=>({...f,perintahKerja:e.target.value}))}/></div>
              <div><label style={sty.label}>Kode Akun</label><input style={sty.input} value={tug7Form.kodeAkun||""} onChange={e=>setTug7Form(f=>({...f,kodeAkun:e.target.value}))}/></div>
              <div><label style={sty.label}>Fungsi</label><input style={sty.input} value={tug7Form.fungsi||""} onChange={e=>setTug7Form(f=>({...f,fungsi:e.target.value}))}/></div>
            </div>
            <div style={{display:"flex",gap:10}}>
              <button style={{...sty.btn("ghost"),flex:1}} onClick={()=>setTug7Modal(null)}>Batal</button>
              <button style={{...sty.btn("primary"),flex:2}} onClick={()=>{submitTUG7_AdminUIT(tug7Modal,tug7Form);setTug7Modal(null);}}>📋 Submit → Menunggu Mgr Logistik</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
