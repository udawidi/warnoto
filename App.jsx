// PT. PLN UPT Surabaya - Gudang Ketintang
// Sistem Tata Usaha Gudang (TUG) Digital - v3.0
// TUG-9: Bon Pemakaian + Surat Jalan + BAST

import { useState, useEffect, useRef, useCallback, useMemo, Fragment } from "react";
import { COMPANY, UIT, UPT, WAREHOUSE, DOC_CODE, APP_VERSION, KAPASITAS_LABEL, ROMAN, JENIS_BARANG, STATUS_RETUR_TO_JENIS } from "./src/constants.js";
import { supabase, SUPABASE_URL, SUPABASE_KEY, usernameToAuthEmail } from "./src/supabaseClient.js";
import { CLOUD } from "./src/lib/cloud.js";
import { isDemoMode, enterDemoMode, exitDemoMode } from "./src/lib/demo.js";
import { logAudit } from "./src/lib/audit.js";
import { C as C_LIGHT, C_DARK, makeSty } from "./src/theme.js";
import { generateDocNumbers, uid, fmtDate, fmtDateOnly, fmtRp, buildStockStats, formatStockStatsText, parseSAPRowsFromCSV, parseUsulanPencocokanXLSX, parseSAPRowsFromXLSX, parseIndoNumber, mapSAPRow, parseSAPFile, terbilangHari, enrichStock, enrichStocks, dedupeById, migrateLegacyStocks } from "./src/lib/utils.js";
import { buildTUG9HTML, buildTUG10HTML, downloadTUG10HTML, buildTUG5HTML, buildTUG5ULTGHTML, buildTUG7HTML, downloadTUG5HTML, buildHeavyEquipmentLoanHTML, downloadHeavyEquipmentLoanHTML, buildBeritaAcaraHTML, downloadTUG7HTML, buildTUG3HTML, downloadTUG3HTML, downloadTUG9HTML } from "./src/lib/docBuilders.js";
import { normalizeSearchText, expandHaystackSynonyms, queryTokenGroups, expandQueryForIlikeSearch, matchesMaterialSearch, matchesStockSearch, matchesKatalogSearch, totalQtyForKatalog, lokasiUsedCapacity, statusMaterialBadgeStyle, getSAPStatus, getSAPBadgeStyle, jenisBarangAccentColor, buildKartuGantungHistory, normalizeKatalog, extractKatalogIdFromScan } from "./src/lib/sap.js";
import { ROLES, hasRole, getUserUptScope, canAccessGudang, allowedGudangIds } from "./src/lib/roles.js";
import { can } from "./src/lib/perms.js";
import { DEFAULT_HEAVY_EQUIPMENT, normalizeHeavyEquipmentJenis, heavyEquipmentStatusFromKondisi, normalizeHeavyEquipmentRecord, getHeavyEquipmentLoanOwnerUpt, getHeavyEquipmentLoanRequesterUpt, getHeavyEquipmentLoanStartDate, getHeavyEquipmentLoanReturnDate, getHeavyEquipmentLoanJobName, normalizeHeavyEquipmentLoanStatus, isPendingHeavyEquipmentLoan, getHeavyEquipmentLoanRuntimeStatus, canApproveHeavyEquipmentLoan, getEquipmentCategory } from "./src/lib/heavyEquipment.js";
import { ATTB_JENIS_ASET, ATTB_JENIS_ASET_LABEL, ATTB_STAGES, attbStageIndex, attbStageLabel, canApproveAttb, isPendingAttbApproval, ATTB_FIELDS_BY_JENIS, ATTB_ALASAN_PENGHAPUSBUKUAN, ATTB_WAKTU_USULAN_OPTIONS, ATTB_CORE_FIELDS, ATTB_STAGE2_FIELDS, ATTB_STAGE3_FIELDS, ATTB_STAGE4_FIELDS, ATTB_STAGE5_FIELDS, parseAttbCurrency, parseAttbMaterialFile2, parseAttbMaterialFile4 } from "./src/lib/attb.js";
import { npNorm, npTokens, npNums, NAMEPLATE_MIN, cohereEmbed, cohereEmbedImage, ocrSpaceOCR, matchNameplateToKatalog, nameplateTextSim, matchNameplateAll, buildTxnRagContent } from "./src/lib/rag.js";
import { computeForecast } from "./src/lib/forecast.js";
import { subGudangAbbr, subGudangKodeMap, getLokasiPetaInfo, extractLatLngFromAddress, loadMasterTable, syncMasterTable, syncMasterTableRows, syncMaterialCadangRows, loadWarehouseCapacity, syncWarehouseCapacity, loadWarehouseCapacityImports, syncWarehouseCapacityImports } from "./src/lib/masterSync.js";
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
import { TUG5Tab } from "./src/components/TUG5Tab.jsx";
import { TUG3Tab } from "./src/components/TUG3Tab.jsx";
import { StockOpnameTab } from "./src/components/StockOpnameTab.jsx";
import { MigrasiDataTab } from "./src/components/MigrasiDataTab.jsx";
import { KapasitasGudangImportTab } from "./src/components/KapasitasGudangImportTab.jsx";
import { BarcodePrintModal } from "./src/components/BarcodePrintModal.jsx";
import { KartuGantungModal } from "./src/components/KartuGantungModal.jsx";
import { TUG15Tab } from "./src/components/TUG15Tab.jsx";
import { MaterialCadangTab } from "./src/components/MaterialCadangTab.jsx";
import { InspeksiMaterialCadangTab } from "./src/components/InspeksiMaterialCadangTab.jsx";
import { ForecastStokPage } from "./src/components/ForecastStokPage.jsx";
import { MaturityAuditEditor, Form5STab } from "./src/components/MaturityAuditSystem.jsx";
import { AUDIT_ASPECTS, AUDIT_CATEGORIES } from "./src/data/auditAspects.js";
import { ApprovalTab } from "./src/components/ApprovalTab.jsx";
import { SidebarNavItem } from "./src/components/SidebarNavItem.jsx";
import { SidebarIcon } from "./src/components/SidebarIcon.jsx";
import { GudangCoordConfigPanel } from "./src/components/GudangCoordConfigPanel.jsx";
import { SearchableSelect } from "./src/components/SearchableSelect.jsx";
import { BarcodeScanner } from "./src/components/BarcodeScanner.jsx";
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
import { recognize as ocrRecognize } from "tesseract.js";
import { PLN_LOGO_DATA_URI } from "./src/assets/plnLogoBase64.js";
import { decode as olcDecode, isFull as olcIsFull, recoverNearest as olcRecoverNearest } from "./src/lib/openLocationCode.js";
import { fmtNum, getSAPLabel, buildKatalogRagContent, getKritisAgg } from "./src/lib/ragShared.mjs";
import { buildMutasiRows, syncTUG15ToSupabase, syncStockQtyToSupabase, syncFotoMaterialToSupabase, processTxnPhotos, resolveTxnPrivPhotos, compressImage, _isDataUrl } from "./src/lib/supabaseSync.js";
import { getMaterialAkanHabis } from "./src/lib/analytics.js";
import QRCode from "qrcode";

const STATUS_MATERIAL_RETUR = ["Material Sisa Baru", "Bongkaran", "Bongkaran ATTB (MTU)"]; // used in TUG-10 returns
// Maps a return status to the resulting Jenis Barang in Data Stok (null = leave as user's manual choice)
const CATEGORIES = ["Transformator", "Kabel", "Panel", "Meter", "Tools", "Safety", "Consumable", "Spare Part", "Struktur", "Isolator", "Lainnya"];

const ULTG_ROLES = ["ADMIN_ULTG","MGR_ULTG"]; // role dengan sidebar terbatas (view-only + TUG-5 saja)
// Kuota role per UPT untuk indikator di form Kelola Akun — validasi sebenarnya
// (hard limit) ditegakkan server-side di admin-create-user/admin-update-user.
const UPT_ROLE_QUOTA = { MANAGER: 1, ASMAN: 1, TL: 1, ADMIN: 1, PENGADAAN: 1 };
const UIT_ROLE_QUOTA = { ADMIN_UIT: 1, MGR_LOGISTIK_UIT: 1, PENGADAAN: 1 };

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
const PROFILE_CACHE_KEY = "warnoto_profile_cache_v1";
function readCachedProfile() {
  try {
    // Hanya pakai cache kalau memang ada sesi Supabase tersimpan di browser ini
    const hasAuthToken = Object.keys(localStorage).some(k => k.startsWith("sb-") && k.endsWith("-auth-token"));
    if (!hasAuthToken) return null;
    return JSON.parse(localStorage.getItem(PROFILE_CACHE_KEY) || "null");
  } catch { return null; }
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
  return (Array.isArray(list) ? list : []).map(s => ({ ...s, fotoKeseluruhan: undefined, fotoNameplate: undefined }));
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
  const [showGudangMaintenance, setShowGudangMaintenance] = useState(false); // toggle 2 alat perbaikan (bukan pemakaian rutin) di Master Gudang
  const [rencanaKedatanganList, setRencanaKedatanganList] = useState([]);
  const [opnameList, setOpnameList] = useState(() => readCachedList("pln_opname_v1") ?? []);
  const [stockCountList, setStockCountList] = useState(() => readCachedList("pln_stockcount_v1") ?? []); // riwayat sesi Stock Count (banding SAP vs Aplikasi)
  const [approvalHistoryList, setApprovalHistoryList] = useState([]); // log keputusan approval (Lokasi/Blok, Pemindahan Stok, dkk) — TUG tetap diturunkan dari txns
  const [maturityAssessments, setMaturityAssessments] = useState([]); // riwayat asesmen Maturity Level Gudang UPT Surabaya, diisi manual oleh Admin
  const [maturityAuditModal, setMaturityAuditModal] = useState(null);
  const [maturityAuditForm, setMaturityAuditForm] = useState({ aspekScores:{}, catatanUPT:"", catatanUIT:"", catatanPusat:"", fileUrl:"", fileNama:"" });
  const [maturityAuditEvidence, setMaturityAuditEvidence] = useState({});
  const [maturityAuditSaving, setMaturityAuditSaving] = useState(false);
  const [selectedMaturityUpt, setSelectedMaturityUpt] = useState("UPT Surabaya");
  const [maturitySubTab, setMaturitySubTab] = useState("pelaksanaan");
  const [materialInspections, setMaterialInspections] = useState(() => readCachedList("pln_material_inspections_v1") ?? []);
  const [heavyEquipmentList, setHeavyEquipmentList] = useState(() => readCachedList("pln_heavy_equipment_v1") ?? []);
  const [heavyEquipmentLoans, setHeavyEquipmentLoans] = useState(() => readCachedList("pln_heavy_equipment_loans_v1") ?? []);
  const [attbList, setAttbList] = useState(() => readCachedList("pln_attb_v1") ?? []);
  const [materialCadangData, setMaterialCadangData] = useState({ imports:[], analyses:[], applyHistory:[] });
  const [materialCadangHealthData, setMaterialCadangHealthData] = useState({ imports:[], analysisRuns:[], healthResults:[], applyAudit:[] });
  const [materialCadangAiInsights, setMaterialCadangAiInsights] = useState({ runs:[], materialInsights:[] });
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
  const [stockPage, setStockPage] = useState(1);
  const [stockPageSize, setStockPageSize] = useState(10);
  const [katalogPage, setKatalogPage] = useState(1);
  const [katalogPageSize, setKatalogPageSize] = useState(10);
  const [katalogSearch, setKatalogSearch] = useState("");
  const [katalogFilterBelumMara, setKatalogFilterBelumMara] = useState(false);
  const [filterStatus, setFilterStatus] = useState("ALL");

  // Filter jenis approval (TUG/Alat Berat/Stok/dst) + pagination tiap section —
  // sebelumnya semua jenis approval digabung jadi 1 list panjang tanpa pemisah,
  // susah dibaca kalau lagi banyak. 1 pageSize dropdown dipakai bareng semua
  // section, tapi tiap section punya cursor halaman sendiri-sendiri.
  const [approvalTypeFilter, setApprovalTypeFilter] = useState("ALL");
  const [approvalPageSize, setApprovalPageSize] = useState(10);
  const [approvalStokPage, setApprovalStokPage] = useState(1);
  const [approvalStokGudangPage, setApprovalStokGudangPage] = useState(1);
  const [approvalEditStokPage, setApprovalEditStokPage] = useState(1);
  const [approvalHapusStokPage, setApprovalHapusStokPage] = useState(1);
  const [approvalAlatBeratPage, setApprovalAlatBeratPage] = useState(1);
  const [approvalOpnamePage, setApprovalOpnamePage] = useState(1);
  const [approvalStockCountPage, setApprovalStockCountPage] = useState(1);
  const [approvalHistoryPage, setApprovalHistoryPage] = useState(1);
  useEffect(() => {
    setApprovalStokPage(1); setApprovalStokGudangPage(1); setApprovalEditStokPage(1);
    setApprovalHapusStokPage(1); setApprovalAlatBeratPage(1); setApprovalOpnamePage(1); setApprovalHistoryPage(1);
  }, [approvalTypeFilter, approvalPageSize]);
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
  const [lokasiDeleteConfirm, setLokasiDeleteConfirm] = useState(null); // blok gudang (lokasi) yang sedang dikonfirmasi hapus
  const [confirmDialog, setConfirmDialog] = useState(null); // popup konfirmasi hapus generik untuk Master Data lain (Katalog, Satpam, UIT, ULTG, UPT, Gudang): {title, message, warning, confirmLabel, onConfirm}
  function askConfirmDelete({ title, message, warning, confirmLabel, onConfirm }) {
    setConfirmDialog({ title: title||"Hapus Data?", message, warning, confirmLabel: confirmLabel||"🗑️ Ya, Hapus", onConfirm });
  }
  const [timMutuModal, setTimMutuModal] = useState(null);
  const [timMutuForm, setTimMutuForm] = useState({});
  const [uitModal, setUitModal] = useState(null);
  const [uitForm, setUitForm] = useState({});
  const [ultgModal, setUltgModal] = useState(null);
  const [ultgForm, setUltgForm] = useState({});
  const [uptModal, setUptModal] = useState(null);
  const [uptForm, setUptForm] = useState({});
  const [akunModal, setAkunModal] = useState(null); // null | "add"
  const [akunForm, setAkunForm] = useState({});
  const [akunBusy, setAkunBusy] = useState(false);
  const [akunResult, setAkunResult] = useState(null); // {username,password} setelah sukses daftar
  const [gantiPasswordModal, setGantiPasswordModal] = useState(false);
  const [gantiPasswordForm, setGantiPasswordForm] = useState({oldPassword:"", newPassword:"", confirmPassword:""});
  const [gantiPasswordBusy, setGantiPasswordBusy] = useState(false);
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
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const accountMenuRef = useRef(null);
  // Dark mode: persist manual di localStorage, default terang (tanpa auto-deteksi OS).
  // Palet C di-shadow di bawah (dekat makeSty) supaya semua C.xxx/sty.xxx ikut tema.
  const [theme, setTheme] = useState(() => { try { return localStorage.getItem("warnoto_theme") || "light"; } catch { return "light"; } });
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
        await syncStockQtyToSupabase(stocks, katalogList);
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
  const [ocrSuggestions, setOcrSuggestions] = useState([]); // usulan blok batch dari OCR denah: [{id,kode,xPct,yPct,checked}]
  const [ocrSuggestGudangId, setOcrSuggestGudangId] = useState(null); // gudang mana yang usulannya sedang tampil
  const [ocrSuggestSubGudangId, setOcrSuggestSubGudangId] = useState(null); // non-null = usulan berasal dari denah Sub Gudang, bukan denah Gudang keseluruhan
  const [mapConfigSubGudangId, setMapConfigSubGudangId] = useState(null);
  const [pendingMapLokasiSub, setPendingMapLokasiSub] = useState(null);
  const [manualAddModeSub, setManualAddModeSub] = useState(false);
  const [denahSubLoading, setDenahSubLoading] = useState(false);
  // Denah+Konfigurasi Koordinat level Gudang collapsed by default (dulu selalu terbuka penuh,
  // bikin halaman kepanjangan — keluhan user 2026-07-06). Boolean tunggal cukup karena cuma 1
  // Gudang yang expanded sekaligus (accordion via expandedGudangId).
  const [showGudangDenahTools, setShowGudangDenahTools] = useState(false);
  // Sama tapi per Sub Gudang (Set, karena beberapa Sub Gudang bisa tampil bersamaan dalam 1 Gudang).
  const [expandedSubGudangToolsIds, setExpandedSubGudangToolsIds] = useState(() => new Set());
  // Drill-down: klik Gudang cuma tampilkan menu Sub Gudang dulu, klik Sub Gudang baru tampil
  // Daftar Blok Lokasi-nya (permintaan user 2026-07-06). Boolean/id tunggal cukup karena cuma
  // 1 Gudang yang expanded sekaligus (accordion via expandedGudangId).
  const [selectedSubGudangId, setSelectedSubGudangId] = useState(null);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [docPreview, setDocPreview] = useState(null); // txn object when previewing TUG-9 document
  const [docPreviewDoc, setDocPreviewDoc] = useState(null); // versi docPreview dgn SIM/KTP privat sudah jadi signed URL
  const [kartuGantungDetail, setKartuGantungDetail] = useState(null);
  const [barcodePrintOpen, setBarcodePrintOpen] = useState(false); // modal cetak barcode massal (Admin, Master Katalog)
  const [petaMiniDetail, setPetaMiniDetail] = useState(null); // {stock, lokasi, gudang}
  const [stockDetailId, setStockDetailId] = useState(null); // id stok yang dibuka detailnya (klik baris Data Stok)
  // Cari barang dengan foto (visual search) di Data Stok
  const [photoSearchOpen, setPhotoSearchOpen] = useState(false);
  const [photoSearchImg, setPhotoSearchImg] = useState(null);
  const [photoSearchLoading, setPhotoSearchLoading] = useState(false);
  const [photoSearchResults, setPhotoSearchResults] = useState(null); // null = belum cari; [] = tidak ada hasil
  const [photoSearchMode, setPhotoSearchMode] = useState("bentuk"); // "bentuk" = Cohere visual | "nameplate" = OCR.space baca teks nameplate
  const [photoSearchResultMode, setPhotoSearchResultMode] = useState("bentuk"); // mode yang menghasilkan photoSearchResults (utk label hasil)
  const [photoSearchOcrText, setPhotoSearchOcrText] = useState(""); // teks nameplate terbaca (mode nameplate)
  const savingTxnRef = useRef(false); // cegah double-submit transaksi saat upload foto berjalan
  const [savingTxn, setSavingTxn] = useState(false); // mirror React untuk tombol Ajukan (disabled + "Menyimpan...")
  const [savingInfo, setSavingInfo] = useState(null); // {label, done, total} — overlay progres simpan transaksi
  const [tug10Collapsed, setTug10Collapsed] = useState({}); // {idx:true} kartu barang retur yang diringkas
  const [tug10Highlight, setTug10Highlight] = useState(null); // key field yang di-highlight setelah gagal validasi
  const tug10Refs = useRef({}); // anchor scroll per seksi/field TUG-10
  const syncingPhotosRef = useRef(false); // cegah tumpang-tindih auto-sync foto transaksi pending
  const [pendingFoto, setPendingFoto] = useState({}); // foto yang baru dipilih tapi belum diklik "Simpan Foto" — {fotoNameplate, fotoKeseluruhan}
  const [lightboxImg, setLightboxImg] = useState(null); // src foto yang sedang di-overview full-screen
  const [scannerTarget, setScannerTarget] = useState(null); // "stockForm" | {index}
  const [stockForm, setStockForm] = useState({});
  const [txnForm, setTxnForm] = useState(null);
  const [toast, setToast] = useState(null);

  const [chatHistory, setChatHistory] = useState([{ role:"ai", text:`Halo, saya Pak War — asisten operasional gudang ${WAREHOUSE}.\n\nSaya siap membantu membaca kondisi stok, transaksi TUG, approval, forecast, dan prioritas pekerjaan. Pilih contoh pertanyaan di atas atau tulis pertanyaan Anda sendiri.` }]);
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

  useEffect(() => {
    // Tabel master memakai RLS authenticated. Tunggu sesi/profil selesai dipulihkan;
    // kalau dipanggil saat mount sebagai anon, Supabase mengembalikan daftar kosong
    // dan data remote (termasuk warehouse_capacity) tidak pernah dimuat ulang.
    if (authLoading || !currentUser) return;
    async function loadCloud() {
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
      const cattb = await CLOUD.get("pln_attb_v1");
      const cmcd = await CLOUD.get("pln_material_cadang_v1");
      const cmch = await CLOUD.get("pln_material_cadang_health_v1");
      const cmcai = await CLOUD.get("pln_material_cadang_ai_insights_v1");
      const cgcap = await CLOUD.get("pln_gudang_capacity_v1");
      const cgcapi = await CLOUD.get("pln_gudang_capacity_imports_v1");
      const cmig = await CLOUD.get("pln_migrated_tug15_v1");
      const cmpr = await CLOUD.get("pln_migrasi_pending_review_v1");

      // Master data (UIT/UPT/Gudang/Lokasi/Satpam/Tim Mutu) sekarang sumber
      // utamanya Supabase, bukan localStorage lagi — load dulu (seed dari
      // DEFAULT_* kalau tabelnya masih kosong, mis. instalasi baru).
      const [cuit, cupt, cultg, cgdg, csgdg, clokRemote, csp, ctm, ckatRemote, csRemote, cgcapRemote, cgcapiRemote, cheRemote, chelRemote, copnRemote, cscRemote, cattbRemote] = await Promise.all([
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
        } else if (DEFAULT_LOKASI.length > 0) {
          setLokasiList(DEFAULT_LOKASI);
          await syncMasterTable("lokasi", DEFAULT_LOKASI, l => ({ gudang_id: l.gudangId || null, status: l.status || null }));
          CLOUD.set("pln_lokasi_v4", DEFAULT_LOKASI);
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
      setTxns(ct || DEFAULT_TXNS);
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
      } else if (DEFAULT_GUDANG.length > 0) {
        setGudangList(DEFAULT_GUDANG);
        await syncMasterTable("gudang", DEFAULT_GUDANG, g => ({ upt_id: g.uptId || null }));
        CLOUD.set("pln_gudang_v1", DEFAULT_GUDANG);
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
      const scLocal = csc || [];
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
        setStockCountList(cscRemote);
        CLOUD.set("pln_stockcount_v1", cscRemote); // refresh cache dgn data terbaru dari server
      } else {
        setStockCountList(scLocal);
        if (scLocal.length > 0) syncMasterTable("stock_count", scLocal);
      }
      setApprovalHistoryList(cah || []);
      setMaturityAssessments(cma || []);
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
      setMaterialCadangData(cmcd || { imports:[], analyses:[], applyHistory:[] });
      setMaterialCadangHealthData(cmch || { imports:[], analysisRuns:[], healthResults:[], applyAudit:[] });
      setMaterialCadangAiInsights(cmcai || { runs:[], materialInsights:[] });
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
      setDataRefreshing(false);
    }
    loadCloud();
  }, [authLoading, currentUser?.id]);

  // saveToCloud now takes an overrides object. Any field not passed falls back
  // to the latest React state via stateRef (always up to date, avoids stale
  // closures without needing every call site updated when new fields are added).
  const stateRef = useRef({});
  stateRef.current = { stocks, txns, docSeq, satpamList, katalogList, lokasiList, timMutuList, uitList, uptList, gudangList, subGudangList, rencanaKedatanganList, opnameList, stockCountList, approvalHistoryList, maturityAssessments, heavyEquipmentList, heavyEquipmentLoans, attbList, materialCadangData, materialCadangHealthData, materialCadangAiInsights, gudangCapacityList, gudangCapacityImports, migratedTug15History, migrasiPendingReview };
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
  // memberi `{ stocksChangedRows: [...] }` / `{ katalogChangedRows: [...] }` supaya
  // sync ke Supabase cuma mengirim baris itu (syncMasterTableRows, ringan) alih-alih
  // seluruh tabel (syncMasterTable, yang untuk `stocks` bisa ~18.7MB gara-gara foto
  // base64 di jsonb). TANPA hint, perilaku PERSIS SAMA seperti sebelumnya (full sync,
  // termasuk reconciliation-delete) — hint HANYA dipakai untuk kasus "beberapa baris
  // spesifik berubah", BUKAN untuk kasus yang butuh deteksi baris terhapus.
  const saveToCloud = useCallback(async (overrides = {}, hints = {}) => {
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
      CLOUD.set("pln_maturity_v1", ma),
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
    const extraColsStocks = item => ({ katalog_id: item.katalogId || null, lokasi_id: item.lokasiId || null });
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
      syncTasks.push({ label: "Data Stok", promise: (Array.isArray(stocksHint) && stocksHint.length > 0)
        ? syncMasterTableRows("stocks", stocksHint, extraColsStocks)
        : syncMasterTable("stocks", s, extraColsStocks) });
    }
    // Kapasitas Gudang — sebelumnya localStorage/CLOUD-only, sekarang auto-backup
    // ke Supabase tiap kali berubah (lihat schema.sql section 10-11).
    if (overrides.gudangCapacityList !== undefined) syncTasks.push({ label: "Kapasitas Gudang", promise: syncWarehouseCapacity(gcap) });
    if (overrides.gudangCapacityImports !== undefined) syncTasks.push({ label: "Import Kapasitas Gudang", promise: syncWarehouseCapacityImports(gcapi) });
    // Alat Berat/Peminjaman UPT — sebelumnya localStorage/CLOUD-only (ditemukan saat
    // audit 2026-07-06), sekarang auto-backup ke Supabase tiap kali berubah (lihat
    // schema.sql section 21).
    if (overrides.heavyEquipmentList !== undefined) syncTasks.push({ label: "Alat Berat", promise: syncMasterTable("heavy_equipment", he, e => ({ upt: e.upt || null })) });
    if (overrides.heavyEquipmentLoans !== undefined) syncTasks.push({ label: "Peminjaman Alat Berat", promise: syncMasterTable("heavy_equipment_loans", hel, l => ({
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
    if (overrides.opnameList !== undefined) syncTasks.push({ label: "Stock Opname", promise: syncMasterTable("stock_opname", opn, o => ({ status: o.status || null })) });
    if (overrides.stockCountList !== undefined) syncTasks.push({ label: "Stock Count", promise: syncMasterTable("stock_count", sc) });
    const syncResults = await Promise.all(syncTasks.map(task => task.promise));
    const failedLabels = syncTasks.filter((task, i) => syncResults[i] === false).map(task => task.label);
    if (failedLabels.length > 0) {
      showToast(`⚠️ Sebagian data gagal tersimpan ke cloud (${failedLabels.join(", ")}). Coba simpan ulang atau cek koneksi.`, "error");
    }

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
    const gudangWithCoord = gudangList
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
    if (gudangWithCoord.length > 0) {
      map.setView([gudangWithCoord[0].coord.lat, gudangWithCoord[0].coord.lng], gudangWithCoord.length===1?13:11);
    }
    setTimeout(()=>map.invalidateSize(), 100);
  }, [tab, dashTab, gudangList, stocks, lokasiList, maturityAssessments, currentUser]);

  // Toast error dibiarkan tampil lebih lama (5.5s) daripada sukses (3.5s) —
  // pesan error biasanya lebih panjang/penting untuk dibaca tuntas, terutama
  // di HP saat user sedang fokus mengisi form di lapangan.
  function showToast(msg, type="success") { setToast({msg,type}); setTimeout(()=>setToast(null), type==="error"?5500:3500); }
  showToastRef.current = showToast;

  async function handleLogin() {
    if (!supabase) {
      const username = (loginForm.username || "admin").trim().toLowerCase();
      const localProfile = {
        id: "local-user-" + username,
        name: (loginForm.username.trim() || "Admin Local") + " (Local)",
        username: username,
        role: "SUPERADMIN",
        jabatan: "Administrator Gudang (Local)",
        avatar: null,
        uptId: "UPT_SURABAYA",
        ultgId: null,
        uitId: null,
        gudangIds: null
      };
      try {
        localStorage.setItem("sb-local-auth-token", JSON.stringify({ local: true }));
        localStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify(localProfile));
      } catch {}
      setCurrentUser(localProfile);
      setLoginErr("");
      return;
    }
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
    setLoggingOut(true);
    try {
      if (supabase) await supabase.auth.signOut();
      try { sessionStorage.removeItem("warnoto_tab"); } catch {}
      // Bersihkan cache SECARA LANGSUNG di sini, jangan hanya menunggu listener
      // onAuthStateChange (async, jalan setelah signOut selesai). Kalau signOut ke
      // server self-host lambat/timeout dan user keburu refresh, sesi belum putus →
      // refresh = login lagi. Dobel-hapus dengan listener AMAN (removeItem key yang
      // sudah tidak ada tidak error).
      try { localStorage.removeItem("sb-local-auth-token"); } catch {}
      try { localStorage.removeItem(PROFILE_CACHE_KEY); } catch {}
      try { PHASE1_CACHE_KEYS.forEach(k => localStorage.removeItem('warnoto_' + k)); } catch {}
      try { PHASE2_CACHE_KEYS.forEach(k => localStorage.removeItem('warnoto_' + k)); } catch {}
      setCurrentUser(null); setUsers([]);
    } finally {
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

  // Kelola Akun (ADMIN only) — daftarkan user baru lewat Edge Function
  // admin-create-user (service_role di server, supaya sesi Admin yang lagi
  // login tidak ketimpa jadi sesi user baru seperti kalau pakai signUp() biasa
  // langsung dari browser).
  function openAddAkun() {
    setAkunForm({username:"", password:"", name:"", role:"VIEWER", jabatan:"", uptId:"", ultgId:"", uitId:"", pengadaanScope:"UPT", gudangIds:[]});
    setAkunResult(null);
    setAkunModal("add");
  }
  function openEditAkun(u) {
    setAkunForm({id:u.id, username:u.username, password:"", name:u.name||"", role:u.role||"VIEWER", jabatan:u.jabatan||"", uptId:u.uptId||"", ultgId:u.ultgId||"", uitId:u.uitId||"", pengadaanScope:u.uitId?"UIT":"UPT", gudangIds:Array.isArray(u.gudangIds)?u.gudangIds:[]});
    setAkunResult(null);
    setAkunModal("edit");
  }
  // Role level-UIT (ADMIN_UIT/MGR_LOGISTIK_UIT) dan PENGADAAN mode UIT pakai
  // uitId, bukan uptId — field-nya saling eksklusif di form (lihat render modal).
  function isUitScopedRole(f) {
    return ["ADMIN_UIT","MGR_LOGISTIK_UIT"].includes(f.role) || (f.role==="PENGADAAN" && f.pengadaanScope==="UIT");
  }
  async function submitAkunEdit() {
    if (isDemoMode()) { showToast("Mode demo: manajemen akun dinonaktifkan.","error"); return; }
    const f = akunForm;
    if (!f.name?.trim()) { showToast("Nama lengkap wajib diisi.","error"); return; }
    if (!f.jabatan?.trim()) { showToast("Jabatan wajib diisi.","error"); return; }
    const uitScoped = isUitScopedRole(f);
    if (uitScoped) { if (!f.uitId) { showToast(`Role ${ROLES[f.role]} wajib memilih unit UIT.`,"error"); return; } }
    else { if (!f.uptId) { showToast("UPT wajib dipilih.","error"); return; } }
    if ((f.role==="ADMIN_ULTG"||f.role==="MGR_ULTG") && !f.ultgId) { showToast(`Role ${ROLES[f.role]} wajib memilih unit ULTG.`,"error"); return; }
    if (f.password && f.password.length < 6) { showToast("Password baru minimal 6 karakter.","error"); return; }
    setAkunBusy(true);
    const { data, error } = await supabase.functions.invoke("admin-update-user", { body: {
      userId: f.id, name: f.name.trim(), role: f.role, jabatan: f.jabatan||"",
      uptId: uitScoped ? "" : (f.uptId||""), ultgId: f.ultgId||"", uitId: uitScoped ? (f.uitId||"") : "",
      pengadaanScope: f.pengadaanScope||"UPT", newPassword: f.password||"",
      gudangIds: (Array.isArray(f.gudangIds) && f.gudangIds.length) ? f.gudangIds : null, // null = semua gudang
    }});
    setAkunBusy(false);
    if (error || !data?.ok) { showToast(data?.error || error?.message || "Gagal menyimpan perubahan akun.","error"); return; }
    setAkunModal(null);
    await reloadUsers();
    logAudit(currentUser, "UPDATE", "akun", f.username, {nama:f.name, role:f.role});
    showToast("✅ Akun berhasil diperbarui!");
  }
  async function submitAkunBaru() {
    if (isDemoMode()) { showToast("Mode demo: manajemen akun dinonaktifkan.","error"); return; }
    const f = akunForm;
    if (!f.username?.trim()) { showToast("Username wajib diisi.","error"); return; }
    if (!f.password || f.password.length < 6) { showToast("Password minimal 6 karakter.","error"); return; }
    if (!f.name?.trim()) { showToast("Nama lengkap wajib diisi.","error"); return; }
    if (!f.jabatan?.trim()) { showToast("Jabatan wajib diisi.","error"); return; }
    const uitScoped = isUitScopedRole(f);
    if (uitScoped) { if (!f.uitId) { showToast(`Role ${ROLES[f.role]} wajib memilih unit UIT.`,"error"); return; } }
    else { if (!f.uptId) { showToast("UPT wajib dipilih.","error"); return; } }
    if ((f.role==="ADMIN_ULTG"||f.role==="MGR_ULTG") && !f.ultgId) { showToast(`Role ${ROLES[f.role]} wajib memilih unit ULTG.`,"error"); return; }
    setAkunBusy(true);
    const { data, error } = await supabase.functions.invoke("admin-create-user", { body: {
      username: f.username.trim().toLowerCase(), password: f.password, name: f.name.trim(),
      role: f.role, jabatan: f.jabatan||"", uptId: uitScoped ? "" : (f.uptId||""), ultgId: f.ultgId||"",
      uitId: uitScoped ? (f.uitId||"") : "", pengadaanScope: f.pengadaanScope||"UPT",
      gudangIds: (Array.isArray(f.gudangIds) && f.gudangIds.length) ? f.gudangIds : null, // null = semua gudang
    }});
    setAkunBusy(false);
    if (error || !data?.ok) { showToast(data?.error || error?.message || "Gagal mendaftarkan akun.","error"); return; }
    setAkunResult({username: f.username.trim().toLowerCase(), password: f.password});
    await reloadUsers();
    logAudit(currentUser, "CREATE", "akun", f.username.trim().toLowerCase(), {nama:f.name, role:f.role});
    showToast("✅ Akun berhasil didaftarkan!");
  }

  // Ganti password mandiri (semua role, akun sendiri) — re-auth pakai password
  // lama dulu (signInWithPassword) sebelum panggil updateUser, supaya device
  // dengan sesi aktif yang lagi dipegang orang lain tidak bisa ganti password
  // pemilik akun tanpa tahu password lamanya.
  function openGantiPassword() {
    setGantiPasswordForm({oldPassword:"", newPassword:"", confirmPassword:""});
    setGantiPasswordModal(true);
  }
  async function submitGantiPassword() {
    if (isDemoMode()) { showToast("Mode demo: ganti password dinonaktifkan.","error"); return; }
    const f = gantiPasswordForm;
    if (!f.oldPassword) { showToast("Password lama wajib diisi.","error"); return; }
    if (!f.newPassword || f.newPassword.length < 6) { showToast("Password baru minimal 6 karakter.","error"); return; }
    if (f.newPassword !== f.confirmPassword) { showToast("Konfirmasi password baru tidak cocok.","error"); return; }
    setGantiPasswordBusy(true);
    const { error: reauthErr } = await supabase.auth.signInWithPassword({
      email: usernameToAuthEmail(currentUser.username), password: f.oldPassword,
    });
    if (reauthErr) {
      setGantiPasswordBusy(false);
      showToast("Password lama salah.","error");
      return;
    }
    const { error: updateErr } = await supabase.auth.updateUser({ password: f.newPassword });
    setGantiPasswordBusy(false);
    if (updateErr) { showToast("Gagal mengubah password: "+updateErr.message,"error"); return; }
    setGantiPasswordModal(false);
    logAudit(currentUser, "UPDATE", "akun", currentUser.username, {gantiPassword:true});
    showToast("✅ Password berhasil diubah!");
  }

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
        const { data: profile, error: profErr } = await supabase.from("profiles").select("*").eq("id", session.user.id).single();
        if (profErr || !profile) {
          setLoginErr("Akun ini belum punya profil (hubungi Admin). Logout otomatis.");
          await supabase.auth.signOut();
          setCurrentUser(null); setUsers([]);
          try { localStorage.removeItem(PROFILE_CACHE_KEY); } catch {}
          try { PHASE1_CACHE_KEYS.forEach(k => localStorage.removeItem('warnoto_' + k)); } catch {} // cegah kebocoran data antar user di device sama
          try { PHASE2_CACHE_KEYS.forEach(k => localStorage.removeItem('warnoto_' + k)); } catch {} // idem, master data Fase 2
        } else {
          const userObj = { id: profile.id, name: profile.name, username: profile.username, role: profile.role, jabatan: profile.jabatan, avatar: profile.avatar, uptId: profile.upt_id, ultgId: profile.ultg_id, uitId: profile.uit_id, gudangIds: profile.gudang_ids };
          setCurrentUser(userObj);
          try { localStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify(userObj)); } catch {}
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
        setCurrentUser(null); setUsers([]);
        try { localStorage.removeItem(PROFILE_CACHE_KEY); } catch {}
        try { PHASE1_CACHE_KEYS.forEach(k => localStorage.removeItem('warnoto_' + k)); } catch {} // cegah kebocoran data antar user di device sama
        try { PHASE2_CACHE_KEYS.forEach(k => localStorage.removeItem('warnoto_' + k)); } catch {} // idem, master data Fase 2
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

  // Simpan tab aktif ke sessionStorage supaya refresh halaman tetap di menu yang
  // sama (per-tab-browser, sama seperti pola Mode Demo di src/lib/demo.js).
  useEffect(() => {
    try { sessionStorage.setItem("warnoto_tab", tab); } catch {}
  }, [tab]);

  async function saveMaturityAudit(audit, newStatus) {
    setMaturityAuditSaving(true);
    try {
      const entry = {
        ...(audit?.id ? audit : {}),
        id: audit?.id || `MA-${uid().slice(-8)}`,
        upt: audit?.upt || selectedMaturityUpt || "UPT Surabaya",
        status: newStatus,
        aspekScores: maturityAuditForm.aspekScores,
        evidence: maturityAuditEvidence,
        catatanUPT: maturityAuditForm.catatanUPT,
        catatanUIT: maturityAuditForm.catatanUIT,
        catatanPusat: maturityAuditForm.catatanPusat,
        fileUrl: maturityAuditForm.fileUrl,
        fileNama: maturityAuditForm.fileNama,
        createdAt: audit?.createdAt || Date.now(),
        updatedAt: Date.now(),
        updatedBy: currentUser?.id,
        history: [...(audit?.history || []), { action: newStatus, by: currentUser?.id, at: Date.now() }],
      };
      let nm;
      if (audit?.id) {
        nm = maturityAssessments.map(a => a.id === audit.id ? entry : a);
      } else {
        nm = [entry, ...maturityAssessments];
      }
      setMaturityAssessments(nm);
      try { CLOUD.set("pln_maturity_v1", nm); } catch {}
      logAudit(currentUser, audit?.id ? "UPDATE" : "CREATE", "maturity_audit", entry.id, { status: newStatus, upt: entry.upt });
      setMaturityAuditModal(null);
      showToast(`Audit ${entry.upt} tersimpan.`);
    } finally { setMaturityAuditSaving(false); }
  }

  async function deleteMaturityAudit(id) {
    if (!id) return;
    const nm = maturityAssessments.filter(a => a.id !== id);
    setMaturityAssessments(nm);
    try { CLOUD.set("pln_maturity_v1", nm); } catch {}
    setMaturityAuditModal(null);
    showToast("Audit maturity berhasil dihapus");
  }

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
    // Cuma 1 baris katalog berubah (edit/tambah id===katalogForm.id) — sync ringan baris itu.
    await saveToCloud({katalogList: nk}, {katalogChangedRows: nk.filter(k=>k.id===katalogForm.id)});
    logAudit(currentUser, katalogModal==="edit"?"UPDATE":"CREATE", "katalog", katalogClean.katalog||katalogClean.id, {kode:katalogClean.katalog, nama:katalogClean.name});
    showToast(katalogModal==="edit" ? "Master Katalog diupdate!" : "Katalog barang baru ditambahkan!");
  }
  async function searchMaraCatalog(q) {
    setMaraSearch(q);
    if (!q || q.trim().length < 2) { setMaraSearchResults([]); return; }
    if (!supabase) { showToast("Supabase tidak terhubung","error"); return; }
    setMaraSearchLoading(true);
    // Perkaya query dengan sinonim istilah PLN (mis. ketik "pemutus" ikut cari
    // "cb"/"circuit breaker") — sama kamus dengan matchesMaterialSearch di Data
    // Stok/Master Katalog, biar konsisten di 3 tempat pencarian material.
    const terms = expandQueryForIlikeSearch(q);
    const orFilter = terms.map(t => `nama.ilike.%${t}%`).join(",");
    const { data, error } = await supabase.from("mara_catalog")
      .select("kode_material,nama,satuan,material_group,material_group_desc")
      .or(orFilter)
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
  async function deleteKatalog(id) {
    if (stocks.some(s=>s.katalogId===id)) { showToast("Tidak bisa hapus: katalog ini masih dipakai di Data Stok!","error"); return; }
    const k = katalogList.find(x=>x.id===id);
    askConfirmDelete({
      title: "Hapus Katalog Barang?",
      message: <>Apakah Anda yakin ingin menghapus katalog barang <b>{k?.name||"-"}</b> (No. Katalog {k?.katalog||"-"})?</>,
      warning: "Tindakan ini tidak bisa dibatalkan.",
      onConfirm: async () => {
        const nk = katalogList.filter(x=>x.id!==id);
        setKatalogList(nk); await saveToCloud({katalogList: nk});
        logAudit(currentUser, "DELETE", "katalog", k?.katalog||id, {nama:k?.name});
        showToast("Katalog dihapus.");
      }
    });
  }

  // ── MASTER LOKASI GUDANG CRUD ──
  // Tambah/edit/hapus blok lokasi langsung berlaku, tanpa approval siapapun —
  // menu ini cuma bisa diakses ADMIN (lihat gating hasRole di render Master
  // Gudang), jadi tidak perlu alur PENDING/approval TL lagi (permintaan user 2026-07-09).
  // Tambah Blok manual (modal tanpa denah) sudah dihapus — blok baru sekarang HANYA
  // ditambahkan lewat "Kelola Denah & Koordinat" (klik titik di denah), jadi tiap blok
  // dijamin punya koordinat. Modal Lokasi tinggal dipakai untuk EDIT saja.
  function openEditLokasi(l) { setLokasiForm({...l}); setLokasiModal("edit"); }

  // Cek kode blok sudah dipakai DI SUB GUDANG yang sama (termasuk usulan pending EDIT lain).
  // Kode boleh sama antar Sub Gudang berbeda (mis. Blok A di Sub Gudang Terbuka & Tertutup itu
  // wajar) — jadi scope duplikat = gudang yang sama DAN sub gudang yang sama (null=grup "Umum").
  // Blok tanpa gudangId (belum di-assign) tidak dicek silang, karena belum "di dalam" gudang manapun.
  function isKodeDuplicateInSubGudang(kode, gudangId, subGudangId, excludeId) {
    if (!gudangId || !kode?.trim()) return false;
    const norm = kode.trim().toLowerCase();
    const sub = subGudangId || null;
    return lokasiList.some(l => {
      if (l.id === excludeId) return false;
      if (l.gudangId !== gudangId) return false;
      if ((l.subGudangId || null) !== sub) return false;
      if (l.pendingAction === "DELETE") return false;
      const kodeAktif = (l.pendingAction === "EDIT" && l.pendingData?.kode) ? l.pendingData.kode : l.kode;
      return (kodeAktif||"").trim().toLowerCase() === norm;
    });
  }

  function syncLokasi(nl) { return syncMasterTable("lokasi", nl, l => ({ gudang_id: l.gudangId || null, status: l.status || null })); }

  async function saveLokasi() {
    if (!lokasiForm.gudangId) { showToast("Pilih Gudang dulu sebelum mengisi Blok! Data harus berjenjang: Gudang → Blok.","error"); return; }
    if (!lokasiForm.kode?.trim()) { showToast("Kode Lokasi tidak boleh kosong!","error"); return; }
    if (isKodeDuplicateInSubGudang(lokasiForm.kode, lokasiForm.gudangId, lokasiForm.subGudangId, lokasiModal==="edit"?lokasiForm.id:null)) {
      showToast(`Kode blok "${lokasiForm.kode}" sudah dipakai di sub gudang ini!`,"error"); return;
    }
    let nl;
    if (lokasiModal==="edit") {
      nl = lokasiList.map(l => l.id===lokasiForm.id ? { ...l, ...lokasiForm, status:"APPROVED", pendingAction:null, pendingData:null } : l);
    } else {
      const baru = { ...lokasiForm, createdAt:Date.now(), status:"APPROVED", pendingAction:null, requestedBy:currentUser.id, requestedAt:Date.now() };
      nl = [...lokasiList, baru];
    }
    setLokasiList(nl); setLokasiModal(null);
    await syncLokasi(nl);
    CLOUD.set("pln_lokasi_v4", nl);
    logAudit(currentUser, lokasiModal==="edit"?"UPDATE":"CREATE", "lokasi", lokasiForm.kode, {kode:lokasiForm.kode});
    showToast(lokasiModal==="edit" ? "Master Lokasi diupdate!" : "Lokasi gudang baru ditambahkan!");
  }
  // Buka popup konfirmasi hapus blok gudang (bukan langsung hapus) —
  // tombol pemanggil hanya dirender untuk role ADMIN.
  function requestDeleteLokasi(l) {
    if (stocks.some(s=>s.lokasiId===l.id)) { showToast("Tidak bisa hapus: lokasi ini masih dipakai di Data Stok!","error"); return; }
    setLokasiDeleteConfirm(l);
  }
  async function confirmDeleteLokasi() {
    const l = lokasiDeleteConfirm;
    if (!l) return;
    const nl = lokasiList.filter(x=>x.id!==l.id);
    setLokasiList(nl); setLokasiDeleteConfirm(null);
    await syncLokasi(nl);
    CLOUD.set("pln_lokasi_v4", nl);
    logAudit(currentUser, "DELETE", "lokasi", l.kode, {kode:l.kode});
    showToast("Lokasi dihapus.");
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
    logAudit(currentUser, entry.decision==="REJECTED"?"REJECT":"APPROVE", entry.docType || entry.type || "approval", entry.refId ?? null, entry);
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
    CLOUD.set("pln_lokasi_v4", nl);
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
    CLOUD.set("pln_lokasi_v4", nl);
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
    setStocks(ns); await saveToCloud({stocks:ns}, {stocksChangedRows: ns.filter(s=>s.id===id)});
    await logApprovalHistory({type:"STOCK_MOVE", decision:"APPROVED", title:`${st.name}: ${lokAsal?.kode||"—"} → ${st.pendingLokasiKode}`, requestedBy:st.moveRequestedBy, requestedAt:st.moveRequestedAt});
    showToast(`✅ Pemindahan blok ${st.name} disetujui.`);
  }
  async function rejectStockMove(id) {
    const st = stocks.find(s=>s.id===id);
    if (!st || !st.lokasiMovePending) return;
    const lokAsal = lokasiList.find(l=>l.id===st.lokasiId);
    await logApprovalHistory({type:"STOCK_MOVE", decision:"REJECTED", title:`${st.name}: ${lokAsal?.kode||"—"} → ${st.pendingLokasiKode}`, requestedBy:st.moveRequestedBy, requestedAt:st.moveRequestedAt});
    const ns = stocks.map(s=>s.id===id ? {...s, lokasiMovePending:false, pendingLokasiId:null, pendingLokasiKode:null} : s);
    setStocks(ns); await saveToCloud({stocks:ns}, {stocksChangedRows: ns.filter(s=>s.id===id)});
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
      const isTL = hasRole(currentUser, "TL");
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
    // Hanya 1 baris berubah (edit/tambah baris id===stockForm.id) — sync ringan cuma baris itu.
    await saveToCloud({stocks: ns}, {stocksChangedRows: ns.filter(s=>s.id===stockForm.id)});
    logAudit(currentUser, stockModal==="edit"?"UPDATE":"CREATE", "stocks", stockForm.id, {katalogId:stockForm.katalogId, lokasiId:stockForm.lokasiId, wentToApproval});
    showToast(wentToApproval ? "📨 Perubahan qty/harga/jenis diajukan! Menunggu approval TL." : (stockModal==="edit" ? "Data Stok diupdate!" : "Data Stok baru ditambahkan!"));
  }
  // Upload langsung foto Nameplate/Keseluruhan dari modal detail (klik baris Data Stok) — khusus Admin/TL
  async function updateStockFoto(id, field, img) {
    let ns = stocks.map(s=>s.id===id?{...s,[field]:img}:s);
    setStocks(ns);
    // Foto = payload paling berat; cuma 1 baris berubah → sync ringan baris itu saja.
    await saveToCloud({stocks: ns}, {stocksChangedRows: ns.filter(s=>s.id===id)});
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
        pending.set(cur.id, await ocrSpaceOCR(cur.fotoNameplate));
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
  //                 p_upt=null: WARNOTO saat ini single-UPT (Surabaya), semua embedding
  //                 memang Surabaya. Saat multi-UPT nanti, isi p_upt sesuai UPT viewer.
  //  • "nameplate": OCR.space baca teks nameplate di foto → cocokkan ke Master
  //                 Katalog (nomor katalog/nama/type/merk) DAN ke teks foto
  //                 nameplate tersimpan (fotoNameplateOcr) — matchNameplateAll.
  async function runPhotoSearch() {
    if (!photoSearchImg) return;
    setPhotoSearchLoading(true);
    try {
      if (photoSearchMode === "nameplate") {
        const text = await ocrSpaceOCR(photoSearchImg);
        setPhotoSearchOcrText(text);
        setPhotoSearchResultMode("nameplate");
        setPhotoSearchResults(matchNameplateAll(text, katalogList, stocks));
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
        setPhotoSearchResults(data || []);
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
    if (!window.confirm("Hapus baris stok ini?")) return;
    const ns = stocks.filter(s=>s.id!==id);
    setStocks(ns); await saveToCloud({stocks: ns});
    logAudit(currentUser, "DELETE", "stocks", id);
    showToast("Data Stok dihapus.");
  }

  // Approve/reject pengajuan Edit (qty/harga/jenis) Data Stok — khusus TL
  async function approveStockEdit(id) {
    const st = stocks.find(s=>s.id===id);
    if (!st || !st.editPending) return;
    const ns = stocks.map(s=>s.id===id ? {...s, ...s.pendingEditData, editPending:false, pendingEditData:null, editApprovedBy:currentUser.id, editApprovedAt:Date.now()} : s);
    setStocks(ns); await saveToCloud({stocks: ns}, {stocksChangedRows: ns.filter(s=>s.id===id)});
    await logApprovalHistory({type:"STOCK_EDIT", decision:"APPROVED", title:`Edit ${st.name}: qty ${fmtNum(st.qty)}→${fmtNum(st.pendingEditData.qty)}, harga Rp${fmtNum(st.price)}→Rp${fmtNum(st.pendingEditData.price)}, jenis ${st.jenisBarang}→${st.pendingEditData.jenisBarang}`, requestedBy:st.editRequestedBy, requestedAt:st.editRequestedAt});
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
    setStocks(ns); await saveToCloud({stocks: ns});
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

  // ── Satpam CRUD ──
  function openAddSatpam() { setSatpamForm({ id:"SP"+uid().slice(-6), name:"", telp:"", gudangId:"" }); setSatpamModal("add"); }
  function openEditSatpam(sp) { setSatpamForm({...sp}); setSatpamModal("edit"); }
  async function saveSatpam() {
    if (!satpamForm.name?.trim()) { showToast("Nama Satpam tidak boleh kosong!","error"); return; }
    let nsp;
    if (satpamModal==="edit") nsp = satpamList.map(s=>s.id===satpamForm.id?{...satpamForm}:s);
    else nsp = [...satpamList, {...satpamForm, createdAt:Date.now()}];
    setSatpamList(nsp); setSatpamModal(null);
    await syncMasterTable("satpam", nsp);
    CLOUD.set("pln_satpam_v1", nsp);
    logAudit(currentUser, satpamModal==="edit"?"UPDATE":"CREATE", "satpam", satpamForm.id, {nama:satpamForm.name});
    showToast(satpamModal==="edit" ? "Data Satpam diupdate!" : "Satpam baru ditambahkan!");
  }
  async function deleteSatpam(id) {
    const s = satpamList.find(x=>x.id===id);
    askConfirmDelete({
      title: "Hapus Data Satpam?",
      message: <>Apakah Anda yakin ingin menghapus data Satpam <b>{s?.name||"-"}</b>?</>,
      warning: "Tindakan ini tidak bisa dibatalkan.",
      onConfirm: async () => {
        const nsp = satpamList.filter(x=>x.id!==id);
        setSatpamList(nsp); await syncMasterTable("satpam", nsp);
        CLOUD.set("pln_satpam_v1", nsp);
        logAudit(currentUser, "DELETE", "satpam", id, {nama:s?.name});
        showToast("Satpam dihapus.");
      }
    });
  }

  // ── Master Tim Mutu CRUD (2 paket TETAP — hanya edit anggota, tidak tambah/hapus paket) ──
  function openEditTimMutu(tm) { setTimMutuForm({...tm}); setTimMutuModal("edit"); }
  async function saveTimMutu() {
    const ntm = timMutuList.map(t=>t.id===timMutuForm.id?{...timMutuForm}:t);
    setTimMutuList(ntm); setTimMutuModal(null);
    await syncMasterTable("tim_mutu", ntm);
    CLOUD.set("pln_tim_mutu_v1", ntm);
    logAudit(currentUser, "UPDATE", "tim_mutu", timMutuForm.id);
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
    CLOUD.set("pln_uit_v1", nu);
    logAudit(currentUser, uitModal==="add"?"CREATE":"UPDATE", "uit", uitForm.id, {nama:uitForm.nama, kode:uitForm.kode});
    showToast(uitModal==="add"?"UIT ditambahkan!":"UIT diupdate!");
  }
  async function deleteUIT(id) {
    const u = uitList.find(x=>x.id===id);
    const uptCount = uptList.filter(p=>p.uitId===id).length;
    askConfirmDelete({
      title: "Hapus UIT?",
      message: <>Apakah Anda yakin ingin menghapus UIT <b>{u?.nama||"-"}</b>?</>,
      warning: uptCount>0 ? `Tindakan ini tidak bisa dibatalkan dan ada ${uptCount} UPT yang masih terhubung ke UIT ini.` : "Tindakan ini tidak bisa dibatalkan.",
      onConfirm: async () => {
        const nu = uitList.filter(x=>x.id!==id);
        setUitList(nu); await syncMasterTable("uit", nu);
        CLOUD.set("pln_uit_v1", nu);
        logAudit(currentUser, "DELETE", "uit", id, {nama:u?.nama});
        showToast("UIT dihapus.");
      }
    });
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
    CLOUD.set("pln_ultg_v1", nu);
    logAudit(currentUser, ultgModal==="add"?"CREATE":"UPDATE", "ultg", ultgForm.id, {nama:ultgForm.nama, kode:ultgForm.kode});
    showToast(ultgModal==="add"?"ULTG ditambahkan!":"ULTG diupdate!");
  }
  async function deleteULTG(id) {
    const u = ultgList.find(x=>x.id===id);
    askConfirmDelete({
      title: "Hapus ULTG?",
      message: <>Apakah Anda yakin ingin menghapus ULTG <b>{u?.nama||"-"}</b>?</>,
      warning: "Tindakan ini tidak bisa dibatalkan.",
      onConfirm: async () => {
        const nu = ultgList.filter(x=>x.id!==id);
        setUltgList(nu); await syncUltg(nu);
        CLOUD.set("pln_ultg_v1", nu);
        logAudit(currentUser, "DELETE", "ultg", id, {nama:u?.nama});
        showToast("ULTG dihapus.");
      }
    });
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
    CLOUD.set("pln_upt_v1", nu);
    logAudit(currentUser, uptModal==="add"?"CREATE":"UPDATE", "upt", uptForm.id, {nama:uptForm.nama, kode:uptForm.kode});
    showToast(uptModal==="add"?"UPT ditambahkan!":"UPT diupdate!");
  }
  async function deleteUPT(id) {
    const u = uptList.find(x=>x.id===id);
    const ultgCount = ultgList.filter(g=>g.parentUptId===id).length;
    askConfirmDelete({
      title: "Hapus UPT?",
      message: <>Apakah Anda yakin ingin menghapus UPT <b>{u?.nama||"-"}</b>?</>,
      warning: ultgCount>0 ? `Tindakan ini tidak bisa dibatalkan dan ada ${ultgCount} ULTG yang masih terhubung ke UPT ini.` : "Tindakan ini tidak bisa dibatalkan.",
      onConfirm: async () => {
        const nu = uptList.filter(x=>x.id!==id);
        setUptList(nu); await syncUpt(nu);
        CLOUD.set("pln_upt_v1", nu);
        logAudit(currentUser, "DELETE", "upt", id, {nama:u?.nama});
        showToast("UPT dihapus.");
      }
    });
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
  useEffect(() => { setShowGudangDenahTools(false); setSelectedSubGudangId(null); }, [expandedGudangId]);
  const [collapsedUitIds, setCollapsedUitIds] = useState(() => new Set()); // Struktur Organisasi: default semua UIT terbuka, per-item bisa ditutup (bukan accordion — beda dari Gudang, biasanya cuma 1-2 UIT jadi tidak perlu maksa 1 saja yang terbuka)
  const [orgSearch, setOrgSearch] = useState("");
  const [gudangWizardStep, setGudangWizardStep] = useState(1); // 1=Data Gudang, 2=Upload Denah, 3=Tambah Blok (hanya untuk mode "add")
  const [wizardBlokDraft, setWizardBlokDraft] = useState(null); // {kode,keterangan,kapasitas,xPct,yPct} saat klik titik di denah pada wizard step 3
  const [manualAddMode, setManualAddMode] = useState(false); // mode "Tambah Blok Baru" di Konfigurasi Koordinat Blok: klik di peta menambah draft usulan (belum dikirim ke TL)
  const [capacityReviewImportId, setCapacityReviewImportId] = useState(null); // import kapasitas gudang yang sedang direview Admin sebelum approve (ada kandidat Gudang baru)
  const [capacityReviewCandidates, setCapacityReviewCandidates] = useState([]); // hasil previewCapacityGudangMatch untuk import di atas
  const [capacityReviewDecisions, setCapacityReviewDecisions] = useState({}); // key "UPT|GUDANG" -> {action:"NEW"} | {action:"MAP",mappedGudangId}

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
  // Pencocokan nama Gudang pakai normalizeGudangName (diperketat 2026-07-06 — lihat
  // komentar di fungsi itu). `decisions` (opsional): map key "UPT|GUDANG" -> hasil
  // konfirmasi manual Admin dari panel review (lihat startCapacityApproval) —
  // { action:"MAP", mappedGudangId } artinya JANGAN buat Gudang baru, pakai yang
  // sudah ada itu; { action:"NEW" } atau tidak ada entry sama sekali = perilaku lama
  // (cocokkan otomatis via normalizeGudangName, baru buat baru kalau benar2 tidak ada).
  function syncGudangCapacityToMasterGudang(records, decisions = {}) {
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

      const gudangKey = `${r.upt}|${r.gudang}`;
      const decision = decisions[gudangKey];
      let gudangEntry = decision?.action === "MAP"
        ? gList.find(g => g.id === decision.mappedGudangId)
        : gList.find(g => g.uptId===uptMatch.id && normalizeGudangName(g.nama)===normalizeGudangName(r.gudang));
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
      const existingSub = sgList.find(sg => sg.gudangId===gudangEntry.id && normalizeGudangName(sg.nama)===normalizeGudangName(r.subGudang));
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

  // Preview (read-only, tidak mengubah apa pun) — dipakai SEBELUM approve untuk deteksi
  // baris mana yang bakal jadi Gudang BARU kalau langsung di-approve, supaya Admin bisa
  // konfirmasi dulu satu-satu ("ini memang Gudang baru" vs "ini sebenarnya Gudang X yang
  // sudah ada, cuma beda tulisan") — permintaan user 2026-07-06 supaya duplikat Gudang
  // dari import tidak terus berulang.
  function previewCapacityGudangMatch(records) {
    const seen = new Set();
    const newCandidates = [];
    records.forEach(r => {
      const gudangKey = `${r.upt}|${r.gudang}`;
      if (seen.has(gudangKey)) return;
      seen.add(gudangKey);
      const uptMatch = findMatchingUpt(r.upt);
      if (!uptMatch) return; // sudah dilaporkan terpisah sebagai skippedNoUpt saat approve
      const existing = gudangList.find(g => g.uptId===uptMatch.id && normalizeGudangName(g.nama)===normalizeGudangName(r.gudang));
      if (existing) return;
      newCandidates.push({
        key: gudangKey, upt: r.upt, gudang: r.gudang, uptId: uptMatch.id,
        suggestions: suggestSimilarGudang(r.gudang, uptMatch.id, gudangList),
      });
    });
    return newCandidates;
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
    CLOUD.set("pln_gudang_v1", newGudangList);
    await syncSubGudang(newSubGudangList);
    CLOUD.set("pln_sub_gudang_v1", newSubGudangList);
    showToast("✅ Koordinat & data Master Gudang disinkron ulang dari Kapasitas Gudang.", "success");
  }

  // Gabungkan Gudang/Sub Gudang duplikat (nama sama, ID beda — biasanya karena satu dibuat manual
  // dan satu lagi otomatis dari import Kapasitas Gudang). Ini penyebab umum denah/koordinat "hilang":
  // datanya nyasar ke ID duplikat yang sedang tidak ditampilkan. Blok Lokasi & Sub Gudang direassign
  // ke ID "primary" yang dipilih (prioritas: sudah punya denah > sudah punya koordinat > paling lama).
  async function dedupeGudangDanSubGudang(silent = false) {
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

    if (mergedGudang===0 && mergedSub===0) { if (!silent) showToast("Tidak ada Gudang/Sub Gudang duplikat ditemukan.", "success"); return; }

    setGudangList(newGudangList);
    setSubGudangList(newSubGudangList);
    setLokasiList(newLokasiList);
    await syncGudang(newGudangList);
    CLOUD.set("pln_gudang_v1", newGudangList);
    await syncSubGudang(newSubGudangList);
    CLOUD.set("pln_sub_gudang_v1", newSubGudangList);
    await syncLokasi(newLokasiList);
    CLOUD.set("pln_lokasi_v4", newLokasiList);
    showToast(`✅ ${mergedGudang} Gudang duplikat & ${mergedSub} Sub Gudang duplikat digabungkan.`, "success");
  }

  async function approveCapacityImport(importId, decisions = {}) {
    const imp = gudangCapacityImports.find(i=>i.id===importId);
    if (!imp) return;
    // id stabil per baris (UPT+Gudang+SubGudang) supaya upsert Supabase konsisten
    // antar batch — kalau baris yang sama diimport ulang di batch berikutnya,
    // dia menimpa dirinya sendiri (bukan duplikat), bukan menimpa baris lain.
    const batchRecords = imp.records.map(r => ({
      ...r,
      id: r.id || `CAP-${r.upt}-${r.gudang}-${r.subGudang}`.replace(/\s+/g,"-").toUpperCase(),
      importBatchId: imp.id,
    }));
    const newList = [...gudangCapacityList.filter(r => r.importBatchId !== imp.id), ...batchRecords];
    const newImports = gudangCapacityImports.map(i => i.id===importId
      ? {...i, status:"APPROVED", approvedBy:currentUser.id, approvedAt:Date.now()} : i);
    const { gList: newGudangList, sgList: newSubGudangList, created, createdSub, skippedNoUpt } = syncGudangCapacityToMasterGudang(newList, decisions);
    setGudangCapacityList(newList);
    setGudangCapacityImports(newImports);
    setGudangList(newGudangList);
    setSubGudangList(newSubGudangList);
    await saveToCloud({ gudangCapacityList: newList, gudangCapacityImports: newImports });
    await syncGudang(newGudangList);
    CLOUD.set("pln_gudang_v1", newGudangList);
    await syncSubGudang(newSubGudangList);
    CLOUD.set("pln_sub_gudang_v1", newSubGudangList);
    await logApprovalHistory({ type:"KAPASITAS_GUDANG_IMPORT", refId:imp.id, decision:"APPROVED", note:`${imp.sourceFile} — ${newList.length} record, ${created.length} Gudang + ${createdSub.length} Sub Gudang baru` });
    let msg = `Import disetujui — ${newList.length} record kapasitas gudang kini live.`;
    if (created.length || createdSub.length) msg += ` ${created.length} Gudang, ${createdSub.length} Sub Gudang baru dibuat otomatis.`;
    showToast(msg, "success");
    if (skippedNoUpt.length) {
      showToast(`⚠️ ${skippedNoUpt.length} gudang di-skip dari Master Gudang (UPT tidak dikenal): ${skippedNoUpt.slice(0,3).join(", ")}${skippedNoUpt.length>3?"...":""}`, "error");
    }
  }

  // Dipanggil dari tombol "Setujui & Publish" di Approval (menggantikan panggilan
  // langsung approveCapacityImport) — cek dulu apakah ada kandidat Gudang BARU yang
  // bakal otomatis dibuat; kalau ada, buka panel konfirmasi Admin dulu (permintaan
  // user 2026-07-06) sebelum benar-benar approve. Kalau tidak ada kandidat baru sama
  // sekali (semua baris cocok Gudang existing), langsung approve seperti biasa tanpa
  // friksi tambahan.
  function startCapacityApproval(importId) {
    const imp = gudangCapacityImports.find(i=>i.id===importId);
    if (!imp) return;
    const candidates = previewCapacityGudangMatch(imp.records);
    if (candidates.length === 0) { approveCapacityImport(importId); return; }
    setCapacityReviewImportId(importId);
    setCapacityReviewCandidates(candidates);
    setCapacityReviewDecisions(Object.fromEntries(candidates.map(c => [c.key, { action: "NEW" }])));
  }
  function confirmCapacityApproval() {
    if (!capacityReviewImportId) return;
    approveCapacityImport(capacityReviewImportId, capacityReviewDecisions);
    setCapacityReviewImportId(null);
    setCapacityReviewCandidates([]);
    setCapacityReviewDecisions({});
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
    CLOUD.set("pln_gudang_v1", ng);
    logAudit(currentUser, gudangModal==="add"?"CREATE":"UPDATE", "gudang", gudangForm.id, {nama:gudangForm.nama});
    showToast(gudangModal==="add"?"Gudang ditambahkan!":"Gudang diupdate!");
  }
  // Step 1 wizard: simpan data gudang lalu lanjut ke Step 2 (upload denah) tanpa menutup modal
  async function gudangWizardNext() {
    if (!gudangForm.nama?.trim()) { showToast("Nama Gudang wajib diisi!","error"); return; }
    const exists = gudangList.some(g=>g.id===gudangForm.id);
    const ng = exists ? gudangList.map(g=>g.id===gudangForm.id?gudangForm:g) : [...gudangList, gudangForm];
    setGudangList(ng);
    await syncGudang(ng);
    CLOUD.set("pln_gudang_v1", ng);
    logAudit(currentUser, exists?"UPDATE":"CREATE", "gudang", gudangForm.id, {nama:gudangForm.nama});
    setGudangWizardStep(2);
  }
  async function deleteGudang(id) {
    const g = gudangList.find(x=>x.id===id);
    const blokCount = lokasiList.filter(l=>l.gudangId===id).length;
    askConfirmDelete({
      title: "Hapus Gudang?",
      message: <>Apakah Anda yakin ingin menghapus Gudang <b>{g?.nama||"-"}</b>?</>,
      warning: `Tindakan ini tidak bisa dibatalkan dan ada ${blokCount} Blok Lokasi terkait yang akan kehilangan koordinat denah.`,
      onConfirm: async () => {
        const ng = gudangList.filter(x=>x.id!==id);
        setGudangList(ng); await syncGudang(ng);
        CLOUD.set("pln_gudang_v1", ng);
        logAudit(currentUser, "DELETE", "gudang", id, {nama:g?.nama});
        showToast("Gudang dihapus.");
      }
    });
  }
  // Tambah blok langsung dari klik titik di denah pada wizard step 3 (tanpa modal Lokasi terpisah)
  async function addWizardBlok() {
    if (!wizardBlokDraft?.kode?.trim()) { showToast("Kode blok tidak boleh kosong!","error"); return; }
    if (isKodeDuplicateInSubGudang(wizardBlokDraft.kode, gudangForm.id, null, null)) {
      showToast(`Kode blok "${wizardBlokDraft.kode}" sudah dipakai di gudang ini!`,"error"); return;
    }
    const baru = {
      id: `LOK-${uid().slice(-6)}`,
      kode: wizardBlokDraft.kode.trim(), keterangan: wizardBlokDraft.keterangan||"", kapasitas: wizardBlokDraft.kapasitas||50,
      mapX: wizardBlokDraft.xPct, mapY: wizardBlokDraft.yPct, gudangId: gudangForm.id,
      createdAt: Date.now(),
      status: "APPROVED", pendingAction: null,
      requestedBy: currentUser.id, requestedAt: Date.now(),
    };
    const nl = [...lokasiList, baru];
    setLokasiList(nl);
    await syncLokasi(nl);
    CLOUD.set("pln_lokasi_v4", nl);
    setWizardBlokDraft(null);
    showToast("✅ Blok ditambahkan!");
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
      CLOUD.set("pln_gudang_v1", ng);
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
      CLOUD.set("pln_gudang_v1", ng2);

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
  // Konfirmasi: usulan yang dicentang ditambahkan langsung ke Master Lokasi (tanpa approval —
  // tools ini hanya bisa diakses ADMIN). subGudangId non-null = usulan berasal dari denah Sub
  // Gudang -> koordinat disimpan di subMapX/subMapY (bukan mapX/mapY denah Gudang keseluruhan).
  async function confirmOcrSuggestions(gudangId, subGudangId=null) {
    const checked = ocrSuggestions.filter(s => s.checked);
    if (checked.length === 0) { showToast("Tidak ada usulan yang dicentang.","error"); return; }
    if (checked.some(s => !s.kode.trim())) { showToast("Nama Area wajib diisi untuk semua usulan yang dicentang!","error"); return; }

    // Saring duplikat kode: terhadap blok yang sudah ada di gudang ini, DAN antar sesama usulan yang dicentang.
    const seenInBatch = new Set();
    const valid = [], duplikat = [];
    checked.forEach(s => {
      const norm = s.kode.trim().toLowerCase();
      if (seenInBatch.has(norm) || isKodeDuplicateInSubGudang(s.kode, gudangId, subGudangId, null)) {
        duplikat.push(s.kode);
      } else {
        seenInBatch.add(norm);
        valid.push(s);
      }
    });
    if (valid.length === 0) { showToast(`Semua usulan terpilih duplikat kode dengan blok yang sudah ada di ${subGudangId?"sub gudang":"gudang"} ini.`,"error"); return; }

    const baru = valid.map(s => ({
      id: `LOK-${uid().slice(-6)}`,
      kode: s.kode.trim(), keterangan: "", kapasitas: 50,
      jenisArea: s.jenisArea||"Rak Tertutup", luasan: s.luasan||"",
      ...(subGudangId ? { subMapX: s.xPct, subMapY: s.yPct, subGudangId } : { mapX: s.xPct, mapY: s.yPct }),
      gudangId,
      createdAt: Date.now(),
      status: "APPROVED", pendingAction: null,
      requestedBy: currentUser.id, requestedAt: Date.now(),
    }));
    const nl = [...lokasiList, ...baru];
    setLokasiList(nl);
    await syncLokasi(nl);
    CLOUD.set("pln_lokasi_v4", nl);
    setOcrSuggestions(s => s.filter(x => !checked.includes(x)));
    const dupMsg = duplikat.length ? ` (${duplikat.length} dilewati karena duplikat kode: ${duplikat.join(", ")})` : "";
    showToast(`✅ ${baru.length} blok ditambahkan!` + dupMsg);
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
    CLOUD.set("pln_lokasi_v4", nl);
    showToast(`📍 Koordinat Blok disimpan!`);
  }

  async function resetLokasiKoordinat(lokasiId) {
    const nl = lokasiList.map(l=>l.id===lokasiId ? {...l, mapX:null, mapY:null, gudangId:null} : l);
    setLokasiList(nl);
    await syncLokasi(nl);
    CLOUD.set("pln_lokasi_v4", nl);
    showToast("Koordinat blok direset.");
  }

  // Assign koordinat blok via klik di denah Sub Gudang (terpisah dari mapX/mapY denah Gudang keseluruhan)
  async function assignLokasiKoordinatSub(lokasiId, xPct, yPct, subGudangId, gudangId) {
    const nl = lokasiList.map(l=>l.id===lokasiId ? {...l, subMapX:xPct, subMapY:yPct, subGudangId, gudangId} : l);
    setLokasiList(nl);
    await syncLokasi(nl);
    CLOUD.set("pln_lokasi_v4", nl);
    showToast(`📍 Koordinat Blok (Sub Gudang) disimpan!`);
  }

  // Reset hanya koordinat pin di denah Sub Gudang — assignment subGudangId (pengelompokan) tidak ikut dihapus
  async function resetLokasiKoordinatSub(lokasiId) {
    const nl = lokasiList.map(l=>l.id===lokasiId ? {...l, subMapX:null, subMapY:null} : l);
    setLokasiList(nl);
    await syncLokasi(nl);
    CLOUD.set("pln_lokasi_v4", nl);
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
      CLOUD.set("pln_sub_gudang_v1", nsg);
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
      CLOUD.set("pln_sub_gudang_v1", nsg2);

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

  // "Import dari SAP (PEMAT)" (importFromSAP) dihapus 2026-07-02 — digabung jadi satu dengan
  // wizard "Migrasi Data" (MigrasiDataTab/handleBackupAndApply) yang lebih aman (ada preview,
  // backup otomatis, panel review manual). Jangan bikin ulang fitur input Data Stok manual di
  // luar wizard itu — kebijakan bisnis: semua material masuk WAJIB lewat TUG, kecuali migrasi
  // data awal yang memang lewat wizard khusus itu.
  async function saveOpname(opn) {
    const exists = opnameList.find(o=>o.id===opn.id);
    const nl = exists ? opnameList.map(o=>o.id===opn.id?opn:o) : [...opnameList, opn];
    setOpnameList(nl);
    await saveToCloud({opnameList: nl});
    showToast("✅ Data opname disimpan!");
  }
  async function submitOpname(opn) {
    const updated = {...opn, status:"PENDING_ASMAN", submittedAt:Date.now()};
    // Sesi baru yang langsung di-submit tanpa pernah "Simpan Draft" dulu belum ada di
    // opnameList sama sekali (startOpname cuma setActiveOpname, tidak append ke list) —
    // pakai pola exists?map:append sama seperti saveOpname, supaya tidak silently dropped.
    const exists = opnameList.find(o=>o.id===opn.id);
    const nl = exists ? opnameList.map(o=>o.id===opn.id?updated:o) : [...opnameList, updated];
    setOpnameList(nl);
    await saveToCloud({opnameList: nl});
    showToast("📋 Opname disubmit! Menunggu approval Asman.");
  }
  async function approveOpname_Asman(opn, catatan) {
    if (!hasRole(currentUser, "ASMAN")) { showToast("Hanya Asman yang bisa approve.","error"); return; }
    const updated = {...opn, status:"PENDING_MANAGER", approvedByAsman:currentUser.id, approvedAtAsman:Date.now(), catatanAsman:catatan||""};
    const nl = opnameList.map(o=>o.id===opn.id?updated:o);
    setOpnameList(nl);
    await saveToCloud({opnameList: nl});
    showToast("✅ Disetujui Asman! Menunggu Manager.");
  }
  async function approveOpname_Manager(opn, catatan) {
    if (!hasRole(currentUser, "MANAGER")) { showToast("Hanya Manager yang bisa approve.","error"); return; }
    let newStocks = [...stocks];
    // Material baru dari SAP (item.katalogId null — belum ada di Master Katalog saat upload)
    // sekarang IKUT approval sesi ini (Asman->Manager), TIDAK ada approval TL terpisah (keputusan
    // user 2026-07-07, supaya tidak ada 2 alur approval yang membingungkan). Cuma diproses kalau
    // qty fisik benar-benar terisi (>0) — dibiarkan 0/kosong dianggap belum sempat dihitung fisik,
    // diabaikan total (tidak dibuatkan Master Katalog/Data Stok apa pun). No. Katalog dari SAP
    // dicek dulu via normalizeKatalog (bukan match string mentah, SAP kadang beda zero-padding) —
    // kalau bentrok dengan katalog yang SUDAH ADA, baris itu di-skip + Manager diberi tahu lewat
    // toast, TIDAK PERNAH menimpa diam-diam (pola sama seperti aturan keamanan Migrasi Data).
    let newKatalogList = [...katalogList];
    const materialBaruDibuat = [];
    const materialBaruKonflik = [];
    const nowOpn = Date.now();
    (opn.items||[]).filter(item => !item.katalogId && Number(item.qtsFisik)>0).forEach(item => {
      const noKatalog = String(item.noKatalog||"").trim();
      const namaBarang = String(item.namaBarang||"").trim();
      if (!noKatalog || !namaBarang) return;
      const konflik = newKatalogList.find(k => normalizeKatalog(k.katalog) === normalizeKatalog(noKatalog));
      if (konflik) { materialBaruKonflik.push(`${namaBarang} (No. Katalog ${noKatalog} sudah dipakai "${konflik.name}")`); return; }
      const jenisBarangBaru = /^\d{10}$/.test(noKatalog) ? "Cadang" : /^\d{7,8}$/.test(noKatalog) ? "Persediaan" : "Cadang";
      const newKatalogId = "KAT-OPN-" + noKatalog;
      newKatalogList = [...newKatalogList, {
        id: newKatalogId, katalog: noKatalog, name: namaBarang,
        category: namaBarang.split(";")[0].trim() || "Material",
        jenisBarang: jenisBarangBaru, satuan: item.satuan || "-",
        keterangan: `Material baru terdeteksi dari Stock Opname ${opn.semester} (${opn.jenisAlur})`,
        createdAt: nowOpn,
      }];
      newStocks = [...newStocks, {
        id: "STK-OPN-" + noKatalog + "-" + nowOpn,
        katalogId: newKatalogId, lokasiId: null,
        qty: Number(item.qtsFisik), price: 0, minQty: 0, unit: item.satuan || "-",
        jenisBarang: jenisBarangBaru, name: namaBarang, katalog: noKatalog,
        category: namaBarang.split(";")[0].trim() || "Material",
        sapBaselineQty: Number(item.qtsFisik), sapBaselineAt: nowOpn, createdAt: nowOpn, updatedAt: nowOpn,
      }];
      materialBaruDibuat.push(`${namaBarang} (${noKatalog})`);
    });

    (opn.items||[]).filter(item=>item.selisih!==0 && item.katalogId).forEach(item => {
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
    // Material Non-Stock yang ditemukan saat opname fisik (Opsi A) — katalog & stok-nya
    // SUDAH dibuat sejak "Simpan" di lapangan (lihat addNonStockFoundItem), bukan di sini.
    // Approve Manager di sini cuma melepas flag pendingOpnameId (mengonfirmasi), tidak bikin
    // baris baru — beda dari material baru SAP di atas yang memang baru dibuat saat ini.
    let konfirmasiNonStock = 0;
    newKatalogList = newKatalogList.map(k => k.pendingOpnameId === opn.id ? { ...k, pendingOpnameId: null } : k);
    newStocks = newStocks.map(s => {
      if (s.pendingOpnameId === opn.id) { konfirmasiNonStock++; return { ...s, pendingOpnameId: null }; }
      return s;
    });

    const updated = {...opn, status:"SELESAI", approvedByManager:currentUser.id, approvedAtManager:Date.now(), catatanManager:catatan||""};
    const nl = opnameList.map(o=>o.id===opn.id?updated:o);
    setOpnameList(nl); setStocks(newStocks); setKatalogList(newKatalogList);
    await saveToCloud({opnameList: nl, stocks: newStocks, katalogList: newKatalogList});
    // Ditemukan 2026-07-07: approve/reject Opname tidak pernah lapor ke logApprovalHistory
    // (beda dari semua jenis approval lain — Lokasi, Stock Move/Edit/Delete, Alat Berat,
    // Stock Count), jadi keputusannya tidak pernah muncul di "Riwayat Approval" terpusat.
    await logApprovalHistory({type:"OPNAME", decision:"APPROVED", title:`Stock Opname ${opn.semester} (${opn.jenisAlur})`, requestedBy:opn.dibuatOleh, requestedAt:opn.dibuatAt});
    let msg = "✅ Stock Opname SELESAI! Data Stok disesuaikan.";
    if (materialBaruDibuat.length) msg += ` ${materialBaruDibuat.length} material baru ditambahkan ke Master Katalog.`;
    if (materialBaruKonflik.length) msg += ` ⚠️ ${materialBaruKonflik.length} material baru TIDAK ditambahkan (bentrok No. Katalog): ${materialBaruKonflik.slice(0,2).join("; ")}${materialBaruKonflik.length>2?"...":""}.`;
    if (konfirmasiNonStock) msg += ` ${konfirmasiNonStock} material Non-Stock hasil opname dikonfirmasi aktif.`;
    showToast(msg, materialBaruKonflik.length ? "error" : "success");
  }
  async function rejectOpname(opn, reason) {
    const updated = {...opn, status:"DITOLAK", rejectedBy:currentUser.id, rejectedAt:Date.now(), rejectReason:reason};
    const nl = opnameList.map(o=>o.id===opn.id?updated:o);
    setOpnameList(nl); await saveToCloud({opnameList: nl});
    await logApprovalHistory({type:"OPNAME", decision:"REJECTED", title:`Stock Opname ${opn.semester} (${opn.jenisAlur})`, requestedBy:opn.dibuatOleh, requestedAt:opn.dibuatAt});
    showToast("❌ Opname ditolak.", "error");
  }
  async function deleteOpname(id) {
    if (!window.confirm("Hapus sesi opname ini?")) return;
    const nl = opnameList.filter(o=>o.id!==id);
    setOpnameList(nl); await saveToCloud({opnameList: nl});
    showToast("Opname dihapus.");
  }

  // Kode fallback untuk material Non-Stock yang TIDAK ketemu padanan MARA-nya —
  // format NS-<UPT singkat>-<urut 4 digit>, jelas beda dari kode SAP/MARA asli
  // (yang selalu angka murni) supaya tidak ada yang salah kira ini kode resmi.
  function generateNonStockFallbackCode() {
    const uptShort = ((typeof UPT !== "undefined" ? UPT : "").replace(/^UPT\s+/i, "").trim().slice(0, 3) || "UPT").toUpperCase();
    const prefix = `NS-${uptShort}-`;
    let maxN = 0;
    katalogList.forEach(k => {
      const m = String(k.katalog || "").match(new RegExp(`^${prefix}(\\d+)$`));
      if (m) maxN = Math.max(maxN, parseInt(m[1], 10));
    });
    return `${prefix}${String(maxN + 1).padStart(4, "0")}`;
  }

  // Material Non-Stock yang ditemukan SAAT opname fisik (bukan dari upload SAP) —
  // KEPUTUSAN SENGAJA (Opsi A, disepakati user): katalog + stok dibuat LANGSUNG di
  // sini (bukan menunggu Manager approve seperti material baru SAP), berstatus
  // "pendingOpnameId" terisi, supaya QR/label bisa langsung dicetak & ditempel ke
  // barang selagi Admin/TL masih di depannya — tidak perlu balik ke gudang lagi
  // nanti. QR encode `katalog.id` (bukan field `katalog` yang bisa dikoreksi
  // belakangan kalau kandidat MARA ditemukan susulan), jadi label fisik tetap
  // valid walau kode katalognya diperbarui.
  async function addNonStockFoundItem({ opnameId, nama, katalogCode, satuan, qty, lokasiId, foto, belumDicocokkanMara }) {
    const code = katalogCode || generateNonStockFallbackCode();
    const newKatalogId = "KAT-" + code;
    if (katalogList.some(k => k.id === newKatalogId)) {
      showToast(`Kode katalog "${code}" sudah dipakai. Coba lagi.`, "error");
      return null;
    }
    const now = Date.now();
    const newKatalog = {
      id: newKatalogId, katalog: code, name: nama,
      category: nama.split(";")[0].trim() || "Material",
      jenisBarang: "Non-Stock", satuan: satuan || "-",
      keterangan: `Ditemukan saat Stock Opname Non-SAP (menunggu approval sesi ${opnameId})`,
      pendingOpnameId: opnameId, belumDicocokkanMara: !!belumDicocokkanMara,
      createdAt: now,
    };
    const newStock = {
      id: "STK-OPN-" + code + "-" + now,
      katalogId: newKatalogId, lokasiId: lokasiId || null,
      qty: Number(qty) || 0, price: 0, minQty: 0, unit: satuan || "-",
      jenisBarang: "Non-Stock", name: nama, katalog: code,
      category: nama.split(";")[0].trim() || "Material",
      fotoKeseluruhan: foto || null,
      pendingOpnameId: opnameId,
      createdAt: now, updatedAt: now,
    };
    const nk = [...katalogList, newKatalog];
    const ns = [...stocks, newStock];
    setKatalogList(nk); setStocks(ns);
    // Cuma 1 baris katalog & 1 baris stok baru ditambah — sync ringan baris itu saja.
    await saveToCloud({ katalogList: nk, stocks: ns }, {katalogChangedRows: [newKatalog], stocksChangedRows: [newStock]});
    return newKatalog;
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

  function handleImg(e, setter) {
    const f = e.target.files[0]; if (!f) return;
    const r = new FileReader(); r.onload = ev => setter(ev.target.result); r.readAsDataURL(f);
  }
  // Foto satpam disimpan inline di jsonb (bukan bucket) → wajib dikompres kecil (maks 400px)
  // supaya tidak membengkakkan master jsonb & localStorage.
  async function handleSatpamFoto(e) {
    const f = e.target.files[0]; e.target.value = ""; if (!f) return;
    if (!f.type.startsWith("image/")) { showToast("File harus berupa gambar.","error"); return; }
    try { const img = await compressImage(f, { maxDim:400, maxBytes:120_000 }); setSatpamForm(sf=>({...sf, foto:img})); }
    catch { showToast("Gagal memproses foto.","error"); }
  }
  async function saveHeavyEquipmentEdit(equipmentId, updates) {
    if (!hasRole(currentUser, "ADMIN","TL")) { showToast("Hanya Admin/TL yang bisa mengubah data alat.","error"); return; }
    const alat = heavyEquipmentList.find(eq=>eq.id===equipmentId);
    if (!alat) return;
    if (["MAINTENANCE","KIR"].includes(updates.statusAlat) && alat.availabilityStatus==="DIPINJAM") {
      showToast("Alat sedang dipinjam, tidak bisa diubah ke status ini.","error"); return;
    }
    const next = heavyEquipmentList.map(eq => eq.id === equipmentId ? { ...eq, ...updates, ...(updates.foto!==undefined ? {fotoUpdatedAt:Date.now(), fotoUpdatedBy:currentUser.id} : {}) } : eq);
    setHeavyEquipmentList(next);
    await saveToCloud({heavyEquipmentList: next});
    logAudit(currentUser, "UPDATE", "heavy_equipment", equipmentId, {nama:alat.nama});
    showToast("✅ Data alat berat disimpan.");
  }
  async function createHeavyEquipmentLoan(form) {
    if (!hasRole(currentUser, "ADMIN","TL")) { showToast("Hanya Admin/TL yang bisa mengajukan peminjaman alat.","error"); return; }
    if (!form.equipmentId || !form.requesterUpt || !form.namaPekerjaan?.trim() || !form.tanggalAmbil || !form.tanggalKembali || !form.keperluan?.trim()) {
      showToast("Lengkapi alat, UPT peminjam, nama pekerjaan, tanggal, dan keperluan.","error"); return;
    }
    const alat = heavyEquipmentList.find(eq=>eq.id===form.equipmentId);
    if (!alat) { showToast("Alat tidak ditemukan.","error"); return; }
    if (alat.availabilityStatus === "DIPINJAM") { showToast("Alat sedang dipinjam, tidak bisa diajukan lagi.","error"); return; }
    if (alat.statusAlat === "MAINTENANCE") { showToast("Alat sedang maintenance, tidak bisa dipinjam UPT lain.","error"); return; }
    if (alat.statusAlat === "KIR") { showToast("Alat sedang KIR, tidak bisa dipinjam UPT lain.","error"); return; }
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
    if (!hasRole(currentUser, "ADMIN","TL","ASMAN")) { showToast("Role kamu tidak bisa menandai alat kembali.","error"); return; }
    const nextLoans = heavyEquipmentLoans.map(l=>l.id===loanId ? { ...l, status:"SELESAI", returnedBy:currentUser.id, returnedAt:Date.now() } : l);
    const nextEquipment = heavyEquipmentList.map(eq=>eq.id===loan.equipmentId ? { ...eq, availabilityStatus:"TERSEDIA", activeLoanId:null, borrowedToUpt:null, borrowedJobName:null, borrowedUntil:null } : eq);
    setHeavyEquipmentLoans(nextLoans);
    setHeavyEquipmentList(nextEquipment);
    await saveToCloud({heavyEquipmentLoans: nextLoans, heavyEquipmentList: nextEquipment});
    showToast("Alat ditandai sudah kembali.");
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
      upt: form.upt || getUserUptScope(currentUser),
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
    if (!canApproveAttb(currentUser, item)) { showToast("Hanya Asman UPT pengaju yang bisa approve item ini.","error"); return; }
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
    if (!canApproveAttb(currentUser, item)) { showToast("Hanya Asman UPT pengaju yang bisa menolak item ini.","error"); return; }
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
        gudangTujuanId: "", subGudangTujuanId: "", // cascade Gudang → Sub Gudang → Blok
        lokasiTujuanId: "", // which Master Lokasi (Blok) the returned items go into
        satpamId: "", // satpam gudang penyimpanan (Mengetahui di dokumen)
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
      if (hasRole(currentUser, "ADMIN_ULTG")) {
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
  function removeItemRow(i) { setTug10Collapsed({}); setTxnForm(tf => ({ ...tf, stockItems: tf.stockItems.filter((_,idx)=>idx!==i) })); }
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

  // Daftar syarat TUG-10 yang belum terpenuhi (dipakai checklist live + validasi submit).
  // Tiap entri punya scrollKey (anchor di tug10Refs) supaya bisa di-scroll & di-highlight.
  function tug10Missing(tf) {
    if (!tf) return [];
    const m = [];
    if (!tf.namaPekerjaan?.trim()) m.push({ scrollKey:"namaPekerjaan", label:"Nama Pekerjaan" });
    if (!tf.lokasiPekerjaan?.trim()) m.push({ scrollKey:"lokasiPekerjaan", label:"Lokasi Pekerjaan" });
    if (!tf.menyerahkanNama?.trim()) m.push({ scrollKey:"menyerahkanNama", label:"Yang Menyerahkan" });
    if (!tf.lokasiTujuanId) m.push({ scrollKey:"lokasiTujuanId", label:"Lokasi Penyimpanan (Blok)" });
    (tf.stockItems||[]).forEach((si,idx)=>{
      const n = idx+1;
      const barangOk = si.katalogMode==="existing" ? !!si.katalogId : !!si.namaBaru?.trim();
      if (!barangOk) m.push({ scrollKey:`item-${idx}`, label:`Barang #${n}: pilih/nama barang` });
      if (!(si.qty>0)) m.push({ scrollKey:`item-${idx}`, label:`Barang #${n}: jumlah` });
      if (!si.fotoBarangRetur) m.push({ scrollKey:`item-${idx}`, label:`Barang #${n}: foto barang` });
      if (si.statusMaterial==="Bongkaran ATTB (MTU)") {
        if (!si.noSeri?.trim()) m.push({ scrollKey:`item-${idx}`, label:`Barang #${n}: nomor seri (ATTB)` });
        if (!si.fotoNameplate) m.push({ scrollKey:`item-${idx}`, label:`Barang #${n}: foto nameplate (ATTB)` });
      }
    });
    if ((tf.stockItems||[]).some(si=>si.statusMaterial==="Bongkaran ATTB (MTU)") && !tf.fotoBAPengembalian) {
      m.push({ scrollKey:"fotoBAPengembalian", label:"Foto Surat BA Pengembalian (ada item ATTB)" });
    }
    return m;
  }
  function flagTug10Invalid(key) {
    if (!key) return;
    if (key.startsWith("item-")) { const idx = Number(key.split("-")[1]); setTug10Collapsed(c=>({...c,[idx]:false})); }
    setTug10Highlight(key);
    setTimeout(()=>{ tug10Refs.current[key]?.scrollIntoView({ behavior:"smooth", block:"center" }); }, 60);
    setTimeout(()=> setTug10Highlight(h=> h===key?null:h), 3000);
  }

  async function saveTxn() {
    if (savingTxn) { showToast("Sedang menyimpan, tunggu sebentar...","info"); return; }
    const canCreateULTG = hasRole(currentUser, "ADMIN_ULTG") && txnForm?.docType==="TUG5";
    if (!can(currentUser, "aksi.buatTransaksi", rolePerms) && !canCreateULTG && !editingDraftTxnId) { showToast("Role kamu tidak dapat mengajukan transaksi!","error"); return; }
    const docType = txnForm.docType;

    if (docType !== "TUG3" && docType !== "TUG10") {
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
      const missing = tug10Missing(txnForm);
      if (missing.length) {
        flagTug10Invalid(missing[0].scrollKey);
        showToast(`Belum lengkap — ${missing[0].label}${missing.length>1?` (dan ${missing.length-1} lainnya)`:""}`,"error");
        return;
      }
      const validItems = txnForm.stockItems.filter(si => si.qty > 0 && (si.katalogMode==="existing" ? si.katalogId : si.namaBaru?.trim()));
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
    if (savingTxnRef.current) return;       // cegah double-submit saat upload foto berjalan
    savingTxnRef.current = true;
    setSavingTxn(true);
    setSavingInfo({ label: "Menyiapkan data...", done: 0, total: 0 });
    try {
    // Upload foto base64 ke Storage dulu → blob transaksi jadi ringan. Gagal upload
    // (offline) → foto tetap base64 + _fotoPending; transaksi & dokumen tetap jadi,
    // auto-sync menyusul saat online (syncPendingTxnPhotos).
    const txnId = `${docType}-${uid().slice(-6)}`;
    const _hasFoto = formData && ([formData.fotoKendaraan,formData.fotoSimKtp,formData.fotoSuratPengembalian,formData.fotoBAPengembalian,formData.fotoSuratJalanImg,formData.fotoKontrak].some(_isDataUrl) || (formData.fotoMaterial||[]).some(fm=>_isDataUrl(fm?.img)) || (formData.stockItems||[]).some(si=>_isDataUrl(si.fotoNameplate)||_isDataUrl(si.fotoBarangRetur)));
    if (_hasFoto) setSavingInfo({ label: "Mengunggah foto...", done: 0, total: 0 });
    const { data: _fd, pending: _pend } = await processTxnPhotos(formData, txnId, (done, total) => setSavingInfo({ label: "Mengunggah foto...", done, total }));
    formData = _fd;
    if (_pend.length) showToast(`⚠️ ${_pend.length} foto belum terunggah (sinyal?). Transaksi & dokumen tetap tersimpan; foto disinkron otomatis saat online.`, "info");

    const seq = docSeq;
    const docCode = (docType === "TUG10" || docType === "TUG3") ? "LOG.00.01" : "LOG.00.02";
    const docNumbers = generateDocNumbers(seq, Date.now(), docCode);
    const docKey = docType === "TUG9" ? "tug9" : docType === "TUG8" ? "tug8" : docType === "TUG10" ? "tug10" : docType === "TUG5" ? "tug5" : "tug3";

    if (docType === "TUG5" && formData.sourceType === "ULTG") {
      // TUG-5 dari ULTG: 1-stage approval oleh Manager ULTG unit yang sama.
      // Setelah approve, jadi pengajuan yang bisa di-adopt Admin/TL UPT induk (bukan auto-chain TUG-7).
      const nt5u = {
        id: txnId,
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
      setSavingInfo({ label: "Menyimpan data transaksi...", done: 0, total: 0 });
      await saveToCloud({txns: newTxnsU, docSeq: newSeqU});
      logAudit(currentUser, "CREATE", "txns", nt5u.docNumbers.tug5, { docType, jumlahBarang: (formData.stockItems||[]).length });
      showToast(`${nt5u.docNumbers.tug5} dibuat! Menunggu approval Manager ULTG. ⏳`);
      return;
    }

    if (docType === "TUG5") {
      // TUG-5: 2-stage approval: Asman → Manager UPT
      // Then auto-generates: INTRACOMPANY → draft TUG-7, INTERCOMPANY → draft TUG-5 UIT
      const nt5 = {
        id: txnId,
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
      setSavingInfo({ label: "Menyimpan data transaksi...", done: 0, total: 0 });
      await saveToCloud({txns: newTxns5, docSeq: newSeq5});
      logAudit(currentUser, "CREATE", "txns", nt5.docNumbers.tug5, { docType, jumlahBarang: (formData.stockItems||[]).length });
      showToast(`${nt5.docNumbers.tug5} dibuat! Menunggu approval Asman Konstruksi. ⏳`);
      return;
    }

    if (docType === "TUG3") {
      // TUG-3/4 is a 3-stage approval chain on a single transaction:
      // PENDING_TL -> (TL approves) -> MENUNGGU_TUG4 -> (TUG-4 filled + Manager approves)
      // -> MENUNGGU_FINAL -> (lampiran final filled) -> PENDING_ASMAN -> (Asman approves) -> APPROVED
      const nt3 = {
        id: txnId,
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
      setSavingInfo({ label: "Menyimpan data transaksi...", done: 0, total: 0 });
      await saveToCloud({txns: newTxns3, docSeq: newSeq3});
      logAudit(currentUser, "CREATE", "txns", nt3.docNumbers.tug3, { docType, jumlahBarang: (formData.stockItems||[]).length });
      showToast(`Transaksi ${nt3.docNumbers.tug3} dibuat! Menunggu approval TL Logistik (TUG-3 Karantina). ⏳`);
      return;
    }

    const requiredApprover = hasRole(currentUser, "ADMIN") ? "TL" : "ASMAN";
    const nt = {
      id: txnId,
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
    setSavingInfo({ label: "Menyimpan data transaksi...", done: 0, total: 0 });
    await saveToCloud({txns: newTxns, docSeq: newSeq});
    logAudit(currentUser, "CREATE", "txns", nt.docNumbers[docKey], { docType, jumlahBarang: (formData.stockItems||[]).length });
    showToast(`Transaksi ${nt.docNumbers[docKey]} dibuat! Menunggu approval ${ROLES[requiredApprover]}. ⏳`);
    } catch (err) {
      console.error("commitNewTxn gagal:", err);
      showToast(`❌ Gagal menyimpan transaksi: ${err?.message||err}`, "error");
    } finally { savingTxnRef.current = false; setSavingTxn(false); setSavingInfo(null); }
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
    if (currentUser.role !== "SUPERADMIN" && txn.requiredApprover !== currentUser.role) {
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
      // Cuma baris stok yang ada di txn.stockItems yang berubah qty-nya (bukan seluruh tabel).
      await saveToCloud({stocks: newStocks, txns: newTxns}, {stocksChangedRows: newStocks.filter(s => txn.stockItems.some(si=>si.stockId===s.id))});
      logAudit(currentUser, "APPROVE", txn.docType, txn.docNumbers[dKey], {stage: txn.stage||null});
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
      return;
    }
  }
  async function rejectTxn(txn, reason) {
    if (currentUser.role !== "SUPERADMIN" && txn.requiredApprover !== currentUser.role) {
      showToast(`Transaksi ini butuh approval dari ${ROLES[txn.requiredApprover]}, bukan kamu.`,"error"); return;
    }
    if (!reason.trim()) { showToast("Masukkan alasan penolakan!","error"); return; }
    const newTxns = txns.map(t => t.id===txn.id ? {...t, status:"REJECTED", rejectedBy:currentUser.id, rejectedAt:Date.now(), rejectReason:reason} : t);
    setTxns(newTxns);
    await saveToCloud({txns: newTxns});
    logAudit(currentUser, "REJECT", txn.docType, txn.docNumbers[docKeyOf(txn)], {stage: txn.stage||null, alasan: reason});
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
    if (!hasRole(currentUser, "TL")) { showToast("Hanya TL Logistik yang bisa menyetujui TUG-3 Karantina.","error"); return; }
    if (txn.stage !== "PENDING_TL") { showToast("Transaksi ini tidak dalam tahap menunggu TL.","error"); return; }
    const newTxns = txns.map(t => t.id===txn.id ? { ...t, stage:"MENUNGGU_TUG4", approvedByTL:currentUser.id, approvedAtTL:Date.now(), requiredApprover:"MANAGER" } : t);
    setTxns(newTxns);
    await saveToCloud({txns: newTxns});
    logAudit(currentUser, "APPROVE", txn.docType, txn.docNumbers.tug3, {stage:"MENUNGGU_TUG4"});
    showToast(`✅ ${txn.docNumbers.tug3} disetujui TL Logistik! Lanjut ke tahap TUG-4 (Pemeriksaan Mutu).`);
  }
  async function rejectTUG3_TL(txn, reason) {
    if (!hasRole(currentUser, "TL")) { showToast("Hanya TL Logistik yang bisa menolak TUG-3 Karantina.","error"); return; }
    if (!reason.trim()) { showToast("Masukkan alasan penolakan!","error"); return; }
    const newTxns = txns.map(t => t.id===txn.id ? {...t, status:"REJECTED", stage:"REJECTED", rejectedBy:currentUser.id, rejectedAt:Date.now(), rejectReason:reason} : t);
    setTxns(newTxns);
    await saveToCloud({txns: newTxns});
    logAudit(currentUser, "REJECT", txn.docType, txn.docNumbers.tug3, {stage:"REJECTED", alasan:reason});
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
    if (!hasRole(currentUser, "MANAGER")) { showToast("Hanya Manager yang bisa menyetujui TUG-4.","error"); return; }
    if (txn.stage !== "PENDING_MANAGER") { showToast("Transaksi ini tidak dalam tahap menunggu Manager.","error"); return; }
    const newTxns = txns.map(t => t.id===txn.id ? { ...t, stage:"MENUNGGU_FINAL", approvedByManager:currentUser.id, approvedAtManager:Date.now(), requiredApprover:"ASMAN" } : t);
    setTxns(newTxns);
    await saveToCloud({txns: newTxns});
    logAudit(currentUser, "APPROVE", txn.docType, txn.docNumbers.tug4, {stage:"MENUNGGU_FINAL"});
    showToast(`✅ ${txn.docNumbers.tug4} disetujui Manager! Lanjut ke tahap finalisasi TUG-3.`);
  }
  async function rejectTUG4_Manager(txn, reason) {
    if (!hasRole(currentUser, "MANAGER")) { showToast("Hanya Manager yang bisa menolak TUG-4.","error"); return; }
    if (!reason.trim()) { showToast("Masukkan alasan penolakan!","error"); return; }
    const newTxns = txns.map(t => t.id===txn.id ? {...t, status:"REJECTED", stage:"REJECTED", rejectedBy:currentUser.id, rejectedAt:Date.now(), rejectReason:reason} : t);
    setTxns(newTxns);
    await saveToCloud({txns: newTxns});
    logAudit(currentUser, "REJECT", txn.docType, txn.docNumbers.tug4, {stage:"REJECTED", alasan:reason});
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
    if (!hasRole(currentUser, "ASMAN")) { showToast("Hanya Asman Konstruksi yang bisa menyetujui TUG-3 Final.","error"); return; }
    if (txn.stage !== "PENDING_ASMAN") { showToast("Transaksi ini tidak dalam tahap menunggu Asman.","error"); return; }

    // Same incoming-material logic as TUG-10 approval: bump existing Data Stok
    // row or auto-create new Master Katalog + Data Stok entry.
    let newKatalog = [...katalogList];
    let newStocks = [...stocks];
    let nextKatNum = newKatalog.length + 1;
    let nextStkNum = newStocks.length + 1;
    // Lacak baris stok & katalog yang benar-benar berubah/ditambah (pola sama TUG-10) —
    // sync ke Supabase cuma mengirim baris itu, bukan seluruh tabel `stocks`.
    const touchedStockIds = new Set();
    const touchedKatalogIds = new Set();

    txn.stockItems.forEach(si => {
      const lokasiId = si.lokasiTujuanId || txn.stockItems[0]?.lokasiTujuanId;
      if (!lokasiId) return;
      if (si.katalogMode === "existing" && si.katalogId) {
        const existingRow = newStocks.find(s => s.katalogId===si.katalogId && s.lokasiId===lokasiId);
        if (existingRow) {
          newStocks = newStocks.map(s => s.id===existingRow.id ? { ...s, qty: s.qty + si.qty } : s);
          touchedStockIds.add(existingRow.id);
        } else {
          const newId = `STK-${String(nextStkNum++).padStart(3,"0")}-${uid().slice(-6)}`;
          newStocks.push({ id:newId, katalogId:si.katalogId, lokasiId, qty:si.qty, minQty:0, price:si.harga||0, jenisBarang:"Persediaan", img:null, createdAt:Date.now() });
          touchedStockIds.add(newId);
        }
      } else {
        const newKatId = `KAT-${String(nextKatNum++).padStart(3,"0")}-${uid().slice(-6)}`;
        newKatalog.push({ id:newKatId, katalog:si.katalogBaru||"", name:si.namaBaru, category:si.categoryBaru||"Lainnya", satuan:si.satuanBaru||"unit", createdAt:Date.now() });
        touchedKatalogIds.add(newKatId);
        const newStkId = `STK-${String(nextStkNum++).padStart(3,"0")}-${uid().slice(-6)}`;
        newStocks.push({ id:newStkId, katalogId:newKatId, lokasiId, qty:si.qty, minQty:0, price:si.harga||0, jenisBarang:"Persediaan", img:null, createdAt:Date.now() });
        touchedStockIds.add(newStkId);
      }
    });

    const newTxns = txns.map(t => t.id===txn.id ? { ...t, stage:"APPROVED", status:"APPROVED", approvedByAsman:currentUser.id, approvedAtAsman:Date.now() } : t);
    setTxns(newTxns); setStocks(newStocks); setKatalogList(newKatalog);
    await saveToCloud({txns: newTxns, stocks: newStocks, katalogList: newKatalog}, {
      stocksChangedRows: newStocks.filter(s => touchedStockIds.has(s.id)),
      katalogChangedRows: newKatalog.filter(k => touchedKatalogIds.has(k.id)),
    });
    logAudit(currentUser, "APPROVE", txn.docType, txn.docNumbers.tug3, {stage:"APPROVED"});
    showToast(`✅ ${txn.docNumbers.tug3} DISETUJUI FINAL! Stok bertambah ke gudang.`);
  }
  async function rejectTUG3Final_Asman(txn, reason) {
    if (!hasRole(currentUser, "ASMAN")) { showToast("Hanya Asman Konstruksi yang bisa menolak TUG-3 Final.","error"); return; }
    if (!reason.trim()) { showToast("Masukkan alasan penolakan!","error"); return; }
    const newTxns = txns.map(t => t.id===txn.id ? {...t, status:"REJECTED", stage:"REJECTED", rejectedBy:currentUser.id, rejectedAt:Date.now(), rejectReason:reason} : t);
    setTxns(newTxns);
    await saveToCloud({txns: newTxns});
    logAudit(currentUser, "REJECT", txn.docType, txn.docNumbers.tug3, {stage:"REJECTED", alasan:reason});
    showToast(`❌ ${txn.docNumbers.tug3} DITOLAK oleh Asman Konstruksi (tahap final).`, "error");
  }

  // ══════════════════════════════════════════════════════════════════
  // TUG-5 APPROVAL CHAIN: Asman → Manager UPT
  // Setelah Manager approve → auto-generate TUG-7 (Intracompany)
  //                        atau draft TUG-5 UIT (Intercompany)
  // ══════════════════════════════════════════════════════════════════

  async function approveTUG5_Asman(txn) {
    if (!hasRole(currentUser, "ASMAN")) { showToast("Hanya Asman Konstruksi yang bisa menyetujui TUG-5 tahap ini.","error"); return; }
    if (txn.stage !== "PENDING_ASMAN") { showToast("TUG-5 ini tidak dalam tahap menunggu Asman.","error"); return; }
    const newTxns = txns.map(t => t.id===txn.id ? {...t, stage:"PENDING_MANAGER", requiredApprover:"MANAGER", approvedByAsman:currentUser.id, approvedAtAsman:Date.now()} : t);
    setTxns(newTxns);
    await saveToCloud({txns: newTxns});
    logAudit(currentUser, "APPROVE", txn.docType, txn.docNumbers.tug5, {stage:"PENDING_MANAGER"});
    showToast(`✅ ${txn.docNumbers.tug5} disetujui Asman! Menunggu approval Manager.`);
  }
  async function rejectTUG5_Asman(txn, reason) {
    if (!hasRole(currentUser, "ASMAN")) { showToast("Hanya Asman Konstruksi yang bisa menolak TUG-5.","error"); return; }
    if (!reason.trim()) { showToast("Masukkan alasan penolakan!","error"); return; }
    const newTxns = txns.map(t => t.id===txn.id ? {...t, status:"REJECTED", stage:"REJECTED", rejectedBy:currentUser.id, rejectedAt:Date.now(), rejectReason:reason} : t);
    setTxns(newTxns); await saveToCloud({txns: newTxns});
    logAudit(currentUser, "REJECT", txn.docType, txn.docNumbers.tug5, {stage:"REJECTED", alasan:reason});
    showToast(`❌ ${txn.docNumbers.tug5} DITOLAK oleh Asman.`, "error");
  }

  async function approveTUG5_Manager(txn) {
    if (!hasRole(currentUser, "MANAGER")) { showToast("Hanya Manager yang bisa menyetujui TUG-5 tahap ini.","error"); return; }
    if (txn.stage !== "PENDING_MANAGER") { showToast("TUG-5 ini tidak dalam tahap menunggu Manager.","error"); return; }

    if (txn.jenisTransfer === "INTRACOMPANY") {
      // Auto-generate draft TUG-7 di level UIT
      const seq = docSeq;
      const docNumbers = generateDocNumbers(seq, Date.now());
      const newTug7 = {
        id: `TUG7-` + uid().slice(-6),
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
      logAudit(currentUser, "APPROVE", txn.docType, txn.docNumbers.tug5, {stage:"APPROVED", generated:newTug7.docNumbers.tug7});
      showToast(`✅ ${txn.docNumbers.tug5} DISETUJUI! Draft TUG-7 otomatis dibuat untuk UIT. 📋`);
    } else {
      // INTERCOMPANY — generate draft TUG-5 UIT (untuk dikirim ke UIT lain)
      const seq = docSeq;
      const docNumbers = generateDocNumbers(seq, Date.now());
      const draftTug5UIT = {
        id: `TUG5UIT-` + uid().slice(-6),
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
      logAudit(currentUser, "APPROVE", txn.docType, txn.docNumbers.tug5, {stage:"APPROVED", generated:draftTug5UIT.docNumbers.tug5});
      showToast(`✅ ${txn.docNumbers.tug5} DISETUJUI! Draft TUG-5 UIT (Intercompany) dibuat — cetak & kirim manual ke UIT tujuan. 📄`);
    }
  }
  async function rejectTUG5_Manager(txn, reason) {
    if (!hasRole(currentUser, "MANAGER")) { showToast("Hanya Manager yang bisa menolak TUG-5.","error"); return; }
    if (!reason.trim()) { showToast("Masukkan alasan penolakan!","error"); return; }
    const newTxns = txns.map(t => t.id===txn.id ? {...t, status:"REJECTED", stage:"REJECTED", rejectedBy:currentUser.id, rejectedAt:Date.now(), rejectReason:reason} : t);
    setTxns(newTxns); await saveToCloud({txns: newTxns});
    logAudit(currentUser, "REJECT", txn.docType, txn.docNumbers.tug5, {stage:"REJECTED", alasan:reason});
    showToast(`❌ ${txn.docNumbers.tug5} DITOLAK oleh Manager.`, "error");
  }

  // ══════════════════════════════════════════════════════════════════
  // TUG-5 DARI ULTG: Manager ULTG approve (1 tahap) → jadi pengajuan siap di-adopt
  // Admin/TL UPT induk ULTG tersebut. Adopt = auto-create draft TUG-9 (editable).
  // ══════════════════════════════════════════════════════════════════

  async function approveTUG5_MgrULTG(txn) {
    if (!hasRole(currentUser, "MGR_ULTG")) { showToast("Hanya Manager ULTG yang bisa menyetujui TUG-5 ini.","error"); return; }
    if (currentUser.role !== "SUPERADMIN") {
      if (!currentUser.ultgId) { showToast("Akun kamu belum terhubung ke unit ULTG manapun. Hubungi Admin untuk melengkapi profil.","error"); return; }
      if (txn.ultgId !== currentUser.ultgId) { showToast("TUG-5 ini bukan dari unit ULTG kamu.","error"); return; }
    }
    if (txn.stage !== "PENDING_MGR_ULTG") { showToast("TUG-5 ini tidak dalam tahap menunggu Manager ULTG.","error"); return; }
    const newTxns = txns.map(t => t.id===txn.id ? {...t, stage:"APPROVED_ULTG", status:"APPROVED", approvedByMgrUltg:currentUser.id, approvedAtMgrUltg:Date.now()} : t);
    setTxns(newTxns);
    await saveToCloud({txns: newTxns});
    logAudit(currentUser, "APPROVE", txn.docType, txn.docNumbers.tug5, {stage:"APPROVED_ULTG"});
    showToast(`✅ ${txn.docNumbers.tug5} disetujui! Menunggu di-adopt oleh Admin/TL UPT.`);
  }
  async function rejectTUG5_MgrULTG(txn, reason) {
    if (!hasRole(currentUser, "MGR_ULTG")) { showToast("Hanya Manager ULTG yang bisa menolak TUG-5 ini.","error"); return; }
    if (!reason.trim()) { showToast("Masukkan alasan penolakan!","error"); return; }
    const newTxns = txns.map(t => t.id===txn.id ? {...t, status:"REJECTED", stage:"REJECTED", rejectedBy:currentUser.id, rejectedAt:Date.now(), rejectReason:reason} : t);
    setTxns(newTxns); await saveToCloud({txns: newTxns});
    logAudit(currentUser, "REJECT", txn.docType, txn.docNumbers.tug5, {stage:"REJECTED", alasan:reason});
    showToast(`❌ ${txn.docNumbers.tug5} DITOLAK oleh Manager ULTG.`, "error");
  }
  // Admin/TL UPT induk "mengadopsi" pengajuan ULTG → auto-create draft TUG-9 (editable, stok dipilih sendiri)
  async function adoptTUG5ULTG(txn) {
    if (!hasRole(currentUser, "ADMIN","TL")) { showToast("Hanya Admin/TL UPT yang bisa mengadopsi pengajuan ini.","error"); return; }
    if (txn.adoptedBy) { showToast("Pengajuan ini sudah di-adopt UPT lain.","error"); return; }
    const seq = docSeq;
    const docCode = "LOG.00.02";
    const docNumbers = generateDocNumbers(seq, Date.now(), docCode);
    const ultg = ultgList.find(u=>u.id===txn.ultgId);
    // Cocokkan katalogId dari pengajuan TUG-5 ULTG ke baris stok aktual (pilih stok dengan
    // qty terbesar untuk katalog tsb) — supaya list material TIDAK hilang saat masuk draft TUG-9,
    // karena form TUG-9 me-render item lewat stocks.find(s=>s.id===si.stockId), bukan katalogId.
    const draftTug9 = {
      id: `TUG9-` + uid().slice(-6),
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
    const requiredApprover = hasRole(currentUser, "ADMIN") ? "TL" : "ASMAN";
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
    if (!hasRole(currentUser, "ADMIN_UIT")) { showToast("Hanya Admin UIT yang bisa melengkapi TUG-7.","error"); return; }
    if (!tug7Data.uptPengirimId) { showToast("Pilih UPT Pengirim terlebih dahulu!","error"); return; }
    const newTxns = txns.map(t => t.id===txn.id ? {...t, ...tug7Data, stage:"PENDING_MGR_LOGISTIK", requiredApprover:"MGR_LOGISTIK_UIT", approvedByAdminUIT:currentUser.id, approvedAtAdminUIT:Date.now()} : t);
    setTxns(newTxns);
    await saveToCloud({txns: newTxns});
    showToast(`📋 TUG-7 ${txn.docNumbers.tug7} dilengkapi! Menunggu approval Manager Logistik UIT.`);
  }
  async function approveTUG7_MgrLogistik(txn) {
    if (!hasRole(currentUser, "MGR_LOGISTIK_UIT")) { showToast("Hanya Manager Logistik UIT yang bisa menyetujui TUG-7.","error"); return; }
    if (txn.stage !== "PENDING_MGR_LOGISTIK") { showToast("TUG-7 ini tidak dalam tahap menunggu Manager Logistik.","error"); return; }

    // Auto-generate draft TUG-8 di UPT Pengirim
    const seq = docSeq;
    const docNumbers = generateDocNumbers(seq, Date.now(), "LOG.00.02");
    const uptPengirim = uptList.find(u=>u.id===txn.uptPengirimId);
    const tug5Ref = txns.find(t=>t.id===txn.tug5Id);
    const newTug8Draft = {
      id: `TUG8-` + uid().slice(-6),
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
    logAudit(currentUser, "APPROVE", txn.docType, txn.docNumbers.tug7, {stage:"APPROVED", generated:newTug8Draft.docNumbers.tug8});
    showToast(`✅ TUG-7 DISETUJUI! Draft TUG-8 otomatis muncul di UPT ${uptPengirim?.nama||"Pengirim"}. 📦`);
  }
  async function rejectTUG7_MgrLogistik(txn, reason) {
    if (!hasRole(currentUser, "MGR_LOGISTIK_UIT")) { showToast("Hanya Manager Logistik UIT yang bisa menolak TUG-7.","error"); return; }
    if (!reason.trim()) { showToast("Masukkan alasan penolakan!","error"); return; }
    const newTxns = txns.map(t => t.id===txn.id ? {...t, status:"REJECTED", stage:"REJECTED", rejectedBy:currentUser.id, rejectedAt:Date.now(), rejectReason:reason} : t);
    setTxns(newTxns); await saveToCloud({txns: newTxns});
    logAudit(currentUser, "REJECT", txn.docType, txn.docNumbers.tug7, {stage:"REJECTED", alasan:reason});
    showToast(`❌ TUG-7 DITOLAK oleh Manager Logistik UIT.`, "error");
  }

  // Konfirmasi draft TUG-8 dari TUG-7 oleh Admin UPT Pengirim
  async function konfirmasiDraftTUG8(txn) {
    if (!hasRole(currentUser, "ADMIN","TL")) { showToast("Hanya Admin Gudang / TL yang bisa mengkonfirmasi draft TUG-8.","error"); return; }
    const requiredApprover = hasRole(currentUser, "ADMIN") ? "TL" : "ASMAN";
    const newTxns = txns.map(t => t.id===txn.id ? {
      ...t, stage:undefined, status:"PENDING",
      requiredApprover, approvedBy:null, approvedAt:null,
      asmanAutoApproved:false, createdBy:currentUser.id,
    } : t);
    setTxns(newTxns); await saveToCloud({txns: newTxns});
    logAudit(currentUser, "APPROVE", txn.docType, txn.docNumbers.tug8, {stage:"KONFIRMASI_DRAFT"});
    showToast(`✅ Draft TUG-8 dikonfirmasi! Status: PENDING, menunggu approval ${ROLES[requiredApprover]}.`);
  }

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
        onProgress?.(Math.min(i+BATCH, chunks.length), chunks.length);
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
    const kritis = getKritisAgg(enrichedStocks);
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

    // Build rich context from live system data
    const now = new Date();
    const tiga_bulan_lalu = Date.now() - 90*24*60*60*1000;
    const txnRecent = txns.filter(t=>t.createdAt>=tiga_bulan_lalu && t.status==="APPROVED");

    // Top 20 material by nilai
    const top20 = [...enrichedStocks]
      .sort((a,b)=>(b.qty*b.price)-(a.qty*a.price))
      .slice(0,20);

    // Stok kritis
    const kritis = getKritisAgg(enrichedStocks);

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

    const systemPrompt = `Kamu adalah asisten operasional sistem manajemen gudang PLN bernama Pak War untuk ${WAREHOUSE}.

PERSONA & GAYA JAWABAN:
Kamu Pak War, staf senior gudang PLN yang menjawab pertanyaan rekan kerja. Pakai
Bahasa Indonesia korporat yang natural dan ramah — bukan template kaku, bukan
robotik.

ATURAN JAWABAN:
- Jawab HANYA apa yang ditanya. JANGAN menambahkan analisis, interpretasi, atau
  rekomendasi kecuali user memintanya secara eksplisit.
- Buka dengan satu kalimat pengantar singkat, lalu langsung ke data. Boleh tutup
  dengan satu kalimat penawaran bantuan singkat.
- Saat menyebut material/stok, WAJIB satu bullet per item, satu baris per item,
  dengan format persis:
  - **Nama Material** [kode katalog] — stok X unit · Lokasi: Y
  Selalu cantumkan lokasi bila tersedia di data; kalau tidak ada tulis "Lokasi: -".

Sumber: Data WARNOTO per ${now.toLocaleDateString("id-ID")}

---
GLOSARIUM SINGKATAN & ISTILAH MATERIAL PLN (dari CATALOG MASTER PLN — pakai ini untuk
memahami nama material di data di bawah maupun pertanyaan user yang pakai bahasa awam
atau singkatan teknis, mis. user tanya "pemutus" artinya cari "CB"/circuit breaker,
"penangkal petir" artinya "LA"/lightning arrester):
${MATERIAL_GLOSSARY}

---
SNAPSHOT DATA SISTEM SAAT INI:

INVENTORI (${enrichedStocks.length} item total):
Nilai total: Rp ${fmtNum(Math.round(enrichedStocks.reduce((a,s)=>a+(s.qty*s.price),0)))}
Top 20 material by nilai:
${top20.map(s=>`- ${s.name} [${s.katalog}]: ${fmtNum(s.qty)} ${s.unit} | Rp ${fmtNum(Math.round(s.qty*s.price))} | lokasi: ${s.lokasi||"-"}`).join('\n')}

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

    function buildLocalWarehouseAnswer() {
      const normalized = msg.toLowerCase();
      const keywords = normalized
        .replace(/[^a-z0-9\s-]/g," ")
        .split(/\s+/)
        .filter(word=>word.length>=3 && !["berapa","material","gudang","stoknya","tolong","pak","war","yang","untuk","dengan","dari","saat","sekarang","hari","ini"].includes(word));
      const matchedStocks = enrichedStocks.filter(stock=>{
        const haystack = `${stock.name||""} ${stock.katalog||""} ${stock.jenisBarang||""}`.toLowerCase();
        return keywords.length>0 && keywords.some(keyword=>haystack.includes(keyword));
      }).slice(0,8);
      const totalValue = enrichedStocks.reduce((sum,stock)=>sum+(stock.qty*stock.price),0);
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
      if (matchedStocks.length>0) {
        const materialText = matchedStocks.map(stock=>`- **${stock.name}** [${stock.katalog||"-"}] — stok ${fmtNum(stock.qty)} ${stock.unit} · Lokasi: ${stock.lokasi||"-"}`).join("\n");
        return `${localNotice}\n\nBerikut material yang cocok dengan yang Anda tanyakan:\n${materialText}\n\nSebutkan saja bila ada material lain yang mau dicek.`;
      }
      if (/forecast|proyeksi|prediksi|bulan|pemakaian/.test(normalized)) {
        const usageText = topPakai.length===0 ? "Belum ada transaksi pemakaian yang cukup." : topPakai.map(([name,data])=>`- **${name}** — ${fmtNum(data.total)} unit dalam ${data.count} transaksi`).join("\n");
        return `${localNotice}\n\nIni pemakaian material tertinggi dalam 3 bulan terakhir:\n${usageText}\n\nKalau perlu proyeksi lebih rinci, silakan buka menu Forecast Stok.`;
      }
      return `${localNotice}\n\nBerikut ringkasan kondisi gudang saat ini:\n- Total item inventori: ${fmtNum(enrichedStocks.length)}\n- Nilai inventori: Rp ${fmtNum(Math.round(totalValue))}\n- Material kritis: ${fmtNum(kritis.length)}\n- Dokumen pending: ${fmtNum(pending.length)}\n- Rencana kedatangan 30 hari: ${fmtNum(rencana30.length)} item\n\nSebutkan nama atau kode katalog material bila ingin saya tampilkan stok yang lebih spesifik.`;
    }

    try {
      const groqKey = (import.meta.env.VITE_GROQ_API_KEY || "").trim();
      if (!groqKey) throw new Error("Konfigurasi layanan AI belum tersedia.");
      const resp = await fetch("https://api.groq.com/openai/v1/chat/completions",{
        method:"POST",
        headers:{"Content-Type":"application/json","Authorization":`Bearer ${groqKey}`},
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
      const groqKey = (import.meta.env.VITE_GROQ_API_KEY || "").trim();
      const resp = await fetch("https://api.groq.com/openai/v1/chat/completions",{
        method:"POST",
        headers:{"Content-Type":"application/json","Authorization":`Bearer ${groqKey}`},
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
  // RBAC per gudang: untuk user dengan gudang_ids null (semua akun existing) hasil
  // ini identik gudangList — canAccessGudang selalu true, jadi ZERO perubahan perilaku.
  const gudangAccessLimited = allowedGudangIds(currentUser) != null;
  const visibleGudangList = useMemo(() => gudangList.filter(g => canAccessGudang(currentUser, g.id)), [gudangList, currentUser]);
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
  const appUptShortForAdopt = (typeof UPT !== "undefined" ? UPT : "").replace(/^UPT\s+/i,"").trim();
  const currentUserUptId = currentUser?.uptId
    || (ultgList.find(u=>u.id===currentUser?.ultgId)?.parentUptId)
    || (uptList.find(u=>String(u.nama||"").toUpperCase().includes(appUptShortForAdopt.toUpperCase()))?.id);
  const ultgPengajuanUntukAdopt = hasRole(currentUser, "ADMIN","TL") ? txns.filter(t =>
    t.docType==="TUG5" && t.sourceType==="ULTG" && t.stage==="APPROVED_ULTG" && !t.adoptedBy &&
    (currentUser?.role==="SUPERADMIN" || ultgList.find(u=>u.id===t.ultgId)?.parentUptId === currentUserUptId)
  ) : [];
  const pendingTxns = txns.filter(t=>t.status==="PENDING");
  const stockCountPendingCount = stockCountList.reduce((a,s)=>a+s.items.filter(i=>i.approval==="PENDING").length, 0);
  const heavyEquipmentPendingCount = heavyEquipmentLoans.filter(l=>isPendingHeavyEquipmentLoan(l) && canApproveHeavyEquipmentLoan(currentUser, l)).length;
  // Overdue reminder discope ke UPT user sendiri (pemilik ATAU peminjam alat) — sebelumnya
  // dihitung global tanpa filter sama sekali, jadi 1 alat overdue di UPT lain pun ikut muncul
  // sebagai badge di menu Alat Berat untuk SEMUA login, termasuk yang tidak ada urusan sama sekali.
  const myUptForHeavyEquipment = getUserUptScope(currentUser);
  const heavyEquipmentOverdueCount = heavyEquipmentLoans.filter(l=>getHeavyEquipmentLoanRuntimeStatus(l)==="OVERDUE" &&
    (getHeavyEquipmentLoanOwnerUpt(l)===myUptForHeavyEquipment || getHeavyEquipmentLoanRequesterUpt(l)===myUptForHeavyEquipment)).length;
  const attbPendingCount = attbList.filter(a=>isPendingAttbApproval(a) && canApproveAttb(currentUser, a)).length;
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
          foto: si.fotoBarangRetur || si.fotoNameplate || null,
        });
      });
    });
    return items.sort((a,b)=>(b.tanggal||0)-(a.tanggal||0));
  }, [txns, katalogList]);
  // Material kritis AGREGAT per katalog (total semua lokasi ≤ minimum) — dipakai seluruh dashboard.
  const lowStocks = getKritisAgg(enrichedStocks);
  const forecastSoon = getMaterialAkanHabis(enrichedStocks, katalogList, txns, 9999).filter(r=>!r.isKritis && r.estimasiHari!==Infinity && r.estimasiHari<=30);
  const totalVal = enrichedStocks.reduce((a,s)=>a+s.qty*s.price,0);
  const filteredStocks = enrichedStocks.filter(s=>{
    const ms = matchesStockSearch(s, search);
    const mj = filterJenis==="ALL" || s.jenisBarang===filterJenis;
    // RBAC per gudang: sembunyikan stok yang lokasinya milik gudang terlarang.
    // Stok tanpa gudang (belum di-assign) tetap tampil. No-op utk user unrestricted.
    const gid = lokasiList.find(l=>l.id===s.lokasiId)?.gudangId || s.gudangId || null;
    const mg = canAccessGudang(currentUser, gid);
    return ms && mj && mg;
  });
  const stockTotalPages = Math.max(1, Math.ceil(filteredStocks.length / stockPageSize));
  const stockPageClamped = Math.min(stockPage, stockTotalPages);
  const pagedStocks = filteredStocks.slice((stockPageClamped-1)*stockPageSize, stockPageClamped*stockPageSize);
  const filteredKatalog = katalogList.filter(k => matchesKatalogSearch(k, katalogSearch) && (!katalogFilterBelumMara || k.belumDicocokkanMara));
  const katalogTotalPages = Math.max(1, Math.ceil(filteredKatalog.length / katalogPageSize));
  const katalogPageClamped = Math.min(katalogPage, katalogTotalPages);
  const pagedKatalog = filteredKatalog.slice((katalogPageClamped-1)*katalogPageSize, katalogPageClamped*katalogPageSize);
  const filteredTxns = txns.filter(t=> filterStatus==="ALL" || t.status===filterStatus).sort((a,b)=>b.createdAt-a.createdAt);
  const activeTugTxns = tugSubTab==="TUG15" ? [] : txns.filter(t=>t.docType===tugSubTab);
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
      <div style={{background:"white",borderRadius:20,overflow:"hidden",display:"flex",width:isMobile?"100%":720,maxWidth:isMobile?400:720,boxShadow:"0 25px 60px rgba(0,0,0,0.35)"}}>
        {/* KIRI — panel branding (desktop only) */}
        <div style={{display:isMobile?"none":"flex",flexDirection:"column",justifyContent:"center",width:300,flexShrink:0,padding:40,background:"linear-gradient(160deg,#123a7a,#0b2559)",color:"white"}}>
          <div style={{width:76,height:76,background:"white",borderRadius:16,display:"flex",alignItems:"center",justifyContent:"center",marginBottom:22,boxShadow:"0 8px 24px rgba(0,0,0,0.25)",padding:12}}><img src={PLN_LOGO_DATA_URI} alt="Logo PLN" style={{maxWidth:"100%",maxHeight:"100%",objectFit:"contain"}}/></div>
          <div style={{fontSize:34,fontWeight:900,letterSpacing:"1px",lineHeight:1}}>WARNOTO</div>
          <div style={{fontSize:12,color:"rgba(255,255,255,0.75)",fontWeight:600,letterSpacing:1.5,textTransform:"uppercase",margin:"14px 0 6px"}}>{COMPANY}</div>
          <div style={{fontSize:13,color:"rgba(255,255,255,0.6)",lineHeight:1.5}}>{UPT} · {WAREHOUSE}</div>
        </div>
        {/* KANAN — form login */}
        <div style={{flex:1,padding:isMobile?32:40,minWidth:0}}>
          {isMobile && (
            <div style={{textAlign:"center",marginBottom:24}}>
              <div style={{width:72,height:72,background:"white",borderRadius:16,display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 12px",boxShadow:"0 8px 24px rgba(0,0,0,0.10)",border:`1px solid ${C.border}`,padding:12}}><img src={PLN_LOGO_DATA_URI} alt="Logo PLN" style={{maxWidth:"100%",maxHeight:"100%",objectFit:"contain"}}/></div>
              <div style={{fontSize:26,fontWeight:900,color:C.accent,letterSpacing:"1px",lineHeight:1}}>WARNOTO</div>
              <div style={{fontSize:12,color:C.muted,marginTop:6}}>{UPT} · {WAREHOUSE}</div>
            </div>
          )}
          <div style={{fontSize:20,fontWeight:800,color:C.text,marginBottom:4}}>Selamat Datang</div>
          <div style={{fontSize:13,color:C.muted,marginBottom:24}}>Masuk untuk melanjutkan ke sistem.</div>
          <div style={{marginBottom:16}}>
            <label style={sty.label}>Username</label>
            <input style={sty.input} placeholder="Masukkan username..." value={loginForm.username} onChange={e=>setLoginForm(f=>({...f,username:e.target.value}))} onKeyDown={e=>e.key==="Enter"&&handleLogin()} autoFocus/>
          </div>
          <div style={{marginBottom:8}}>
            <label style={sty.label}>Password</label>
            <input style={sty.input} type="password" placeholder="Masukkan password..." value={loginForm.password} onChange={e=>setLoginForm(f=>({...f,password:e.target.value}))} onKeyDown={e=>e.key==="Enter"&&handleLogin()}/>
          </div>
          {loginErr && <div style={{color:C.red,fontSize:12,marginBottom:12,padding:"8px 12px",background:"#fee2e2",borderRadius:8}}>{loginErr}</div>}
          {!supabase && (
            <div style={{fontSize:12,color:"#1d4ed8",background:"#eff6ff",border:"1px solid #bfdbfe",borderRadius:8,padding:"8px 12px",marginBottom:12,lineHeight:1.4}}>
              💡 <b>Mode Lokal / Testing:</b> Supabase belum terhubung di <code>.env</code>. Anda dapat memasukkan username & password apa saja untuk masuk ke mode pengujian lokal.
            </div>
          )}
          <button style={{...sty.btn("primary"),width:"100%",padding:"12px",fontSize:15,marginTop:8,opacity:loginBusy?0.6:1,cursor:loginBusy?"default":"pointer"}} onClick={handleLogin} disabled={loginBusy}>{loginBusy?"Memeriksa...":"Masuk ke Sistem"}</button>
          <div style={{marginTop:16,fontSize:12,color:C.muted,textAlign:"center"}}>Lupa password? Hubungi Admin untuk reset manual.</div>
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
    {id:"rencana",icon:<SidebarIcon name="calendar"/>,label:"Rencana Kedatangan"},
    {id:"forecastStok",icon:<SidebarIcon name="forecast"/>,label:"Forecast Stok"},
    {id:"ai",icon:<SidebarIcon name="ai"/>,label:"Pak War"},
    {id:"maturity",icon:<SidebarIcon name="maturity"/>,label:"Maturity Level"},
    {id:"inspeksiMaterial",icon:<SidebarIcon name="inspeksi"/>,label:"Inspeksi Material"},
  ]).filter(n => can(currentUser, "menu." + n.id, rolePerms)); // RBAC: sembunyikan menu yang izinnya dicabut Admin (default = perilaku existing)

  const sidebarCompact = !isMobile && sidebarCollapsed;
  const masterPageTitle = stockSubTab==="katalog"?"Master Katalog Barang":stockSubTab==="satpam"?"Daftar Satpam":stockSubTab==="timmutu"?"Master Tim Mutu":stockSubTab==="organisasi"?"Struktur Organisasi":stockSubTab==="akun"?"Kelola Akun":stockSubTab==="migrasi"?"Migrasi Data SAP / Non-SAP":stockSubTab==="auditLog"?"Audit Log":stockSubTab==="perms"?"Matrix Izin":"Master Gudang";
  const pageMeta = {
    dashboard: {eyebrow:"Operations Overview",title:hasRole(currentUser,"MANAGER")?"Dashboard Eksekutif":hasRole(currentUser,"ASMAN")?"Dashboard Operasional":"Dashboard Gudang"},
    stock: {eyebrow:"Inventory Control",title:"Data Stok Gudang"},
    master: {eyebrow:"Master Data",title:masterPageTitle},
    transaction: {eyebrow:(TUG_UI[tugSubTab]||{}).code||"TUG",title:(TUG_UI[tugSubTab]||{}).title||"Transaksi TUG"},
    approval: {eyebrow:"Decision Center",title:"Approval"},
    heavyEquipment: {eyebrow:"Fleet Operations",title:"Alat Berat & Peminjaman"},
    attb: {eyebrow:"Asset Disposal Governance",title:"ATTB — Penghapusan Aset"},
    opname: {eyebrow:"Inventory Assurance",title:opnameSubTab==="stockCount"?"Stock Count":"Stock Opname"},
    rencana: {eyebrow:"Inbound Planning",title:"Rencana Kedatangan Barang"},
    kapasitasGudang: {eyebrow:"Warehouse Utilization",title:"Monitoring Kapasitas Gudang"},
    forecastStok: {eyebrow:"Inventory Forecast",title:"Forecast Stok"},
    ai: {eyebrow:"Decision Support",title:"Pak War — Asisten Gudang"},
    maturity: {eyebrow:"Audit & Compliance",title:"Penilaian Maturity Level Gudang"},
    inspeksiMaterial: {eyebrow:"Inventory Health Check",title:"Inspeksi Material Cadang"},
  }[tab] || {eyebrow:"WARNOTO",title:"Dashboard"};

  return (
    <div className="app-shell" data-current-tab={tab} style={{display:"flex",minHeight:"100vh",fontFamily:"'Inter',system-ui,sans-serif",background:C.bg,color:C.text}}>
      {/* Mode demo per-tab: semua penyimpanan (localStorage + Supabase + Storage)
          dibekukan — lihat isDemoMode() di src/lib/demo.js. Banner ini pengingat
          visual bahwa perubahan di tab ini tidak akan tersimpan. */}
      {isDemoMode() && (
        <div className="demo-banner">
          <span>🧪 MODE DEMO — perubahan TIDAK disimpan</span>
          <button onClick={exitDemoMode}>Keluar</button>
        </div>
      )}
      {/* Di HP: toast dipusatkan & dibatasi lebar (bukan nempel kanan tanpa batas
          lebar) supaya pesan panjang tidak terpotong/keluar layar. */}
      {toast && (
        <div style={isMobile
          ? {position:"fixed",top:16,left:16,right:16,zIndex:9999,background:toast.type==="error"?C.red:C.green,color:"white",padding:"12px 16px",borderRadius:10,fontSize:14,fontWeight:600,boxShadow:"0 8px 24px rgba(0,0,0,0.25)",textAlign:"center"}
          : {position:"fixed",top:20,right:20,maxWidth:420,zIndex:9999,background:toast.type==="error"?C.red:C.green,color:"white",padding:"12px 20px",borderRadius:10,fontSize:13,fontWeight:600,boxShadow:"0 8px 24px rgba(0,0,0,0.2)"}
        }>{toast.msg}</div>
      )}
      {savingInfo && (
        <div style={{position:"fixed",inset:0,zIndex:3000,background:"rgba(15,23,42,0.55)",backdropFilter:"blur(2px)",display:"flex",alignItems:"center",justifyContent:"center",padding:20}}>
          <div style={{background:C.surface,borderRadius:16,padding:"28px 32px",width:360,maxWidth:"100%",textAlign:"center",boxShadow:"0 24px 64px rgba(2,6,23,0.35)",borderTop:`4px solid ${C.accent}`}}>
            <div className="txn-spinner" style={{width:44,height:44,margin:"0 auto 16px",border:`4px solid #e2e8f0`,borderTopColor:C.accent,borderRadius:"50%"}}/>
            <div style={{fontSize:14,fontWeight:800,color:C.text,marginBottom:4}}>Menyimpan Transaksi</div>
            <div style={{fontSize:12,color:C.muted,marginBottom:savingInfo.total>0?12:0}}>{savingInfo.label}{savingInfo.total>0?` (${savingInfo.done}/${savingInfo.total})`:""}</div>
            {savingInfo.total>0 && (
              <div style={{height:6,background:"#e2e8f0",borderRadius:999,overflow:"hidden"}}>
                <div style={{height:"100%",width:`${Math.round((savingInfo.done/savingInfo.total)*100)}%`,background:C.accent,borderRadius:999,transition:"width .3s ease"}}/>
              </div>
            )}
            <div style={{fontSize:12,color:C.muted,marginTop:14}}>Mohon tunggu, jangan tutup halaman ini.</div>
          </div>
        </div>
      )}
      {scannerOpen && <BarcodeScanner onDetect={handleScanResult} onClose={()=>setScannerOpen(false)}/>}

      {/* Overlay gelap di belakang drawer sidebar saat dibuka di HP — tap di luar drawer untuk menutup */}
      {isMobile && mobileMenuOpen && (
        <div className="app-sidebar-overlay" onClick={()=>setMobileMenuOpen(false)}/>
      )}

      {/* SIDEBAR — di desktop tetap menempel di kiri; di HP jadi drawer yang slide-in dari kiri,
          disembunyikan (translateX(-100%)) sampai tombol ☰ ditekan. */}
      <aside className={`app-sidebar${sidebarCompact?" is-collapsed":""}${isMobile?" is-mobile":""}${mobileMenuOpen?" is-open":""}`} style={{
        width:isMobile?"min(86vw, 286px)":sidebarCompact?76:260, background:C.sidebar, display:"flex", flexDirection:"column", flexShrink:0,
        ...(isMobile ? {
          position:"fixed", top:0, left:0, bottom:0, zIndex:1500,
          transform:mobileMenuOpen ? "translateX(0)" : "translateX(-100%)",
          boxShadow:"8px 0 32px rgba(0,0,0,0.28)",
        } : {}),
      }} aria-label="Navigasi utama">
        <div className="app-sidebar__header" style={{padding:sidebarCompact?"14px 12px":"14px",borderBottom:"1px solid rgba(255,255,255,0.12)"}}>
          {sidebarCompact ? (
            <button className="app-sidebar__brand-button" onClick={()=>setSidebarCollapsed(false)} title="Buka sidebar" aria-label="Buka sidebar">
              <img src={PLN_LOGO_DATA_URI} alt="Logo PLN"/>
            </button>
          ) : (
          <div style={{display:"flex",alignItems:"center",gap:11,minWidth:0}}>
            <div className="app-sidebar__brand-mark" style={{width:38,height:38,background:"white",borderRadius:9,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,padding:5,boxShadow:"0 2px 8px rgba(0,0,0,0.22)"}}><img src={PLN_LOGO_DATA_URI} alt="Logo PLN" style={{maxWidth:"100%",maxHeight:"100%",objectFit:"contain"}}/></div>
            <div style={{minWidth:0,lineHeight:1.15,flex:1}}>
              <div style={{color:"white",fontWeight:800,fontSize:17,letterSpacing:".5px"}}>WARNOTO</div>
              <div style={{color:"rgba(255,255,255,0.6)",fontSize:12,letterSpacing:".5px",textTransform:"uppercase",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{UPT}</div>
            </div>
            {isMobile && (
            <button
              className="app-sidebar__toggle"
              onClick={()=>setMobileMenuOpen(false)}
              title="Tutup menu"
              aria-label="Tutup menu"
            ><SidebarIcon name="close" size={17}/></button>
            )}
          </div>
          )}
        </div>
        <div className="app-sidebar__nav" style={{flex:1,padding:sidebarCompact?"12px 10px":"12px 9px",overflowY:"auto",overflowX:"hidden"}}>
          {navItems.map(n => {
            if (n.id === "transaction") {
              // TUG item: accordion parent — click expands, sub-items navigate
              const isActive = tab === "transaction";
              return (
                <div key="transaction">
                  <button
                    className={`sidebar-nav-item sidebar-nav-parent${isActive?" is-active":""}`}
                    style={{minHeight:isMobile?44:undefined}}
                    onClick={()=>{ if(sidebarCompact) { setSidebarCollapsed(false); setTugExpanded(true); } else setTugExpanded(e=>!e); }}
                    title={sidebarCompact?n.label:undefined}
                    aria-label={n.label}
                  >
                    <span className="sidebar-nav-item__icon">{n.icon}</span>
                    {!sidebarCompact && <span className="sidebar-nav-item__label">{n.label}</span>}
                    {!sidebarCompact && <span className="sidebar-nav-item__chevron" style={{transform:tugExpanded?"rotate(90deg)":"rotate(0deg)"}}><SidebarIcon name="chevron" size={14}/></span>}
                  </button>
                  {tugExpanded && !sidebarCompact && (
                    <div className="sidebar-subnav" style={{marginBottom:4}}>
                      {(isUltgRole ? [
                        {id:"permintaan",icon:<SidebarIcon name="request" size={16}/>,label:"Minta Barang",defaultSub:"TUG5"},
                      ] : [
                        {id:"penerimaan",icon:<SidebarIcon name="inbound" size={16}/>,label:"Barang Masuk",defaultSub:"TUG3"},
                        {id:"pengeluaran",icon:<SidebarIcon name="outbound" size={16}/>,label:"Barang Keluar",defaultSub:"TUG9"},
                        {id:"permintaan",icon:<SidebarIcon name="request" size={16}/>,label:"Minta Barang",defaultSub:"TUG5"},
                        {id:"laporan",icon:<SidebarIcon name="report" size={16}/>,label:"Laporan",defaultSub:"TUG15"},
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
                    className={`sidebar-nav-item sidebar-nav-parent${isActive?" is-active":""}`}
                    style={{minHeight:isMobile?44:undefined}}
                    onClick={()=>{ if(sidebarCompact) { setSidebarCollapsed(false); setMasterExpanded(true); } else setMasterExpanded(e=>!e); }}
                    title={sidebarCompact?n.label:undefined}
                    aria-label={n.label}
                  >
                    <span className="sidebar-nav-item__icon">{n.icon}</span>
                    {!sidebarCompact && <span className="sidebar-nav-item__label">{n.label}</span>}
                    {!sidebarCompact && <span className="sidebar-nav-item__chevron" style={{transform:masterExpanded?"rotate(90deg)":"rotate(0deg)"}}><SidebarIcon name="chevron" size={14}/></span>}
                  </button>
                  {masterExpanded && !sidebarCompact && (
                    <div className="sidebar-subnav" style={{marginBottom:4}}>
                      {[
                        {id:"katalog",icon:<SidebarIcon name="catalog" size={16}/>,label:"Master Katalog"},
                        {id:"satpam",icon:<SidebarIcon name="shield" size={16}/>,label:"Satpam"},
                        {id:"timmutu",icon:<SidebarIcon name="users" size={16}/>,label:"Tim Mutu"},
                        {id:"organisasi",icon:<SidebarIcon name="organization" size={16}/>,label:"Struktur Organisasi"},
                        {id:"gudang",icon:<SidebarIcon name="warehouse" size={16}/>,label:"Master Gudang"},
        ...(can(currentUser, "aksi.kelolaAkun", rolePerms) ? [{id:"akun",icon:<SidebarIcon name="user" size={16}/>,label:"Kelola Akun"}] : []),
        ...(hasRole(currentUser, "ADMIN") ? [{id:"migrasi",icon:<SidebarIcon name="migrate" size={16}/>,label:"Migrasi Data"},{id:"auditLog",icon:<SidebarIcon name="shield" size={16}/>,label:"Audit Log"},{id:"perms",icon:<SidebarIcon name="shield" size={16}/>,label:"Matrix Izin"}] : []),
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
                    className={`sidebar-nav-item sidebar-nav-parent${isActive?" is-active":""}`}
                    style={{minHeight:isMobile?44:undefined}}
                    onClick={()=>{ if(sidebarCompact) { setSidebarCollapsed(false); setOpnameExpanded(true); } else setOpnameExpanded(e=>!e); }}
                    title={sidebarCompact?n.label:undefined}
                    aria-label={n.label}
                  >
                    <span className="sidebar-nav-item__icon">{n.icon}</span>
                    {!sidebarCompact && <span className="sidebar-nav-item__label">{n.label}</span>}
                    {n.badge>0 && <span className={`sidebar-nav-item__badge${sidebarCompact?" is-compact":""}`}>{n.badge}</span>}
                    {!sidebarCompact && <span className="sidebar-nav-item__chevron" style={{transform:opnameExpanded?"rotate(90deg)":"rotate(0deg)"}}><SidebarIcon name="chevron" size={14}/></span>}
                  </button>
                  {opnameExpanded && !sidebarCompact && (
                    <div className="sidebar-subnav" style={{marginBottom:4}}>
                      {[
                        {id:"opname",icon:<SidebarIcon name="opname" size={16}/>,label:"Stock Opname"},
                        {id:"stockCount",icon:<SidebarIcon name="report" size={16}/>,label:"Stock Count",badge:stockCountPendingCount},
                      ].map(sub=>{
                        const subActive = isActive && opnameSubTab===sub.id;
                        return (
                          <button
                            key={sub.id}
                            style={{display:"flex",alignItems:"center",gap:8,width:"100%",padding:"7px 12px 7px 32px",minHeight:isMobile?44:undefined,borderRadius:8,border:"none",cursor:"pointer",background:subActive?"rgba(255,255,255,0.12)":"transparent",color:subActive?"white":"rgba(255,255,255,0.55)",fontSize:12,fontWeight:subActive?700:400,marginBottom:1,textAlign:"left",borderLeft:subActive?"2px solid rgba(255,255,255,0.4)":"2px solid transparent"}}
                            onClick={()=>{setTab("opname"); setOpnameSubTab(sub.id); setMobileMenuOpen(false);}}
                          >
                            <span>{sub.icon}</span> {sub.label} {sub.badge>0 && <span style={{background:"#dc2626",color:"white",borderRadius:20,padding:"1px 6px",fontSize:12,fontWeight:800,marginLeft:4}}>{sub.badge}</span>}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            }
            return (
              <SidebarNavItem
                key={n.id}
                item={n}
                active={tab===n.id}
                isMobile={isMobile}
                collapsed={sidebarCompact}
                onClick={()=>{setTab(n.id); if(n.id!=="transaction") setTugExpanded(false); if(n.id!=="master") setMasterExpanded(false); if(n.id!=="opname") setOpnameExpanded(false); setMobileMenuOpen(false);}}
              />
            );
          })}
        </div>
        {!isMobile && (
          <div className="app-sidebar__footer">
            <button
              className="app-sidebar__footer-toggle"
              onClick={()=>setSidebarCollapsed(v=>!v)}
              title={sidebarCompact?"Buka sidebar":"Sembunyikan menu"}
              aria-label={sidebarCompact?"Buka sidebar":"Sembunyikan menu"}
            >
              <SidebarIcon name={sidebarCompact?"expand":"collapse"} size={16}/>
            </button>
          </div>
        )}
        <div className="app-sidebar__cloud" style={{padding:sidebarCompact?"10px":"8px 16px",borderTop:"1px solid rgba(255,255,255,0.1)",fontSize:12,color:"rgba(255,255,255,0.58)"}} title={sidebarCompact?(cloudSaving?"Menyimpan...":dataRefreshing?"Menyinkronkan data...":lastSaved?"Tersimpan":"Cloud Storage Aktif"):undefined}>
          <SidebarIcon name="cloud" size={16}/>
          {!sidebarCompact && <span>{cloudSaving ? "Menyimpan..." : dataRefreshing ? "Menyinkronkan data..." : lastSaved ? "Tersimpan" : "Cloud Storage Aktif"}</span>}
        </div>

      </aside>

      {/* MAIN */}
      <main className="app-main" style={{flex:1,overflowY:"auto",width:isMobile?"100%":"auto",minWidth:0}}>
          <header className="app-workspace-bar">
            {isMobile && (
            <button
              className="app-workspace-bar__menu"
              onClick={()=>setMobileMenuOpen(true)}
              aria-label="Buka menu"
            ><SidebarIcon name="menu" size={20}/></button>
            )}
            <div className="app-workspace-bar__title">
              <span>{pageMeta.eyebrow}</span>
              <strong>{pageMeta.title}</strong>
            </div>
            <div className="app-account" ref={accountMenuRef}>
              <button className={`theme-switch${theme==="dark"?" is-dark":""}`} onClick={()=>setTheme(t=>t==="dark"?"light":"dark")} role="switch" aria-checked={theme==="dark"} aria-label="Mode gelap" title={theme==="dark"?"Mode Terang":"Mode Gelap"}>
                <span className="theme-switch__knob" aria-hidden="true">{theme==="dark"?"🌙":"☀️"}</span>
              </button>
              <button className="app-account__trigger" onClick={()=>setAccountMenuOpen(open=>!open)} aria-expanded={accountMenuOpen} aria-haspopup="menu">
                <span className="app-account__avatar">{currentUser.avatar || currentUser.name?.slice(0,2).toUpperCase()}</span>
                <span className="app-account__identity">
                  <small>{UPT}</small>
                  <strong>{currentUser.name || "Fajar Sutomo"}</strong>
                </span>
                <span className={`app-account__chevron${accountMenuOpen?" is-open":""}`}><SidebarIcon name="chevron" size={14}/></span>
              </button>
              {accountMenuOpen && (
                <div className="app-account__menu" role="menu">
                  <div className="app-account__profile">
                    <span className="app-account__avatar is-large">{currentUser.avatar || currentUser.name?.slice(0,2).toUpperCase()}</span>
                    <div><strong>{currentUser.name || "Fajar Sutomo"}</strong><span>{ROLES[currentUser.role]}</span></div>
                  </div>
                  <div className="app-account__unit">{UPT}</div>
                  <button role="menuitem" onClick={()=>{setAccountMenuOpen(false);openGantiPassword();}}><SidebarIcon name="key" size={17}/><span>Ganti Password</span></button>
                  <button role="menuitem" onClick={()=>{setAccountMenuOpen(false);isDemoMode()?exitDemoMode():enterDemoMode();}}><span aria-hidden="true">🧪</span><span>{isDemoMode()?"Keluar Mode Demo":"Mode Demo (TUG)"}</span></button>
                  {/* Menu SENGAJA tidak ditutup di sini: dibiarkan terbuka supaya label "Keluar..." + disabled
                      terlihat selama signOut() berjalan (bisa lambat di server self-host). Saat logout sukses
                      seluruh header unmount ke form login; kalau gagal, finally di handleLogout mengaktifkan tombol lagi. */}
                  <button role="menuitem" className="is-danger" disabled={loggingOut} onClick={()=>handleLogout()}><SidebarIcon name="logout" size={17}/><span>{loggingOut?"Keluar...":"Logout"}</span></button>
                </div>
              )}
            </div>
          </header>

        <div className="app-content" style={{padding:isMobile?16:"clamp(18px, 2vw, 30px)"}}>

        {/* DASHBOARD */}
        {tab==="dashboard" && (
          <div className="dashboard-command">
            <DashboardMaturityBanner
              maturity={maturityAssessments[0]||null}
              levelLabel={maturityAssessments[0]?MATURITY_LEVELS[maturityAssessments[0].level]:""}
              warehouse={WAREHOUSE}
              canAssess={hasRole(currentUser,"ADMIN")}
              formatDate={fmtDate}
              onAssess={()=>{const latest=maturityAssessments[0];setMaturityForm({level:latest?.level||3,catatan:"",tanggalAsesmen:Date.now()});setMaturityModal(true);}}
            />
            <div className="dashboard-mode-switch" role="tablist" aria-label="Tampilan dashboard">
              {[{id:"ringkasan",label:"Ringkasan & Kinerja",caption:"KPI, peta, dan prioritas"},{id:"detail",label:"Overview Gudang",caption:"Stok dan aktivitas operasional"}].map(item=>(
                <button key={item.id} className={dashTab===item.id?"is-active":""} onClick={()=>setDashTab(item.id)} role="tab" aria-selected={dashTab===item.id}>
                  <strong>{item.label}</strong><span>{item.caption}</span>
                </button>
              ))}
            </div>
          </div>
        )}
        {tab==="dashboard" && hasRole(currentUser, "MANAGER") && (
          <>
          {dashTab==="ringkasan" ? (
            <ExecOverview totalVal={totalVal} kritisMaterials={lowStocks} forecastSoon={forecastSoon} approvalCount={myPendingApprovals.length} stockCountPendingCount={stockCountPendingCount} attbActionCount={attbPendingCount+attbBelumLanjutCount} akurasi={stockCountList[0]?.summary?.akuratPct ?? null} maturity={maturityAssessments[0]||null} setTab={setTab} setOpnameSubTab={setOpnameSubTab} C={C} sty={sty} isMobile={isMobile}/>
          ) : (
          <DashboardManager
            stocks={enrichedStocks} txns={txns} katalogList={katalogList}
            uptList={uptList} rencanaKedatanganList={rencanaKedatanganList}
            myPendingApprovals={myPendingApprovals}
            topN={topN} setTopN={setTopN}
            pemakaianMode={pemakaianMode} setPemakaianMode={setPemakaianMode}
            C={C} sty={sty} setTab={setTab}
            heavyEquipmentList={heavyEquipmentList} heavyEquipmentLoans={heavyEquipmentLoans}
            currentUser={currentUser}
            attbList={attbList} attbBongkaranPool={attbBongkaranPool}
            isMobile={isMobile}
          />
          )}
          </>
        )}
        {tab==="dashboard" && hasRole(currentUser, "ASMAN") && !hasRole(currentUser, "MANAGER") && (
          <>
          {dashTab==="ringkasan" ? (
            <ExecOverview totalVal={totalVal} kritisMaterials={lowStocks} forecastSoon={forecastSoon} approvalCount={myPendingApprovals.length} stockCountPendingCount={stockCountPendingCount} attbActionCount={attbPendingCount+attbBelumLanjutCount} akurasi={stockCountList[0]?.summary?.akuratPct ?? null} maturity={maturityAssessments[0]||null} setTab={setTab} setOpnameSubTab={setOpnameSubTab} C={C} sty={sty} isMobile={isMobile}/>
          ) : (
          <DashboardAsman
            stocks={enrichedStocks} txns={txns} katalogList={katalogList}
            rencanaKedatanganList={rencanaKedatanganList}
            myPendingApprovals={myPendingApprovals}
            topN={topN} setTopN={setTopN}
            pemakaianMode={pemakaianMode} setPemakaianMode={setPemakaianMode}
            C={C} sty={sty} setTab={setTab}
            heavyEquipmentList={heavyEquipmentList} heavyEquipmentLoans={heavyEquipmentLoans}
            currentUser={currentUser}
            attbList={attbList} attbBongkaranPool={attbBongkaranPool}
            isMobile={isMobile}
          />
          )}
          </>
        )}
        {tab==="dashboard" && !hasRole(currentUser, "MANAGER","ASMAN") && (
          <>
          {dashTab==="ringkasan" && (
            <ExecOverview totalVal={totalVal} kritisMaterials={lowStocks} forecastSoon={forecastSoon} approvalCount={myPendingApprovals.length} stockCountPendingCount={stockCountPendingCount} attbActionCount={attbPendingCount+attbBelumLanjutCount} akurasi={stockCountList[0]?.summary?.akuratPct ?? null} maturity={maturityAssessments[0]||null} setTab={setTab} setOpnameSubTab={setOpnameSubTab} C={C} sty={sty} isMobile={isMobile}/>
          )}

          {dashTab==="detail" && (
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
            attbList={attbList} attbBongkaranPool={attbBongkaranPool}
          />
          )}
        </>
        )}

        {tab==="dashboard" && dashTab==="ringkasan" && (
          <div className="dashboard-insight-grid">
            <section className="dashboard-insight-card dashboard-map-card">
              <div className="dashboard-insight-card__header">
                <div>
                  <strong>Peta Wilayah Gudang UPT Surabaya</strong>
                  <span>{gudangList.filter(g=>g.lat!=null&&g.lng!=null).length} dari {gudangList.length} gudang memiliki koordinat GPS</span>
                </div>
                <span className="dashboard-insight-card__badge">Peta operasional</span>
              </div>
              <div ref={petaWilayahDivRef} className="dashboard-map-canvas"/>
              {gudangList.filter(g=>g.lat==null||g.lng==null).length>0 && hasRole(currentUser, "ADMIN") && (
                <div className="dashboard-insight-card__notice">Ada gudang yang belum memiliki koordinat GPS. Lengkapi melalui Master Data.</div>
              )}
            </section>

            {(()=>{
              const latest = stockCountList[0];
              return (
                <section className="dashboard-insight-card dashboard-performance-card">
                  <div className="dashboard-insight-card__header">
                    <div>
                      <strong>Kinerja Stock Count</strong>
                      <span>Perbandingan SAP dan stok aplikasi</span>
                    </div>
                    <button className="dashboard-text-action" onClick={()=>{setTab("opname");setOpnameSubTab("stockCount");}}>Lihat detail</button>
                  </div>
                  {!latest ? (
                    <div className="dashboard-performance-empty">Belum ada sesi Stock Count. Jalankan unggah CSV SAP dari menu Stock Count.</div>
                  ) : (
                    <>
                      <div className="dashboard-performance-score">
                        <strong style={{color:latest.summary.akuratPct>=90?C.green:latest.summary.akuratPct>=70?C.yellow:C.red}}>{latest.summary.akuratPct}%</strong>
                        <span>Akurasi sesi terakhir</span>
                      </div>
                      <div className="dashboard-performance-meta">
                        <div><strong>{latest.summary.akuratCount}</strong><span>Item akurat</span></div>
                        <div><strong>{latest.summary.totalItem}</strong><span>Total item</span></div>
                        <div><strong>{fmtDate(latest.uploadedAt)}</strong><span>Tanggal sesi</span></div>
                      </div>
                      {latest.items.some(i=>i.approval==="PENDING") && (
                        <div className="dashboard-insight-card__notice">{latest.items.filter(i=>i.approval==="PENDING").length} temuan menunggu approval Asman.</div>
                      )}
                    </>
                  )}
                </section>
              );
            })()}
          </div>
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
                openScanner={openScanner}
                showToast={showToast}
                gudangList={gudangList}
                lokasiList={lokasiList}
                addNonStockFoundItem={addNonStockFoundItem}
                isMobile={isMobile}
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
            gudangCapacityList={visibleCapacityList}
            gudangCapacityImports={gudangCapacityImports}
            gudangList={visibleGudangList}
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
            sty={sty} C={C} isMobile={isMobile}
            saveRencana={saveRencana}
            deleteRencana={deleteRencana}
            aiExtractKontrak={aiExtractKontrak}
          />
        )}

        {/* STOCK */}
        {/* DATA STOK — view of operational stock (read-focused, with admin edit) */}
        {tab==="stock" && (
          <div className="workspace-page stock-page">
            <div className="workspace-filter-panel">
              <div style={{display:"flex",gap:8,alignItems:"stretch"}}>
                <div style={{position:"relative",flex:1}}>
                  <input style={{...sty.input,paddingRight:32}} placeholder="🔍 Cari nama, kode, no. katalog, lokasi..." value={search} onChange={e=>setSearch(e.target.value)}/>
                  {search && (
                    <button
                      onClick={()=>setSearch("")}
                      title="Hapus pencarian"
                      style={{position:"absolute",right:6,top:"50%",transform:"translateY(-50%)",background:"transparent",border:"none",cursor:"pointer",fontSize:14,color:C.muted,padding:4,lineHeight:1}}
                    >✕</button>
                  )}
                </div>
                <button type="button" title="Cari barang berdasarkan foto" onClick={()=>{setPhotoSearchImg(null);setPhotoSearchOpen(true);}}
                  style={{...sty.btn("primary"),whiteSpace:"nowrap",display:"flex",alignItems:"center",gap:6}}>
                  📷{!isMobile && <span>Cari Foto</span>}
                </button>
              </div>
              <select style={{...sty.select,maxWidth:280}} value={filterJenis} onChange={e=>setFilterJenis(e.target.value)}>
                <option value="ALL">Semua Jenis</option>{JENIS_BARANG.map(j=><option key={j}>{j}</option>)}
              </select>
              <div className="workspace-context-row">
                <span><strong>{filteredStocks.length}</strong> baris stok</span>
                <span>Barang × lokasi</span>
                {stocks.filter(s=>!s.lokasiId).length>0 && <span className="is-warning">{stocks.filter(s=>!s.lokasiId).length} material belum memiliki lokasi</span>}
              </div>
              {photoSearchResults && (
                <div style={{...sty.card,padding:12}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                    <div style={{fontWeight:800,fontSize:13}}>{photoSearchResultMode==="nameplate"?"🔖":"📷"} Hasil pencarian foto — {photoSearchResults.length} barang {photoSearchResultMode==="nameplate"?"cocok":"mirip"}</div>
                    <button style={sty.btn("ghost","sm")} onClick={()=>setPhotoSearchResults(null)}>✕ Reset</button>
                  </div>
                  {photoSearchResultMode==="nameplate" && photoSearchOcrText && (
                    <div style={{fontSize:12,color:C.muted,background:"#f8fafc",border:`1px solid ${C.border}`,borderRadius:6,padding:"6px 8px",marginBottom:10,whiteSpace:"pre-wrap",maxHeight:60,overflowY:"auto"}}>
                      <b>Teks nameplate terbaca:</b> {photoSearchOcrText}
                    </div>
                  )}
                  {photoSearchResults.length===0 ? (
                    <div style={{fontSize:12,color:C.muted}}>{photoSearchResultMode==="nameplate"?"Tidak ada katalog yang cocok dengan teks nameplate. Pastikan nomor katalog/type terbaca jelas, atau coba foto lebih dekat & fokus.":"Tidak ada barang dengan kemiripan ≥75%. Coba foto lain atau sudut/pencahayaan berbeda."}</div>
                  ) : (
                    <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"repeat(auto-fill,minmax(220px,1fr))",gap:10}}>
                      {photoSearchResults.map(r=>{
                        const est = enrichedStocks.find(s=>String(s.katalog)===String(r.katalog));
                        const thumb = est?.fotoKeseluruhan || est?.img;
                        const pct = Math.round((r.similarity||0)*100);
                        return (
                          <div key={r.katalog} onClick={()=>est&&setStockDetailId(est.id)} style={{border:`1px solid ${C.border}`,borderRadius:10,padding:10,cursor:est?"pointer":"default",display:"flex",gap:10,alignItems:"center",background:C.surface}}>
                            {thumb ? <img src={thumb} alt="" style={{width:54,height:54,objectFit:"cover",borderRadius:8,flexShrink:0,border:`1px solid ${C.border}`}}/> : <div style={{width:54,height:54,borderRadius:8,background:"#eff6ff",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>📦</div>}
                            <div style={{minWidth:0,flex:1}}>
                              <div style={{fontWeight:700,fontSize:12,color:C.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{est?.name||"(tidak ada di Data Stok)"}</div>
                              <div style={{fontSize:12,color:"#0098da",fontWeight:700}}>📑 {r.katalog}</div>
                              <div style={{fontSize:12,fontWeight:800,color:pct>=80?C.green:pct>=70?"#d97706":C.muted,marginTop:2}}>{pct}% {photoSearchResultMode==="nameplate"?"cocok":"mirip"}</div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
            {katalogList.length===0 && (
              <div style={{...sty.card,textAlign:"center",color:C.muted,padding:20,marginBottom:16}}>
                ℹ️ Belum ada Master Katalog. Tambahkan jenis barang dulu di menu "Master Data" → "Master Katalog" sebelum membuat Data Stok.
              </div>
            )}
            {/* Tampilan tabel horizontal (data & fungsi tidak berubah, cuma cara
                merendernya — semua handler/state sama persis dengan versi kartu
                sebelumnya). */}
            <div className="mobile-card-table stock-card-table" style={{...sty.card,padding:0,overflowX:"auto"}}>
              <table style={{width:"100%",borderCollapse:"collapse",fontSize:12,minWidth:980}}>
                <thead>
                  <tr style={{background:C.sidebar,color:"white"}}>
                    {["Foto","Nama Barang","Kategori","Qty","Gudang","Blok","Harga","Status","Aksi"].map(h=>(
                      <th key={h} style={{padding:"9px 10px",textAlign:h==="Aksi"||h==="Foto"?"center":"left",whiteSpace:"nowrap",fontSize:12}}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {pagedStocks.map(st=>{
                    const isLow = st.jenisBarang!=="Non-Stock" && st.qty<=st.minQty;
                    const noLokasi = !st.lokasiId;
                    const lok = lokasiList.find(l=>l.id===st.lokasiId);
                    // Fallback ke st.gudangId (declared, independen dari Blok) kalau belum ada Blok
                    // tersimpan — ditemukan 2026-07-10 (sama seperti bug ATTB): kalau Gudang yang
                    // dipilih ternyata tidak punya Blok terdaftar sama sekali, dropdown Blok kosong dan
                    // pilihan Gudang (yang tadinya cuma filter lokal, tidak pernah disimpan) hilang lagi
                    // tiap render ulang. Sekarang gudangId disimpan langsung ke stok begitu dipilih.
                    const gdg = lok?.gudangId ? gudangList.find(g=>g.id===lok.gudangId) : (st.gudangId ? gudangList.find(g=>g.id===st.gudangId) : null);
                    const effGudangIdForBlok = stockGudangFilter[st.id] ?? st.gudangId ?? gdg?.id ?? "";
                    const blokOptionsForStock = lokasiList.filter(l=>l.gudangId===effGudangIdForBlok);
                    const petaInfo = getLokasiPetaInfo(lok, gdg, subGudangList);
                    const canLihatPeta = !!petaInfo;
                    const hasDenah = !!(gdg?.denahImageData || (lok?.subGudangId && subGudangList.find(s=>s.id===lok.subGudangId)?.denahImageData));
                    return (
                      <tr className="mobile-card-table__row" key={st.id} onClick={()=>{setPendingFoto({}); setStockDetailId(st.id);}} style={{cursor:"pointer",background:st.deletePending?"#fef2f2":undefined,borderBottom:`1px solid ${C.border}`,borderLeft:`3px ${st.deletePending?"dashed #dc2626":"solid"} ${st.deletePending?"#dc2626":noLokasi?"#f59e0b":isLow?C.red:st.jenisBarang==="Non-Stock"?"#be185d":C.green}`}}>
                        <td className="mobile-card-table__photo" data-label="Foto" onClick={e=>{ if(st.fotoKeseluruhan){e.stopPropagation(); setLightboxImg(st.fotoKeseluruhan);} }} style={{padding:"8px 10px",textAlign:"center",cursor:st.fotoKeseluruhan?"zoom-in":"default"}}>
                          {st.fotoKeseluruhan ? <img src={st.fotoKeseluruhan} alt={st.name} style={{width:48,height:48,borderRadius:6,objectFit:"cover",border:`1px solid ${C.border}`}}/>
                            : <div style={{width:48,height:48,background:"#eff6ff",borderRadius:6,display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,border:`1px solid #bfdbfe`,margin:"0 auto"}}>📦</div>}
                        </td>
                        <td className="mobile-card-table__title" data-label="Nama Barang" style={{padding:"8px 10px",minWidth:200}}>
                          <div style={{fontWeight:700,color:C.text}}>{st.name}</div>
                          <div style={{fontSize:12,color:"#0098da",fontWeight:700,marginTop:1}}>📑 {st.katalog||"-"}</div>
                          {st.deletePending && <div style={{fontSize:12,color:"#dc2626",fontWeight:700,marginTop:2}}>⏳ Menunggu approval Hapus</div>}
                          {st.editPending && <div style={{fontSize:12,color:"#92400e",fontWeight:700,marginTop:2}}>⏳ Ada perubahan menunggu approval TL</div>}
                        </td>
                        <td data-label="Kategori" style={{padding:"8px 10px"}}>
                          <div style={{display:"flex",gap:4,flexWrap:"wrap",maxWidth:160}}>
                            <span style={sty.jenisBadge(st.jenisBarang)}>{st.jenisBarang}</span>
                            <span style={{padding:"2px 7px",borderRadius:20,fontSize:12,background:"#f3f4f6",color:C.muted}}>{st.category}</span>
                          </div>
                        </td>
                        <td data-label="Qty" style={{padding:"8px 10px",whiteSpace:"nowrap"}}>
                          {st.jenisBarang==="Non-Stock"
                            ? <span style={{color:C.muted}}>Project-Based</span>
                            : <div>
                                <span style={{fontWeight:700,color:isLow?C.red:C.green}}>{fmtNum(st.qty)} {st.unit}</span>
                                <div style={{fontSize:12,color:C.muted}}>Min {fmtNum(st.minQty)} {st.unit}</div>
                              </div>}
                          {isLow && <div style={{fontSize:12,color:C.red,fontWeight:700,marginTop:2}}>⚠️ Stok kritis</div>}
                        </td>
                        <td data-label="Gudang" onClick={e=>e.stopPropagation()} style={{padding:"8px 10px",minWidth:120}}>
                          {hasRole(currentUser, "ADMIN","TL") ? (
                            <select
                              value={stockGudangFilter[st.id] ?? st.gudangId ?? gdg?.id ?? ""}
                              style={{...sty.select,fontSize:12,paddingTop:5,paddingBottom:5,paddingLeft:8,paddingRight:8}}
                              onChange={async e=>{
                                const v = e.target.value;
                                setStockGudangFilter(prev=>({...prev,[st.id]:v}));
                                // Simpan langsung (bukan cuma filter lokal) supaya tidak hilang kalau
                                // Gudang ini ternyata tidak punya Blok terdaftar sama sekali.
                                const ns = stocks.map(s=>s.id===st.id?{...s, gudangId: v||null}:s);
                                setStocks(ns);
                                await saveToCloud({stocks:ns}, {stocksChangedRows: ns.filter(s=>s.id===st.id)});
                              }}>
                              <option value="">-- Pilih Gudang --</option>
                              {visibleGudangList.map(g=><option key={g.id} value={g.id}>{g.kode||g.nama}</option>)}
                            </select>
                          ) : (
                            <span style={{color:C.text}}>{gdg?.kode||gdg?.nama||"—"}</span>
                          )}
                        </td>
                        <td data-label="Blok" onClick={e=>e.stopPropagation()} style={{padding:"8px 10px",minWidth:150}}>
                          {hasRole(currentUser, "ADMIN") ? (
                            <>
                              <select
                                value={st.lokasiId||""}
                                disabled={st.lokasiMovePending}
                                style={{...sty.select,fontSize:12,paddingTop:5,paddingBottom:5,paddingLeft:8,paddingRight:8,border:`1px solid ${noLokasi?"#f59e0b":C.border}`,background:st.lokasiMovePending?"#f3f4f6":noLokasi?"#fffbeb":"#f9fafb"}}
                                onChange={async e=>{
                                  const newLokasiId = e.target.value;
                                  const lokSel = lokasiList.find(l=>l.id===newLokasiId);
                                  // BUG DITEMUKAN 2026-07-04: kalau baris ini belum punya lokasi sama
                                  // sekali (lok undefined, mis. baris hasil "Kosongkan" dari Migrasi
                                  // Data), lok?.gudangId jadi undefined -> null, dan gudangId lokasi
                                  // manapun yang dipilih Admin PASTI beda dari null -> pindahGudang
                                  // SELALU true, jadi pengisian PERTAMA KALI ke baris kosong dianggap
                                  // "pindah gudang" dan wajib approval TL — padahal tidak ada gudang
                                  // lama yang benar-benar dipindah dari mana pun. Fix: hanya anggap
                                  // "pindah gudang" (butuh approval) kalau memang SUDAH ada lokasi
                                  // sebelumnya (lok ada isinya).
                                  const pindahGudang = !!lok && (lokSel?.gudangId||null) !== (lok?.gudangId||null);
                                  let updated, msg;
                                  if (pindahGudang) {
                                    // Pindah ke Gudang lain wajib approval TL.
                                    updated = {...st, lokasiMovePending:true, lokasiMoveApprover:"TL", pendingLokasiId:newLokasiId, pendingLokasiKode:lokSel?.kode||"-", moveRequestedBy:currentUser.id, moveRequestedAt:Date.now()};
                                    msg = `📨 Pemindahan ${st.name} ke Gudang lain (${lokSel?.kode||"-"}) diajukan! Menunggu approval TL.`;
                                  } else {
                                    // Pindah blok dalam Gudang yang sama: Admin langsung, tanpa approval.
                                    updated = {...st, lokasiId:newLokasiId, lokasi:lokSel?.kode||"-", lokasiMovePending:false, lokasiMoveApprover:null, pendingLokasiId:null, pendingLokasiKode:null};
                                    msg = `📍 Blok ${st.name} → ${lokSel?.kode||"-"}`;
                                  }
                                  const ns = stocks.map(s=>s.id===st.id?updated:s);
                                  setStocks(ns);
                                  // Update lokasi/blok 1 barang — cuma baris ini yang berubah (sync ringan, bukan 212 baris ~18.7MB).
                                  await saveToCloud({stocks:ns}, {stocksChangedRows: [updated]});
                                  showToast(msg);
                                }}>
                                <option value="">-- Pilih Blok --</option>
                                {blokOptionsForStock.map(l=><option key={l.id} value={l.id}>{l.kode}{l.nama?" — "+l.nama:""}</option>)}
                              </select>
                              {effGudangIdForBlok && blokOptionsForStock.length===0 && <div style={{fontSize:12,color:"#b45309",fontStyle:"italic",marginTop:2}}>⚠️ Belum ada Blok terdaftar di Gudang ini — pilihan Gudang tetap tersimpan.</div>}
                              {st.lokasiMovePending && <div style={{fontSize:12,color:"#92400e",fontWeight:700,marginTop:2}}>⏳ Menunggu approval {st.lokasiMoveApprover||"TL"} → {st.pendingLokasiKode}</div>}
                            </>
                          ) : hasRole(currentUser, "TL") ? (
                            <>
                              <select
                                value={st.lokasiId||""}
                                disabled={st.lokasiMovePending}
                                style={{...sty.select,fontSize:12,paddingTop:5,paddingBottom:5,paddingLeft:8,paddingRight:8,border:`1px solid ${noLokasi?"#f59e0b":C.border}`,background:st.lokasiMovePending?"#f3f4f6":noLokasi?"#fffbeb":"#f9fafb"}}
                                onChange={async e=>{
                                  const newLokasiId = e.target.value;
                                  const lokSel = lokasiList.find(l=>l.id===newLokasiId);
                                  // TL yang pindahkan stok yang SUDAH punya lokasi ke Gudang lain wajib
                                  // approval Asman (TL sendiri yang biasanya approve pemindahan Admin,
                                  // jadi pemindahan lintas Gudang oleh TL butuh persetujuan Asman UPT).
                                  // Isi lokasi PERTAMA KALI (lok kosong) tetap langsung tanpa approval,
                                  // sama seperti pindah blok dalam Gudang yang sama.
                                  const pindahGudang = !!lok && (lokSel?.gudangId||null) !== (lok?.gudangId||null);
                                  let updated, msg;
                                  if (pindahGudang) {
                                    updated = {...st, lokasiMovePending:true, lokasiMoveApprover:"ASMAN", pendingLokasiId:newLokasiId, pendingLokasiKode:lokSel?.kode||"-", moveRequestedBy:currentUser.id, moveRequestedAt:Date.now()};
                                    msg = `📨 Pemindahan ${st.name} ke Gudang lain (${lokSel?.kode||"-"}) diajukan! Menunggu approval Asman.`;
                                  } else {
                                    updated = {...st, lokasiId:newLokasiId, lokasi:lokSel?.kode||"-", lokasiMovePending:false, lokasiMoveApprover:null, pendingLokasiId:null, pendingLokasiKode:null};
                                    msg = `📍 Blok ${st.name} → ${lokSel?.kode||"-"}`;
                                  }
                                  const ns = stocks.map(s=>s.id===st.id?updated:s);
                                  setStocks(ns);
                                  // Update lokasi/blok 1 barang — cuma baris ini yang berubah (sync ringan, bukan 212 baris ~18.7MB).
                                  await saveToCloud({stocks:ns}, {stocksChangedRows: [updated]});
                                  showToast(msg);
                                }}>
                                <option value="">-- Pilih Blok --</option>
                                {blokOptionsForStock.map(l=><option key={l.id} value={l.id}>{l.kode}{l.nama?" — "+l.nama:""}</option>)}
                              </select>
                              {effGudangIdForBlok && blokOptionsForStock.length===0 && <div style={{fontSize:12,color:"#b45309",fontStyle:"italic",marginTop:2}}>⚠️ Belum ada Blok terdaftar di Gudang ini — pilihan Gudang tetap tersimpan.</div>}
                              {st.lokasiMovePending && <div style={{fontSize:12,color:"#92400e",fontWeight:700,marginTop:2}}>⏳ Menunggu approval {st.lokasiMoveApprover||"Asman"} → {st.pendingLokasiKode}</div>}
                            </>
                          ) : (
                            <span style={{color:noLokasi?"#f59e0b":C.text,fontWeight:noLokasi?700:400}}>{noLokasi?"⚠️ Belum diisi":st.lokasi||"—"}</span>
                          )}
                        </td>
                        <td data-label="Harga" style={{padding:"8px 10px",whiteSpace:"nowrap"}}>Rp {fmtNum(st.price)}</td>
                        <td data-label="Status" style={{padding:"8px 10px"}}>
                          {(()=>{const bs=getSAPBadgeStyle(st.katalog);return <span style={{padding:"2px 7px",borderRadius:20,fontSize:12,fontWeight:700,background:bs.bg,color:bs.fg,whiteSpace:"nowrap"}}>{getSAPLabel(st.katalog)}</span>})()}
                        </td>
                        <td data-label="Aksi" onClick={e=>e.stopPropagation()} style={{padding:"8px 10px"}}>
                          <div className="table-actions">
                            {hasRole(currentUser, "ADMIN") && (
                              <>
                                <button className="table-action-button" title="Edit data stok" disabled={st.deletePending} onClick={()=>openEditStock(st)}>Edit</button>
                                <button className="table-action-button is-danger" title="Hapus data stok" disabled={st.deletePending} onClick={()=>deleteStock(st.id)}>Hapus</button>
                              </>
                            )}
                            <button className="table-action-button is-icon" title="Kartu Gantung TUG-2"
                              onClick={()=>{const k=katalogList.find(x=>x.id===st.katalogId); if(k) setKartuGantungDetail(k);}}>🏷</button>
                            <button
                              className="table-action-button is-icon"
                              title={canLihatPeta ? "Lihat di Peta Gudang" : !lok ? "Blok belum diisi" : !hasDenah ? "Denah belum diupload (Master Data → Master Gudang)" : "Blok ini belum diplot koordinatnya di denah"}
                              style={{color:canLihatPeta?"#dc2626":C.muted,opacity:canLihatPeta?1:0.5}}
                              onClick={()=>{
                                if (canLihatPeta) { setPetaMiniDetail({stock:st, lokasi:lok, gudang:gdg, petaInfo}); return; }
                                if (!lok) { showToast("Blok/Lokasi belum diisi untuk material ini.","error"); return; }
                                if (!hasDenah) { showToast(`Denah "${gdg?.nama||lok?.kode||"-"}" belum diupload. Upload di Master Data → Master Gudang.`,"error"); return; }
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
          <div className={`workspace-page master-page master-page--${stockSubTab}`}>
            <div className="workspace-page-toolbar">
              <div className="workspace-context-row">
                <span>
                  {stockSubTab==="katalog"?`${filteredKatalog.length} jenis barang terdaftar`:stockSubTab==="satpam"?`${satpamList.length} satpam terdaftar`:stockSubTab==="timmutu"?`${timMutuList.length} paket tim mutu`:stockSubTab==="organisasi"?`${uitList.length} UIT • ${uptList.length} UPT • ${ultgList.length} ULTG`:stockSubTab==="akun"?`${users.length} akun terdaftar`:stockSubTab==="migrasi"?"Cutover terkontrol data stok dari SAP — wajib backup sebelum apply":`${gudangList.length} gudang • ${lokasiList.length} blok lokasi terdaftar`}
                </span>
              </div>
              <div className="workspace-page-toolbar__actions">
                {can(currentUser, "aksi.kelolaMaster", rolePerms) && stockSubTab==="katalog" && <button style={sty.btn("primary")} onClick={openAddKatalog}>+ Tambah Katalog Barang</button>}
                {can(currentUser, "aksi.kelolaMaster", rolePerms) && stockSubTab==="satpam" && <button style={sty.btn("primary")} onClick={openAddSatpam}>+ Tambah Satpam</button>}
                {can(currentUser, "aksi.kelolaMaster", rolePerms) && stockSubTab==="organisasi" && <button style={sty.btn("primary")} onClick={openAddUIT}>+ Tambah UIT</button>}
                {can(currentUser, "aksi.kelolaMaster", rolePerms) && stockSubTab==="gudang" && <button style={sty.btn("primary")} onClick={openAddGudang}>+ Tambah Gudang Baru</button>}
                {can(currentUser, "aksi.kelolaAkun", rolePerms) && stockSubTab==="akun" && <button style={sty.btn("primary")} onClick={openAddAkun}>+ Daftarkan Akun Baru</button>}
              </div>
            </div>
            {stockSubTab==="gudang" && (
              <div style={{...sty.card,marginBottom:12,background:"#eff6ff",borderLeft:"4px solid #0369a1",padding:"10px 14px",fontSize:12,color:"#0369a1"}}>
                ℹ️ Sebagian besar Gudang biasanya <b>otomatis terbentuk sendiri</b> dari import Excel Kapasitas Gudang (tombol di bawah) setelah disetujui Asman. Kalau ada Gudang yang belum tercakup di laporan itu, tambahkan manual lewat tombol "+ Tambah Gudang Baru" di kanan atas.
              </div>
            )}
            {stockSubTab==="gudang" && can(currentUser, "aksi.import", rolePerms) && (
              <div style={{marginBottom:16}}>
                <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"center"}}>
                  <button style={sty.btn(importGudangOpen?"danger":"primary")} onClick={()=>setImportGudangOpen(o=>!o)}>
                    {importGudangOpen?"✕ Tutup Import Data Gudang":"📥 Import Data Gudang (Excel Kapasitas Gudang)"}
                  </button>
                  <button style={{...sty.btn("ghost","sm")}} onClick={()=>setShowGudangMaintenance(o=>!o)}>
                    {showGudangMaintenance?"✕ Tutup Alat Perbaikan":"🔧 Alat Perbaikan Data Lanjutan"}
                  </button>
                  <button style={{...sty.btn("ghost","sm")}} onClick={downloadLokasiTemplate}>⬇️ Download Template Lokasi</button>
                  <button style={{...sty.btn("ghost","sm")}} onClick={()=>setImportLokasiOpen(true)}>📥 Import Excel Lokasi</button>
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
                {/* Dulu 2 tombol ini sejajar dengan "Import Data Gudang" tanpa penjelasan,
                    keliatan seperti 3 hal setara padahal cuma dipakai kalau ada masalah data
                    spesifik, bukan pemakaian rutin (keluhan user 2026-07-06: "kenapa ada 3
                    inputan"). Sekarang disembunyikan di balik toggle + dikasih penjelasan
                    kapan masing-masing dipakai. */}
                {showGudangMaintenance && (
                  <div style={{marginTop:12,...sty.card,background:"#fafafa",border:`1px dashed ${C.border}`,padding:14}}>
                    <div style={{fontSize:12,color:C.muted,marginBottom:12}}>
                      Dua alat ini <b>bukan untuk pemakaian rutin</b> — cuma dipakai kalau menemukan masalah data spesifik berikut:
                    </div>
                    <div style={{display:"flex",flexDirection:"column",gap:12}}>
                      <div>
                        <button style={sty.btn("ghost","sm")} onClick={backfillGudangCoordFromCapacity}>🔄 Sinkron Koordinat dari Kapasitas Gudang</button>
                        <div style={{fontSize:12,color:C.muted,marginTop:4}}>Pakai kalau titik lokasi Gudang di peta hilang/salah, padahal data Kapasitas Gudang untuk gudang itu sudah live — menarik ulang koordinat lat/lng dari sana.</div>
                      </div>
                      <div>
                        <button style={sty.btn("ghost","sm")} onClick={() => dedupeGudangDanSubGudang()}>🧹 Gabungkan Gudang Duplikat</button>
                        <div style={{fontSize:12,color:C.muted,marginTop:4}}>Pakai kalau ada 2 Gudang/Sub Gudang dengan nama sama yang seharusnya satu (biasanya bikin denah/koordinat kelihatan "hilang" karena data nyasar ke ID yang berbeda).</div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
            {importLokasiOpen && (
              <ImportLokasiModal
                onClose={()=>setImportLokasiOpen(false)}
                lokasiList={lokasiList} gudangList={gudangList} subGudangList={subGudangList}
                isKodeDuplicateInSubGudang={isKodeDuplicateInSubGudang}
                setLokasiList={setLokasiList} syncLokasi={syncLokasi}
                currentUser={currentUser} showToast={showToast}
                sty={sty} C={C}
              />
            )}
            {/* ── SUB-TAB: MASTER KATALOG ── */}
            {stockSubTab==="katalog" && hasRole(currentUser, "ADMIN") && (
              <div style={{...sty.card,marginBottom:12,borderLeft:"4px solid #0369a1",padding:14}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:12,flexWrap:"wrap"}}>
                  <div>
                    <div style={{fontSize:13,fontWeight:800,color:"#0369a1"}}>📚 Referensi Katalog MARA</div>
                    <div style={{fontSize:12,color:C.muted,marginTop:2}}>Upload file MARA agar tersedia sebagai referensi saat menambah katalog baru.</div>
                  </div>
                  <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
                    {maraUploadProgress && (
                      <span style={{fontSize:12,color:"#0369a1",fontWeight:700,padding:"4px 10px",background:"#e0f2fe",borderRadius:6}}>{maraUploadProgress}</span>
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

            {stockSubTab==="katalog" && katalogList.length>0 && (
              <div style={{marginBottom:12,display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
                <div style={{position:"relative",maxWidth:420,flex:1,minWidth:220}}>
                  <input style={{...sty.input,paddingRight:32}} placeholder="🔍 Cari nama barang, no. katalog, kategori, jenis..." value={katalogSearch} onChange={e=>setKatalogSearch(e.target.value)}/>
                  {katalogSearch && (
                    <button
                      onClick={()=>setKatalogSearch("")}
                      title="Hapus pencarian"
                      style={{position:"absolute",right:6,top:"50%",transform:"translateY(-50%)",background:"transparent",border:"none",cursor:"pointer",fontSize:14,color:C.muted,padding:4,lineHeight:1}}
                    >✕</button>
                  )}
                </div>
                {katalogList.some(k=>k.belumDicocokkanMara) && (
                  <button onClick={()=>setKatalogFilterBelumMara(v=>!v)}
                    style={{padding:"6px 12px",borderRadius:20,border:`1px solid ${katalogFilterBelumMara?"#f59e0b":C.border}`,background:katalogFilterBelumMara?"#fef3c7":"white",color:katalogFilterBelumMara?"#92400e":C.text,fontSize:12,fontWeight:700,cursor:"pointer",whiteSpace:"nowrap"}}>
                    ⚠️ Belum Dicocokkan MARA ({katalogList.filter(k=>k.belumDicocokkanMara).length})
                  </button>
                )}
                {hasRole(currentUser, "ADMIN") && (
                  <button onClick={()=>setBarcodePrintOpen(true)} title="Cetak semua barcode/QR kartu gantung sekaligus"
                    style={{...sty.btn("primary","sm"),whiteSpace:"nowrap"}}>🖨️ Cetak Semua Barcode</button>
                )}
              </div>
            )}

            {stockSubTab==="katalog" && (
              katalogList.length===0
              ? <div style={{...sty.card,textAlign:"center",color:C.muted,padding:30}}>Belum ada Master Katalog. {hasRole(currentUser, "ADMIN") && "Klik \"+ Tambah Katalog Barang\" untuk menambahkan."}</div>
              : filteredKatalog.length===0
              ? <div style={{...sty.card,textAlign:"center",color:C.muted,padding:30}}>Tidak ada hasil untuk "{katalogSearch}".</div>
              : (
              <div className="mobile-card-table catalog-card-table" style={{...sty.card,padding:0,overflowX:"auto"}}>
                <table style={{width:"100%",borderCollapse:"collapse",fontSize:12,minWidth:860}}>
                  <thead>
                    <tr style={{background:C.sidebar,color:"white"}}>
                      {["Foto","No Katalog","Nama Barang","Kategori","Jenis","Satuan","Status","Aksi"].map(h=>(
                        <th key={h} style={{padding:"9px 10px",textAlign:h==="Aksi"||h==="Foto"?"center":"left",whiteSpace:"nowrap",fontSize:12}}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {pagedKatalog.map(k=>{
                      const sampleFoto = stocks.find(s=>s.katalogId===k.id && s.img)?.img || null;
                      const bs = getSAPBadgeStyle(k.katalog);
                      return (
                        <tr className="mobile-card-table__row" key={k.id} style={{borderBottom:`1px solid ${C.border}`,borderLeft:`3px solid ${C.accent}`}}>
                          <td className="mobile-card-table__photo" data-label="Foto" style={{padding:"8px 10px",textAlign:"center"}}>
                            {sampleFoto ? <img src={sampleFoto} alt={k.name} style={{width:40,height:40,borderRadius:6,objectFit:"cover",border:`1px solid ${C.border}`}}/>
                              : <div style={{width:40,height:40,background:"#eff6ff",borderRadius:6,display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,border:`1px solid #bfdbfe`,margin:"0 auto"}}>📦</div>}
                          </td>
                          <td className="catalog-card-table__meta" data-label="No Katalog" style={{padding:"8px 10px",whiteSpace:"nowrap"}}>
                            <div style={{fontSize:12,color:"#0098da",fontWeight:700}}>📑 {k.katalog}</div>
                            <div style={{fontSize:12,color:C.muted}}>{k.id}</div>
                          </td>
                          <td className="mobile-card-table__title" data-label="Nama Barang" style={{padding:"8px 10px",minWidth:200,fontWeight:700}}>{k.name}</td>
                          <td data-label="Kategori" style={{padding:"8px 10px"}}><span style={{padding:"2px 7px",borderRadius:20,fontSize:12,background:"#f3f4f6",color:C.muted,whiteSpace:"nowrap"}}>{(k.name||"").split(";")[0]?.trim()||k.category||"Lainnya"}</span></td>
                          <td data-label="Jenis" style={{padding:"8px 10px"}}>
                            <span style={sty.jenisBadge(k.jenisBarang)}>{k.jenisBarang||"-"}</span>
                            {k.pendingOpnameId && <div style={{marginTop:3}}><span style={{padding:"1px 6px",borderRadius:10,fontSize:12,fontWeight:700,background:"#dbeafe",color:"#1e40af"}}>⏳ Pending Approval</span></div>}
                            {k.belumDicocokkanMara && <div style={{marginTop:3}}><span style={{padding:"1px 6px",borderRadius:10,fontSize:12,fontWeight:700,background:"#fef3c7",color:"#92400e"}}>⚠️ Belum MARA</span></div>}
                          </td>
                          <td data-label="Satuan" style={{padding:"8px 10px",whiteSpace:"nowrap"}}>{k.satuan}</td>
                          <td data-label="Status" style={{padding:"8px 10px"}}><span style={{padding:"2px 7px",borderRadius:20,fontSize:12,fontWeight:700,background:bs.bg,color:bs.fg,whiteSpace:"nowrap"}}>{getSAPLabel(k.katalog)}</span></td>
                          <td data-label="Aksi" style={{padding:"8px 10px"}}>
                            {hasRole(currentUser, "ADMIN") && (
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

            {/* ── SUB-TAB: SATPAM (dikelompokkan per gudang) ── */}
            {stockSubTab==="satpam" && (() => {
              if (satpamList.length===0) return <div style={{...sty.card,textAlign:"center",color:C.muted,padding:30}}>Belum ada data Satpam. {hasRole(currentUser, "ADMIN") && "Klik \"+ Tambah Satpam\" untuk menambahkan."}</div>;
              const groups = [
                ...gudangList.map(g=>({ id:g.id, nama:g.nama, list:satpamList.filter(sp=>sp.gudangId===g.id) })),
                { id:"__none__", nama:"Belum di-assign gudang", list:satpamList.filter(sp=>!sp.gudangId || !gudangList.some(g=>g.id===sp.gudangId)) },
              ].filter(grp=>grp.list.length>0);
              const renderCard = sp => (
                <div key={sp.id} style={{...sty.card,borderTop:`3px solid ${C.accent}`}}>
                  <div style={{display:"flex",gap:10,alignItems:"center",marginBottom:10}}>
                    {sp.foto
                      ? <img src={sp.foto} alt={sp.name} style={{width:44,height:44,borderRadius:"50%",objectFit:"cover",border:`1px solid #bfdbfe`,flexShrink:0}}/>
                      : <div style={{width:44,height:44,borderRadius:"50%",background:"#0b2559",color:"#fff",display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,fontWeight:800,flexShrink:0}}>{(sp.name||"?").trim().charAt(0).toUpperCase()}</div>}
                    <div>
                      <div style={{fontWeight:700,fontSize:14}}>{sp.name}</div>
                      <div style={{fontSize:12,color:C.muted}}>{sp.id}{sp.telp ? ` • ${sp.telp}` : ""}</div>
                    </div>
                  </div>
                  {hasRole(currentUser, "ADMIN") && (
                    <div style={{display:"flex",gap:6}}>
                      <button style={{...sty.btn("ghost","sm"),flex:1}} onClick={()=>openEditSatpam(sp)}>✏️ Edit</button>
                      <button style={{...sty.btn("danger","sm"),flex:1}} onClick={()=>deleteSatpam(sp.id)}>🗑️ Hapus</button>
                    </div>
                  )}
                </div>
              );
              return (
                <div style={{display:"flex",flexDirection:"column",gap:18}}>
                  {groups.map(grp=>(
                    <div key={grp.id}>
                      <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:10,fontSize:13,fontWeight:800,color:grp.id==="__none__"?C.muted:C.accent}}>
                        <span>{grp.id==="__none__"?"⚠️":"🏢"} {grp.nama}</span>
                        <span style={{fontSize:12,fontWeight:600,color:C.muted,background:"#eef2ff",borderRadius:20,padding:"1px 8px"}}>{grp.list.length}</span>
                      </div>
                      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(260px,1fr))",gap:14}}>
                        {grp.list.map(renderCard)}
                      </div>
                    </div>
                  ))}
                </div>
              );
            })()}

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
                    {hasRole(currentUser, "ADMIN") && (
                      <button style={{...sty.btn("ghost","sm"),marginTop:10,width:"100%"}} onClick={()=>openEditTimMutu(tm)}>✏️ Edit Anggota</button>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* ── SUB-TAB: STRUKTUR ORGANISASI (UIT → UPT → ULTG, satu kesatuan) ── */}
            {stockSubTab==="organisasi" && (() => {
              const orgQ = orgSearch.trim().toLowerCase();
              const hit = (...vals) => vals.some(v => (v||"").toLowerCase().includes(orgQ));
              const uptMatchesSearch = (upt) => !orgQ || hit(upt.kode, upt.nama) || ultgList.some(x=>x.parentUptId===upt.id && hit(x.kode, x.nama));
              const uitMatchesSearch = (uit) => !orgQ || hit(uit.kode, uit.nama) || uptList.some(u=>u.uitId===uit.id && uptMatchesSearch(u));
              const visibleUit = uitList.filter(uitMatchesSearch);
              return (
              <div className="master-organization-page">
                {/* Ringkasan — sebelumnya cuma teks kecil di subtitle halaman, sekarang
                    KPI supaya langsung kelihatan skala struktur org tanpa harus scroll/
                    expand semua (keluhan user 2026-07-06: "kurang informatif"). */}
                <div className="master-organization-kpis" style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))",gap:12,marginBottom:16}}>
                  {[
                    {label:"Total UIT",val:uitList.length,color:C.accent},
                    {label:"Total UPT",val:uptList.length,color:"#0369a1"},
                    {label:"Total ULTG",val:ultgList.length,color:"#0891b2"},
                  ].map(kpi=>(
                    <div key={kpi.label} style={{...sty.card,borderTop:`3px solid ${kpi.color}`,padding:14,textAlign:"center"}}>
                      <div style={{fontSize:12,color:C.muted,marginBottom:4}}>{kpi.label}</div>
                      <div style={{fontSize:24,fontWeight:800,color:kpi.color}}>{kpi.val}</div>
                    </div>
                  ))}
                </div>

                {uitList.length>0 && (
                  <div style={{position:"relative",maxWidth:420,marginBottom:16}}>
                    <input style={{...sty.input,paddingRight:32}} placeholder="🔍 Cari UIT, UPT, atau ULTG..." value={orgSearch} onChange={e=>setOrgSearch(e.target.value)}/>
                    {orgSearch && (
                      <button onClick={()=>setOrgSearch("")} title="Hapus pencarian"
                        style={{position:"absolute",right:6,top:"50%",transform:"translateY(-50%)",background:"transparent",border:"none",cursor:"pointer",fontSize:14,color:C.muted,padding:4,lineHeight:1}}
                      >✕</button>
                    )}
                  </div>
                )}

                {uitList.length===0 && <div style={{...sty.card,textAlign:"center",color:C.muted,padding:30}}>Belum ada Master UIT.</div>}
                {uitList.length>0 && visibleUit.length===0 && <div style={{...sty.card,textAlign:"center",color:C.muted,padding:30}}>Tidak ada hasil untuk "{orgSearch}".</div>}

                <div style={{display:"flex",flexDirection:"column",gap:12}}>
                  {visibleUit.map(uit=>{
                    const uptOfUit = uptList.filter(u=>u.uitId===uit.id).filter(u=>!orgQ || uptMatchesSearch(u));
                    const totalUltgOfUit = ultgList.filter(x=>uptList.some(u=>u.uitId===uit.id && u.id===x.parentUptId)).length;
                    const isOpen = orgQ ? true : !collapsedUitIds.has(uit.id);
                    const toggleUit = () => setCollapsedUitIds(prev => {
                      const next = new Set(prev);
                      if (next.has(uit.id)) next.delete(uit.id); else next.add(uit.id);
                      return next;
                    });
                    return (
                      <div className="master-organization-card" key={uit.id} style={{...sty.card,padding:0,overflow:"hidden",borderLeft:"4px solid #003087"}}>
                        <div className="master-organization-card__header" style={{background:"#f8fafc"}} onClick={toggleUit}>
                          <div style={{display:"flex",gap:10,alignItems:"flex-start",minWidth:0}}>
                            <div style={{fontSize:22,flexShrink:0}}>🏢</div>
                            <div style={{minWidth:0}}>
                              <div style={{display:"flex",gap:6,alignItems:"center",flexWrap:"wrap"}}>
                                <span style={{fontSize:12,fontWeight:800,color:"white",background:C.sidebar,padding:"2px 6px",borderRadius:4,letterSpacing:0.5}}>UIT</span>
                                <span style={{fontWeight:800,fontSize:14}}>{uit.kode} — {uit.nama}</span>
                              </div>
                              <div style={{fontSize:12,color:C.muted,marginTop:3}}>📍 {uit.alamat||"Alamat belum diisi"}</div>
                              <div style={{fontSize:12,color:C.muted,marginTop:1}}>{uptOfUit.length} UPT • {totalUltgOfUit} ULTG</div>
                            </div>
                          </div>
                          <div className="master-organization-card__actions" onClick={e=>e.stopPropagation()}>
                            {hasRole(currentUser, "ADMIN") && (<>
                              <button style={sty.btn("ghost","sm")} onClick={()=>openAddUPT(uit.id)}>+ UPT</button>
                              <button title="Edit" style={sty.btn("ghost","sm")} onClick={()=>openEditUIT(uit)}>✏️</button>
                              <button title="Hapus" style={sty.btn("danger","sm")} onClick={()=>deleteUIT(uit.id)}>🗑️</button>
                            </>)}
                            <span onClick={toggleUit} style={{fontSize:14,color:C.muted,transition:"transform 0.15s",transform:isOpen?"rotate(90deg)":"rotate(0deg)",display:"inline-block",marginLeft:4,cursor:"pointer"}}>▶</span>
                          </div>
                        </div>

                        {isOpen && (
                          <div style={{padding:"0 14px 14px 14px"}}>
                            {uptOfUit.length===0
                              ? <div style={{fontSize:12,color:C.muted,fontStyle:"italic",paddingLeft:14,paddingTop:10}}>Belum ada UPT di bawah UIT ini.</div>
                              : <div style={{display:"flex",flexDirection:"column",gap:8,paddingLeft:18,borderLeft:`2px dashed ${C.border}`,marginTop:10}}>
                                  {uptOfUit.map(upt=>{
                                    const ultgOfUpt = ultgList.filter(x=>x.parentUptId===upt.id).filter(x=>!orgQ || hit(x.kode,x.nama) || hit(upt.kode,upt.nama));
                                    return (
                                      <div className="master-organization-upt" key={upt.id} style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:8,padding:10}}>
                                        <div className="master-organization-upt__header" style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",flexWrap:"wrap",gap:8}}>
                                          <div style={{display:"flex",gap:8,alignItems:"flex-start",minWidth:0}}>
                                            <div style={{fontSize:16,flexShrink:0}}>📍</div>
                                            <div style={{minWidth:0}}>
                                              <div style={{display:"flex",gap:6,alignItems:"center",flexWrap:"wrap"}}>
                                                <span style={{fontSize:12,fontWeight:800,color:"#0369a1",background:"#e0f2fe",padding:"1px 6px",borderRadius:4}}>UPT</span>
                                                <span style={{fontWeight:700,fontSize:13}}>{upt.kode} — {upt.nama}</span>
                                              </div>
                                              <div style={{fontSize:12,color:C.muted,marginTop:2}}>{upt.alamat||"Alamat belum diisi"} • {ultgOfUpt.length} ULTG</div>
                                            </div>
                                          </div>
                                          {hasRole(currentUser, "ADMIN") && (
                                            <div className="master-organization-upt__actions" style={{display:"flex",gap:4,flexShrink:0}}>
                                              <button style={{...sty.btn("ghost","sm"),padding:"3px 8px"}} onClick={()=>openAddULTG(upt.id)}>+ ULTG</button>
                                              <button title="Edit" style={{...sty.btn("ghost","sm"),padding:"3px 8px"}} onClick={()=>openEditUPT(upt)}>✏️</button>
                                              <button title="Hapus" style={{...sty.btn("danger","sm"),padding:"3px 8px"}} onClick={()=>deleteUPT(upt.id)}>🗑️</button>
                                            </div>
                                          )}
                                        </div>
                                        {ultgOfUpt.length>0 && (
                                          <div className="master-organization-ultg-list" style={{display:"flex",flexWrap:"wrap",gap:6,marginTop:8,paddingLeft:24}}>
                                            {ultgOfUpt.map(ultg=>(
                                              <div className="master-organization-ultg" key={ultg.id} style={{display:"flex",alignItems:"center",gap:6,background:"#f0fdf4",border:`1px solid #bbf7d0`,borderRadius:20,padding:"4px 10px",fontSize:12}}>
                                                <span>🏘️ <b>{ultg.kode}</b> {ultg.nama}</span>
                                                {hasRole(currentUser, "ADMIN") && (
                                                  <span style={{display:"flex",gap:2,marginLeft:2}}>
                                                    <button title="Edit" style={{...sty.btn("ghost","sm"),padding:"1px 4px",fontSize:12}} onClick={()=>openEditULTG(ultg)}>✏️</button>
                                                    <button title="Hapus" style={{...sty.btn("danger","sm"),padding:"1px 4px",fontSize:12}} onClick={()=>deleteULTG(ultg.id)}>🗑️</button>
                                                  </span>
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
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
              );
            })()}

            {/* ── SUB-TAB: MASTER GUDANG ── */}
            {stockSubTab==="gudang" && (
              <div className="master-warehouse-page">
                {/* Notifikasi approval blok lokasi sudah dipindahkan ke menu "✅ Approval" — lihat di sana. */}
                {gudangList.length===0 && <div style={{...sty.card,textAlign:"center",color:C.muted,padding:30}}>Belum ada Master Gudang.</div>}
                {visibleGudangList.map(g=>{
                  const upt = uptList.find(u=>u.id===g.uptId);
                  const bloklokasi = lokasiList.filter(l=>l.gudangId===g.id);
                  const blokWithCoord = bloklokasi.filter(l=>l.mapX!=null);
                  const isExpanded = expandedGudangId===g.id;
                  const subsOfGudang = subGudangList.filter(sg=>sg.gudangId===g.id);
                  return (
                    <div className="master-warehouse-card" key={g.id} style={{...sty.card,marginBottom:10,borderTop:`3px solid #003087`}}>
                      <div className="master-warehouse-card__header" onClick={()=>setExpandedGudangId(isExpanded?null:g.id)}>
                        <div className="master-warehouse-card__copy">
                          <div style={{fontWeight:800,fontSize:15}}>🏭 {g.nama}</div>
                          <div style={{fontSize:12,color:C.muted}}>{g.kode} • {upt?.nama||"-"} • {g.alamat||"-"}</div>
                          <div style={{fontSize:12,color:C.muted,marginTop:2}}>{bloklokasi.length} blok terkait, {blokWithCoord.length} sudah ter-peta{subsOfGudang.length>0?` • ${subsOfGudang.length} Sub Gudang`:""}</div>
                        </div>
                        <div className="master-warehouse-card__actions">
                          {hasRole(currentUser, "ADMIN") && (
                            <div className="master-warehouse-card__admin-actions" style={{display:"flex",gap:6}} onClick={e=>e.stopPropagation()}>
                              <button aria-label="Edit gudang" title="Edit gudang" style={sty.btn("ghost","sm")} onClick={()=>openEditGudang(g)}>{isMobile?"✏️":"✏️ Edit"}</button>
                              <button title="Hapus" style={sty.btn("danger","sm")} onClick={()=>deleteGudang(g.id)}>🗑️</button>
                            </div>
                          )}
                          <span style={{fontSize:14,color:C.muted,transition:"transform 0.15s",transform:isExpanded?"rotate(90deg)":"rotate(0deg)",display:"inline-block"}}>▶</span>
                        </div>
                      </div>

                      {isExpanded && <div style={{marginTop:14}}>

                      {/* Denah + Konfigurasi Koordinat level Gudang — disembunyikan di balik toggle
                          collapsed-by-default (dulu selalu terbuka penuh: upload + preview + panel
                          konfigurasi besar, bikin halaman kepanjangan padahal yang paling dibutuhkan
                          user cuma Daftar Blok Lokasi di bawah — keluhan user 2026-07-06). Kalau
                          Gudang ini PUNYA Sub Gudang, tombol Konfigurasi Koordinat di level ini
                          SENGAJA tidak ditampilkan — dot Blok baru cuma boleh dikonfigurasi di peta
                          Sub Gudang masing-masing, bukan di peta keseluruhan Gudang (aturan baru). */}
                      <button style={{...sty.btn("ghost","sm"),marginBottom:12}} onClick={()=>setShowGudangDenahTools(o=>!o)}>
                        {showGudangDenahTools?"✕ Tutup Denah & Koordinat Gudang":"🛠️ Kelola Denah & Koordinat Gudang"}
                      </button>

                      {showGudangDenahTools && (
                      <div style={{marginBottom:12}}>
                        {hasRole(currentUser, "ADMIN") && (
                          <div style={{marginBottom:12}}>
                            <label style={sty.label}>Upload Denah Gudang (PNG / JPG) — peta keseluruhan</label>
                            <div style={{fontSize:12,color:C.muted,marginBottom:4}}>
                              💡 Convert PDF denah ke gambar terlebih dahulu (screenshot, foto, atau export dari PDF viewer)
                            </div>
                            <input type="file" accept="image/*" capture="environment"
                              onChange={e=>{const f=e.target.files[0];if(f)uploadDenahGudang(g.id,f);}}
                              style={{fontSize:12,color:C.muted}}/>
                            {denahLoading && (
                              <div style={{fontSize:12,color:"#1d4ed8",marginTop:4}}>
                                ⏳ Mengompres dan menyimpan gambar...
                              </div>
                            )}
                            {g.denahUploadedAt && !denahLoading && (
                              <div style={{fontSize:12,color:C.green,marginTop:4}}>
                                ✅ Denah tersimpan • {fmtDate(g.denahUploadedAt)}
                              </div>
                            )}
                          </div>
                        )}

                        {g.denahImageData && (
                          <div style={{marginBottom:12}}>
                            <div style={{fontSize:12,fontWeight:700,color:C.muted,marginBottom:6}}>Preview Denah (peta keseluruhan Gudang):</div>
                            <img src={g.denahImageData} alt="Denah Gudang" style={{width:"100%",maxHeight:200,objectFit:"contain",borderRadius:6,border:`1px solid ${C.border}`}}/>
                          </div>
                        )}

                        {hasRole(currentUser, "ADMIN") && g.denahImageData && (
                          subsOfGudang.length===0 ? (
                            <GudangCoordConfigPanel
                              label="Gudang"
                              denahImage={g.denahImageData}
                              isOpen={mapConfigGudangId===g.id}
                              onToggleOpen={()=>{const willOpen=mapConfigGudangId!==g.id;setMapConfigGudangId(willOpen?g.id:null);setPendingMapLokasi(null);setManualAddMode(willOpen);}}
                              manualAddMode={manualAddMode} setManualAddMode={setManualAddMode}
                              pendingMapLokasi={pendingMapLokasi} setPendingMapLokasi={setPendingMapLokasi}
                              blocksInScope={bloklokasi}
                              getCoord={l=>l.mapX!=null?{x:l.mapX,y:l.mapY}:null}
                              draftDots={ocrSuggestGudangId===g.id && !ocrSuggestSubGudangId ? ocrSuggestions : []}
                              onAssignCoord={(lokasiId,xPct,yPct)=>assignLokasiKoordinat(lokasiId,xPct,yPct,g.id)}
                              onAddDraft={(xPct,yPct)=>{
                                const totalUsulan = bloklokasi.length + ocrSuggestions.length;
                                const kodeUsulan = suggestKodeFromOcr(g, xPct, yPct) || `${g.kode||"BLOK"}-${String(totalUsulan+1).padStart(2,"0")}`;
                                setOcrSuggestions(prev=>[...prev, { id: uid(), kode: kodeUsulan, jenisArea:"Rak Tertutup", luasan:"", xPct, yPct, checked: true }]);
                                setOcrSuggestGudangId(g.id);
                                setOcrSuggestSubGudangId(null);
                              }}
                              onFinishAdding={()=>{setManualAddMode(false);setPendingMapLokasi(null);setMapConfigGudangId(null);}}
                              ocrNotReady={g.denahOcrWords==null}
                              sty={sty} C={C} showToast={showToast}
                            />
                          ) : (
                            <div style={{fontSize:12,color:"#0369a1",background:"#eff6ff",border:"1px solid #bfdbfe",borderRadius:8,padding:"8px 12px"}}>
                              ℹ️ Gudang ini punya {subsOfGudang.length} Sub Gudang — atur koordinat Blok baru di peta masing-masing Sub Gudang di bawah, bukan di peta keseluruhan ini.
                            </div>
                          )
                        )}
                      </div>
                      )}

                      {/* Sub Gudang milik Gudang ini, tiap Sub Gudang punya daftar Blok + denah sendiri.
                          Kalau Gudang ini punya Sub Gudang, klik Gudang cuma tampilkan MENU Sub Gudang
                          dulu (nama + jumlah blok) — klik salah satu Sub Gudang baru tampil Daftar Blok
                          Lokasi-nya. Kalau Gudang tidak punya Sub Gudang sama sekali, langsung tampilkan
                          daftar bloknya (tidak ada yang perlu dipilih) — permintaan user 2026-07-06. */}
                      <div style={{marginTop:16}}>
                        {(() => {
                          const knownSubIds = new Set(subsOfGudang.map(sg=>sg.id));
                          const subKodeMap = subGudangKodeMap(subsOfGudang);
                          const umumBlok = bloklokasi.filter(l=>!l.subGudangId || !knownSubIds.has(l.subGudangId));
                          const groups = [
                            ...subsOfGudang.map(sg=>({ id:sg.id, sg, nama:sg.nama, blok: bloklokasi.filter(l=>l.subGudangId===sg.id) })),
                            { id:null, sg:null, nama:"Umum / Belum Dikelompokkan", blok: umumBlok },
                          ];

                          function renderGroupDetail(grp) {
                            const isSubToolsOpen = grp.sg ? expandedSubGudangToolsIds.has(grp.sg.id) : false;
                            const toggleSubTools = () => { if (!grp.sg) return; setExpandedSubGudangToolsIds(prev=>{
                              const next = new Set(prev);
                              if (next.has(grp.sg.id)) next.delete(grp.sg.id); else next.add(grp.sg.id);
                              return next;
                            }); };
                            // Blok "tidak terdaftar" (belum di-assign ke Sub Gudang manapun, padahal Gudang
                            // ini SUDAH punya Sub Gudang) — tidak perlu tombol "+ Tambah Blok" di sini,
                            // cukup arahkan Admin assign dulu lewat ✏️ Edit lalu atur koordinatnya di Sub
                            // Gudang yang benar (permintaan user 2026-07-06).
                            const isUnregistered = !grp.sg && subsOfGudang.length>0;
                            return (
                            <div key={grp.id||"umum"} style={{marginBottom:18,paddingLeft:10,borderLeft:`3px solid ${C.border}`}}>
                              {grp.sg && <div style={{fontSize:13,fontWeight:800,marginBottom:8,display:"flex",alignItems:"center",gap:8}}>🏢 Sub Gudang: {grp.nama}{subKodeMap[grp.sg.id] && <span title="Kode singkatan Sub Gudang (dipakai sebagai tag di depan kode blok)" style={{fontSize:12,fontWeight:800,color:"#1e3a8a",background:"#dbeafe",border:"1px solid #bfdbfe",padding:"1px 7px",borderRadius:6}}>{subKodeMap[grp.sg.id]}</span>}</div>}

                              {/* Denah + Konfigurasi Koordinat level Sub Gudang — collapsed by default,
                                  sama alasan seperti level Gudang di atas. Hanya untuk grup real (grp.sg),
                                  "Umum" tidak pernah dikasih tools konfigurasi sendiri. Ditaruh di atas
                                  Daftar Blok Lokasi (permintaan user 2026-07-09) supaya user langsung
                                  ketemu tools denah/koordinat sebelum scroll ke daftar blok. */}
                              {grp.sg && (
                                <div style={{marginBottom:14}}>
                                  <button style={sty.btn("ghost","sm")} onClick={toggleSubTools}>
                                    {isSubToolsOpen?"✕ Tutup Denah & Koordinat Sub Gudang":"🛠️ Kelola Denah & Koordinat Sub Gudang"}
                                  </button>
                                  {isSubToolsOpen && (
                                    <div style={{marginTop:10}}>
                                      {hasRole(currentUser, "ADMIN") && (
                                        <div style={{marginBottom:10}}>
                                          <label style={{...sty.label,fontSize:12}}>Upload Denah Sub Gudang (PNG / JPG) — opsional, fallback ke denah Gudang jika kosong</label>
                                          <div>
                                            <input type="file" accept="image/*" capture="environment"
                                              onChange={e=>{const f=e.target.files[0];if(f)uploadDenahSubGudang(grp.sg.id,g.id,f);}}
                                              style={{fontSize:12,color:C.muted}}/>
                                          </div>
                                          {denahSubLoading && <div style={{fontSize:12,color:"#1d4ed8",marginTop:4}}>⏳ Mengompres dan menyimpan gambar...</div>}
                                          {grp.sg.denahUploadedAt && !denahSubLoading && <div style={{fontSize:12,color:C.green,marginTop:4}}>✅ Denah tersimpan • {fmtDate(grp.sg.denahUploadedAt)}</div>}
                                        </div>
                                      )}
                                      {grp.sg?.denahImageData && (
                                        <div style={{marginBottom:10}}>
                                          <div style={{fontSize:12,fontWeight:700,color:C.muted,marginBottom:6}}>Preview Denah Sub Gudang:</div>
                                          <img src={grp.sg.denahImageData} alt="Denah Sub Gudang" style={{width:"100%",maxHeight:180,objectFit:"contain",borderRadius:6,border:`1px solid ${C.border}`}}/>
                                        </div>
                                      )}
                                      {hasRole(currentUser, "ADMIN") && grp.sg.denahImageData && (
                                        <GudangCoordConfigPanel
                                          label="Sub Gudang"
                                          denahImage={grp.sg.denahImageData}
                                          isOpen={mapConfigSubGudangId===grp.sg.id}
                                          onToggleOpen={()=>{const willOpen=mapConfigSubGudangId!==grp.sg.id;setMapConfigSubGudangId(willOpen?grp.sg.id:null);setPendingMapLokasiSub(null);setManualAddModeSub(willOpen);}}
                                          manualAddMode={manualAddModeSub} setManualAddMode={setManualAddModeSub}
                                          pendingMapLokasi={pendingMapLokasiSub} setPendingMapLokasi={setPendingMapLokasiSub}
                                          blocksInScope={grp.blok}
                                          getCoord={l=>l.subMapX!=null?{x:l.subMapX,y:l.subMapY}:null}
                                          draftDots={ocrSuggestSubGudangId===grp.sg.id ? ocrSuggestions : []}
                                          onAssignCoord={(lokasiId,xPct,yPct)=>assignLokasiKoordinatSub(lokasiId,xPct,yPct,grp.sg.id,g.id)}
                                          onAddDraft={(xPct,yPct)=>{
                                            const totalUsulan = grp.blok.length + ocrSuggestions.length;
                                            const kodeUsulan = suggestKodeFromOcr(grp.sg, xPct, yPct) || `${grp.sg.nama?.slice(0,6).toUpperCase()||"BLOK"}-${String(totalUsulan+1).padStart(2,"0")}`;
                                            setOcrSuggestions(prev=>[...prev, { id: uid(), kode: kodeUsulan, jenisArea:"Rak Tertutup", luasan:"", xPct, yPct, checked: true }]);
                                            setOcrSuggestGudangId(g.id);
                                            setOcrSuggestSubGudangId(grp.sg.id);
                                          }}
                                          onFinishAdding={()=>{setManualAddModeSub(false);setPendingMapLokasiSub(null);setMapConfigSubGudangId(null);}}
                                          ocrNotReady={false}
                                          sty={sty} C={C} showToast={showToast}
                                        />
                                      )}
                                    </div>
                                  )}
                                </div>
                              )}

                              {isUnregistered && grp.blok.length>0 && (
                                <div style={{fontSize:12,color:"#92400e",background:"#fef3c7",border:"1px solid #fcd34d",borderRadius:8,padding:"8px 12px",marginBottom:10}}>
                                  ⚠️ {grp.blok.length} blok belum dikelompokkan ke Sub Gudang manapun. Klik ✏️ di baris blok untuk assign ke Sub Gudang yang benar, baru atur koordinatnya di sana.
                                </div>
                              )}

                              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                                <div style={{fontSize:12,color:C.muted}}>📍 Daftar Blok Lokasi ({grp.blok.length})</div>
                                {hasRole(currentUser, "ADMIN") && !isUnregistered && <span style={{fontSize:12,color:C.muted,fontStyle:"italic"}}>➕ Tambah blok lewat 🛠️ Kelola Denah & Koordinat di atas</span>}
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
                                            {grp.sg && subKodeMap[grp.sg.id] && <span title={`Sub Gudang: ${grp.sg.nama}`} style={{fontSize:12,fontWeight:800,color:"#1e3a8a",background:"#dbeafe",border:"1px solid #bfdbfe",padding:"1px 6px",borderRadius:6,flexShrink:0}}>{subKodeMap[grp.sg.id]}</span>}
                                            <span style={{fontWeight:700}}>{l.kode}</span>
                                            {l.nama && <span style={{color:C.muted,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{l.nama}</span>}
                                            {l.status==="PENDING" && <span style={{fontSize:12,fontWeight:700,color:"#92400e",background:"#fef3c7",padding:"1px 6px",borderRadius:10}}>MENUNGGU APPROVAL TL</span>}
                                            {!hasCoord && <span style={{fontSize:12,fontWeight:700,color:"#92400e",background:"#fef3c7",padding:"1px 6px",borderRadius:10}}>BELUM ADA KOORDINAT</span>}
                                          </div>
                                          <div style={{display:"flex",alignItems:"center",gap:8,flexShrink:0}}>
                                            <span style={{fontSize:12,color:n>0?C.accent:C.muted,fontWeight:700}}>{n} item</span>
                                            {hasRole(currentUser, "ADMIN") && <button title="Edit" style={{...sty.btn("ghost","sm"),padding:"2px 8px"}} onClick={()=>openEditLokasi(l)}>✏️</button>}
                                            {hasRole(currentUser, "ADMIN") && <button title="Hapus" style={{...sty.btn("danger","sm"),padding:"2px 8px"}} onClick={()=>requestDeleteLokasi(l)}>🗑️</button>}
                                          </div>
                                        </div>
                                      );
                                    })}
                                  </div>
                              }
                            </div>
                            );
                          }

                          if (subsOfGudang.length === 0) {
                            // Tidak ada Sub Gudang sama sekali — tidak ada yang perlu "dipilih", langsung
                            // tampilkan daftar blok (grup "Umum" satu-satunya).
                            return renderGroupDetail(groups[0]);
                          }

                          const menuGroups = groups.filter(grp => grp.sg || grp.blok.length>0);
                          return (
                            <>
                              <div style={{display:"flex",flexDirection:"column",gap:6,marginBottom:12}}>
                                {menuGroups.map(grp=>{
                                  const key = grp.id||"umum";
                                  const isSelected = selectedSubGudangId===key;
                                  return (
                                    <div key={key}>
                                      <div onClick={()=>setSelectedSubGudangId(isSelected?null:key)}
                                        style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"10px 12px",background:isSelected?"#eff6ff":"#f9fafb",border:`1px solid ${isSelected?"#93c5fd":C.border}`,borderRadius:8,cursor:"pointer"}}>
                                        <div style={{fontSize:13,fontWeight:700,display:"flex",alignItems:"center",gap:8}}>{grp.sg?"🏢":"📦"} {grp.nama}{grp.sg && subKodeMap[grp.sg.id] && <span style={{fontSize:12,fontWeight:800,color:"#1e3a8a",background:"#dbeafe",border:"1px solid #bfdbfe",padding:"1px 6px",borderRadius:6}}>{subKodeMap[grp.sg.id]}</span>}</div>
                                        <div style={{display:"flex",alignItems:"center",gap:8}}>
                                          <span style={{fontSize:12,color:C.muted}}>{grp.blok.length} blok</span>
                                          <span style={{fontSize:12,color:C.muted,transition:"transform 0.15s",transform:isSelected?"rotate(90deg)":"rotate(0deg)",display:"inline-block"}}>▶</span>
                                        </div>
                                      </div>
                                      {isSelected && renderGroupDetail(grp)}
                                    </div>
                                  );
                                })}
                              </div>
                            </>
                          );
                        })()}
                      </div>
                      </div>}
                    </div>
                  );
                })}
              </div>
            )}

            {/* ── SUB-TAB: KELOLA AKUN (aksi.kelolaAkun, default ADMIN) ── */}
            {stockSubTab==="akun" && can(currentUser, "aksi.kelolaAkun", rolePerms) && (
              <div style={sty.card}>
                {users.length===0 ? (
                  <div style={{textAlign:"center",color:C.muted,padding:30}}>Belum ada akun terdaftar.</div>
                ) : (
                  <div style={{overflowX:"auto",WebkitOverflowScrolling:"touch"}}>
                  <table style={{width:"100%",minWidth:640,borderCollapse:"collapse",fontSize:12}}>
                    <thead>
                      <tr style={{borderBottom:`2px solid ${C.border}`,textAlign:"left"}}>
                        <th style={{padding:"8px 6px"}}>Nama</th>
                        <th style={{padding:"8px 6px"}}>Username</th>
                        <th style={{padding:"8px 6px"}}>Role</th>
                        <th style={{padding:"8px 6px"}}>Jabatan</th>
                        <th style={{padding:"8px 6px"}}>UPT</th>
                        <th style={{padding:"8px 6px"}}>ULTG</th>
                        <th style={{padding:"8px 6px"}}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {users.map(u=>(
                        <tr key={u.id} style={{borderBottom:`1px solid ${C.border}`}}>
                          <td style={{padding:"8px 6px",fontWeight:700}}>{u.name}</td>
                          <td style={{padding:"8px 6px",color:C.muted}}>{u.username}</td>
                          <td style={{padding:"8px 6px"}}>{ROLES[u.role]||u.role}</td>
                          <td style={{padding:"8px 6px",color:C.muted}}>{u.jabatan||"-"}</td>
                          <td style={{padding:"8px 6px",color:C.muted}}>{uptList.find(p=>p.id===u.uptId)?.nama||"-"}</td>
                          <td style={{padding:"8px 6px",color:C.muted}}>{ultgList.find(g=>g.id===u.ultgId)?.nama||"-"}</td>
                          <td style={{padding:"8px 6px"}}><button style={sty.btn("ghost","sm")} onClick={()=>openEditAkun(u)}>✏️ Edit</button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  </div>
                )}
              </div>
            )}

            {/* ── SUB-TAB: MIGRASI DATA (ADMIN only) ── */}
            {stockSubTab==="migrasi" && hasRole(currentUser, "ADMIN") && (
              <MigrasiDataTab
                stocks={stocks}
                katalogList={katalogList}
                lokasiList={lokasiList}
                txns={txns}
                migratedTug15History={migratedTug15History}
                setMigratedTug15History={setMigratedTug15History}
                migrasiPendingReview={migrasiPendingReview}
                setMigrasiPendingReview={setMigrasiPendingReview}
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
                rolePerms={rolePerms}
              />
            )}

            {/* ── SUB-TAB: AUDIT LOG (ADMIN only) ── */}
            {stockSubTab==="auditLog" && hasRole(currentUser, "ADMIN") && (
              <AuditLogPage sty={sty} C={C}/>
            )}

            {/* ── SUB-TAB: MATRIX IZIN (ADMIN only) ── */}
            {stockSubTab==="perms" && hasRole(currentUser, "ADMIN") && (
              <PermMatrixPage sty={sty} C={C} currentUser={currentUser} rolePerms={rolePerms} reloadRolePerms={reloadRolePerms} showToast={showToast}/>
            )}
          </div>
        )}
        {tab==="transaction" && (
          <div className="workspace-page tug-page">
            <section className={`kpi-banner tug-summary-banner${tugSubTab==="TUG15"?" is-context-only":""}`} aria-label="Ringkasan transaksi TUG">
              <div className="tug-summary-banner__context">
                <div className="tug-summary-banner__copy">
                  <span>{(TUG_GROUP_UI[tugGroup]||{}).label}</span>
                  <strong>{(TUG_UI[tugSubTab]||{}).title || "Dokumen TUG"}</strong>
                  <small>{(TUG_UI[tugSubTab]||{}).desc || ""}</small>
                </div>
              </div>
              {tugSubTab!=="TUG15" && (
                <div className="tug-summary-banner__metrics">
                  {activeTugSummary.map(metric=>(
                    <div key={metric.label} className={`kpi-banner__item${metric.cls?" "+metric.cls:""}`}>
                      <strong>{metric.val}</strong><span>{metric.label}</span>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="tug-process-tabs" aria-label="Pilihan jenis transaksi TUG">
              <div className="tug-process-tabs__header">
                <strong>Pilih jenis transaksi</strong>
                <span>Klik kartu untuk membuka proses yang dibutuhkan</span>
              </div>
              <div className="tug-process-tabs__options" role="tablist" aria-label="Pilih proses TUG">
                {(tugGroup==="penerimaan" ? ["TUG3","TUG10"]
                  : tugGroup==="pengeluaran" ? ["TUG9","TUG8"]
                  : tugGroup==="laporan" ? ["TUG15"]
                  : ["TUG5"]
                ).map(id=>{
                  const u = TUG_UI[id]||{}; const on = tugSubTab===id;
                  return (
                  <button key={id} className={on?"is-active":""} onClick={()=>setTugSubTab(id)} title={u.code} role="tab" aria-selected={on}>
                    <span>{u.code||id}</span>
                    <strong>{u.chip||id}</strong>
                    <small>{on?"Sedang dibuka":"Klik untuk buka"}</small>
                  </button>
                  );
                })}
              </div>
            </section>
            {(can(currentUser, "aksi.buatTransaksi", rolePerms) || hasRole(currentUser, "ADMIN_ULTG")) && (tugSubTab==="TUG3"||tugSubTab==="TUG10"||tugSubTab==="TUG9"||tugSubTab==="TUG8"||tugSubTab==="TUG5") && (
              <div className="tug-action-row">
                <div><span>Aksi transaksi aktif</span><strong>{(TUG_UI[tugSubTab]||{}).title || "Dokumen TUG"}</strong></div>
                <button className="tug-primary-action" onClick={()=>openNewTxn(tugSubTab)}>{(TUG_UI[tugSubTab]||{}).buat || "Buat Baru"}</button>
              </div>
            )}
            <div className="tug-status-filter">
              <span>Status dokumen</span>
              {["ALL","PENDING","APPROVED","REJECTED","DRAFT"].map(s=>(
                <button key={s} className={filterStatus===s?"is-active":""} onClick={()=>setFilterStatus(s)}>{s==="ALL"?"Semua":s==="PENDING"?"Menunggu":s==="APPROVED"?"Disetujui":s==="REJECTED"?"Ditolak":"Draft"}</button>
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
                isMobile={isMobile}
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
                        <div style={{fontSize:12,color:"#0098da",fontWeight:700}}>{t.docNumbers[dKey]}</div>
                      </div>
                      <div style={{display:"flex",gap:6,alignItems:"center"}}>
                        {t.legacyImport && <span title="Diimpor dari histori lama" style={{padding:"2px 8px",borderRadius:20,fontSize:12,fontWeight:700,background:"#ede9fe",color:"#6d28d9"}}>🕘 Legacy</span>}
                        <span style={sty.statusBadge(t.status)}>{t.status}</span>
                      </div>
                    </div>
                    <div style={{fontSize:12,color:C.muted,display:"flex",gap:16,flexWrap:"wrap",marginBottom:8}}>
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
                        return <div key={idx} style={{fontSize:12,padding:"3px 0"}}>📦 {stock?.name||"?"} <b>x{si.qty}</b> {stock?.unit} <span style={{fontSize:12,color:C.muted}}>@ {stock?.lokasi}</span> <span style={sty.jenisBadge(stock?.jenisBarang)}>{stock?.jenisBarang}</span></div>;
                      }) : t.stockItems.map((si,idx)=>{
                        const namaBarang = si.katalogMode==="existing" ? (katalogList.find(k=>k.id===si.katalogId)?.name||"?") : si.namaBaru;
                        const bs = statusMaterialBadgeStyle(si.statusMaterial);
                        return <div key={idx} style={{fontSize:12,padding:"3px 0"}}>📦 {namaBarang} <b>x{si.qty}</b> <span style={{padding:"2px 7px",borderRadius:20,fontSize:12,background:bs.bg,color:bs.fg,fontWeight:700}}>{si.statusMaterial}</span>{si.noSeri && <span style={{fontSize:12,color:C.muted}}> • SN: {si.noSeri}</span>}</div>;
                      })}
                    </div>
                    {t.status==="APPROVED" && <div style={{fontSize:12,color:C.green,marginBottom:8}}>✅ Disetujui oleh {approver.name} ({ROLES[approver.role]}) • {fmtDate(t.approvedAt)} {t.asmanAutoApproved && "• Asman Konstruksi otomatis ikut menyetujui"}</div>}
                    {t.status==="REJECTED" && <div style={{fontSize:12,color:C.red,marginBottom:8}}>❌ Ditolak: {t.rejectReason}</div>}
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
            saveEdit={saveHeavyEquipmentEdit}
            createLoan={createHeavyEquipmentLoan}
            approveLoan={approveHeavyEquipmentLoan}
            rejectLoan={rejectHeavyEquipmentLoan}
            completeLoan={completeHeavyEquipmentLoan}
            showToast={showToast}
          />
        )}

        {tab==="attb" && (
          <AttbTab
            attbList={attbList}
            currentUser={currentUser}
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

        {/* APPROVAL — semua notifikasi approval (TUG, Lokasi/Blok, Pemindahan Stok, dkk) dikumpulkan di sini, dipisah per-bagian + riwayat di bawah */}
        {tab==="approval" && hasRole(currentUser, "TL","ASMAN","MANAGER","ADMIN_UIT","MGR_LOGISTIK_UIT","ADMIN","MGR_ULTG","ADMIN_ULTG") && (
          <div className="approval-page">
            {(()=>{
              const tugCount = myPendingApprovals.length;
              const capCount = hasRole(currentUser, "TL","ASMAN") ? gudangCapacityImports.filter(i=>i.status==="PENDING_ASMAN").length : 0;
              const lokasiCount = hasRole(currentUser, "TL") ? lokasiList.filter(l=>l.status==="PENDING").length : 0;
              const stokCount = hasRole(currentUser, "TL")
                ? stocks.filter(s=>(s.lokasiMovePending&&s.lokasiMoveApprover==="TL")||s.editPending||s.deletePending).length
                : hasRole(currentUser, "ASMAN") ? stocks.filter(s=>s.lokasiMovePending&&s.lokasiMoveApprover==="ASMAN").length : 0;
              const alatBeratCount = hasRole(currentUser, "ASMAN") ? heavyEquipmentPendingCount : 0;
              const opnameCount = hasRole(currentUser, "ASMAN") ? opnameList.filter(o=>o.status==="PENDING_ASMAN").length
                : hasRole(currentUser, "MANAGER") ? opnameList.filter(o=>o.status==="PENDING_MANAGER").length : 0;
              const stockCountCount = hasRole(currentUser, "ASMAN") ? stockCountPendingCount : 0;
              const total = tugCount+capCount+lokasiCount+stokCount+alatBeratCount+opnameCount+stockCountCount;
              const chips = [
                {id:"ALL", icon:"▦", label:"Semua", count:total},
                {id:"TUG", icon:"↔", label:"TUG", count:tugCount},
                {id:"ALAT_BERAT", icon:"⚙", label:"Alat Berat", count:alatBeratCount},
                {id:"OPNAME", icon:"▣", label:"Stock Opname", count:opnameCount},
                {id:"STOCK_COUNT", icon:"≋", label:"Stock Count", count:stockCountCount},
                {id:"STOK", icon:"□", label:"Perubahan Stok", count:stokCount},
                {id:"LOKASI", icon:"⌖", label:"Lokasi / Blok", count:lokasiCount},
                {id:"KAPASITAS", icon:"▥", label:"Kapasitas", count:capCount},
              ].filter(c=>c.id==="ALL"||c.count>0);
              return (
                <div style={{marginBottom:16}}>
                    <div className="approval-hero__summary approval-summary-strip kpi-banner">
                      <div><strong>{total}</strong><span>Menunggu tindakan</span></div>
                      <div><strong>{Math.max(0,chips.length-1)}</strong><span>Kategori aktif</span></div>
                      <div className="approval-role-chip"><span>Wewenang</span><strong>{ROLES[currentUser.role]}</strong></div>
                    </div>
                  {/* Filter jenis approval + pageSize — tepat di bawah subtitle, langsung
                      nyambung ke list di bawahnya (bukan 1 list panjang campur aduk semua jenis). */}
                  {total>0 && (
                    <div className="approval-filterbar">
                      <div className="approval-filterbar__label"><span>FILTER ANTRIAN</span><small>Pilih kategori keputusan</small></div>
                      <div className="approval-filterbar__items">
                        {chips.map(c=>{
                          const active = approvalTypeFilter===c.id;
                          return (
                            <button key={c.id} className={active?"is-active":""} onClick={()=>setApprovalTypeFilter(c.id)}>
                              <span className="approval-filterbar__icon">{c.icon}</span>
                              <span>{c.label}</span>
                              <b>{c.count}</b>
                            </button>
                          );
                        })}
                      </div>
                      <div className="approval-pagesize">
                        Tampilkan
                        <select style={{...sty.select,width:"auto",padding:"3px 6px",minHeight:"unset",fontSize:12}} value={approvalPageSize} onChange={e=>setApprovalPageSize(Number(e.target.value))}>
                          {[10,20,50].map(n=><option key={n} value={n}>{n}</option>)}
                        </select>
                        <span>item</span>
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}

            {(approvalTypeFilter==="ALL"||approvalTypeFilter==="TUG") && (
              <div className="approval-section-title"><span>↔</span><div>Transaksi TUG<small>Dokumen operasional yang membutuhkan keputusan Anda</small></div></div>
            )}
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
              approveCapacityImport={startCapacityApproval}
              rejectCapacityImport={rejectCapacityImport}
              approveLokasiChange={approveLokasiChange}
              rejectLokasiChange={rejectLokasiChange}
              ultgList={ultgList}
              approveTUG5_MgrULTG={approveTUG5_MgrULTG}
              rejectTUG5_MgrULTG={rejectTUG5_MgrULTG}
              ultgPengajuanUntukAdopt={ultgPengajuanUntukAdopt}
              adoptTUG5ULTG={adoptTUG5ULTG}
              openDraftTug9={openDraftTug9}
              heavyEquipmentPendingCount={hasRole(currentUser, "ASMAN") ? heavyEquipmentPendingCount : 0}
              opnamePendingCount={hasRole(currentUser, "ASMAN") ? opnameList.filter(o=>o.status==="PENDING_ASMAN").length : hasRole(currentUser, "MANAGER") ? opnameList.filter(o=>o.status==="PENDING_MANAGER").length : 0}
              stockCountPendingCount={hasRole(currentUser, "ASMAN") ? stockCountPendingCount : 0}
              approvalTypeFilter={approvalTypeFilter}
              approvalPageSize={approvalPageSize}
            />

            {/* ── BAGIAN: Pemindahan Blok Data Stok — pindah Gudang oleh ADMIN, wajib approval TL ── */}
            {(approvalTypeFilter==="ALL"||approvalTypeFilter==="STOK") && hasRole(currentUser, "TL") && stocks.some(s=>s.lokasiMovePending && s.lokasiMoveApprover==="TL") && (()=>{
              const list = stocks.filter(s=>s.lokasiMovePending && s.lokasiMoveApprover==="TL");
              const paged = list.slice((approvalStokPage-1)*approvalPageSize, approvalStokPage*approvalPageSize);
              return (
                <div style={{...sty.card,marginBottom:16,borderLeft:`4px solid ${C.yellow}`}}>
                  <div style={{fontWeight:800,fontSize:14,marginBottom:10}}>📦 Pemindahan Blok Data Stok ({list.length})</div>
                  {paged.map(s=>{
                    const pemohon = users.find(u=>u.id===s.moveRequestedBy);
                    const lokAsal = lokasiList.find(l=>l.id===s.lokasiId);
                    return (
                      <div key={s.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"8px 0",borderBottom:`1px solid ${C.border}`,gap:10}}>
                        <div>
                          <div style={{fontSize:12,fontWeight:700}}>{s.name}</div>
                          <div style={{fontSize:12,color:C.muted}}>{lokAsal?.kode||"—"} → {s.pendingLokasiKode} • Diajukan oleh {pemohon?.name||"?"} • {fmtDate(s.moveRequestedAt)}</div>
                        </div>
                        <div className="approval-actions approval-actions--compact">
                          <button className="approval-btn--approve" onClick={()=>approveStockMove(s.id)}><span className="approval-btn__ic" aria-hidden="true">✓</span>Setuju</button>
                          <button className="approval-btn--reject" onClick={()=>rejectStockMove(s.id)}><span className="approval-btn__ic" aria-hidden="true">✕</span>Tolak</button>
                        </div>
                      </div>
                    );
                  })}
                  {renderApprovalPager(approvalStokPage, setApprovalStokPage, list.length)}
                </div>
              );
            })()}

            {/* ── BAGIAN: Pemindahan Gudang Data Stok — pindah Gudang oleh TL, wajib approval Asman UPT ── */}
            {(approvalTypeFilter==="ALL"||approvalTypeFilter==="STOK") && hasRole(currentUser, "ASMAN") && stocks.some(s=>s.lokasiMovePending && s.lokasiMoveApprover==="ASMAN") && (()=>{
              const list = stocks.filter(s=>s.lokasiMovePending && s.lokasiMoveApprover==="ASMAN");
              const paged = list.slice((approvalStokGudangPage-1)*approvalPageSize, approvalStokGudangPage*approvalPageSize);
              return (
                <div style={{...sty.card,marginBottom:16,borderLeft:`4px solid ${C.yellow}`}}>
                  <div style={{fontWeight:800,fontSize:14,marginBottom:10}}>📦 Pemindahan Gudang Data Stok ({list.length})</div>
                  {paged.map(s=>{
                    const pemohon = users.find(u=>u.id===s.moveRequestedBy);
                    const lokAsal = lokasiList.find(l=>l.id===s.lokasiId);
                    return (
                      <div key={s.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"8px 0",borderBottom:`1px solid ${C.border}`,gap:10}}>
                        <div>
                          <div style={{fontSize:12,fontWeight:700}}>{s.name}</div>
                          <div style={{fontSize:12,color:C.muted}}>{lokAsal?.kode||"—"} → {s.pendingLokasiKode} • Diajukan oleh {pemohon?.name||"?"} • {fmtDate(s.moveRequestedAt)}</div>
                        </div>
                        <div className="approval-actions approval-actions--compact">
                          <button className="approval-btn--approve" onClick={()=>approveStockMove(s.id)}><span className="approval-btn__ic" aria-hidden="true">✓</span>Setuju</button>
                          <button className="approval-btn--reject" onClick={()=>rejectStockMove(s.id)}><span className="approval-btn__ic" aria-hidden="true">✕</span>Tolak</button>
                        </div>
                      </div>
                    );
                  })}
                  {renderApprovalPager(approvalStokGudangPage, setApprovalStokGudangPage, list.length)}
                </div>
              );
            })()}

            {/* ── BAGIAN: Edit Data Stok (qty/harga/jenis) — khusus TL ── */}
            {(approvalTypeFilter==="ALL"||approvalTypeFilter==="STOK") && hasRole(currentUser, "TL") && stocks.some(s=>s.editPending) && (()=>{
              const list = stocks.filter(s=>s.editPending);
              const paged = list.slice((approvalEditStokPage-1)*approvalPageSize, approvalEditStokPage*approvalPageSize);
              return (
                <div style={{...sty.card,marginBottom:16,borderLeft:`4px solid ${C.yellow}`}}>
                  <div style={{fontWeight:800,fontSize:14,marginBottom:10}}>✏️ Edit Data Stok ({list.length})</div>
                  {paged.map(s=>{
                    const pemohon = users.find(u=>u.id===s.editRequestedBy);
                    return (
                      <div key={s.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"8px 0",borderBottom:`1px solid ${C.border}`,gap:10}}>
                        <div>
                          <div style={{fontSize:12,fontWeight:700}}>{s.name}</div>
                          <div style={{fontSize:12,color:C.muted}}>
                            Qty {fmtNum(s.qty)}→{fmtNum(s.pendingEditData.qty)} • Harga Rp{fmtNum(s.price)}→Rp{fmtNum(s.pendingEditData.price)} • Jenis {s.jenisBarang}→{s.pendingEditData.jenisBarang}<br/>
                            Diajukan oleh {pemohon?.name||"?"} • {fmtDate(s.editRequestedAt)}
                          </div>
                        </div>
                        <div className="approval-actions approval-actions--compact">
                          <button className="approval-btn--approve" onClick={()=>approveStockEdit(s.id)}><span className="approval-btn__ic" aria-hidden="true">✓</span>Setuju</button>
                          <button className="approval-btn--reject" onClick={()=>rejectStockEdit(s.id)}><span className="approval-btn__ic" aria-hidden="true">✕</span>Tolak</button>
                        </div>
                      </div>
                    );
                  })}
                  {renderApprovalPager(approvalEditStokPage, setApprovalEditStokPage, list.length)}
                </div>
              );
            })()}

            {/* ── BAGIAN: Hapus Data Stok — khusus TL ── */}
            {(approvalTypeFilter==="ALL"||approvalTypeFilter==="STOK") && hasRole(currentUser, "TL") && stocks.some(s=>s.deletePending) && (()=>{
              const list = stocks.filter(s=>s.deletePending);
              const paged = list.slice((approvalHapusStokPage-1)*approvalPageSize, approvalHapusStokPage*approvalPageSize);
              return (
                <div style={{...sty.card,marginBottom:16,borderLeft:`4px solid ${C.red}`}}>
                  <div style={{fontWeight:800,fontSize:14,marginBottom:10}}>🗑️ Hapus Data Stok ({list.length})</div>
                  {paged.map(s=>{
                    const pemohon = users.find(u=>u.id===s.deleteRequestedBy);
                    return (
                      <div key={s.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"8px 0",borderBottom:`1px solid ${C.border}`,gap:10}}>
                        <div>
                          <div style={{fontSize:12,fontWeight:700}}>{s.name}</div>
                          <div style={{fontSize:12,color:C.muted}}>Diajukan oleh {pemohon?.name||"?"} • {fmtDate(s.deleteRequestedAt)}</div>
                        </div>
                        <div className="approval-actions approval-actions--compact">
                          <button className="approval-btn--approve" onClick={()=>approveStockDelete(s.id)}><span className="approval-btn__ic" aria-hidden="true">✓</span>Setuju</button>
                          <button className="approval-btn--reject" onClick={()=>rejectStockDelete(s.id)}><span className="approval-btn__ic" aria-hidden="true">✕</span>Tolak</button>
                        </div>
                      </div>
                    );
                  })}
                  {renderApprovalPager(approvalHapusStokPage, setApprovalHapusStokPage, list.length)}
                </div>
              );
            })()}

            {/* ── BAGIAN: Peminjaman Alat Berat — khusus ASMAN ── */}
            {(approvalTypeFilter==="ALL"||approvalTypeFilter==="ALAT_BERAT") && hasRole(currentUser, "ASMAN") && heavyEquipmentLoans.some(l=>isPendingHeavyEquipmentLoan(l) && canApproveHeavyEquipmentLoan(currentUser, l)) && (()=>{
              const list = heavyEquipmentLoans.filter(l=>isPendingHeavyEquipmentLoan(l) && canApproveHeavyEquipmentLoan(currentUser, l));
              const paged = list.slice((approvalAlatBeratPage-1)*approvalPageSize, approvalAlatBeratPage*approvalPageSize);
              return (
                <div style={{...sty.card,marginBottom:16,borderLeft:`4px solid ${C.yellow}`}}>
                  <div style={{fontWeight:800,fontSize:14,marginBottom:10}}>🚜 Peminjaman Alat Berat ({list.length})</div>
                  {paged.map(l=>{
                    const alat = heavyEquipmentList.find(eq=>eq.id===l.equipmentId);
                    const pemohon = users.find(u=>u.id===l.requestedBy);
                    const ownerUpt = getHeavyEquipmentLoanOwnerUpt(l);
                    const requesterUpt = getHeavyEquipmentLoanRequesterUpt(l);
                    return (
                      <div key={l.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"8px 0",borderBottom:`1px solid ${C.border}`,gap:10}}>
                        <div>
                          <div style={{fontSize:12,fontWeight:700}}>{alat?.nama||l.equipmentId} • {ownerUpt} → {requesterUpt}</div>
                          <div style={{fontSize:12,color:C.muted}}>{getHeavyEquipmentLoanStartDate(l)} s/d {getHeavyEquipmentLoanReturnDate(l)} • Diajukan oleh {pemohon?.name||"?"} • {fmtDate(l.requestedAt)}</div>
                          <div style={{fontSize:12,color:C.text,marginTop:2}}>{getHeavyEquipmentLoanJobName(l)}{l.keperluan ? ` • ${l.keperluan}` : ""}</div>
                        </div>
                        <div className="approval-actions approval-actions--compact" style={{flexShrink:0}}>
                          <button className="approval-btn--approve" onClick={()=>approveHeavyEquipmentLoan(l.id)}><span className="approval-btn__ic" aria-hidden="true">✓</span>Setuju</button>
                          <button className="approval-btn--reject" onClick={()=>{
                            const rejectReason = window.prompt("Alasan penolakan peminjaman alat?");
                            if (rejectReason) rejectHeavyEquipmentLoan(l.id, rejectReason);
                          }}><span className="approval-btn__ic" aria-hidden="true">✕</span>Tolak</button>
                        </div>
                      </div>
                    );
                  })}
                  {renderApprovalPager(approvalAlatBeratPage, setApprovalAlatBeratPage, list.length)}
                </div>
              );
            })()}

            {/* ── BAGIAN: Stock Opname — Asman/Manager (dulu cuma muncul di menu Stock Opname
                sendiri, tidak pernah tampil di halaman Approval terpusat ini — keluhan user
                2026-07-07 "tidak masuk ke approval asman"). ── */}
            {(approvalTypeFilter==="ALL"||approvalTypeFilter==="OPNAME") && hasRole(currentUser, "ASMAN","MANAGER") &&
              opnameList.some(o=>(hasRole(currentUser, "ASMAN")&&o.status==="PENDING_ASMAN")||(hasRole(currentUser, "MANAGER")&&o.status==="PENDING_MANAGER")) && (()=>{
              const list = opnameList.filter(o=>(hasRole(currentUser, "ASMAN")&&o.status==="PENDING_ASMAN")||(hasRole(currentUser, "MANAGER")&&o.status==="PENDING_MANAGER"));
              const paged = list.slice((approvalOpnamePage-1)*approvalPageSize, approvalOpnamePage*approvalPageSize);
              return (
                <div style={{...sty.card,marginBottom:16,borderLeft:`4px solid ${C.yellow}`}}>
                  <div style={{fontWeight:800,fontSize:14,marginBottom:10}}>📋 Stock Opname ({list.length})</div>
                  {paged.map(opn=>{
                    const selisihCount = opn.items?.filter(i=>i.selisih!==0).length||0;
                    const pengaju = users.find(u=>u.id===opn.dibuatOleh);
                    return (
                      <div key={opn.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"8px 0",borderBottom:`1px solid ${C.border}`,gap:10}}>
                        <div>
                          <div style={{fontSize:12,fontWeight:700}}>Opname {opn.semester} — {opn.jenisAlur}</div>
                          <div style={{fontSize:12,color:C.muted}}>{opn.items?.length||0} item • Selisih: {selisihCount} item • Diajukan oleh {pengaju?.name||"?"} • {fmtDate(opn.submittedAt)}</div>
                        </div>
                        <div className="approval-actions approval-actions--compact" style={{flexShrink:0}}>
                          <button className="approval-btn--approve" onClick={()=>hasRole(currentUser, "ASMAN")?approveOpname_Asman(opn,""):approveOpname_Manager(opn,"")}><span className="approval-btn__ic" aria-hidden="true">✓</span>Setuju</button>
                          <button className="approval-btn--reject" onClick={()=>{
                            const reason = window.prompt("Alasan penolakan Stock Opname ini?");
                            if (reason) rejectOpname(opn, reason);
                          }}><span className="approval-btn__ic" aria-hidden="true">✕</span>Tolak</button>
                        </div>
                      </div>
                    );
                  })}
                  {renderApprovalPager(approvalOpnamePage, setApprovalOpnamePage, list.length)}
                </div>
              );
            })()}

            {/* ── BAGIAN: Stock Count — temuan selisih per-item, di-approve ASMAN (dulu cuma
                muncul di menu Stock Opname & Count sendiri, tidak pernah tampil di halaman
                Approval terpusat ini — gap visibilitas sama seperti Stock Opname). ── */}
            {(approvalTypeFilter==="ALL"||approvalTypeFilter==="STOCK_COUNT") && hasRole(currentUser, "ASMAN") &&
              stockCountList.some(s=>s.items.some(i=>i.approval==="PENDING")) && (()=>{
              const list = stockCountList.flatMap(s=>s.items.filter(i=>i.approval==="PENDING").map(i=>({session:s, item:i})));
              const paged = list.slice((approvalStockCountPage-1)*approvalPageSize, approvalStockCountPage*approvalPageSize);
              return (
                <div style={{...sty.card,marginBottom:16,borderLeft:`4px solid ${C.yellow}`}}>
                  <div style={{fontWeight:800,fontSize:14,marginBottom:10}}>📊 Stock Count ({list.length})</div>
                  {paged.map(({session,item})=>(
                    <div key={`${session.id}_${item.id}`} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"8px 0",borderBottom:`1px solid ${C.border}`,gap:10}}>
                      <div>
                        <div style={{fontSize:12,fontWeight:700}}>{item.nama}</div>
                        <div style={{fontSize:12,color:C.muted}}>No. Katalog {item.katalogKode} • SAP {fmtNum(item.qtySap)} vs Aplikasi {item.katalogId?fmtNum(item.qtyApp):"Tidak terdaftar"} {item.satuan} • Selisih {item.selisih>0?"+":""}{fmtNum(item.selisih)} ({item.selisihPct}%) • {fmtDate(session.uploadedAt)}</div>
                      </div>
                      <div className="approval-actions approval-actions--compact" style={{flexShrink:0}}>
                        <button className="approval-btn--approve" onClick={()=>approveStockCountItem(session.id, item.id, "")}><span className="approval-btn__ic" aria-hidden="true">✓</span>Setuju</button>
                        <button className="approval-btn--reject" onClick={()=>{
                          const reason = window.prompt("Alasan penolakan temuan Stock Count ini?");
                          if (reason) rejectStockCountItem(session.id, item.id, reason);
                        }}><span className="approval-btn__ic" aria-hidden="true">✕</span>Tolak</button>
                      </div>
                    </div>
                  ))}
                  {renderApprovalPager(approvalStockCountPage, setApprovalStockCountPage, list.length)}
                </div>
              );
            })()}

            {/* ── BAGIAN: Riwayat Approval (gabungan semua jenis, terbaru di atas) ── */}
            {(()=>{
              const histTUG = txns.filter(t=>t.status==="APPROVED"||t.status==="REJECTED").map(t=>({
                id:`TUG-${t.id}`, type:"TUG", decision:t.status,
                title:`${t.docType||"TUG"} • ${t.id}`,
                decidedBy: t.status==="REJECTED" ? t.rejectedBy : t.approvedBy,
                decidedAt: t.status==="REJECTED" ? t.rejectedAt : t.approvedAt,
              }));
              const combinedAll = [...approvalHistoryList, ...histTUG].filter(h=>h.decidedAt).sort((a,b)=>b.decidedAt-a.decidedAt);
              const combined = combinedAll.slice((approvalHistoryPage-1)*approvalPageSize, approvalHistoryPage*approvalPageSize);
              const typeLabel = {LOKASI:"📍 Lokasi/Blok", STOCK_MOVE:"📦 Pemindahan Stok", STOCK_EDIT:"✏️ Edit Stok", STOCK_DELETE:"🗑️ Hapus Stok", HEAVY_EQUIPMENT_LOAN:"🚜 Peminjaman Alat", TUG:"🔄 TUG", OPNAME:"📋 Stock Opname", STOCK_COUNT:"📊 Stock Count"};
              const typeOrder = ["TUG","HEAVY_EQUIPMENT_LOAN","OPNAME","STOCK_COUNT","LOKASI","STOCK_MOVE","STOCK_EDIT","STOCK_DELETE"];
              const groupsByType = typeOrder
                .map(type=>({ type, items: combined.filter(h=>h.type===type) }))
                .filter(g=>g.items.length>0);
              // Jenis lain yang mungkin muncul di masa depan tapi belum ada di typeOrder — tetap ditampilkan.
              const knownTypes = new Set(typeOrder);
              combined.forEach(h=>{ if(!knownTypes.has(h.type)){ knownTypes.add(h.type); groupsByType.push({type:h.type, items:combined.filter(x=>x.type===h.type)}); } });
              return (
                <div style={{...sty.card,marginTop:16}}>
                  <div style={{fontWeight:800,fontSize:14,marginBottom:10}}>📜 Riwayat Approval ({combinedAll.length})</div>
                  {combinedAll.length===0 && <div style={{textAlign:"center",color:C.muted,padding:20,fontSize:13}}>Belum ada riwayat approval.</div>}
                  {groupsByType.map(g=>(
                    <div key={g.type} style={{marginBottom:14}}>
                      <div style={{fontSize:12,fontWeight:800,color:"#0098da",marginBottom:4}}>{typeLabel[g.type]||g.type} ({g.items.length})</div>
                      {g.items.map(h=>{
                        const decider = users.find(u=>u.id===h.decidedBy);
                        return (
                          <div key={h.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"8px 0",borderBottom:`1px solid ${C.border}`,gap:10}}>
                            <div>
                              <div style={{fontSize:12,fontWeight:700}}>{h.title}</div>
                              <div style={{fontSize:12,color:C.muted}}>Oleh {decider?.name||"?"} • {fmtDate(h.decidedAt)}</div>
                            </div>
                            <span style={{padding:"3px 10px",borderRadius:20,fontSize:12,fontWeight:700,background:h.decision==="APPROVED"?"#dcfce7":"#fee2e2",color:h.decision==="APPROVED"?C.green:C.red}}>
                              {h.decision==="APPROVED"?"✓ Disetujui":"✕ Ditolak"}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  ))}
                  {renderApprovalPager(approvalHistoryPage, setApprovalHistoryPage, combinedAll.length)}
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
            setKatalogList={setKatalogList}
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
            C={C} sty={sty}
          />
        )}

        {/* MATURITY AUDIT — Penilaian Maturity Level Gudang UPT */}
        {tab==="maturity" && (
          <div style={{display:"flex",flexDirection:"column",gap:16}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",borderBottom:`1px solid ${C.border}`,paddingBottom:12,marginBottom:8,flexWrap:"wrap",gap:12}}>
              <div style={{display:"flex",gap:8}}>
                <button
                  style={{...sty.btn(maturitySubTab==="pelaksanaan"?"primary":"ghost","sm")}}
                  onClick={()=>setMaturitySubTab("pelaksanaan")}
                >
                  📋 Pelaksanaan Audit
                </button>
                <button
                  style={{...sty.btn(maturitySubTab==="5s"?"primary":"ghost","sm")}}
                  onClick={()=>setMaturitySubTab("5s")}
                >
                  ✨ Form Checklist 5S
                </button>
              </div>

              {/* Selector UPT untuk pemantauan / penilaian multi-UPT */}
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                <span style={{fontSize:12,fontWeight:700,color:C.muted}}>Unit UPT:</span>
                <select
                  style={{...sty.input,width:"auto",padding:"6px 12px",fontSize:12,fontWeight:700,borderRadius:8,background:C.surface,color:C.text}}
                  value={selectedMaturityUpt}
                  onChange={e => setSelectedMaturityUpt(e.target.value)}
                >
                  {(uptList.length > 0 ? uptList : DEFAULT_UPT_LIST).map(u => (
                    <option key={u.id} value={u.nama}>{u.nama}</option>
                  ))}
                </select>
              </div>
            </div>

            {maturitySubTab==="5s" ? (
              <Form5STab
                C={C}
                sty={sty}
                currentUser={currentUser}
                lokasiList={lokasiList}
                setMaturityAuditEvidence={setMaturityAuditEvidence}
                onBack={()=>setMaturitySubTab("pelaksanaan")}
                isMobile={isMobile}
                selectedUpt={selectedMaturityUpt}
              />
            ) : (
              <MaturityAuditEditor
                maturityAuditModal={maturityAuditModal}
                setMaturityAuditModal={setMaturityAuditModal}
                maturityAuditForm={maturityAuditForm}
                setMaturityAuditForm={setMaturityAuditForm}
                maturityAuditEvidence={maturityAuditEvidence}
                setMaturityAuditEvidence={setMaturityAuditEvidence}
                maturityAuditSaving={maturityAuditSaving}
                saveMaturityAudit={saveMaturityAudit}
                deleteMaturityAudit={deleteMaturityAudit}
                currentUser={currentUser}
                hasRole={hasRole}
                selectedUpt={selectedMaturityUpt}
                isMobile={isMobile}
                C={C}
                sty={sty}
              />
            )}
          </div>
        )}

        {/* INSPEKSI MATERIAL CADANG */}
        {tab==="inspeksiMaterial" && (
          <InspeksiMaterialCadangTab
            stocks={stocks}
            katalogList={katalogList}
            lokasiList={lokasiList}
            materialInspections={materialInspections}
            setMaterialInspections={setMaterialInspections}
            currentUser={currentUser}
            C={C}
            sty={sty}
            isMobile={isMobile}
            showToast={showToast}
            saveToCloud={saveToCloud}
          />
        )}

        </div>
      </main>

      {/* STOCK MODAL (Data Stok = junction of Katalog x Lokasi) */}
      {stockModal && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000,padding:16}}>
          <div style={{...sty.card,width:520,maxWidth:"100%",maxHeight:"90dvh",overflowY:"auto"}}>
            <div style={sty.modalHeader}><span style={{fontWeight:800,fontSize:15}}>{stockModal==="edit"?"Edit Data Stok":"Tambah Data Stok Baru"}</span><button onClick={()=>setStockModal(null)} style={{background:"transparent",border:"none",color:"white",fontSize:24,lineHeight:1,cursor:"pointer",padding:0,opacity:0.85}}>×</button></div>
            <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"1fr 1fr",gap:12}}>
              <div style={{gridColumn:"1/-1"}}>
                <label style={sty.label}>Barang (dari Master Katalog)</label>
                <select style={sty.select} value={stockForm.katalogId||""} onChange={e=>setStockForm(sf=>({...sf,katalogId:e.target.value}))}>
                  <option value="">-- Pilih Barang --</option>
                  {katalogList.map(k=><option key={k.id} value={k.id}>{k.name} [{k.katalog}]</option>)}
                </select>
                {katalogList.length===0 && <div style={{fontSize:12,color:"#be185d",marginTop:4}}>Belum ada Master Katalog. Tambahkan dulu di tab "Master Katalog".</div>}
              </div>
              <div style={{gridColumn:"1/-1"}}>
                <label style={sty.label}>Lokasi (dari Master Lokasi)</label>
                <select style={sty.select} value={stockForm.lokasiId||""} onChange={e=>setStockForm(sf=>({...sf,lokasiId:e.target.value}))}>
                  <option value="">-- Pilih Lokasi --</option>
                  {lokasiList.map(l=><option key={l.id} value={l.id}>{l.kode} {l.keterangan ? `— ${l.keterangan}` : ""}</option>)}
                </select>
                {lokasiList.length===0 && <div style={{fontSize:12,color:"#be185d",marginTop:4}}>Belum ada Blok Lokasi. Tambahkan dulu di Master Data → Master Gudang.</div>}
              </div>
              <div><label style={sty.label}>Harga Satuan (Rp)</label><input style={sty.input} type="number" inputMode="decimal" value={stockForm.price||0} onChange={e=>setStockForm(sf=>({...sf,price:Number(e.target.value)}))}/></div>
              <div><label style={sty.label}>Qty di Lokasi Ini</label><input style={sty.input} type="number" inputMode="decimal" value={stockForm.qty||0} onChange={e=>setStockForm(sf=>({...sf,qty:Number(e.target.value)}))}/></div>
              <div><label style={sty.label}>Min Qty Alert</label><input style={sty.input} type="number" inputMode="decimal" value={stockForm.minQty||0} onChange={e=>setStockForm(sf=>({...sf,minQty:Number(e.target.value)}))}/></div>
              <div>
                <label style={sty.label}>Jenis Barang</label>
                <select style={sty.select} value={stockForm.jenisBarang||"Cadang"} onChange={e=>setStockForm(sf=>({...sf,jenisBarang:e.target.value}))}>{JENIS_BARANG.map(j=><option key={j}>{j}</option>)}</select>
                {stockForm.jenisBarang==="Non-Stock" && <div style={{fontSize:12,color:"#be185d",marginTop:4}}>ℹ️ Barang khusus proyek — tidak dihitung dalam alert stok minimum</div>}
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
                <div style={{gridColumn:"1/-1",fontSize:12,color:C.muted}}>ℹ️ Data hasil import SAP (PEMAT) — foto Nameplate/Keseluruhan akan disinkronkan saat import data PEMAT berikutnya, tidak wajib diisi sekarang.</div>
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
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000,padding:16}}>
          <div style={{...sty.card,width:460,maxWidth:"100%",maxHeight:"90dvh",overflowY:"auto"}}>
            <div style={sty.modalHeader}><span style={{fontWeight:800,fontSize:15}}>{katalogModal==="edit"?"Edit Master Katalog":"Tambah Katalog Barang Baru"}</span><button onClick={()=>setKatalogModal(null)} style={{background:"transparent",border:"none",color:"white",fontSize:24,lineHeight:1,cursor:"pointer",padding:0,opacity:0.85}}>×</button></div>
            {/* MARA Referensi Search */}
            <div style={{marginBottom:16,background:"#f0f9ff",border:"1px solid #bae6fd",borderRadius:10,padding:12}}>
              <div style={{fontSize:12,fontWeight:800,color:"#0369a1",marginBottom:8}}>🔍 Cari Referensi MARA</div>
              <div style={{display:"flex",gap:6}}>
                <input style={{...sty.input,flex:1}} value={maraSearch} placeholder="Ketik nama material MARA (min. 2 huruf)..."
                  onChange={e=>searchMaraCatalog(e.target.value)}/>
                {maraSearch && <button style={sty.btn("ghost","sm")} onClick={()=>{setMaraSearch("");setMaraSearchResults([])}}>✕</button>}
              </div>
              {maraSearchLoading && <div style={{fontSize:12,color:"#0369a1",marginTop:6}}>Mencari...</div>}
              {maraSearchError && <div style={{fontSize:12,color:C.red,marginTop:6,padding:"6px 8px",background:"#fef2f2",borderRadius:6}}>⚠️ {maraSearchError}</div>}
              {maraSearchResults.length>0 && (
                <div style={{marginTop:8,maxHeight:180,overflowY:"auto",display:"flex",flexDirection:"column",gap:4}}>
                  {maraSearchResults.map(item=>(
                    <div key={item.kode_material} onClick={()=>applyMaraToKatalog(item)}
                      style={{padding:"6px 10px",borderRadius:7,border:"1px solid #bae6fd",background:C.surface,cursor:"pointer",fontSize:12,display:"flex",justifyContent:"space-between",gap:8}}
                      onMouseEnter={e=>e.currentTarget.style.background="#e0f2fe"}
                      onMouseLeave={e=>e.currentTarget.style.background=C.surface}>
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
                <div style={{fontSize:12,color:"#64748b",marginTop:6}}>Tidak ada hasil untuk "{maraSearch}"</div>
              )}
              <div style={{fontSize:12,color:"#94a3b8",marginTop:6}}>Klik item untuk auto-fill form. MARA tersimpan di database.</div>
            </div>
            {katalogForm._maraLocked && (
              <div style={{marginBottom:12,display:"flex",justifyContent:"space-between",alignItems:"center",background:"#f0fdf4",border:"1px solid #bbf7d0",borderRadius:8,padding:"8px 10px"}}>
                <span style={{fontSize:12,color:"#166534"}}>🔒 Terkunci dari referensi MARA — Nomor Katalog, Nama, Kategori, Satuan tidak bisa diketik manual.</span>
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
            <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"1fr 1fr",gap:12,marginBottom:12}}>
              <div>
                <label style={sty.label}>Kategori</label>
                {katalogForm._maraLocked ? (
                  <input style={{...sty.input,background:"#f3f4f6",color:C.muted}} disabled value={katalogForm.category||"-"} title="Material Group Desc dari MARA — bukan kategori standar aplikasi"/>
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
      {hasRole(currentUser, "ADMIN") && ocrSuggestGudangId && ocrSuggestions.length>0 && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1100}}>
          <div style={{...sty.card,width:520,maxWidth:"100%",maxHeight:"85dvh",overflowY:"auto"}}>
            <h3 style={{fontSize:18,fontWeight:800,marginBottom:6}}>📋 Usulan Blok dari Denah {ocrSuggestSubGudangId?"(Sub Gudang)":"(Gudang)"} ({ocrSuggestions.length})</h3>
            <p style={{fontSize:12,color:C.muted,marginBottom:16}}>Lengkapi data tiap usulan, lalu konfirmasi untuk mengirim ke approval TL.</p>
            <div style={{display:"flex",flexDirection:"column",gap:12,marginBottom:16}}>
              {ocrSuggestions.map(s=>(
                <div key={s.id} style={{border:`1px solid ${C.border}`,borderRadius:8,padding:12,background:s.checked?"#fefce8":"#f9fafb"}}>
                  <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}>
                    <input type="checkbox" checked={s.checked} onChange={e=>updateOcrSuggestion(s.id,{checked:e.target.checked})}/>
                    <span style={{fontSize:12,color:C.muted}}>Posisi: {s.xPct}%, {s.yPct}%</span>
                    <button style={{...sty.btn("danger","sm"),marginLeft:"auto"}} onClick={()=>removeOcrSuggestion(s.id)}>🗑️ Hapus</button>
                  </div>
                  <div style={{marginBottom:8}}>
                    <label style={sty.label}>Nama Area <span style={{color:C.red}}>*wajib</span></label>
                    <input style={sty.input} value={s.kode} placeholder="cth: Rak A-1" onChange={e=>updateOcrSuggestion(s.id,{kode:e.target.value})}/>
                  </div>
                  <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"1fr 1fr",gap:8}}>
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
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000,padding:16}}>
          <div style={{...sty.card,width:420,maxWidth:"100%",maxHeight:"90dvh",overflowY:"auto"}}>
            <div style={sty.modalHeader}><span style={{fontWeight:800,fontSize:15}}>{lokasiModal==="edit"?"Edit Master Lokasi":"Tambah Lokasi Gudang Baru"}</span><button onClick={()=>setLokasiModal(null)} style={{background:"transparent",border:"none",color:"white",fontSize:24,lineHeight:1,cursor:"pointer",padding:0,opacity:0.85}}>×</button></div>
            {gudangList.length===0 ? (
              <div style={{background:"#fef3c7",border:`1px solid #fcd34d`,borderRadius:8,padding:"10px 12px",fontSize:12,color:"#92400e",marginBottom:16}}>⚠️ Belum ada Master Gudang. Tambahkan Gudang dulu di menu "Master Data" → "Master Gudang" sebelum bisa mengisi Blok — data harus berjenjang: Gudang dulu, baru Blok.</div>
            ) : (
              <div style={{background:"#dbeafe",border:`1px solid #93c5fd`,borderRadius:8,padding:"10px 12px",fontSize:12,color:"#1e40af",marginBottom:16}}>ℹ️ Pilih Gudang dulu, baru isi data Blok-nya (berjenjang).</div>
            )}
            <div style={{marginBottom:12}}>
              <label style={sty.label}>Gudang *</label>
              <select style={sty.select} value={lokasiForm.gudangId||""} disabled={gudangList.length===0 || lokasiModal==="edit"} onChange={e=>setLokasiForm(lf=>({...lf,gudangId:e.target.value||null,subGudangId:null}))}>
                <option value="">-- Pilih Gudang --</option>
                {visibleGudangList.map(g=><option key={g.id} value={g.id}>{g.nama}</option>)}
              </select>
              {lokasiModal==="edit" && <div style={{fontSize:12,color:C.muted,marginTop:4}}>Gudang tidak bisa diubah saat edit blok. Hapus & buat ulang blok jika perlu pindah Gudang.</div>}
            </div>
            {lokasiForm.gudangId && (
              <div style={{marginBottom:12}}>
                <label style={sty.label}>Sub Gudang</label>
                <select style={sty.select} value={lokasiForm.subGudangId||""} disabled={lokasiModal==="edit"} onChange={e=>setLokasiForm(lf=>({...lf,subGudangId:e.target.value||null}))}>
                  <option value="">-- Umum / Tidak ada Sub Gudang --</option>
                  {subGudangList.filter(sg=>sg.gudangId===lokasiForm.gudangId).map(sg=><option key={sg.id} value={sg.id}>{sg.nama}</option>)}
                </select>
                {lokasiModal==="edit" && <div style={{fontSize:12,color:C.muted,marginTop:4}}>Sub Gudang tidak bisa diubah saat edit blok.</div>}
              </div>
            )}
            <div style={{marginBottom:12}}><label style={sty.label}>Kode Lokasi (Blok)</label><input style={sty.input} value={lokasiForm.kode||""} placeholder="cth: Rak A-1" disabled={!lokasiForm.gudangId} onChange={e=>setLokasiForm(lf=>({...lf,kode:e.target.value}))}/></div>
            <div style={{marginBottom:12}}><label style={sty.label}>Keterangan Area</label><input style={sty.input} value={lokasiForm.keterangan||""} placeholder="cth: Area Transformator" disabled={!lokasiForm.gudangId} onChange={e=>setLokasiForm(lf=>({...lf,keterangan:e.target.value}))}/></div>
            <div style={{marginBottom:12}}><label style={sty.label}>Kapasitas Maksimal (m²)</label><input style={sty.input} type="number" inputMode="decimal" value={lokasiForm.kapasitas||0} placeholder="cth: 50" disabled={!lokasiForm.gudangId} onChange={e=>setLokasiForm(lf=>({...lf,kapasitas:Number(e.target.value)}))}/></div>
            <div style={{display:"flex",gap:10,marginTop:20}}>
              <button style={{...sty.btn("ghost"),flex:1}} onClick={()=>setLokasiModal(null)}>Batal</button>
              <button style={{...sty.btn("primary"),flex:2}} disabled={!lokasiForm.gudangId} onClick={saveLokasi}>💾 Simpan ke Cloud</button>
            </div>
          </div>
        </div>
      )}

      {/* KONFIRMASI HAPUS BLOK GUDANG */}
      {lokasiDeleteConfirm && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.55)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1100,padding:16}} onClick={()=>setLokasiDeleteConfirm(null)}>
          <div style={{...sty.card,width:380,maxWidth:"100%",textAlign:"center",boxShadow:"0 20px 50px rgba(0,0,0,0.3)"}} onClick={e=>e.stopPropagation()}>
            <div style={{width:56,height:56,borderRadius:"50%",background:"#fee2e2",display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 14px",fontSize:26}}>🗑️</div>
            <h3 style={{fontSize:16,fontWeight:800,marginBottom:6}}>Hapus Blok Gudang?</h3>
            <div style={{fontSize:13,color:C.muted,marginBottom:14,lineHeight:1.5}}>
              Apakah Anda yakin ingin menghapus blok gudang <b style={{color:C.text}}>{lokasiDeleteConfirm.kode}</b>
              {lokasiDeleteConfirm.keterangan ? <> ({lokasiDeleteConfirm.keterangan})</> : null}
              {" "}pada Gudang <b style={{color:C.text}}>{gudangList.find(g=>g.id===lokasiDeleteConfirm.gudangId)?.nama||"-"}</b>?
            </div>
            <div style={{fontSize:12,color:"#92400e",background:"#fef3c7",border:"1px solid #fcd34d",borderRadius:8,padding:"8px 12px",marginBottom:20}}>
              ⚠️ Tindakan ini tidak bisa dibatalkan dan ada {stocks.filter(s=>s.lokasiId===lokasiDeleteConfirm.id).length} material terdaftar di blok ini.
            </div>
            <div style={{display:"flex",gap:10}}>
              <button style={{...sty.btn("ghost"),flex:1}} onClick={()=>setLokasiDeleteConfirm(null)}>Batal</button>
              <button style={{...sty.btn("danger"),flex:1}} onClick={confirmDeleteLokasi}>🗑️ Ya, Hapus</button>
            </div>
          </div>
        </div>
      )}

      {/* KONFIRMASI HAPUS — GENERIK, dipakai semua Master Data lain (Katalog, Satpam, UIT, ULTG, UPT, Gudang) */}
      {confirmDialog && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.55)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1100,padding:16}} onClick={()=>setConfirmDialog(null)}>
          <div style={{...sty.card,width:380,maxWidth:"100%",textAlign:"center",boxShadow:"0 20px 50px rgba(0,0,0,0.3)"}} onClick={e=>e.stopPropagation()}>
            <div style={{width:56,height:56,borderRadius:"50%",background:"#fee2e2",display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 14px",fontSize:26}}>🗑️</div>
            <h3 style={{fontSize:16,fontWeight:800,marginBottom:6}}>{confirmDialog.title}</h3>
            <div style={{fontSize:13,color:C.muted,marginBottom:14,lineHeight:1.5}}>{confirmDialog.message}</div>
            {confirmDialog.warning && (
              <div style={{fontSize:12,color:"#92400e",background:"#fef3c7",border:"1px solid #fcd34d",borderRadius:8,padding:"8px 12px",marginBottom:20}}>
                ⚠️ {confirmDialog.warning}
              </div>
            )}
            <div style={{display:"flex",gap:10}}>
              <button style={{...sty.btn("ghost"),flex:1}} onClick={()=>setConfirmDialog(null)}>Batal</button>
              <button style={{...sty.btn("danger"),flex:1}} onClick={()=>{ const fn=confirmDialog.onConfirm; setConfirmDialog(null); fn?.(); }}>{confirmDialog.confirmLabel}</button>
            </div>
          </div>
        </div>
      )}

      {/* SATPAM MODAL */}
      {satpamModal && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000,padding:16}}>
          <div style={{...sty.card,width:400,maxWidth:"100%",maxHeight:"90dvh",overflowY:"auto"}}>
            <div style={sty.modalHeader}><span style={{fontWeight:800,fontSize:15}}>{satpamModal==="edit"?"Edit Satpam":"Tambah Satpam Baru"}</span><button onClick={()=>setSatpamModal(null)} style={{background:"transparent",border:"none",color:"white",fontSize:24,lineHeight:1,cursor:"pointer",padding:0,opacity:0.85}}>×</button></div>
            <div style={{marginBottom:12}}>
              <label style={sty.label}>Nama Satpam</label>
              <input style={sty.input} value={satpamForm.name||""} onChange={e=>setSatpamForm(sf=>({...sf,name:e.target.value}))} placeholder="cth: Robby Demas Riady"/>
            </div>
            <div style={{marginBottom:12}}>
              <label style={sty.label}>No. Telepon (opsional)</label>
              <input style={sty.input} value={satpamForm.telp||""} onChange={e=>setSatpamForm(sf=>({...sf,telp:e.target.value}))} placeholder="08xxxxxxxxxx"/>
            </div>
            <div style={{marginBottom:12}}>
              <label style={sty.label}>Bertugas di Gudang (opsional)</label>
              <select style={sty.select} value={satpamForm.gudangId||""} onChange={e=>setSatpamForm(sf=>({...sf,gudangId:e.target.value}))}>
                <option value="">-- Belum di-assign gudang --</option>
                {visibleGudangList.map(g=>{ const up=uptList.find(u=>u.id===g.uptId); return <option key={g.id} value={g.id}>{g.nama}{up?` — ${up.nama}`:""}</option>; })}
              </select>
              <div style={{fontSize:12,color:C.muted,marginTop:4}}>Nama satpam akan muncul di dokumen TUG-10 sesuai gudang tempat barang disimpan.</div>
            </div>
            <div style={{marginBottom:12}}>
              <label style={sty.label}>Foto (opsional)</label>
              <div style={{display:"flex",gap:12,alignItems:"center"}}>
                <div style={{width:96,height:96,borderRadius:12,background:"#f3f4f6",border:`1px solid ${C.border}`,overflow:"hidden",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                  {satpamForm.foto ? <img src={satpamForm.foto} alt="Foto satpam" style={{width:"100%",height:"100%",objectFit:"cover"}}/> : <span style={{fontSize:30}}>🛡️</span>}
                </div>
                <div style={{display:"flex",flexDirection:"column",gap:6}}>
                  <label style={{...sty.btn("ghost","sm"),textAlign:"center",cursor:"pointer"}}>
                    📷 {satpamForm.foto?"Ganti Foto":"Upload Foto"}
                    <input type="file" accept="image/*" capture="environment" style={{display:"none"}} onChange={handleSatpamFoto}/>
                  </label>
                  {satpamForm.foto && <button style={sty.btn("danger","sm")} onClick={()=>setSatpamForm(sf=>({...sf,foto:null}))}>Hapus Foto</button>}
                </div>
              </div>
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
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000,padding:16}}>
          <div style={{...sty.card,width:420,maxWidth:"100%",maxHeight:"90dvh",overflowY:"auto"}}>
            <div style={sty.modalHeader}><span style={{fontWeight:800,fontSize:15}}>Edit {timMutuForm.label}</span><button onClick={()=>setTimMutuModal(null)} style={{background:"transparent",border:"none",color:"white",fontSize:24,lineHeight:1,cursor:"pointer",padding:0,opacity:0.85}}>×</button></div>
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
      {/* CARI DENGAN FOTO — modal upload foto query untuk visual search Data Stok */}
      {photoSearchOpen && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000,padding:16}} onClick={()=>!photoSearchLoading&&setPhotoSearchOpen(false)}>
          <div style={{...sty.card,width:420,maxWidth:"100%",maxHeight:"90dvh",overflowY:"auto"}} onClick={e=>e.stopPropagation()}>
            <div style={{fontWeight:800,fontSize:16,marginBottom:6}}>📷 Cari Barang dengan Foto</div>
            {/* Pilih cara mencari: kemiripan bentuk visual (Cohere) atau baca teks nameplate (OCR.space) */}
            <div style={{display:"flex",gap:8,marginBottom:10}}>
              {[
                {m:"bentuk",   icon:"🔍", label:"Bentuk Barang"},
                {m:"nameplate",icon:"🔖", label:"Foto Nameplate"},
              ].map(opt=>(
                <button key={opt.m} type="button" disabled={photoSearchLoading}
                  onClick={()=>setPhotoSearchMode(opt.m)}
                  style={{flex:1,padding:"8px 6px",borderRadius:8,border:`2px solid ${photoSearchMode===opt.m?C.accent:C.border}`,background:photoSearchMode===opt.m?"#eff6ff":"white",color:photoSearchMode===opt.m?C.accent:C.muted,cursor:"pointer",fontWeight:700,fontSize:12}}>
                  {opt.icon} {opt.label}
                </button>
              ))}
            </div>
            <p style={{fontSize:12,color:C.muted,marginBottom:12}}>
              {photoSearchMode==="nameplate"
                ? "Foto papan nama/label barang — sistem membaca teksnya (nomor katalog, type, merk) lalu mencocokkan ke Master Katalog & ke foto nameplate yang sudah di-upload di Data Stok."
                : "Ambil/unggah foto barang — sistem mencari material paling mirip bentuknya di Data Stok (kemiripan ≥75%, maks 10 hasil)."}
            </p>
            <label style={{...sty.btn("ghost"),display:"block",textAlign:"center",cursor:"pointer",marginBottom:10}}>
              {photoSearchImg?"🔄 Ganti Foto":"📸 Ambil / Pilih Foto"}
              <input type="file" accept="image/*" capture="environment" onChange={e=>handleImg(e, img=>setPhotoSearchImg(img))} style={{display:"none"}}/>
            </label>
            {photoSearchImg && <img src={photoSearchImg} alt="query" style={{width:"100%",maxHeight:220,objectFit:"contain",borderRadius:8,marginBottom:12,border:`1px solid ${C.border}`,background:"#f8fafc"}}/>}
            <div style={{display:"flex",gap:8}}>
              <button style={{...sty.btn("ghost"),flex:1}} disabled={photoSearchLoading} onClick={()=>setPhotoSearchOpen(false)}>Batal</button>
              <button style={{...sty.btn("primary"),flex:2}} disabled={!photoSearchImg||photoSearchLoading} onClick={runPhotoSearch}>{photoSearchLoading?(photoSearchMode==="nameplate"?"🔖 Membaca teks...":"🔎 Menganalisa..."):(photoSearchMode==="nameplate"?"Baca & Cocokkan Nameplate":"Cari Barang Mirip")}</button>
            </div>
          </div>
        </div>
      )}

      {/* DETAIL DATA STOK — klik baris di tabel Data Stok, termasuk foto Nameplate + Foto Keseluruhan */}
      {stockDetailId && (() => {
        const st = stocks.find(s=>s.id===stockDetailId);
        if (!st) return null;
        const kat = katalogList.find(k=>k.id===st.katalogId);
        const lok = lokasiList.find(l=>l.id===st.lokasiId);
        const gdg = lok?.gudangId ? gudangList.find(g=>g.id===lok.gudangId) : null;
        const canUploadFoto = hasRole(currentUser, "ADMIN","TL");
        const isSAP = st.id?.startsWith("STK-SAP-");
        const bs = getSAPBadgeStyle(st.katalog);
        const fotoBox = (label, field) => {
          const previewImg = pendingFoto[field] ?? st[field];
          const hasUnsaved = pendingFoto[field] != null;
          return (
            <div style={{flex:1,minWidth:160}}>
              <div style={{fontSize:12,fontWeight:700,marginBottom:6}}>{label} {!isSAP && "*"}</div>
              {previewImg ? (
                <img src={previewImg} alt={label} onClick={()=>setLightboxImg(previewImg)} style={{width:"100%",height:140,objectFit:"cover",borderRadius:8,border:`1px solid ${hasUnsaved?"#f59e0b":C.border}`,cursor:"zoom-in"}}/>
              ) : (
                <div style={{width:"100%",height:140,background:"#f3f4f6",borderRadius:8,border:`1px dashed ${C.border}`,display:"flex",alignItems:"center",justifyContent:"center",color:C.muted,fontSize:12,textAlign:"center",padding:8}}>
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
                  {hasUnsaved && <div style={{fontSize:12,color:"#92400e",marginTop:4}}>⚠️ Belum disimpan — klik "Simpan Foto" untuk memastikan tersimpan di sistem.</div>}
                </>
              )}
            </div>
          );
        };
        return (
          <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.6)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1500,padding:20}} onClick={()=>{setStockDetailId(null); setPendingFoto({});}}>
            <div style={{...sty.card,width:560,maxWidth:"100%",maxHeight:"90dvh",overflowY:"auto"}} onClick={e=>e.stopPropagation()}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:14}}>
                <div>
                  <h3 style={{fontSize:16,fontWeight:800}}>{st.name}</h3>
                  <p style={{fontSize:12,color:"#0098da",fontWeight:700,marginTop:2}}>📑 {st.katalog||kat?.katalog||"-"}</p>
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
                <div><b>Status:</b> <span style={{padding:"2px 7px",borderRadius:20,fontSize:12,fontWeight:700,background:bs.bg,color:bs.fg}}>{getSAPLabel(st.katalog)}</span></div>
              </div>
              <div style={{display:"flex",gap:12,flexWrap:"wrap"}}>
                {fotoBox("Foto Nameplate", "fotoNameplate")}
                {fotoBox("Foto Keseluruhan", "fotoKeseluruhan")}
              </div>
              {!canUploadFoto && <div style={{fontSize:12,color:C.muted,marginTop:10}}>Hanya Admin/TL yang bisa mengunggah/mengganti foto.</div>}
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
          <img src={lightboxImg} alt="Overview" style={{maxWidth:"90vw",maxHeight:"90dvh",objectFit:"contain",borderRadius:8}}/>
          <button style={{position:"fixed",top:20,right:20,background:"#dc2626",color:"white",border:"none",borderRadius:8,padding:"8px 16px",cursor:"pointer",fontSize:14}} onClick={()=>setLightboxImg(null)}>✕ Tutup</button>
        </div>
      )}

      {/* PETA MINI MODAL — dari card Data Stok */}
      {petaMiniDetail && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.6)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1500,padding:20}}>
          <div style={{...sty.card,width:560,maxWidth:"100%",maxHeight:"90dvh",overflowY:"auto"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
              <div>
                <h3 style={{fontSize:16,fontWeight:800}}>📍 Lokasi di Peta Gudang</h3>
                <p style={{fontSize:12,color:C.muted}}>{petaMiniDetail.petaInfo?.subGudang ? `${petaMiniDetail.gudang.nama} — ${petaMiniDetail.petaInfo.subGudang.nama}` : petaMiniDetail.gudang.nama} — Blok: {petaMiniDetail.lokasi.kode} {petaMiniDetail.lokasi.nama}</p>
              </div>
              <button style={{background:"#dc2626",color:"white",border:"none",borderRadius:8,padding:"6px 14px",cursor:"pointer",fontSize:12}} onClick={()=>setPetaMiniDetail(null)}>✕</button>
            </div>
            <div style={{position:"relative",width:"100%"}}>
              <img src={petaMiniDetail.petaInfo.denahImageData} alt="Denah" style={{width:"100%",borderRadius:8,display:"block",filter:"brightness(0.7)"}}/>
              {/* Semua blok lain di scope denah yang sama — abu */}
              {(petaMiniDetail.petaInfo.subGudang
                ? lokasiList.filter(l=>l.subGudangId===petaMiniDetail.petaInfo.subGudang.id&&l.subMapX!=null&&l.id!==petaMiniDetail.lokasi.id)
                : lokasiList.filter(l=>l.gudangId===petaMiniDetail.gudang.id&&l.mapX!=null&&l.id!==petaMiniDetail.lokasi.id)
              ).map(l=>{
                const px = petaMiniDetail.petaInfo.subGudang ? l.subMapX : l.mapX;
                const py = petaMiniDetail.petaInfo.subGudang ? l.subMapY : l.mapY;
                return <div key={l.id} style={{position:"absolute",left:`${px}%`,top:`${py}%`,transform:"translate(-50%,-50%)",width:10,height:10,borderRadius:"50%",background:"#9ca3af",border:"1px solid white",opacity:0.6}}/>;
              })}
              {/* Titik merah — lokasi barang ini */}
              <div style={{position:"absolute",left:`${petaMiniDetail.petaInfo.x}%`,top:`${petaMiniDetail.petaInfo.y}%`,transform:"translate(-50%,-50%)"}}>
                <div style={{width:18,height:18,borderRadius:"50%",background:"#dc2626",border:"3px solid white",boxShadow:"0 0 0 3px rgba(220,38,38,0.4)",animation:"pulse 1.5s infinite"}}/>
                <div style={{position:"absolute",top:-24,left:"50%",transform:"translateX(-50%)",background:"#dc2626",color:"white",fontSize:12,fontWeight:700,padding:"2px 6px",borderRadius:4,whiteSpace:"nowrap"}}>{petaMiniDetail.lokasi.kode}</div>
              </div>
            </div>
            <style>{`@keyframes pulse{0%,100%{box-shadow:0 0 0 3px rgba(220,38,38,0.4)}50%{box-shadow:0 0 0 8px rgba(220,38,38,0)}}`}</style>
          </div>
        </div>
      )}
      {kartuGantungDetail && (
        <KartuGantungModal
          katalog={kartuGantungDetail}
          stocks={stocks} txns={txns} lokasiList={lokasiList} gudangList={gudangList}
          sty={sty} C={C}
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
      {gudangModal==="edit" && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000,padding:16}}>
          <div style={{...sty.card,width:460,maxWidth:"100%",maxHeight:"90dvh",overflowY:"auto"}}>
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
              <div style={{fontSize:12,color:C.muted,marginTop:3}}>Tempel alamat persis seperti format Google Maps (kode + area) — koordinat untuk Peta Wilayah otomatis terisi, tidak perlu diisi manual.</div>
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
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000,padding:16}}>
          <div style={{...sty.card,width:540,maxWidth:"100%",maxHeight:"90dvh",overflowY:"auto"}}>
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
                  <div style={{fontSize:12,color:C.muted,marginTop:3}}>Tempel alamat persis seperti format Google Maps (kode + area) — koordinat untuk Peta Wilayah otomatis terisi, tidak perlu diisi manual.</div>
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
                  <div style={{fontSize:12,color:C.muted,marginBottom:8}}>💡 Convert PDF denah ke gambar terlebih dahulu (screenshot, foto, atau export dari PDF viewer)</div>
                  <input type="file" accept="image/*" capture="environment" onChange={e=>{const f=e.target.files[0]; if(f) uploadDenahGudang(gudangForm.id,f);}} style={{fontSize:12,color:C.muted}}/>
                  {denahLoading && <div style={{fontSize:12,color:"#1d4ed8",marginTop:8}}>⏳ Mengompres, menyimpan, dan membaca label di gambar (OCR)...</div>}
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

      {/* KONFIRMASI GUDANG BARU DARI IMPORT KAPASITAS GUDANG — muncul saat "Setujui &
          Publish" di Approval mendeteksi baris yang bakal jadi Gudang baru (tidak cocok
          Gudang existing manapun di UPT yang sama). Permintaan user 2026-07-06: sebelum
          ini, Gudang baru langsung dibuat otomatis tanpa konfirmasi, jadi variasi kecil
          penulisan nama gudang di Excel bikin duplikat. */}
      {capacityReviewImportId && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000,padding:20}}>
          <div style={{...sty.card,width:600,maxWidth:"100%",maxHeight:"90dvh",overflowY:"auto"}}>
            <h3 style={{fontSize:18,fontWeight:800,marginBottom:6}}>🔎 Konfirmasi Gudang Baru</h3>
            <p style={{fontSize:12,color:C.muted,marginBottom:16}}>
              {capacityReviewCandidates.length} nama Gudang di file ini tidak cocok dengan Gudang yang sudah ada.
              Untuk tiap baris, pastikan ini memang Gudang baru — atau pilih Gudang existing kalau ini cuma beda penulisan nama (mencegah duplikat).
            </p>
            <div style={{display:"flex",flexDirection:"column",gap:12,marginBottom:16}}>
              {capacityReviewCandidates.map(c => {
                const decision = capacityReviewDecisions[c.key] || {action:"NEW"};
                const gudangDiUpt = gudangList.filter(g=>g.uptId===c.uptId);
                return (
                  <div key={c.key} style={{border:`1px solid ${C.border}`,borderRadius:8,padding:12}}>
                    <div style={{fontWeight:700,fontSize:13}}>{c.gudang}</div>
                    <div style={{fontSize:12,color:C.muted,marginBottom:8}}>UPT: {c.upt}</div>
                    <div style={{display:"flex",flexDirection:"column",gap:6}}>
                      <label style={{display:"flex",alignItems:"center",gap:8,fontSize:12,cursor:"pointer"}}>
                        <input type="radio" name={`capdec-${c.key}`} checked={decision.action==="NEW"}
                          onChange={()=>setCapacityReviewDecisions(prev=>({...prev,[c.key]:{action:"NEW"}}))}/>
                        🆕 Ini Gudang baru, buat entri baru
                      </label>
                      <label style={{display:"flex",alignItems:"center",gap:8,fontSize:12,cursor:"pointer"}}>
                        <input type="radio" name={`capdec-${c.key}`} checked={decision.action==="MAP"}
                          onChange={()=>setCapacityReviewDecisions(prev=>({...prev,[c.key]:{action:"MAP", mappedGudangId: c.suggestions[0]?.id || gudangDiUpt[0]?.id || ""}}))}
                          disabled={gudangDiUpt.length===0}/>
                        🔗 Ini sebenarnya Gudang yang sudah ada:
                      </label>
                      {decision.action==="MAP" && (
                        <div style={{marginLeft:26}}>
                          <select style={{...sty.select,fontSize:12}} value={decision.mappedGudangId||""}
                            onChange={e=>setCapacityReviewDecisions(prev=>({...prev,[c.key]:{action:"MAP", mappedGudangId:e.target.value}}))}>
                            <option value="">-- Pilih Gudang --</option>
                            {c.suggestions.length>0 && <optgroup label="Mirip (disarankan)">
                              {c.suggestions.map(g=><option key={g.id} value={g.id}>{g.nama}</option>)}
                            </optgroup>}
                            <optgroup label="Semua Gudang di UPT ini">
                              {gudangDiUpt.map(g=><option key={g.id} value={g.id}>{g.nama}</option>)}
                            </optgroup>
                          </select>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="approval-actions">
              <button className="approval-btn--cancel" onClick={()=>{setCapacityReviewImportId(null);setCapacityReviewCandidates([]);setCapacityReviewDecisions({});}}>Batal</button>
              <button className="approval-btn--approve" onClick={confirmCapacityApproval}><span className="approval-btn__ic" aria-hidden="true">✓</span>Konfirmasi & Lanjutkan Approve</button>
            </div>
          </div>
        </div>
      )}

      {/* MATURITY ASSESSMENT MODAL — input manual Admin untuk Dashboard */}
      {maturityModal && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000,padding:16}}>
          <div style={{...sty.card,width:460,maxWidth:"100%",maxHeight:"90dvh",overflowY:"auto"}}>
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
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000,padding:16}}>
          <div style={{...sty.card,width:440,maxWidth:"100%",maxHeight:"90dvh",overflowY:"auto"}}>
            <div style={sty.modalHeader}><span style={{fontWeight:800,fontSize:15}}>{uitModal==="edit"?"Edit UIT":"Tambah UIT Baru"}</span><button onClick={()=>setUitModal(null)} style={{background:"transparent",border:"none",color:"white",fontSize:24,lineHeight:1,cursor:"pointer",padding:0,opacity:0.85}}>×</button></div>
            <div style={{marginBottom:12}}><label style={sty.label}>Kode UIT</label><input style={sty.input} value={uitForm.kode||""} onChange={e=>setUitForm(f=>({...f,kode:e.target.value}))} placeholder="cth: UIT-JBM"/></div>
            <div style={{marginBottom:12}}><label style={sty.label}>Nama Lengkap UIT</label><input style={sty.input} value={uitForm.nama||""} onChange={e=>setUitForm(f=>({...f,nama:e.target.value}))} placeholder="cth: PT PLN (PERSERO) UNIT INDUK TRANSMISI JAWA BAGIAN TIMUR DAN BALI"/></div>
            <div style={{marginBottom:16}}><label style={sty.label}>Alamat</label><input style={sty.input} value={uitForm.alamat||""} onChange={e=>setUitForm(f=>({...f,alamat:e.target.value}))}/></div>
            <div style={{display:"flex",gap:10}}><button style={{...sty.btn("ghost"),flex:1}} onClick={()=>setUitModal(null)}>Batal</button><button style={{...sty.btn("primary"),flex:2}} onClick={saveUIT}>💾 Simpan</button></div>
          </div>
        </div>
      )}

      {/* UPT MODAL */}
      {uptModal && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000,padding:16}}>
          <div style={{...sty.card,width:440,maxWidth:"100%",maxHeight:"90dvh",overflowY:"auto"}}>
            <div style={sty.modalHeader}><span style={{fontWeight:800,fontSize:15}}>{uptModal==="edit"?"Edit UPT":"Tambah UPT Baru"}</span><button onClick={()=>setUptModal(null)} style={{background:"transparent",border:"none",color:"white",fontSize:24,lineHeight:1,cursor:"pointer",padding:0,opacity:0.85}}>×</button></div>
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
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000,padding:16}}>
          <div style={{...sty.card,width:440,maxWidth:"100%",maxHeight:"90dvh",overflowY:"auto"}}>
            <div style={sty.modalHeader}><span style={{fontWeight:800,fontSize:15}}>{ultgModal==="edit"?"Edit ULTG":"Tambah ULTG Baru"}</span><button onClick={()=>setUltgModal(null)} style={{background:"transparent",border:"none",color:"white",fontSize:24,lineHeight:1,cursor:"pointer",padding:0,opacity:0.85}}>×</button></div>
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

      {/* KELOLA AKUN MODAL — daftarkan user baru (ADMIN only) */}
      {akunModal && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000,padding:16}}>
          <div style={{...sty.card,width:460,maxWidth:"100%",maxHeight:"90dvh",overflowY:"auto"}}>
            {akunResult ? (
              <>
                <h3 style={{fontSize:18,fontWeight:800,marginBottom:14}}>✅ Akun Berhasil Didaftarkan</h3>
                <div style={{background:"#f0fdf4",border:"1px solid #86efac",borderRadius:8,padding:14,marginBottom:14,fontSize:13}}>
                  <div style={{marginBottom:6}}><b>Username:</b> {akunResult.username}</div>
                  <div><b>Password:</b> {akunResult.password}</div>
                </div>
                <div style={{fontSize:12,color:C.muted,marginBottom:16}}>⚠️ Sampaikan kredensial ini ke pemilik akun secara aman. Password ini tidak akan ditampilkan lagi setelah ditutup.</div>
                <button style={{...sty.btn("primary"),width:"100%"}} onClick={()=>{setAkunModal(null);setAkunResult(null);}}>Selesai</button>
              </>
            ) : (
              <>
                <div style={sty.modalHeader}><span style={{fontWeight:800,fontSize:15}}>{akunModal==="edit"?"Edit Akun":"Daftarkan Akun Baru"}</span><button onClick={()=>setAkunModal(null)} style={{background:"transparent",border:"none",color:"white",fontSize:24,lineHeight:1,cursor:"pointer",padding:0,opacity:0.85}}>×</button></div>
                <div style={{marginBottom:12}}>
                  <label style={sty.label}>Username</label>
                  {akunModal==="edit" ? (
                    <div style={{...sty.input,background:C.bg2||"#f3f4f6",color:C.muted}}>{akunForm.username}</div>
                  ) : (
                    <input style={sty.input} value={akunForm.username||""} onChange={e=>setAkunForm(f=>({...f,username:e.target.value}))} placeholder="cth: budi.manager (huruf kecil, tanpa spasi)"/>
                  )}
                </div>
                <div style={{marginBottom:12}}>
                  <label style={sty.label}>{akunModal==="edit"?"Reset Password (opsional)":"Password"}</label>
                  <div style={{display:"flex",gap:6}}>
                    <input style={sty.input} value={akunForm.password||""} onChange={e=>setAkunForm(f=>({...f,password:e.target.value}))} placeholder={akunModal==="edit"?"kosongkan jika tidak diubah":"minimal 6 karakter"}/>
                    <button style={sty.btn("ghost","sm")} onClick={()=>setAkunForm(f=>({...f,password:Math.random().toString(36).slice(-5)+Math.random().toString(36).slice(-5)}))}>🎲 Acak</button>
                  </div>
                </div>
                <div style={{marginBottom:12}}><label style={sty.label}>Nama Lengkap</label><input style={sty.input} value={akunForm.name||""} onChange={e=>setAkunForm(f=>({...f,name:e.target.value}))} placeholder="cth: Budi Santoso"/></div>
                <div style={{marginBottom:12}}>
                  <label style={sty.label}>Role</label>
                  <select style={sty.select} value={akunForm.role||"VIEWER"} onChange={e=>setAkunForm(f=>({...f,role:e.target.value}))}>
                    {Object.entries(ROLES).filter(([id])=>id!=="SUPERADMIN").map(([id,label])=><option key={id} value={id}>{label}</option>)}
                  </select>
                </div>
                <div style={{marginBottom:12}}><label style={sty.label}>Jabatan *</label><input style={sty.input} value={akunForm.jabatan||""} onChange={e=>setAkunForm(f=>({...f,jabatan:e.target.value}))}/></div>
                {akunForm.role==="PENGADAAN" && (
                  <div style={{marginBottom:12}}>
                    <label style={sty.label}>Scope Pengadaan</label>
                    <div style={{display:"flex",gap:8}}>
                      <button type="button" style={{...sty.btn((akunForm.pengadaanScope||"UPT")==="UPT"?"primary":"ghost","sm"),flex:1}} onClick={()=>setAkunForm(f=>({...f,pengadaanScope:"UPT"}))}>Pengadaan UPT</button>
                      <button type="button" style={{...sty.btn(akunForm.pengadaanScope==="UIT"?"primary":"ghost","sm"),flex:1}} onClick={()=>setAkunForm(f=>({...f,pengadaanScope:"UIT"}))}>Pengadaan UIT</button>
                    </div>
                  </div>
                )}
                {(() => {
                  const isUitScopedForm = ["ADMIN_UIT","MGR_LOGISTIK_UIT"].includes(akunForm.role) || (akunForm.role==="PENGADAAN" && akunForm.pengadaanScope==="UIT");
                  if (isUitScopedForm) {
                    return (
                      <div style={{marginBottom:12}}>
                        <label style={sty.label}>UIT *</label>
                        <select style={sty.select} value={akunForm.uitId||""} onChange={e=>setAkunForm(f=>({...f,uitId:e.target.value}))}>
                          <option value="">-- Pilih UIT --</option>
                          {uitList.map(u=><option key={u.id} value={u.id}>{u.kode} — {u.nama}</option>)}
                        </select>
                        {UIT_ROLE_QUOTA[akunForm.role] !== undefined && akunForm.uitId && (() => {
                          const holder = users.find(u => u.role===akunForm.role && u.uitId===akunForm.uitId && u.id!==akunForm.id);
                          const filled = holder ? 1 : 0;
                          const quota = UIT_ROLE_QUOTA[akunForm.role];
                          return (
                            <div style={{fontSize:12,marginTop:4,color:filled>=quota?"#dc2626":C.muted}}>
                              Slot {ROLES[akunForm.role]} di UIT ini: {filled}/{quota} terisi{holder?` (${holder.name})`:""}
                            </div>
                          );
                        })()}
                      </div>
                    );
                  }
                  return (
                    <div style={{marginBottom:12}}>
                      <label style={sty.label}>UPT *</label>
                      <select style={sty.select} value={akunForm.uptId||""} onChange={e=>setAkunForm(f=>({...f,uptId:e.target.value}))}>
                        <option value="">-- Pilih UPT --</option>
                        {uptList.map(u=><option key={u.id} value={u.id}>{u.kode} — {u.nama}</option>)}
                      </select>
                      {UPT_ROLE_QUOTA[akunForm.role] !== undefined && akunForm.uptId && (() => {
                        const holder = users.find(u => u.role===akunForm.role && u.uptId===akunForm.uptId && u.id!==akunForm.id);
                        const filled = holder ? 1 : 0;
                        const quota = UPT_ROLE_QUOTA[akunForm.role];
                        return (
                          <div style={{fontSize:12,marginTop:4,color:filled>=quota?"#dc2626":C.muted}}>
                            Slot {ROLES[akunForm.role]} di UPT ini: {filled}/{quota} terisi{holder?` (${holder.name})`:""}
                          </div>
                        );
                      })()}
                    </div>
                  );
                })()}
                <div style={{marginBottom:16}}>
                  <label style={sty.label}>ULTG {(akunForm.role==="ADMIN_ULTG"||akunForm.role==="MGR_ULTG")?"* (wajib untuk role ULTG)":"(kosongkan jika bukan lingkungan ULTG)"}</label>
                  <select style={sty.select} value={akunForm.ultgId||""} onChange={e=>setAkunForm(f=>({...f,ultgId:e.target.value}))}>
                    <option value="">-- Pilih ULTG --</option>
                    {ultgList.map(u=><option key={u.id} value={u.id}>{u.kode} — {u.nama}</option>)}
                  </select>
                </div>
                {/* RBAC per gudang: kosong = semua gudang (perilaku default). Centang untuk
                    membatasi akun hanya ke gudang tertentu (dropdown/daftar gudang tersaring). */}
                <div style={{marginBottom:16}}>
                  <label style={sty.label}>Batasi Akses Gudang <span style={{fontWeight:400,color:C.muted}}>(kosongkan = semua gudang)</span></label>
                  <div style={{display:"flex",flexWrap:"wrap",gap:8,maxHeight:150,overflowY:"auto",border:`1px solid ${C.border}`,borderRadius:8,padding:10}}>
                    {visibleGudangList.length===0 && <span style={{fontSize:12,color:C.muted}}>Belum ada Master Gudang.</span>}
                    {visibleGudangList.map(g=>{
                      const sel = (akunForm.gudangIds||[]).includes(g.id);
                      return (
                        <label key={g.id} style={{display:"flex",alignItems:"center",gap:6,fontSize:12,cursor:"pointer",padding:"4px 8px",borderRadius:6,background:sel?"#e0f2fe":"transparent",border:`1px solid ${sel?"#0369a1":C.border}`}}>
                          <input type="checkbox" checked={sel} onChange={()=>setAkunForm(f=>{ const cur=f.gudangIds||[]; return {...f, gudangIds: cur.includes(g.id)?cur.filter(x=>x!==g.id):[...cur,g.id]}; })}/>
                          {g.nama}
                        </label>
                      );
                    })}
                  </div>
                </div>
                <div style={{display:"flex",gap:10}}>
                  <button style={{...sty.btn("ghost"),flex:1}} onClick={()=>setAkunModal(null)} disabled={akunBusy}>Batal</button>
                  <button style={{...sty.btn("primary"),flex:2,opacity:akunBusy?0.6:1}} onClick={akunModal==="edit"?submitAkunEdit:submitAkunBaru} disabled={akunBusy}>{akunBusy?(akunModal==="edit"?"Menyimpan...":"Mendaftarkan..."):(akunModal==="edit"?"💾 Simpan Perubahan":"💾 Daftarkan")}</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* GANTI PASSWORD MODAL — self-service, semua role, akun sendiri */}
      {gantiPasswordModal && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000,padding:16}}>
          <div style={{...sty.card,width:400,maxWidth:"100%",maxHeight:"90dvh",overflowY:"auto"}}>
            <div style={sty.modalHeader}><span style={{fontWeight:800,fontSize:15}}>🔑 Ganti Password</span><button onClick={()=>setGantiPasswordModal(false)} style={{background:"transparent",border:"none",color:"white",fontSize:24,lineHeight:1,cursor:"pointer",padding:0,opacity:0.85}}>×</button></div>
            <div style={{marginBottom:12}}>
              <label style={sty.label}>Password Lama</label>
              <input type="password" style={sty.input} value={gantiPasswordForm.oldPassword||""} onChange={e=>setGantiPasswordForm(f=>({...f,oldPassword:e.target.value}))}/>
            </div>
            <div style={{marginBottom:12}}>
              <label style={sty.label}>Password Baru</label>
              <input type="password" style={sty.input} value={gantiPasswordForm.newPassword||""} onChange={e=>setGantiPasswordForm(f=>({...f,newPassword:e.target.value}))} placeholder="minimal 6 karakter"/>
            </div>
            <div style={{marginBottom:16}}>
              <label style={sty.label}>Konfirmasi Password Baru</label>
              <input type="password" style={sty.input} value={gantiPasswordForm.confirmPassword||""} onChange={e=>setGantiPasswordForm(f=>({...f,confirmPassword:e.target.value}))}/>
            </div>
            <div style={{display:"flex",gap:10}}>
              <button style={{...sty.btn("ghost"),flex:1}} onClick={()=>setGantiPasswordModal(false)} disabled={gantiPasswordBusy}>Batal</button>
              <button style={{...sty.btn("primary"),flex:2,opacity:gantiPasswordBusy?0.6:1}} onClick={submitGantiPassword} disabled={gantiPasswordBusy}>{gantiPasswordBusy?"Menyimpan...":"💾 Simpan Password Baru"}</button>
            </div>
          </div>
        </div>
      )}

      {/* TXN MODAL - TUG5 FORM */}
      {txnModal && txnForm && txnForm.docType==="TUG5" && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000,padding:20}}>
          <div style={{...sty.card,width:700,maxWidth:"100%",maxHeight:"90dvh",overflowY:"auto"}}>
            <div style={sty.modalHeader}>
              <span style={{fontWeight:800,fontSize:15}}>Formulir TUG-5 — Daftar Permintaan Barang</span>
              <div style={{display:"flex",alignItems:"center",gap:12,flexShrink:0}}>
                <span style={{fontSize:12,fontWeight:700,color:"white",background:"rgba(255,255,255,0.18)",borderRadius:6,padding:"3px 9px",whiteSpace:"nowrap"}}>No: {docSeq}.TUG-5/...</span>
                <button onClick={()=>setTxnModal(false)} style={{background:"transparent",border:"none",color:"white",fontSize:24,lineHeight:1,cursor:"pointer",padding:0,opacity:0.85}}>×</button>
              </div>
            </div>
            {txnForm.sourceType==="ULTG" ? (
              <>
                <div style={{background:"#dbeafe",border:`1px solid #93c5fd`,borderRadius:8,padding:"8px 12px",fontSize:12,color:"#1e40af",marginBottom:16}}>ℹ️ Alur: Admin Ajukan TUG-5 → Manager ULTG approve</div>
                <div style={{fontSize:12,fontWeight:800,color:C.accent,marginBottom:8,borderBottom:`1px solid ${C.border}`,paddingBottom:4}}>HEADER DOKUMEN</div>
                <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"1fr 1fr",gap:12,marginBottom:14}}>
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
            <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"1fr 1fr",gap:12,marginBottom:14}}>
              <div style={{gridColumn:"1/-1"}}>
                <label style={sty.label}>Kepada (UIT tujuan)</label>
                <select style={sty.select} value={txnForm.uitId||""} onChange={e=>setTxnForm(tf=>({...tf,uitId:e.target.value}))}>
                  <option value="">-- Pilih UIT --</option>
                  {uitList.map(u=><option key={u.id} value={u.id}>{u.kode} — {u.nama}</option>)}
                </select>
              </div>
              <div style={{gridColumn:"1/-1"}}>
                <label style={sty.label}>Jenis Transfer</label>
                <div style={{display:"flex",flexDirection:isMobile?"column":"row",gap:8}}>
                  {["INTRACOMPANY","INTERCOMPANY"].map(jt=>(
                    <button key={jt} type="button" style={{flex:1,padding:"8px",borderRadius:8,border:`2px solid ${txnForm.jenisTransfer===jt?C.accent:C.border}`,background:txnForm.jenisTransfer===jt?"#eff6ff":"white",color:txnForm.jenisTransfer===jt?C.accent:C.muted,cursor:"pointer",fontWeight:700,fontSize:12}} onClick={()=>setTxnForm(tf=>({...tf,jenisTransfer:jt}))}>
                      {jt==="INTRACOMPANY"?"🔄 Intracompany (sesama UIT-JBM)":"🌐 Intercompany (lintas UIT)"}
                    </button>
                  ))}
                </div>
                {txnForm.jenisTransfer==="INTRACOMPANY" && <div style={{fontSize:12,color:C.green,marginTop:4}}>→ Setelah approved: otomatis generate draft TUG-7 di UIT untuk ditentukan UPT pengirimnya.</div>}
                {txnForm.jenisTransfer==="INTERCOMPANY" && <div style={{fontSize:12,color:"#7c3aed",marginTop:4}}>→ Setelah approved: otomatis generate draft TUG-5 UIT untuk dikirim manual ke UIT lain.</div>}
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
                    <div key={idx} style={{display:"flex",alignItems:isMobile?"stretch":"center",flexDirection:isMobile?"column":"row",gap:8,border:`1px solid ${C.border}`,borderRadius:8,padding:"8px 10px",marginBottom:8,background:C.surface,cursor:"pointer"}} onClick={()=>setTug5ExpandedIdx(idx)}>
                      <span style={{fontSize:12,fontWeight:700,color:C.muted}}>#{idx+1}</span>
                      <span style={{flex:1,fontSize:12,fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{kat ? `${kat.name} [${kat.katalog||"-"}]` : <span style={{color:C.muted,fontStyle:"italic"}}>Belum dipilih</span>}</span>
                      <div style={{display:"flex",alignItems:"center",justifyContent:isMobile?"space-between":"flex-start",gap:8,flexWrap:"wrap"}}>
                        <span style={{fontSize:12,color:C.accent,fontWeight:700}}>Qty: {si.permintaan||0}{kat?.satuan?` ${kat.satuan}`:""}</span>
                        <span style={{fontSize:12,color:C.muted}}>✏️ Edit</span>
                        {txnForm.stockItems.length>1 && <button type="button" title="Hapus material TUG-5 ini" style={{...sty.btn("danger","sm"),padding:"3px 8px"}} onClick={e=>{e.stopPropagation();removeItemRow(idx);if(tug5ExpandedIdx===idx)setTug5ExpandedIdx(Math.max(0,idx-1));}}>✕</button>}
                      </div>
                    </div>
                  );
                }
                return (
                <div key={idx} style={{border:`2px solid ${C.accent}`,borderRadius:8,padding:10,marginBottom:8,background:"#f9fafb"}}>
                  <div style={{display:"flex",flexDirection:isMobile?"column":"row",gap:8,alignItems:isMobile?"stretch":"flex-end",marginBottom:8}}>
                    <div style={{flex:isMobile?undefined:3}}>
                      <label style={sty.label}>Nama Barang {idx+1}</label>
                      <SearchableSelect
                        options={katalogList}
                        value={si.katalogId}
                        onChange={v=>updateItemRow(idx,"katalogId",v)}
                        getLabel={k=>`${k.name} [${k.katalog||"-"}]`}
                        getSearchText={k=>`${k.name} ${k.katalog||""}`}
                        placeholder="-- Cari & pilih dari Master Katalog --"
                        sty={sty} C={C} isMobile={isMobile}
                      />
                    </div>
                    {txnForm.stockItems.length>1 && <button type="button" title="Hapus material TUG-5 ini" style={{...sty.btn("danger","sm")}} onClick={()=>{removeItemRow(idx);setTug5ExpandedIdx(Math.max(0,idx-1));}}>✕</button>}
                  </div>
                  {kat && <div style={{fontSize:12,color:C.muted,marginBottom:8}}>Nomor Normalisasi: {kat.katalog||"-"} • Satuan: {kat.satuan}</div>}
                  {txnForm.sourceType==="ULTG" ? (
                    <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"1fr 1fr",gap:8}}>
                      <div><label style={sty.label}>Sisa Persediaan <span style={{color:C.muted,fontWeight:400}}>(stok aktual UPT)</span></label><input style={{...sty.input,background:"#f3f4f6"}} type="number" inputMode="decimal" min="0" value={si.sisaPersediaan||0} disabled/></div>
                      <div><label style={sty.label}>Jumlah Permintaan {kat?.satuan && <span style={{color:C.muted,fontWeight:400}}>({kat.satuan})</span>}</label><input style={sty.input} type="number" inputMode="decimal" min="1" value={si.permintaan||1} onChange={e=>updateItemRow(idx,"permintaan",Number(e.target.value))}/></div>
                    </div>
                  ) : (
                    <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"1fr 1fr 1fr",gap:8}}>
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
                <span style={{fontSize:12,color:C.muted}}>Halaman {tug5MaterialPage+1} dari {Math.ceil(txnForm.stockItems.length/5)}</span>
                <button type="button" style={sty.btn("ghost","sm")} disabled={(tug5MaterialPage+1)*5>=txnForm.stockItems.length} onClick={()=>setTug5MaterialPage(p=>p+1)}>Selanjutnya →</button>
              </div>
            )}
            <button type="button" style={{...sty.btn("ghost","sm"),marginBottom:14}} disabled={txnForm.stockItems.length>=10} onClick={addItemRow}>+ Tambah Material {txnForm.stockItems.length>=10?"(maks 10)":""}</button>

            {txnForm.sourceType!=="ULTG" && (
              <>
                <div style={{fontSize:12,fontWeight:800,color:C.accent,marginBottom:8,borderBottom:`1px solid ${C.border}`,paddingBottom:4}}>ADMINISTRASI</div>
                <div style={{display:"grid",gridTemplateColumns:"1fr",gap:10,marginBottom:16}}>
                  <div><label style={sty.label}>Keterangan Umum</label><input style={sty.input} value={txnForm.keteranganUmum||""} onChange={e=>setTxnForm(tf=>({...tf,keteranganUmum:e.target.value}))} placeholder="cth: Penggantian Isolator Komposit UPT Surabaya"/></div>
                  <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"1fr 1fr 1fr",gap:10}}>
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
          <div style={{...sty.card,width:680,maxWidth:"100%",maxHeight:"90dvh",overflowY:"auto"}}>
            <div style={sty.modalHeader}>
              <span style={{fontWeight:800,fontSize:15}}>Formulir {txnForm.docType.replace("TUG","TUG-")} — {txnForm.docType==="TUG9"?"Bon Pemakaian":"Pemakaian Unit Lain"}</span>
              <div style={{display:"flex",alignItems:"center",gap:12,flexShrink:0}}>
                <span style={{fontSize:12,fontWeight:700,color:"white",background:"rgba(255,255,255,0.18)",borderRadius:6,padding:"3px 9px",whiteSpace:"nowrap"}}>No: {docSeq}.{txnForm.docType.replace("TUG","TUG-")}/...</span>
                <button onClick={()=>setTxnModal(false)} style={{background:"transparent",border:"none",color:"white",fontSize:24,lineHeight:1,cursor:"pointer",padding:0,opacity:0.85}}>×</button>
              </div>
            </div>
            <div style={{background:"#fef3c7",border:`1px solid #fcd34d`,borderRadius:8,padding:"8px 12px",fontSize:12,color:"#92400e",marginBottom:16}}>⚠️ Transaksi akan PENDING sampai disetujui TL Logistik / Asman.</div>

            <div style={{fontSize:12,fontWeight:800,color:C.accent,marginBottom:8,borderBottom:`1px solid ${C.border}`,paddingBottom:4}}>DATA PEKERJAAN</div>
            <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"1fr 1fr",gap:12,marginBottom:14}}>
              <div style={{gridColumn:"1/-1"}}><label style={sty.label}>Nama Pekerjaan *</label><input style={sty.input} value={txnForm.namaPekerjaan} onChange={e=>setTxnForm(tf=>({...tf,namaPekerjaan:e.target.value,pekerjaan:e.target.value}))} placeholder="cth: Extension Bay Kapasitor"/></div>
              <div style={{gridColumn:"1/-1"}}><label style={sty.label}>Lokasi Pekerjaan *</label><input style={sty.input} value={txnForm.lokasiPekerjaan} onChange={e=>setTxnForm(tf=>({...tf,lokasiPekerjaan:e.target.value}))} placeholder="cth: GI Paciran, GI New Pacitan"/></div>
              {txnForm.docType==="TUG8" && (
                <div style={{gridColumn:"1/-1"}}>
                  <label style={sty.label}>Unit / Sektor Tujuan (PLN Lain) *</label>
                  <input style={sty.input} value={txnForm.unitTujuan||""} onChange={e=>setTxnForm(tf=>({...tf,unitTujuan:e.target.value}))} placeholder="cth: UPT Malang, ULTG Pasuruan"/>
                </div>
              )}
              <div><label style={sty.label}>No. Surat / Nodin</label><input style={sty.input} value={txnForm.noNodin} onChange={e=>setTxnForm(tf=>({...tf,noNodin:e.target.value}))} placeholder="2175/LOG.00.02/F34000000/2026"/></div>
              <div><label style={sty.label}>No. Surat Persetujuan</label><input style={sty.input} value={txnForm.noPersetujuan} onChange={e=>setTxnForm(tf=>({...tf,noPersetujuan:e.target.value}))} placeholder="1861/DAN.01.03/F34000000/2026"/></div>
            </div>

            <div style={{fontSize:12,fontWeight:800,color:C.accent,marginBottom:8,borderBottom:`1px solid ${C.border}`,paddingBottom:4}}>DATA PENERIMA</div>
            <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"1fr 1fr 1fr",gap:12,marginBottom:14}}>
              <div><label style={sty.label}>Nama Penerima *</label><input style={sty.input} value={txnForm.penerimaNama} onChange={e=>setTxnForm(tf=>({...tf,penerimaNama:e.target.value}))}/></div>
              <div><label style={sty.label}>Jabatan</label><input style={sty.input} value={txnForm.penerimaJabatan} onChange={e=>setTxnForm(tf=>({...tf,penerimaJabatan:e.target.value}))} placeholder="cth: Project Manager"/></div>
              <div><label style={sty.label}>Unit / Perusahaan</label><input style={sty.input} value={txnForm.penerimaUnit} onChange={e=>setTxnForm(tf=>({...tf,penerimaUnit:e.target.value}))} placeholder="cth: PT. Mitra Jaya"/></div>
            </div>

            <div style={{fontSize:12,fontWeight:800,color:C.accent,marginBottom:8,borderBottom:`1px solid ${C.border}`,paddingBottom:4}}>TRANSPORTASI (untuk Surat Jalan)</div>
            <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"1fr 1fr 1fr",gap:12,marginBottom:14}}>
              <div><label style={sty.label}>Nopol Kendaraan</label><input style={sty.input} value={txnForm.nopol} onChange={e=>setTxnForm(tf=>({...tf,nopol:e.target.value}))} placeholder="L 9859 UK"/></div>
              <div><label style={sty.label}>Nama Pengemudi</label><input style={sty.input} value={txnForm.namaPengemudi} onChange={e=>setTxnForm(tf=>({...tf,namaPengemudi:e.target.value}))}/></div>
              <div><label style={sty.label}>No. SIM / KTP</label><input style={sty.input} value={txnForm.simKtp} onChange={e=>setTxnForm(tf=>({...tf,simKtp:e.target.value}))}/></div>
            </div>
            <div style={{marginBottom:14}}>
              <label style={sty.label}>Satpam Bertugas (Mengetahui di Surat Jalan)</label>
              <select style={sty.select} value={txnForm.satpamId||""} onChange={e=>setTxnForm(tf=>({...tf,satpamId:e.target.value}))}>
                <option value="">-- Pilih Satpam --</option>
                {gudangList.map(g=>{ const list=satpamList.filter(sp=>sp.gudangId===g.id); return list.length===0?null:(
                  <optgroup key={g.id} label={g.nama}>{list.map(sp=><option key={sp.id} value={sp.id}>{sp.name}</option>)}</optgroup>
                ); })}
                {(() => { const list=satpamList.filter(sp=>!sp.gudangId || !gudangList.some(g=>g.id===sp.gudangId)); return list.length===0?null:(
                  <optgroup label="Belum di-assign gudang">{list.map(sp=><option key={sp.id} value={sp.id}>{sp.name}</option>)}</optgroup>
                ); })()}
              </select>
              {satpamList.length===0 && <div style={{fontSize:12,color:C.muted,marginTop:4}}>Belum ada data Satpam. Tambahkan di menu Master Data → tab Satpam.</div>}
            </div>

            <div style={{fontSize:12,fontWeight:800,color:C.accent,marginBottom:8,borderBottom:`1px solid ${C.border}`,paddingBottom:4}}>BARANG / MATERIAL</div>
            <div style={{fontSize:12,color:C.muted,marginBottom:8,fontStyle:"italic"}}>💡 Barang yang sama bisa ada di lokasi berbeda — pastikan pilih baris dengan lokasi yang benar.</div>
            {txnForm.stockItems.map((si,idx)=>{
              const stockOpt = enrichedStocks.find(s=>s.id===si.stockId);
              return (
                <div key={idx} style={{display:"flex",flexDirection:isMobile?"column":"row",gap:8,marginBottom:8,alignItems:isMobile?"stretch":"flex-end"}}>
                  <div style={{flex:isMobile?undefined:3}}>
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
                          <div style={{fontSize:12,color:C.muted}}>📍 {s.lokasi} • {s.jenisBarang!=="Non-Stock"?`Stok: ${fmtNum(s.qty)} ${s.unit}`:"Non-Stock"}</div>
                        </div>
                      )}
                      placeholder="-- Cari & pilih barang --"
                      sty={sty} C={C} isMobile={isMobile}
                    />
                  </div>
                  <div style={{display:"flex",gap:8,alignItems:"flex-end"}}>
                    <div style={{flex:1}}><label style={sty.label}>Qty</label><input style={sty.input} type="number" inputMode="decimal" min="1" value={si.qty} onChange={e=>updateItemRow(idx,"qty",Number(e.target.value))}/></div>
                    <button type="button" title="Scan barcode" style={{...sty.btn("ghost","sm"),height:isMobile?44:36}} onClick={()=>openScanner({txnIndex:idx})}>📷</button>
                    {txnForm.stockItems.length>1 && <button type="button" title="Hapus baris barang ini" style={{...sty.btn("danger","sm"),height:isMobile?44:36}} onClick={()=>removeItemRow(idx)}>✕</button>}
                  </div>
                </div>
              );
            })}
            <button type="button" style={{...sty.btn("ghost","sm"),marginBottom:14}} onClick={addItemRow}>+ Tambah Barang Lain</button>

            <div style={{marginBottom:14}}><label style={sty.label}>Keterangan Barang{txnForm.docType!=="TUG8"?" (status proyek/non-stock)":""}</label><input style={sty.input} value={txnForm.keteranganBarang} onChange={e=>setTxnForm(tf=>({...tf,keteranganBarang:e.target.value}))} placeholder="cth: Untuk Proyek PT. Mitra Jaya"/></div>

            <div style={{fontSize:12,fontWeight:800,color:C.accent,marginBottom:8,borderBottom:`1px solid ${C.border}`,paddingBottom:4}}>📸 LAMPIRAN FOTO (opsional)</div>
            <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"1fr 1fr 1fr",gap:12,marginBottom:14}}>
              <div>
                <label style={sty.label}>Foto Kendaraan</label>
                <input type="file" accept="image/*" capture="environment" onChange={e=>handleImg(e, img=>setTxnForm(tf=>({...tf,fotoKendaraan:img})))} style={{fontSize:12,color:C.text}}/>
                {txnForm.fotoKendaraan && <img src={txnForm.fotoKendaraan} alt="kendaraan" style={{width:"100%",height:isMobile?140:70,objectFit:"cover",borderRadius:6,marginTop:6,border:`1px solid ${C.border}`}}/>}
              </div>
              <div>
                <label style={sty.label}>Foto SIM / KTP Pengemudi</label>
                <input type="file" accept="image/*" capture="environment" onChange={e=>handleImg(e, img=>setTxnForm(tf=>({...tf,fotoSimKtp:img})))} style={{fontSize:12,color:C.text}}/>
                {txnForm.fotoSimKtp && <img src={txnForm.fotoSimKtp} alt="sim ktp" style={{width:"100%",height:isMobile?140:70,objectFit:"cover",borderRadius:6,marginTop:6,border:`1px solid ${C.border}`}}/>}
              </div>
              <div>
                <label style={sty.label}>Surat Permintaan/Pengembalian</label>
                <input type="file" accept="image/*" capture="environment" onChange={e=>handleImg(e, img=>setTxnForm(tf=>({...tf,fotoSuratPengembalian:img})))} style={{fontSize:12,color:C.text}}/>
                {txnForm.fotoSuratPengembalian && <img src={txnForm.fotoSuratPengembalian} alt="surat" style={{width:"100%",height:isMobile?140:70,objectFit:"cover",borderRadius:6,marginTop:6,border:`1px solid ${C.border}`}}/>}
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
                      <div style={{fontSize:12,fontWeight:600,marginBottom:4,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{stock?.name||"-"}</div>
                      <input type="file" accept="image/*" capture="environment" onChange={e=>handleMaterialImg(e, si.stockId)} style={{fontSize:12,color:C.muted,width:"100%"}}/>
                      {existingPhoto && <img src={existingPhoto.img} alt={stock?.name} style={{width:"100%",height:60,objectFit:"cover",borderRadius:6,marginTop:6}}/>}
                    </div>
                  );
                })}
                {txnForm.stockItems.filter(si=>si.stockId).length===0 && <div style={{fontSize:12,color:C.muted,fontStyle:"italic"}}>Pilih barang terlebih dahulu untuk upload foto material</div>}
              </div>
            </div>

            <div style={sty.stickyFooter}>
              <button style={{...sty.btn("ghost"),flex:1}} onClick={()=>{setTxnModal(false);setEditingDraftTxnId(null);}}>Batal</button>
              <button style={{...sty.btn("primary"),flex:2}} onClick={saveTxn}>{editingDraftTxnId?"📤 Lengkapi & Ajukan TUG-9":`📤 Ajukan ${txnForm.docType.replace("TUG","TUG-")}`}</button>
            </div>
          </div>
        </div>
      )}

      {/* TXN MODAL - TUG10 FORM (incoming material / return to warehouse) */}
      {txnModal && txnForm && txnForm.docType==="TUG10" && (() => {
        const hl = key => tug10Highlight===key ? { boxShadow:"0 0 0 2px #dc2626", borderRadius:8 } : {};
        const setRef = key => el => { tug10Refs.current[key] = el; };
        const isLegacyGud = txnForm.gudangTujuanId==="__legacy__";
        const hasLegacyBlok = lokasiList.some(l=>!l.gudangId);
        const tug10Subs = subGudangList.filter(sg=>sg.gudangId===txnForm.gudangTujuanId);
        const tug10Bloks = isLegacyGud
          ? lokasiList.filter(l=>!l.gudangId)
          : (!txnForm.gudangTujuanId ? [] : lokasiList.filter(l=>l.gudangId===txnForm.gudangTujuanId && (tug10Subs.length===0 || (l.subGudangId||"")===(txnForm.subGudangTujuanId||""))));
        const gudSatpams = satpamList.filter(sp=>sp.gudangId && sp.gudangId===txnForm.gudangTujuanId);
        const selGud = gudangList.find(g=>g.id===txnForm.gudangTujuanId);
        const selSub = subGudangList.find(sg=>sg.id===txnForm.subGudangTujuanId);
        const selBlok = lokasiList.find(l=>l.id===txnForm.lokasiTujuanId);
        const breadcrumb = [selGud?.nama || (isLegacyGud?"Legacy (tanpa gudang)":null), selSub?.nama, selBlok?.kode].filter(Boolean).join(" › ");
        const missingList = tug10Missing(txnForm);
        return (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000,padding:20}}>
          <div style={{...sty.card,width:700,maxWidth:"100%",maxHeight:"90dvh",overflowY:"auto"}}>
            <div style={sty.modalHeader}>
              <span style={{fontWeight:800,fontSize:15}}>Formulir TUG-10 — Bon Pengembalian</span>
              <div style={{display:"flex",alignItems:"center",gap:12,flexShrink:0}}>
                <span style={{fontSize:12,fontWeight:700,color:"white",background:"rgba(255,255,255,0.18)",borderRadius:6,padding:"3px 9px",whiteSpace:"nowrap"}}>No: {docSeq}.TUG-10/...</span>
                <button onClick={()=>{setTxnModal(false);setEditingDraftTxnId(null);}} style={{background:"transparent",border:"none",color:"white",fontSize:24,lineHeight:1,cursor:"pointer",padding:0,opacity:0.85}}>×</button>
              </div>
            </div>
            <div style={{background:"#fef3c7",border:`1px solid #fcd34d`,borderRadius:8,padding:"8px 12px",fontSize:12,color:"#92400e",marginBottom:16}}>⚠️ Transaksi akan PENDING sampai disetujui TL Logistik / Asman. Stok akan BERTAMBAH saat disetujui.</div>

            {!can(currentUser, "aksi.buatTransaksi", rolePerms) && (
              <div style={{background:"#fee2e2",border:"1px solid #fca5a5",borderRadius:8,padding:"8px 12px",fontSize:12,color:"#991b1b",marginBottom:16,fontWeight:600}}>🚫 Role kamu ({ROLES[currentUser?.role]||currentUser?.role||"-"}) tidak bisa mengajukan TUG-10 — hubungi Admin Gudang / TL Logistik.</div>
            )}

            <div style={{fontSize:12,fontWeight:800,color:C.accent,marginBottom:8,borderBottom:`1px solid ${C.border}`,paddingBottom:4}}>DATA PEKERJAAN</div>
            <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"1fr 1fr",gap:12,marginBottom:14}}>
              <div><label style={sty.label}>Pekerjaan (jenis)</label><input style={sty.input} value={txnForm.pekerjaan} onChange={e=>setTxnForm(tf=>({...tf,pekerjaan:e.target.value}))} placeholder="cth: Penggantian"/></div>
              <div><label style={sty.label}>No. BA Penggantian</label><input style={sty.input} value={txnForm.noBAPenggantian} onChange={e=>setTxnForm(tf=>({...tf,noBAPenggantian:e.target.value}))} placeholder="0266/PT-SD/VI/2026"/></div>
              <div ref={setRef("namaPekerjaan")} style={{gridColumn:"1/-1",...hl("namaPekerjaan")}}><label style={sty.label}>Nama Pekerjaan *</label><input style={sty.input} value={txnForm.namaPekerjaan} onChange={e=>setTxnForm(tf=>({...tf,namaPekerjaan:e.target.value}))} placeholder="cth: Pengembalian Material Relay GIS Darmo dan GIS Waru"/></div>
              <div ref={setRef("lokasiPekerjaan")} style={{gridColumn:"1/-1",...hl("lokasiPekerjaan")}}><label style={sty.label}>Lokasi Pekerjaan *</label><input style={sty.input} value={txnForm.lokasiPekerjaan} onChange={e=>setTxnForm(tf=>({...tf,lokasiPekerjaan:e.target.value}))} placeholder="cth: GIS Darmo dan GIS Waru"/></div>
            </div>

            <div style={{fontSize:12,fontWeight:800,color:C.accent,marginBottom:8,borderBottom:`1px solid ${C.border}`,paddingBottom:4}}>PIHAK & LOKASI PENYIMPANAN</div>
            <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"1fr 1fr",gap:12,marginBottom:10}}>
              <div ref={setRef("menyerahkanNama")} style={{...hl("menyerahkanNama")}}>
                <label style={sty.label}>Yang Menyerahkan *</label>
                <input style={sty.input} value={txnForm.menyerahkanNama} onChange={e=>setTxnForm(tf=>({...tf,menyerahkanNama:e.target.value}))} placeholder="cth: PT. Mitra Jaya"/>
              </div>
              <div>
                <label style={sty.label}>Gudang Penyimpanan *</label>
                <select style={sty.select} value={txnForm.gudangTujuanId||""} onChange={e=>{ const gid=e.target.value; setTxnForm(tf=>{ const cand=satpamList.filter(sp=>sp.gudangId===gid); return {...tf, gudangTujuanId:gid, subGudangTujuanId:"", lokasiTujuanId:"", satpamId: cand.length===1?cand[0].id:""}; }); }}>
                  <option value="">-- Pilih Gudang --</option>
                  {visibleGudangList.map(g=>{ const up=uptList.find(u=>u.id===g.uptId); return <option key={g.id} value={g.id}>{g.nama}{up?` — ${up.nama}`:""}</option>; })}
                  {hasLegacyBlok && <option value="__legacy__">Blok tanpa gudang (legacy)</option>}
                </select>
                {gudangList.length===0 && <div style={{fontSize:12,color:"#be185d",marginTop:4}}>Belum ada Master Gudang. Tambahkan dulu di Master Data → Master Gudang.</div>}
              </div>
              {!isLegacyGud && tug10Subs.length>0 && (
                <div>
                  <label style={sty.label}>Sub Gudang</label>
                  <select style={sty.select} value={txnForm.subGudangTujuanId||""} onChange={e=>setTxnForm(tf=>({...tf,subGudangTujuanId:e.target.value,lokasiTujuanId:""}))}>
                    <option value="">— Tanpa Sub Gudang —</option>
                    {tug10Subs.map(sg=><option key={sg.id} value={sg.id}>{sg.nama}</option>)}
                  </select>
                </div>
              )}
              <div ref={setRef("lokasiTujuanId")} style={{...hl("lokasiTujuanId")}}>
                <label style={sty.label}>Blok Penyimpanan *</label>
                <select style={sty.select} value={txnForm.lokasiTujuanId||""} disabled={!txnForm.gudangTujuanId} onChange={e=>setTxnForm(tf=>({...tf,lokasiTujuanId:e.target.value}))}>
                  <option value="">{txnForm.gudangTujuanId?"-- Pilih Blok --":"Pilih gudang dulu"}</option>
                  {tug10Bloks.map(l=><option key={l.id} value={l.id}>{l.kode} {l.keterangan?`— ${l.keterangan}`:""}</option>)}
                </select>
                {txnForm.gudangTujuanId && tug10Bloks.length===0 && <div style={{fontSize:12,color:"#be185d",marginTop:4}}>Belum ada blok pada pilihan ini. Tambahkan di Master Data → Master Gudang.</div>}
              </div>
              <div style={{gridColumn:isMobile?"auto":"1/-1"}}>
                <label style={sty.label}>Satpam Gudang (Mengetahui)</label>
                <select style={sty.select} value={txnForm.satpamId||""} disabled={!txnForm.gudangTujuanId||isLegacyGud} onChange={e=>setTxnForm(tf=>({...tf,satpamId:e.target.value}))}>
                  <option value="">{(!txnForm.gudangTujuanId||isLegacyGud)?"Pilih gudang dulu":"-- Pilih Satpam --"}</option>
                  {(gudSatpams.length>0?gudSatpams:(txnForm.gudangTujuanId&&!isLegacyGud?satpamList:[])).map(sp=><option key={sp.id} value={sp.id}>{sp.name}{gudSatpams.length===0?" (gudang lain)":""}</option>)}
                </select>
                {txnForm.gudangTujuanId && !isLegacyGud && gudSatpams.length===0 && <div style={{fontSize:12,color:"#be185d",marginTop:4}}>Belum ada satpam untuk gudang ini — tambahkan di Master Data → Satpam. Sementara bisa pilih dari semua satpam.</div>}
              </div>
              {breadcrumb && <div style={{gridColumn:isMobile?"auto":"1/-1",fontSize:12,color:C.accent,fontWeight:700,background:"#eef2ff",border:"1px solid #c7d2fe",borderRadius:8,padding:"6px 10px"}}>📍 {breadcrumb}</div>}
            </div>

            <div style={{fontSize:12,fontWeight:800,color:C.accent,marginBottom:8,borderBottom:`1px solid ${C.border}`,paddingBottom:4}}>BARANG / MATERIAL RETUR</div>
            <div style={{fontSize:12,color:C.muted,marginBottom:8,fontStyle:"italic"}}>💡 Pilih dari katalog yang sudah ada, atau daftarkan barang baru langsung di sini.</div>
            {txnForm.stockItems.map((si,idx)=>{
              const n = idx+1;
              const isAttb = si.statusMaterial==="Bongkaran ATTB (MTU)";
              const barangOk = si.katalogMode==="existing" ? !!si.katalogId : !!si.namaBaru?.trim();
              const qtyOk = si.qty>0;
              const fotoOk = !!si.fotoBarangRetur;
              const seriOk = !isAttb || !!si.noSeri?.trim();
              const nameplateOk = !isAttb || !!si.fotoNameplate;
              const complete = barangOk && qtyOk && fotoOk && seriOk && nameplateOk;
              const collapsed = complete && tug10Collapsed[idx];
              const kat = si.katalogMode==="existing" ? katalogList.find(k=>k.id===si.katalogId) : null;
              const namaDisplay = si.katalogMode==="existing" ? (kat?.name||"-") : (si.namaBaru||"(barang baru)");
              const satuanDisplay = si.katalogMode==="existing" ? (kat?.satuan||"") : (si.satuanBaru||"");
              const bs = statusMaterialBadgeStyle(si.statusMaterial);
              const hint = txt => <div style={{fontSize:12,color:"#be185d",marginTop:4}}>{txt}</div>;
              return (
              <div key={idx} ref={setRef(`item-${idx}`)} style={{border:`1px solid ${complete?"#bbf7d0":C.border}`,borderRadius:10,padding:12,marginBottom:10,background:complete?"#f6fefb":"#f9fafb",...hl(`item-${idx}`)}}>
                <div style={{display:"flex",gap:8,alignItems:"center",marginBottom:collapsed?0:8,flexWrap:"wrap"}}>
                  <span style={{fontSize:12,fontWeight:800,color:C.accent}}>Barang #{n}</span>
                  <span style={{fontSize:12,fontWeight:700,padding:"1px 8px",borderRadius:20,background:bs.bg,color:bs.fg}}>{si.statusMaterial}</span>
                  {complete && <span style={{fontSize:12,color:"#16a34a",fontWeight:700}}>✓ Lengkap</span>}
                  <div style={{marginLeft:"auto",display:"flex",gap:6}}>
                    {complete && <button type="button" style={{...sty.btn("ghost","sm")}} onClick={()=>setTug10Collapsed(c=>({...c,[idx]:!c[idx]}))}>{collapsed?"▼ Buka":"▲ Ringkas"}</button>}
                    {txnForm.stockItems.length>1 && <button type="button" title="Hapus barang retur ini" style={{...sty.btn("danger","sm")}} onClick={()=>removeItemRow(idx)}>✕</button>}
                  </div>
                </div>

                {collapsed ? (
                  <div onClick={()=>setTug10Collapsed(c=>({...c,[idx]:false}))} style={{cursor:"pointer",fontSize:12,color:C.text,paddingTop:6}}>
                    <b>{namaDisplay}</b> · {fmtNum(si.qty)} {satuanDisplay}{si.noAsset?` · Asset ${si.noAsset}`:""} · 📷 Foto ✓{isAttb?" · Nameplate ✓":""}
                  </div>
                ) : (<>
                <div style={{display:"flex",gap:8,marginBottom:8}}>
                  <button type="button" style={{...sty.btn(si.katalogMode==="existing"?"primary":"ghost","sm"),flex:1}} onClick={()=>updateItemRow(idx,"katalogMode","existing")}>📑 Dari Katalog</button>
                  <button type="button" style={{...sty.btn(si.katalogMode==="new"?"primary":"ghost","sm"),flex:1}} onClick={()=>updateItemRow(idx,"katalogMode","new")}>✨ Barang Baru</button>
                </div>

                {si.katalogMode==="existing" ? (
                  <div style={{marginBottom:8}}>
                    <label style={sty.label}>Pilih Barang *</label>
                    <SearchableSelect
                      options={katalogList}
                      value={si.katalogId}
                      onChange={v=>updateItemRow(idx,"katalogId",v)}
                      getLabel={k=>`${k.name} [${k.katalog}]`}
                      getSearchText={k=>`${k.name} ${k.katalog||""}`}
                      placeholder="-- Cari & pilih dari Master Katalog --"
                      sty={sty} C={C} isMobile={isMobile}
                    />
                    {!barangOk && hint("Wajib: pilih barang dari katalog.")}
                  </div>
                ) : (
                  <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"1fr 1fr",gap:8,marginBottom:8}}>
                    <div style={{gridColumn:"1/-1"}}><label style={sty.label}>Nama Barang Baru *</label><input style={sty.input} value={si.namaBaru} onChange={e=>updateItemRow(idx,"namaBaru",e.target.value)} placeholder="cth: Relay CCP Bongkaran"/>{!barangOk && hint("Wajib: isi nama barang baru.")}</div>
                    <div><label style={sty.label}>Nomor Katalog</label><input style={sty.input} value={si.katalogBaru} onChange={e=>updateItemRow(idx,"katalogBaru",e.target.value)}/></div>
                    <div><label style={sty.label}>Satuan</label><input style={sty.input} value={si.satuanBaru} onChange={e=>updateItemRow(idx,"satuanBaru",e.target.value)} placeholder="cth: BH, pcs, unit"/></div>
                    <div style={{gridColumn:"1/-1"}}><label style={sty.label}>Kategori</label><select style={sty.select} value={si.categoryBaru} onChange={e=>updateItemRow(idx,"categoryBaru",e.target.value)}>{CATEGORIES.map(c=><option key={c}>{c}</option>)}</select></div>
                  </div>
                )}

                <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"1fr 1fr",gap:8,marginBottom:8}}>
                  <div><label style={sty.label}>Jumlah *</label><input style={sty.input} type="number" inputMode="decimal" min="1" value={si.qty} onChange={e=>updateItemRow(idx,"qty",Number(e.target.value))}/>{!qtyOk && hint("Wajib: jumlah harus lebih dari 0.")}</div>
                  <div><label style={sty.label}>Nomor Asset</label><input style={sty.input} value={si.noAsset} onChange={e=>updateItemRow(idx,"noAsset",e.target.value)}/></div>
                </div>

                <div style={{marginBottom:8}}>
                  <label style={sty.label}>Status Material</label>
                  <div style={{display:"flex",flexDirection:isMobile?"column":"row",gap:8}}>
                    {STATUS_MATERIAL_RETUR.map(sm=>{
                      const smbs = statusMaterialBadgeStyle(sm);
                      const active = si.statusMaterial===sm;
                      return (
                        <button key={sm} type="button" style={{flex:1,padding:"8px",borderRadius:8,border:`2px solid ${active?smbs.fg:C.border}`,background:active?smbs.bg:"white",color:active?smbs.fg:C.muted,cursor:"pointer",fontWeight:700,fontSize:12}} onClick={()=>updateItemRow(idx,"statusMaterial",sm)}>{sm}</button>
                      );
                    })}
                  </div>
                  {si.statusMaterial==="Bongkaran" && <div style={{fontSize:12,color:"#854d0e",marginTop:4}}>ℹ️ Jenis Barang otomatis menjadi "Bongkaran".</div>}
                  {isAttb && <div style={{fontSize:12,color:"#92400e",marginTop:4}}>ℹ️ Jenis Barang otomatis menjadi "ATTB". Wajib lengkapi data tambahan di bawah.</div>}
                </div>

                <div style={{background:"#f0fdf4",border:`1px solid #bbf7d0`,borderRadius:8,padding:10,marginBottom:isAttb?8:0}}>
                  <label style={sty.label}>Foto Barang * (wajib untuk semua status)</label>
                  <div style={{display:"flex",gap:10,alignItems:"center",marginTop:4,flexWrap:"wrap"}}>
                    {si.fotoBarangRetur && <img src={si.fotoBarangRetur} alt="barang" style={{width:isMobile?"100%":72,height:isMobile?140:72,objectFit:"cover",borderRadius:6}}/>}
                    <label style={{...sty.btn("ghost","sm"),cursor:"pointer"}}>📷 {si.fotoBarangRetur?"Ganti Foto":"Ambil / Pilih Foto"}<input type="file" accept="image/*" capture="environment" style={{display:"none"}} onChange={e=>handleImg(e, img=>updateItemRow(idx,"fotoBarangRetur",img))}/></label>
                    {si.fotoBarangRetur && <button type="button" style={{...sty.btn("danger","sm")}} onClick={()=>updateItemRow(idx,"fotoBarangRetur",null)}>Hapus</button>}
                  </div>
                  {!fotoOk && hint("Wajib: unggah foto barang.")}
                </div>

                {isAttb && (
                  <div style={{background:"#fffbeb",border:`1px solid #fde68a`,borderRadius:8,padding:10}}>
                    <div style={{fontSize:12,fontWeight:700,color:"#92400e",marginBottom:8}}>📋 Data Tambahan Wajib — Bongkaran ATTB (MTU)</div>
                    <div style={{marginBottom:8}}><label style={sty.label}>Nomor Seri Material *</label><input style={sty.input} value={si.noSeri} onChange={e=>updateItemRow(idx,"noSeri",e.target.value)} placeholder="cth: SN-2024-001"/>{!seriOk && hint("Wajib: isi nomor seri material.")}</div>
                    <div>
                      <label style={sty.label}>Foto Nameplate *</label>
                      <div style={{display:"flex",gap:10,alignItems:"center",marginTop:4,flexWrap:"wrap"}}>
                        {si.fotoNameplate && <img src={si.fotoNameplate} alt="nameplate" style={{width:isMobile?"100%":72,height:isMobile?140:72,objectFit:"cover",borderRadius:6}}/>}
                        <label style={{...sty.btn("ghost","sm"),cursor:"pointer"}}>📷 {si.fotoNameplate?"Ganti Foto":"Ambil / Pilih Foto"}<input type="file" accept="image/*" capture="environment" style={{display:"none"}} onChange={e=>handleImg(e, img=>updateItemRow(idx,"fotoNameplate",img))}/></label>
                        {si.fotoNameplate && <button type="button" style={{...sty.btn("danger","sm")}} onClick={()=>updateItemRow(idx,"fotoNameplate",null)}>Hapus</button>}
                      </div>
                      {!nameplateOk && hint("Wajib: unggah foto nameplate.")}
                    </div>
                  </div>
                )}
                </>)}
              </div>
              );
            })}
            <button type="button" className="tug-add-item" onClick={addItemRow}><span className="tug-add-item__ic" aria-hidden="true">+</span>Tambah Barang Retur Lain</button>

            {txnForm.stockItems.some(si=>si.statusMaterial==="Bongkaran ATTB (MTU)") && (
              <div ref={setRef("fotoBAPengembalian")} style={{marginBottom:16,...hl("fotoBAPengembalian")}}>
                <label style={sty.label}>Upload Surat BA Pengembalian * (foto)</label>
                <div style={{display:"flex",gap:10,alignItems:"center",marginTop:4,flexWrap:"wrap"}}>
                  {txnForm.fotoBAPengembalian && <img src={txnForm.fotoBAPengembalian} alt="BA Pengembalian" style={{width:isMobile?"100%":72,height:isMobile?140:72,objectFit:"cover",borderRadius:6,border:`1px solid ${C.border}`}}/>}
                  <label style={{...sty.btn("ghost","sm"),cursor:"pointer"}}>📷 {txnForm.fotoBAPengembalian?"Ganti Foto":"Ambil / Pilih Foto"}<input type="file" accept="image/*" capture="environment" style={{display:"none"}} onChange={e=>handleImg(e, img=>setTxnForm(tf=>({...tf,fotoBAPengembalian:img})))}/></label>
                  {txnForm.fotoBAPengembalian && <button type="button" style={{...sty.btn("danger","sm")}} onClick={()=>setTxnForm(tf=>({...tf,fotoBAPengembalian:null}))}>Hapus</button>}
                </div>
                {!txnForm.fotoBAPengembalian && <div style={{fontSize:12,color:"#be185d",marginTop:4}}>Wajib karena ada material Bongkaran ATTB (MTU).</div>}
              </div>
            )}

            <div style={{border:`1px solid ${missingList.length?"#fecaca":"#bbf7d0"}`,background:missingList.length?"#fef2f2":"#f0fdf4",borderRadius:8,padding:"8px 12px",marginBottom:12,fontSize:12}}>
              {missingList.length===0
                ? <div style={{color:"#166534",fontWeight:800}}>✅ Siap diajukan</div>
                : <div style={{color:"#be185d"}}><b>Kurang:</b> {missingList.map(m=>m.label).join(" · ")}</div>}
            </div>

            <div style={sty.stickyFooter}>
              <button style={{...sty.btn("ghost"),flex:1}} onClick={()=>{setTxnModal(false);setEditingDraftTxnId(null);}}>Batal</button>
              <button disabled={savingTxn} style={{...sty.btn("primary"),flex:2,opacity:savingTxn?0.7:1,cursor:savingTxn?"wait":"pointer"}} onClick={saveTxn}>{savingTxn?"⏳ Menyimpan...":"📤 Ajukan TUG-10"}</button>
            </div>
          </div>
        </div>
        );
      })()}

      {/* TXN MODAL - TUG3 FORM (Karantina — penerimaan barang tahap 1) */}
      {txnModal && txnForm && txnForm.docType==="TUG3" && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000,padding:20}}>
          <div style={{...sty.card,width:700,maxWidth:"100%",maxHeight:"90dvh",overflowY:"auto"}}>
            <div style={sty.modalHeader}>
              <span style={{fontWeight:800,fontSize:15}}>Formulir TUG-3 Karantina — Bon Penerimaan</span>
              <div style={{display:"flex",alignItems:"center",gap:12,flexShrink:0}}>
                <span style={{fontSize:12,fontWeight:700,color:"white",background:"rgba(255,255,255,0.18)",borderRadius:6,padding:"3px 9px",whiteSpace:"nowrap"}}>No: {docSeq}.TUG-3/...</span>
                <button onClick={()=>setTxnModal(false)} style={{background:"transparent",border:"none",color:"white",fontSize:24,lineHeight:1,cursor:"pointer",padding:0,opacity:0.85}}>×</button>
              </div>
            </div>
            <div style={{background:"#dbeafe",border:`1px solid #93c5fd`,borderRadius:8,padding:"8px 12px",fontSize:12,color:"#1e40af",marginBottom:16}}>ℹ️ Setelah diajukan: TL Logistik approve → lanjut isi TUG-4 → Manager approve → lengkapi lampiran → Asman approve → stok masuk gudang.</div>

            <div style={{fontSize:12,fontWeight:800,color:C.accent,marginBottom:8,borderBottom:`1px solid ${C.border}`,paddingBottom:4}}>DATA PENERIMAAN</div>
            <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"1fr 1fr",gap:12,marginBottom:10}}>
              <div><label style={sty.label}>Tanggal Diterima *</label><input type="date" style={sty.input} value={txnForm.tanggalDiterima} onChange={e=>setTxnForm(tf=>({...tf,tanggalDiterima:e.target.value}))}/></div>
              <div><label style={sty.label}>Dari (Supplier) *</label><input style={sty.input} value={txnForm.dariSupplier} onChange={e=>setTxnForm(tf=>({...tf,dariSupplier:e.target.value}))} placeholder="cth: PT. Sedayu"/></div>
              <div style={{gridColumn:"1/-1"}}><label style={sty.label}>Dengan</label><input style={sty.input} value={txnForm.denganKirim} onChange={e=>setTxnForm(tf=>({...tf,denganKirim:e.target.value}))} placeholder="cth: Dikirim Langsung"/></div>
            </div>
            <div style={{fontSize:12,fontWeight:700,color:C.muted,textTransform:"uppercase",letterSpacing:".5px",marginBottom:8}}>Dokumen Pengiriman</div>
            <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"1fr 1fr",gap:12,marginBottom:10}}>
              <div><label style={sty.label}>No. Surat Jalan</label><input style={sty.input} value={txnForm.noSuratJalan} onChange={e=>setTxnForm(tf=>({...tf,noSuratJalan:e.target.value}))}/></div>
              <div><label style={sty.label}>Tgl. Surat Jalan</label><input type="date" style={sty.input} value={txnForm.tglSuratJalan} onChange={e=>setTxnForm(tf=>({...tf,tglSuratJalan:e.target.value}))}/></div>
              <div><label style={sty.label}>No. SPK / Surat Pesanan</label><input style={sty.input} value={txnForm.noSpk} onChange={e=>setTxnForm(tf=>({...tf,noSpk:e.target.value}))}/></div>
              <div><label style={sty.label}>Tgl. SPK</label><input type="date" style={sty.input} value={txnForm.tglSpk} onChange={e=>setTxnForm(tf=>({...tf,tglSpk:e.target.value}))}/></div>
            </div>
            <div style={{fontSize:12,fontWeight:700,color:C.muted,textTransform:"uppercase",letterSpacing:".5px",marginBottom:8}}>Dokumen Keuangan</div>
            <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"1fr 1fr",gap:12,marginBottom:14}}>
              <div><label style={sty.label}>No. Faktur / Bukti Kas</label><input style={sty.input} value={txnForm.noFaktur} onChange={e=>setTxnForm(tf=>({...tf,noFaktur:e.target.value}))}/></div>
              <div><label style={sty.label}>Tgl. Faktur</label><input type="date" style={sty.input} value={txnForm.tglFaktur} onChange={e=>setTxnForm(tf=>({...tf,tglFaktur:e.target.value}))}/></div>
              <div><label style={sty.label}>No. Amandemen/Kontrak</label><input style={sty.input} value={txnForm.noAmandemen} onChange={e=>setTxnForm(tf=>({...tf,noAmandemen:e.target.value}))}/></div>
              <div><label style={sty.label}>Biaya Angkutan</label><input type="number" inputMode="decimal" style={sty.input} value={txnForm.biayaAngkutan} onChange={e=>setTxnForm(tf=>({...tf,biayaAngkutan:Number(e.target.value)}))}/></div>
            </div>

            <div style={{fontSize:12,fontWeight:800,color:C.accent,marginBottom:8,borderBottom:`1px solid ${C.border}`,paddingBottom:4}}>BARANG / SPARE PARTS</div>
            <div style={{fontSize:12,color:C.muted,marginBottom:8,fontStyle:"italic"}}>💡 Pilih dari katalog yang sudah ada, atau daftarkan barang baru langsung di sini.</div>
            {txnForm.stockItems.map((si,idx)=>(
              <div key={idx} style={{border:`1px solid ${C.border}`,borderRadius:10,padding:12,marginBottom:10,background:"#f9fafb"}}>
                <div style={{display:"flex",gap:8,marginBottom:8}}>
                  <button type="button" style={{...sty.btn(si.katalogMode==="existing"?"primary":"ghost","sm"),flex:1}} onClick={()=>updateItemRow(idx,"katalogMode","existing")}>📑 Dari Katalog</button>
                  <button type="button" style={{...sty.btn(si.katalogMode==="new"?"primary":"ghost","sm"),flex:1}} onClick={()=>updateItemRow(idx,"katalogMode","new")}>✨ Barang Baru</button>
                  {txnForm.stockItems.length>1 && <button type="button" title="Hapus barang ini" style={{...sty.btn("danger","sm")}} onClick={()=>removeItemRow(idx)}>✕</button>}
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
                      sty={sty} C={C} isMobile={isMobile}
                    />
                  </div>
                ) : (
                  <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"1fr 1fr",gap:8,marginBottom:8}}>
                    <div style={{gridColumn:"1/-1"}}><label style={sty.label}>Nama Barang Baru</label><input style={sty.input} value={si.namaBaru} onChange={e=>updateItemRow(idx,"namaBaru",e.target.value)} placeholder="cth: INSUL MEDIA;OIL;NAPHTHENIC"/></div>
                    <div><label style={sty.label}>Nomor Katalog</label><input style={sty.input} value={si.katalogBaru} onChange={e=>updateItemRow(idx,"katalogBaru",e.target.value)} placeholder="cth: 4180023"/></div>
                    <div><label style={sty.label}>Satuan</label><input style={sty.input} value={si.satuanBaru} onChange={e=>updateItemRow(idx,"satuanBaru",e.target.value)} placeholder="cth: L, BH, pcs"/></div>
                    <div style={{gridColumn:"1/-1"}}><label style={sty.label}>Kategori</label><select style={sty.select} value={si.categoryBaru} onChange={e=>updateItemRow(idx,"categoryBaru",e.target.value)}>{CATEGORIES.map(c=><option key={c}>{c}</option>)}</select></div>
                  </div>
                )}
                <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"1fr 1fr 1fr",gap:8}}>
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
            <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"1fr 1fr",gap:12,marginBottom:16}}>
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
      {docPreview && (() => {
        // dp = transaksi dgn SIM/KTP privat sudah jadi signed URL (foto lain sudah
        // URL publik). Fallback ke docPreview mentah selama resolusi berjalan.
        const dp = docPreviewDoc || docPreview;
        return (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.6)",display:"flex",flexDirection:"column",zIndex:1500}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"12px 18px",background:C.sidebar,flexShrink:0}}>
            <div style={{color:"white",fontWeight:700,fontSize:14}}>📄 Dokumen {dp.docType.replace("TUG","TUG-")} — {dp.docNumbers?.[docKeyOf(dp)]||dp.id}</div>
            <div style={{display:"flex",gap:8}}>
              <button style={{...sty.btn("success"),padding:"7px 16px"}} onClick={()=>{
                if (dp.docType==="TUG10") downloadTUG10HTML(dp, katalogList, lokasiList, users, satpamList, gudangList, subGudangList, showToast);
                else if (dp.docType==="TUG3") downloadTUG3HTML(dp, katalogList, lokasiList, timMutuList, users, showToast);
                else if (dp.docType==="TUG5") downloadTUG5HTML(dp, katalogList, uitList, users, showToast, ultgList);
                else if (dp.docType==="TUG7") downloadTUG7HTML(dp, katalogList, uitList, uptList, users, showToast);
                else downloadTUG9HTML(dp, enrichedStocks, users, satpamList, showToast);
              }}>⬇️ Unduh File (untuk Print/PDF)</button>
              <button style={{background:"#dc2626",color:"white",border:"none",borderRadius:8,padding:"7px 16px",cursor:"pointer",fontSize:13,fontWeight:600}} onClick={()=>setDocPreview(null)}>✕ Tutup</button>
            </div>
          </div>
          <div style={{flex:1,background:"#e5e7eb",overflow:"hidden"}}>
            <iframe
              title="Document Preview"
              srcDoc={dp.docType==="TUG10" ? buildTUG10HTML(dp, katalogList, lokasiList, users, satpamList, gudangList, subGudangList) : dp.docType==="TUG3" ? buildTUG3HTML(dp, katalogList, lokasiList, timMutuList, users) : dp.docType==="TUG5" ? buildTUG5HTML(dp, katalogList, uitList, users, ultgList) : dp.docType==="TUG7" ? buildTUG7HTML(dp, katalogList, uitList, uptList, users) : buildTUG9HTML(dp, enrichedStocks, users, satpamList)}
              style={{width:"100%",height:"100%",border:"none"}}
            />
          </div>
          <div style={{padding:"8px 18px",background:"#fef3c7",fontSize:12,color:"#92400e",flexShrink:0}}>
            💡 Tips: klik "Unduh File", buka file-nya di browser HP/laptop, lalu pilih menu Print → Save as PDF untuk dapat file PDF asli.
          </div>
        </div>
        );
      })()}

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

// Normalisasi nama Gudang untuk pencocokan import Kapasitas Gudang -> Master Gudang.
// Sebelumnya cuma trim+uppercase persis (String(a).trim().toUpperCase()===...) — variasi
// kecil penulisan di Excel (titik/strip/underscore, spasi ganda) bikin gudang yang SAMA
// gagal cocok dan ke-duplikat sebagai Gudang baru (ditemukan user 2026-07-06, ini juga
// alasan tombol "Gabungkan Gudang Duplikat" harus ada sebagai perbaikan berulang).
// Diperketat: hilangkan tanda baca umum, rapatkan spasi — TIDAK mengubah data asli,
// cuma dipakai saat membandingkan.
function normalizeGudangName(s) {
  return String(s || "")
    .trim()
    .toUpperCase()
    .replace(/[.\-_/]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Saran Gudang existing yang "mirip" (token overlap nama) di UPT yang sama — dipakai di
// panel konfirmasi Admin saat import Kapasitas Gudang mendeteksi kandidat Gudang baru,
// supaya Admin bisa pilih "ini sebenarnya Gudang yang sudah ada" kalau normalisasi di
// atas masih belum berhasil mencocokkan (mis. singkatan berbeda: "GD" vs "GUDANG").
function suggestSimilarGudang(name, uptId, gudangList) {
  const targetWords = normalizeGudangName(name).split(" ").filter(Boolean);
  if (!targetWords.length) return [];
  return gudangList
    .filter(g => g.uptId === uptId)
    .map(g => {
      const words = normalizeGudangName(g.nama).split(" ").filter(Boolean);
      const overlap = targetWords.filter(w => words.includes(w)).length;
      return { g, overlap };
    })
    .filter(x => x.overlap > 0)
    .sort((a, b) => b.overlap - a.overlap)
    .slice(0, 5)
    .map(x => x.g);
}

// ════════════════════════════════════════════════════════════════════
// KAPASITAS GUDANG TAB
// ════════════════════════════════════════════════════════════════════
