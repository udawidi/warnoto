// PT. PLN UPT Surabaya - Gudang Ketintang
// Sistem Tata Usaha Gudang (TUG) Digital - v3.0
// TUG-9: Bon Pemakaian + Surat Jalan + BAST

import { useState, useEffect, useRef, useCallback, useMemo, useDeferredValue, Fragment } from "react";
import { X } from "@phosphor-icons/react";
import * as Sentry from "@sentry/react";
import { COMPANY, UIT, UPT, WAREHOUSE, DOC_CODE, APP_VERSION, KAPASITAS_LABEL, ROMAN, JENIS_BARANG, STATUS_RETUR_TO_JENIS } from "./src/constants.js";
import { supabase, SUPABASE_URL, SUPABASE_KEY, SUPABASE_AUTH_STORAGE_KEY, usernameToAuthEmail, describeLoginError, isRetryableLoginError } from "./src/supabaseClient.js";
import { CLOUD } from "./src/lib/cloud.js";
import { leanStocksForCache, resolveStockPhotoUrl } from "./src/lib/stockCache.js";
import { approveStockLocationMove, rejectStockLocationMove } from "./src/lib/stockLocationApproval.js";
import { applyStockRealtimeEvent, applyStockRealtimeEvents, stockListsEqual } from "./src/lib/stockRealtime.js";
import { isDemoMode, enterDemoMode, exitDemoMode } from "./src/lib/demo.js";
import { normalizeKatalogCode } from "./src/lib/normalizeKatalogCode.js";
import { expandMonthlySeriesFromMap, tsbMonthlyForecast } from "./src/lib/tsbForecast.js";
import { logAudit } from "./src/lib/audit.js";
import { C as C_LIGHT, C_DARK, makeSty } from "./src/theme.js";
import { generateDocNumbers, generateReservasiDocNo, uid, fmtDate, fmtDateOnly, fmtRp, buildStockStats, formatStockStatsText, parseSAPRowsFromCSV, parseUsulanPencocokanXLSX, parseSAPRowsFromXLSX, parseIndoNumber, mapSAPRow, parseSAPFile, terbilangHari, enrichStock, enrichStocks, dedupeById, migrateLegacyStocks } from "./src/lib/utils.js";
import { buildTUG9HTML, buildTUG10HTML, downloadTUG10HTML, buildTUG5HTML, buildTUG5ULTGHTML, buildTUG7HTML, downloadTUG5HTML, buildHeavyEquipmentLoanHTML, downloadHeavyEquipmentLoanHTML, buildBeritaAcaraHTML, downloadTUG7HTML, buildTUG3HTML, downloadTUG3HTML, downloadTUG9HTML, buildTUG2FrontHTML } from "./src/lib/docBuilders.js";
import { normalizeSearchText, expandHaystackSynonyms, queryTokenGroups, applyMaraNameSearch, matchesMaterialSearch, matchesStockSearch, matchesKatalogSearch, totalQtyForKatalog, lokasiUsedCapacity, statusMaterialBadgeStyle, getSAPStatus, getSAPBadgeStyle, jenisBarangAccentColor, buildKartuGantungHistory, normalizeKatalog, extractKatalogIdFromScan, stockSapLabel, sapBadgeStyleForLabel } from "./src/lib/sap.js";
import { ROLES, hasRole, getUserUptScope, canAccessGudang, getScopeUptIds, inScopeUpt } from "./src/lib/roles.js";
import { getVisibleGudangForInspection } from "./src/lib/inspectionScope.mjs";
import { stockScopeExtraCols, stockScopeColumnsAvailable } from "./src/lib/stockScope.js";
import { can } from "./src/lib/perms.js";
import { DEFAULT_HEAVY_EQUIPMENT, normalizeHeavyEquipmentJenis, heavyEquipmentStatusFromKondisi, normalizeHeavyEquipmentRecord, getHeavyEquipmentLoanOwnerUpt, getHeavyEquipmentLoanRequesterUpt, getHeavyEquipmentLoanStartDate, getHeavyEquipmentLoanReturnDate, getHeavyEquipmentLoanJobName, normalizeHeavyEquipmentLoanStatus, isPendingHeavyEquipmentLoan, getHeavyEquipmentLoanRuntimeStatus, canApproveHeavyEquipmentLoan, getEquipmentCategory } from "./src/lib/heavyEquipment.js";
import { ATTB_JENIS_ASET, ATTB_JENIS_ASET_LABEL, ATTB_STAGES, attbStageIndex, attbStageLabel, canApproveAttb, isPendingAttbApproval, ATTB_FIELDS_BY_JENIS, ATTB_ALASAN_PENGHAPUSBUKUAN, ATTB_WAKTU_USULAN_OPTIONS, ATTB_CORE_FIELDS, ATTB_STAGE2_FIELDS, ATTB_STAGE3_FIELDS, ATTB_STAGE4_FIELDS, ATTB_STAGE5_FIELDS, parseAttbCurrency, parseAttbMaterialFile2, parseAttbMaterialFile4 } from "./src/lib/attb.js";
import { npNorm, npTokens, npNums, NAMEPLATE_MIN, cohereEmbed, cohereEmbedImage, ocrSpaceOCR, matchNameplateToKatalog, nameplateTextSim, matchNameplateAll, buildTxnRagContent } from "./src/lib/rag.js";
import { computeForecast } from "./src/lib/forecast.js";
import { subGudangAbbr, subGudangKodeMap, getLokasiPetaInfo, extractLatLngFromAddress, loadMasterTable, syncMasterTable, syncMasterTableRows, deleteMasterTableRow, loadWarehouseCapacity, syncWarehouseCapacity, loadWarehouseCapacityImports, syncWarehouseCapacityImports } from "./src/lib/masterSync.js";
import { getDefaultMaturityAuditHistory, loadMaturityAssessments, loadMaturityAudits, loadMaturityAuditHistory, loadMaturity5SAssessments, upsertMaturityAssessments, upsertMaturityAudits } from "./src/lib/maturitySync.js";
import { Sparkline } from "./src/components/Sparkline.jsx";
import { AIFaqPanel } from "./src/components/AIFaqPanel.jsx";
import { TelegramWhitelistPanel } from "./src/components/TelegramWhitelistPanel.jsx";
import { ScanPublicView } from "./src/components/ScanPublicView.jsx";
import { KPISaldoCards } from "./src/components/KPISaldoCards.jsx";
import { PendingWidget } from "./src/components/PendingWidget.jsx";
import { RencanaWidget } from "./src/components/RencanaWidget.jsx";
import { CollapsibleSection } from "./src/components/CollapsibleSection.jsx";
import { ExecOverview } from "./src/components/ExecOverview.jsx";
import { HeavyEquipmentDashboardSummary } from "./src/components/HeavyEquipmentDashboardSummary.jsx";
import { AttbDashboardSummary } from "./src/components/AttbDashboardSummary.jsx";
import { DashboardDefault } from "./src/components/DashboardDefault.jsx";
import { DashboardAsman } from "./src/components/DashboardAsman.jsx";
import { DashboardManager } from "./src/components/DashboardManager.jsx";
import { DashboardMaturityBanner } from "./src/components/DashboardMaturityBanner.jsx";
import { StockCountTab } from "./src/components/StockCountTab.jsx";
import { RencanaKedatanganTab } from "./src/components/RencanaKedatanganTab.jsx";
import { KapasitasGudangTab } from "./src/components/KapasitasGudangTab.jsx";
import { AIAgentPage } from "./src/components/AIAgentPage.jsx";
import { AuditLogPage } from "./src/components/AuditLogPage.jsx";
import { ImportLokasiModal, downloadLokasiTemplate } from "./src/components/ImportLokasiModal.jsx";
import { PermMatrixPage } from "./src/components/PermMatrixPage.jsx";
import { HeavyEquipmentTabV2 } from "./src/components/HeavyEquipmentTabV2.jsx";
import { AttbTab } from "./src/components/AttbTab.jsx";
import { DataStokTab } from "./src/components/DataStokTab.jsx";
import { MasterDataTab } from "./src/components/MasterDataTab.jsx";
import { MaturityDashboardTab } from "./src/components/MaturityDashboardTab.jsx";
import { useMaturity } from "./src/hooks/useMaturity.jsx";
import { useTugApprovals } from "./src/hooks/useTugApprovals.js";
import { useTugTransactions } from "./src/hooks/useTugTransactions.js";
import { useStockOpname } from "./src/hooks/useStockOpname.js";
import { useApprovalHub } from "./src/hooks/useApprovalHub.js";
import { AUDIT_ASPECTS, AUDIT_CATEGORIES } from "./src/data/auditAspects.js";
import { StockOpnameTab } from "./src/components/StockOpnameTab.jsx";
import { MigrasiDataTab } from "./src/components/MigrasiDataTab.jsx";
import { KapasitasGudangImportTab } from "./src/components/KapasitasGudangImportTab.jsx";
import { BarcodePrintModal } from "./src/components/BarcodePrintModal.jsx";
import { KartuGantungModal } from "./src/components/KartuGantungModal.jsx";
import { MaterialCadangTab } from "./src/components/MaterialCadangTab.jsx";
import { InspeksiMaterialCadangTab } from "./src/components/InspeksiMaterialCadangTab.jsx";
import { ForecastStokPage } from "./src/components/ForecastStokPage.jsx";
import { ApprovalTab } from "./src/components/ApprovalTab.jsx";
import { ApprovalHubTab } from "./src/components/ApprovalHubTab.jsx";
import { AppSidebar } from "./src/components/AppSidebar.jsx";
import { SidebarNavItem } from "./src/components/SidebarNavItem.jsx";
import { SidebarIcon } from "./src/components/SidebarIcon.jsx";
import { GudangCoordConfigPanel } from "./src/components/GudangCoordConfigPanel.jsx";
import { SearchableSelect } from "./src/components/SearchableSelect.jsx";
import { SatpamModal, TimMutuModal, UitModal, UptModal, UltgModal } from "./src/components/MasterOrgModals.jsx";
import { KatalogModal, LokasiModal, GudangEditModal, GudangAddModal } from "./src/components/MasterDataModals.jsx";
import { AkunModal, GantiPasswordModal } from "./src/components/AkunModals.jsx";
import { StockEditFields, MaturityAssessmentModal, DocPreviewModal } from "./src/components/StockModals.jsx";
import { OcrSuggestGudangModal, LokasiDeleteConfirmModal, ConfirmDialogModal, PhotoSearchModal, LightboxModal, PetaMiniDetailModal, CapacityReviewModal } from "./src/components/MiscModals.jsx";
import { Tug5FormModal, Tug98FormModal, Tug10FormModal, Tug3FormModal } from "./src/components/TugFormModals.jsx";
import { BarcodeScanner } from "./src/components/BarcodeScanner.jsx";
import { DashboardRingkasanBlock } from "./src/components/DashboardRingkasanBlock.jsx";
import { DemoBannerAndToast } from "./src/components/DemoBannerAndToast.jsx";
import { AppHeaderBar } from "./src/components/AppHeaderBar.jsx";
import { DashboardTabRouter } from "./src/components/DashboardTabRouter.jsx";
import { TransactionHubTab } from "./src/components/TransactionHubTab.jsx";
import { DEFAULT_UIT } from "./src/data/masterUit.js";
import { DEFAULT_UPT_LIST } from "./src/data/masterUpt.js";
import { DEFAULT_GUDANG, DEFAULT_SATPAM } from "./src/data/masterGudang.js";
import { DEFAULT_TIM_MUTU } from "./src/data/masterTimMutu.js";
import { DEFAULT_KATALOG } from "./src/data/masterKatalog.js";
import { DEFAULT_LOKASI } from "./src/data/masterLokasi.js";
import { DEFAULT_STOCKS } from "./src/data/stokSapDefault.js";
import * as XLSX from "xlsx";
import * as pdfjsLib from "pdfjs-dist";
import pdfjsWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;
import { PLN_LOGO_DATA_URI } from "./src/assets/plnLogoBase64.js";
import { useDenahOcr } from "./src/hooks/useDenahOcr.js";
import { useHeavyEquipment } from "./src/hooks/useHeavyEquipment.js";
import { useAccountAdmin } from "./src/hooks/useAccountAdmin.js";
import { useMasterDataCrud } from "./src/hooks/useMasterDataCrud.jsx";
import { useWarehouseConfig } from "./src/hooks/useWarehouseConfig.jsx";
import { decode as olcDecode, isFull as olcIsFull, recoverNearest as olcRecoverNearest } from "./src/lib/openLocationCode.js";
import { fmtNum, buildKatalogRagContent, getKritisAgg, splitChunksForEmbed } from "./src/lib/ragShared.mjs";
import { buildMutasiRows, syncTUG15ToSupabase, syncStockQtyToSupabase, syncFotoMaterialToSupabase, processTxnPhotos, resolveTxnPrivPhotos, compressImage, _isDataUrl, uploadPhotoToStorage, _withTimeout } from "./src/lib/supabaseSync.js";
import { createAndSubmitCanonicalTug, decideCanonicalTug, loadCanonicalTugTransactions, newCanonicalActionKeys, prepareCanonicalTugReview } from "./src/lib/tugCanonical.js";
import { getHeavyEquipmentUploadErrorMessage, getHeavyEquipmentProcessingErrorMessage } from "./src/lib/heavyEquipmentPhoto.js";
import { loadMaterialInspections, loadMaterialInspectionBatches } from "./src/lib/materialInspectionSync.js";
import { getMaterialAkanHabis, buildMonthlySeriesByKatalog, computeProcurementList, getTopStockByQty, getTotalPerSatuan } from "./src/lib/analytics.js";

// Turn this on only after the reviewed self-host migration is installed. It
// makes TUG-8/9 fail closed rather than silently reverting to browser storage.
const CANONICAL_TUG_REQUIRED = import.meta.env.VITE_TUG_CANONICAL_REQUIRED !== "false";
import QRCode from "qrcode";

const STATUS_MATERIAL_RETUR = ["Material Sisa Baru", "Bongkaran", "Bongkaran ATTB (MTU)"]; // used in TUG-10 returns
// Maps a return status to the resulting Jenis Barang in Data Stok (null = leave as user's manual choice)
const CATEGORIES = ["Transformator", "Kabel", "Panel", "Meter", "Tools", "Safety", "Consumable", "Spare Part", "Struktur", "Isolator", "Lainnya"];

const ULTG_ROLES = ["ADMIN_ULTG","MGR_ULTG"]; // role dengan sidebar terbatas (view-only + TUG-5 saja)
// Kuota role per UPT untuk indikator di form Kelola Akun — validasi sebenarnya
// (hard limit) ditegakkan server-side di admin-create-user/admin-update-user.
const UPT_ROLE_QUOTA = { MANAGER: 1, ASMAN: 1, TL: 1, ADMIN: 1, PENGADAAN: 1 };
// ADMIN_LOG_PUSAT sengaja TIDAK di sini: Pusat tingkat nasional, tidak terikat satu UIT.
const UIT_ROLE_QUOTA = { ADMIN_UIT: 1, ASMAN_LOG_UIT: 1, MGR_LOGISTIK_UIT: 1, PENGADAAN: 1 };

// Who can create TUG-9 transactions

// Who can approve, and what happens
// ADMIN-created -> needs TL approve -> Asman auto-approved alongside
// TL-created     -> needs ASMAN approve -> directly APPROVED

ATTB_FIELDS_BY_JENIS.SALURAN_AIR = ATTB_FIELDS_BY_JENIS.BANGUNAN;
ATTB_FIELDS_BY_JENIS.JALAN = [...ATTB_FIELDS_BY_JENIS.BANGUNAN, {key:"hilang", label:"Hilang", type:"text"}];

// ─── DEFAULT DATA ────────────────────────────────────────────────────
// User & password TIDAK lagi disimpan di source code (lihat Supabase Auth +
// tabel "profiles" di supabase/schema.sql) — daftar user kini di-fetch dari
// Supabase setelah login, bukan array statis seperti sebelumnya.

// ─── MASTER GUDANG (bangunan gudang, parent dari Blok/Lokasi) ──────────
const MATURITY_LEVELS = { 1:"Basic", 2:"Developing", 3:"Defined", 4:"Managed", 5:"Excellent" };
// Penilaian Maturity (audit workflow) — label & warna status berjenjang.
const MATURITY_WORKFLOW_LABEL = { DRAFT:"Draft", SELF_ASSESSMENT:"Self Assessment (UPT)", REVIEW_UIT:"Review UIT", REVIEW_PUSAT:"Review Pusat", REVISION:"Revisi", FINAL:"Nilai Final (Pusat)" };
const MATURITY_WORKFLOW_COLOR = { DRAFT:"#94a3b8", SELF_ASSESSMENT:"#3b82f6", REVIEW_UIT:"#f59e0b", REVIEW_PUSAT:"#6366f1", REVISION:"#ef4444", FINAL:"#1d4ed8" };

// ─── DATA STOK dari SAP PEMAT (145 material Persediaan UPT Surabaya) ───
// Data real dari file PEMAT_04062026.csv — selalu tersedia saat aplikasi dibuka.

const now = Date.now();
const DEFAULT_TXNS = [];

// Label menu TUG dalam bahasa awam (kode TUG jadi keterangan kecil sekunder) —
// supaya staf baru/ULTG/awam tidak perlu hafal kode untuk tahu harus pilih mana.
const TUG_UI = {
  TUG3:  { title:"Terima Barang Baru",      code:"TUG-3/4", chip:"Terima Barang Baru",       buat:"Terima Barang Baru",      desc:"Barang datang dari vendor → diperiksa Tim Mutu → masuk gudang. (3 tahap: TL → Manager → Asman)" },
  TUG10: { title:"Barang Kembali / Retur",  code:"TUG-10",  chip:"Barang Kembali / Retur",   buat:"Catat Barang Kembali",    desc:"Sisa pekerjaan atau bekas bongkaran dikembalikan ke gudang." },
  TUG9:  { title:"Keluarkan / Pakai Barang",code:"TUG-9",   chip:"Pakai Barang",             buat:"Keluarkan Barang",        desc:"Ambil barang dari gudang untuk dipakai pekerjaan di unit sendiri (UPT Surabaya)." },
  TUG8:  { title:"Kirim ke Unit PLN Lain",  code:"TUG-8",   chip:"Kirim ke Unit Lain",       buat:"Kirim ke Unit Lain",      desc:"Keluarkan barang untuk dipakai unit PLN lain." },
  TUG5:  { title:"Minta Barang ke Gudang",  code:"TUG-5",   chip:"Minta Barang",             buat:"Buat Permintaan Barang",  desc:"Ajukan permintaan material — Intracompany (→TUG-7) atau Intercompany (→TUG-5 UIT)." },
  TUG15: { title:"Laporan Mutasi Stok",     code:"TUG-15",  chip:"Laporan Mutasi Stok",      buat:null,                      desc:"Riwayat mutasi stok dari semua transaksi TUG yang disetujui — filter tanggal & unduh." },
};
const TUG_GROUP_UI = {
  penerimaan:  { icon:"📥", label:"Barang Masuk",  hint:"Penerimaan barang baru & barang kembali/retur" },
  pengeluaran: { icon:"📤", label:"Barang Keluar", hint:"Pemakaian di unit sendiri & kirim ke unit PLN lain" },
  permintaan:  { icon:"📋", label:"Minta Barang",  hint:"Permintaan material ke gudang/UIT" },
  laporan:     { icon:"📊", label:"Laporan",       hint:"Riwayat mutasi stok" },
};
// Ikon pembeda per jenis TUG untuk tombol pemilih section (biar staf baru gampang bedakan).
const TUG_ICON = { TUG3:"🆕", TUG10:"↩️", TUG9:"🔧", TUG8:"🚚", TUG5:"📝", TUG15:"📊" };

// Glosarium LENGKAP singkatan & istilah material PLN (sheet PLN-Terminology, CATALOG
// MASTER.xlsx). KHUSUS untuk konteks AI (AI Agent web & Telegram bot) supaya paham
// singkatan teknis di nama material maupun pertanyaan user. SENGAJA terpisah dari
// CATEGORY_SYNONYMS: ini cuma teks yang dibaca LLM (aman memuat singkatan 1-2 huruf
// ambigu), sedangkan CATEGORY_SYNONYMS dipakai mesin pencarian yang harus tetap kurasi.
// Catatan: kalau daftar ini diubah, samakan juga salinannya di
// supabase/functions/telegram-webhook/index.ts (runtime Deno, tidak bisa impor dari sini).
const MATERIAL_GLOSSARY = `2CCT = Double Circuit (Sirkuit Ganda)
2W = 2 Wire (2 Kawat); 4W = 4 Wire (4 Kawat)
AB = Air Blast; ACC = Accessories (Aksesoris)
CABLE CTRL = Cable Control (Kabel Kontrol); CABLE PWR = Cable Power (Kabel Daya)
CAP = Capacity (Kapasitas); CARD = Modul
CB = Circuit Breaker / PMT (Pemutus Tenaga); CIRCL = Circular (Bulat/Bundar)
CLV = Connector Low Voltage; CO = Cut Out; COMB = Combo (Kombinasi)
COND = Conductor (Kawat/Konduktor); CONN = Connector; CR = Capacitor
CT = Current Transformer (Trafo Arus); CUB = Cubicle (Kubikel); DGR = Degree (Derajat)
DIFF = Differential; DIST = Distribution (Distribusi); DISTAN = Distance Relay (Rele Jarak)
DS = Disconnecting Switch / PMS (Pemisah); DT = Double Tarif; EF = Earth Fault
FLV = For Low Voltage; GIS = Gas Insulation Substation; H = Heat Shrink (Ciut Panas)
ID = Indoor (terpasang di dalam ruang/gedung); IND = Inductive; ISO = Isolated (Isolasi)
K = Konvensional; LA = Lightning Arrester (Penangkal Petir); LINE = Feeder (Jurusan)
LLC = Live Line Connector; LVSB = Low Voltage Switch Board (Papan Hubung Bagi / Rak Tegangan Rendah)
LW = Live Working (Pekerjaan Tanpa Pemadaman); M = Metering; MCB = Mini Circuit Breaker (Pembatas Arus)
MCCB = Moulded Case Circuit Breaker; M-TPD = Manual Terpadu; MTR = Meter; N = Netral
NCLBL = Non Clamp Block; OCR = Over Current Relay (Rele Arus Lebih)
OD = Outdoor (terpasang di luar ruang/gedung); OH = Over Head Line / SU (Saluran Udara)
OVR = Over Voltage Relay (Rele Tegangan Lebih); P = Phase (Fasa); PB = Plumbum
PIER = Piercing (Bergigi); PLC = Power Line Carrier; PR = Press (Compress)
PT = Potential/Voltage Transformer (Trafo Tegangan); RECL = Recloser; RTU = Remote Terminal Unit
SACO = Switch Automatic Change Over; SCLV = Single Core Low Voltage; SCMV = Single Core Medium Voltage
ST = Single Tariff (catatan: ST juga dipakai untuk UG/Saluran Tanah); STRG = Straight (Lurus); TERM = Termination
TOOL E = Tool Electronic (Perangkat Kerja Elektronik); TOOL L = Tool Laboratory (Perangkat Kerja Laboratorium)
TOOL M = Tool Mechanic (Perangkat Kerja Mekanik); TOOL S = Tool Safety (Perangkat Kerja Keselamatan)
TRF = Transformer (Trafo); UG = Under Ground / ST (Saluran Tanah/Bawah Tanah)
WAVE TRAP = Line Trap; WP = Water Proof (Kedap Air)`;

// Cache profil user di localStorage supaya layar "Memuat sesi..." tidak menunggu
// network — dipakai sebagai initial state currentUser/authLoading (lihat effect
// onAuthStateChange di bawah), profil sebenarnya tetap di-refresh dari Supabase.
const PROFILE_CACHE_KEY = "warnoto_profile_cache_v2";
const LEGACY_PROFILE_CACHE_KEY = "warnoto_profile_cache_v1";
function readCachedProfile() {
  try {
    // Hanya pakai cache bila token untuk endpoint self-host yang tepat masih ada.
    // Token sb-* lain (mis. Supabase Cloud lama) tidak pernah boleh membuka aplikasi.
    if (!localStorage.getItem(SUPABASE_AUTH_STORAGE_KEY)) return null;
    const cached = JSON.parse(localStorage.getItem(PROFILE_CACHE_KEY) || "null");
    return cached?.endpoint === SUPABASE_URL ? cached.profile || null : null;
  } catch { return null; }
}

function writeCachedProfile(profile) {
  try { localStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify({ endpoint: SUPABASE_URL, profile })); } catch {}
}

// Reader cache generik (sinkron, langsung localStorage) untuk lazy-initializer
// useState tabel-tabel Fase 1 — pola PERSIS sama seperti readCachedProfile di atas,
// supaya render pertama tampil dari cache tanpa menunggu network. Prefix 'warnoto_'
// mengikuti CLOUD di src/lib/cloud.js (di sini baca langsung getItem yang sinkron,
// bukan lewat CLOUD.get yang async).
function readCachedList(key) {
  try { return JSON.parse(localStorage.getItem('warnoto_' + key) || "null"); } catch { return null; }
}

// Salinan "lean" stocks untuk cache localStorage SAJA — buang field foto base64
// (fotoKeseluruhan/fotoNameplate bisa beberapa MB/baris) supaya tidak menembus kuota
// localStorage (~5-10MB) lalu gagal tersimpan diam-diam (QuotaExceededError yang ditelan
// CLOUD.set). State React yang dipakai UI TIDAK memakai versi ini — tetap lengkap dgn foto.
function leanStocks(list) {
  // Foto yang sudah berupa URL Storage sangat kecil (±100 byte) dan aman
  // disimpan di cache. Yang harus dibuang hanya data-URL/base64 besar agar
  // localStorage tidak penuh. Sebelumnya kedua field selalu dihapus, sehingga
  // saat cache-first menampilkan Data Stok sebelum refresh server selesai,
  // Foto Nameplate tampak hilang walaupun URL-nya sudah ada di database.
  return leanStocksForCache(list);
}

// Kunci localStorage cache Fase 1 (cache-first render). Dibersihkan saat logout supaya
// data user A tidak bocor ke sesi user B di device yang sama. Tanpa prefix 'warnoto_'
// (ditambahkan saat removeItem, konsisten dgn readCachedList/CLOUD).
const PHASE1_CACHE_KEYS = [
  "pln_stocks_v4", "pln_katalog_v4", "pln_heavy_equipment_v1", "pln_heavy_equipment_loans_v1",
  "pln_attb_v1", "pln_opname_v1", "pln_stockcount_v1", "pln_gudang_capacity_v1",
  "pln_gudang_capacity_imports_v1", "pln_txns_v3", "pln_docseq_v3",
];

// Kunci localStorage cache Fase 2 — master data yang sebelumnya TIDAK PERNAH ditulis ke
// localStorage (CRUD-nya langsung ke Supabase via syncMasterTable). Dipisah dari
// PHASE1_CACHE_KEYS supaya jelas mana Fase 1 vs Fase 2 kalau perlu dibedakan nanti.
// Dibersihkan saat logout bersama PHASE1 (cegah kebocoran data antar user di device sama).
const PHASE2_CACHE_KEYS = [
  "pln_lokasi_v4", "pln_gudang_v1", "pln_sub_gudang_v1", "pln_satpam_v1",
  "pln_tim_mutu_v1", "pln_uit_v1", "pln_upt_v1", "pln_ultg_v1",
];

// ════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ════════════════════════════════════════════════════════════════════
export default function PLNWarehouse() {
  const [currentUser, setCurrentUser] = useState(readCachedProfile);
  const [authLoading, setAuthLoading] = useState(() => !readCachedProfile()); // true hanya kalau belum ada cache profil
  const [loginForm, setLoginForm] = useState({ username:"", password:"" });
  const [loginErr, setLoginErr] = useState("");
  const [loginBusy, setLoginBusy] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false); // tombol Logout busy — cegah user refresh di tengah signOut yang bisa lambat

  const [users, setUsers] = useState([]); // di-fetch dari tabel "profiles" Supabase setelah login (lihat effect onAuthStateChange)
  const [rolePerms, setRolePerms] = useState({}); // override izin per role dari tabel role_permissions ({role: {key:bool}}); {} = pakai DEFAULT_PERMS
  const [stocks, setStocks] = useState(() => readCachedList("pln_stocks_v4") ?? []); // junction rows: katalogId + lokasiId + qty/price/jenis
  const [katalogList, setKatalogList] = useState(() => readCachedList("pln_katalog_v4") ?? []); // Master Katalog Barang
  const [lokasiList, setLokasiList] = useState(() => readCachedList("pln_lokasi_v4") ?? []); // Master Lokasi Gudang
  const [txns, setTxns] = useState(() => readCachedList("pln_txns_v3") ?? []);
  const [satpamList, setSatpamList] = useState(() => readCachedList("pln_satpam_v1") ?? []);
  const [timMutuList, setTimMutuList] = useState(() => readCachedList("pln_tim_mutu_v1") ?? []);
  const [uitList, setUitList] = useState(() => readCachedList("pln_uit_v1") ?? []);
  const [uptList, setUptList] = useState(() => readCachedList("pln_upt_v1") ?? []);
  const [ultgList, setUltgList] = useState(() => readCachedList("pln_ultg_v1") ?? []); // Unit di bawah UPT (mis. ULTG Surabaya Utara/Selatan)
  const [gudangList, setGudangList] = useState(() => readCachedList("pln_gudang_v1") ?? []);
  const [subGudangList, setSubGudangList] = useState(() => readCachedList("pln_sub_gudang_v1") ?? []); // level di antara Gudang dan Blok Lokasi
  const [importGudangOpen, setImportGudangOpen] = useState(false); // toggle panel Import & Review di Master Gudang
  const [importLokasiOpen, setImportLokasiOpen] = useState(false); // modal Import Excel Master Lokasi
  const [rencanaKedatanganList, setRencanaKedatanganList] = useState([]);
  // opnameList/stockCountList dipindah ke useStockOpname (2026-08-10).
  // approvalHistoryList + state pagination approval dipindah ke useApprovalHub (2026-08-10).
  // currentUserUptId + domain Maturity dipanggil sedini mungkin (di sini, bukan
  // di dekat state operasional bawah) karena state Maturity dipakai di render-body
  // lebih atas (stateRef, dep-array useEffect) — kalau destructure di bawah titik
  // itu → ReferenceError TDZ (build lolos, app blank). Dep currentUserUptId sudah
  // tersedia: currentUser/uptList/ultgList di atas; showToast/askConfirmDelete
  // function-declaration (hoisted). saveMaturity5SAssessment memakainya saat runtime.
  const appUptShortForAdopt = (typeof UPT !== "undefined" ? UPT : "").replace(/^UPT\s+/i, "").trim();
  const currentUserUptId = currentUser?.uptId
    || (ultgList.find(u => u.id === currentUser?.ultgId)?.parentUptId)
    || (uptList.find(u => String(u.nama || "").toUpperCase().includes(appUptShortForAdopt.toUpperCase()))?.id);
  const {
    maturityAssessments, setMaturityAssessments,
    maturityAudits, setMaturityAudits,
    maturityAuditHistory, setMaturityAuditHistory,
    maturity5SAssessments, setMaturity5SAssessments,
    maturityModal, setMaturityModal,
    maturityForm, setMaturityForm,
    maturitySubTab, setMaturitySubTab,
    canSwitchMaturityUpt,
    selectedMaturityUpt, setSelectedMaturityUpt,
    selectedMaturityUptId,
    maturityAuditModal, setMaturityAuditModal,
    maturityAuditForm, setMaturityAuditForm,
    maturityAuditSaving, setMaturityAuditSaving,
    maturityAuditEvidence, setMaturityAuditEvidence,
    expandedAspek, setExpandedAspek,
    activeAspectId, setActiveAspectId,
    aspectPage, setAspectPage,
    auditListPage, setAuditListPage,
    uptIdByNama,
    guardMaturityWrite,
    saveMaturityAssessment,
    saveMaturity5SAssessment,
    getCurrentMonth5SEvidence,
    mergeCurrentMonth5SEvidence,
    calculateItemLevel,
    createMaturityAudit,
    openMaturityAudit,
    calcMaturityScore,
    calcMaturityLevel,
    saveMaturityAudit,
    deleteMaturityAudit,
    exportMaturityAuditExcel,
  } = useMaturity({ currentUser, showToast, uptList, currentUserUptId, askConfirmDelete, MATURITY_LEVELS, MATURITY_WORKFLOW_LABEL });
  const [attbList, setAttbList] = useState(() => readCachedList("pln_attb_v1") ?? []);
  const [materialCadangData, setMaterialCadangData] = useState({ imports:[], analyses:[], applyHistory:[] });
  const [materialCadangHealthData, setMaterialCadangHealthData] = useState({ imports:[], analysisRuns:[], healthResults:[], applyAudit:[] });
  const [materialCadangAiInsights, setMaterialCadangAiInsights] = useState({ runs:[], materialInsights:[] });
  const [materialInspections, setMaterialInspections] = useState([]);
  // Struktur baru: satu BA berisi beberapa material Cadang. Dikonsumsi UI tahap berikutnya.
  const [materialInspectionBatches, setMaterialInspectionBatches] = useState([]);
  const [maraReference, setMaraReference] = useState(null); // legacy — dipertahankan untuk MigrasiDataTab & MaterialCadangTab
  const [maraSearch, setMaraSearch] = useState("");
  const [maraSearchResults, setMaraSearchResults] = useState([]);
  const [maraSearchLoading, setMaraSearchLoading] = useState(false);
  const [maraSearchError, setMaraSearchError] = useState(null);
  const [maraUploadLoading, setMaraUploadLoading] = useState(false);
  const [maraUploadProgress, setMaraUploadProgress] = useState(null);
  const [catalogMasterRef, setCatalogMasterRef] = useState(null); // session-only hidden cataloger reference
  const [gudangCapacityList, setGudangCapacityList] = useState(() => readCachedList("pln_gudang_capacity_v1") ?? []);
  const [gudangCapacityImports, setGudangCapacityImports] = useState(() => readCachedList("pln_gudang_capacity_imports_v1") ?? []);
  const [migratedTug15History, setMigratedTug15History] = useState([]);
  // Antrian item BARU (belum ada di Master Katalog) hasil Migrasi Data SAP —
  // tidak langsung ditambahkan ke katalogList/stocks, menunggu Admin review
  // satu-per-satu (2026-07-04, permintaan user: item matched TIDAK boleh
  // ditimpa diam-diam, item baru WAJIB direview dulu).
  const [migrasiPendingReview, setMigrasiPendingReview] = useState([]);
  const [docSeq, setDocSeq] = useState(() => readCachedList("pln_docseq_v3") ?? 196);
  // Cache-first: layar blocking "Memuat data dari cloud..." HANYA tampil kalau benar-benar
  // tidak ada cache first-screen-critical (device/browser baru). Kalau cache stocks/katalog
  // ada, app langsung render dari cache & loadCloud refresh di latar belakang.
  const [loading, setLoading] = useState(() => readCachedList("pln_stocks_v4") == null && readCachedList("pln_katalog_v4") == null);
  const [dataRefreshing, setDataRefreshing] = useState(true); // true selama loadCloud() menyinkronkan data di latar belakang
  const [cloudSaving, setCloudSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState(null);

  const [tab, setTab] = useState(() => {
    try { return sessionStorage.getItem("warnoto_tab") || "dashboard"; } catch { return "dashboard"; }
  });
  const [dashTab, setDashTab] = useState("ringkasan"); // ringkasan terpadu | overview gudang
  const [search, setSearch] = useState("");
  const [filterJenis, setFilterJenis] = useState("ALL");
  const [filterStatusSAP, setFilterStatusSAP] = useState("ALL");
  const [stockUptFilter, setStockUptFilter] = useState(""); // "" = semua; hanya dipakai viewer multi-UPT (UIT/Pusat)
  const [stockGudangSelect, setStockGudangSelect] = useState(""); // filter tabel Data Stok per Gudang
  const [stockBlokSelect, setStockBlokSelect] = useState(""); // filter tabel Data Stok per Blok, bergantung stockGudangSelect
  const [stockQuickFilter, setStockQuickFilter] = useState(""); // "" | "kritis" | "tanpaLokasi"
  const [stockSort, setStockSort] = useState({key:"nama", dir:"asc"}); // key: "nama" | "qty" | "lokasi"
  const [stockViewMode, setStockViewMode] = useState("lokasi"); // "lokasi" | "katalog" (agregat per barang, lintas lokasi)
  const [tugUptFilter, setTugUptFilter] = useState(""); // "" = semua; sama pola stockUptFilter, khusus tab TUG
  const [stockPage, setStockPage] = useState(1);
  const [stockPageSize, setStockPageSize] = useState(10);
  const [katalogPage, setKatalogPage] = useState(1);
  const [katalogPageSize, setKatalogPageSize] = useState(10);
  const [katalogSearch, setKatalogSearch] = useState("");
  const [katalogFilterBelumMara, setKatalogFilterBelumMara] = useState(false);
  const [filterStatus, setFilterStatus] = useState("ALL");

  // Filter jenis approval (TUG/Alat Berat/Stok/dst) + pagination tiap section —
  function renderApprovalPager(page, setPage, totalItems) {
    if (totalItems <= approvalPageSize) return null;
    const totalPages = Math.max(1, Math.ceil(totalItems/approvalPageSize));
    return (
      <div style={{display:"flex",justifyContent:"flex-end",alignItems:"center",gap:6,marginTop:8}}>
        <button style={{...sty.btn("ghost","sm")}} disabled={page<=1} onClick={()=>setPage(p=>Math.max(1,p-1))}>← Sebelumnya</button>
        <span style={{fontSize:12,color:C.muted,padding:"0 4px"}}>Halaman {page} / {totalPages}</span>
        <button style={{...sty.btn("ghost","sm")}} disabled={page>=totalPages} onClick={()=>setPage(p=>Math.min(totalPages,p+1))}>Berikutnya →</button>
      </div>
    );
  }

  const [stockModal, setStockModal] = useState(null);
  const [confirmDialog, setConfirmDialog] = useState(null); // popup konfirmasi hapus generik untuk Master Data lain (Katalog, Satpam, UIT, ULTG, UPT, Gudang): {title, message, warning, confirmLabel, onConfirm}
  function askConfirmDelete({ title, message, warning, confirmLabel, onConfirm, variant }) {
    setConfirmDialog({ title: title||"Hapus Data?", message, warning, confirmLabel: confirmLabel||(variant==="warning"?"Mengerti":"🗑️ Ya, Hapus"), onConfirm, variant });
  }
  const {
    akunModal, setAkunModal, akunForm, setAkunForm, akunBusy, setAkunBusy, akunResult, setAkunResult,
    gantiPasswordModal, setGantiPasswordModal, gantiPasswordForm, setGantiPasswordForm, gantiPasswordBusy, setGantiPasswordBusy,
    openAddAkun, openEditAkun, isUitScopedRole, isNationalRole, submitAkunEdit, submitAkunBaru,
    openGantiPassword, submitGantiPassword,
  } = useAccountAdmin({ currentUser, showToast, reloadUsers });
  const [stockSubTab, setStockSubTab] = useState("katalog"); // "katalog" | "lokasi" | "satpam" | "timmutu" (within Master Data tab)
  const [tug15Filter, setTug15Filter] = useState({
    dateFrom: "", dateTo: "",
    katalogId: "ALL",
    jenisBarang: "ALL",
    sapStatus: "ALL",  // "ALL" | "SAP" | "Non-SAP"
    source: "ALL", // "ALL" | "BARU" | "LAMA"
    searchText: "",
    docTypes: ["TUG9","TUG8","TUG10","TUG3","TUG5"],
  });
  const [topN, setTopN] = useState(10);
  const [pemakaianMode, setPemakaianMode] = useState("frekuensi"); // "frekuensi" | "qty"
  const [tugExpanded, setTugExpanded] = useState(false); // sidebar accordion state for TUG
  const [tugSubTab, setTugSubTab] = useState("TUG3"); // "TUG3" | "TUG10" (penerimaan) or "TUG9" | "TUG8" (pengeluaran)
  const [masterExpanded, setMasterExpanded] = useState(false); // sidebar accordion state for Master Data
  // opnameExpanded/opnameSubTab dipindah ke useStockOpname (2026-08-10).
  const [isMobile, setIsMobile] = useState(typeof window !== "undefined" && window.innerWidth <= 768);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false); // drawer sidebar di HP
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const accountMenuRef = useRef(null);
  // Dark mode: persist manual di localStorage, default terang (tanpa auto-deteksi OS).
  // Palet C di-shadow di bawah (dekat makeSty) supaya semua C.xxx/sty.xxx ikut tema.
  const [theme, setTheme] = useState(() => {
    // Always start each load in light mode; the in-session toggle still works.
    try { localStorage.setItem("warnoto_theme", "light"); } catch {}
    return "light";
  });
  useEffect(() => { document.documentElement.setAttribute("data-theme", theme); try { localStorage.setItem("warnoto_theme", theme); } catch {} }, [theme]);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => typeof window !== "undefined" && window.innerWidth > 768 && window.innerWidth <= 1120);
  const compactViewportRef = useRef(typeof window !== "undefined" && window.innerWidth > 768 && window.innerWidth <= 1120);
  const [stockGudangFilter, setStockGudangFilter] = useState({}); // UI-only: stockId -> gudangId terpilih, untuk menyaring opsi dropdown Blok
  useEffect(() => {
    function onResize() {
      const nextMobile = window.innerWidth <= 768;
      const nextCompact = !nextMobile && window.innerWidth <= 1120;
      setIsMobile(nextMobile);
      if (nextCompact !== compactViewportRef.current) {
        setSidebarCollapsed(nextCompact);
        compactViewportRef.current = nextCompact;
      }
      if (!nextMobile) setMobileMenuOpen(false);
    }
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  useEffect(() => {
    if (!accountMenuOpen) return undefined;
    function closeAccountMenu(event) {
      if (event.key === "Escape" || (event.type === "mousedown" && !accountMenuRef.current?.contains(event.target))) {
        setAccountMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", closeAccountMenu);
    document.addEventListener("keydown", closeAccountMenu);
    return () => {
      document.removeEventListener("mousedown", closeAccountMenu);
      document.removeEventListener("keydown", closeAccountMenu);
    };
  }, [accountMenuOpen]);

  // Auto-sync ke Supabase setiap kali ada transaksi TUG yang berubah (approve/reject/dll),
  // supaya tidak perlu klik tombol "Sync ke Supabase" manual. Di-debounce 2.5 detik supaya
  // tidak nembak Supabase berkali-kali kalau banyak perubahan state beruntun.
  useEffect(() => {
    if (!currentUser || loading || !supabase) return;
    const timer = setTimeout(async () => {
      try {
        const filter = { dateFrom:"", dateTo:"", katalogId:"ALL", jenisBarang:"ALL", sapStatus:"ALL", docTypes:["TUG9","TUG8","TUG10","TUG3"] };
        const rows = buildMutasiRows(txns, katalogList, stocks, filter, lokasiList);
        const histRes = await syncTUG15ToSupabase(rows, katalogList);
        await syncStockQtyToSupabase(stocks, katalogList, { lokasiList, subGudangList, gudangList });
        await syncFotoMaterialToSupabase(stocks, katalogList);
        if (histRes.historyCount > 0) {
          showToastRef.current && showToastRef.current(`☁️ Auto-sync Supabase: ${histRes.historyCount} baris histori baru.`, "success");
        }
      } catch (err) {
        console.error("Auto-sync Supabase gagal:", err.message);
        // Jangan silent — kegagalan sync bisa berlangsung berhari-hari tanpa
        // disadari kalau cuma masuk console. Throttle 10 menit supaya tidak
        // spam toast setiap 2.5 detik selama Supabase down.
        const now = Date.now();
        if (now - (lastSyncErrorToastRef.current||0) > 10*60*1000) {
          lastSyncErrorToastRef.current = now;
          showToastRef.current && showToastRef.current(`⚠️ Auto-sync Supabase gagal: ${err.message}`, "error");
        }
      }
    }, 2500);
    return () => clearTimeout(timer);
  }, [txns, stocks, katalogList, currentUser, loading]);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [docPreview, setDocPreview] = useState(null); // txn object when previewing TUG-9 document
  // One user action keeps the same RPC idempotency keys across retry after a timeout.
  const canonicalActionKeysRef = useRef(null);
  const canonicalDecisionKeysRef = useRef({});
  const [docPreviewDoc, setDocPreviewDoc] = useState(null); // versi docPreview dgn SIM/KTP privat sudah jadi signed URL
  const [kartuGantungDetail, setKartuGantungDetail] = useState(null);
  const [barcodePrintOpen, setBarcodePrintOpen] = useState(false); // modal cetak barcode massal (Admin, Master Katalog)
  const [petaMiniDetail, setPetaMiniDetail] = useState(null); // {stock, lokasi, gudang}
  const [stockDetailId, setStockDetailId] = useState(null); // id stok yang dibuka detailnya (klik baris Data Stok)
  const [stockDetailTab, setStockDetailTab] = useState("detail"); // "detail" | "riwayat" — reset tiap ganti barang
  const [riwayatExpanded, setRiwayatExpanded] = useState(false); // "Tampilkan semua" tab Riwayat
  const [confirmDiscard, setConfirmDiscard] = useState(false); // konfirmasi inline "buang perubahan?" mode edit
  const stockFormSnapshotRef = useRef(null); // snapshot stockForm saat masuk mode edit, buat cek isDirty
  const stockDetailTriggerRef = useRef(null); // elemen pemicu, difokuskan balik saat modal detail ditutup
  const stockDetailModalRef = useRef(null);
  const [stockForm, setStockForm] = useState({});
  const stockFormDirty = stockModal === "edit" && stockFormSnapshotRef.current
    ? JSON.stringify(stockFormSnapshotRef.current) !== JSON.stringify(stockForm)
    : false;
  useEffect(() => {
    if (stockDetailId) {
      stockDetailTriggerRef.current = document.activeElement;
      stockDetailModalRef.current?.focus();
    } else {
      stockDetailTriggerRef.current?.focus?.();
    }
  }, [stockDetailId]);
  useEffect(() => {
    // Buka barang lain (atau tutup) jangan mewarisi tab/konfirmasi dari barang sebelumnya.
    setStockDetailTab("detail");
    setRiwayatExpanded(false);
    setConfirmDiscard(false);
  }, [stockDetailId]);
  useEffect(() => {
    // Kunci scroll body selama sheet detail terbuka — tanpa ini scroll jari yang meleset
    // di HP menggeser tabel di belakang sheet.
    if (!stockDetailId) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prevOverflow; };
  }, [stockDetailId]);
  useEffect(() => {
    if (!stockDetailId) return;
    function onKeyDown(e) {
      if (e.key !== "Escape") return;
      // Mode edit: ESC balik ke view dulu (cegah kehilangan input tak sengaja), bukan langsung tutup.
      // Kalau ada perubahan belum disimpan, tampilkan konfirmasi inline dulu (bukan window.confirm).
      if (stockModal === "edit") {
        if (stockFormDirty) { setConfirmDiscard(true); return; }
        setStockModal(null);
      } else { setStockDetailId(null); setPendingFoto({}); }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [stockDetailId, stockModal, stockFormDirty]);
  // Cari barang dengan foto (visual search) di Data Stok
  const [photoSearchOpen, setPhotoSearchOpen] = useState(false);
  const [photoSearchImg, setPhotoSearchImg] = useState(null);
  const [photoSearchLoading, setPhotoSearchLoading] = useState(false);
  const [photoSearchResults, setPhotoSearchResults] = useState(null); // null = belum cari; [] = tidak ada hasil
  const [photoSearchMode, setPhotoSearchMode] = useState("bentuk"); // "bentuk" = Cohere visual | "nameplate" = OCR.space baca teks nameplate
  const [photoSearchResultMode, setPhotoSearchResultMode] = useState("bentuk"); // mode yang menghasilkan photoSearchResults (utk label hasil)
  const [photoSearchOcrText, setPhotoSearchOcrText] = useState(""); // teks nameplate terbaca (mode nameplate)
  const syncingPhotosRef = useRef(false); // cegah tumpang-tindih auto-sync foto transaksi pending
  const [pendingFoto, setPendingFoto] = useState({}); // foto yang baru dipilih tapi belum diklik "Simpan Foto" — {fotoNameplate, fotoKeseluruhan}
  const [lightboxImg, setLightboxImg] = useState(null); // src foto yang sedang di-overview full-screen
  const [scannerTarget, setScannerTarget] = useState(null); // "stockForm" | {index}
  const [toast, setToast] = useState(null);

  const [chatHistory, setChatHistory] = useState([{ role:"ai", text:`Halo, saya Pak War — asisten operasional gudang PLN.\n\nSaya siap membantu membaca kondisi stok, transaksi TUG, approval, forecast, dan prioritas pekerjaan. Pilih contoh pertanyaan di atas atau tulis pertanyaan Anda sendiri.` }]);
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
  const lastSyncErrorToastRef = useRef(0);
  const lastBotSyncErrorToastRef = useRef(0);
  const maturityMigrationPromptedRef = useRef({ assessments:false, audits:false });
  // Hanya aktif setelah bootstrap untuk user ini selesai. Ref mencegah channel
  // sempat terbuka saat login ulang sebelum effect loadCloud sempat set state refresh.
  const stocksBootstrapUserIdRef = useRef(null);

  useEffect(() => {
    // Tabel master memakai RLS authenticated. Tunggu sesi/profil selesai dipulihkan;
    // kalau dipanggil saat mount sebagai anon, Supabase mengembalikan daftar kosong
    // dan data remote (termasuk warehouse_capacity) tidak pernah dimuat ulang.
    if (authLoading || !currentUser) return;
    async function loadCloud() {
      stocksBootstrapUserIdRef.current = null;
      setDataRefreshing(true);
      // Cache-first: JANGAN setLoading(true) di sini. `loading` sudah diinisialisasi
      // true HANYA saat tidak ada cache first-screen-critical (device baru); memaksa
      // true di sini akan memunculkan lagi layar blocking padahal cache sudah tampil.
      // Untuk device baru, loading memang sudah true dari initializer; setLoading(false)
      // di akhir mematikannya setelah 17 query selesai.
      // Kumpulan label tabel yang GAGAL di-fetch dari Supabase (loadMasterTable === null).
      // Untuk tabel-tabel ini kita HANYA menampilkan cache lokal demi UX, TAPI TIDAK PERNAH
      // mendorongnya ke server (mencegah cache basi menimpa data benar di server saat fetch
      // gagal — mis. Supabase pause/resume/network blip). Di akhir loadCloud diperingatkan via toast.
      const loadFailures = [];
      // Semua cache dibaca paralel. Pada browser dengan window.storage asinkron ini
      // menghilangkan waterfall sebelum request REST bahkan dimulai.
      const [cs, ckat, clokLocal, ct, cseq, crk, copn, csc, cah, cma, cmau, cmah, cm5s, che, chel, cattb, cmcd, cmch, cmcai, cgcap, cgcapi, cmig, cmpr] = await Promise.all([
        CLOUD.get("pln_stocks_v4"), CLOUD.get("pln_katalog_v4"), CLOUD.get("pln_lokasi_v4"), CLOUD.get("pln_txns_v3"), CLOUD.get("pln_docseq_v3"),
        CLOUD.get("pln_rencana_v1"), CLOUD.get("pln_opname_v1"), CLOUD.get("pln_stockcount_v1"), CLOUD.get("pln_approval_history_v1"), CLOUD.get("pln_maturity_v1"),
        CLOUD.get("pln_maturity_audits_v1"), CLOUD.get("pln_maturity_audit_history_v1"), CLOUD.get("pln_maturity_5s_assessments_v1"), CLOUD.get("pln_heavy_equipment_v1"), CLOUD.get("pln_heavy_equipment_loans_v1"), CLOUD.get("pln_attb_v1"),
        CLOUD.get("pln_material_cadang_v1"), CLOUD.get("pln_material_cadang_health_v1"), CLOUD.get("pln_material_cadang_ai_insights_v1"),
        CLOUD.get("pln_gudang_capacity_v1"), CLOUD.get("pln_gudang_capacity_imports_v1"), CLOUD.get("pln_migrated_tug15_v1"), CLOUD.get("pln_migrasi_pending_review_v1"),
      ]);

      // Master data (UIT/UPT/Gudang/Lokasi/Satpam/Tim Mutu) sekarang sumber
      // utamanya Supabase, bukan localStorage lagi — load dulu (seed dari
      // DEFAULT_* kalau tabelnya masih kosong, mis. instalasi baru).
      const masterLoads = [
        loadMasterTable("uit"),
        loadMasterTable("upt"),
        loadMasterTable("ultg"),
        loadMasterTable("gudang"),
        loadMasterTable("sub_gudang"),
        loadMasterTable("lokasi"),
        loadMasterTable("satpam"),
        loadMasterTable("tim_mutu"),
        loadMasterTable("katalog"),
        loadMasterTable("stocks"),
        loadWarehouseCapacity(),
        loadWarehouseCapacityImports(),
        loadMasterTable("heavy_equipment"),
        loadMasterTable("heavy_equipment_loans"),
        loadMasterTable("stock_opname"),
        loadMasterTable("stock_count"),
        loadMasterTable("attb_list"),
      ];
      // Maturity punya tabel typed khusus; jangan lewat masterSync/blob warnoto_state.
      const maturityLoads = [loadMaturityAssessments(), loadMaturityAudits(), loadMaturityAuditHistory(), loadMaturity5SAssessments()];

      // Hanya tiga dataset ini diperlukan untuk layar kerja pertama. Request
      // non-kritis tetap berjalan paralel dan diproses dengan invariant null/
      // tidak-menulis yang ada di bawah.
      const [initialLokasi, initialKatalog, initialStocks] = await Promise.all([masterLoads[5], masterLoads[8], masterLoads[9]]);
      if (initialLokasi !== null) setLokasiList(initialLokasi?.length ? dedupeById(initialLokasi).list : (initialLokasi ? [] : (clokLocal || DEFAULT_LOKASI)));
      if (initialKatalog !== null) setKatalogList(initialKatalog?.some(k => k.name) ? dedupeById(initialKatalog.filter(k => k.name)).list : (ckat || DEFAULT_KATALOG));
      if (initialStocks !== null) setStocks(initialStocks?.length ? dedupeById(initialStocks).list : (cs || DEFAULT_STOCKS));
      setLoading(false);

      const [cuit, cupt, cultg, cgdg, csgdg, clokRemote, csp, ctm, ckatRemote, csRemote, cgcapRemote, cgcapiRemote, cheRemote, chelRemote, copnRemote, cscRemote, cattbRemote, cmaRemote, cmauRemote, cmahRemote, cm5sRemote] = await Promise.all([...masterLoads, ...maturityLoads]);
      const clok = clokRemote || clokLocal; // fallback ke localStorage kalau Supabase belum terkonfigurasi
      // Seed DEFAULT (gudang/lokasi) hanya boleh oleh viewer NASIONAL (Pusat/SUPERADMIN).
      // Multi-UPT + RLS: hasil kosong untuk akun scoped berarti "UPT-ku belum punya
      // gudang/lokasi", BUKAN tabel kosong global — seed di sini akan ditolak RLS (403,
      // insiden login UPT Gresik 2026-08-07) dan mengisi data Surabaya ke UPT lain.
      const canSeedMaster = getScopeUptIds(currentUser, cupt) === null;

      if (cs && ckat && clok) {
        // Already on new master-data structure.
        // Bersihkan id ganda yang mungkin sudah kepalanjar tersimpan (mis.
        // bug katalog/stok 2230071 yang dobel sebelum diperbaiki di seed).
        const dKat = dedupeById(ckat);
        const dStk = dedupeById(cs);
        const dLok = dedupeById(clok);
        setStocks(dStk.list); setKatalogList(dKat.list); setLokasiList(dLok.list);
        CLOUD.set("pln_lokasi_v4", dLok.list); // refresh cache Fase 2 (lokasi tidak punya branch remote refresh terpisah)
        const totalRemoved = dKat.removed + dStk.removed + dLok.removed;
        if (totalRemoved > 0) {
          showToastRef.current && showToastRef.current(`🧹 Membersihkan ${totalRemoved} data duplikat (id ganda) di Master Katalog/Stok/Lokasi.`, "success");
          CLOUD.set("pln_katalog_v4", dKat.list);
          CLOUD.set("pln_stocks_v4", leanStocks(dStk.list));
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
        if (ckatRemote === null) {
          // Fetch katalog GAGAL — pertahankan tampilan lokal (sudah di-set dari dKat.list di atas),
          // JANGAN push ke server (cegah cache basi menimpa data server). Deteksi null harus dari
          // ckatRemote mentah, bukan ckatRemoteReal (yang sudah kehilangan info null lewat `||[]`).
          loadFailures.push("Master Katalog");
        } else if (ckatRemoteReal.length > 0) {
          const katFresh = dedupeById(ckatRemoteReal).list;
          setKatalogList(katFresh);
          CLOUD.set("pln_katalog_v4", katFresh); // refresh cache dgn data terbaru dari server
        } else if (dKat.list.length > 0) {
          syncMasterTable("katalog", dKat.list);
        }
        if (csRemote === null) {
          // Fetch stocks GAGAL — pertahankan tampilan lokal (sudah di-set dari dStk.list di atas),
          // JANGAN push ke server.
          loadFailures.push("Data Stok");
        } else if (csRemote.length > 0) {
          const stkFresh = dedupeById(csRemote).list;
          setStocks(stkFresh);
          CLOUD.set("pln_stocks_v4", leanStocks(stkFresh)); // refresh cache (lean, tanpa foto base64)
        } else if (dStk.list.length > 0) {
          syncMasterTable("stocks", dStk.list, s => ({ katalog_id: s.katalogId || null, lokasi_id: s.lokasiId || null }));
        }
        // Master Lokasi — perhalus initial paint di atas (baris setLokasiList(dLok.list))
        // dengan pola 3-arah eksplisit yang sama seperti katalog/stocks: fetch GAGAL
        // (clokRemote === null) → pertahankan tampilan lokal, JANGAN push ke server;
        // ada data → pakai data server + refresh cache; genuinely kosong → seed sekali
        // dari DEFAULT_LOKASI (perilaku sama seperti seedMasterTableIfEmpty yang lama).
        if (clokRemote === null) {
          loadFailures.push("Master Lokasi");
        } else if (clokRemote.length > 0) {
          const lokFresh = dedupeById(clokRemote).list;
          setLokasiList(lokFresh);
          CLOUD.set("pln_lokasi_v4", lokFresh);
        } else if (canSeedMaster && DEFAULT_LOKASI.length > 0) {
          setLokasiList(DEFAULT_LOKASI);
          await syncMasterTable("lokasi", DEFAULT_LOKASI, l => ({ gudang_id: l.gudangId || null, status: l.status || null }));
          CLOUD.set("pln_lokasi_v4", DEFAULT_LOKASI);
        } else {
          setLokasiList([]); // akun scoped tanpa lokasi UPT sendiri — jangan seed/tampilkan data UPT lain
          CLOUD.set("pln_lokasi_v4", []);
        }
      } else {
        // Check for legacy flat-stock data from older version of the app
        const legacyStocks = await CLOUD.get("pln_stocks_v3");
        const migrated = migrateLegacyStocks(legacyStocks);
        if (migrated) {
          setStocks(migrated.stocks); setKatalogList(migrated.katalog); setLokasiList(migrated.lokasi);
          // Tulis balik cache Fase 1/2 supaya refresh berikutnya masuk jalur `if (cs && ckat && clok)`
          // yang sehat, bukan terjebak loop layar "Memuat data dari cloud..." (stocks lean tanpa foto base64).
          CLOUD.set("pln_stocks_v4", leanStocks(migrated.stocks));
          CLOUD.set("pln_katalog_v4", migrated.katalog);
          CLOUD.set("pln_lokasi_v4", migrated.lokasi);
          showToastRef.current && showToastRef.current("📦 Data lama berhasil dimigrasikan ke struktur Master Data baru!", "success");
        } else {
          const stocksFallback = (csRemote&&csRemote.length>0) ? csRemote : DEFAULT_STOCKS;
          const katalogFallback = (ckatRemote||[]).some(k=>k.name) ? ckatRemote.filter(k=>k.name) : DEFAULT_KATALOG;
          const lokasiFallback = clok || DEFAULT_LOKASI;
          setStocks(stocksFallback); setKatalogList(katalogFallback); setLokasiList(lokasiFallback);
          // Tulis balik cache Fase 1/2 dgn NILAI SAMA yang di-set ke state, supaya refresh berikutnya
          // masuk jalur sehat dan tidak loop layar "Memuat data dari cloud..." (stocks lean tanpa foto base64).
          CLOUD.set("pln_stocks_v4", leanStocks(stocksFallback));
          CLOUD.set("pln_katalog_v4", katalogFallback);
          CLOUD.set("pln_lokasi_v4", lokasiFallback);
        }
      }
      // TUG canonical is the source of truth once the reviewed migration exists.
      // Legacy cache remains only for non-canonical records and as a pre-migration fallback.
      const legacyTxns = ct || DEFAULT_TXNS;
      try {
        const canonicalLoad = await loadCanonicalTugTransactions();
        setTxns(canonicalLoad.unavailable ? legacyTxns : [
          ...legacyTxns.filter(t => !t.canonical && !canonicalLoad.rows.some(c => c.id === t.id)),
          ...canonicalLoad.rows,
        ]);
      } catch (err) {
        console.warn("Canonical TUG load gagal; mempertahankan cache legacy tanpa menulis balik.", err);
        setTxns(legacyTxns);
      }
      setDocSeq(cseq || 196);
      // Master data organisasi/gudang (satpam/tim_mutu/uit/upt/ultg/gudang/sub_gudang)
      // — pola 3-arah eksplisit yang sama seperti katalog/stocks. Fetch GAGAL (=== null)
      // → JANGAN timpa state (biarkan cache-first tetap tampil) + toast, JANGAN push ke
      // server. Ada data → pakai + refresh cache. Genuinely kosong → seed sekali dari
      // DEFAULT_* (persis perilaku seedMasterTableIfEmpty lama). ultg/sub_gudang tidak
      // punya DEFAULT_* → cukup 2-arah tanpa seeding.
      if (csp === null) {
        loadFailures.push("Data Satpam");
      } else if (csp.length > 0) {
        setSatpamList(csp);
        CLOUD.set("pln_satpam_v1", csp);
      } else if (DEFAULT_SATPAM.length > 0) {
        setSatpamList(DEFAULT_SATPAM);
        await syncMasterTable("satpam", DEFAULT_SATPAM);
        CLOUD.set("pln_satpam_v1", DEFAULT_SATPAM);
      }
      if (ctm === null) {
        loadFailures.push("Data Tim Mutu");
      } else if (ctm.length > 0) {
        setTimMutuList(ctm);
        CLOUD.set("pln_tim_mutu_v1", ctm);
      } else if (DEFAULT_TIM_MUTU.length > 0) {
        setTimMutuList(DEFAULT_TIM_MUTU);
        await syncMasterTable("tim_mutu", DEFAULT_TIM_MUTU);
        CLOUD.set("pln_tim_mutu_v1", DEFAULT_TIM_MUTU);
      }
      if (cuit === null) {
        loadFailures.push("Struktur Organisasi (UIT)");
      } else if (cuit.length > 0) {
        setUitList(cuit);
        CLOUD.set("pln_uit_v1", cuit);
      } else if (DEFAULT_UIT.length > 0) {
        setUitList(DEFAULT_UIT);
        await syncMasterTable("uit", DEFAULT_UIT);
        CLOUD.set("pln_uit_v1", DEFAULT_UIT);
      }
      if (cupt === null) {
        loadFailures.push("Struktur Organisasi (UPT)");
      } else if (cupt.length > 0) {
        setUptList(cupt);
        CLOUD.set("pln_upt_v1", cupt);
      } else if (DEFAULT_UPT_LIST.length > 0) {
        setUptList(DEFAULT_UPT_LIST);
        await syncMasterTable("upt", DEFAULT_UPT_LIST, u => ({ uit_id: u.uitId || null }));
        CLOUD.set("pln_upt_v1", DEFAULT_UPT_LIST);
      }
      if (cultg === null) {
        loadFailures.push("ULTG");
      } else {
        setUltgList(cultg);
        CLOUD.set("pln_ultg_v1", cultg);
      }
      if (cgdg === null) {
        loadFailures.push("Master Gudang");
      } else if (cgdg.length > 0) {
        setGudangList(cgdg);
        CLOUD.set("pln_gudang_v1", cgdg);
      } else if (canSeedMaster && DEFAULT_GUDANG.length > 0) {
        setGudangList(DEFAULT_GUDANG);
        await syncMasterTable("gudang", DEFAULT_GUDANG, g => ({ upt_id: g.uptId || null }));
        CLOUD.set("pln_gudang_v1", DEFAULT_GUDANG);
      } else {
        setGudangList([]); // akun scoped tanpa gudang UPT sendiri — jangan seed data UPT lain
        CLOUD.set("pln_gudang_v1", []);
      }
      if (csgdg === null) {
        loadFailures.push("Sub Gudang");
      } else {
        setSubGudangList(csgdg);
        CLOUD.set("pln_sub_gudang_v1", csgdg);
      }
      setRencanaKedatanganList(crk || []);
      // Stock Opname & Stock Count — Supabase (stock_opname/stock_count) sekarang sumber
      // utama kalau sudah ada isinya; kalau masih kosong (instalasi lama yang baru upgrade,
      // atau baru pertama kali), dorong sekali data localStorage yang ada ke Supabase supaya
      // tidak hilang lagi. Ditemukan 2026-07-07: sebelumnya data ini TIDAK PERNAH tersinkron
      // ke Supabase sama sekali — widget akurasi Dashboard "hilang" kalau dibuka dari
      // device/browser lain karena datanya memang cuma ada di localStorage device asal.
      const opnLocal = copn || [];
      // Newest-first by uploadedAt: konsumen (dashboard "Akurasi SAP vs Fisik",
      // "sesi terakhir") ambil [0] sbg sesi terbaru. Kolom created_at bisa kembar
      // (mis. dua sesi disync barengan) → jangan diandalkan utk recency.
      const byRecency = (a, b) => (b.uploadedAt || 0) - (a.uploadedAt || 0);
      const scLocal = [...(csc || [])].sort(byRecency);
      if (copnRemote === null) {
        // Fetch GAGAL — tampilkan lokal untuk UX, JANGAN push ke server.
        setOpnameList(opnLocal);
        loadFailures.push("Stock Opname");
      } else if (copnRemote.length > 0) {
        setOpnameList(copnRemote);
        CLOUD.set("pln_opname_v1", copnRemote); // refresh cache dgn data terbaru dari server
      } else {
        setOpnameList(opnLocal);
        if (opnLocal.length > 0) syncMasterTable("stock_opname", opnLocal, o => ({ status: o.status || null }));
      }
      if (cscRemote === null) {
        // Fetch GAGAL — tampilkan lokal untuk UX, JANGAN push ke server.
        setStockCountList(scLocal);
        loadFailures.push("Stock Count");
      } else if (cscRemote.length > 0) {
        const scSorted = [...cscRemote].sort(byRecency);
        setStockCountList(scSorted);
        CLOUD.set("pln_stockcount_v1", scSorted); // refresh cache dgn data terbaru dari server
      } else {
        setStockCountList(scLocal);
        if (scLocal.length > 0) syncMasterTable("stock_count", scLocal);
      }
      setApprovalHistoryList(cah || []);
      // DB adalah canonical. Cache Maturity hanya dipakai bila remote gagal;
      // remote yang sukses tapi kosong harus tetap dianggap kosong dan pengguna
      // diberi satu kesempatan eksplisit untuk memigrasikan cache lama.
      const maturityMigrationCandidates = [];
      const prepareMaturityCacheMigration = ({ key, label, cached, remote, setState, upsertAll, reload }) => {
        if (remote === null) {
          setState(cached || []);
          loadFailures.push(label);
          return;
        }
        if (remote.length > 0) {
          setState(remote);
          return;
        }
        setState([]);
        if (!cached?.length || maturityMigrationPromptedRef.current[key]) return;
        maturityMigrationPromptedRef.current[key] = true;
        maturityMigrationCandidates.push({ label, cached, setState, upsertAll, reload });
      };
      prepareMaturityCacheMigration({ key:"assessments", label:"Asesmen Maturity", cached:cma, remote:cmaRemote, setState:setMaturityAssessments, upsertAll:upsertMaturityAssessments, reload:loadMaturityAssessments });
      prepareMaturityCacheMigration({ key:"audits", label:"Audit Maturity", cached:cmau, remote:cmauRemote, setState:setMaturityAudits, upsertAll:upsertMaturityAudits, reload:loadMaturityAudits });
      // Riwayat semester adalah data referensi yang di-seed lewat migration,
      // bukan data perangkat yang boleh otomatis dipush. Jika tabel belum
      // tersedia/gagal dimuat, tampilkan cache atau nilai default milik UPT user
      // sendiri (kosong untuk UPT lain) sambil menandai kegagalan load.
      if (cmahRemote === null) {
        setMaturityAuditHistory(cmah?.length ? cmah : getDefaultMaturityAuditHistory(currentUserUptId || currentUser?.uptId));
        loadFailures.push("History Audit Maturity");
      } else {
        setMaturityAuditHistory(cmahRemote);
        CLOUD.set("pln_maturity_audit_history_v1", cmahRemote);
      }
      // Form 5S mengikuti aturan yang sama: remote yang berhasil (termasuk
      // kosong) adalah canonical; cache hanya ditampilkan ketika load gagal.
      if (cm5sRemote === null) {
        setMaturity5SAssessments(cm5s || []);
        loadFailures.push("Form 5S");
      } else {
        setMaturity5SAssessments(cm5sRemote);
        CLOUD.set("pln_maturity_5s_assessments_v1", cm5sRemote);
      }
      if (maturityMigrationCandidates.length > 0) {
        const migrationSummary = maturityMigrationCandidates.map(item => `${item.cached.length} ${item.label}`).join(" dan ");
        askConfirmDelete({
          title: "Migrasikan data Maturity ke server?",
          message: <>Server belum memiliki data tersebut, tetapi ditemukan <b>{migrationSummary}</b> di perangkat ini.</>,
          warning: "Migrasi hanya menyimpan metadata Maturity; file/foto tidak ikut diunggah. Periksa hasil setelah proses selesai.",
          confirmLabel: "Migrasikan ke Server",
          onConfirm: async () => {
            const results = await Promise.all(maturityMigrationCandidates.map(async candidate => {
              // Satu request batch per tabel mencegah migrasi parsial di tabel itu.
              const migrated = await candidate.upsertAll(candidate.cached);
              if (!migrated) return { ...candidate, verified:null };
              const verified = await candidate.reload();
              const expectedIds = new Set(candidate.cached.map(item => item.id));
              const valid = verified !== null
                && verified.length === candidate.cached.length
                && verified.every(item => expectedIds.has(item.id));
              return { ...candidate, verified:valid ? verified : null };
            }));
            const failed = results.filter(result => result.verified === null);
            results.filter(result => result.verified !== null).forEach(result => result.setState(result.verified));
            if (failed.length > 0) {
              showToast(`Migrasi ${failed.map(item => item.label).join(" dan ")} gagal atau belum dapat diverifikasi. Data perangkat tidak dihapus.`, "error");
              return;
            }
            showToast("Data Maturity berhasil dimigrasikan dan diverifikasi di server.");
          },
        });
      }
      // Alat Berat/Peminjaman UPT — Supabase (heavy_equipment/_loans) sekarang sumber
      // utama kalau sudah ada isinya; kalau masih kosong (instalasi lama yang baru
      // upgrade ke skema jsonb ini, atau baru pertama kali), dorong sekali data
      // localStorage/DEFAULT yang ada ke Supabase supaya tidak hilang lagi (pola
      // sama seperti katalog/stocks/warehouse_capacity di atas).
      const heLocal = (che || DEFAULT_HEAVY_EQUIPMENT).map(normalizeHeavyEquipmentRecord);
      const helLocal = chel || [];
      if (cheRemote === null) {
        // Fetch GAGAL — tampilkan lokal untuk UX, JANGAN push ke server.
        setHeavyEquipmentList(heLocal);
        loadFailures.push("Alat Berat");
      } else if (cheRemote.length > 0) {
        const heFresh = cheRemote.map(normalizeHeavyEquipmentRecord);
        setHeavyEquipmentList(heFresh);
        CLOUD.set("pln_heavy_equipment_v1", heFresh); // refresh cache dgn data terbaru dari server
      } else {
        setHeavyEquipmentList(heLocal);
        if (heLocal.length > 0) syncMasterTable("heavy_equipment", heLocal, e => ({ upt: e.upt || null }));
      }
      if (chelRemote === null) {
        // Fetch GAGAL — tampilkan lokal untuk UX, JANGAN push ke server.
        setHeavyEquipmentLoans(helLocal);
        loadFailures.push("Peminjaman Alat Berat");
      } else if (chelRemote.length > 0) {
        setHeavyEquipmentLoans(chelRemote);
        CLOUD.set("pln_heavy_equipment_loans_v1", chelRemote); // refresh cache dgn data terbaru dari server
      } else {
        setHeavyEquipmentLoans(helLocal);
        if (helLocal.length > 0) syncMasterTable("heavy_equipment_loans", helLocal, l => ({
          equipment_id: l.equipmentId || null,
          status: l.status || null,
          owner_upt: getHeavyEquipmentLoanOwnerUpt(l) || null,
          requester_upt: getHeavyEquipmentLoanRequesterUpt(l) || null,
        }));
      }
      const attbLocal = cattb || [];
      if (cattbRemote === null) {
        // Fetch GAGAL — tampilkan lokal untuk UX, JANGAN push ke server.
        setAttbList(attbLocal);
        loadFailures.push("ATTB");
      } else if (cattbRemote.length > 0) {
        setAttbList(cattbRemote);
        CLOUD.set("pln_attb_v1", cattbRemote); // refresh cache dgn data terbaru dari server
      } else {
        setAttbList(attbLocal);
        if (attbLocal.length > 0) syncMasterTable("attb_list", attbLocal, e => ({ upt: e.upt || null, stage: e.stage || null }));
      }
      // Material Cadang: server (durable, per-UPT, RLS-scoped) jadi sumber utama; localStorage
      // fallback. Kalau server kosong tapi localStorage ADA isi → seed sekali ke server
      // (mengangkat data lama yang masih tersimpan di device ini agar durable & lintas-device).
      const mcMerge = (rows, key, arrKeys) => {
        const out = {}; arrKeys.forEach(k => out[k] = []);
        (rows||[]).forEach(r => { const o = r?.[key] || {}; arrKeys.forEach(k => { if (Array.isArray(o[k])) out[k] = out[k].concat(o[k]); }); });
        return out;
      };
      let mcServerRows = null;
      if (supabase) {
        const { data: mcData_, error: mcErr_ } = await supabase.from("material_cadang_state").select("upt_id,data,health,ai");
        if (!mcErr_) mcServerRows = mcData_ || [];
      }
      if (mcServerRows && mcServerRows.length) {
        setMaterialCadangData(mcMerge(mcServerRows, "data", ["imports","analyses","applyHistory"]));
        setMaterialCadangHealthData(mcMerge(mcServerRows, "health", ["imports","analysisRuns","healthResults","applyAudit"]));
        setMaterialCadangAiInsights(mcMerge(mcServerRows, "ai", ["runs","materialInsights"]));
      } else {
        const lmcd = cmcd || { imports:[], analyses:[], applyHistory:[] };
        const lmch = cmch || { imports:[], analysisRuns:[], healthResults:[], applyAudit:[] };
        const lmcai = cmcai || { runs:[], materialInsights:[] };
        setMaterialCadangData(lmcd); setMaterialCadangHealthData(lmch); setMaterialCadangAiInsights(lmcai);
        const seedUpt = currentUser?.uptId || null;
        const hasLocal = (lmcd.analyses?.length || lmcd.imports?.length || lmch.analysisRuns?.length || lmch.healthResults?.length);
        if (supabase && seedUpt && hasLocal) {
          supabase.from("material_cadang_state").upsert({ upt_id: seedUpt, data: lmcd, health: lmch, ai: lmcai, updated_at: new Date().toISOString() }, { onConflict: "upt_id" });
        }
      }
      // Kapasitas Gudang — Supabase (warehouse_capacity/_imports) sekarang sumber
      // utama kalau sudah ada isinya; kalau masih kosong (instalasi lama yang baru
      // upgrade ke skema jsonb ini), dorong sekali data localStorage yang ada ke
      // Supabase supaya tidak hilang lagi (pola sama seperti katalog/stocks di atas).
      const gcapLocal = cgcap || [];
      const gcapiLocal = cgcapi || [];
      if (cgcapRemote === null) {
        // Fetch GAGAL — tampilkan lokal untuk UX, JANGAN push ke server.
        setGudangCapacityList(gcapLocal);
        loadFailures.push("Kapasitas Gudang");
      } else if (cgcapRemote.length > 0) {
        setGudangCapacityList(cgcapRemote);
        CLOUD.set("pln_gudang_capacity_v1", cgcapRemote); // refresh cache dgn data terbaru dari server
      } else {
        setGudangCapacityList(gcapLocal);
        if (gcapLocal.length > 0) syncWarehouseCapacity(gcapLocal);
      }
      if (cgcapiRemote === null) {
        // Fetch GAGAL — tampilkan lokal untuk UX, JANGAN push ke server.
        setGudangCapacityImports(gcapiLocal);
        loadFailures.push("Import Kapasitas Gudang");
      } else if (cgcapiRemote.length > 0) {
        setGudangCapacityImports(cgcapiRemote);
        CLOUD.set("pln_gudang_capacity_imports_v1", cgcapiRemote); // refresh cache dgn data terbaru dari server
      } else {
        setGudangCapacityImports(gcapiLocal);
        if (gcapiLocal.length > 0) syncWarehouseCapacityImports(gcapiLocal);
      }
      setMigratedTug15History(cmig || []);
      setMigrasiPendingReview(cmpr || []);
      if (loadFailures.length > 0) {
        showToastRef.current && showToastRef.current(`⚠️ Gagal memuat sebagian data dari cloud (${loadFailures.join(", ")}). Menampilkan data lokal sementara — JANGAN edit sampai refresh berhasil, untuk menghindari data lama menimpa data server.`, "error");
      }
      setLoading(false);
      stocksBootstrapUserIdRef.current = currentUser.id;
      setDataRefreshing(false);
    }
    loadCloud();
  }, [authLoading, currentUser?.id]);

  // Inspeksi Material Cadang bersifat database-canonical dan append-only;
  // sengaja tidak memakai cache/saveToCloud agar tidak ikut full sync state lama.
  useEffect(() => {
    if (authLoading || !currentUser) return;
    let active = true;
    loadMaterialInspections().then(items => {
      if (active && items !== null) setMaterialInspections(items);
    });
    loadMaterialInspectionBatches().then(batches => {
      if (active && batches !== null) setMaterialInspectionBatches(batches);
    });
    return () => { active = false; };
  }, [authLoading, currentUser?.id]);

  // saveToCloud now takes an overrides object. Any field not passed falls back
  // to the latest React state via stateRef (always up to date, avoids stale
  // closures without needing every call site updated when new fields are added).
  const stateRef = useRef({});
  const {
    heavyEquipmentList, setHeavyEquipmentList,
    heavyEquipmentLoans, setHeavyEquipmentLoans,
    saveHeavyEquipmentEdit,
    createHeavyEquipment,
    createHeavyEquipmentLoan,
    approveHeavyEquipmentLoan,
    rejectHeavyEquipmentLoan,
    completeHeavyEquipmentLoan,
  } = useHeavyEquipment({ currentUser, uptList, showToast, stateRef, logApprovalHistory });
  const {
    opnameList, setOpnameList,
    stockCountList, setStockCountList,
    opnameExpanded, setOpnameExpanded,
    opnameSubTab, setOpnameSubTab,
    saveOpname, submitOpname, approveOpname_Asman, approveOpname_Manager, rejectOpname, deleteOpname,
    addNonStockFoundItem,
    computeStockCountItems, previewStockCount, saveStockCountSession,
    approveStockCountItem, rejectStockCountItem, deleteStockCountSession,
  } = useStockOpname({ currentUser, showToast, stateRef, logApprovalHistory, katalogList, setKatalogList, stocks, setStocks, uploadStockFoto });
  const {
    katalogModal, setKatalogModal, katalogForm, setKatalogForm,
    openAddKatalog, openEditKatalog, saveKatalog, deleteKatalog,
    satpamModal, setSatpamModal, satpamForm, setSatpamForm,
    openAddSatpam, openEditSatpam, saveSatpam, deleteSatpam,
    timMutuModal, setTimMutuModal, timMutuForm, setTimMutuForm,
    openEditTimMutu, saveTimMutu,
    uitModal, setUitModal, uitForm, setUitForm,
    openAddUIT, openEditUIT, saveUIT, deleteUIT,
    uptModal, setUptModal, uptForm, setUptForm,
    openAddUPT, openEditUPT, saveUPT, deleteUPT,
    ultgModal, setUltgModal, ultgForm, setUltgForm,
    openAddULTG, openEditULTG, saveULTG, deleteULTG,
  } = useMasterDataCrud({ currentUser, showToast, stateRef, askConfirmDelete, katalogList, setKatalogList, stocks, satpamList, setSatpamList, timMutuList, setTimMutuList, uitList, setUitList, uptList, setUptList, ultgList, setUltgList });
  const {
    approvalHistoryList, setApprovalHistoryList,
    approvalTypeFilter, setApprovalTypeFilter,
    approvalPageSize, setApprovalPageSize,
    approvalStokPage, setApprovalStokPage,
    approvalStokGudangPage, setApprovalStokGudangPage,
    approvalEditStokPage, setApprovalEditStokPage,
    approvalHapusStokPage, setApprovalHapusStokPage,
    approvalAlatBeratPage, setApprovalAlatBeratPage,
    approvalOpnamePage, setApprovalOpnamePage,
    approvalStockCountPage, setApprovalStockCountPage,
    approvalHistoryPage, setApprovalHistoryPage,
    approveLokasiChange, rejectLokasiChange,
  } = useApprovalHub({ currentUser, showToast, stateRef, logApprovalHistory, lokasiList, setLokasiList });
  stateRef.current = { stocks, txns, docSeq, satpamList, katalogList, lokasiList, timMutuList, uitList, uptList, gudangList, subGudangList, rencanaKedatanganList, opnameList, stockCountList, approvalHistoryList, maturityAssessments, maturityAudits, maturityAuditHistory, maturity5SAssessments, heavyEquipmentList, heavyEquipmentLoans, attbList, materialCadangData, materialCadangHealthData, materialCadangAiInsights, gudangCapacityList, gudangCapacityImports, migratedTug15History, migrasiPendingReview, users, currentUser };

  const {
    lokasiModal, setLokasiModal, lokasiForm, setLokasiForm, lokasiDeleteConfirm, setLokasiDeleteConfirm,
    showGudangMaintenance, setShowGudangMaintenance,
    mapConfigSubGudangId, setMapConfigSubGudangId, pendingMapLokasiSub, setPendingMapLokasiSub, manualAddModeSub, setManualAddModeSub,
    showGudangDenahTools, setShowGudangDenahTools, expandedSubGudangToolsIds, setExpandedSubGudangToolsIds,
    selectedSubGudangId, setSelectedSubGudangId,
    openEditLokasi, isKodeDuplicateInSubGudang, syncLokasi, saveLokasi, requestDeleteLokasi, confirmDeleteLokasi,
    gudangModal, setGudangModal, gudangForm, setGudangForm,
    mapConfigGudangId, setMapConfigGudangId, pendingMapLokasi, setPendingMapLokasi, expandedGudangId, setExpandedGudangId,
    gudangWizardStep, setGudangWizardStep, wizardBlokDraft, setWizardBlokDraft, manualAddMode, setManualAddMode,
    capacityReviewImportId, setCapacityReviewImportId, capacityReviewCandidates, setCapacityReviewCandidates,
    capacityReviewDecisions, setCapacityReviewDecisions,
    openAddGudang, openEditGudang, closeGudangWizard, syncGudang, syncSubGudang,
    backfillGudangCoordFromCapacity, dedupeGudangDanSubGudang,
    startCapacityApproval, confirmCapacityApproval, rejectCapacityImport,
    saveGudang, gudangWizardNext, deleteGudang, addWizardBlok,
    uploadDenahGudang, updateOcrSuggestion, removeOcrSuggestion, confirmOcrSuggestions, uploadDenahSubGudang,
  } = useWarehouseConfig({
    currentUser, uptList, showToast, stateRef, askConfirmDelete, logApprovalHistory,
    gudangList, setGudangList, subGudangList, setSubGudangList, lokasiList, setLokasiList, stocks,
    gudangCapacityList, setGudangCapacityList, gudangCapacityImports, setGudangCapacityImports,
  });

  const {
    ocrSuggestions, setOcrSuggestions,
    ocrSuggestGudangId, setOcrSuggestGudangId,
    ocrSuggestSubGudangId, setOcrSuggestSubGudangId,
    denahLoading, setDenahLoading,
    denahSubLoading, setDenahSubLoading,
    runOcrOnDenah, runOcrOnDenahSub,
    suggestKodeFromOcr,
    assignLokasiKoordinat, assignLokasiKoordinatSub,
    resetLokasiKoordinat, resetLokasiKoordinatSub,
    dismissOcrSuggestions,
  } = useDenahOcr({ stateRef, setGudangList, setSubGudangList, lokasiList, setLokasiList, syncGudang, syncSubGudang, syncLokasi, showToast });
  // useWarehouseConfig dipanggil sebelum useDenahOcr ada (perlu syncGudang/syncSubGudang/syncLokasi
  // lebih dulu) — isi baru bisa dilewat lewat mutasi stateRef.current, bukan sbg argumen hook.
  stateRef.current.runOcrOnDenah = runOcrOnDenah;
  // useApprovalHub dipanggil sebelum syncLokasi ada (sama alasan) — approveLokasiChange/
  // rejectLokasiChange baca lewat stateRef.current.syncLokasi.
  stateRef.current.syncLokasi = syncLokasi;
  stateRef.current.runOcrOnDenahSub = runOcrOnDenahSub;
  stateRef.current.ocrSuggestions = ocrSuggestions;
  stateRef.current.setOcrSuggestions = setOcrSuggestions;
  stateRef.current.setDenahLoading = setDenahLoading;
  stateRef.current.setDenahSubLoading = setDenahSubLoading;

  // Realtime hanya untuk Data Stok. State/cachenya diperbarui dari event database,
  // tanpa saveToCloud(), agar echo write tidak mengirim ulang tabel/RAG ke server.
  useEffect(() => {
    if (authLoading || !currentUser || dataRefreshing || !supabase || stocksBootstrapUserIdRef.current !== currentUser.id) return;
    let disposed = false;
    let outageWarned = false;
    const sync = { active:false, queued:false, bufferedEvents:[] };

    const persistLeanStocks = next => { void CLOUD.set("pln_stocks_v4", leanStocks(next)); };
    const updateStocks = reducer => {
      setStocks(previous => {
        const next = reducer(previous);
        if (next !== previous) persistLeanStocks(next);
        return next;
      });
    };
    const warnOnce = message => {
      if (disposed || outageWarned) return;
      outageWarned = true;
      showToastRef.current?.(message, "error");
    };
    const applyEvent = payload => {
      if (sync.active) {
        sync.bufferedEvents.push(payload);
        return;
      }
      updateStocks(previous => applyStockRealtimeEvent(previous, payload));
    };
    const resyncStocks = async () => {
      if (disposed || (typeof navigator !== "undefined" && navigator.onLine === false)) return;
      if (sync.active) {
        sync.queued = true;
        return;
      }
      sync.active = true;
      try {
        const snapshot = await loadMasterTable("stocks");
        if (disposed) return;
        if (snapshot === null) {
          // Snapshot gagal: pertahankan state/cache yang sudah ada. Buffer dibuang
          // supaya retry berikutnya selalu dimulai dari sumber otoritatif baru.
          sync.bufferedEvents = [];
          warnOnce("Koneksi Data Stok belum pulih. Menampilkan data terakhir yang tersedia.");
          return;
        }
        const bufferedDuringSnapshot = sync.bufferedEvents;
        sync.bufferedEvents = [];
        updateStocks(previous => {
          const next = applyStockRealtimeEvents(snapshot, bufferedDuringSnapshot);
          return stockListsEqual(previous, next) ? previous : next;
        });
      } catch (error) {
        if (!disposed) {
          sync.bufferedEvents = [];
          console.error("Resync Realtime Data Stok gagal:", error);
          warnOnce("Koneksi Data Stok belum pulih. Menampilkan data terakhir yang tersedia.");
        }
      } finally {
        sync.active = false;
        if (disposed) return;
        // Event yang tiba setelah snapshot dipotong di atas harus tetap diterapkan
        // sebelum resync berikutnya, tanpa menunggu jaringan atau memicu write cloud.
        if (sync.bufferedEvents.length > 0) {
          const afterSnapshot = sync.bufferedEvents;
          sync.bufferedEvents = [];
          updateStocks(previous => applyStockRealtimeEvents(previous, afterSnapshot));
        }
        if (sync.queued) {
          sync.queued = false;
          void resyncStocks();
        }
      }
    };
    const requestResync = () => { void resyncStocks(); };
    const handleOnline = () => requestResync();
    const handleVisibility = () => {
      if (typeof document !== "undefined" && document.visibilityState === "visible") requestResync();
    };
    const channel = supabase
      .channel("warnoto-stocks-realtime")
      .on("postgres_changes", { event:"*", schema:"public", table:"stocks" }, applyEvent)
      .subscribe(status => {
        if (disposed) return;
        if (status === "SUBSCRIBED") {
          outageWarned = false;
          requestResync();
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          warnOnce("Koneksi realtime Data Stok terputus. Data akan disegarkan saat koneksi kembali.");
        }
      });
    if (typeof window !== "undefined") window.addEventListener("online", handleOnline);
    if (typeof document !== "undefined") document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      disposed = true;
      sync.bufferedEvents = [];
      if (typeof window !== "undefined") window.removeEventListener("online", handleOnline);
      if (typeof document !== "undefined") document.removeEventListener("visibilitychange", handleVisibility);
      void supabase.removeChannel(channel);
    };
  }, [authLoading, currentUser?.id, dataRefreshing]);
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
  // Param kedua `hints` (opsional, backward-compatible): kalau caller TAHU persis
  // baris mana saja yang berubah (mis. update lokasi 1 item Data Stok), ia bisa
  // memberi `{ stocksChangedRows: [...] }` / `{ stocksDeletedId: "..." }` /
  // `{ katalogChangedRows: [...] }` supaya sync ke Supabase cuma mengirim atau menghapus
  // baris itu (syncMasterTableRows/deleteMasterTableRow, ringan) alih-alih
  // seluruh tabel (syncMasterTable, yang untuk `stocks` bisa ~18.7MB gara-gara foto
  // base64 di jsonb). TANPA hint, perilaku PERSIS SAMA seperti sebelumnya (full sync,
  // termasuk reconciliation-delete) — hint HANYA dipakai untuk kasus "beberapa baris
  // spesifik berubah", BUKAN untuk kasus yang butuh deteksi banyak baris terhapus.
  const saveToCloud = useCallback(async (overrides = {}, hints = {}) => {
    const s = overrides.stocks ?? stateRef.current.stocks;
    const t = overrides.txns ?? stateRef.current.txns;
    const seq = overrides.docSeq ?? stateRef.current.docSeq;
    const kat = overrides.katalogList ?? stateRef.current.katalogList;
    const rk = overrides.rencanaKedatanganList ?? stateRef.current.rencanaKedatanganList;
    const opn = overrides.opnameList ?? stateRef.current.opnameList;
    const sc = overrides.stockCountList ?? stateRef.current.stockCountList;
    const ah = overrides.approvalHistoryList ?? stateRef.current.approvalHistoryList;
    const he = overrides.heavyEquipmentList ?? stateRef.current.heavyEquipmentList;
    const hel = overrides.heavyEquipmentLoans ?? stateRef.current.heavyEquipmentLoans;
    const attb = overrides.attbList ?? stateRef.current.attbList;
    const mcd = overrides.materialCadangData ?? stateRef.current.materialCadangData;
    const mch = overrides.materialCadangHealthData ?? stateRef.current.materialCadangHealthData;
    const mcai = overrides.materialCadangAiInsights ?? stateRef.current.materialCadangAiInsights;
    const gcap = overrides.gudangCapacityList ?? stateRef.current.gudangCapacityList;
    const gcapi = overrides.gudangCapacityImports ?? stateRef.current.gudangCapacityImports;
    const mig = overrides.migratedTug15History ?? stateRef.current.migratedTug15History;
    const mpr = overrides.migrasiPendingReview ?? stateRef.current.migrasiPendingReview;
    setCloudSaving(true);
    await Promise.all([
      CLOUD.set("pln_stocks_v4", leanStocks(s)), // cache lean (tanpa foto base64) — cegah QuotaExceededError
      CLOUD.set("pln_katalog_v4", kat),
      CLOUD.set("pln_txns_v3", t),
      CLOUD.set("pln_docseq_v3", seq),
      CLOUD.set("pln_rencana_v1", rk),
      CLOUD.set("pln_opname_v1", opn),
      CLOUD.set("pln_stockcount_v1", sc),
      CLOUD.set("pln_approval_history_v1", ah),
      CLOUD.set("pln_heavy_equipment_v1", he),
      CLOUD.set("pln_heavy_equipment_loans_v1", hel),
      CLOUD.set("pln_attb_v1", attb),
      CLOUD.set("pln_material_cadang_v1", mcd),
      CLOUD.set("pln_material_cadang_health_v1", mch),
      CLOUD.set("pln_material_cadang_ai_insights_v1", mcai),
      CLOUD.set("pln_gudang_capacity_v1", gcap),
      CLOUD.set("pln_gudang_capacity_imports_v1", gcapi),
      CLOUD.set("pln_migrated_tug15_v1", mig),
      CLOUD.set("pln_migrasi_pending_review_v1", mpr),
    ]);
    setLastSaved(Date.now());
    setCloudSaving(false);

    // Master Katalog & Data Stok — sumber utama sekarang Supabase (tabel katalog/stocks),
    // bukan cuma localStorage lagi (lihat catatan migrasi di schema.sql section 1/1b).
    // Disinkron langsung (tidak di-debounce) karena ini data inti aplikasi, bukan cuma
    // kebutuhan bot chat seperti stocks_snapshot/warnoto_state di bawah.
    // PENTING (2026-07-10): semua syncMasterTable di bawah ini WAJIB di-await lewat
    // Promise.all, bukan fire-and-forget — ditemukan bug nyata: tanpa await, saveToCloud()
    // resolve duluan (toast "tersimpan" muncul) sebelum request upsert ke Supabase betulan
    // selesai. Di localhost nyaris tidak kelihatan (round-trip cepat), tapi di Vercel kalau
    // user refresh (F5) sesaat setelah input, request yang masih in-flight ikut terputus dan
    // perubahan hilang saat reload (kejadian: lokasi item ATTB hilang lagi setelah F5).
    // Tiap task dicatat dengan label manusiawi (bukan cuma promise polos) supaya kalau
    // ada yang gagal, user bisa diberi tahu bagian mana yang gagal (lihat pengecekan
    // failedLabels di bawah) — ditemukan bug nyata 2026-07-21: syncMasterTable() bisa
    // return false (network error/RLS/dll) tapi hasilnya tidak pernah dicek, jadi toast
    // "berhasil" tetap muncul meski data sebenarnya gagal tersimpan ke Supabase.
    // Isi upt_id yang KOSONG dgn UPT penulis (akun scoped): stok tanpa upt_id yang lokasinya
    // tak resolve ke gudang ber-UPT tak bisa ditulis akun scoped (RLS can_access_upt(null)=false).
    // Hanya mengisi saat kosong — TIDAK pernah menimpa upt_id yang sudah ada. Penulis nasional
    // (uptId null) dibiarkan null karena mem-bypass RLS (SUPERADMIN/ADMIN_LOG_PUSAT).
    const writerUptId = stateRef.current.currentUser?.uptId || null;
    const extraColsStocks = item => ({ katalog_id: item.katalogId || null, lokasi_id: item.lokasiId || null, upt_id: item.uptId || writerUptId });
    const syncTasks = [];
    if (overrides.katalogList !== undefined) {
      // Kalau caller kasih hint baris katalog yang berubah → sync ringan (cuma baris itu),
      // tanpa reconciliation-delete. Kalau tidak → full sync seperti biasa (aman untuk
      // kasus yang butuh deteksi baris terhapus).
      const katHint = hints.katalogChangedRows;
      syncTasks.push({ label: "Master Katalog", promise: (Array.isArray(katHint) && katHint.length > 0)
        ? syncMasterTableRows("katalog", katHint)
        : syncMasterTable("katalog", kat) });
    }
    if (overrides.stocks !== undefined) {
      // Idem untuk Data Stok — ini kasus utama optimasi (tabel `stocks` paling berat).
      const stocksHint = hints.stocksChangedRows;
      const deletedStockId = hints.stocksDeletedId;
      syncTasks.push({ label: "Data Stok", promise: (Array.isArray(stocksHint) && stocksHint.length > 0)
        ? syncMasterTableRows("stocks", stocksHint, extraColsStocks)
        : deletedStockId
          ? deleteMasterTableRow("stocks", deletedStockId)
          : syncMasterTable("stocks", s, extraColsStocks) });
    }
    // Material Cadang — durable per-UPT di Supabase (dulu localStorage-only → hilang saat
    // Clear site data). Hanya untuk penulis ber-uptId (akun scoped); state mereka = data UPT
    // sendiri, jadi simpan utuh. Masuk failedLabels supaya kegagalan TIDAK senyap.
    const mcWriterUpt = stateRef.current.currentUser?.uptId || null;
    if ((overrides.materialCadangData !== undefined || overrides.materialCadangHealthData !== undefined || overrides.materialCadangAiInsights !== undefined) && supabase && !isDemoMode() && mcWriterUpt) {
      syncTasks.push({ label: "Material Cadang", promise: supabase.from("material_cadang_state")
        .upsert({ upt_id: mcWriterUpt, data: mcd, health: mch, ai: mcai, updated_at: new Date().toISOString() }, { onConflict: "upt_id" })
        .then(({ error }) => { if (error) console.error("upsert material_cadang_state:", error.message); return !error; }) });
    }
    // Kapasitas Gudang — sebelumnya localStorage/CLOUD-only, sekarang auto-backup
    // ke Supabase tiap kali berubah (lihat schema.sql section 10-11).
    if (overrides.gudangCapacityList !== undefined) syncTasks.push({ label: "Kapasitas Gudang", promise: syncWarehouseCapacity(gcap) });
    if (overrides.gudangCapacityImports !== undefined) syncTasks.push({ label: "Import Kapasitas Gudang", promise: syncWarehouseCapacityImports(gcapi) });
    // Alat Berat/Peminjaman UPT — sebelumnya localStorage/CLOUD-only (ditemukan saat
    // audit 2026-07-06), sekarang auto-backup ke Supabase tiap kali berubah (lihat
    // schema.sql section 21).
    if (overrides.heavyEquipmentList !== undefined) {
      const heHint = hints.heavyEquipmentChangedRows;
      syncTasks.push({ label: "Alat Berat", promise: (Array.isArray(heHint) && heHint.length > 0)
        ? syncMasterTableRows("heavy_equipment", heHint, e => ({ upt: e.upt || null }))
        : syncMasterTable("heavy_equipment", he, e => ({ upt: e.upt || null })) });
    }
    if (overrides.heavyEquipmentLoans !== undefined) syncTasks.push({ label: "Peminjaman Alat Berat", promise: (Array.isArray(hints.heavyEquipmentLoansChangedRows) && hints.heavyEquipmentLoansChangedRows.length > 0)
      ? syncMasterTableRows("heavy_equipment_loans", hints.heavyEquipmentLoansChangedRows, l => ({
        equipment_id: l.equipmentId || null,
        status: l.status || null,
        owner_upt: getHeavyEquipmentLoanOwnerUpt(l) || null,
        requester_upt: getHeavyEquipmentLoanRequesterUpt(l) || null,
      }))
      : syncMasterTable("heavy_equipment_loans", hel, l => ({
      equipment_id: l.equipmentId || null,
      status: l.status || null,
      owner_upt: getHeavyEquipmentLoanOwnerUpt(l) || null,
      requester_upt: getHeavyEquipmentLoanRequesterUpt(l) || null,
    })) });
    // ATTB (pipeline penghapusan aset material) — auto-backup ke Supabase tiap kali
    // berubah, pola sama seperti heavy_equipment (lihat schema.sql section 23).
    if (overrides.attbList !== undefined) syncTasks.push({ label: "ATTB", promise: syncMasterTable("attb_list", attb, e => ({ upt: e.upt || null, stage: e.stage || null })) });
    // Stock Opname & Stock Count — sebelumnya localStorage/CLOUD-only, ditemukan 2026-07-07
    // (widget akurasi Dashboard "hilang" kalau dibuka dari device/browser lain karena datanya
    // memang tidak pernah keluar dari localStorage device asal). Sekarang auto-backup ke
    // Supabase tiap kali berubah, pola sama seperti heavy_equipment (schema.sql section 22).
    // Probe read-only dulu. Sebelum migration kolom upt_id belum ada; jangan
    // mengirim kolom typed karena PostgREST akan menolak seluruh upsert (PGRST204).
    const stockScopeLive = !isDemoMode() && (overrides.opnameList !== undefined || overrides.stockCountList !== undefined)
      ? await stockScopeColumnsAvailable(supabase)
      : false;
    const stockScopeContext = { profiles: stateRef.current.users, currentUser: stateRef.current.currentUser };
    const scopedCols = item => stockScopeExtraCols(item, stockScopeContext, stockScopeLive);
    if (overrides.opnameList !== undefined) syncTasks.push({ label: "Stock Opname", promise: syncMasterTable("stock_opname", opn, o => ({ status: o.status || null, ...scopedCols(o) })) });
    if (overrides.stockCountList !== undefined) syncTasks.push({ label: "Stock Count", promise: syncMasterTable("stock_count", sc, scopedCols) });
    const syncResults = await Promise.all(syncTasks.map(task => task.promise));
    const failedLabels = syncTasks.filter((task, i) => syncResults[i] === false).map(task => task.label);
    if (failedLabels.length > 0) {
      showToast(`⚠️ Sebagian data gagal tersimpan ke cloud (${failedLabels.join(", ")}). Coba simpan ulang atau cek koneksi.`, "error");
    }

    // Auto-sync warnoto_state + RAG (bot WA/Telegram) kalau ada perubahan stocks/txns —
    // debounced 90 detik supaya tidak spam Cohere embed API tiap 1 saveToCloud.
    const cloudSyncOk = failedLabels.length === 0;
    if ((overrides.stocks !== undefined || overrides.txns !== undefined) && supabase) {
      if (autoSyncTimerRef.current) clearTimeout(autoSyncTimerRef.current);
      autoSyncTimerRef.current = setTimeout(async () => {
        try {
          await syncStocksSnapshot(true);
          await syncRagChunks(true);
          await syncWarnotoState(true);
        } catch (e) {
          console.error("Auto-sync bot WA/Telegram gagal:", e);
          // Jangan silent — kalau gagal (mis. Fortinet intercept warnoto.com), bot bisa
          // baca data basi berhari-hari tanpa Admin sadar. Throttle 10 menit sama seperti
          // auto-sync Supabase lain, supaya tidak spam toast tiap 90 detik selama down.
          const now = Date.now();
          if (now - (lastBotSyncErrorToastRef.current||0) > 10*60*1000) {
            lastBotSyncErrorToastRef.current = now;
            showToastRef.current && showToastRef.current(`⚠️ Auto-sync bot WA/Telegram gagal: ${e.message}`, "error");
          }
        }
      }, 90000);
    }
    return cloudSyncOk;
  }, []);
  // useHeavyEquipment dipanggil sebelum saveToCloud ada (lihat stateRef di atas) — isi
  // baru bisa dilewat lewat mutasi stateRef.current, bukan sbg argumen hook.
  stateRef.current.saveToCloud = saveToCloud;

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior:"smooth" }); }, [chatHistory]);
  useEffect(() => { setStockPage(1); }, [search, filterJenis, filterStatusSAP, stockPageSize, stockGudangSelect, stockBlokSelect, stockQuickFilter, stockSort, stockViewMode]);
  useEffect(() => { setKatalogPage(1); }, [katalogPageSize, katalogSearch]);

  // Auto-gabungkan Gudang/Sub Gudang duplikat sekali per sesi setelah data dimuat — supaya
  // denah/koordinat yang "nyasar" ke ID duplikat langsung ketemu tanpa perlu klik manual.
  useEffect(() => {
    if (dedupeGudangRanRef.current) return;
    if (loading) return;
    if (gudangList.length === 0) return;
    dedupeGudangRanRef.current = true;
    dedupeGudangDanSubGudang(true); // auto-run diam: jangan spam toast "tidak ada duplikat" tiap load
  }, [loading, gudangList]);

  // Peta Wilayah Gudang: scope ke UPT login (null = nasional, lihat semua)
  const petaScopeUptIds = getScopeUptIds(currentUser, uptList); // null=nasional
  const petaGudangList = petaScopeUptIds === null ? gudangList : gudangList.filter(g => petaScopeUptIds.includes(g.uptId));

  // Peta Wilayah Gudang UPT Surabaya — render/refresh marker Leaflet tiap kali Dashboard dibuka atau data gudang berubah
  useEffect(() => {
    if (tab !== "dashboard" || dashTab !== "ringkasan" || !petaWilayahDivRef.current || typeof window.L === "undefined") return;
    // Tab Dashboard di-unmount/mount ulang tiap pindah tab, jadi <div> peta selalu jadi node DOM baru —
    // kalau instance map lama masih nempel ke container lama (sudah lepas dari DOM), buang & buat ulang.
    if (petaWilayahMapRef.current && petaWilayahMapRef.current.getContainer() !== petaWilayahDivRef.current) {
      petaWilayahMapRef.current.remove();
      petaWilayahMapRef.current = null;
    }
    // Alamat (format Google Maps/Plus Code) dijadikan ACUAN UTAMA posisi di peta — bukan
    // g.lat/g.lng tersimpan, yang kadang datang dari kolom latitude/longitude di Excel import
    // Kapasitas Gudang dan bisa salah/ke-duplikat antar baris (kejadian nyata 2026-07-06: Gudang
    // BUDURAN & SURABAYA SELATAN kebetulan punya lat/lng identik dari Excel, marker-nya numpuk
    // persis di titik yang sama jadi kelihatan salah satu "tidak muncul"). Fallback ke g.lat/g.lng
    // kalau alamat tidak mengandung Plus Code (gudang lama yang alamatnya masih teks biasa).
    const gudangWithCoord = petaGudangList
      .map(g => ({ g, coord: extractLatLngFromAddress(g.alamat) || (g.lat!=null && g.lng!=null ? {lat:g.lat,lng:g.lng} : null) }))
      .filter(x => x.coord);
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
    gudangWithCoord.forEach(({g, coord}) => {
      const stockRows = stocks.filter(s=>{ const lok = lokasiList.find(l=>l.id===s.lokasiId); return lok?.gudangId===g.id; });
      const itemCount = stockRows.length;
      const totalQty = stockRows.reduce((a,s)=>a+(s.qty||0),0);
      const lastMaturity = maturityAssessments[0];
      window.L.marker([coord.lat, coord.lng], {icon:gudangIcon}).addTo(map._markersLayer)
        .bindPopup(`<b>🏭 ${g.nama}</b> (${g.kode})<br/>${g.alamat||"-"}<br/>${itemCount} baris stok • Total Qty: <b>${fmtNum(totalQty)}</b>${lastMaturity?`<br/>Maturity: Level ${lastMaturity.level} (${MATURITY_LEVELS[lastMaturity.level]})`:""}`);
    });
    const pts = gudangWithCoord.map(x => [x.coord.lat, x.coord.lng]);
    if (pts.length === 1) map.setView(pts[0], 13);
    else if (pts.length > 1) map.fitBounds(pts, { padding: [30, 30], maxZoom: 13 });
    setTimeout(()=>map.invalidateSize(), 100);
  }, [tab, dashTab, petaGudangList, stocks, lokasiList, maturityAssessments, currentUser]);

  // Toast error dibiarkan tampil lebih lama (5.5s) daripada sukses (3.5s) —
  // pesan error biasanya lebih panjang/penting untuk dibaca tuntas, terutama
  // di HP saat user sedang fokus mengisi form di lapangan.
  function showToast(msg, type="success") { setToast({msg,type}); setTimeout(()=>setToast(null), type==="error"?5500:3500); }
  showToastRef.current = showToast;

  const {
    txnModal, setTxnModal, txnForm, setTxnForm,
    editingDraftTxnId, setEditingDraftTxnId,
    tugGroup, setTugGroup,
    tug5ExpandedIdx, setTug5ExpandedIdx, tug5MaterialPage, setTug5MaterialPage,
    savingTxn, setSavingTxn, savingInfo,
    tug10Collapsed, setTug10Collapsed, tug10Highlight, tug10Refs,
    setMaterialPhoto, handleMaterialImg,
    openNewTxn, addItemRow, removeItemRow, updateItemRow,
    tug10Missing, flagTug10Invalid,
    saveTxn, commitNewTxn,
  } = useTugTransactions({
    currentUser, showToast, rolePerms,
    txns, setTxns, stocks, setStocks, katalogList, setKatalogList,
    docSeq, setDocSeq,
    uitList, uptList, ultgList, currentUserUptId,
    saveToCloud,
    canonicalActionKeysRef,
    stateRef,
  });

  async function handleLogin() {
    if (!loginForm.username.trim() || !loginForm.password) { setLoginErr("Username dan password wajib diisi."); return; }
    if (!supabase) {
      const usernameClean = loginForm.username.trim();
      const demoUser = {
        id: "DEMO-USER-001",
        name: usernameClean,
        username: usernameClean.toLowerCase(),
        role: "SUPERADMIN",
        jabatan: "Administrator (Mode Demo)",
        uptId: "UPT-SBY",
        upt: "Surabaya",
        gudangIds: [],
      };
      try { localStorage.setItem(SUPABASE_AUTH_STORAGE_KEY, "demo-local-token"); } catch {}
      writeCachedProfile(demoUser);
      setCurrentUser(demoUser);
      setAuthLoading(false);
      return;
    }
    setLoginBusy(true); setLoginErr("");
    const payload = {
      email: usernameToAuthEmail(loginForm.username),
      password: loginForm.password,
    };
    let error = null;
    try {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          const result = await _withTimeout(supabase.auth.signInWithPassword(payload), 15000, "login");
          error = result?.error || null;
        } catch (err) {
          error = err;
        }
        if (!error || attempt === 1 || !isRetryableLoginError(error)) break;
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    } finally {
      setLoginBusy(false);
    }
    // currentUser di-set oleh listener onAuthStateChange (lihat effect di bawah),
    // bukan di sini — supaya restore sesi (reload halaman) dan login manual
    // lewat jalur yang sama persis, tidak ada logic yang didobel.
    if (error) setLoginErr(describeLoginError(error));
  }

  function clearLocalAuthState() {
    stocksBootstrapUserIdRef.current = null;
    try { sessionStorage.removeItem("warnoto_tab"); } catch {}
    try { localStorage.removeItem(PROFILE_CACHE_KEY); localStorage.removeItem(LEGACY_PROFILE_CACHE_KEY); } catch {}
    try { localStorage.removeItem(SUPABASE_AUTH_STORAGE_KEY); } catch {}
    try { PHASE1_CACHE_KEYS.forEach(k => localStorage.removeItem('warnoto_' + k)); } catch {}
    try { PHASE2_CACHE_KEYS.forEach(k => localStorage.removeItem('warnoto_' + k)); } catch {}
    setCurrentUser(null); setUsers([]);
  }

  async function handleLogout() {
    setLoggingOut(true);
    // Putuskan akses UI/cache lebih dulu. Bila self-host sedang lambat, refresh
    // setelah klik Logout tetap tidak dapat memulihkan token atau data pengguna lama.
    clearLocalAuthState();
    try {
      if (supabase) {
        await Promise.race([
          supabase.auth.signOut(),
          new Promise((_, reject) => setTimeout(() => reject(new Error("logout timeout")), 5000)),
        ]);
      }
    } catch (err) {
      // Token sudah dibuang secara lokal; kegagalan revoke server tidak boleh
      // membuat pengguna tampak masih login.
      console.warn("Logout server tidak selesai, sesi lokal tetap dibersihkan.", err);
    } finally {
      if (supabase) await supabase.auth.signOut({ scope:"local" }).catch(() => {});
      // Kalau logout sukses, currentUser=null me-render app ke form login (komponen ini
      // unmount, state tidak sempat balik). finally ini menjaga tombol tidak stuck "Keluar..."
      // kalau signOut gagal di tengah jalan.
      setLoggingOut(false);
    }
  }

  async function reloadUsers() {
    if (!supabase) return;
    const { data: allProfiles } = await supabase.from("profiles").select("*");
    setUsers((allProfiles||[]).map(p => ({ id: p.id, name: p.name, username: p.username, role: p.role, jabatan: p.jabatan, avatar: p.avatar, uptId: p.upt_id, ultgId: p.ultg_id, uitId: p.uit_id, gudangIds: p.gudang_ids })));
  }

  // Muat override izin per role (RBAC) dari Supabase. Latar belakang, tidak
  // memblokir startup — sampai selesai, can() jatuh ke DEFAULT_PERMS.
  async function reloadRolePerms() {
    if (!supabase) return;
    const { data } = await supabase.from("role_permissions").select("role, perms");
    const map = {};
    (data||[]).forEach(r => { if (r.role) map[r.role] = r.perms || {}; });
    setRolePerms(map);
  }

  // Refresh kapasitas gudang in-place setelah sinkron dari Sheet (hindari
  // window.location.reload). Reuse mapper loadWarehouseCapacity yang sama
  // dengan startup load (App.jsx L593 masterLoads).
  async function reloadKapasitas() {
    const fresh = await loadWarehouseCapacity();
    if (fresh !== null) {
      setGudangCapacityList(fresh);
      CLOUD.set("pln_gudang_capacity_v1", fresh);
    }
  }

  // Kelola Akun + ganti password mandiri → dipindah ke src/hooks/useAccountAdmin.js

  // Pulihkan sesi Supabase Auth yang tersimpan saat app dibuka (reload, buka
  // tab baru, dst), dan dengarkan event login/logout — satu listener ini
  // menangani SEMUA transisi auth (initial load, login manual, logout),
  // supaya currentUser & users selalu konsisten dari satu sumber.
  // Pola cache-first: currentUser sudah terisi dari localStorage sebelum effect
  // ini jalan (lihat readCachedProfile di atas) supaya "Memuat sesi..." tidak
  // menunggu network; profil di-refresh di latar belakang lewat callback ini,
  // dan kalau sesi ternyata tidak valid/tidak ada, user otomatis logout + cache dibuang.
  useEffect(() => {
    if (!supabase) { setAuthLoading(false); return; }
    // Callback TIDAK async — supabase-js memperingatkan callback async di
    // onAuthStateChange bisa deadlock lock auth internal. Kerjaan async
    // dilempar ke handleAuthSession (fire-and-forget).
    async function handleAuthSession(session, event) {
      if (session?.user) {
        let profile = null;
        let profErr = null;
        // Error jaringan/proxy saat bootstrap bukan bukti bahwa profil hilang.
        // Retry singkat lalu pertahankan cache dan sesi; logout hanya bila query
        // sukses tapi memang tidak menemukan profil, atau Auth mengirim sesi kosong.
        for (let attempt = 0; attempt < 2; attempt++) {
          const result = await supabase.from("profiles").select("*").eq("id", session.user.id).maybeSingle();
          profile = result.data;
          profErr = result.error;
          if (!profErr) break;
          if (attempt === 0) await new Promise(resolve => setTimeout(resolve, 350));
        }
        if (profErr) {
          console.warn("Profil sesi belum dapat dimuat; mempertahankan sesi/cache.", profErr);
        } else if (!profile) {
          setLoginErr("Akun ini belum punya profil (hubungi Admin). Logout otomatis.");
          await supabase.auth.signOut();
          clearLocalAuthState();
        } else {
          // Resolusi upt_id (FK ke tabel upt) jadi nama pendek UPT (mis. "Malang") supaya scoping
          // Alat Berat mengunci user ke UPT-nya sendiri. Tanpa ini semua fallback jatuh ke const
          // UPT "Surabaya" hardcoded. uptList bisa belum ke-load saat login pertama → pakai DEFAULT.
          const uptMatch = (uptList.length ? uptList : DEFAULT_UPT_LIST).find(u => u.id === profile.upt_id);
          const userObj = { id: profile.id, name: profile.name, username: profile.username, role: profile.role, jabatan: profile.jabatan, avatar: profile.avatar, uptId: profile.upt_id, upt: uptMatch ? uptMatch.nama.replace(/^UPT\s+/i, "").trim() : undefined, ultgId: profile.ultg_id, uitId: profile.uit_id, gudangIds: profile.gudang_ids };
          setCurrentUser(userObj);
          Sentry.setUser({ id: userObj.id, username: userObj.username });
          Sentry.setTag("role", userObj.role);
          Sentry.setTag("upt", userObj.upt);
          writeCachedProfile(userObj);
          // LOGIN dicatat cuma untuk login manual (SIGNED_IN) — bukan INITIAL_SESSION
          // (buka tab/reload dgn sesi tersimpan) atau TOKEN_REFRESHED (refresh token
          // tiap jam), supaya audit log tidak dibanjiri entri yang bukan aksi user nyata.
          if (event === "SIGNED_IN") logAudit(userObj, "LOGIN", "auth");
          // Daftar SEMUA user (hanya dipakai layar Admin/Master Data) TIDAK memblokir
          // layar "Memuat sesi..." — dimuat di latar belakang supaya app langsung tampil.
          supabase.from("profiles").select("*").then(({ data: allProfiles }) => {
            setUsers((allProfiles||[]).map(p => ({ id: p.id, name: p.name, username: p.username, role: p.role, jabatan: p.jabatan, avatar: p.avatar, uptId: p.upt_id, ultgId: p.ultg_id, uitId: p.uit_id, gudangIds: p.gudang_ids })));
          });
          reloadRolePerms();
        }
      } else {
        clearLocalAuthState();
      }
      setAuthLoading(false);
    }
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      handleAuthSession(session, _event);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  // RBAC guard render: kalau role tidak (lagi) punya izin menu untuk tab aktif
  // (mis. Admin mencabut via Matrix Izin), lempar balik ke Dashboard. Selama
  // rolePerms belum termuat, can() jatuh ke DEFAULT_PERMS (perilaku existing).
  useEffect(() => {
    if (currentUser && tab !== "dashboard" && !can(currentUser, "menu." + tab, rolePerms)) setTab("dashboard");
  }, [tab, currentUser, rolePerms]);

  // Role ULTG cuma punya subnav Reservasi (TUG5). Default state app = penerimaan/TUG3
  // → refresh di tab TUG menampilkan TUG-3/10 yang tidak relevan. Clamp ke permintaan/TUG5.
  useEffect(() => {
    if (!currentUser || !ULTG_ROLES.includes(currentUser.role)) return;
    if (tugGroup !== "permintaan") setTugGroup("permintaan");
    if (tugSubTab !== "TUG5") setTugSubTab("TUG5");
  }, [currentUser, tugGroup, tugSubTab]);

  // Refresh transaksi TUG canonical dari server tiap kali tab Approval dibuka.
  // tug_transactions TIDAK punya realtime subscription (beda dari stocks) dan cuma
  // di-load sekali saat login — kalau approver lain (mis. TL) baru approve di
  // sesi/tab lain, versi lokal di sini basi dan approve/reject berikutnya ditolak
  // server (TUG_VERSION_MISMATCH) walau kartunya masih tampil seolah pending di UI.
  // Refetch saat buka tab ini menutup celah itu tanpa perlu realtime penuh.
  useEffect(() => {
    if (tab !== "approval" || !currentUser) return;
    let alive = true;
    loadCanonicalTugTransactions().then(res => {
      if (!alive || res.unavailable) return;
      setTxns(prev => [...prev.filter(t => !t.canonical), ...res.rows]);
    }).catch(err => console.warn("Refresh TUG canonical gagal saat buka tab Approval.", err));
    return () => { alive = false; };
  }, [tab, currentUser]);

  // Simpan tab aktif ke sessionStorage supaya refresh halaman tetap di menu yang
  // sama (per-tab-browser, sama seperti pola Mode Demo di src/lib/demo.js).
  useEffect(() => {
    try { sessionStorage.setItem("warnoto_tab", tab); } catch {}
  }, [tab]);

  // Auto-sync foto transaksi yang belum ter-upload (mis. submit saat offline di
  // gudang). Dicoba saat app load, saat daftar transaksi berubah, dan saat koneksi
  // kembali online. Guard + cek _fotoPending mencegah loop.
  const syncPendingTxnPhotos = useCallback(async () => {
    if (syncingPhotosRef.current || !supabase) return;
    if (typeof navigator !== "undefined" && navigator.onLine === false) return;
    const list = stateRef.current.txns || [];
    if (!list.some(x => x._fotoPending)) return;
    syncingPhotosRef.current = true;
    try {
      let changed = false;
      const updated = [];
      for (const x of list) {
        if (!x._fotoPending) { updated.push(x); continue; }
        const { data } = await processTxnPhotos(x, x.id || `TXN-${x.docSeq}`);
        updated.push(data); if (data !== x) changed = true;
      }
      if (changed) { setTxns(updated); await saveToCloud({ txns: updated }); }
    } finally { syncingPhotosRef.current = false; }
  }, [saveToCloud]);

  useEffect(() => {
    syncPendingTxnPhotos();
    const on = () => syncPendingTxnPhotos();
    window.addEventListener("online", on);
    return () => window.removeEventListener("online", on);
  }, [syncPendingTxnPhotos, txns]);

  // Saat preview dokumen dibuka, ubah SIM/KTP "priv:<path>" jadi signed URL supaya
  // tampil di iframe & ikut saat diunduh (foto lain sudah URL publik).
  useEffect(() => {
    let alive = true;
    if (!docPreview) { setDocPreviewDoc(null); return; }
    resolveTxnPrivPhotos(docPreview).then((r) => { if (alive) setDocPreviewDoc(r); });
    return () => { alive = false; };
  }, [docPreview]);

  // ── Stock CRUD ──
  // ── MASTER KATALOG BARANG CRUD ── (openAdd/openEdit/save/delete di useMasterDataCrud.jsx)
  async function searchMaraCatalog(q) {
    setMaraSearch(q);
    if (!q || q.trim().length < 2) { setMaraSearchResults([]); return; }
    if (!supabase) { showToast("Supabase tidak terhubung","error"); return; }
    setMaraSearchLoading(true);
    // Pencarian per-kata (AND antar kata, OR sinonim dalam kata) — order/format-independent.
    // Kamus sinonim PLN (mis. "pemutus"->"cb") ikut di sisi query lewat maraQueryGroups.
    const { data, error } = await applyMaraNameSearch(
      supabase.from("mara_catalog").select("kode_material,nama,satuan,material_group,material_group_desc"),
      q
    ).limit(20);
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
    // belumDicocokkanMara: kalau katalog ini sebelumnya kode fallback Non-Stock dari opname
    // (lihat addNonStockFoundItem) yang belum sempat dicocokkan, sekarang sudah ketemu —
    // flag-nya dilepas. id (dipakai QR) TIDAK berubah, jadi label fisik yang sudah ditempel tetap valid.
    setKatalogForm(kf=>({...kf, katalog: item.kode_material||kf.katalog, name: item.nama||kf.name, satuan: item.satuan||kf.satuan, category: item.material_group_desc||item.material_group||kf.category, _maraLocked: true, belumDicocokkanMara: false }));
    setMaraSearchResults([]);
    setMaraSearch("");
  }
  async function uploadMaraToDB(file) {
    if (isDemoMode()) { showToast("Mode demo: import tidak disimpan.", "info"); return; }
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
          material_group_desc: String(r["Material Group Desc"]||"").trim(),
          satuan: String(r["Base Unit of Measure"]||"").trim(),
          status: String(r["X-plant matl status"]||"").trim(),
          nama: String(r["Material Description"]||"").trim(),
        })).filter(r=>r.kode_material&&r.nama);
        const { error } = await supabase.from("mara_catalog").upsert(chunk, {onConflict:"kode_material"});
        if (error) { showToast("Error upload chunk: "+error.message,"error"); break; }
        done += chunk.length;
        setMaraUploadProgress(`Mengupload... ${done.toLocaleString()} / ${total.toLocaleString()}`);
      }
      logAudit(currentUser, "IMPORT", "mara_catalog", null, {rows: done});
      showToast(`✅ ${done.toLocaleString()} material MARA berhasil disimpan ke database.`, "success");
      setMaraUploadProgress(null);
    } catch(e) {
      showToast("Gagal upload MARA: "+e.message, "error");
      setMaraUploadProgress(null);
    }
    setMaraUploadLoading(false);
  }
  // ── MASTER LOKASI GUDANG CRUD, Gudang/Sub Gudang CRUD, denah-tools, Kapasitas Gudang ──
  // dipindah ke src/hooks/useWarehouseConfig.jsx (2026-08-09).

  // Catat 1 keputusan approval (disetujui/ditolak) ke riwayat — dipakai oleh
  // semua jenis approval non-TUG (TUG sudah punya jejaknya sendiri di txns).
  async function logApprovalHistory(entry) {
    const nh = [{ id:`AH-${uid().slice(-8)}`, decidedBy:currentUser.id, decidedAt:Date.now(), ...entry }, ...approvalHistoryList].slice(0, 300);
    setApprovalHistoryList(nh);
    await saveToCloud({approvalHistoryList: nh});
    logAudit(currentUser, entry.decision==="REJECTED"?"REJECT":"APPROVE", entry.docType || entry.type || "approval", entry.refId ?? null, entry);
  }

  // approveLokasiChange/rejectLokasiChange dipindah ke useApprovalHub (2026-08-10).

  // Approve/reject pengajuan pemindahan gudang Data Stok — 1 per 1, bukan bulk.
  async function approveStockMove(id) {
    const st = stocks.find(s=>s.id===id);
    if (!st || !st.lokasiMovePending) return;
    const lokSel = lokasiList.find(l=>l.id===st.pendingLokasiId);
    const lokAsal = lokasiList.find(l=>l.id===st.lokasiId);
    if (!lokSel) {
      showToast("Lokasi tujuan tidak ditemukan. Pengajuan tidak diubah.", "error");
      return;
    }
    const ns = stocks.map(s=>s.id===id ? approveStockLocationMove(s, lokSel, currentUser.id) : s);
    setStocks(ns); await saveToCloud({stocks:ns}, {stocksChangedRows: ns.filter(s=>s.id===id)});
    await logApprovalHistory({type:"STOCK_MOVE", decision:"APPROVED", title:`${st.name}: ${lokAsal?.kode||"—"} → ${st.pendingLokasiKode}`, requestedBy:st.moveRequestedBy, requestedAt:st.moveRequestedAt});
    showToast(`✅ Pemindahan gudang ${st.name} disetujui.`);
  }
  async function rejectStockMove(id) {
    const st = stocks.find(s=>s.id===id);
    if (!st || !st.lokasiMovePending) return;
    const lokAsal = lokasiList.find(l=>l.id===st.lokasiId);
    await logApprovalHistory({type:"STOCK_MOVE", decision:"REJECTED", title:`${st.name}: ${lokAsal?.kode||"—"} → ${st.pendingLokasiKode}`, requestedBy:st.moveRequestedBy, requestedAt:st.moveRequestedAt});
    const ns = stocks.map(s=>s.id===id ? rejectStockLocationMove(s) : s);
    setStocks(ns); await saveToCloud({stocks:ns}, {stocksChangedRows: ns.filter(s=>s.id===id)});
    showToast(`❌ Pemindahan gudang ${st.name} ditolak.`);
  }

  // Kartu kecil untuk 1 Blok Lokasi — dipakai di halaman Master Gudang (per gudang & blok tanpa gudang)
  function renderLokasiCard(l) {
    const used = lokasiUsedCapacity(l.id, stocks);
    const pct = l.kapasitas > 0 ? Math.min(100, (used/l.kapasitas)*100) : 0;
    const barC = pct>=90?C.red:pct>=70?C.yellow:C.green;
    const isPending = l.status==="PENDING";
    return (
      <div key={l.id} style={{...sty.card,borderTop:`3px solid ${isPending?C.yellow:barC}`,opacity:isPending?0.85:1}}>
        <div style={{fontWeight:700,fontSize:14}}>📍 {l.kode} {isPending && <span style={{fontSize:12,fontWeight:700,color:"#92400e",background:"#fef3c7",padding:"1px 6px",borderRadius:6,marginLeft:6}}>⏳ Menunggu Approval ({ {ADD:"Baru",EDIT:"Edit",DELETE:"Hapus"}[l.pendingAction] })</span>}</div>
        <div style={{fontSize:12,color:C.muted,marginTop:2}}>{l.id}</div>
        <div style={{fontSize:12,color:C.muted,marginTop:4}}>{l.keterangan||"-"}</div>
        <div style={{marginTop:10,marginBottom:10}}>
          <div style={{display:"flex",justifyContent:"space-between",fontSize:12,marginBottom:3}}>
            <span style={{fontWeight:600}}>Kapasitas Terpakai</span>
            <span style={{color:barC,fontWeight:700}}>{fmtNum(used)} / {fmtNum(l.kapasitas)}</span>
          </div>
          <div style={{background:"#f3f4f6",borderRadius:20,height:8}}><div style={{width:`${pct}%`,background:barC,height:"100%",borderRadius:20}}/></div>
          {pct>=90 && <div style={{fontSize:12,color:C.red,marginTop:4,fontWeight:600}}>⚠️ Lokasi hampir penuh!</div>}
        </div>
        {hasRole(currentUser, "ADMIN") && (
          <div style={{display:"flex",gap:6}}>
            <button style={{...sty.btn("ghost","sm"),flex:1}} onClick={()=>openEditLokasi(l)} disabled={isPending}>✏️ Edit</button>
            <button style={{...sty.btn("danger","sm"),flex:1}} onClick={()=>requestDeleteLokasi(l)} disabled={isPending}>🗑️ Hapus</button>
          </div>
        )}
      </div>
    );
  }

  // ── DATA STOK CRUD (junction: katalog x lokasi, qty/harga/jenis) ──
  // openAddStock (tombol "+ Tambah Data Stok") dihapus 2026-07-02 — kebijakan bisnis: semua
  // material masuk WAJIB lewat TUG (TUG-3/9/dst), tidak boleh input langsung ke Data Stok.
  // stockModal/saveStock tetap ada, cuma dipakai "edit" sekarang (lihat openEditStock).
  function openEditStock(s) { setStockForm({...s}); stockFormSnapshotRef.current = {...s}; setStockModal("edit"); }
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
    // Foto ke Storage DULU (sebelum percabangan approval — foto memang tidak butuh
    // approval TL). Kalau upload gagal, batalkan simpan: lebih baik user ulang
    // daripada base64 mentah masuk jsonb stocks.data lagi.
    let sf = stockForm;
    try {
      for (const f of ["fotoNameplate","fotoKeseluruhan"])
        if (_isDataUrl(sf[f])) sf = {...sf, [f]: await uploadStockFoto(sf.katalogId, f, sf[f], sf.uptId)};
    } catch (e) {
      console.warn("Upload foto Data Stok gagal:", sf.id, e?.message||e);
      showToast("Gagal upload foto ke server, coba lagi.","error"); return;
    }
    // Identitas barang (name/katalog/satuan/category) hanya boleh berasal dari
    // Master Katalog terpilih — re-derive di sini supaya tidak pernah desync
    // (bug lama: ganti barang via SearchableSelect ubah name tapi katalog/satuan tertinggal).
    const kat = katalogList.find(k=>k.id===sf.katalogId);
    if (kat) sf = {...sf, name:kat.name, katalog:kat.katalog, unit:kat.satuan||sf.unit, category:kat.category||sf.category};
    let ns;
    let wentToApproval = false;
    if (stockModal==="edit") {
      const original = stocks.find(s=>s.id===sf.id) || {};
      const isTL = hasRole(currentUser, "TL");
      const identityChanged = original.katalogId !== sf.katalogId; // ganti barang (name+katalog+satuan sekaligus)
      const otherChanged = original.price!==sf.price || original.jenisBarang!==sf.jenisBarang;
      const fieldsChanged = identityChanged || otherChanged;
      if (fieldsChanged && !isTL) {
        wentToApproval = true;
        // barang/harga/jenis butuh approval TL — field lain (lokasi, minQty, foto) tetap langsung tersimpan
        const updated = {
          ...sf,
          katalogId: original.katalogId, name: original.name, katalog: original.katalog, unit: original.unit, category: original.category,
          price: original.price, jenisBarang: original.jenisBarang,
          editPending: true,
          pendingEditData: { katalogId: sf.katalogId, name: sf.name, katalog: sf.katalog, unit: sf.unit, category: sf.category, price: sf.price, jenisBarang: sf.jenisBarang },
          editRequestedBy: currentUser.id, editRequestedAt: Date.now(),
        };
        ns = stocks.map(s=>s.id===sf.id?updated:s);
      } else {
        ns = stocks.map(s=>s.id===sf.id?{...sf, editPending:false, pendingEditData:null}:s);
      }
    }
    else ns = [...stocks, {...sf, createdAt:Date.now()}];
    setStocks(ns); setStockModal(null);
    // Hanya 1 baris berubah (edit/tambah baris id===sf.id) — sync ringan cuma baris itu.
    await saveToCloud({stocks: ns}, {stocksChangedRows: ns.filter(s=>s.id===sf.id)});
    logAudit(currentUser, stockModal==="edit"?"UPDATE":"CREATE", "stocks", sf.id, {katalogId:sf.katalogId, lokasiId:sf.lokasiId, wentToApproval});
    showToast(wentToApproval ? "📨 Perubahan barang (nama/no katalog/satuan)/harga/jenis diajukan! Menunggu approval TL." : (stockModal==="edit" ? "Data Stok diupdate!" : "Data Stok baru ditambahkan!"));
  }
  // Foto Data Stok WAJIB disimpan sebagai URL Supabase Storage, JANGAN base64 mentah
  // ke jsonb `stocks.data` (insiden 2026-07-23 & 2026-07-28: tabel stocks 119KB → 12MB,
  // GET /stocks lambat → snapshot realtime gagal → "koneksi realtime terputus").
  // Melempar kalau upload gagal — pemanggil WAJIB membatalkan simpan, bukan fallback base64.
  async function uploadStockFoto(katalogId, field, img, uptId) {
    if (!_isDataUrl(img) || isDemoMode()) return img; // sudah URL Storage / mode demo (tidak menulis Storage)
    const kode = String(katalogId || "tanpa-katalog").replace(/^KAT-/, "");
    // Folder per-UPT supaya foto stok antar-UPT tidak saling menimpa (dulu hardcode
    // "upt-surabaya/" → dua UPT dgn katalog sama menulis path yang sama). Foto lama di
    // path lama tetap valid: URL tersimpan menunjuk file lama, file tidak dipindah.
    const uptFolder = String(uptId || "upt-tanpa").toLowerCase();
    const path = `${uptFolder}/${kode}/${field==="fotoNameplate"?"tambahan":"utama"}.jpg`;
    return _withTimeout(uploadPhotoToStorage(await compressImage(img, {maxBytes:1_000_000}), "stock-photos", path), 30_000, "unggah foto");
  }
  // Upload langsung foto Nameplate/Keseluruhan dari modal detail (klik baris Data Stok) — khusus Admin/TL
  // Return true kalau tersimpan, false kalau upload gagal (foto pending jangan dibuang).
  async function updateStockFoto(id, field, img) {
    let url;
    try { const st = stocks.find(s=>s.id===id); url = await uploadStockFoto(st?.katalogId, field, img, st?.uptId); }
    catch (e) {
      console.warn("Upload foto Data Stok gagal:", id, field, e?.message||e);
      showToast("Gagal upload foto ke server, coba lagi.","error"); return false;
    }
    let ns = stocks.map(s=>s.id===id?{...s,[field]:url}:s);
    setStocks(ns);
    // Foto = payload paling berat; cuma 1 baris berubah → sync ringan baris itu saja.
    // saveToCloud return false kalau write ke Supabase gagal (401 sesi expired/RLS/network) —
    // dulu return-nya diabaikan sehingga toast "berhasil" tetap muncul & pendingFoto dibuang
    // meski DB tak berubah (bug "upload berhasil tapi data tak berubah"). Sekarang dihormati:
    // saveToCloud sudah tampilkan toast bagian mana yang gagal, jadi di sini cukup return false
    // supaya pendingFoto TIDAK dibuang (user bisa simpan ulang).
    const savedOk = await saveToCloud({stocks: ns}, {stocksChangedRows: ns.filter(s=>s.id===id)});
    if (!savedOk) return false;
    showToast(`📷 ${field==="fotoNameplate"?"Foto Nameplate":"Foto Keseluruhan"} diperbarui!`);
    // Nameplate: OCR teksnya sekali & cache di fotoNameplateOcr, supaya foto ini
    // ikut jadi pembanding di pencarian foto mode Nameplate tanpa OCR ulang tiap cari.
    if (field==="fotoNameplate" && img && import.meta.env.VITE_OCRSPACE_API_KEY) {
      try {
        const text = await ocrSpaceOCR(img);
        ns = ns.map(s=>s.id===id?{...s,fotoNameplateOcr:text}:s);
        setStocks(ns);
        await saveToCloud({stocks: ns}, {stocksChangedRows: ns.filter(s=>s.id===id)});
      } catch (e) {
        // Senyap: user tak perlu tahu soal OCR. Foto tetap tersimpan; kalau OCR
        // gagal, foto ini nanti ikut disapu ulang oleh auto-OCR latar belakang.
        console.warn("Auto-OCR nameplate (upload) gagal:", id, e?.message||e);
      }
    }
    return true;
  }
  // Auto-OCR nameplate di LATAR BELAKANG (senyap) — tanpa tombol/aksi user. Menyapu
  // foto Nameplate yang belum punya fotoNameplateOcr (mis. foto lama sebelum fitur
  // ini) supaya ikut jadi pembanding pencarian foto mode Nameplate. Sekuensial +
  // jeda 400ms (rate limit free tier OCR.space ~3 req/detik), simpan tiap 8 item
  // pakai stateRef terkini agar hemat write & tak menimpa editan stok yang berjalan.
  const nameplateAutoOcrRef = useRef(false); // guard: cukup sekali per sesi
  async function runAutoOcrNameplates() {
    const flush = async (updates) => {
      if (!updates.size) return;
      const ns = stateRef.current.stocks.map(s => updates.has(s.id) ? {...s, fotoNameplateOcr: updates.get(s.id)} : s);
      setStocks(ns);
      // Cuma baris ber-`updates` yang berubah (bukan seluruh tabel) → sync ringan baris itu saja.
      await saveToCloud({ stocks: ns }, {stocksChangedRows: ns.filter(s => updates.has(s.id))});
      updates.clear();
    };
    // `== null` (bukan sekadar falsy): foto yang sudah di-OCR tapi hasilnya kosong
    // (nameplate tak terbaca) menyimpan "" — itu tetap dianggap SUDAH diproses, jadi
    // tidak di-OCR ulang tiap sesi. Hanya null/undefined = benar-benar belum diproses.
    const targets = (stateRef.current.stocks || []).filter(s => s.fotoNameplate && s.fotoNameplateOcr == null);
    const pending = new Map();
    for (const st0 of targets) {
      const cur = stateRef.current.stocks.find(s => s.id === st0.id); // versi terkini
      if (!cur || !cur.fotoNameplate || cur.fotoNameplateOcr != null) continue;
      try {
        pending.set(cur.id, await ocrSpaceOCR(resolveStockPhotoUrl(cur.fotoNameplate)));
      } catch (e) {
        console.warn("Auto-OCR nameplate gagal:", st0.id, e?.message||e);
        continue;
      }
      if (pending.size >= 8) await flush(pending);
      await new Promise(r => setTimeout(r, 400));
    }
    await flush(pending);
  }
  // Pemicu auto-OCR nameplate: jalan sekali (guard ref) begitu data stok siap &
  // ada foto nameplate lama yang belum di-OCR. Hanya Admin/TL (yang berhak menulis
  // data stok) & hanya kalau key OCR terpasang. Sepenuhnya latar belakang/senyap.
  useEffect(() => {
    if (nameplateAutoOcrRef.current) return;
    if (!import.meta.env.VITE_OCRSPACE_API_KEY) return;
    if (!hasRole(currentUser, "ADMIN","TL")) return;
    if (!stocks.some(s => s.fotoNameplate && s.fotoNameplateOcr == null)) return;
    nameplateAutoOcrRef.current = true;
    runAutoOcrNameplates();
  }, [stocks, currentUser]);

  // Cari barang dengan foto — dua mode:
  //  • "bentuk"   : embed foto query (Cohere image) → cocokkan ke stock_photo_embeddings
  //                 via RPC match_stock_photos (skor tertinggi per katalog, ≥75%, top 10).
  //                 p_upt=null di RPC (katalog lintas-UPT); filter UPT client-side lewat
  //                 allowedKatalog (katalog yang punya stok di scope efektif / stockUptFilter).
  //  • "nameplate": OCR.space baca teks nameplate di foto → cocokkan ke Master
  //                 Katalog (nomor katalog/nama/type/merk) DAN ke teks foto
  //                 nameplate tersimpan (fotoNameplateOcr) — matchNameplateAll.
  async function runPhotoSearch() {
    if (!photoSearchImg) return;
    setPhotoSearchLoading(true);
    try {
      // Katalog hasil pencarian = master lintas-UPT. Filter benar = "katalog yang punya
      // stok dalam scope efektif" (stockUptFilter kalau dipilih, else getScopeUptIds).
      const uptOf = (s) => {
        const gid = lokasiList.find(l => l.id === s.lokasiId)?.gudangId || s.gudangId || null;
        // Mirror RLS COALESCE(resolve lokasi->gudang.upt_id, stocks.upt_id): stok tanpa gudang
        // (mis. material Gresik belum di-assign lokasi) tetap terpetakan ke UPT-nya lewat s.uptId.
        return (gid ? gudangList.find(g => g.id === gid)?.uptId : null) || s.uptId || null;
      };
      const scope = getScopeUptIds(currentUser, uptList);
      const allowedKatalog = new Set(
        stocks
          .filter(s => stockUptFilter ? uptOf(s) === stockUptFilter : inScopeUpt(uptOf(s), scope))
          .map(s => String(s.katalog))
          .filter(k => k && k !== "undefined" && k !== "null")
      );
      const keepInScope = (rows) => (rows || []).filter(r => allowedKatalog.has(String(r.katalog)));

      if (photoSearchMode === "nameplate") {
        const text = await ocrSpaceOCR(photoSearchImg);
        setPhotoSearchOcrText(text);
        setPhotoSearchResultMode("nameplate");
        setPhotoSearchResults(keepInScope(matchNameplateAll(text, katalogList, stocks)));
        setPhotoSearchOpen(false);
      } else {
        if (!supabase) return;
        const vec = await cohereEmbedImage(photoSearchImg);
        const { data, error } = await supabase.rpc("match_stock_photos", {
          query_embedding: vec, p_upt: null, match_count: 10, min_similarity: 0.75,
        });
        if (error) throw error;
        setPhotoSearchOcrText("");
        setPhotoSearchResultMode("bentuk");
        setPhotoSearchResults(keepInScope(data || []));
        setPhotoSearchOpen(false);
      }
    } catch (e) {
      showToast("Gagal cari dengan foto: " + (e.message || e), "error");
    }
    setPhotoSearchLoading(false);
  }
  // Catatan: satu-satunya tombol pemanggil ini dirender ADMIN-only, jadi cabang
  // "ajukan approval TL" di bawah ini tidak pernah tereksekusi lewat UI saat ini.
  async function deleteStock(id) {
    const st = stocks.find(s=>s.id===id); if (!st) return;
    if (st.deletePending) { showToast("Sudah ada pengajuan hapus menunggu approval.","info"); return; }
    if (hasRole(currentUser, "TL")) {
      if (!window.confirm("Hapus baris stok ini?")) return;
      const ns = stocks.filter(s=>s.id!==id);
      setStocks(ns); await saveToCloud({stocks: ns}, {stocksDeletedId: id});
      logAudit(currentUser, "DELETE", "stocks", id);
      showToast("Data Stok dihapus.");
    } else {
      if (!window.confirm("Ajukan penghapusan baris stok ini ke TL?")) return;
      const ns = stocks.map(s=>s.id===id ? {...s, deletePending:true, deleteRequestedBy:currentUser.id, deleteRequestedAt:Date.now()} : s);
      setStocks(ns); await saveToCloud({stocks: ns}, {stocksChangedRows: ns.filter(s=>s.id===id)});
      logAudit(currentUser, "REQUEST_DELETE", "stocks", id);
      showToast("📨 Pengajuan hapus dikirim, menunggu approval TL.");
    }
  }

  // Ringkasan perubahan pending (barang/harga/jenis) utk judul approval history —
  // hanya sebut field yang benar-benar berubah (qty tidak lagi ada di sini, terkunci di form edit).
  function describeStockEditPending(st) {
    const p = st.pendingEditData || {};
    const parts = [];
    if (p.katalog!=null && p.katalog!==st.katalog) parts.push(`barang → ${p.name} [${p.katalog}]`);
    if (p.price!=null && p.price!==st.price) parts.push(`harga Rp${fmtNum(st.price)}→Rp${fmtNum(p.price)}`);
    if (p.jenisBarang!=null && p.jenisBarang!==st.jenisBarang) parts.push(`jenis ${st.jenisBarang}→${p.jenisBarang}`);
    return parts.join(", ") || "perubahan data";
  }

  // Approve/reject pengajuan Edit (barang/harga/jenis) Data Stok — khusus TL
  async function approveStockEdit(id) {
    const st = stocks.find(s=>s.id===id);
    if (!st || !st.editPending) return;
    const desc = describeStockEditPending(st);
    const ns = stocks.map(s=>s.id===id ? {...s, ...s.pendingEditData, editPending:false, pendingEditData:null, editApprovedBy:currentUser.id, editApprovedAt:Date.now()} : s);
    setStocks(ns); await saveToCloud({stocks: ns}, {stocksChangedRows: ns.filter(s=>s.id===id)});
    await logApprovalHistory({type:"STOCK_EDIT", decision:"APPROVED", title:`Edit ${st.name}: ${desc}`, requestedBy:st.editRequestedBy, requestedAt:st.editRequestedAt});
    showToast(`✅ Perubahan ${st.name} disetujui.`);
  }
  async function rejectStockEdit(id) {
    const st = stocks.find(s=>s.id===id);
    if (!st || !st.editPending) return;
    const ns = stocks.map(s=>s.id===id ? {...s, editPending:false, pendingEditData:null} : s);
    setStocks(ns); await saveToCloud({stocks: ns}, {stocksChangedRows: ns.filter(s=>s.id===id)});
    await logApprovalHistory({type:"STOCK_EDIT", decision:"REJECTED", title:`Edit ${st.name} ditolak`, requestedBy:st.editRequestedBy, requestedAt:st.editRequestedAt});
    showToast(`❌ Perubahan ${st.name} ditolak.`);
  }

  // Approve/reject pengajuan Hapus Data Stok — khusus TL
  async function approveStockDelete(id) {
    const st = stocks.find(s=>s.id===id);
    if (!st || !st.deletePending) return;
    const ns = stocks.filter(s=>s.id!==id);
    setStocks(ns); await saveToCloud({stocks: ns}, {stocksDeletedId: id});
    await logApprovalHistory({type:"STOCK_DELETE", decision:"APPROVED", title:`Hapus ${st.name}`, requestedBy:st.deleteRequestedBy, requestedAt:st.deleteRequestedAt});
    showToast(`✅ Penghapusan ${st.name} disetujui.`);
  }
  async function rejectStockDelete(id) {
    const st = stocks.find(s=>s.id===id);
    if (!st || !st.deletePending) return;
    const ns = stocks.map(s=>s.id===id ? {...s, deletePending:false, deleteRequestedBy:null, deleteRequestedAt:null} : s);
    setStocks(ns); await saveToCloud({stocks: ns}, {stocksChangedRows: ns.filter(s=>s.id===id)});
    await logApprovalHistory({type:"STOCK_DELETE", decision:"REJECTED", title:`Hapus ${st.name} ditolak`, requestedBy:st.deleteRequestedBy, requestedAt:st.deleteRequestedAt});
    showToast(`❌ Penghapusan ${st.name} ditolak.`);
  }

  // ── Satpam / Tim Mutu / UIT / ULTG / UPT CRUD di useMasterDataCrud.jsx ──

  // ── Master Gudang CRUD, wizard, Kapasitas Gudang, denah-tools ── dipindah ke
  // src/hooks/useWarehouseConfig.jsx (2026-08-09).
  const [collapsedUitIds, setCollapsedUitIds] = useState(() => new Set()); // Struktur Organisasi: default semua UIT terbuka, per-item bisa ditutup (bukan accordion — beda dari Gudang, biasanya cuma 1-2 UIT jadi tidak perlu maksa 1 saja yang terbuka)
  const [orgSearch, setOrgSearch] = useState("");
  // "Import dari SAP (PEMAT)" (importFromSAP) dihapus 2026-07-02 — digabung jadi satu dengan
  // wizard "Migrasi Data" (MigrasiDataTab/handleBackupAndApply) yang lebih aman (ada preview,
  // backup otomatis, panel review manual). Jangan bikin ulang fitur input Data Stok manual di
  // luar wizard itu — kebijakan bisnis: semua material masuk WAJIB lewat TUG, kecuali migrasi
  // data awal yang memang lewat wizard khusus itu.
  // saveOpname..deleteStockCountSession (Stock Opname & Stock Count) dipindah ke
  // src/hooks/useStockOpname.js (2026-08-10).

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
      const groqKey = (import.meta.env.VITE_GROQ_API_KEY || "").trim();
      const resp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${groqKey}` },
        body: JSON.stringify({
          model: "llama-3.3-70b-versatile",
          max_tokens: 1000,
          messages: [
            { role: "system", content: `Kamu adalah asisten ekstraksi data dari Surat Rencana Pengiriman Material (delivery plan / surat jalan) vendor PLN. Dokumen ini biasanya mencantumkan nomor kontrak sebagai referensi dan tanggal rencana kirim/tiba barang. Ekstrak informasi dan kembalikan HANYA JSON valid tanpa teks lain. Format: {"noKontrak":"...","tanggalKontrak":"YYYY-MM-DD","supplier":"...","tanggalSerahTerima":"YYYY-MM-DD","items":[{"namaBarang":"...","jumlah":0,"satuan":"..."}]}. noKontrak diambil dari nomor kontrak yang direferensikan di surat. tanggalSerahTerima diambil dari tanggal rencana kirim/tiba barang yang tercantum di surat. Jika field tidak ditemukan gunakan string kosong atau 0.` },
            { role: "user", content: `Ekstrak data dari Surat Rencana Pengiriman Material vendor ini. Kembalikan JSON saja.\n\n${pdfText}` }
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

  function handleImg(e, setter, onError) {
    const f = e.target.files[0]; if (!f) return;
    const r = new FileReader();
    r.onload = ev => setter(ev.target.result);
    r.onerror = () => onError?.(new Error("browser tidak dapat membaca file"));
    try { r.readAsDataURL(f); } catch (error) { onError?.(error); }
  }
  // Foto satpam disimpan inline di jsonb (bukan bucket) → wajib dikompres kecil (maks 400px)
  // supaya tidak membengkakkan master jsonb & localStorage.
  async function handleSatpamFoto(e) {
    const f = e.target.files[0]; e.target.value = ""; if (!f) return;
    if (!f.type.startsWith("image/")) { showToast("File harus berupa gambar.","error"); return; }
    try { const img = await compressImage(f, { maxDim:400, maxBytes:120_000 }); setSatpamForm(sf=>({...sf, foto:img})); }
    catch { showToast("Gagal memproses foto.","error"); }
  }
  // ATTB — lihat docs/ATTB_SPEC.md. Tahap1 (Usulan AE.1): createAttbItem (DRAFT) ->
  // submitAttbToKI (PENDING_ASMAN) -> approveAttbToKI/rejectAttbToKI oleh Asman UPT
  // pengaju. Tahap2->3->4->5: advanceAttbStage, dieksekusi langsung Admin/TL tanpa
  // approval. "Belum Lanjut" (khusus Tahap2) ditandai lewat markAttbBelumLanjut —
  // tidak memindahkan tahap, hanya menandai + wajib alasan.
  async function createAttbItem(form) {
    if (!hasRole(currentUser, "ADMIN","TL")) { showToast("Hanya Admin/TL yang bisa menambah kandidat ATTB.","error"); return; }
    if (!form.jenisAset || !ATTB_JENIS_ASET.includes(form.jenisAset)) { showToast("Pilih jenis aset.","error"); return; }
    if (!form.description?.trim()) { showToast("Deskripsi material/aset wajib diisi.","error"); return; }
    const now = Date.now();
    const item = {
      ...form,
      id: `ATTB-${uid().slice(-8)}`,
      upt: form.upt || getUserUptScope(currentUser, uptList),
      stage: "USULAN_AE1",
      approvalStatus: "DRAFT",
      lanjutBelumLanjut: false,
      stageHistory: [{ stage:"USULAN_AE1", tanggal:now, oleh:currentUser.id, catatan:"Dibuat sebagai kandidat ATTB" }],
      createdAt: now, createdBy: currentUser.id,
      updatedAt: now, updatedBy: currentUser.id,
    };
    const next = [item, ...attbList];
    setAttbList(next);
    await saveToCloud({attbList: next});
    showToast("✅ Kandidat ATTB ditambahkan (Tahap 1 - Draft).");
  }
  async function saveAttbEdit(id, updates) {
    if (!hasRole(currentUser, "ADMIN","TL")) { showToast("Hanya Admin/TL yang bisa mengubah data ATTB.","error"); return; }
    const item = attbList.find(a=>a.id===id);
    if (!item) return;
    const next = attbList.map(a => a.id===id ? { ...a, ...updates, updatedAt:Date.now(), updatedBy:currentUser.id } : a);
    setAttbList(next);
    await saveToCloud({attbList: next});
    showToast("✅ Data ATTB disimpan.");
  }
  async function submitAttbToKI(id) {
    if (!hasRole(currentUser, "ADMIN","TL")) { showToast("Hanya Admin/TL yang bisa mengajukan ke Asman.","error"); return; }
    const item = attbList.find(a=>a.id===id);
    if (!item || item.stage!=="USULAN_AE1") return;
    if (!["DRAFT",undefined].includes(item.approvalStatus)) { showToast("Item sudah diajukan.","error"); return; }
    if (!item.description?.trim()) { showToast("Deskripsi material/aset wajib diisi sebelum diajukan.","error"); return; }
    const next = attbList.map(a => a.id===id ? { ...a, approvalStatus:"PENDING_ASMAN", diajukanBy:currentUser.id, diajukanAt:Date.now() } : a);
    setAttbList(next);
    await saveToCloud({attbList: next});
    showToast("Diajukan ke Asman untuk Usulan AE.1 ke Unit Induk.");
  }
  async function approveAttbToKI(id, catatan="") {
    const item = attbList.find(a=>a.id===id);
    if (!item || !isPendingAttbApproval(item)) return;
    if (!canApproveAttb(currentUser, item, uptList)) { showToast("Hanya Asman UPT pengaju yang bisa approve item ini.","error"); return; }
    const now = Date.now();
    const next = attbList.map(a => a.id===id ? {
      ...a, approvalStatus:"APPROVED", approvedBy:currentUser.id, approvedAt:now, catatanApproval:catatan,
      stage:"AE1_AE4",
      stageHistory: [...(a.stageHistory||[]), { stage:"AE1_AE4", tanggal:now, oleh:currentUser.id, catatan:catatan||"Disetujui Asman, terkirim ke Kantor Induk" }],
    } : a);
    setAttbList(next);
    await saveToCloud({attbList: next});
    await logApprovalHistory({type:"ATTB", decision:"APPROVED", title:`Usulan ATTB ${item.nomorATTB||item.description}`, requestedBy:item.diajukanBy, requestedAt:item.diajukanAt});
    showToast("Usulan ATTB disetujui, lanjut ke Tahap AE.1 s.d. AE.4.");
  }
  async function rejectAttbToKI(id, alasan) {
    if (!alasan?.trim()) { showToast("Masukkan alasan penolakan.","error"); return; }
    const item = attbList.find(a=>a.id===id);
    if (!item || !isPendingAttbApproval(item)) return;
    if (!canApproveAttb(currentUser, item, uptList)) { showToast("Hanya Asman UPT pengaju yang bisa menolak item ini.","error"); return; }
    const next = attbList.map(a => a.id===id ? { ...a, approvalStatus:"DRAFT", rejectedBy:currentUser.id, rejectedAt:Date.now(), alasanTolak:alasan.trim() } : a);
    setAttbList(next);
    await saveToCloud({attbList: next});
    await logApprovalHistory({type:"ATTB", decision:"REJECTED", title:`Usulan ATTB ${item.nomorATTB||item.description}`, requestedBy:item.diajukanBy, requestedAt:item.diajukanAt});
    showToast("Usulan ATTB ditolak, kembali ke Draft Tahap 1.", "error");
  }
  async function advanceAttbStage(id) {
    if (!hasRole(currentUser, "ADMIN","TL")) { showToast("Hanya Admin/TL yang bisa memindahkan tahap ATTB.","error"); return; }
    const item = attbList.find(a=>a.id===id);
    if (!item) return;
    const idx = attbStageIndex(item.stage);
    if (idx>=ATTB_STAGES.length-1) { showToast("Sudah di tahap akhir, tidak bisa dilanjutkan lagi.","error"); return; }
    const nextStage = ATTB_STAGES[idx+1].code;
    const now = Date.now();
    // Advance dari Tahap 1 (Usulan AE.1) langsung ke Tahap 2 tanpa approval (tombol
    // Ajukan ke Asman sudah dihapus) — sekalian set approvalStatus APPROVED. Maju tahap
    // apapun otomatis melepas flag "Belum Lanjut" (item bergerak lagi).
    const next = attbList.map(a => a.id===id ? {
      ...a, stage:nextStage,
      approvalStatus: idx===0 ? "APPROVED" : a.approvalStatus,
      lanjutBelumLanjut:false, keteranganTidakLanjut:"",
      updatedAt:now, updatedBy:currentUser.id,
      stageHistory: [...(a.stageHistory||[]), { stage:nextStage, tanggal:now, oleh:currentUser.id, catatan: idx===0?"Dilanjutkan ke AE.1 s.d. AE.4":"" }],
    } : a);
    setAttbList(next);
    await saveToCloud({attbList: next});
    showToast(`✅ Lanjut ke tahap: ${attbStageLabel(nextStage)}`);
  }
  async function markAttbBelumLanjut(id, keterangan) {
    if (!hasRole(currentUser, "ADMIN","TL")) { showToast("Hanya Admin/TL yang bisa menandai Belum Lanjut.","error"); return; }
    if (!keterangan?.trim()) { showToast("Alasan Belum Lanjut wajib diisi.","error"); return; }
    const item = attbList.find(a=>a.id===id);
    if (!item || !["USULAN_AE1","AE1_AE4"].includes(item.stage)) { showToast("Belum Lanjut hanya berlaku di tahap Usulan AE.1 atau AE.1 s.d. AE.4.","error"); return; }
    const next = attbList.map(a => a.id===id ? { ...a, lanjutBelumLanjut:true, keteranganTidakLanjut:keterangan.trim(), updatedAt:Date.now(), updatedBy:currentUser.id } : a);
    setAttbList(next);
    await saveToCloud({attbList: next});
    showToast("Item ditandai Belum Lanjut.", "error");
  }
  // Import Excel batch — dedupe generik lewat nomorAT (bukan cuma string "sudah usul
  // hapus"): baris apapun yang nomorAT-nya sudah ada di attbList (dari import lain atau
  // input manual) otomatis dilewati, supaya aman dipanggil ulang tanpa duplikat.
  // targetStage: "TAHAP1" (DRAFT, USULAN_AE1) atau "TAHAP2" (APPROVED, AE1_AE4 — dipakai
  // utk data historis yang sudah disetujui sebelum WARNOTO ada, lihat ATTB_SPEC bagian 7b).
  async function bulkImportAttbItems(records, targetStage, importOpts={}) {
    if (!hasRole(currentUser, "ADMIN","TL")) { showToast("Hanya Admin/TL yang bisa import ATTB.","error"); return { created:0, skipped:0 }; }
    const now = Date.now();
    // Mode "tiban" (overwrite): buang dulu semua item eksisting dgn Waktu Usulan (+UPT)
    // yang sama, lalu file jadi sumber kebenaran untuk batch itu. Dedup nomorAT tetap
    // dijalankan terhadap item yang DIPERTAHANKAN (batch lain), supaya item lintas-batch
    // (mis. Tahap 2 dari file 4) tidak dobel.
    const { overwrite=false, waktu=null, upt=null } = importOpts;
    const matchWaktu = a => a.waktuUsulanPenghapusan===waktu && (a.upt||"")===(upt||"");
    const keptList = overwrite ? attbList.filter(a=>!matchWaktu(a)) : attbList;
    const removedCount = attbList.length - keptList.length;
    const existingNomorAT = new Set(keptList.map(a=>a.nomorAT).filter(Boolean));
    const toCreate = records.filter(r => !existingNomorAT.has(r.nomorAT));
    const skipped = records.length - toCreate.length;
    const newItems = toCreate.map(r => {
      const base = { ...r, id:`ATTB-${uid().slice(-8)}`, createdAt:now, createdBy:currentUser.id, updatedAt:now, updatedBy:currentUser.id };
      if (targetStage === "TAHAP2") {
        return {
          ...base, stage:"AE1_AE4", approvalStatus:"APPROVED", lanjutBelumLanjut:false,
          diajukanBy:null, diajukanAt:null, approvedBy:null, approvedAt:null,
          catatanApproval:"Data historis — tanggal & approver asli tidak tercatat, diimpor langsung sebagai Tahap 2",
          stageHistory:[
            {stage:"USULAN_AE1", tanggal:null, oleh:null, catatan:"Data historis, tahap awal tidak tercatat di WARNOTO"},
            {stage:"AE1_AE4", tanggal:now, oleh:currentUser.id, catatan:"Sudah diusulkan & disetujui sebelum WARNOTO ada, diimpor langsung dari Excel"},
          ],
        };
      }
      return {
        ...base, stage:"USULAN_AE1", approvalStatus:"DRAFT", lanjutBelumLanjut:false,
        stageHistory:[{stage:"USULAN_AE1", tanggal:now, oleh:currentUser.id, catatan:"Diimpor dari Excel (kandidat baru)"}],
      };
    });
    if (newItems.length > 0 || removedCount > 0) {
      const next = [...keptList, ...newItems];
      setAttbList(next);
      await saveToCloud({attbList: next});
      logAudit(currentUser, "IMPORT", "attb", null, {rows: newItems.length, skipped, removed: removedCount});
    }
    showToast(`✅ Import ATTB selesai: ${newItems.length} item ditambahkan${removedCount>0?`, ${removedCount} data lama (Waktu ${waktu}) ditimpa`:""}${skipped>0?`, ${skipped} dilewati (sudah ada di batch lain)`:""}.`);
    return { created: newItems.length, skipped, removed: removedCount };
  }
  async function deleteAttbItem(id) {
    if (!hasRole(currentUser, "ADMIN")) { showToast("Hanya Admin yang bisa menghapus item ATTB.","error"); return; }
    const next = attbList.filter(a=>a.id!==id);
    setAttbList(next);
    await saveToCloud({attbList: next});
    logAudit(currentUser, "DELETE", "attb", id);
    showToast("Item ATTB dihapus.", "error");
  }
  // ── Barcode scan handling ──
  function openScanner(target) { setScannerTarget(target); setScannerOpen(true); }

  function handleScanResult(code) {
    if (scannerTarget === "katalogForm") {
      setKatalogForm(kf => ({ ...kf, katalog: code }));
      showToast(`📷 Kode terdeteksi: ${code}`);
    } else if (typeof scannerTarget?.onDetect === "function") {
      // Target generik berbasis callback — dipakai komponen anak (mis. StockOpnameTab) yang
      // punya state lokal sendiri (activeOpname) yang tidak bisa disentuh langsung dari sini.
      scannerTarget.onDetect(code);
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

  // ── Transaction (TUG-9) ── diekstrak ke src/hooks/useTugTransactions.js
  // (openNewTxn, addItemRow, removeItemRow, updateItemRow, tug10Missing,
  // flagTug10Invalid, saveTxn, commitNewTxn — lihat pemanggilan hook di atas).

  function docKeyOf(txn) {
    if (txn.docType==="TUG9") return "tug9";
    if (txn.docType==="TUG8") return "tug8";
    if (txn.docType==="TUG10") return "tug10";
    if (txn.docType==="TUG5") return "tug5";
    if (txn.docType==="TUG7") return "tug7";
    return "tug3";
  }

  // ── Approval logic ──
  // Canonical TUG-8/9: Admin submit -> TL review -> Asman final.
  // TL-created records carry explicit TL evidence at submit -> Asman final.
  async function approveTxn(txn, review = null) {
    if (currentUser.role !== "SUPERADMIN" && txn.requiredApprover !== currentUser.role) {
      showToast(`Transaksi ini butuh approval dari ${ROLES[txn.requiredApprover]}, bukan kamu.`,"error"); return;
    }
    const isAdminCreated = txn.requiredApprover === "TL";
    const dKey = docKeyOf(txn);

    if (txn.canonical) {
      if (!review?.reviewToken || !review?.attestations) { showToast("Buka dan selesaikan overview server sebelum approval final.", "error"); return false; }
      try {
        canonicalDecisionKeysRef.current[txn.id] ||= newCanonicalActionKeys().decide;
        const result = await decideCanonicalTug({ txn, decision:"APPROVE", reviewToken:review.reviewToken, attestations:review.attestations, idempotencyKey:canonicalDecisionKeysRef.current[txn.id] });
        if (result.unavailable) throw new Error("Layanan transaksi canonical belum tersedia; approval final tidak dijalankan.");
        const isFinal = result.data.status === "FINAL_APPROVED";
        if (isFinal) {
          const freshStocks = await loadMasterTable("stocks");
          if (freshStocks !== null) setStocks(freshStocks);
        }
        setTxns(prev => prev.map(t => t.id === txn.id ? { ...t, status:isFinal ? "APPROVED" : "PENDING", stage:result.data.stage, requiredApprover:isFinal ? null : "ASMAN", canonicalVersion:result.data.version, ...(isFinal ? {approvedBy:currentUser.id,approvedAt:Date.now()} : {approvedByTL:currentUser.id,approvedAtTL:Date.now()}), asmanAutoApproved:false } : t));
        delete canonicalDecisionKeysRef.current[txn.id];
        logAudit(currentUser, "APPROVE", txn.docType, txn.docNumbers[dKey], {stage:result.data.stage, canonical:true});
        showToast(isFinal ? `✅ ${txn.docNumbers[dKey]} DISETUJUI FINAL. Stok diperbarui atomik oleh server.` : `✅ ${txn.docNumbers[dKey]} disetujui TL. Menunggu Asman; stok belum berubah.`);
        return true;
      } catch (err) {
        showToast(`Approval final belum dijalankan: ${err?.message||err}`, "error");
        return false;
      }
    }

    // Once cutover is enabled, legacy pending TUG-8/9 cannot decrement stock
    // from browser state. They must be recreated/imported through the reviewed
    // canonical workflow; already-approved legacy records remain history only.
    if (CANONICAL_TUG_REQUIRED && ["TUG8", "TUG9"].includes(txn.docType)) {
      showToast("Transaksi TUG lama tidak dapat mengubah stok setelah cutover canonical. Ajukan ulang atau lakukan migrasi baseline terkontrol.", "error");
      return false;
    }

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
      // Cuma baris stok yang ada di txn.stockItems yang berubah qty-nya (bukan seluruh tabel).
      await saveToCloud({stocks: newStocks, txns: newTxns}, {stocksChangedRows: newStocks.filter(s => txn.stockItems.some(si=>si.stockId===s.id))});
      logAudit(currentUser, "APPROVE", txn.docType, txn.docNumbers[dKey], {stage: txn.stage||null});
      showToast(isAdminCreated ? `✅ ${txn.docNumbers[dKey]} DISETUJUI! (Asman otomatis ikut menyetujui)` : `✅ ${txn.docNumbers[dKey]} DISETUJUI!`);
      return true;
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
      // Lacak baris stok & katalog yang benar-benar berubah/ditambah di transaksi ini,
      // supaya sync ke Supabase cuma mengirim baris itu (bukan seluruh tabel `stocks`).
      const touchedStockIds = new Set();
      const touchedKatalogIds = new Set();

      txn.stockItems.forEach(si => {
        const jenisBarangFinal = STATUS_RETUR_TO_JENIS[si.statusMaterial] || "Persediaan";
        if (si.katalogMode === "existing" && si.katalogId) {
          // Find an existing Data Stok row for this katalog+location; bump qty if found
          const existingRow = newStocks.find(s => s.katalogId===si.katalogId && s.lokasiId===txn.lokasiTujuanId);
          if (existingRow) {
            newStocks = newStocks.map(s => s.id===existingRow.id ? { ...s, qty: s.qty + si.qty } : s);
            touchedStockIds.add(existingRow.id);
          } else {
            const newId = `STK-${String(nextStkNum++).padStart(3,"0")}-${uid().slice(-6)}`;
            newStocks.push({ id:newId, katalogId:si.katalogId, lokasiId:txn.lokasiTujuanId, qty:si.qty, minQty:0, price:0, jenisBarang:jenisBarangFinal, img:si.fotoBarangRetur||null, createdAt:Date.now() });
            touchedStockIds.add(newId);
          }
        } else {
          // Brand-new item: register into Master Katalog first
          const newKatId = `KAT-${String(nextKatNum++).padStart(3,"0")}-${uid().slice(-6)}`;
          newKatalog.push({ id:newKatId, katalog:si.katalogBaru||"", name:si.namaBaru, category:si.categoryBaru||"Lainnya", satuan:si.satuanBaru||"unit", createdAt:Date.now() });
          touchedKatalogIds.add(newKatId);
          const newStkId = `STK-${String(nextStkNum++).padStart(3,"0")}-${uid().slice(-6)}`;
          newStocks.push({ id:newStkId, katalogId:newKatId, lokasiId:txn.lokasiTujuanId, qty:si.qty, minQty:0, price:0, jenisBarang:jenisBarangFinal, img:si.fotoBarangRetur||null, createdAt:Date.now() });
          touchedStockIds.add(newStkId);
        }
      });

      const newTxns = txns.map(t => t.id===txn.id ? { ...t, status:"APPROVED", approvedBy:currentUser.id, approvedAt:Date.now(), asmanAutoApproved:isAdminCreated } : t);
      setTxns(newTxns); setStocks(newStocks); setKatalogList(newKatalog);
      await saveToCloud({stocks: newStocks, txns: newTxns, katalogList: newKatalog}, {
        stocksChangedRows: newStocks.filter(s => touchedStockIds.has(s.id)),
        katalogChangedRows: newKatalog.filter(k => touchedKatalogIds.has(k.id)),
      });
      logAudit(currentUser, "APPROVE", txn.docType, txn.docNumbers[dKey], {stage: txn.stage||null});
      showToast(isAdminCreated ? `✅ ${txn.docNumbers[dKey]} DISETUJUI! Stok bertambah. (Asman otomatis ikut menyetujui)` : `✅ ${txn.docNumbers[dKey]} DISETUJUI! Stok bertambah.`);
      return true;
    }
  }
  async function rejectTxn(txn, reason) {
    if (currentUser.role !== "SUPERADMIN" && txn.requiredApprover !== currentUser.role) {
      showToast(`Transaksi ini butuh approval dari ${ROLES[txn.requiredApprover]}, bukan kamu.`,"error"); return;
    }
    if (!reason.trim()) { showToast("Masukkan alasan penolakan!","error"); return; }
    if (txn.canonical) {
      try {
        canonicalDecisionKeysRef.current[txn.id] ||= newCanonicalActionKeys().decide;
        const result = await decideCanonicalTug({ txn, decision:"REJECT", reason, idempotencyKey:canonicalDecisionKeysRef.current[txn.id] });
        if (result.unavailable) throw new Error("Layanan transaksi canonical belum tersedia; penolakan tidak dijalankan.");
        setTxns(prev => prev.map(t => t.id===txn.id ? {...t,status:"REJECTED",stage:"REJECTED",canonicalVersion:result.data.version,rejectedBy:currentUser.id,rejectedAt:Date.now(),rejectReason:reason} : t));
        delete canonicalDecisionKeysRef.current[txn.id];
        logAudit(currentUser, "REJECT", txn.docType, txn.docNumbers[docKeyOf(txn)], {stage:"REJECTED", alasan:reason, canonical:true});
        showToast(`❌ ${txn.docNumbers[docKeyOf(txn)]} DITOLAK.`, "error");
        return true;
      } catch (err) { showToast(`Penolakan belum dijalankan: ${err?.message||err}`, "error"); return false; }
    }
    const newTxns = txns.map(t => t.id===txn.id ? {...t, status:"REJECTED", rejectedBy:currentUser.id, rejectedAt:Date.now(), rejectReason:reason} : t);
    setTxns(newTxns);
    await saveToCloud({txns: newTxns});
    logAudit(currentUser, "REJECT", txn.docType, txn.docNumbers[docKeyOf(txn)], {stage: txn.stage||null, alasan: reason});
    showToast(`❌ ${txn.docNumbers[docKeyOf(txn)]} DITOLAK.`, "error");
  }

  const {
    approveTUG3_TL, rejectTUG3_TL,
    submitTUG4Form, approveTUG4_Manager, rejectTUG4_Manager,
    submitTUG3FinalLampiran, approveTUG3Final_Asman, rejectTUG3Final_Asman,
    approveTUG5_Asman, rejectTUG5_Asman,
    approveTUG5_Manager, rejectTUG5_Manager,
    approveTUG5_MgrULTG, rejectTUG5_MgrULTG, adoptTUG5ULTG,
    openDraftTug9, submitDraftTug9,
    submitTUG7_AdminUIT, approveTUG7_MgrLogistik, rejectTUG7_MgrLogistik,
    konfirmasiDraftTUG8,
  } = useTugApprovals({
    currentUser, showToast,
    txns, setTxns, saveToCloud,
    stocks, setStocks, katalogList, setKatalogList,
    docSeq, setDocSeq,
    uptList, ultgList, currentUserUptId,
    canonicalActionKeysRef,
    setTxnForm, setEditingDraftTxnId, setTxnModal, editingDraftTxnId,
    commitNewTxn,
  });
  stateRef.current.submitDraftTug9 = submitDraftTug9;

  // Bangun ulang knowledge base RAG (tabel rag_chunks di Supabase) dari
  // Master Katalog + transaksi TUG yang approved. Dipicu MANUAL lewat tombol
  // di AI Agent (bukan otomatis tiap save) supaya tidak boros panggilan API
  // embedding Cohere. Batasi transaksi ke 6 bulan terakhir supaya knowledge
  // base tidak membengkak tanpa batas dari histori lama.
  async function syncRagChunks(silent = false, onProgress) {
    if (isDemoMode()) return; // mode demo: rag_chunks dibaca bot Telegram, jangan disentuh
    if (!supabase) { if (!silent) showToast("Supabase belum terkonfigurasi.", "error"); return; }
    if (!silent) setRagSyncing(true);
    try {
      const enam_bulan_lalu = Date.now() - 180*24*60*60*1000;
      const txnRelevant = txns.filter(t=>t.status==="APPROVED" && t.createdAt>=enam_bulan_lalu);
      // Agregasi qty+harga per (uptId, katalogId) — chunk katalog kini per-UPT (RAG 3-tier,
      // supaya akun UPT tidak melihat angka stok UPT lain). Katalog tanpa stok di UPT
      // manapun dapat 1 chunk global (upt_id null, deskripsi tanpa angka).
      const stockByUptKatalog = {}; // key `${uptId}::${katalogId}`
      enrichedStocks.forEach(s=>{
        if (!s.katalogId) return;
        const lok = lokasiList.find(l=>l.id===s.lokasiId);
        const gdg = lok?.gudangId ? gudangList.find(g=>g.id===lok.gudangId) : null;
        const uptId = gdg?.uptId;
        if (!uptId) return;
        const key = `${uptId}::${s.katalogId}`;
        if (!stockByUptKatalog[key]) stockByUptKatalog[key] = { uptId, katalogId: s.katalogId, qty:0, price:s.price||0, locations:[] };
        stockByUptKatalog[key].qty += s.qty||0;
        if (s.qty>0) stockByUptKatalog[key].locations.push({ gudang: gdg?.nama||"", blok: lok?.kode||s.lokasi||"", qty: s.qty||0 });
      });
      const katalogIdsWithStock = new Set(Object.values(stockByUptKatalog).map(v=>v.katalogId));
      const katalogChunks = [
        ...Object.values(stockByUptKatalog).map(v=>{
          const k = katalogList.find(kk=>kk.id===v.katalogId);
          if (!k) return null;
          const uptNama = uptList.find(u=>u.id===v.uptId)?.nama || v.uptId;
          return { id:`katalog_${v.uptId}_${v.katalogId}`, source_type:"katalog", source_id:v.katalogId, upt_id:v.uptId, content:`UPT ${uptNama}: ${buildKatalogRagContent(k, v)}` };
        }).filter(Boolean),
        // Chunk global "katalog tanpa stok" (upt_id null, tampil ke semua) hanya dibuat
        // oleh akun NASIONAL (Pusat/SUPERADMIN) / nightly_sync yang membaca stok semua UPT.
        // Akun scoped hanya melihat stok UPT-nya, jadi "tanpa stok" versinya keliru untuk
        // katalog yang sebenarnya bersaldo di UPT lain — biarkan global dikelola nasional.
        ...(dataScope === null ? katalogList.filter(k=>!katalogIdsWithStock.has(k.id)).map(k=>({ id:`katalog_${k.id}`, source_type:"katalog", source_id:k.id, upt_id:null, content:buildKatalogRagContent(k, null) })) : []),
      ];
      // "Buku pintar" hasil kurasi Admin dari pertanyaan nyata yang dijawab buruk oleh bot —
      // diprioritaskan tinggi karena isinya jawaban resmi untuk pertanyaan yang benar-benar
      // pernah ditanyakan, bukan cuma deskripsi umum.
      const { data: faqRows } = await supabase.from("ai_faq_curated").select("id, pertanyaan, jawaban").eq("is_active", true);

      const chunks = [
        ...katalogChunks,
        ...txnRelevant.map(t=>({ id:`txn_${t.id}`, source_type:"txn", source_id:t.id, upt_id: t.uptId || users.find(u=>u.id===t.createdBy)?.uptId || null, content:buildTxnRagContent(t) })),
        ...(faqRows||[]).map(f=>({ id:`faq_${f.id}`, source_type:"faq", source_id:String(f.id), upt_id:null, content:`Pertanyaan: ${f.pertanyaan}\nJawaban resmi (kurasi Admin): ${f.jawaban}` })),
      ];
      if (chunks.length===0) { if (!silent) showToast("Tidak ada data untuk di-index.", "error"); if (!silent) setRagSyncing(false); return; }
      // Skip chunk yang kontennya identik dengan yang sudah tersimpan — hemat kuota Cohere
      // trial, sama seperti nightly_sync.mjs. Hapus-basi di bawah tetap pakai `chunks` penuh.
      const { data: existingChunks } = await supabase.from("rag_chunks").select("id, content").in("source_type", ["katalog", "txn", "faq"]);
      const existingContentById = new Map((existingChunks||[]).map(r=>[r.id, r.content]));
      const toEmbed = splitChunksForEmbed(chunks, existingContentById);
      // Cohere embed API maks ~96 teks per request — kirim per batch.
      const BATCH = 90;
      for (let i=0; i<toEmbed.length; i+=BATCH) {
        const batch = toEmbed.slice(i, i+BATCH);
        const vectors = await cohereEmbed(batch.map(c=>c.content), "search_document");
        const rows = batch.map((c,idx)=>({ ...c, embedding: vectors[idx], updated_at: new Date().toISOString() }));
        const { error } = await supabase.from("rag_chunks").upsert(rows, { onConflict: "id" });
        if (error) throw error;
        onProgress?.(Math.min(i+BATCH, toEmbed.length), toEmbed.length);
      }
      // Hapus hanya chunk lama milik sinkron browser (katalog/txn/FAQ). Chunk
      // `mutasi` dibuat nightly_sync.mjs dan tidak boleh ikut terhapus di sini.
      const currentIds = new Set(chunks.map(c=>c.id));
      const { data: existing } = await supabase.from("rag_chunks").select("id, upt_id").in("source_type", ["katalog", "txn", "faq"]);
      // Akun scoped (UPT/UIT) HANYA boleh menghapus chunk orphan milik UPT dalam cakupannya.
      // Tanpa guard ini, sync Admin UPT-A menghapus chunk UPT-B (tampak "orphan" dari sisi A,
      // karena client A cuma memuat data UPT-A). Chunk shared (upt_id null, mis. FAQ/global)
      // & chunk UPT di luar cakupan dibiarkan — itu domain akun nasional / nightly_sync.
      const toDelete = (existing||[])
        .filter(r=>!currentIds.has(r.id))
        .filter(r=> dataScope === null || (r.upt_id && dataScope.includes(r.upt_id)))
        .map(r=>r.id);
      if (toDelete.length) await supabase.from("rag_chunks").delete().in("id", toDelete);
      setRagLastSync(Date.now());
      if (!silent) showToast(`✅ Knowledge Base RAG disinkron: ${toEmbed.length}/${chunks.length} item di-embed ulang (${chunks.length - toEmbed.length} tidak berubah, di-skip), ${katalogList.length} katalog, ${txnRelevant.length} transaksi, ${(faqRows||[]).length} FAQ.`);
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
    const kritis = getKritisAgg(enrichedStocks, buildMonthlySeriesByKatalog(txns, enrichedStocks));
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
      top20ByValue: top20.map(s=>({ nama:s.name, katalog:s.katalog, qty:s.qty, satuan:s.unit, hargaSatuan:s.price, nilaiRp: Math.round(s.qty*s.price), status:stockSapLabel(s), ...withLokasi(s) })),
      materialKritis: kritis.map(s=>({ nama:s.name, katalog:s.katalog, qty:s.qty, satuan:s.unit, minQty:s.minQty, ...withLokasi(s) })),
      pemakaian3BulanTop10: topPakai,
      tugPendingApproval: pending.map(t=>({ docType:t.docType, id:t.id, namaPekerjaan:t.namaPekerjaan, requiredApprover:t.requiredApprover, createdAt:t.createdAt })),
      rencanaKedatangan30Hari: rencana30.map(i=>({ namaBarang:i.namaBarang, jumlah:i.jumlah, satuan:i.satuan, supplier:i.supplier, noKontrak:i.noKontrak, tanggalSerahTerima:i.tanggalSerahTerima })),
    };
  }

  async function syncWarnotoState(silent = false) {
    if (isDemoMode()) return; // mode demo: warnoto_state dibaca bot Telegram, jangan disentuh
    if (!supabase) return;
    try {
      const state_data = buildWarnotoStateSnapshot();
      const { error } = await supabase.from("warnoto_state").insert({ state_data, version: "v1" });
      if (error) throw error;
    } catch (err) {
      if (!silent) showToast("Gagal sinkron State Gudang (untuk bot Telegram): " + err.message, "error");
      else console.error("Auto-sync warnoto_state gagal:", err.message);
    }
  }

  // Salin qty+harga Data Stok ke tabel Supabase `stocks_snapshot` — khusus supaya cron malam
  // (nightly_sync.mjs, jalan di GitHub Actions tanpa browser terbuka) bisa hitung ulang
  // top-N/stok kritis dengan harga yang benar. Tanpa ini, harga cuma ada di localStorage
  // browser, tidak bisa diakses proses server-side sama sekali. "Whole list is the truth"
  // (upsert + hapus yang sudah tidak ada), sama pola dengan sync master data lain.
  async function syncStocksSnapshot(silent = false) {
    if (isDemoMode()) return; // mode demo: stocks_snapshot dibaca cron malam bot, jangan disentuh
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

    // Pak War memakai scope akun yang sama dengan layar operasional. Dulu UIT dianggap
    // "global" (nasional) — sekarang dataScope (getScopeUptIds) membatasi ke semua UPT
    // di UIT-nya, sama seperti layar operasional lain (fix Gelombang 2 multi-UPT).
    const assistantGlobal = dataScope === null;
    const assistantStocks = assistantGlobal ? enrichedStocks : enrichedStocks.filter(s => {
      const lokasi = lokasiList.find(l => l.id === s.lokasiId);
      const gudang = lokasi?.gudangId ? gudangList.find(g => g.id === lokasi.gudangId) : null;
      return inScopeUpt(gudang?.uptId || null, dataScope);
    });
    const assistantStockIds = new Set(assistantStocks.map(s => s.id));
    const assistantTxns = assistantGlobal ? txns : txns.filter(t => {
      if ((t.stockItems || []).some(si => assistantStockIds.has(si.stockId))) return true;
      return inScopeUpt(t.uptId || users.find(u => u.id === t.createdBy)?.uptId || null, dataScope);
    });
    const scopedEnrichedStocks = assistantStocks;
    const scopedTxns = assistantTxns;

    // Build rich context from live system data
    const now = new Date();
    const tiga_bulan_lalu = Date.now() - 90*24*60*60*1000;
    const txnRecent = scopedTxns.filter(t=>t.createdAt>=tiga_bulan_lalu && t.status==="APPROVED");

    // Top 20 material by nilai
    const top20 = [...scopedEnrichedStocks]
      .sort((a,b)=>(b.qty*b.price)-(a.qty*a.price))
      .slice(0,20);

    // Top material by qty, per satuan (beda satuan tak bisa dibanding) — utk "stok paling banyak"
    const topByQtyPerSatuan = getTopStockByQty(scopedEnrichedStocks, katalogList, 15);
    const totalPerSatuan = getTotalPerSatuan(scopedEnrichedStocks);

    // Stok kritis
    const kritis = getKritisAgg(scopedEnrichedStocks, buildMonthlySeriesByKatalog(scopedTxns, scopedEnrichedStocks));

    // Pending approvals
    const pending = scopedTxns.filter(t=>t.status==="PENDING");
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
        const s = scopedEnrichedStocks.find(x=>x.id===si.stockId);
        if(!s) return;
        if(!usageSummary[s.name]) usageSummary[s.name]={total:0,count:0};
        usageSummary[s.name].total += si.qty||0;
        usageSummary[s.name].count += 1;
      });
    });
    const topPakai = Object.entries(usageSummary).sort((a,b)=>b[1].total-a[1].total).slice(0,10);

    // Proyeksi / stok akan habis (top 10 paling mendesak)
    const forecastSoon = getMaterialAkanHabis(scopedEnrichedStocks, katalogList, scopedTxns, 10);
    const forecastSoonText = forecastSoon.length===0 ? "Tidak ada proyeksi (belum cukup histori pemakaian)." : forecastSoon
      .map(f=>`- ${f.nama} [${f.katalog||"-"}]: stok ${fmtNum(f.totalQty)} ${f.satuan}, rata-rata ${fmtNum(f.avgPerBulan)}/bln, estimasi habis ~${fmtNum(f.estimasiHari)} hari${f.isKritis?" (KRITIS)":""}`).join('\n');

    // ── RAG: cari chunk (katalog/transaksi) yang paling relevan secara makna
    // dengan pertanyaan user — pelengkap snapshot di atas yang cuma top-N
    // hardcoded. Kalau Cohere/knowledge base belum siap, lewati saja (tetap
    // jawab pakai snapshot biasa) — RAG di sini bersifat tambahan, bukan
    // syarat AI Agent bisa jalan.
    // RAG chunks (rag_chunks) sekarang ter-tag per-UPT (upt_id) — match_rag_chunks
    // menerima p_upts (null=nasional, array=UPT/UIT) jadi RAG jalan untuk semua akun.
    let ragContextText = "Belum ada hasil pencarian (Knowledge Base RAG belum disinkron atau belum terkonfigurasi).";
    try {
      if (supabase && import.meta.env.VITE_COHERE_API_KEY) {
        const [queryVector] = await cohereEmbed([msg], "search_query");
        const { data: matches, error } = await supabase.rpc("match_rag_chunks", { query_embedding: queryVector, match_count: 8, p_upts: dataScope });
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

    const systemPrompt = `Kamu adalah asisten operasional sistem manajemen gudang PLN bernama Pak War untuk Gudang ${currentUptNama}.

PERSONA & GAYA JAWABAN:
Kamu Pak War, staf senior gudang PLN yang menjawab pertanyaan rekan kerja. Pakai
Bahasa Indonesia korporat yang natural dan ramah — bukan template kaku, bukan
robotik.

ATURAN JAWABAN:
- Bahasa Indonesia sopan, formal, jelas, dan informatif — hangat profesional,
  bukan kaku robotik.
- Mulai dengan JAWABAN INTI dulu (1-2 kalimat), baru rincian bila perlu. Boleh
  menambahkan rincian/informasi pendukung yang membantu (tidak lagi harus jawab
  sesempit pertanyaan), tetap fokus dan jangan melenceng ke topik lain.
- Format Markdown sederhana: judul pendek, bullet, angka. JANGAN pakai tabel
  teks lebar. JANGAN paragraf panjang.
- Saat menyebut material/stok, WAJIB satu bullet per item, satu baris per item,
  dengan format persis:
  - **Nama Material** [kode katalog] — stok X unit · Lokasi: Y
  Selalu cantumkan lokasi bila tersedia di data; kalau tidak ada tulis "Lokasi: -".
- Untuk pertanyaan "stok terbanyak/paling banyak" pakai daftar TOP MATERIAL BY QTY
  (per satuan) — sebutkan per satuan, JANGAN membandingkan qty antar satuan yang
  berbeda. Untuk "termahal/nilai terbesar" pakai daftar by nilai.
- Untuk pertanyaan spesifik soal stok/qty/ranking/kritis/proyeksi/lokasi material,
  WAJIB jawab berdasarkan data SNAPSHOT DATA SISTEM di bawah (TOP MATERIAL BY QTY,
  MATERIAL KRITIS, PROYEKSI/STOK AKAN HABIS, dst) — JANGAN mengarang angka.
- Kalau data tidak cukup untuk menjawab, katakan data apa yang belum tersedia,
  lalu ajukan SATU pertanyaan klarifikasi.
- Tutup dengan langkah lanjut atau pertanyaan singkat bila relevan. Sesekali saja
  (tidak setiap jawaban, biar tidak mengganggu), boleh tambahkan ajakan singkat
  di penutup: "Kalau jawaban ini kurang tepat atau ada yang bisa saya perbaiki,
  beri tahu saya — masukan Anda membantu meningkatkan layanan WARNOTO."

Sumber: Data WARNOTO per ${now.toLocaleDateString("id-ID")}

---
GLOSARIUM SINGKATAN & ISTILAH MATERIAL PLN (dari CATALOG MASTER PLN — pakai ini untuk
memahami nama material di data di bawah maupun pertanyaan user yang pakai bahasa awam
atau singkatan teknis, mis. user tanya "pemutus" artinya cari "CB"/circuit breaker,
"penangkal petir" artinya "LA"/lightning arrester):
${MATERIAL_GLOSSARY}

---
SNAPSHOT DATA SISTEM SAAT INI:

INVENTORI (${scopedEnrichedStocks.length} item total):
Nilai total: Rp ${fmtNum(Math.round(scopedEnrichedStocks.reduce((a,s)=>a+(s.qty*s.price),0)))}
Top 20 material by nilai:
${top20.map(s=>`- ${s.name} [${s.katalog}]: ${fmtNum(s.qty)} ${s.unit} | Rp ${fmtNum(Math.round(s.qty*s.price))} | lokasi: ${s.lokasi||"-"}`).join('\n')}

TOP MATERIAL BY QTY (per satuan — JANGAN bandingkan qty antar satuan berbeda):
${topByQtyPerSatuan.map(g=>`Satuan ${g.satuan}:\n${g.items.map(i=>`- ${i.nama} [${i.katalog}]: ${fmtNum(i.totalQty)} ${g.satuan}`).join('\n')}`).join('\n')}

TOTAL QTY PER SATUAN:
${Object.entries(totalPerSatuan).map(([satuan,qty])=>`- ${satuan}: ${fmtNum(qty)}`).join('\n')}

MATERIAL KRITIS (stok ≤ minimum):
${kritis.length===0?"Tidak ada material kritis":kritis.map(s=>`- ${s.name}: stok ${s.qty} ${s.unit}, min ${s.minQty}`).join('\n')}

PEMAKAIAN 3 BULAN TERAKHIR (top 10):
${topPakai.map(([nama,d])=>`- ${nama}: ${d.total} unit (${d.count}x transaksi)`).join('\n')}

PROYEKSI / STOK AKAN HABIS (top 10 paling mendesak):
${forecastSoonText}

${formatStockStatsText(scopedEnrichedStocks)}

TUG PENDING APPROVAL (${pending.length} transaksi):
${pendingDetailText}

RENCANA KEDATANGAN (30 hari, ${rencana30.length} item):
${rencana30DetailText}

---
HASIL PENCARIAN KNOWLEDGE BASE (paling relevan dengan pertanyaan user, dari RAG — bisa berisi data yang TIDAK ada di snapshot top-N di atas, mis. material di luar top 20/transaksi lebih lama):
${ragContextText}

Jawab pertanyaan user berdasarkan data di atas (gabungkan snapshot dan hasil pencarian Knowledge Base). Gunakan Bahasa Indonesia yang profesional.`;

    function buildLocalWarehouseAnswer() {
      const normalized = msg.toLowerCase();
      const keywords = normalized
        .replace(/[^a-z0-9\s-]/g," ")
        .split(/\s+/)
        .filter(word=>word.length>=3 && !["berapa","material","gudang","stoknya","tolong","pak","war","yang","untuk","dengan","dari","saat","sekarang","hari","ini"].includes(word));
      const matchedStocks = scopedEnrichedStocks.filter(stock=>{
        const haystack = `${stock.name||""} ${stock.katalog||""} ${stock.jenisBarang||""}`.toLowerCase();
        return keywords.length>0 && keywords.some(keyword=>haystack.includes(keyword));
      }).slice(0,8);
      const totalValue = scopedEnrichedStocks.reduce((sum,stock)=>sum+(stock.qty*stock.price),0);
      const localNotice = "Layanan AI sedang tidak tersedia, jadi informasi berikut saya bacakan langsung dari data WARNOTO.";

      if (/pending|approval|persetujuan|dokumen|tug/.test(normalized)) {
        return `${localNotice}\n\nBerikut dokumen yang tercatat menunggu persetujuan:\n${pendingDetailText}\n\nKalau butuh detail salah satu dokumen, tinggal sebutkan ya.`;
      }
      if (/kritis|hampir habis|minimum|menipis/.test(normalized)) {
        const criticalText = kritis.length===0
          ? "Tidak ada material dengan stok di bawah atau sama dengan batas minimum."
          : kritis.slice(0,12).map(stock=>`- **${stock.name}** [${stock.katalog||"-"}] — stok ${fmtNum(stock.qty)} ${stock.unit} · minimum ${fmtNum(stock.minQty)}`).join("\n");
        return `${localNotice}\n\nIni daftar material yang stoknya sudah menyentuh batas minimum:\n${criticalText}\n\nSaya siap bantu kalau perlu data lain.`;
      }
      if (/paling banyak|terbanyak|stok terbesar|qty terbanyak/.test(normalized)) {
        const qtyText = topByQtyPerSatuan.length===0 ? "Belum ada data stok." : topByQtyPerSatuan
          .map(g=>`Satuan ${g.satuan}:\n${g.items.slice(0,10).map(i=>`- **${i.nama}** [${i.katalog||"-"}] — ${fmtNum(i.totalQty)} ${g.satuan}`).join("\n")}`).join("\n\n");
        return `${localNotice}\n\nIni material dengan stok terbanyak (dikelompokkan per satuan, tidak bisa dibandingkan lintas satuan):\n\n${qtyText}\n\nSebutkan saja bila mau lihat satuan lain.`;
      }
      if (matchedStocks.length>0) {
        const materialText = matchedStocks.map(stock=>`- **${stock.name}** [${stock.katalog||"-"}] — stok ${fmtNum(stock.qty)} ${stock.unit} · Lokasi: ${stock.lokasi||"-"}`).join("\n");
        return `${localNotice}\n\nBerikut material yang cocok dengan yang Anda tanyakan:\n${materialText}\n\nSebutkan saja bila ada material lain yang mau dicek.`;
      }
      if (/forecast|proyeksi|prediksi|bulan|pemakaian/.test(normalized)) {
        const forecastList = getMaterialAkanHabis(scopedEnrichedStocks, katalogList, scopedTxns, 8);
        const forecastText = forecastList.length===0 ? "Belum ada proyeksi (belum cukup histori pemakaian)." : forecastList
          .map(f=>`- **${f.nama}** [${f.katalog||"-"}] — stok ${fmtNum(f.totalQty)} ${f.satuan}, rata-rata ${fmtNum(f.avgPerBulan)}/bln, estimasi habis ~${fmtNum(f.estimasiHari)} hari${f.isKritis?" (KRITIS)":""}`).join("\n");
        return `${localNotice}\n\nIni material yang paling mendesak berdasarkan proyeksi pemakaian:\n${forecastText}\n\nSebutkan saja bila mau lihat material lain.`;
      }
      return `${localNotice}\n\nBerikut ringkasan kondisi gudang saat ini:\n- Total item inventori: ${fmtNum(scopedEnrichedStocks.length)}\n- Nilai inventori: Rp ${fmtNum(Math.round(totalValue))}\n- Material kritis: ${fmtNum(kritis.length)}\n- Dokumen pending: ${fmtNum(pending.length)}\n- Rencana kedatangan 30 hari: ${fmtNum(rencana30.length)} item\n\nSebutkan nama atau kode katalog material bila ingin saya tampilkan stok yang lebih spesifik.`;
    }

    try {
      const groqKey = (import.meta.env.VITE_GROQ_API_KEY || "").trim();
      if (!groqKey) throw new Error("Konfigurasi layanan AI belum tersedia.");
      const messages = [
        {role:"system",content:systemPrompt},
        ...chatHistory.filter(m=>m.role!=="ai"||chatHistory.indexOf(m)>0).slice(-8).map(m=>({
          role:m.role==="user"?"user":"assistant",
          content:m.text
        })),
        {role:"user",content:msg}
      ];

      // Single-call ke Groq (bukan tool-loop): tool-use bikin 3-4 panggilan/pertanyaan
      // yang menjebol limit free tier 12k token/menit. Akurasi tetap dijaga lewat
      // snapshot data yang diperkaya di systemPrompt di atas (top qty, proyeksi, dst).
      const resp = await fetch("https://api.groq.com/openai/v1/chat/completions",{
        method:"POST",
        headers:{"Content-Type":"application/json","Authorization":`Bearer ${groqKey}`},
        body:JSON.stringify({
          model:"llama-3.3-70b-versatile",
          max_tokens:1500,
          messages,
        })
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data?.error?.message || `Layanan AI merespons HTTP ${resp.status}.`);
      const reply = data.choices?.[0]?.message?.content;
      if (!reply) throw new Error("Layanan AI tidak mengirimkan jawaban.");
      setChatHistory(h=>[...h,{role:"ai",text:reply}]);
    } catch (error) {
      console.error("Pak War beralih ke mode data lokal:", error.message);
      setChatHistory(h=>[...h,{role:"ai",text:buildLocalWarehouseAnswer()}]);
    } finally {
      setChatLoading(false);
    }
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
    // Perkaya histori dengan arsip TUG-15 lama (AppSheet) — hanya baris yang no_katalog-nya
    // (setelah normalisasi kode lama->baru) cocok dengan katalog yang sedang dianalisa.
    // Query terpisah try/catch dari pemanggilan Groq di bawah: gagal tidak boleh
    // menggagalkan analisa utama, cukup lanjut dengan histori live (txns) saja.
    const liveMonthsCount = Object.keys(historyMap).length;
    let legacyMonthsAdded = 0;
    try {
      const { data: legacyRows, error: legacyErr } = await supabase
        .from("legacy_history_archive")
        .select("tanggal, qty, no_katalog")
        .eq("jenis_transaksi", "KELUAR")
        .ilike("source_upt", "%Surabaya%")
        // ponytail: no_katalog lama formatnya tidak seragam (perlu normalisasi baru bisa
        // dibandingkan ke katalog.katalog), jadi filter kecocokan dilakukan di JS, bukan SQL.
        // .limit sbg pengaman kalau tabel ini membesar.
        .limit(5000);
      if (legacyErr) throw legacyErr;
      const targetCode = normalizeKatalogCode(katalog.katalog);
      (legacyRows||[]).forEach(row=>{
        if (!targetCode || normalizeKatalogCode(row.no_katalog) !== targetCode) return;
        const tgl = new Date(row.tanggal);
        const bulanKey = `${tgl.getFullYear()}-${String(tgl.getMonth()+1).padStart(2,"0")}`;
        if (historyMap[bulanKey] === undefined) { historyMap[bulanKey] = 0; legacyMonthsAdded++; }
        historyMap[bulanKey] += row.qty||0;
      });
    } catch (legacyError) {
      console.error("Forecast: gagal ambil histori arsip TUG-15 lama, lanjut dengan histori live saja:", legacyError.message);
    }

    const history = Object.entries(historyMap).sort().slice(-18);
    const totalQty = stockRows.reduce((a,s)=>a+(s.qty||0),0);
    const rencana = rencanaKedatanganList
      .flatMap(r=>(r.items||[]).map(i=>({...i,noKontrak:r.noKontrak,supplier:r.supplier,tanggalSerahTerima:r.tanggalSerahTerima})))
      .filter(i=>i.katalogId===katalog.id);

    // Metrik terhitung: rata-rata, tren, estimasi habis (dipakai di prompt & fallback lokal).
    // Rata-rata pakai TSB (bukan flat total/jumlah bulan) -- konsisten dengan getRisk() di
    // ForecastStokPage.jsx, lihat src/lib/tsbForecast.js untuk alasan lengkap (pola pemakaian
    // material gudang PLN intermiten/lumpy, rata-rata flat bias oleh panjang jendela observasi).
    const { forecastPerPeriod } = tsbMonthlyForecast(expandMonthlySeriesFromMap(historyMap));
    // Bulatkan HANYA untuk teks yang ditampilkan (Math.round, bukan Math.floor -- floor pernah
    // bikin rate kecil seperti 0,3/bulan tampil "0" dan salah dibaca "tidak ada data pemakaian"
    // padahal histori-nya ada, ditemukan user 2026-08-01 pada material dgn demand sangat jarang).
    // Perhitungan estimasi hari (estimasiHari) TETAP pakai forecastPerPeriod asli/tidak dibulatkan
    // supaya sinyal demand kecil tidak hilang duluan sebelum sempat dipakai menghitung.
    const rataRataBulanan = Math.round(forecastPerPeriod);
    let trenPersen = null, trenLabel = "data terlalu sedikit untuk tren";
    if (history.length>=4) {
      const mid = Math.floor(history.length/2);
      const avgAwal = history.slice(0,mid).reduce((a,[,q])=>a+q,0)/mid;
      const avgAkhir = history.slice(mid).reduce((a,[,q])=>a+q,0)/(history.length-mid);
      trenPersen = avgAwal===0 ? (avgAkhir===0?0:100) : Math.round(((avgAkhir-avgAwal)/avgAwal)*100);
      trenLabel = `${trenPersen>=0?"naik":"turun"} ${fmtNum(Math.abs(trenPersen))}%`;
    }
    const estimasiHari = forecastPerPeriod>0 ? Math.round(totalQty/(forecastPerPeriod/30)) : null;
    const estimasiHariText = estimasiHari===null ? "tidak dapat dihitung (belum ada data pemakaian)" : `${fmtNum(estimasiHari)} hari`;

    const prompt = `Analisis mendalam untuk material berikut:

Material: ${katalog.name}
No Katalog: ${katalog.katalog}
Jenis: ${katalog.jenisBarang||"-"}
Satuan: ${katalog.satuan}
Stok saat ini: ${totalQty} ${katalog.satuan}
Min stok: ${stockRows[0]?.minQty||0}

History pemakaian per bulan (${history.length} bulan${legacyMonthsAdded>0?`, ${liveMonthsCount} bulan dari data live + ${legacyMonthsAdded} bulan dari arsip histori TUG-15 lama katalog cocok`:""}):
${history.length===0?"Belum ada data pemakaian":history.map(([b,q])=>`${b}: ${q} ${katalog.satuan}`).join('\n')}

Ringkasan terhitung:
- Rata-rata pemakaian: ${fmtNum(rataRataBulanan)} ${katalog.satuan} per bulan
- Tren: ${trenLabel} dibanding periode sebelumnya
- Estimasi stok habis dalam: ${estimasiHariText}

Rencana kedatangan:
${rencana.length===0?"Tidak ada rencana kedatangan":rencana.map(r=>`- ${r.jumlah} ${r.satuan} dari ${r.supplier} (${r.tanggalSerahTerima})`).join('\n')}

Gunakan angka-angka pada "Ringkasan terhitung" di atas apa adanya (jangan menghitung ulang rata-rata/tren dari history mentah). Berikan analisis forecast dalam format:

📊 DATA
[ringkasan data pemakaian, rata-rata, tren]

🔍 ANALISIS
[pola pemakaian, prediksi kebutuhan 1/3/6 bulan ke depan, faktor risiko]

💡 REKOMENDASI
[waktu pengadaan ideal, jumlah yang perlu diadakan, safety stock yang disarankan]

Sumber: Data TUG WARNOTO UPT Surabaya`;

    try {
      const groqKey = (import.meta.env.VITE_GROQ_API_KEY || "").trim();
      if (!groqKey) throw new Error("Konfigurasi layanan AI belum tersedia.");
      const resp = await fetch("https://api.groq.com/openai/v1/chat/completions",{
        method:"POST",
        headers:{"Content-Type":"application/json","Authorization":`Bearer ${groqKey}`},
        body:JSON.stringify({model:"llama-3.3-70b-versatile",max_tokens:1200,messages:[{role:"user",content:prompt}]})
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data?.error?.message || `Layanan AI merespons HTTP ${resp.status}.`);
      const result = data.choices?.[0]?.message?.content||"Tidak ada hasil.";
      setForecastDetailResult(result);
    } catch (error) {
      console.error("Forecast drill-down beralih ke mode data lokal:", error.message);
      const rekomendasi = estimasiHari===null
        ? "pantau berkala, belum mendesak (belum ada data pemakaian untuk dihitung)"
        : estimasiHari<30 ? "pengadaan mendesak"
        : estimasiHari<=90 ? "mulai proses pengadaan"
        : "pantau berkala, belum mendesak";
      setForecastDetailResult(`Layanan AI sedang tidak tersedia, jadi ringkasan berikut dihitung langsung dari data WARNOTO (tanpa AI).

📊 DATA
- Stok saat ini: ${fmtNum(totalQty)} ${katalog.satuan}
- Rata-rata pemakaian: ${fmtNum(rataRataBulanan)} ${katalog.satuan} per bulan (${history.length} bulan data)
- Tren: ${trenLabel}

🔍 ANALISIS
- Estimasi stok habis dalam: ${estimasiHariText}
- Rencana kedatangan: ${rencana.length===0?"tidak ada":rencana.map(r=>`${fmtNum(r.jumlah)} ${r.satuan} dari ${r.supplier} (${r.tanggalSerahTerima})`).join(', ')}

💡 REKOMENDASI
- ${rekomendasi}`);
    }
    setForecastDetailLoading(false);
  }

  // ── DERIVED ──
  // enrichedStocks: each row from `stocks` (junction table) joined with its
  // Master Katalog and Master Lokasi data, shaped to look like the old flat
  // stock record so the rest of the UI/PDF/forecast code can use familiar
  // fields (name, katalog, category, unit, lokasi) without modification.
  const enrichedStocks = enrichStocks(stocks, katalogList, lokasiList);
  stateRef.current.enrichedStocks = enrichedStocks;
  // Cakupan UPT 3-tier (UPT sendiri | semua UPT di UIT | nasional) untuk SEMUA layar
  // operasional — sumber tunggal getScopeUptIds/inScopeUpt (src/lib/roles.js, Gelombang 2
  // multi-UPT). Data mentah (stocks/txns/attbList) tetap utuh untuk mutasi/approval lintas-UPT;
  // yang discope hanya turunan yang di-oper ke tab DISPLAY.
  const dataScope = getScopeUptIds(currentUser, uptList);
  const scopedEnrichedStocks = dataScope === null ? enrichedStocks : enrichedStocks.filter(s => {
    const gid = lokasiList.find(l => l.id === s.lokasiId)?.gudangId || s.gudangId || null;
    // Mirror RLS COALESCE(gudang.upt_id, stocks.upt_id): stok tanpa gudang tetap terpetakan ke
    // UPT-nya lewat s.uptId, bukan dianggap "tanpa UPT" yang lolos ke semua scope.
    const uptId = (gid ? gudangList.find(g => g.id === gid)?.uptId : null) || s.uptId || null;
    return inScopeUpt(uptId, dataScope);
  });
  const scopedStockIds = dataScope === null ? null : new Set(scopedEnrichedStocks.map(s => s.id));
  // Junction rows mentah, versi scoped — dipakai layar yang butuh bentuk pra-enrich (mis. Forecast).
  const scopedStocks = dataScope === null ? stocks : stocks.filter(s => scopedStockIds.has(s.id));
  const scopedTxns = dataScope === null ? txns : txns.filter(t => inScopeUpt(t.uptId || users.find(u => u.id === t.createdBy)?.uptId || null, dataScope));
  const scopedAttbUptNames = dataScope === null ? null : new Set(
    uptList.filter(u => dataScope.includes(u.id)).map(u => (u.nama || "").replace(/^UPT\s+/i, "").trim())
  );
  const scopedAttbList = scopedAttbUptNames === null ? attbList : attbList.filter(a => !a.upt || scopedAttbUptNames.has(a.upt));
  // Opname & Stock Count discope lewat UPT pembuat/pengunggah (tak ada field uptId di sesi).
  const scopedOpnameList = dataScope === null ? opnameList : opnameList.filter(o => inScopeUpt(users.find(u => u.id === o.dibuatOleh)?.uptId || null, dataScope));
  const scopedStockCountList = dataScope === null ? stockCountList : stockCountList.filter(sc => inScopeUpt(users.find(u => u.id === sc.uploadedBy)?.uptId || null, dataScope));
  // UPT adalah pagar pertama; gudang_ids hanya mempersempit scope itu.
  // SUPERADMIN tetap global, sedangkan akun UIT/ULTG mengikuti hierarki unitnya.
  const gudangAccessLimited = currentUser?.role !== "SUPERADMIN";
  const visibleGudangList = useMemo(() => getVisibleGudangForInspection({
    currentUser,
    currentUserUptId,
    gudangList,
    uptList,
  }), [currentUser, currentUserUptId, gudangList, uptList]);
  // Kapasitas/Peta Gudang: baris kapasitas dicocokkan by NAMA gudang (warehouse_capacity
  // tak menyimpan id gudang). ponytail: match-by-name, cukup untuk enforcement UI; unrestricted user di-early-return supaya tak terpengaruh sama sekali.
  const visibleCapacityList = useMemo(() => {
    if (!gudangAccessLimited) return gudangCapacityList;
    const names = new Set(visibleGudangList.map(g => (g.nama||"").trim().toLowerCase()));
    return gudangCapacityList.filter(r => names.has((r.gudang||"").trim().toLowerCase()));
  }, [gudangCapacityList, visibleGudangList, gudangAccessLimited]);
  const myPendingApprovals = txns.filter(t => {
    if (currentUser?.role === "SUPERADMIN" && t.status === "PENDING") return true;
    if (t.status === "PENDING" && t.requiredApprover === currentUser?.role) return true;
    // TUG-5: Asman and Manager see their respective stages
    if (t.docType==="TUG5" && t.stage==="PENDING_ASMAN" && hasRole(currentUser, "ASMAN")) return true;
    if (t.docType==="TUG5" && t.stage==="PENDING_MANAGER" && hasRole(currentUser, "MANAGER")) return true;
    // TUG-7 DRAFT_UIT stage needs Admin UIT attention
    if (t.docType==="TUG7" && t.stage==="DRAFT_UIT" && hasRole(currentUser, "ADMIN_UIT")) return true;
    // TUG-7 PENDING_MGR_LOGISTIK needs Manager Logistik UIT
    if (t.docType==="TUG7" && t.stage==="PENDING_MGR_LOGISTIK" && hasRole(currentUser, "MGR_LOGISTIK_UIT")) return true;
    // TUG-8 DRAFT from TUG-7 needs Admin/TL UPT to confirm
    if (t.docType==="TUG8" && t.stage==="DRAFT_TUG8" && hasRole(currentUser, "ADMIN","TL")) return true;
    // TUG-5 dari ULTG: Manager ULTG (unit yang sama) approve
    if (t.docType==="TUG5" && t.sourceType==="ULTG" && t.stage==="PENDING_MGR_ULTG" && currentUser?.role==="MGR_ULTG" && t.ultgId===currentUser?.ultgId) return true;
    return false;
  });
  // Pengajuan TUG-5 dari ULTG yang sudah disetujui Manager ULTG, siap di-adopt oleh Admin/TL UPT induknya.
  // currentUser.uptId biasanya KOSONG untuk akun ADMIN/TL biasa (UPT mereka ditentukan dari konstanta
  // global UPT/WAREHOUSE, bukan field profil) — fallback cocokkan nama UPT konstan ke Master UPT.
  const ultgPengajuanUntukAdopt = hasRole(currentUser, "ADMIN","TL") ? txns.filter(t =>
    t.docType==="TUG5" && t.sourceType==="ULTG" && t.stage==="APPROVED_ULTG" && !t.adoptedBy &&
    (currentUser?.role==="SUPERADMIN" || ultgList.find(u=>u.id===t.ultgId)?.parentUptId === currentUserUptId)
  ) : [];
  const pendingTxns = txns.filter(t=>t.status==="PENDING");
  const stockCountPendingCount = stockCountList.reduce((a,s)=>a+s.items.filter(i=>i.approval==="PENDING").length, 0);
  const heavyEquipmentPendingCount = heavyEquipmentLoans.filter(l=>isPendingHeavyEquipmentLoan(l) && canApproveHeavyEquipmentLoan(currentUser, l, uptList)).length;
  // Overdue reminder discope ke UPT user sendiri (pemilik ATAU peminjam alat) — sebelumnya
  // dihitung global tanpa filter sama sekali, jadi 1 alat overdue di UPT lain pun ikut muncul
  // sebagai badge di menu Alat Berat untuk SEMUA login, termasuk yang tidak ada urusan sama sekali.
  const myUptForHeavyEquipment = getUserUptScope(currentUser, uptList);
  // Nama UPT untuk brand sidebar/header — ikut UPT user login, bukan konstanta hardcoded UPT (Surabaya).
  // Label unit untuk brand/header/Pak War, sesuai tier: nasional (Pusat/SUPERADMIN,
  // dataScope null) → "Semua UPT"; akun UIT (uitId ada, uptId kosong) → nama UIT-nya;
  // akun UPT → nama UPT. Dulu selalu fallback konstanta UPT ("UPT Surabaya") untuk akun
  // tanpa uptId, jadi nasional/UIT keliru menampilkan "UPT Surabaya".
  const currentUptNama =
    dataScope === null ? "PLN Pusat"
    : (currentUser?.uitId && !currentUser?.uptId)
      ? (((uitList.length ? uitList : []).find(u => u.id === currentUser.uitId)?.kode || "UIT").replace(/-/g, " "))
      : ((uptList.length ? uptList : DEFAULT_UPT_LIST).find(u => u.id === currentUser?.uptId)?.nama || UPT);
  const heavyEquipmentOverdueCount = heavyEquipmentLoans.filter(l=>getHeavyEquipmentLoanRuntimeStatus(l)==="OVERDUE" &&
    (getHeavyEquipmentLoanOwnerUpt(l)===myUptForHeavyEquipment || getHeavyEquipmentLoanRequesterUpt(l)===myUptForHeavyEquipment)).length;
  const attbPendingCount = attbList.filter(a=>isPendingAttbApproval(a) && canApproveAttb(currentUser, a, uptList)).length;
  const attbBelumLanjutCount = attbList.filter(a=>a.lanjutBelumLanjut && (a.upt===myUptForHeavyEquipment || hasRole(currentUser,"MSB","Manager UIT"))).length;
  // Pool material Bongkaran ATTB (MTU) dari TUG-10 — sumber kandidat ATTB sebelum
  // tahap AE.1. Diturunkan dari transaksi TUG-10 (retur) yang punya stockItem
  // berstatus "Bongkaran ATTB (MTU)". Tiap item = 1 unit material bongkaran fisik.
  const attbBongkaranPool = useMemo(() => {
    const items = [];
    txns.filter(t => t.docType==="TUG10").forEach(t => {
      (t.stockItems||[]).forEach((si, idx) => {
        if (si.statusMaterial !== "Bongkaran ATTB (MTU)") return;
        const nama = si.katalogMode==="existing"
          ? (katalogList.find(k=>k.id===si.katalogId)?.name || si.namaBaru || "-")
          : (si.namaBaru || "-");
        items.push({
          key: `${t.id}::${si.noSeri||idx}`,
          nama, qty: si.qty, satuan: si.satuanBaru || "",
          noSeri: si.noSeri || "", noAsset: si.noAsset || "",
          tug10No: t.docNumbers?.tug10 || t.id,
          tanggal: t.approvedAt || t.createdAt,
          namaPekerjaan: t.namaPekerjaan || "",
          status: t.status || "",
          // Keep both source photos.  ATTB preview needs to distinguish the
          // overall material photo from the nameplate (the old `foto` fallback
          // discarded whichever one was not selected first).
          fotoKeseluruhan: si.fotoBarangRetur || null,
          fotoNameplate: si.fotoNameplate || null,
          foto: si.fotoBarangRetur || si.fotoNameplate || null,
        });
      });
    });
    return items.sort((a,b)=>(b.tanggal||0)-(a.tanggal||0));
  }, [txns, katalogList]);
  // Material kritis AGREGAT per katalog (total semua lokasi ≤ minimum) — dipakai seluruh dashboard.
  // Discope per UPT (Gelombang 2 multi-UPT): dashboard/forecast bukan lagi agregat nasional
  // untuk akun UPT/UIT.
  const lowStocks = getKritisAgg(scopedEnrichedStocks, buildMonthlySeriesByKatalog(scopedTxns, scopedEnrichedStocks));
  const forecastSoon = getMaterialAkanHabis(scopedEnrichedStocks, katalogList, scopedTxns, 9999).filter(r=>!r.isKritis && r.estimasiHari!==Infinity && r.estimasiHari<=30);
  // Ringkasan Rekomendasi Pengadaan untuk kartu Dashboard — rumus sama persis dgn tab
  // Rekomendasi Pengadaan di Forecast Stok (computeProcurementList, src/lib/analytics.js).
  const procurementResult = computeProcurementList({
    katalogList, stocks: scopedEnrichedStocks, txns: scopedTxns, materialCadangHealthData,
  });
  const procurementSummary = {
    totalCount: procurementResult.list.length,
    totalQty: procurementResult.totalQty,
    totalValue: procurementResult.totalValue,
    criticalCount: procurementResult.criticalCount,
    top: procurementResult.list.slice(0,5),
  };
  // Guard NaN: satu baris dgn qty/price undefined atau string non-numerik akan
  // meracuni seluruh Σ jadi NaN (fmtRp(NaN) tampil "Rp 0"). Number(...)||0 menetralkan per-baris.
  const totalVal = scopedEnrichedStocks.reduce((a,s)=>a+(Number(s.qty)*Number(s.price)||0),0);
  // Filter UPT untuk Data Stok — HANYA viewer multi-UPT: Pusat/SUPERADMIN (dataScope null) lihat
  // semua UPT; UIT (dataScope >1) lihat UPT di UIT-nya. Akun 1 UPT tak dapat dropdown (kosong).
  const stockUptFilterOptions = dataScope === null ? uptList
    : (Array.isArray(dataScope) && dataScope.length > 1 ? uptList.filter(u => dataScope.includes(u.id)) : []);
  const deferredSearch = useDeferredValue(search); // React 18+: input tetap responsif saat list besar difilter ulang
  const filteredStocks = scopedEnrichedStocks.filter(s=>{
    const lokForSearch = lokasiList.find(l=>l.id===s.lokasiId);
    const gdgForSearch = (lokForSearch?.gudangId || s.gudangId)
      ? gudangList.find(g=>g.id===(lokForSearch?.gudangId || s.gudangId))
      : null;
    const ms = matchesStockSearch({
      ...s,
      blok: [lokForSearch?.kode, lokForSearch?.nama].filter(Boolean).join(" "),
      gudang: [gdgForSearch?.kode, gdgForSearch?.nama].filter(Boolean).join(" "),
    }, deferredSearch);
    const mj = filterJenis==="ALL" || s.jenisBarang===filterJenis;
    const msap = filterStatusSAP==="ALL" || stockSapLabel(s)===filterStatusSAP;
    // RBAC per gudang: sembunyikan stok yang lokasinya milik gudang terlarang.
    // Stok tanpa gudang (belum di-assign) tetap tampil. No-op utk user unrestricted.
    const gid = lokasiList.find(l=>l.id===s.lokasiId)?.gudangId || s.gudangId || null;
    const mg = canAccessGudang(currentUser, gid);
    // Mirror RLS COALESCE(gudang.upt_id, stocks.upt_id): stok tanpa gudang (mis. material Gresik
    // belum di-assign lokasi) tetap kena filter UPT lewat s.uptId, bukan hilang.
    const stockUpt = (gid ? gudangList.find(g=>g.id===gid)?.uptId : null) || s.uptId || null;
    const mu = !stockUptFilter || (stockUpt === stockUptFilter);
    const mgud = !stockGudangSelect || gid === stockGudangSelect;
    const mblok = !stockBlokSelect || s.lokasiId === stockBlokSelect;
    const mq = stockQuickFilter==="kritis" ? (s.jenisBarang!=="Non-Stock" && s.qty<=s.minQty)
      : stockQuickFilter==="tanpaLokasi" ? !s.lokasiId
      : true;
    return ms && mj && msap && mg && mu && mgud && mblok && mq;
  });
  // Opsi filter UPT generik dipakai TUG (identik pola stockUptFilterOptions).
  const multiUptFilterOptions = stockUptFilterOptions;
  // Mode "katalog" — group filteredStocks per barang (lintas lokasi) jadi baris sintetis
  // "AGG-<katalogId>", supaya user bisa lihat total qty barang tanpa pecahan per blok.
  // Mode "lokasi" (default): viewStocks === filteredStocks apa adanya, TIDAK ada perubahan.
  const viewStocks = stockViewMode !== "katalog" ? filteredStocks : (() => {
    const groups = new Map();
    for (const s of filteredStocks) {
      const key = s.katalogId || s.katalog;
      let g = groups.get(key);
      if (!g) { g = { ...s, id:"AGG-"+key, qty:0, minQty:0, lokasiId:undefined, lokasiCount:0, aggMembers:[], deletePending:false, editPending:false }; groups.set(key, g); }
      g.qty += Number(s.qty)||0;
      g.minQty += Number(s.minQty)||0;
      g.lokasiCount += 1;
      g.aggMembers.push(s);
      if (s.deletePending) g.deletePending = true;
      if (s.editPending) g.editPending = true;
    }
    return [...groups.values()];
  })();
  // Sort Data Stok — kunci "lokasi" (kode gudang+blok, atau lokasiCount di mode katalog)
  // dihitung sekali per baris sebelum sort (decorate-sort), bukan di dalam comparator,
  // supaya lookup lokasiList/gudangList tidak dipanggil O(n log n) kali untuk daftar besar.
  const sortedStocks = viewStocks
    .map(s => {
      // Lookup lokasi/gudang hanya kalau memang sort by lokasi — kalau tidak, seluruh
      // daftar (bisa ribuan baris) kena 2 .find() percuma di SETIAP render.
      if (stockSort.key !== "lokasi") return { s, lokasiKey: "" };
      if (stockViewMode === "katalog") return { s, lokasiKey: s.lokasiCount };
      const lok = lokasiList.find(l=>l.id===s.lokasiId);
      const gdg = (lok?.gudangId || s.gudangId) ? gudangList.find(g=>g.id===(lok?.gudangId||s.gudangId)) : null;
      return { s, lokasiKey: [gdg?.kode||gdg?.nama, lok?.kode].filter(Boolean).join(" ") };
    })
    .sort((a, b) => {
      const cmp = stockSort.key==="qty" ? (Number(a.s.qty)||0) - (Number(b.s.qty)||0)
        : stockSort.key==="lokasi" ? (typeof a.lokasiKey==="number" ? a.lokasiKey-b.lokasiKey : a.lokasiKey.localeCompare(b.lokasiKey,"id",{numeric:true,sensitivity:"base"}))
        : String(a.s.name||"").localeCompare(String(b.s.name||""),"id",{numeric:true,sensitivity:"base"});
      return stockSort.dir==="desc" ? -cmp : cmp;
    })
    .map(x => x.s);
  const stockTotalPages = Math.max(1, Math.ceil(viewStocks.length / stockPageSize));
  const stockPageClamped = Math.min(stockPage, stockTotalPages);
  const pagedStocks = sortedStocks.slice((stockPageClamped-1)*stockPageSize, stockPageClamped*stockPageSize);
  const filteredKatalog = katalogList.filter(k => matchesKatalogSearch(k, katalogSearch) && (!katalogFilterBelumMara || k.belumDicocokkanMara));
  const katalogTotalPages = Math.max(1, Math.ceil(filteredKatalog.length / katalogPageSize));
  const katalogPageClamped = Math.min(katalogPage, katalogTotalPages);
  const pagedKatalog = filteredKatalog.slice((katalogPageClamped-1)*katalogPageSize, katalogPageClamped*katalogPageSize);
  const filteredTxns = scopedTxns.filter(t=> (filterStatus==="ALL" || t.status===filterStatus) &&
    (!tugUptFilter || (t.uptId || users.find(u=>u.id===t.createdBy)?.uptId) === tugUptFilter)
  ).sort((a,b)=>b.createdAt-a.createdAt);
  const activeTugTxns = tugSubTab==="TUG15" ? [] : scopedTxns.filter(t=>t.docType===tugSubTab);
  const activeTugSummary = [
    {label:"Total Dokumen",val:activeTugTxns.length},
    {label:"Menunggu",val:activeTugTxns.filter(t=>t.status==="PENDING").length,cls:"is-alert"},
    {label:"Disetujui",val:activeTugTxns.filter(t=>t.status==="APPROVED").length,cls:"is-ok"},
    {label:"Draft",val:activeTugTxns.filter(t=>t.status==="DRAFT").length},
  ];

  // ── DESIGN TOKENS ──

  // Target sentuh & ukuran font input dibesarkan otomatis di HP (isMobile):
  // - tombol minimal ~44px tinggi (standar minimum tap target Apple/Google)
  //   supaya tidak gampang salah pencet pakai jari.
  // - font input >=16px di HP supaya Safari/Chrome iOS tidak auto-zoom saat
  //   field di-tap (auto-zoom terjadi kalau font input <16px).
  // Shadow lokal palet: seluruh C.xxx & sty.xxx di PLNWarehouse + komponen anak
  // (via prop C={C}) otomatis mengikuti tema aktif. Deklarasi sebelum sty dipakai.
  const C = theme === "dark" ? C_DARK : C_LIGHT;
  const sty = makeSty(isMobile, C);
  const loginSty = makeSty(isMobile, C_LIGHT);

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
    <div style={{minHeight:"100vh",background:"linear-gradient(135deg,#001a57 0%,#003087 50%,#0052cc 100%)",display:"flex",alignItems:"center",justifyContent:"center",padding:16,fontFamily:"'Inter',system-ui,sans-serif"}}>
      <div style={{background:"linear-gradient(160deg,#123a7a,#0b2559)",borderRadius:20,overflow:"hidden",display:"flex",width:isMobile?"100%":720,maxWidth:isMobile?400:720,boxShadow:"0 25px 60px rgba(0,0,0,0.35)"}}>
        {/* KIRI — panel branding (desktop only) */}
        <div style={{display:isMobile?"none":"flex",flexDirection:"column",justifyContent:"center",width:300,flexShrink:0,padding:40,background:"linear-gradient(160deg,#123a7a,#0b2559)",color:"white"}}>
          <div style={{width:76,height:76,background:"white",borderRadius:16,display:"flex",alignItems:"center",justifyContent:"center",marginBottom:22,boxShadow:"0 8px 24px rgba(0,0,0,0.25)",padding:12}}><img src={PLN_LOGO_DATA_URI} alt="Logo PLN" style={{maxWidth:"100%",maxHeight:"100%",objectFit:"contain"}}/></div>
          <div style={{fontSize:34,fontWeight:900,letterSpacing:"1px",lineHeight:1}}>WARNOTO</div>
          <div style={{fontSize:12,color:"rgba(255,255,255,0.75)",fontWeight:600,letterSpacing:1.5,textTransform:"uppercase",margin:"14px 0 6px"}}>{COMPANY}</div>
          <div style={{fontSize:13,color:"rgba(255,255,255,0.6)",lineHeight:1.5}}>Sistem Manajemen Gudang</div>
        </div>
        {/* KANAN — form login */}
        <div style={{flex:1,padding:isMobile?32:40,minWidth:0,background:"#fff"}}>
          {isMobile && (
            <div style={{textAlign:"center",marginBottom:24}}>
              <div style={{width:72,height:72,background:"white",borderRadius:16,display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 12px",boxShadow:"0 8px 24px rgba(0,0,0,0.10)",border:`1px solid ${C_LIGHT.border}`,padding:12}}><img src={PLN_LOGO_DATA_URI} alt="Logo PLN" style={{maxWidth:"100%",maxHeight:"100%",objectFit:"contain"}}/></div>
              <div style={{fontSize:26,fontWeight:900,color:C_LIGHT.accent,letterSpacing:"1px",lineHeight:1}}>WARNOTO</div>
              <div style={{fontSize:12,color:C_LIGHT.muted,marginTop:6}}>Sistem Manajemen Gudang</div>
            </div>
          )}
          <div style={{fontSize:20,fontWeight:800,color:C_LIGHT.text,marginBottom:4}}>Selamat Datang</div>
          <div style={{fontSize:13,color:C_LIGHT.muted,marginBottom:24}}>Masuk untuk melanjutkan ke sistem.</div>
          <div style={{marginBottom:16}}>
            <label style={loginSty.label}>Username</label>
            <input style={loginSty.input} placeholder="Masukkan username..." value={loginForm.username} onChange={e=>setLoginForm(f=>({...f,username:e.target.value}))} onKeyDown={e=>e.key==="Enter"&&handleLogin()} autoFocus/>
          </div>
          <div style={{marginBottom:8}}>
            <label style={loginSty.label}>Password</label>
            <input style={loginSty.input} type="password" placeholder="Masukkan password..." value={loginForm.password} onChange={e=>setLoginForm(f=>({...f,password:e.target.value}))} onKeyDown={e=>e.key==="Enter"&&handleLogin()}/>
          </div>
          {loginErr && <div style={{color:C_LIGHT.red,fontSize:12,marginBottom:12,padding:"8px 12px",background:"#fee2e2",borderRadius:8}}>{loginErr}</div>}
          <button style={{...loginSty.btn("primary"),width:"100%",padding:"12px",fontSize:15,marginTop:8,opacity:loginBusy?0.6:1,cursor:loginBusy?"default":"pointer"}} onClick={handleLogin} disabled={loginBusy}>{loginBusy?"Memeriksa...":"Masuk ke Sistem"}</button>
          <div style={{marginTop:16,fontSize:12,color:C_LIGHT.muted,textAlign:"center"}}>Lupa password? Hubungi Admin untuk reset manual.</div>
        </div>
      </div>
    </div>
  );

  if (loading) return (
    <div style={{minHeight:"100vh",background:C.bg,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'Inter',system-ui,sans-serif"}}>
      <div style={{textAlign:"center"}}><img src={PLN_LOGO_DATA_URI} alt="Logo PLN" style={{height:56,marginBottom:14,objectFit:"contain"}}/><div style={{fontSize:16,fontWeight:700,color:C.accent}}>Memuat data dari cloud...</div></div>
    </div>
  );

  // ══════════════════════ MAIN APP ══════════════════════
  // Role PENGADAAN hanya punya akses Dashboard + Rencana Kedatangan
  const isPengadaan = currentUser?.role === "PENGADAAN";
  // Role ULTG (Admin/Manager ULTG): sidebar terbatas — semua view-only kecuali TUG-5 & Approval TUG-5
  const isUltgRole = ULTG_ROLES.includes(currentUser?.role);
  const tugUiForUser = isUltgRole ? { ...TUG_UI, TUG5: { title:"Slip Reservasi Material", code:"RSV", chip:"Reservasi", buat:"Buat Slip Reservasi", desc:"Ajukan slip reservasi material — Admin ULTG ajukan → Manager ULTG approve → diadopsi UPT jadi TUG-9." } } : TUG_UI;
  const tugGroupUiForUser = isUltgRole ? { ...TUG_GROUP_UI, permintaan: { icon:"📋", label:"Reservasi", hint:"Slip reservasi material dari ULTG ke UPT" } } : TUG_GROUP_UI;
  const navItems = (isPengadaan ? [
    {id:"dashboard",icon:<SidebarIcon name="dashboard"/>,label:"Dashboard"},
    {id:"rencana",icon:<SidebarIcon name="calendar"/>,label:"Rencana Kedatangan"},
  ] : isUltgRole ? [
    {id:"dashboard",icon:<SidebarIcon name="dashboard"/>,label:"Dashboard"},
    {id:"stock",icon:<SidebarIcon name="stock"/>,label:"Data Stok"},
    {id:"kapasitasGudang",icon:<SidebarIcon name="capacity"/>,label:"Kapasitas Gudang"},
    {id:"transaction",icon:<SidebarIcon name="transaction"/>,label:"TUG"},
    {id:"approval",icon:<SidebarIcon name="approval"/>,label:"Approval",badge: hasRole(currentUser, "MGR_ULTG") ? myPendingApprovals.length : 0},
    {id:"heavyEquipment",icon:<SidebarIcon name="equipment"/>,label:"Alat Berat"},
    {id:"rencana",icon:<SidebarIcon name="calendar"/>,label:"Rencana Kedatangan"},
    {id:"forecastStok",icon:<SidebarIcon name="forecast"/>,label:"Forecast Stok"},
    {id:"ai",icon:<SidebarIcon name="ai"/>,label:"Pak War"},
  ] : [
    {id:"dashboard",icon:<SidebarIcon name="dashboard"/>,label:"Dashboard"},
    {id:"stock",icon:<SidebarIcon name="stock"/>,label:"Data Stok"},
    {id:"kapasitasGudang",icon:<SidebarIcon name="capacity"/>,label:"Kapasitas Gudang"},
    {id:"master",icon:<SidebarIcon name="master"/>,label:"Master Data"},
    {id:"transaction",icon:<SidebarIcon name="transaction"/>,label:"TUG"},
    ...(hasRole(currentUser, "TL","ASMAN","MANAGER","ADMIN_UIT","MGR_LOGISTIK_UIT","ADMIN") ? [{id:"approval",icon:<SidebarIcon name="approval"/>,label:"Approval",badge:myPendingApprovals.length + (hasRole(currentUser, "ASMAN")?heavyEquipmentPendingCount:0) + (hasRole(currentUser, "TL","ASMAN") ? gudangCapacityImports.filter(i=>i.status==="PENDING_ASMAN").length : 0) + (hasRole(currentUser, "TL") ? lokasiList.filter(l=>l.status==="PENDING").length : 0) + (hasRole(currentUser, "ADMIN","TL") ? ultgPengajuanUntukAdopt.length : 0) + (hasRole(currentUser, "TL") ? stocks.filter(s=>(s.lokasiMovePending&&s.lokasiMoveApprover==="TL")||s.editPending||s.deletePending).length : 0) + (hasRole(currentUser, "ASMAN") ? stocks.filter(s=>s.lokasiMovePending&&s.lokasiMoveApprover==="ASMAN").length : 0) + (hasRole(currentUser, "ASMAN") ? opnameList.filter(o=>o.status==="PENDING_ASMAN").length : 0) + (hasRole(currentUser, "MANAGER") ? opnameList.filter(o=>o.status==="PENDING_MANAGER").length : 0) + (hasRole(currentUser, "ASMAN") ? stockCountPendingCount : 0)}] : []),
    {id:"heavyEquipment",icon:<SidebarIcon name="equipment"/>,label:"Alat Berat",badge:(hasRole(currentUser, "ASMAN")?heavyEquipmentPendingCount:0)+heavyEquipmentOverdueCount},
    {id:"attb",icon:<SidebarIcon name="attb"/>,label:"ATTB",badge:attbPendingCount+attbBelumLanjutCount},
    {id:"opname",icon:<SidebarIcon name="opname"/>,label:"Stock Opname & Count",badge:stockCountPendingCount},
    {id:"maturity",icon:<SidebarIcon name="maturity"/>,label:"Penilaian Maturity"},
    {id:"rencana",icon:<SidebarIcon name="calendar"/>,label:"Rencana Kedatangan"},
    {id:"forecastStok",icon:<SidebarIcon name="forecast"/>,label:"Forecast Stok"},
    {id:"inspeksiMaterial",icon:<SidebarIcon name="inspection"/>,label:"Inspeksi Material"},
    {id:"ai",icon:<SidebarIcon name="ai"/>,label:"Pak War"},
  ]).filter(n => can(currentUser, "menu." + n.id, rolePerms)); // RBAC: sembunyikan menu yang izinnya dicabut Admin (default = perilaku existing)

  const sidebarCompact = !isMobile && sidebarCollapsed;
  const masterPageTitle = stockSubTab==="katalog"?"Master Katalog Barang":stockSubTab==="satpam"?"Daftar Satpam":stockSubTab==="timmutu"?"Master Tim Mutu":stockSubTab==="organisasi"?"Struktur Organisasi":stockSubTab==="akun"?"Kelola Akun":stockSubTab==="migrasi"?"Migrasi Data SAP / Non-SAP":stockSubTab==="auditLog"?"Audit Log":stockSubTab==="perms"?"Matrix Izin":"Master Gudang";
  const pageMeta = {
    dashboard: {eyebrow:"Operations Overview",title:hasRole(currentUser,"MANAGER")?"Dashboard Eksekutif":hasRole(currentUser,"ASMAN")?"Dashboard Operasional":"Dashboard Gudang"},
    stock: {eyebrow:"Inventory Control",title:"Data Stok Gudang"},
    master: {eyebrow:"Master Data",title:masterPageTitle},
    transaction: {eyebrow:(tugUiForUser[tugSubTab]||{}).code||"TUG",title:(tugUiForUser[tugSubTab]||{}).title||"Transaksi TUG"},
    approval: {eyebrow:"Decision Center",title:"Approval"},
    heavyEquipment: {eyebrow:"Fleet Operations",title:"Alat Berat & Peminjaman"},
    attb: {eyebrow:"Asset Disposal Governance",title:"ATTB — Penghapusan Aset"},
    maturity: {eyebrow:"Warehouse Maturity Audit",title:"Penilaian Maturity Gudang"},
    opname: {eyebrow:"Inventory Assurance",title:opnameSubTab==="stockCount"?"Stock Count":"Stock Opname"},
    rencana: {eyebrow:"Inbound Planning",title:"Rencana Kedatangan Barang"},
    kapasitasGudang: {eyebrow:"Warehouse Utilization",title:"Monitoring Kapasitas Gudang"},
    forecastStok: {eyebrow:"Inventory Forecast",title:"Forecast Stok"},
    inspeksiMaterial: {eyebrow:"Material Assurance",title:"Inspeksi Material Cadang"},
    ai: {eyebrow:"Decision Support",title:"Pak War — Asisten Gudang"},
  }[tab] || {eyebrow:"WARNOTO",title:"Dashboard"};
  const tug5UptKode = txnForm?.docType === "TUG5" && txnForm?.sourceType === "ULTG"
    ? uptList.find(u => u.id === (ultgList.find(x => x.id === txnForm.ultgId)?.parentUptId || currentUser?.uptId))?.kode || "UPT-SBY"
    : null;

  return (
    <div className="app-shell" data-current-tab={tab} style={{display:"flex",minHeight:"100vh",fontFamily:"'Inter',system-ui,sans-serif",background:C.bg,color:C.text}}>
      <DemoBannerAndToast
        C={C} sty={sty} currentUser={currentUser} isMobile={isMobile}
        toast={toast} savingInfo={savingInfo}
        scannerOpen={scannerOpen} handleScanResult={handleScanResult} setScannerOpen={setScannerOpen}
      />

      <AppSidebar
        C={C} sty={sty} isMobile={isMobile}
        mobileMenuOpen={mobileMenuOpen} setMobileMenuOpen={setMobileMenuOpen}
        sidebarCompact={sidebarCompact} setSidebarCollapsed={setSidebarCollapsed}
        navItems={navItems} tab={tab} setTab={setTab}
        tugExpanded={tugExpanded} setTugExpanded={setTugExpanded} tugGroup={tugGroup} setTugGroup={setTugGroup} setTugSubTab={setTugSubTab} isUltgRole={isUltgRole}
        masterExpanded={masterExpanded} setMasterExpanded={setMasterExpanded} stockSubTab={stockSubTab} setStockSubTab={setStockSubTab}
        opnameExpanded={opnameExpanded} setOpnameExpanded={setOpnameExpanded} opnameSubTab={opnameSubTab} setOpnameSubTab={setOpnameSubTab} stockCountPendingCount={stockCountPendingCount}
        currentUser={currentUser} rolePerms={rolePerms} uptNama={currentUptNama}
        cloudSaving={cloudSaving} dataRefreshing={dataRefreshing} lastSaved={lastSaved}
      />
      {/* MAIN */}
      <main className="app-main" style={{flex:1,overflowY:"auto",width:isMobile?"100%":"auto",minWidth:0}}>
          <AppHeaderBar
            C={C} sty={sty} currentUser={currentUser} isMobile={isMobile}
            setMobileMenuOpen={setMobileMenuOpen} pageMeta={pageMeta} accountMenuRef={accountMenuRef}
            theme={theme} setTheme={setTheme} accountMenuOpen={accountMenuOpen} setAccountMenuOpen={setAccountMenuOpen}
            UPT={currentUptNama} openGantiPassword={openGantiPassword} loggingOut={loggingOut} handleLogout={handleLogout}
          />

        <div className="app-content" style={{padding:isMobile?16:"clamp(18px, 2vw, 30px)"}}>

        {/* DASHBOARD */}
        {tab==="dashboard" && (
          <DashboardTabRouter
            C={C} sty={sty} currentUser={currentUser} isMobile={isMobile}
            maturityAssessments={maturityAssessments} MATURITY_LEVELS={MATURITY_LEVELS} WAREHOUSE={WAREHOUSE}
            setMaturityForm={setMaturityForm} setMaturityModal={setMaturityModal}
            dashTab={dashTab} setDashTab={setDashTab}
            totalVal={totalVal} lowStocks={lowStocks} forecastSoon={forecastSoon} myPendingApprovals={myPendingApprovals}
            stockCountPendingCount={stockCountPendingCount} attbPendingCount={attbPendingCount} attbBelumLanjutCount={attbBelumLanjutCount} stockCountList={scopedStockCountList}
            setTab={setTab} setOpnameSubTab={setOpnameSubTab}
            enrichedStocks={scopedEnrichedStocks} txns={scopedTxns} katalogList={katalogList} uptList={uptList} lokasiList={lokasiList} rencanaKedatanganList={rencanaKedatanganList}
            topN={topN} setTopN={setTopN} pemakaianMode={pemakaianMode} setPemakaianMode={setPemakaianMode}
            heavyEquipmentList={heavyEquipmentList} heavyEquipmentLoans={heavyEquipmentLoans} attbList={scopedAttbList} attbBongkaranPool={attbBongkaranPool}
            materialCadangData={materialCadangData} gudangList={petaGudangList} petaWilayahDivRef={petaWilayahDivRef}
            petaUptLabel={petaScopeUptIds === null ? "Semua UPT" : (petaScopeUptIds.length === 1 ? currentUptNama : "Wilayah UIT")}
            procurementSummary={procurementSummary}
          />
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
                opnameList={scopedOpnameList}
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
                openScanner={openScanner}
                showToast={showToast}
                uptList={uptList}
                gudangList={gudangList}
                lokasiList={lokasiList}
                addNonStockFoundItem={addNonStockFoundItem}
                isMobile={isMobile}
              />
            ) : (
              <StockCountTab
                stockCountList={scopedStockCountList}
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
            gudangCapacityList={visibleCapacityList}
            gudangCapacityImports={gudangCapacityImports}
            gudangList={visibleGudangList}
            uptList={uptList}
            subGudangList={subGudangList}
            lokasiList={lokasiList}
            stocks={enrichedStocks}
            currentUser={currentUser}
            sty={sty} C={C}
            setTab={setTab}
            setStockSubTab={setStockSubTab}
            showToast={showToast}
            onSynced={reloadKapasitas}
          />
        )}

        {tab==="rencana" && (
          <RencanaKedatanganTab
            rencanaList={rencanaKedatanganList}
            katalogList={katalogList}
            currentUser={currentUser}
            sty={sty} C={C} isMobile={isMobile}
            saveRencana={saveRencana}
            deleteRencana={deleteRencana}
            aiExtractKontrak={aiExtractKontrak}
          />
        )}

        {/* STOCK */}
        {/* DATA STOK — view of operational stock (read-focused, with admin edit) */}
        {tab==="stock" && (
          <DataStokTab
            C={C} sty={sty} currentUser={currentUser} isMobile={isMobile}
            search={search} setSearch={setSearch} openScanner={openScanner}
            setPhotoSearchImg={setPhotoSearchImg} setPhotoSearchOpen={setPhotoSearchOpen}
            filterJenis={filterJenis} setFilterJenis={setFilterJenis}
            filterStatusSAP={filterStatusSAP} setFilterStatusSAP={setFilterStatusSAP}
            stockUptFilter={stockUptFilter} setStockUptFilter={setStockUptFilter} stockUptFilterOptions={stockUptFilterOptions} uptNama={currentUptNama}
            stockGudangSelect={stockGudangSelect} setStockGudangSelect={setStockGudangSelect}
            stockBlokSelect={stockBlokSelect} setStockBlokSelect={setStockBlokSelect}
            stockQuickFilter={stockQuickFilter} setStockQuickFilter={setStockQuickFilter}
            stockSort={stockSort} setStockSort={setStockSort}
            stockViewMode={stockViewMode} setStockViewMode={setStockViewMode} stockViewCount={viewStocks.length}
            filteredStocks={filteredStocks} stocks={stocks} setStocks={setStocks}
            photoSearchResults={photoSearchResults} setPhotoSearchResults={setPhotoSearchResults}
            photoSearchResultMode={photoSearchResultMode} photoSearchOcrText={photoSearchOcrText}
            enrichedStocks={scopedEnrichedStocks} pagedStocks={pagedStocks}
            setStockDetailId={setStockDetailId}
            katalogList={katalogList} lokasiList={lokasiList} gudangList={gudangList} uptList={uptList}
            subGudangList={subGudangList} visibleGudangList={visibleGudangList}
            stockGudangFilter={stockGudangFilter} setStockGudangFilter={setStockGudangFilter}
            setPendingFoto={setPendingFoto} setLightboxImg={setLightboxImg}
            saveToCloud={saveToCloud} showToast={showToast}
            deleteStock={deleteStock}
            setKartuGantungDetail={setKartuGantungDetail} setPetaMiniDetail={setPetaMiniDetail}
            stockPageSize={stockPageSize} setStockPageSize={setStockPageSize}
            stockPageClamped={stockPageClamped} setStockPage={setStockPage} stockTotalPages={stockTotalPages}
          />
        )}

        {/* MASTER DATA — Master Katalog, Master Lokasi, Satpam (identity/reference data) */}
        {tab==="master" && <MasterDataTab C={C} sty={sty} currentUser={currentUser} isMobile={isMobile} rolePerms={rolePerms} stockSubTab={stockSubTab} filteredKatalog={filteredKatalog} satpamList={satpamList} timMutuList={timMutuList} uitList={uitList} uptList={uptList} ultgList={ultgList} users={users} gudangList={gudangList} lokasiList={lokasiList} subGudangList={subGudangList} visibleGudangList={visibleGudangList} openAddKatalog={openAddKatalog} openAddSatpam={openAddSatpam} openAddUIT={openAddUIT} openAddGudang={openAddGudang} openAddAkun={openAddAkun} importGudangOpen={importGudangOpen} setImportGudangOpen={setImportGudangOpen} showGudangMaintenance={showGudangMaintenance} setShowGudangMaintenance={setShowGudangMaintenance} importLokasiOpen={importLokasiOpen} setImportLokasiOpen={setImportLokasiOpen} gudangCapacityImports={gudangCapacityImports} setGudangCapacityImports={setGudangCapacityImports} saveToCloud={saveToCloud} showToast={showToast} backfillGudangCoordFromCapacity={backfillGudangCoordFromCapacity} dedupeGudangDanSubGudang={dedupeGudangDanSubGudang} isKodeDuplicateInSubGudang={isKodeDuplicateInSubGudang} setLokasiList={setLokasiList} syncLokasi={syncLokasi} maraUploadProgress={maraUploadProgress} maraUploadLoading={maraUploadLoading} uploadMaraToDB={uploadMaraToDB} katalogList={katalogList} katalogSearch={katalogSearch} setKatalogSearch={setKatalogSearch} katalogFilterBelumMara={katalogFilterBelumMara} setKatalogFilterBelumMara={setKatalogFilterBelumMara} setBarcodePrintOpen={setBarcodePrintOpen} pagedKatalog={pagedKatalog} stocks={stocks} openEditKatalog={openEditKatalog} deleteKatalog={deleteKatalog} katalogPageSize={katalogPageSize} setKatalogPageSize={setKatalogPageSize} katalogPageClamped={katalogPageClamped} setKatalogPage={setKatalogPage} katalogTotalPages={katalogTotalPages} openEditSatpam={openEditSatpam} deleteSatpam={deleteSatpam} openEditTimMutu={openEditTimMutu} orgSearch={orgSearch} setOrgSearch={setOrgSearch} collapsedUitIds={collapsedUitIds} setCollapsedUitIds={setCollapsedUitIds} openAddUPT={openAddUPT} openEditUIT={openEditUIT} deleteUIT={deleteUIT} openAddULTG={openAddULTG} openEditUPT={openEditUPT} deleteUPT={deleteUPT} openEditULTG={openEditULTG} deleteULTG={deleteULTG} expandedGudangId={expandedGudangId} setExpandedGudangId={setExpandedGudangId} openEditGudang={openEditGudang} deleteGudang={deleteGudang} showGudangDenahTools={showGudangDenahTools} setShowGudangDenahTools={setShowGudangDenahTools} uploadDenahGudang={uploadDenahGudang} denahLoading={denahLoading} mapConfigGudangId={mapConfigGudangId} setMapConfigGudangId={setMapConfigGudangId} pendingMapLokasi={pendingMapLokasi} setPendingMapLokasi={setPendingMapLokasi} manualAddMode={manualAddMode} setManualAddMode={setManualAddMode} ocrSuggestGudangId={ocrSuggestGudangId} setOcrSuggestGudangId={setOcrSuggestGudangId} ocrSuggestSubGudangId={ocrSuggestSubGudangId} setOcrSuggestSubGudangId={setOcrSuggestSubGudangId} ocrSuggestions={ocrSuggestions} setOcrSuggestions={setOcrSuggestions} assignLokasiKoordinat={assignLokasiKoordinat} suggestKodeFromOcr={suggestKodeFromOcr} expandedSubGudangToolsIds={expandedSubGudangToolsIds} setExpandedSubGudangToolsIds={setExpandedSubGudangToolsIds} uploadDenahSubGudang={uploadDenahSubGudang} denahSubLoading={denahSubLoading} mapConfigSubGudangId={mapConfigSubGudangId} setMapConfigSubGudangId={setMapConfigSubGudangId} pendingMapLokasiSub={pendingMapLokasiSub} setPendingMapLokasiSub={setPendingMapLokasiSub} manualAddModeSub={manualAddModeSub} setManualAddModeSub={setManualAddModeSub} assignLokasiKoordinatSub={assignLokasiKoordinatSub} openEditLokasi={openEditLokasi} requestDeleteLokasi={requestDeleteLokasi} selectedSubGudangId={selectedSubGudangId} setSelectedSubGudangId={setSelectedSubGudangId} openEditAkun={openEditAkun} txns={txns} migratedTug15History={migratedTug15History} setMigratedTug15History={setMigratedTug15History} migrasiPendingReview={migrasiPendingReview} setMigrasiPendingReview={setMigrasiPendingReview} maraReference={maraReference} setMaraReference={setMaraReference} setStocks={setStocks} setKatalogList={setKatalogList} setTxns={setTxns} reloadRolePerms={reloadRolePerms} />}
        {tab==="transaction" && (
          <TransactionHubTab
            C={C} sty={sty} currentUser={currentUser} isMobile={isMobile}
            TUG_UI={tugUiForUser} TUG_GROUP_UI={tugGroupUiForUser}
            tugGroup={tugGroup} tugSubTab={tugSubTab} setTugSubTab={setTugSubTab}
            activeTugSummary={activeTugSummary} rolePerms={rolePerms}
            filterStatus={filterStatus} setFilterStatus={setFilterStatus}
            tugUptFilter={tugUptFilter} setTugUptFilter={setTugUptFilter} tugUptFilterOptions={multiUptFilterOptions}
            openNewTxn={openNewTxn}
            txns={scopedTxns} filteredTxns={filteredTxns} users={users} enrichedStocks={scopedEnrichedStocks} stocks={stocks}
            katalogList={katalogList} lokasiList={lokasiList} gudangList={gudangList} timMutuList={timMutuList} uitList={uitList} uptList={uptList} ultgList={ultgList}
            tug15Filter={tug15Filter} setTug15Filter={setTug15Filter}
            setDocPreview={setDocPreview} handleImg={handleImg}
            approveTUG3_TL={approveTUG3_TL} rejectTUG3_TL={rejectTUG3_TL}
            submitTUG4Form={submitTUG4Form} approveTUG4_Manager={approveTUG4_Manager} rejectTUG4_Manager={rejectTUG4_Manager}
            submitTUG3FinalLampiran={submitTUG3FinalLampiran} approveTUG3Final_Asman={approveTUG3Final_Asman} rejectTUG3Final_Asman={rejectTUG3Final_Asman}
            approveTUG5_Asman={approveTUG5_Asman} rejectTUG5_Asman={rejectTUG5_Asman} approveTUG5_Manager={approveTUG5_Manager} rejectTUG5_Manager={rejectTUG5_Manager}
            submitTUG7_AdminUIT={submitTUG7_AdminUIT} approveTUG7_MgrLogistik={approveTUG7_MgrLogistik} rejectTUG7_MgrLogistik={rejectTUG7_MgrLogistik}
            konfirmasiDraftTUG8={konfirmasiDraftTUG8} approveTUG5_MgrULTG={approveTUG5_MgrULTG} rejectTUG5_MgrULTG={rejectTUG5_MgrULTG}
            adoptTUG5ULTG={adoptTUG5ULTG} openDraftTug9={openDraftTug9}
          />
        )}

        {tab==="heavyEquipment" && (
          <HeavyEquipmentTabV2
            equipmentList={heavyEquipmentList}
            loans={heavyEquipmentLoans}
            currentUser={currentUser}
            uptList={uptList}
            users={users}
            sty={sty}
            C={C}
            handleImg={handleImg}
            saveEdit={saveHeavyEquipmentEdit}
            createEquipment={createHeavyEquipment}
            createLoan={createHeavyEquipmentLoan}
            approveLoan={approveHeavyEquipmentLoan}
            rejectLoan={rejectHeavyEquipmentLoan}
            completeLoan={completeHeavyEquipmentLoan}
            showToast={showToast}
          />
        )}

        {tab==="attb" && (
          <AttbTab
            attbList={scopedAttbList}
            currentUser={currentUser}
            uptList={uptList}
            users={users}
            sty={sty}
            C={C}
            createItem={createAttbItem}
            saveEdit={saveAttbEdit}
            submitToKI={submitAttbToKI}
            approveToKI={approveAttbToKI}
            rejectToKI={rejectAttbToKI}
            advanceStage={advanceAttbStage}
            markBelumLanjut={markAttbBelumLanjut}
            bulkImport={bulkImportAttbItems}
            showToast={showToast}
            gudangList={gudangList}
            subGudangList={subGudangList}
            lokasiList={lokasiList}
            setPetaMiniDetail={setPetaMiniDetail}
            deleteItem={deleteAttbItem}
            askConfirmDelete={askConfirmDelete}
            bongkaranPool={attbBongkaranPool}
            handleImg={handleImg}
          />
        )}

          {tab === "maturity" && (
            <MaturityDashboardTab
              C={C}
              sty={sty}
              currentUser={currentUser}
              isMobile={isMobile}
              hasRole={hasRole}
              maturityAudits={maturityAudits}
              maturityAuditHistory={maturityAuditHistory}
              maturity5SAssessments={maturity5SAssessments}
              selectedMaturityUpt={selectedMaturityUpt}
              selectedMaturityUptId={selectedMaturityUptId}
              setSelectedMaturityUpt={setSelectedMaturityUpt}
              canSwitchMaturityUpt={canSwitchMaturityUpt}
              maturitySubTab={maturitySubTab}
              setMaturitySubTab={setMaturitySubTab}
              maturityAuditModal={maturityAuditModal}
              setMaturityAuditModal={setMaturityAuditModal}
              auditListPage={auditListPage}
              setAuditListPage={setAuditListPage}
              maturityAuditForm={maturityAuditForm}
              setMaturityAuditForm={setMaturityAuditForm}
              maturityAuditEvidence={maturityAuditEvidence}
              setMaturityAuditEvidence={setMaturityAuditEvidence}
              saveMaturity5SAssessment={saveMaturity5SAssessment}
              expandedAspek={expandedAspek}
              setExpandedAspek={setExpandedAspek}
              activeAspectId={activeAspectId}
              setActiveAspectId={setActiveAspectId}
              aspectPage={aspectPage}
              setAspectPage={setAspectPage}
              maturityAuditSaving={maturityAuditSaving}
              saveMaturityAudit={saveMaturityAudit}
              deleteMaturityAudit={deleteMaturityAudit}
              createMaturityAudit={createMaturityAudit}
              openMaturityAudit={openMaturityAudit}
              exportMaturityAuditExcel={exportMaturityAuditExcel}
              calculateItemLevel={calculateItemLevel}
              calcMaturityScore={calcMaturityScore}
              gudangList={visibleGudangList}
              askConfirmDelete={askConfirmDelete}
              MATURITY_LEVELS={MATURITY_LEVELS}
              MATURITY_WORKFLOW_LABEL={MATURITY_WORKFLOW_LABEL}
              MATURITY_WORKFLOW_COLOR={MATURITY_WORKFLOW_COLOR}
            />
          )}

        {/* APPROVAL — semua notifikasi approval (TUG, Lokasi/Blok, Pemindahan Stok, dkk) dikumpulkan di sini, dipisah per-bagian + riwayat di bawah */}
        {tab==="approval" && hasRole(currentUser, "TL","ASMAN","MANAGER","ADMIN_UIT","MGR_LOGISTIK_UIT","ADMIN","MGR_ULTG","ADMIN_ULTG") && (
          <ApprovalHubTab
            currentUser={currentUser} sty={sty} C={C} isMobile={isMobile}
            myPendingApprovals={myPendingApprovals} gudangCapacityImports={gudangCapacityImports} lokasiList={lokasiList} stocks={stocks}
            heavyEquipmentPendingCount={heavyEquipmentPendingCount} opnameList={opnameList} stockCountPendingCount={stockCountPendingCount}
            approvalTypeFilter={approvalTypeFilter} setApprovalTypeFilter={setApprovalTypeFilter} approvalPageSize={approvalPageSize} setApprovalPageSize={setApprovalPageSize}
            enrichedStocks={enrichedStocks} katalogList={katalogList} users={users}
            approveTxn={approveTxn} rejectTxn={rejectTxn} prepareReview={prepareCanonicalTugReview} uptList={uptList}
            submitTUG7_AdminUIT={submitTUG7_AdminUIT} approveTUG7_MgrLogistik={approveTUG7_MgrLogistik} rejectTUG7_MgrLogistik={rejectTUG7_MgrLogistik} konfirmasiDraftTUG8={konfirmasiDraftTUG8}
            startCapacityApproval={startCapacityApproval} rejectCapacityImport={rejectCapacityImport}
            approveLokasiChange={approveLokasiChange} rejectLokasiChange={rejectLokasiChange}
            ultgList={ultgList} approveTUG5_MgrULTG={approveTUG5_MgrULTG} rejectTUG5_MgrULTG={rejectTUG5_MgrULTG} ultgPengajuanUntukAdopt={ultgPengajuanUntukAdopt} adoptTUG5ULTG={adoptTUG5ULTG} openDraftTug9={openDraftTug9}
            approvalStokPage={approvalStokPage} setApprovalStokPage={setApprovalStokPage} approveStockMove={approveStockMove} rejectStockMove={rejectStockMove} renderApprovalPager={renderApprovalPager}
            approvalStokGudangPage={approvalStokGudangPage} setApprovalStokGudangPage={setApprovalStokGudangPage}
            approvalEditStokPage={approvalEditStokPage} setApprovalEditStokPage={setApprovalEditStokPage} approveStockEdit={approveStockEdit} rejectStockEdit={rejectStockEdit}
            approvalHapusStokPage={approvalHapusStokPage} setApprovalHapusStokPage={setApprovalHapusStokPage} approveStockDelete={approveStockDelete} rejectStockDelete={rejectStockDelete}
            heavyEquipmentLoans={heavyEquipmentLoans} approvalAlatBeratPage={approvalAlatBeratPage} setApprovalAlatBeratPage={setApprovalAlatBeratPage} heavyEquipmentList={heavyEquipmentList}
            approveHeavyEquipmentLoan={approveHeavyEquipmentLoan} rejectHeavyEquipmentLoan={rejectHeavyEquipmentLoan}
            approvalOpnamePage={approvalOpnamePage} setApprovalOpnamePage={setApprovalOpnamePage} approveOpname_Asman={approveOpname_Asman} approveOpname_Manager={approveOpname_Manager} rejectOpname={rejectOpname}
            stockCountList={stockCountList} approvalStockCountPage={approvalStockCountPage} setApprovalStockCountPage={setApprovalStockCountPage} approveStockCountItem={approveStockCountItem} rejectStockCountItem={rejectStockCountItem}
            txns={txns} approvalHistoryList={approvalHistoryList} approvalHistoryPage={approvalHistoryPage} setApprovalHistoryPage={setApprovalHistoryPage}
          />
        )}

        {tab==="inspeksiMaterial" && (
          <InspeksiMaterialCadangTab
            stocks={stocks}
            katalogList={katalogList}
            lokasiList={lokasiList}
            gudangList={visibleGudangList}
            materialInspections={materialInspections}
            materialInspectionBatches={materialInspectionBatches}
            onInspectionCreated={inspection => setMaterialInspections(previous => [inspection, ...previous])}
            onInspectionBatchCreated={batch => setMaterialInspectionBatches(previous => [batch, ...previous])}
            currentUser={currentUser}
            currentUserUptId={currentUserUptId}
            uptList={uptList}
            users={users}
            rolePerms={rolePerms}
            C={C}
            sty={sty}
            showToast={showToast}
            isMobile={isMobile}
          />
        )}

        {/* AI AGENT — chat AI murni, terpisah dari Forecast Stok */}
        {tab==="ai" && (
          <AIAgentPage
            enrichedStocks={scopedEnrichedStocks}
            katalogList={katalogList}
            stocks={scopedStocks}
            txns={scopedTxns}
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
            uptList={uptList}
            C={C} sty={sty} uptNama={currentUptNama}
          />
        )}

        {/* FORECAST STOK — halaman sendiri, gabungkan heuristik lokal + AI Groq + ML Prophet berdampingan */}
        {tab==="forecastStok" && (
          <ForecastStokPage
            katalogList={katalogList}
            setKatalogList={setKatalogList}
            stocks={scopedStocks}
            allStocks={stocks}
            setStocks={setStocks}
            gudangList={gudangList}
            lokasiList={lokasiList}
            txns={scopedTxns}
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
            materialCadangHealthData={materialCadangHealthData}
            setMaterialCadangHealthData={setMaterialCadangHealthData}
            materialCadangAiInsights={materialCadangAiInsights}
            setMaterialCadangAiInsights={setMaterialCadangAiInsights}
            maraReference={maraReference}
            setMaraReference={setMaraReference}
            catalogMasterRef={catalogMasterRef}
            setCatalogMasterRef={setCatalogMasterRef}
            saveToCloud={saveToCloud}
            showToast={showToast}
            currentUser={currentUser}
            uptList={uptList}
            uptScopeOptions={stockUptFilterOptions}
            users={users}
            C={C} sty={sty}
          />
        )}

        </div>
      </main>

      {/* STOCK MODAL (Data Stok = junction of Katalog x Lokasi) */}

      {/* MASTER KATALOG MODAL */}
      {katalogModal && <KatalogModal katalogModal={katalogModal} setKatalogModal={setKatalogModal} katalogForm={katalogForm} setKatalogForm={setKatalogForm} maraSearch={maraSearch} setMaraSearch={setMaraSearch} setMaraSearchResults={setMaraSearchResults} maraSearchLoading={maraSearchLoading} maraSearchError={maraSearchError} maraSearchResults={maraSearchResults} searchMaraCatalog={searchMaraCatalog} applyMaraToKatalog={applyMaraToKatalog} openScanner={openScanner} saveKatalog={saveKatalog} isMobile={isMobile} CATEGORIES={CATEGORIES} sty={sty} C={C} />}

      {/* USULAN BLOK DARI DENAH — popup terpusat, supaya tidak perlu scroll naik-turun ke peta */}
      {hasRole(currentUser, "ADMIN") && ocrSuggestGudangId && ocrSuggestions.length>0 && (
        <OcrSuggestGudangModal ocrSuggestGudangId={ocrSuggestGudangId} ocrSuggestSubGudangId={ocrSuggestSubGudangId} ocrSuggestions={ocrSuggestions} updateOcrSuggestion={updateOcrSuggestion} removeOcrSuggestion={removeOcrSuggestion} dismissOcrSuggestions={dismissOcrSuggestions} confirmOcrSuggestions={confirmOcrSuggestions} isMobile={isMobile} sty={sty} C={C} />
      )}

      {/* MASTER LOKASI MODAL */}
      {lokasiModal && <LokasiModal lokasiModal={lokasiModal} setLokasiModal={setLokasiModal} lokasiForm={lokasiForm} setLokasiForm={setLokasiForm} gudangList={gudangList} visibleGudangList={visibleGudangList} subGudangList={subGudangList} saveLokasi={saveLokasi} sty={sty} C={C} />}

      {/* KONFIRMASI HAPUS BLOK GUDANG */}
      {lokasiDeleteConfirm && (
        <LokasiDeleteConfirmModal lokasiDeleteConfirm={lokasiDeleteConfirm} setLokasiDeleteConfirm={setLokasiDeleteConfirm} gudangList={gudangList} stocks={stocks} confirmDeleteLokasi={confirmDeleteLokasi} sty={sty} C={C} />
      )}

      {/* KONFIRMASI HAPUS — GENERIK, dipakai semua Master Data lain (Katalog, Satpam, UIT, ULTG, UPT, Gudang) */}
      {confirmDialog && (
        <ConfirmDialogModal confirmDialog={confirmDialog} setConfirmDialog={setConfirmDialog} sty={sty} C={C} />
      )}

      {/* SATPAM MODAL */}
      {satpamModal && <SatpamModal satpamModal={satpamModal} setSatpamModal={setSatpamModal} satpamForm={satpamForm} setSatpamForm={setSatpamForm} visibleGudangList={visibleGudangList} uptList={uptList} handleSatpamFoto={handleSatpamFoto} saveSatpam={saveSatpam} sty={sty} C={C} />}

      {/* TIM MUTU MODAL — edit anggota paket tetap (tidak bisa tambah/hapus paket) */}
      {timMutuModal && <TimMutuModal timMutuModal={timMutuModal} setTimMutuModal={setTimMutuModal} timMutuForm={timMutuForm} setTimMutuForm={setTimMutuForm} saveTimMutu={saveTimMutu} sty={sty} C={C} />}

      {/* KARTU GANTUNG DIGITAL DETAIL MODAL */}
      {/* CARI DENGAN FOTO — modal upload foto query untuk visual search Data Stok */}
      {photoSearchOpen && (
        <PhotoSearchModal photoSearchOpen={photoSearchOpen} photoSearchLoading={photoSearchLoading} setPhotoSearchOpen={setPhotoSearchOpen} photoSearchMode={photoSearchMode} setPhotoSearchMode={setPhotoSearchMode} photoSearchImg={photoSearchImg} setPhotoSearchImg={setPhotoSearchImg} handleImg={handleImg} runPhotoSearch={runPhotoSearch} sty={sty} C={C} />
      )}

      {/* DETAIL DATA STOK — klik baris di tabel Data Stok. Mode edit dirender INLINE di modal
          yang sama (stockModal==="edit") — SATU pop-up, bukan dua berlapis (revisi 3). */}
      {stockDetailId && (() => {
        const rawSt = stocks.find(s=>s.id===stockDetailId);
        if (!rawSt) return null;
        // Pakai versi enriched (name/katalog/kategori/satuan/jenis resolve dari katalogId) supaya
        // detail konsisten dgn daftar. Sebelumnya pakai stock mentah → field denormalized yang
        // basi (mis. habis ganti barang) menampilkan nama/no katalog LAMA walau katalogId sudah benar.
        const st = enrichStock(rawSt, katalogList, lokasiList);
        if (!st) return null;
        const kat = katalogList.find(k=>k.id===st.katalogId);
        const lok = lokasiList.find(l=>l.id===st.lokasiId);
        const gdg = (lok?.gudangId || st.gudangId) ? gudangList.find(g=>g.id===(lok?.gudangId || st.gudangId)) : null;
        const keteranganBarang = kat?.keterangan || st.keteranganBarang || "Keterangan barang belum diisi.";
        const canUploadFoto = hasRole(currentUser, "ADMIN","TL");
        const isSAP = st.id?.startsWith("STK-SAP-");
        const sapLabel = stockSapLabel(st);
        const bs = sapBadgeStyleForLabel(sapLabel);
        const isEditing = stockModal === "edit";
        const closeModal = () => { setStockDetailId(null); setPendingFoto({}); };
        const backOrClose = () => {
          if (isEditing) {
            if (stockFormDirty) { setConfirmDiscard(true); return; }
            setStockModal(null);
          } else closeModal();
        };
        const discardEdit = () => { setConfirmDiscard(false); setStockModal(null); };
        const printKartuGantung = async () => {
          if (!kat) return;
          if (isMobile) {
            const html = await buildTUG2FrontHTML(kat, stocks, lokasiList, subGudangList, gudangList, currentUptNama);
            const w = window.open("", "_blank");
            if (w) { w.document.write(html); w.document.close(); }
            else showToast("Popup diblokir browser. Izinkan popup untuk mencetak.", "error");
          } else {
            closeModal();
            setKartuGantungDetail(kat);
          }
        };
        const fotoBox = (label, field) => {
          const previewImg = resolveStockPhotoUrl(pendingFoto[field] ?? st[field]);
          const hasUnsaved = pendingFoto[field] != null;
          return (
            <div style={{flex:1,minWidth:160}}>
              <div style={{fontSize:12,fontWeight:700,marginBottom:6}}>{label} {!isSAP && "*"}</div>
              {previewImg ? (
                <img src={previewImg} alt={label} onClick={()=>setLightboxImg(previewImg)} style={{width:"100%",height:140,objectFit:"cover",borderRadius:8,border:`1px solid ${hasUnsaved?"#f59e0b":C.border}`,cursor:"zoom-in"}}/>
              ) : (
                <div style={{width:"100%",height:140,background:"#f3f4f6",borderRadius:8,border:`1px dashed ${C.border}`,display:"flex",alignItems:"center",justifyContent:"center",color:C.muted,fontSize:12,textAlign:"center",padding:8}}>
                  {isSAP ? "Belum ada foto (data SAP — akan disinkronkan saat import PEMAT)" : "Belum ada foto"}
                </div>
              )}
              {canUploadFoto && (
                <>
                  <label style={{...sty.btn("ghost","sm"),display:"block",textAlign:"center",marginTop:6,cursor:"pointer"}}>
                    Update Gambar
                    <input type="file" accept="image/*" capture="environment" style={{display:"none"}}
                      onChange={e=>handleImg(e, img=>setPendingFoto(p=>({...p,[field]:img})))}/>
                  </label>
                  {hasUnsaved && (
                    <div style={{display:"flex",gap:6,marginTop:6}}>
                      <button style={{...sty.btn("primary","sm"),flex:1}} onClick={async()=>{
                        // Foto pending cuma dibuang kalau upload+simpan benar-benar sukses.
                        if (await updateStockFoto(st.id, field, pendingFoto[field]))
                          setPendingFoto(p=>{const n={...p}; delete n[field]; return n;});
                      }}>💾 Simpan Foto</button>
                      <button style={{...sty.btn("ghost","sm")}} onClick={()=>setPendingFoto(p=>{const n={...p}; delete n[field]; return n;})}>Batal</button>
                    </div>
                  )}
                  {hasUnsaved && <div style={{fontSize:12,color:"#92400e",marginTop:4}}>⚠️ Belum disimpan — klik "Simpan Foto" untuk memastikan tersimpan di sistem.</div>}
                </>
              )}
            </div>
          );
        };
        return (
          <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.6)",display:"flex",alignItems:isMobile?"flex-end":"center",justifyContent:"center",zIndex:1500,padding:isMobile?0:20}} onClick={()=>{ if(!isEditing) closeModal(); }}>
            <div ref={stockDetailModalRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label={`Detail ${st.name}`}
              style={{...sty.card,width:isMobile?"100%":600,maxWidth:"100%",maxHeight:isMobile?"92dvh":"90dvh",overflowY:"auto",borderRadius:isMobile?"16px 16px 0 0":14,paddingBottom:isMobile?"calc(20px + env(safe-area-inset-bottom))":20}}
              onClick={e=>e.stopPropagation()}>
              <div style={{position:"sticky",top:-20,zIndex:2,background:C.surface}}>
                <div style={sty.modalHeader}>
                  <div style={{minWidth:0}}>
                    <div style={{fontWeight:800,fontSize:15,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{isEditing?"Edit — ":""}{st.name}</div>
                    <div style={{fontSize:12,color:"rgba(255,255,255,0.75)",fontWeight:700,marginTop:2}}>{st.katalog||kat?.katalog||"-"}</div>
                  </div>
                  <button aria-label="Tutup" onClick={backOrClose} style={{background:"transparent",border:"none",color:"white",cursor:"pointer",padding:8,minWidth:44,minHeight:44,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                    <X size={20} weight="bold" aria-hidden="true"/>
                  </button>
                </div>
                {!isEditing && (
                  <div className="operations-segments" role="group" aria-label="Tab detail barang" style={{marginBottom:14}}>
                    <button type="button" aria-pressed={stockDetailTab==="detail"} className={stockDetailTab==="detail"?"is-active":""} onClick={()=>setStockDetailTab("detail")}>Detail</button>
                    <button type="button" aria-pressed={stockDetailTab==="riwayat"} className={stockDetailTab==="riwayat"?"is-active":""} onClick={()=>setStockDetailTab("riwayat")}>Riwayat</button>
                  </div>
                )}
              </div>

              {isEditing ? (
                <StockEditFields stockModal={stockModal} stockForm={stockForm} setStockForm={setStockForm} katalogList={katalogList} lokasiList={lokasiList} setLightboxImg={setLightboxImg} handleImg={handleImg} isMobile={isMobile} sty={sty} C={C}/>
              ) : stockDetailTab === "riwayat" ? (
                (() => {
                  const history = kat ? buildKartuGantungHistory(kat, txns, stocks, lokasiList, subGudangList, gudangList) : [];
                  const newestFirst = [...history].reverse(); // buildKartuGantungHistory urut lama→baru; balik sekali di sini.
                  const mutasi = newestFirst.filter(h=>h.masuk>0||h.keluar>0); // baris baseline "Migrasi Data" bukan mutasi
                  if (mutasi.length === 0) {
                    return <div style={{fontSize:12,color:C.muted,padding:"24px 0",textAlign:"center"}}>Belum ada mutasi tercatat untuk material ini.</div>;
                  }
                  const totalMasuk = mutasi.reduce((a,h)=>a+h.masuk,0);
                  const totalKeluar = mutasi.reduce((a,h)=>a+h.keluar,0);
                  const shown = riwayatExpanded ? mutasi : mutasi.slice(0,20);
                  const docLabel = { TUG9:"TUG-9", TUG8:"TUG-8", TUG10:"TUG-10", TUG3:"TUG-3" };
                  const ringkas = [["Total masuk",`+${fmtNum(totalMasuk)}`,C.green],["Total keluar",`-${fmtNum(totalKeluar)}`,C.red],["Stok sekarang",fmtNum(st.qty),C.text]];
                  return (
                    <div style={{display:"flex",flexDirection:"column",gap:10,marginBottom:8}}>
                      <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8}}>
                        {ringkas.map(([label,val,warna])=>(
                          <div key={label} style={{border:`1px solid ${C.border}`,borderRadius:10,padding:"8px 10px",textAlign:"center"}}>
                            <div style={{fontSize:12,color:C.muted,fontWeight:600}}>{label}</div>
                            <div style={{fontSize:14,fontWeight:800,color:warna}}>{val} <span style={{fontSize:12,fontWeight:600,color:C.muted}}>{st.unit}</span></div>
                          </div>
                        ))}
                      </div>
                      {shown.map((h,idx)=>{
                        const masuk = h.masuk>0;
                        const warna = masuk ? C.green : C.red;
                        const lokasiTeks = [h.subGudang,h.rak].filter(v=>v&&v!=="-").join(" / ");
                        return (
                          <div key={idx} style={{display:"flex",gap:10,border:`1px solid ${C.border}`,borderLeft:`3px solid ${warna}`,borderRadius:10,padding:"10px 12px",fontSize:12}}>
                            <div style={{flex:1,minWidth:0}}>
                              <div style={{fontWeight:800,color:warna}}>{masuk?"Barang Masuk":"Barang Keluar"} {docLabel[h.docType] ? <span style={{fontWeight:700,color:C.muted}}>· {docLabel[h.docType]} {h.noBon||"-"}</span> : null}</div>
                              <div style={{color:C.muted,marginTop:2}}>{h.tgl ? fmtDateOnly(h.tgl) : "-"}{lokasiTeks ? ` · ${lokasiTeks}` : ""}</div>
                              {h.catatan && h.catatan!=="-" && <div style={{color:C.muted,marginTop:2,overflowWrap:"anywhere"}}>{h.catatan}</div>}
                            </div>
                            <div style={{textAlign:"right",whiteSpace:"nowrap"}}>
                              <div style={{fontWeight:800,color:warna}}>{masuk?`+${fmtNum(h.masuk)}`:`-${fmtNum(h.keluar)}`} {st.unit}</div>
                              <div style={{color:C.muted,marginTop:2}}>sisa {fmtNum(h.sisa)}</div>
                            </div>
                          </div>
                        );
                      })}
                      {!riwayatExpanded && mutasi.length > 20 && (
                        <button style={{...sty.btn("ghost","sm"),width:"100%"}} onClick={()=>setRiwayatExpanded(true)}>Tampilkan semua ({mutasi.length})</button>
                      )}
                    </div>
                  );
                })()
              ) : (
                <>
                  <div style={{fontSize:12,fontWeight:800,color:C.muted,textTransform:"uppercase",letterSpacing:".5px",marginBottom:6}}>Identitas</div>
                  <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"repeat(auto-fit,minmax(160px,1fr))",gap:10,marginBottom:14,fontSize:12}}>
                    <div><b>Kategori:</b> {st.category||"-"}</div>
                    <div><b>Jenis:</b> <span style={sty.jenisBadge(st.jenisBarang)}>{st.jenisBarang}</span></div>
                    <div><b>Status:</b> <span style={{padding:"2px 7px",borderRadius:20,fontSize:12,fontWeight:700,background:bs.bg,color:bs.fg}}>{sapLabel}</span></div>
                    <div><b>Harga:</b> Rp {fmtNum(st.price)}</div>
                    <div className="stock-detail-keterangan" style={{gridColumn:"1/-1"}}><b>Keterangan Barang:</b> <span>{keteranganBarang}</span></div>
                  </div>
                  <div style={{fontSize:12,fontWeight:800,color:C.muted,textTransform:"uppercase",letterSpacing:".5px",marginBottom:6}}>Lokasi & Stok</div>
                  <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"repeat(auto-fit,minmax(160px,1fr))",gap:10,marginBottom:16,fontSize:12}}>
                    <div><b>Qty:</b> {fmtNum(st.qty)} {st.unit}</div>
                    <div><b>Min Qty:</b> {fmtNum(st.minQty)} {st.unit}</div>
                    <div><b>Gudang:</b> {gdg?.kode||gdg?.nama||"—"}</div>
                    <div><b>Sub Gudang:</b> {(()=>{ const sg=subGudangList.find(s=>s.id===lok?.subGudangId); return sg?.nama || sg?.kode || "—"; })()}</div>
                    <div><b>Blok:</b> {lok?.kode||"—"}</div>
                    <div><b>Lokasi UPT:</b> {uptList.find(u=>u.id===(gdg?.uptId||st.uptId))?.nama || "—"}</div>
                  </div>
                  <div style={{display:"flex",gap:12,flexWrap:"wrap"}}>
                    {fotoBox("Foto Nameplate", "fotoNameplate")}
                    {fotoBox("Foto Keseluruhan", "fotoKeseluruhan")}
                  </div>
                  {!canUploadFoto && <div style={{fontSize:12,color:C.muted,marginTop:10}}>Hanya Admin/TL yang bisa mengunggah/mengganti foto.</div>}
                </>
              )}

              {isEditing && confirmDiscard ? (
                <div className="approval-actions" style={{...sty.stickyFooter,paddingBottom:14}}>
                  <div style={{flexBasis:"100%",fontSize:12,fontWeight:700,color:C.red,marginBottom:2}}>Perubahan belum disimpan.</div>
                  <button className="approval-btn--cancel" onClick={()=>setConfirmDiscard(false)}>Lanjut edit</button>
                  <button className="approval-btn--danger" onClick={discardEdit}>Buang perubahan</button>
                </div>
              ) : (isEditing || hasRole(currentUser, "ADMIN")) && (
                isEditing ? (
                  <div style={{...sty.stickyFooter,paddingBottom:14}}>
                    <button style={{...sty.btn("ghost"),flex:1}} onClick={backOrClose}>Batal</button>
                    <button style={{...sty.btn("primary"),flex:2}} onClick={saveStock}>💾 Simpan</button>
                  </div>
                ) : (
                  // Grid kolom sama lebar — label ketiga tombol beda panjang, kalau dibiarkan
                  // flex-nya .approval-actions bikin lebar tombol timpang. Di HP 3 kolom
                  // terlalu sempit (label "Kartu Gantung" pecah), jadi 2 kolom + Hapus
                  // melebar sendiri di baris bawah.
                  <div className="approval-actions" style={{...sty.stickyFooter,display:"grid",gridTemplateColumns:isMobile?"1fr 1fr":`repeat(${kat?3:2},1fr)`,gap:10,paddingBottom:14}}>
                    <button className="approval-btn--primary" disabled={st.deletePending} onClick={()=>{ setPendingFoto({}); openEditStock(st); }}>Edit</button>
                    {kat && <button className="approval-btn--cancel" title="Cetak Kartu Gantung (TUG-2)" onClick={printKartuGantung}>Kartu Gantung</button>}
                    <button className="approval-btn--danger" style={isMobile&&kat?{gridColumn:"1/-1"}:undefined} disabled={st.deletePending} onClick={()=>{ closeModal(); deleteStock(st.id); }}>Hapus</button>
                  </div>
                )
              )}
            </div>
          </div>
        );
      })()}

      {/* LIGHTBOX — overview foto full-screen, klik foto kecil mana saja di Data Stok */}
      {lightboxImg && (
        <LightboxModal lightboxImg={lightboxImg} setLightboxImg={setLightboxImg} />
      )}

      {/* PETA MINI MODAL — dari card Data Stok */}
      {petaMiniDetail && (
        <PetaMiniDetailModal petaMiniDetail={petaMiniDetail} setPetaMiniDetail={setPetaMiniDetail} lokasiList={lokasiList} sty={sty} C={C} />
      )}
      {kartuGantungDetail && (
        <KartuGantungModal
          katalog={kartuGantungDetail}
          stocks={stocks} txns={txns} lokasiList={lokasiList} gudangList={gudangList} subGudangList={subGudangList}
          sty={sty} C={C} uptNama={currentUptNama}
          onClose={()=>setKartuGantungDetail(null)}
        />
      )}
      {barcodePrintOpen && (
        <BarcodePrintModal
          katalogList={katalogList} stocks={stocks} lokasiList={lokasiList} gudangList={gudangList}
          C={C} sty={sty}
          onClose={()=>setBarcodePrintOpen(false)}
        />
      )}

      {/* UIT MODAL */}

      {/* GUDANG MODAL — mode "edit" satu langkah; mode "add" wizard 3 langkah (Data → Denah → Blok) */}
      {gudangModal==="edit" && <GudangEditModal gudangForm={gudangForm} setGudangForm={setGudangForm} uptList={uptList} setGudangModal={setGudangModal} saveGudang={saveGudang} sty={sty} C={C} />}

      {gudangModal==="add" && <GudangAddModal gudangWizardStep={gudangWizardStep} setGudangWizardStep={setGudangWizardStep} gudangForm={gudangForm} setGudangForm={setGudangForm} uptList={uptList} gudangList={gudangList} lokasiList={lokasiList} closeGudangWizard={closeGudangWizard} gudangWizardNext={gudangWizardNext} uploadDenahGudang={uploadDenahGudang} denahLoading={denahLoading} suggestKodeFromOcr={suggestKodeFromOcr} wizardBlokDraft={wizardBlokDraft} setWizardBlokDraft={setWizardBlokDraft} addWizardBlok={addWizardBlok} sty={sty} C={C} />}

      {/* KONFIRMASI GUDANG BARU DARI IMPORT KAPASITAS GUDANG — muncul saat "Setujui &
          Publish" di Approval mendeteksi baris yang bakal jadi Gudang baru (tidak cocok
          Gudang existing manapun di UPT yang sama). Permintaan user 2026-07-06: sebelum
          ini, Gudang baru langsung dibuat otomatis tanpa konfirmasi, jadi variasi kecil
          penulisan nama gudang di Excel bikin duplikat. */}
      {capacityReviewImportId && (
        <CapacityReviewModal capacityReviewCandidates={capacityReviewCandidates} capacityReviewDecisions={capacityReviewDecisions} setCapacityReviewDecisions={setCapacityReviewDecisions} gudangList={gudangList} setCapacityReviewImportId={setCapacityReviewImportId} setCapacityReviewCandidates={setCapacityReviewCandidates} confirmCapacityApproval={confirmCapacityApproval} sty={sty} C={C} />
      )}

      {/* MATURITY ASSESSMENT MODAL — input manual Admin untuk Dashboard */}
      {maturityModal && <MaturityAssessmentModal setMaturityModal={setMaturityModal} maturityForm={maturityForm} setMaturityForm={setMaturityForm} saveMaturityAssessment={saveMaturityAssessment} MATURITY_LEVELS={MATURITY_LEVELS} sty={sty} />}

      {uitModal && <UitModal uitModal={uitModal} setUitModal={setUitModal} uitForm={uitForm} setUitForm={setUitForm} saveUIT={saveUIT} sty={sty} />}

      {/* UPT MODAL */}
      {uptModal && <UptModal uptModal={uptModal} setUptModal={setUptModal} uptForm={uptForm} setUptForm={setUptForm} uitList={uitList} saveUPT={saveUPT} sty={sty} />}

      {/* ULTG MODAL */}
      {ultgModal && <UltgModal ultgModal={ultgModal} setUltgModal={setUltgModal} ultgForm={ultgForm} setUltgForm={setUltgForm} uptList={uptList} saveULTG={saveULTG} sty={sty} />}

      {/* KELOLA AKUN MODAL — daftarkan user baru (ADMIN only) */}
      {akunModal && <AkunModal akunModal={akunModal} setAkunModal={setAkunModal} akunForm={akunForm} setAkunForm={setAkunForm} akunResult={akunResult} setAkunResult={setAkunResult} akunBusy={akunBusy} uitList={uitList} uptList={uptList} ultgList={ultgList} users={users} visibleGudangList={visibleGudangList} submitAkunEdit={submitAkunEdit} submitAkunBaru={submitAkunBaru} UIT_ROLE_QUOTA={UIT_ROLE_QUOTA} UPT_ROLE_QUOTA={UPT_ROLE_QUOTA} sty={sty} C={C} />}

      {/* GANTI PASSWORD MODAL — self-service, semua role, akun sendiri */}
      {gantiPasswordModal && <GantiPasswordModal setGantiPasswordModal={setGantiPasswordModal} gantiPasswordForm={gantiPasswordForm} setGantiPasswordForm={setGantiPasswordForm} gantiPasswordBusy={gantiPasswordBusy} submitGantiPassword={submitGantiPassword} sty={sty} />}

      {/* TXN MODAL - TUG5 FORM */}
      {txnModal && txnForm && txnForm.docType==="TUG5" && <Tug5FormModal txnForm={txnForm} setTxnForm={setTxnForm} setTxnModal={setTxnModal} docSeq={docSeq} uitList={uitList} ultgList={ultgList} katalogList={katalogList} tug5MaterialPage={tug5MaterialPage} setTug5MaterialPage={setTug5MaterialPage} tug5ExpandedIdx={tug5ExpandedIdx} setTug5ExpandedIdx={setTug5ExpandedIdx} addItemRow={addItemRow} removeItemRow={removeItemRow} updateItemRow={updateItemRow} saveTxn={saveTxn} isMobile={isMobile} sty={sty} C={C} uptKode={tug5UptKode} />}

      {/* TXN MODAL - TUG9 / TUG8 FORM (outgoing material) */}
      {txnModal && txnForm && (txnForm.docType==="TUG9" || txnForm.docType==="TUG8") && <Tug98FormModal txnForm={txnForm} setTxnForm={setTxnForm} setTxnModal={setTxnModal} docSeq={docSeq} gudangList={gudangList} satpamList={satpamList} enrichedStocks={enrichedStocks} addItemRow={addItemRow} removeItemRow={removeItemRow} updateItemRow={updateItemRow} openScanner={openScanner} handleImg={handleImg} handleMaterialImg={handleMaterialImg} editingDraftTxnId={editingDraftTxnId} setEditingDraftTxnId={setEditingDraftTxnId} saveTxn={saveTxn} isMobile={isMobile} sty={sty} C={C} />}

      {/* TXN MODAL - TUG10 FORM (incoming material / return to warehouse) */}
      {txnModal && txnForm && txnForm.docType==="TUG10" && <Tug10FormModal txnForm={txnForm} setTxnForm={setTxnForm} setTxnModal={setTxnModal} setEditingDraftTxnId={setEditingDraftTxnId} docSeq={docSeq} currentUser={currentUser} rolePerms={rolePerms} tug10Highlight={tug10Highlight} tug10Refs={tug10Refs} tug10Missing={tug10Missing} tug10Collapsed={tug10Collapsed} setTug10Collapsed={setTug10Collapsed} lokasiList={lokasiList} subGudangList={subGudangList} satpamList={satpamList} gudangList={gudangList} visibleGudangList={visibleGudangList} uptList={uptList} katalogList={katalogList} CATEGORIES={CATEGORIES} STATUS_MATERIAL_RETUR={STATUS_MATERIAL_RETUR} addItemRow={addItemRow} removeItemRow={removeItemRow} updateItemRow={updateItemRow} handleImg={handleImg} savingTxn={savingTxn} saveTxn={saveTxn} isMobile={isMobile} sty={sty} C={C} />}

      {/* TXN MODAL - TUG3 FORM (Karantina — penerimaan barang tahap 1) */}
      {txnModal && txnForm && txnForm.docType==="TUG3" && <Tug3FormModal txnForm={txnForm} setTxnForm={setTxnForm} setTxnModal={setTxnModal} docSeq={docSeq} katalogList={katalogList} lokasiList={lokasiList} CATEGORIES={CATEGORIES} addItemRow={addItemRow} removeItemRow={removeItemRow} updateItemRow={updateItemRow} saveTxn={saveTxn} isMobile={isMobile} sty={sty} C={C} />}

      {/* DOCUMENT PREVIEW MODAL (TUG-9 / TUG-8 / TUG-10 / TUG-3 package) */}
      {docPreview && <DocPreviewModal docPreview={docPreview} setDocPreview={setDocPreview} docPreviewDoc={docPreviewDoc} docKeyOf={docKeyOf} katalogList={katalogList} lokasiList={lokasiList} users={users} satpamList={satpamList} gudangList={gudangList} subGudangList={subGudangList} timMutuList={timMutuList} uitList={uitList} uptList={uptList} ultgList={ultgList} enrichedStocks={enrichedStocks} showToast={showToast} sty={sty} C={C} />}

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

// ─── SUPABASE SYNC (TUG-15 → tug15_history) ──────────────────────────────
// Push approved mutasi rows ke Supabase supaya bisa dipakai job ML forecast.
// Pakai anon/publishable key (write diizinkan lewat RLS policy "Public insert"
// yang scope-nya cuma ke tabel katalog & tug15_history — lihat supabase/schema.sql).
// (SUPABASE_URL/SUPABASE_KEY/supabase client didefinisikan di dekat awal file.)

// ─── SUPABASE SYNC (Foto Material Keseluruhan → Supabase Storage) ───────
// Upload base64 dataURL ke bucket "material-photos" (lihat supabase/schema.sql
// untuk SQL pembuatan bucket + policy), lalu simpan URL publiknya di
// katalog.foto_keseluruhan_url supaya halaman scan QR (ScanPublicView) bisa
// menampilkan foto tanpa perlu login.

// ── Foto transaksi TUG → Supabase Storage (bukan base64 di blob) ─────────────
// SIM/KTP = data pribadi → bucket privat, disimpan sbg penanda "priv:<path>",
// ditampilkan lewat signed URL. Foto lain → bucket publik (URL langsung).

// ─── TUG-15 TAB COMPONENT ────────────────────────────────────────────────
// ─── RENCANA KEDATANGAN BARANG TAB ───────────────────────────────────────
// ─── DASHBOARD ANALITIK SECTION (3 Widget) ───────────────────────────────
// ─── SHARED DASHBOARD BUILDING BLOCKS ────────────────────────────────────

// ─── AI AGENT PAGE (Forecast + Chat terintegrasi) ────────────────────────
// Panel kurasi FAQ Bot (Admin only) — tampilkan pertanyaan nyata dari bot WA/Telegram
// yang dijawab buruk (kena feedback 👎 atau jawabannya kedengaran "menyerah"), Admin
// tulis jawaban resmi → tersimpan ke ai_faq_curated → ikut di-embed ke rag_chunks
// (lewat syncRagChunks) supaya pertanyaan serupa besok-besok langsung dijawab benar.

// ─── STOCK OPNAME TAB ────────────────────────────────────────────────────

// ════════════════════════════════════════════════════════════════════
// MATERIAL CADANG TAB
// ════════════════════════════════════════════════════════════════════

// Normalisasi nomor katalog (hapus leading zero)

// normalizeGudangName/suggestSimilarGudang dipindah ke src/hooks/useWarehouseConfig.jsx (2026-08-09).

// ════════════════════════════════════════════════════════════════════
// KAPASITAS GUDANG TAB
// ════════════════════════════════════════════════════════════════════
