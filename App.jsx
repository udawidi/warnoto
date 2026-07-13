// PT. PLN UPT Surabaya - Gudang Ketintang
// Sistem Tata Usaha Gudang (TUG) Digital - v3.0
// TUG-9: Bon Pemakaian + Surat Jalan + BAST

import { useState, useEffect, useRef, useCallback, useMemo, Fragment } from "react";
import { COMPANY, UIT, UPT, WAREHOUSE, DOC_CODE, APP_VERSION, KAPASITAS_LABEL, ROMAN, JENIS_BARANG } from "./src/constants.js";
import { supabase, SUPABASE_URL, SUPABASE_KEY, usernameToAuthEmail } from "./src/supabaseClient.js";
import { C, makeSty } from "./src/theme.js";
import { generateDocNumbers, uid, fmtDate, fmtDateOnly, fmtRp, buildStockStats, formatStockStatsText, parseSAPRowsFromCSV, parseUsulanPencocokanXLSX, parseSAPRowsFromXLSX, parseIndoNumber, mapSAPRow, parseSAPFile, terbilangHari, enrichStock, enrichStocks, dedupeById, migrateLegacyStocks } from "./src/lib/utils.js";
import { buildTUG9HTML, buildTUG10HTML, downloadTUG10HTML, buildTUG5HTML, buildTUG5ULTGHTML, buildTUG7HTML, downloadTUG5HTML, buildHeavyEquipmentLoanHTML, downloadHeavyEquipmentLoanHTML, buildBeritaAcaraHTML, downloadTUG7HTML, buildTUG3HTML, downloadTUG3HTML, downloadTUG9HTML } from "./src/lib/docBuilders.js";
import { normalizeSearchText, expandHaystackSynonyms, queryTokenGroups, expandQueryForIlikeSearch, matchesMaterialSearch, matchesStockSearch, matchesKatalogSearch, totalQtyForKatalog, lokasiUsedCapacity, statusMaterialBadgeStyle, getSAPStatus, getSAPBadgeStyle, jenisBarangAccentColor, buildKartuGantungHistory } from "./src/lib/sap.js";
import { ROLES, CAN_CREATE, hasRole, getUserUptScope } from "./src/lib/roles.js";
import { DEFAULT_HEAVY_EQUIPMENT, normalizeHeavyEquipmentJenis, heavyEquipmentStatusFromKondisi, normalizeHeavyEquipmentRecord, getHeavyEquipmentLoanOwnerUpt, getHeavyEquipmentLoanRequesterUpt, getHeavyEquipmentLoanStartDate, getHeavyEquipmentLoanReturnDate, getHeavyEquipmentLoanJobName, normalizeHeavyEquipmentLoanStatus, isPendingHeavyEquipmentLoan, getHeavyEquipmentLoanRuntimeStatus, canApproveHeavyEquipmentLoan, getEquipmentCategory } from "./src/lib/heavyEquipment.js";
import { ATTB_JENIS_ASET, ATTB_JENIS_ASET_LABEL, ATTB_STAGES, attbStageIndex, attbStageLabel, canApproveAttb, isPendingAttbApproval, ATTB_FIELDS_BY_JENIS, ATTB_ALASAN_PENGHAPUSBUKUAN, ATTB_WAKTU_USULAN_OPTIONS, ATTB_CORE_FIELDS, ATTB_STAGE2_FIELDS, ATTB_STAGE3_FIELDS, ATTB_STAGE4_FIELDS, ATTB_STAGE5_FIELDS, parseAttbCurrency, parseAttbMaterialFile2, parseAttbMaterialFile4 } from "./src/lib/attb.js";
import { npNorm, npTokens, npNums, NAMEPLATE_MIN, cohereEmbed, cohereEmbedImage, ocrSpaceOCR, matchNameplateToKatalog, nameplateTextSim, matchNameplateAll, buildTxnRagContent } from "./src/lib/rag.js";
import { computeForecast } from "./src/lib/forecast.js";
import { subGudangAbbr, subGudangKodeMap, getLokasiPetaInfo, extractLatLngFromAddress, loadMasterTable, syncMasterTable, seedMasterTableIfEmpty, syncMaterialCadangRows } from "./src/lib/masterSync.js";
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
import { StockCountTab } from "./src/components/StockCountTab.jsx";
import { RencanaKedatanganTab } from "./src/components/RencanaKedatanganTab.jsx";
import { KapasitasGudangTab } from "./src/components/KapasitasGudangTab.jsx";
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
import { getMaterialAkanHabis } from "./src/lib/analytics.js";
import QRCode from "qrcode";














const STATUS_MATERIAL_RETUR = ["Material Sisa Baru", "Bongkaran", "Bongkaran ATTB (MTU)"]; // used in TUG-10 returns
// Maps a return status to the resulting Jenis Barang in Data Stok (null = leave as user's manual choice)
const STATUS_RETUR_TO_JENIS = { "Bongkaran": "Bongkaran", "Bongkaran ATTB (MTU)": "ATTB" };
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




























































// ─── AI AGENT ────────────────────────────────────────────────────────
async function askAI(msg, stocks, txns, users, currentUser) {
  const pending = txns.filter(t=>t.status==="PENDING");
  const totalVal = stocks.reduce((a,s)=>a+s.qty*s.price,0);
  const lowStocks = getKritisAgg(stocks);
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
  const [showGudangMaintenance, setShowGudangMaintenance] = useState(false); // toggle 2 alat perbaikan (bukan pemakaian rutin) di Master Gudang
  const [rencanaKedatanganList, setRencanaKedatanganList] = useState([]);
  const [opnameList, setOpnameList] = useState([]);
  const [stockCountList, setStockCountList] = useState([]); // riwayat sesi Stock Count (banding SAP vs Aplikasi)
  const [approvalHistoryList, setApprovalHistoryList] = useState([]); // log keputusan approval (Lokasi/Blok, Pemindahan Stok, dkk) — TUG tetap diturunkan dari txns
  const [maturityAssessments, setMaturityAssessments] = useState([]); // riwayat asesmen Maturity Level Gudang UPT Surabaya, diisi manual oleh Admin
  const [heavyEquipmentList, setHeavyEquipmentList] = useState([]);
  const [heavyEquipmentLoans, setHeavyEquipmentLoans] = useState([]);
  const [attbList, setAttbList] = useState([]);
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
  const [gudangCapacityList, setGudangCapacityList] = useState([]);
  const [gudangCapacityImports, setGudangCapacityImports] = useState([]);
  const [migratedTug15History, setMigratedTug15History] = useState([]);
  // Antrian item BARU (belum ada di Master Katalog) hasil Migrasi Data SAP —
  // tidak langsung ditambahkan ke katalogList/stocks, menunggu Admin review
  // satu-per-satu (2026-07-04, permintaan user: item matched TIDAK boleh
  // ditimpa diam-diam, item baru WAJIB direview dulu).
  const [migrasiPendingReview, setMigrasiPendingReview] = useState([]);
  const [docSeq, setDocSeq] = useState(196);
  const [loading, setLoading] = useState(true);
  const [cloudSaving, setCloudSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState(null);

  const [tab, setTab] = useState("dashboard");
  const [dashTab, setDashTab] = useState("ringkasan"); // sub-tab Dashboard: ringkasan | peta | kinerja | detail
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
        <span style={{fontSize:11,color:C.muted,padding:"0 4px"}}>Halaman {page} / {totalPages}</span>
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
  const syncingPhotosRef = useRef(false); // cegah tumpang-tindih auto-sync foto transaksi pending
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
  const lastSyncErrorToastRef = useRef(0);

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
        loadMasterTable("warehouse_capacity"),
        loadMasterTable("warehouse_capacity_imports"),
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
      // Stock Opname & Stock Count — Supabase (stock_opname/stock_count) sekarang sumber
      // utama kalau sudah ada isinya; kalau masih kosong (instalasi lama yang baru upgrade,
      // atau baru pertama kali), dorong sekali data localStorage yang ada ke Supabase supaya
      // tidak hilang lagi. Ditemukan 2026-07-07: sebelumnya data ini TIDAK PERNAH tersinkron
      // ke Supabase sama sekali — widget akurasi Dashboard "hilang" kalau dibuka dari
      // device/browser lain karena datanya memang cuma ada di localStorage device asal.
      const opnLocal = copn || [];
      const scLocal = csc || [];
      if (copnRemote && copnRemote.length > 0) {
        setOpnameList(copnRemote);
      } else {
        setOpnameList(opnLocal);
        if (opnLocal.length > 0) syncMasterTable("stock_opname", opnLocal, o => ({ status: o.status || null }));
      }
      if (cscRemote && cscRemote.length > 0) {
        setStockCountList(cscRemote);
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
      if (cheRemote && cheRemote.length > 0) {
        setHeavyEquipmentList(cheRemote.map(normalizeHeavyEquipmentRecord));
      } else {
        setHeavyEquipmentList(heLocal);
        if (heLocal.length > 0) syncMasterTable("heavy_equipment", heLocal, e => ({ upt: e.upt || null }));
      }
      if (chelRemote && chelRemote.length > 0) {
        setHeavyEquipmentLoans(chelRemote);
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
      if (cattbRemote && cattbRemote.length > 0) {
        setAttbList(cattbRemote);
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
      if (cgcapRemote && cgcapRemote.length > 0) {
        setGudangCapacityList(cgcapRemote);
      } else {
        setGudangCapacityList(gcapLocal);
        if (gcapLocal.length > 0) syncMasterTable("warehouse_capacity", gcapLocal);
      }
      if (cgcapiRemote && cgcapiRemote.length > 0) {
        setGudangCapacityImports(cgcapiRemote);
      } else {
        setGudangCapacityImports(gcapiLocal);
        if (gcapiLocal.length > 0) syncMasterTable("warehouse_capacity_imports", gcapiLocal);
      }
      setMigratedTug15History(cmig || []);
      setMigrasiPendingReview(cmpr || []);
      setLoading(false);
    }
    loadCloud();
  }, []);

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
    const syncPromises = [];
    if (overrides.katalogList !== undefined) syncPromises.push(syncMasterTable("katalog", kat));
    if (overrides.stocks !== undefined) syncPromises.push(syncMasterTable("stocks", s, item => ({ katalog_id: item.katalogId || null, lokasi_id: item.lokasiId || null })));
    // Kapasitas Gudang — sebelumnya localStorage/CLOUD-only, sekarang auto-backup
    // ke Supabase tiap kali berubah (lihat schema.sql section 10-11).
    if (overrides.gudangCapacityList !== undefined) syncPromises.push(syncMasterTable("warehouse_capacity", gcap));
    if (overrides.gudangCapacityImports !== undefined) syncPromises.push(syncMasterTable("warehouse_capacity_imports", gcapi));
    // Alat Berat/Peminjaman UPT — sebelumnya localStorage/CLOUD-only (ditemukan saat
    // audit 2026-07-06), sekarang auto-backup ke Supabase tiap kali berubah (lihat
    // schema.sql section 21).
    if (overrides.heavyEquipmentList !== undefined) syncPromises.push(syncMasterTable("heavy_equipment", he, e => ({ upt: e.upt || null })));
    if (overrides.heavyEquipmentLoans !== undefined) syncPromises.push(syncMasterTable("heavy_equipment_loans", hel, l => ({
      equipment_id: l.equipmentId || null,
      status: l.status || null,
      owner_upt: getHeavyEquipmentLoanOwnerUpt(l) || null,
      requester_upt: getHeavyEquipmentLoanRequesterUpt(l) || null,
    })));
    // ATTB (pipeline penghapusan aset material) — auto-backup ke Supabase tiap kali
    // berubah, pola sama seperti heavy_equipment (lihat schema.sql section 23).
    if (overrides.attbList !== undefined) syncPromises.push(syncMasterTable("attb_list", attb, e => ({ upt: e.upt || null, stage: e.stage || null })));
    // Stock Opname & Stock Count — sebelumnya localStorage/CLOUD-only, ditemukan 2026-07-07
    // (widget akurasi Dashboard "hilang" kalau dibuka dari device/browser lain karena datanya
    // memang tidak pernah keluar dari localStorage device asal). Sekarang auto-backup ke
    // Supabase tiap kali berubah, pola sama seperti heavy_equipment (schema.sql section 22).
    if (overrides.opnameList !== undefined) syncPromises.push(syncMasterTable("stock_opname", opn, o => ({ status: o.status || null })));
    if (overrides.stockCountList !== undefined) syncPromises.push(syncMasterTable("stock_count", sc));
    await Promise.all(syncPromises);

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
    if (tab !== "dashboard" || dashTab !== "peta" || !petaWilayahDivRef.current || typeof window.L === "undefined") return;
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

  async function reloadUsers() {
    if (!supabase) return;
    const { data: allProfiles } = await supabase.from("profiles").select("*");
    setUsers((allProfiles||[]).map(p => ({ id: p.id, name: p.name, username: p.username, role: p.role, jabatan: p.jabatan, avatar: p.avatar, uptId: p.upt_id, ultgId: p.ultg_id, uitId: p.uit_id })));
  }

  // Kelola Akun (ADMIN only) — daftarkan user baru lewat Edge Function
  // admin-create-user (service_role di server, supaya sesi Admin yang lagi
  // login tidak ketimpa jadi sesi user baru seperti kalau pakai signUp() biasa
  // langsung dari browser).
  function openAddAkun() {
    setAkunForm({username:"", password:"", name:"", role:"VIEWER", jabatan:"", uptId:"", ultgId:"", uitId:"", pengadaanScope:"UPT"});
    setAkunResult(null);
    setAkunModal("add");
  }
  function openEditAkun(u) {
    setAkunForm({id:u.id, username:u.username, password:"", name:u.name||"", role:u.role||"VIEWER", jabatan:u.jabatan||"", uptId:u.uptId||"", ultgId:u.ultgId||"", uitId:u.uitId||"", pengadaanScope:u.uitId?"UIT":"UPT"});
    setAkunResult(null);
    setAkunModal("edit");
  }
  // Role level-UIT (ADMIN_UIT/MGR_LOGISTIK_UIT) dan PENGADAAN mode UIT pakai
  // uitId, bukan uptId — field-nya saling eksklusif di form (lihat render modal).
  function isUitScopedRole(f) {
    return ["ADMIN_UIT","MGR_LOGISTIK_UIT"].includes(f.role) || (f.role==="PENGADAAN" && f.pengadaanScope==="UIT");
  }
  async function submitAkunEdit() {
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
    }});
    setAkunBusy(false);
    if (error || !data?.ok) { showToast(data?.error || error?.message || "Gagal menyimpan perubahan akun.","error"); return; }
    setAkunModal(null);
    await reloadUsers();
    showToast("✅ Akun berhasil diperbarui!");
  }
  async function submitAkunBaru() {
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
    }});
    setAkunBusy(false);
    if (error || !data?.ok) { showToast(data?.error || error?.message || "Gagal mendaftarkan akun.","error"); return; }
    setAkunResult({username: f.username.trim().toLowerCase(), password: f.password});
    await reloadUsers();
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
    showToast("✅ Password berhasil diubah!");
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
          setCurrentUser({ id: profile.id, name: profile.name, username: profile.username, role: profile.role, jabatan: profile.jabatan, avatar: profile.avatar, uptId: profile.upt_id, ultgId: profile.ultg_id, uitId: profile.uit_id });
          // Daftar SEMUA user (hanya dipakai layar Admin/Master Data) TIDAK memblokir
          // layar "Memuat sesi..." — dimuat di latar belakang supaya app langsung tampil.
          supabase.from("profiles").select("*").then(({ data: allProfiles }) => {
            setUsers((allProfiles||[]).map(p => ({ id: p.id, name: p.name, username: p.username, role: p.role, jabatan: p.jabatan, avatar: p.avatar, uptId: p.upt_id, ultgId: p.ultg_id })));
          });
        }
      } else {
        setCurrentUser(null); setUsers([]);
      }
      setAuthLoading(false);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

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
    await saveToCloud({katalogList: nk});
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
        setKatalogList(nk); await saveToCloud({katalogList: nk}); showToast("Katalog dihapus.");
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
    await saveToCloud({stocks: ns});
    showToast(wentToApproval ? "📨 Perubahan qty/harga/jenis diajukan! Menunggu approval TL." : (stockModal==="edit" ? "Data Stok diupdate!" : "Data Stok baru ditambahkan!"));
  }
  // Upload langsung foto Nameplate/Keseluruhan dari modal detail (klik baris Data Stok) — khusus Admin/TL
  async function updateStockFoto(id, field, img) {
    let ns = stocks.map(s=>s.id===id?{...s,[field]:img}:s);
    setStocks(ns);
    await saveToCloud({stocks: ns});
    showToast(`📷 ${field==="fotoNameplate"?"Foto Nameplate":"Foto Keseluruhan"} diperbarui!`);
    // Nameplate: OCR teksnya sekali & cache di fotoNameplateOcr, supaya foto ini
    // ikut jadi pembanding di pencarian foto mode Nameplate tanpa OCR ulang tiap cari.
    if (field==="fotoNameplate" && img && import.meta.env.VITE_OCRSPACE_API_KEY) {
      try {
        const text = await ocrSpaceOCR(img);
        ns = ns.map(s=>s.id===id?{...s,fotoNameplateOcr:text}:s);
        setStocks(ns);
        await saveToCloud({stocks: ns});
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
      await saveToCloud({ stocks: ns });
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
    setStocks(ns); await saveToCloud({stocks: ns}); showToast("Data Stok dihapus.");
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
    const s = satpamList.find(x=>x.id===id);
    askConfirmDelete({
      title: "Hapus Data Satpam?",
      message: <>Apakah Anda yakin ingin menghapus data Satpam <b>{s?.name||"-"}</b>?</>,
      warning: "Tindakan ini tidak bisa dibatalkan.",
      onConfirm: async () => {
        const nsp = satpamList.filter(x=>x.id!==id);
        setSatpamList(nsp); await syncMasterTable("satpam", nsp); showToast("Satpam dihapus.");
      }
    });
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
    const u = uitList.find(x=>x.id===id);
    const uptCount = uptList.filter(p=>p.uitId===id).length;
    askConfirmDelete({
      title: "Hapus UIT?",
      message: <>Apakah Anda yakin ingin menghapus UIT <b>{u?.nama||"-"}</b>?</>,
      warning: uptCount>0 ? `Tindakan ini tidak bisa dibatalkan dan ada ${uptCount} UPT yang masih terhubung ke UIT ini.` : "Tindakan ini tidak bisa dibatalkan.",
      onConfirm: async () => {
        const nu = uitList.filter(x=>x.id!==id);
        setUitList(nu); await syncMasterTable("uit", nu); showToast("UIT dihapus.");
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
        setUltgList(nu); await syncUltg(nu); showToast("ULTG dihapus.");
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
        setUptList(nu); await syncUpt(nu); showToast("UPT dihapus.");
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
    await syncSubGudang(newSubGudangList);
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
    await syncSubGudang(newSubGudangList);
    await syncLokasi(newLokasiList);
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
    await syncSubGudang(newSubGudangList);
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
    const g = gudangList.find(x=>x.id===id);
    const blokCount = lokasiList.filter(l=>l.gudangId===id).length;
    askConfirmDelete({
      title: "Hapus Gudang?",
      message: <>Apakah Anda yakin ingin menghapus Gudang <b>{g?.nama||"-"}</b>?</>,
      warning: `Tindakan ini tidak bisa dibatalkan dan ada ${blokCount} Blok Lokasi terkait yang akan kehilangan koordinat denah.`,
      onConfirm: async () => {
        const ng = gudangList.filter(x=>x.id!==id);
        setGudangList(ng); await syncGudang(ng); showToast("Gudang dihapus.");
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
    await saveToCloud({ katalogList: nk, stocks: ns });
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
      const resp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${import.meta.env.VITE_GROQ_API_KEY}` },
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
    }
    showToast(`✅ Import ATTB selesai: ${newItems.length} item ditambahkan${removedCount>0?`, ${removedCount} data lama (Waktu ${waktu}) ditimpa`:""}${skipped>0?`, ${skipped} dilewati (sudah ada di batch lain)`:""}.`);
    return { created: newItems.length, skipped, removed: removedCount };
  }
  async function deleteAttbItem(id) {
    if (!hasRole(currentUser, "ADMIN")) { showToast("Hanya Admin yang bisa menghapus item ATTB.","error"); return; }
    const next = attbList.filter(a=>a.id!==id);
    setAttbList(next);
    await saveToCloud({attbList: next});
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
    const canCreateULTG = hasRole(currentUser, "ADMIN_ULTG") && txnForm?.docType==="TUG5";
    if (!hasRole(currentUser, ...CAN_CREATE) && !canCreateULTG && !editingDraftTxnId) { showToast("Role kamu tidak dapat mengajukan transaksi!","error"); return; }
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
    if (savingTxnRef.current) return;       // cegah double-submit saat upload foto berjalan
    savingTxnRef.current = true;
    try {
    // Upload foto base64 ke Storage dulu → blob transaksi jadi ringan. Gagal upload
    // (offline) → foto tetap base64 + _fotoPending; transaksi & dokumen tetap jadi,
    // auto-sync menyusul saat online (syncPendingTxnPhotos).
    const txnId = `${docType}-${uid().slice(-6)}`;
    const _hasFoto = formData && ([formData.fotoKendaraan,formData.fotoSimKtp,formData.fotoSuratPengembalian,formData.fotoBAPengembalian,formData.fotoSuratJalanImg,formData.fotoKontrak].some(_isDataUrl) || (formData.fotoMaterial||[]).some(fm=>_isDataUrl(fm?.img)) || (formData.stockItems||[]).some(si=>_isDataUrl(si.fotoNameplate)||_isDataUrl(si.fotoBarangRetur)));
    if (_hasFoto) showToast("⏳ Mengunggah foto & menyimpan transaksi...", "info");
    const { data: _fd, pending: _pend } = await processTxnPhotos(formData, txnId);
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
      await saveToCloud({txns: newTxnsU, docSeq: newSeqU});
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
      await saveToCloud({txns: newTxns5, docSeq: newSeq5});
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
      await saveToCloud({txns: newTxns3, docSeq: newSeq3});
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
    await saveToCloud({txns: newTxns, docSeq: newSeq});
    showToast(`Transaksi ${nt.docNumbers[docKey]} dibuat! Menunggu approval ${ROLES[requiredApprover]}. ⏳`);
    } finally { savingTxnRef.current = false; }
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
            const newId = `STK-${String(nextStkNum++).padStart(3,"0")}-${uid().slice(-6)}`;
            newStocks.push({ id:newId, katalogId:si.katalogId, lokasiId:txn.lokasiTujuanId, qty:si.qty, minQty:0, price:0, jenisBarang:jenisBarangFinal, img:si.fotoBarangRetur||null, createdAt:Date.now() });
          }
        } else {
          // Brand-new item: register into Master Katalog first
          const newKatId = `KAT-${String(nextKatNum++).padStart(3,"0")}-${uid().slice(-6)}`;
          newKatalog.push({ id:newKatId, katalog:si.katalogBaru||"", name:si.namaBaru, category:si.categoryBaru||"Lainnya", satuan:si.satuanBaru||"unit", createdAt:Date.now() });
          const newStkId = `STK-${String(nextStkNum++).padStart(3,"0")}-${uid().slice(-6)}`;
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
    if (currentUser.role !== "SUPERADMIN" && txn.requiredApprover !== currentUser.role) {
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
    if (!hasRole(currentUser, "TL")) { showToast("Hanya TL Logistik yang bisa menyetujui TUG-3 Karantina.","error"); return; }
    if (txn.stage !== "PENDING_TL") { showToast("Transaksi ini tidak dalam tahap menunggu TL.","error"); return; }
    const newTxns = txns.map(t => t.id===txn.id ? { ...t, stage:"MENUNGGU_TUG4", approvedByTL:currentUser.id, approvedAtTL:Date.now(), requiredApprover:"MANAGER" } : t);
    setTxns(newTxns);
    await saveToCloud({txns: newTxns});
    showToast(`✅ ${txn.docNumbers.tug3} disetujui TL Logistik! Lanjut ke tahap TUG-4 (Pemeriksaan Mutu).`);
  }
  async function rejectTUG3_TL(txn, reason) {
    if (!hasRole(currentUser, "TL")) { showToast("Hanya TL Logistik yang bisa menolak TUG-3 Karantina.","error"); return; }
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
    if (!hasRole(currentUser, "MANAGER")) { showToast("Hanya Manager yang bisa menyetujui TUG-4.","error"); return; }
    if (txn.stage !== "PENDING_MANAGER") { showToast("Transaksi ini tidak dalam tahap menunggu Manager.","error"); return; }
    const newTxns = txns.map(t => t.id===txn.id ? { ...t, stage:"MENUNGGU_FINAL", approvedByManager:currentUser.id, approvedAtManager:Date.now(), requiredApprover:"ASMAN" } : t);
    setTxns(newTxns);
    await saveToCloud({txns: newTxns});
    showToast(`✅ ${txn.docNumbers.tug4} disetujui Manager! Lanjut ke tahap finalisasi TUG-3.`);
  }
  async function rejectTUG4_Manager(txn, reason) {
    if (!hasRole(currentUser, "MANAGER")) { showToast("Hanya Manager yang bisa menolak TUG-4.","error"); return; }
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
    if (!hasRole(currentUser, "ASMAN")) { showToast("Hanya Asman Konstruksi yang bisa menyetujui TUG-3 Final.","error"); return; }
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
          const newId = `STK-${String(nextStkNum++).padStart(3,"0")}-${uid().slice(-6)}`;
          newStocks.push({ id:newId, katalogId:si.katalogId, lokasiId, qty:si.qty, minQty:0, price:si.harga||0, jenisBarang:"Persediaan", img:null, createdAt:Date.now() });
        }
      } else {
        const newKatId = `KAT-${String(nextKatNum++).padStart(3,"0")}-${uid().slice(-6)}`;
        newKatalog.push({ id:newKatId, katalog:si.katalogBaru||"", name:si.namaBaru, category:si.categoryBaru||"Lainnya", satuan:si.satuanBaru||"unit", createdAt:Date.now() });
        const newStkId = `STK-${String(nextStkNum++).padStart(3,"0")}-${uid().slice(-6)}`;
        newStocks.push({ id:newStkId, katalogId:newKatId, lokasiId, qty:si.qty, minQty:0, price:si.harga||0, jenisBarang:"Persediaan", img:null, createdAt:Date.now() });
      }
    });

    const newTxns = txns.map(t => t.id===txn.id ? { ...t, stage:"APPROVED", status:"APPROVED", approvedByAsman:currentUser.id, approvedAtAsman:Date.now() } : t);
    setTxns(newTxns); setStocks(newStocks); setKatalogList(newKatalog);
    await saveToCloud({txns: newTxns, stocks: newStocks, katalogList: newKatalog});
    showToast(`✅ ${txn.docNumbers.tug3} DISETUJUI FINAL! Stok bertambah ke gudang.`);
  }
  async function rejectTUG3Final_Asman(txn, reason) {
    if (!hasRole(currentUser, "ASMAN")) { showToast("Hanya Asman Konstruksi yang bisa menolak TUG-3 Final.","error"); return; }
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
    if (!hasRole(currentUser, "ASMAN")) { showToast("Hanya Asman Konstruksi yang bisa menyetujui TUG-5 tahap ini.","error"); return; }
    if (txn.stage !== "PENDING_ASMAN") { showToast("TUG-5 ini tidak dalam tahap menunggu Asman.","error"); return; }
    const newTxns = txns.map(t => t.id===txn.id ? {...t, stage:"PENDING_MANAGER", requiredApprover:"MANAGER", approvedByAsman:currentUser.id, approvedAtAsman:Date.now()} : t);
    setTxns(newTxns);
    await saveToCloud({txns: newTxns});
    showToast(`✅ ${txn.docNumbers.tug5} disetujui Asman! Menunggu approval Manager.`);
  }
  async function rejectTUG5_Asman(txn, reason) {
    if (!hasRole(currentUser, "ASMAN")) { showToast("Hanya Asman Konstruksi yang bisa menolak TUG-5.","error"); return; }
    if (!reason.trim()) { showToast("Masukkan alasan penolakan!","error"); return; }
    const newTxns = txns.map(t => t.id===txn.id ? {...t, status:"REJECTED", stage:"REJECTED", rejectedBy:currentUser.id, rejectedAt:Date.now(), rejectReason:reason} : t);
    setTxns(newTxns); await saveToCloud({txns: newTxns});
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
      showToast(`✅ ${txn.docNumbers.tug5} DISETUJUI! Draft TUG-5 UIT (Intercompany) dibuat — cetak & kirim manual ke UIT tujuan. 📄`);
    }
  }
  async function rejectTUG5_Manager(txn, reason) {
    if (!hasRole(currentUser, "MANAGER")) { showToast("Hanya Manager yang bisa menolak TUG-5.","error"); return; }
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
    if (!hasRole(currentUser, "MGR_ULTG")) { showToast("Hanya Manager ULTG yang bisa menyetujui TUG-5 ini.","error"); return; }
    if (currentUser.role !== "SUPERADMIN") {
      if (!currentUser.ultgId) { showToast("Akun kamu belum terhubung ke unit ULTG manapun. Hubungi Admin untuk melengkapi profil.","error"); return; }
      if (txn.ultgId !== currentUser.ultgId) { showToast("TUG-5 ini bukan dari unit ULTG kamu.","error"); return; }
    }
    if (txn.stage !== "PENDING_MGR_ULTG") { showToast("TUG-5 ini tidak dalam tahap menunggu Manager ULTG.","error"); return; }
    const newTxns = txns.map(t => t.id===txn.id ? {...t, stage:"APPROVED_ULTG", status:"APPROVED", approvedByMgrUltg:currentUser.id, approvedAtMgrUltg:Date.now()} : t);
    setTxns(newTxns);
    await saveToCloud({txns: newTxns});
    showToast(`✅ ${txn.docNumbers.tug5} disetujui! Menunggu di-adopt oleh Admin/TL UPT.`);
  }
  async function rejectTUG5_MgrULTG(txn, reason) {
    if (!hasRole(currentUser, "MGR_ULTG")) { showToast("Hanya Manager ULTG yang bisa menolak TUG-5 ini.","error"); return; }
    if (!reason.trim()) { showToast("Masukkan alasan penolakan!","error"); return; }
    const newTxns = txns.map(t => t.id===txn.id ? {...t, status:"REJECTED", stage:"REJECTED", rejectedBy:currentUser.id, rejectedAt:Date.now(), rejectReason:reason} : t);
    setTxns(newTxns); await saveToCloud({txns: newTxns});
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
    showToast(`✅ TUG-7 DISETUJUI! Draft TUG-8 otomatis muncul di UPT ${uptPengirim?.nama||"Pengirim"}. 📦`);
  }
  async function rejectTUG7_MgrLogistik(txn, reason) {
    if (!hasRole(currentUser, "MGR_LOGISTIK_UIT")) { showToast("Hanya Manager Logistik UIT yang bisa menolak TUG-7.","error"); return; }
    if (!reason.trim()) { showToast("Masukkan alasan penolakan!","error"); return; }
    const newTxns = txns.map(t => t.id===txn.id ? {...t, status:"REJECTED", stage:"REJECTED", rejectedBy:currentUser.id, rejectedAt:Date.now(), rejectReason:reason} : t);
    setTxns(newTxns); await saveToCloud({txns: newTxns});
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
    return ms && mj;
  });
  const stockTotalPages = Math.max(1, Math.ceil(filteredStocks.length / stockPageSize));
  const stockPageClamped = Math.min(stockPage, stockTotalPages);
  const pagedStocks = filteredStocks.slice((stockPageClamped-1)*stockPageSize, stockPageClamped*stockPageSize);
  const filteredKatalog = katalogList.filter(k => matchesKatalogSearch(k, katalogSearch) && (!katalogFilterBelumMara || k.belumDicocokkanMara));
  const katalogTotalPages = Math.max(1, Math.ceil(filteredKatalog.length / katalogPageSize));
  const katalogPageClamped = Math.min(katalogPage, katalogTotalPages);
  const pagedKatalog = filteredKatalog.slice((katalogPageClamped-1)*katalogPageSize, katalogPageClamped*katalogPageSize);
  const filteredTxns = txns.filter(t=> filterStatus==="ALL" || t.status===filterStatus).sort((a,b)=>b.createdAt-a.createdAt);

  // ── DESIGN TOKENS ──

  // Target sentuh & ukuran font input dibesarkan otomatis di HP (isMobile):
  // - tombol minimal ~44px tinggi (standar minimum tap target Apple/Google)
  //   supaya tidak gampang salah pencet pakai jari.
  // - font input >=16px di HP supaya Safari/Chrome iOS tidak auto-zoom saat
  //   field di-tap (auto-zoom terjadi kalau font input <16px).
  const sty = makeSty(isMobile);

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
          <div style={{width:76,height:76,background:"linear-gradient(135deg,#fbbf24,#f59e0b)",borderRadius:22,display:"flex",alignItems:"center",justifyContent:"center",fontSize:34,margin:"0 auto 14px",boxShadow:"0 10px 28px rgba(245,158,11,0.45)"}}>⚡</div>
          <div style={{fontSize:28,fontWeight:800,color:C.accent,letterSpacing:"1px",lineHeight:1}}>WARNOTO</div>
          <div style={{fontSize:10.5,color:C.muted,fontWeight:600,letterSpacing:1.5,textTransform:"uppercase",margin:"8px 0 3px"}}>{COMPANY}</div>
          <div style={{fontSize:12.5,color:C.muted}}>{UPT} · {WAREHOUSE}</div>
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
      <div style={{textAlign:"center"}}><div style={{fontSize:40,marginBottom:12}}>⚡</div><div style={{fontSize:16,fontWeight:700,color:C.accent}}>Memuat data dari cloud...</div></div>
    </div>
  );

  // ══════════════════════ MAIN APP ══════════════════════
  // Role PENGADAAN hanya punya akses Dashboard + Rencana Kedatangan
  const isPengadaan = hasRole(currentUser, "PENGADAAN");
  // Role ULTG (Admin/Manager ULTG): sidebar terbatas — semua view-only kecuali TUG-5 & Approval TUG-5
  const isUltgRole = hasRole(currentUser, ...ULTG_ROLES);
  const navItems = isPengadaan ? [
    {id:"dashboard",icon:"📊",label:"Dashboard"},
    {id:"rencana",icon:"📅",label:"Rencana Kedatangan"},
  ] : isUltgRole ? [
    {id:"dashboard",icon:"📊",label:"Dashboard"},
    {id:"stock",icon:"📦",label:"Data Stok"},
    {id:"transaction",icon:"🔄",label:"TUG"},
    {id:"approval",icon:"✅",label:"Approval",badge: hasRole(currentUser, "MGR_ULTG") ? myPendingApprovals.length : 0},
    {id:"heavyEquipment",icon:"🚜",label:"Alat Berat"},
    {id:"rencana",icon:"📅",label:"Rencana Kedatangan"},
    {id:"forecastStok",icon:"📈",label:"Forecast Stok"},
    {id:"ai",icon:"🤖",label:"AI Agent"},
  ] : [
    {id:"dashboard",icon:"📊",label:"Dashboard"},
    {id:"stock",icon:"📦",label:"Data Stok"},
    {id:"master",icon:"🗂️",label:"Master Data"},
    {id:"transaction",icon:"🔄",label:"TUG"},
    ...(hasRole(currentUser, "TL","ASMAN","MANAGER","ADMIN_UIT","MGR_LOGISTIK_UIT","ADMIN") ? [{id:"approval",icon:"✅",label:"Approval",badge:myPendingApprovals.length + (hasRole(currentUser, "ASMAN")?heavyEquipmentPendingCount:0) + (hasRole(currentUser, "TL","ASMAN") ? gudangCapacityImports.filter(i=>i.status==="PENDING_ASMAN").length : 0) + (hasRole(currentUser, "TL") ? lokasiList.filter(l=>l.status==="PENDING").length : 0) + (hasRole(currentUser, "ADMIN","TL") ? ultgPengajuanUntukAdopt.length : 0) + (hasRole(currentUser, "TL") ? stocks.filter(s=>(s.lokasiMovePending&&s.lokasiMoveApprover==="TL")||s.editPending||s.deletePending).length : 0) + (hasRole(currentUser, "ASMAN") ? stocks.filter(s=>s.lokasiMovePending&&s.lokasiMoveApprover==="ASMAN").length : 0) + (hasRole(currentUser, "ASMAN") ? opnameList.filter(o=>o.status==="PENDING_ASMAN").length : 0) + (hasRole(currentUser, "MANAGER") ? opnameList.filter(o=>o.status==="PENDING_MANAGER").length : 0) + (hasRole(currentUser, "ASMAN") ? stockCountPendingCount : 0)}] : []),
    {id:"heavyEquipment",icon:"🚜",label:"Alat Berat",badge:(hasRole(currentUser, "ASMAN")?heavyEquipmentPendingCount:0)+heavyEquipmentOverdueCount},
    {id:"attb",icon:"🗂️",label:"ATTB",badge:attbPendingCount+attbBelumLanjutCount},
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
        <div style={{padding:"14px 16px",borderBottom:"1px solid rgba(255,255,255,0.12)"}}>
          <div style={{display:"flex",alignItems:"center",gap:11}}>
            <div style={{width:36,height:36,background:"linear-gradient(135deg,#fbbf24,#f59e0b)",borderRadius:9,display:"flex",alignItems:"center",justifyContent:"center",fontSize:19,flexShrink:0,boxShadow:"0 2px 8px rgba(245,158,11,0.35)"}}>⚡</div>
            <div style={{minWidth:0,lineHeight:1.15}}>
              <div style={{color:"white",fontWeight:800,fontSize:17,letterSpacing:".5px"}}>WARNOTO</div>
              <div style={{color:"rgba(255,255,255,0.6)",fontSize:10,letterSpacing:".5px",textTransform:"uppercase",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{UPT}</div>
            </div>
          </div>
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
                        {id:"permintaan",icon:"📋",label:"Minta Barang",defaultSub:"TUG5"},
                      ] : [
                        {id:"penerimaan",icon:"📥",label:"Barang Masuk",defaultSub:"TUG3"},
                        {id:"pengeluaran",icon:"📤",label:"Barang Keluar",defaultSub:"TUG9"},
                        {id:"permintaan",icon:"📋",label:"Minta Barang",defaultSub:"TUG5"},
                        {id:"laporan",icon:"📊",label:"Laporan",defaultSub:"TUG15"},
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
        ...(hasRole(currentUser, "ADMIN") ? [{id:"akun",icon:"👤",label:"Kelola Akun"},{id:"migrasi",icon:"🔄",label:"Migrasi Data"}] : []),
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

        <div style={{padding:"12px 16px",borderTop:"1px solid rgba(255,255,255,0.1)",display:"flex",alignItems:"center",gap:10}}>
          <div style={{width:36,height:36,background:"rgba(255,255,255,0.2)",borderRadius:"50%",display:"flex",alignItems:"center",justifyContent:"center",fontWeight:700,color:"white",fontSize:13,flexShrink:0}}>{currentUser.avatar}</div>
          <div style={{flex:1,minWidth:0}}>
            <div style={{color:"white",fontWeight:600,fontSize:12,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{currentUser.name}</div>
            <div style={{color:"rgba(255,255,255,0.5)",fontSize:10}}>{ROLES[currentUser.role]}</div>
          </div>
          <button style={{background:"transparent",border:"none",color:"rgba(255,255,255,0.4)",cursor:"pointer",fontSize:14}} onClick={openGantiPassword} title="Ganti Password">🔑</button>
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
        {tab==="dashboard" && hasRole(currentUser, "MANAGER") && (
          <>
          <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:18}}>
            {[{id:"ringkasan",label:"📊 Ringkasan"},{id:"detail",label:"📦 Detail & Analitik"}].map(t=>(
              <button key={t.id} onClick={()=>setDashTab(t.id)} style={{padding:isMobile?"9px 14px":"8px 16px",minHeight:isMobile?44:undefined,borderRadius:9,border:`1px solid ${dashTab===t.id?C.accent:C.border}`,background:dashTab===t.id?C.accent:C.surface,color:dashTab===t.id?"white":C.muted,fontWeight:700,fontSize:isMobile?13:12.5,cursor:"pointer",boxShadow:dashTab===t.id?"0 2px 8px rgba(29,78,216,0.25)":"none"}}>{t.label}</button>
            ))}
          </div>
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
          />
          )}
          </>
        )}
        {tab==="dashboard" && hasRole(currentUser, "ASMAN") && !hasRole(currentUser, "MANAGER") && (
          <>
          <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:18}}>
            {[{id:"ringkasan",label:"📊 Ringkasan"},{id:"detail",label:"📦 Detail & Analitik"}].map(t=>(
              <button key={t.id} onClick={()=>setDashTab(t.id)} style={{padding:isMobile?"9px 14px":"8px 16px",minHeight:isMobile?44:undefined,borderRadius:9,border:`1px solid ${dashTab===t.id?C.accent:C.border}`,background:dashTab===t.id?C.accent:C.surface,color:dashTab===t.id?"white":C.muted,fontWeight:700,fontSize:isMobile?13:12.5,cursor:"pointer",boxShadow:dashTab===t.id?"0 2px 8px rgba(29,78,216,0.25)":"none"}}>{t.label}</button>
            ))}
          </div>
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
          />
          )}
          </>
        )}
        {tab==="dashboard" && !hasRole(currentUser, "MANAGER","ASMAN") && (
          <>
          {/* ── TAB BAR DASHBOARD (satu section per klik, tidak menumpuk) ── */}
          <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:18}}>
            {[{id:"ringkasan",label:"📊 Ringkasan"},{id:"peta",label:"🗺️ Peta"},{id:"kinerja",label:"🎯 Kinerja"},{id:"detail",label:"📦 Detail Stok"}].map(t=>(
              <button key={t.id} onClick={()=>setDashTab(t.id)} style={{padding:isMobile?"9px 14px":"8px 16px",minHeight:isMobile?44:undefined,borderRadius:9,border:`1px solid ${dashTab===t.id?C.accent:C.border}`,background:dashTab===t.id?C.accent:C.surface,color:dashTab===t.id?"white":C.muted,fontWeight:700,fontSize:isMobile?13:12.5,cursor:"pointer",boxShadow:dashTab===t.id?"0 2px 8px rgba(29,78,216,0.25)":"none"}}>{t.label}</button>
            ))}
          </div>

          {dashTab==="ringkasan" && (
            <ExecOverview totalVal={totalVal} kritisMaterials={lowStocks} forecastSoon={forecastSoon} approvalCount={myPendingApprovals.length} stockCountPendingCount={stockCountPendingCount} attbActionCount={attbPendingCount+attbBelumLanjutCount} akurasi={stockCountList[0]?.summary?.akuratPct ?? null} maturity={maturityAssessments[0]||null} setTab={setTab} setOpnameSubTab={setOpnameSubTab} C={C} sty={sty} isMobile={isMobile}/>
          )}

          {dashTab==="peta" && (<>
          {/* ── PETA WILAYAH GUDANG UPT SURABAYA ── */}
          <div style={{...sty.card}}>
            <div style={{fontWeight:800,fontSize:15,marginBottom:4}}>🗺️ Peta Wilayah Gudang UPT Surabaya</div>
            <div style={{fontSize:12,color:C.muted,marginBottom:12}}>
              {gudangList.filter(g=>g.lat!=null&&g.lng!=null).length} dari {gudangList.length} gudang sudah punya koordinat GPS. Klik pin untuk lihat ringkasan.
            </div>
            <div ref={petaWilayahDivRef} style={{width:"100%",height:320,borderRadius:10,border:`1px solid ${C.border}`,background:"#eef2f7"}}/>
            {gudangList.filter(g=>g.lat==null||g.lng==null).length>0 && hasRole(currentUser, "ADMIN") && (
              <div style={{fontSize:11,color:"#92400e",marginTop:8}}>⚠️ Ada gudang belum punya koordinat GPS — isi di Master Data → Master Gudang → Edit.</div>
            )}
          </div>
          </>)}

          {dashTab==="kinerja" && (<>
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
                  {hasRole(currentUser, "ADMIN") && <button style={sty.btn("primary","sm")} onClick={()=>{setMaturityForm({level:latest?.level||3,catatan:"",tanggalAsesmen:Date.now()}); setMaturityModal(true);}}>+ Asesmen Baru</button>}
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
          </>)}

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
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:10,marginBottom:16}}>
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
              {photoSearchResults && (
                <div style={{...sty.card,padding:12}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                    <div style={{fontWeight:800,fontSize:13}}>{photoSearchResultMode==="nameplate"?"🔖":"📷"} Hasil pencarian foto — {photoSearchResults.length} barang {photoSearchResultMode==="nameplate"?"cocok":"mirip"}</div>
                    <button style={sty.btn("ghost","sm")} onClick={()=>setPhotoSearchResults(null)}>✕ Reset</button>
                  </div>
                  {photoSearchResultMode==="nameplate" && photoSearchOcrText && (
                    <div style={{fontSize:10,color:C.muted,background:"#f8fafc",border:`1px solid ${C.border}`,borderRadius:6,padding:"6px 8px",marginBottom:10,whiteSpace:"pre-wrap",maxHeight:60,overflowY:"auto"}}>
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
                              <div style={{fontSize:10,color:"#0098da",fontWeight:700}}>📑 {r.katalog}</div>
                              <div style={{fontSize:11,fontWeight:800,color:pct>=80?C.green:pct>=70?"#d97706":C.muted,marginTop:2}}>{pct}% {photoSearchResultMode==="nameplate"?"cocok":"mirip"}</div>
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
            <div style={{...sty.card,padding:0,overflowX:"auto"}}>
              <table style={{width:"100%",borderCollapse:"collapse",fontSize:12,minWidth:980}}>
                <thead>
                  <tr style={{background:C.sidebar,color:"white"}}>
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
                          {hasRole(currentUser, "ADMIN","TL") ? (
                            <select
                              value={stockGudangFilter[st.id] ?? st.gudangId ?? gdg?.id ?? ""}
                              style={{...sty.select,fontSize:11,paddingTop:5,paddingBottom:5,paddingLeft:8,paddingRight:8}}
                              onChange={async e=>{
                                const v = e.target.value;
                                setStockGudangFilter(prev=>({...prev,[st.id]:v}));
                                // Simpan langsung (bukan cuma filter lokal) supaya tidak hilang kalau
                                // Gudang ini ternyata tidak punya Blok terdaftar sama sekali.
                                const ns = stocks.map(s=>s.id===st.id?{...s, gudangId: v||null}:s);
                                setStocks(ns);
                                await saveToCloud({stocks:ns});
                              }}>
                              <option value="">-- Pilih Gudang --</option>
                              {gudangList.map(g=><option key={g.id} value={g.id}>{g.kode||g.nama}</option>)}
                            </select>
                          ) : (
                            <span style={{color:C.text}}>{gdg?.kode||gdg?.nama||"—"}</span>
                          )}
                        </td>
                        <td onClick={e=>e.stopPropagation()} style={{padding:"8px 10px",minWidth:150}}>
                          {hasRole(currentUser, "ADMIN") ? (
                            <>
                              <select
                                value={st.lokasiId||""}
                                disabled={st.lokasiMovePending}
                                style={{...sty.select,fontSize:11,paddingTop:5,paddingBottom:5,paddingLeft:8,paddingRight:8,border:`1px solid ${noLokasi?"#f59e0b":C.border}`,background:st.lokasiMovePending?"#f3f4f6":noLokasi?"#fffbeb":"#f9fafb"}}
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
                                  await saveToCloud({stocks:ns});
                                  showToast(msg);
                                }}>
                                <option value="">-- Pilih Blok --</option>
                                {blokOptionsForStock.map(l=><option key={l.id} value={l.id}>{l.kode}{l.nama?" — "+l.nama:""}</option>)}
                              </select>
                              {effGudangIdForBlok && blokOptionsForStock.length===0 && <div style={{fontSize:9,color:"#b45309",fontStyle:"italic",marginTop:2}}>⚠️ Belum ada Blok terdaftar di Gudang ini — pilihan Gudang tetap tersimpan.</div>}
                              {st.lokasiMovePending && <div style={{fontSize:9,color:"#92400e",fontWeight:700,marginTop:2}}>⏳ Menunggu approval {st.lokasiMoveApprover||"TL"} → {st.pendingLokasiKode}</div>}
                            </>
                          ) : hasRole(currentUser, "TL") ? (
                            <>
                              <select
                                value={st.lokasiId||""}
                                disabled={st.lokasiMovePending}
                                style={{...sty.select,fontSize:11,paddingTop:5,paddingBottom:5,paddingLeft:8,paddingRight:8,border:`1px solid ${noLokasi?"#f59e0b":C.border}`,background:st.lokasiMovePending?"#f3f4f6":noLokasi?"#fffbeb":"#f9fafb"}}
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
                                  await saveToCloud({stocks:ns});
                                  showToast(msg);
                                }}>
                                <option value="">-- Pilih Blok --</option>
                                {blokOptionsForStock.map(l=><option key={l.id} value={l.id}>{l.kode}{l.nama?" — "+l.nama:""}</option>)}
                              </select>
                              {effGudangIdForBlok && blokOptionsForStock.length===0 && <div style={{fontSize:9,color:"#b45309",fontStyle:"italic",marginTop:2}}>⚠️ Belum ada Blok terdaftar di Gudang ini — pilihan Gudang tetap tersimpan.</div>}
                              {st.lokasiMovePending && <div style={{fontSize:9,color:"#92400e",fontWeight:700,marginTop:2}}>⏳ Menunggu approval {st.lokasiMoveApprover||"Asman"} → {st.pendingLokasiKode}</div>}
                            </>
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
                            {hasRole(currentUser, "ADMIN") && (
                              <>
                                <button title="Edit" disabled={st.deletePending} style={{...sty.btn("ghost","sm"),padding:"6px 8px",opacity:st.deletePending?0.4:1}} onClick={()=>openEditStock(st)}>✏️</button>
                                <button title="Hapus" disabled={st.deletePending} style={{...sty.btn("danger","sm"),padding:"6px 8px",opacity:st.deletePending?0.4:1}} onClick={()=>deleteStock(st.id)}>🗑️</button>
                              </>
                            )}
                            <button title="Kartu Gantung TUG-2" style={{...sty.btn("ghost","sm"),padding:"6px 8px",borderColor:"#e0f2fe",color:"#0369a1"}}
                              onClick={()=>{const k=katalogList.find(x=>x.id===st.katalogId); if(k) setKartuGantungDetail(k);}}>🏷️</button>
                            <button
                              title={canLihatPeta ? "Lihat di Peta Gudang" : !lok ? "Blok belum diisi" : !hasDenah ? "Denah belum diupload (Master Data → Master Gudang)" : "Blok ini belum diplot koordinatnya di denah"}
                              style={{...sty.btn("ghost","sm"),padding:"6px 8px",borderColor:canLihatPeta?"#fca5a5":C.border,color:canLihatPeta?"#dc2626":C.muted,opacity:canLihatPeta?1:0.5}}
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
          <div>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
              <div>
                <h1 style={{fontSize:22,fontWeight:900}}>
                  {stockSubTab==="katalog"?"Master Katalog Barang":stockSubTab==="satpam"?"Daftar Satpam":stockSubTab==="timmutu"?"Master Tim Mutu":stockSubTab==="organisasi"?"Struktur Organisasi (UIT / UPT / ULTG)":stockSubTab==="akun"?"👤 Kelola Akun (User)":stockSubTab==="migrasi"?"🔄 Migrasi Data SAP/Non-SAP":"Master Gudang"}
                </h1>
                <p style={{color:C.muted,fontSize:13}}>
                  {stockSubTab==="katalog"?`${filteredKatalog.length} jenis barang terdaftar`:stockSubTab==="satpam"?`${satpamList.length} satpam terdaftar`:stockSubTab==="timmutu"?`${timMutuList.length} paket tim mutu`:stockSubTab==="organisasi"?`${uitList.length} UIT • ${uptList.length} UPT • ${ultgList.length} ULTG`:stockSubTab==="akun"?`${users.length} akun terdaftar`:stockSubTab==="migrasi"?"Cutover terkontrol data stok dari SAP — wajib backup sebelum apply":stockSubTab==="usulanKatalog"?"Cari di referensi MARA, usulkan penambahan katalog baru, persetujuan Asman/TL":`${gudangList.length} gudang • ${lokasiList.length} blok lokasi terdaftar`}
                </p>
              </div>
              {hasRole(currentUser, "ADMIN") && stockSubTab==="katalog" && <button style={sty.btn("primary")} onClick={openAddKatalog}>+ Tambah Katalog Barang</button>}
              {hasRole(currentUser, "ADMIN") && stockSubTab==="satpam" && <button style={sty.btn("primary")} onClick={openAddSatpam}>+ Tambah Satpam</button>}
              {hasRole(currentUser, "ADMIN") && stockSubTab==="organisasi" && <button style={sty.btn("primary")} onClick={openAddUIT}>+ Tambah UIT</button>}
              {hasRole(currentUser, "ADMIN") && stockSubTab==="gudang" && <button style={sty.btn("primary")} onClick={openAddGudang}>+ Tambah Gudang Baru</button>}
              {hasRole(currentUser, "ADMIN") && stockSubTab==="akun" && <button style={sty.btn("primary")} onClick={openAddAkun}>+ Daftarkan Akun Baru</button>}
            </div>
            {stockSubTab==="gudang" && (
              <div style={{...sty.card,marginBottom:12,background:"#eff6ff",borderLeft:"4px solid #0369a1",padding:"10px 14px",fontSize:12,color:"#0369a1"}}>
                ℹ️ Sebagian besar Gudang biasanya <b>otomatis terbentuk sendiri</b> dari import Excel Kapasitas Gudang (tombol di bawah) setelah disetujui Asman. Kalau ada Gudang yang belum tercakup di laporan itu, tambahkan manual lewat tombol "+ Tambah Gudang Baru" di kanan atas.
              </div>
            )}
            {stockSubTab==="gudang" && hasRole(currentUser, "ADMIN","TL") && (
              <div style={{marginBottom:16}}>
                <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"center"}}>
                  <button style={sty.btn(importGudangOpen?"danger":"primary")} onClick={()=>setImportGudangOpen(o=>!o)}>
                    {importGudangOpen?"✕ Tutup Import Data Gudang":"📥 Import Data Gudang (Excel Kapasitas Gudang)"}
                  </button>
                  <button style={{...sty.btn("ghost","sm")}} onClick={()=>setShowGudangMaintenance(o=>!o)}>
                    {showGudangMaintenance?"✕ Tutup Alat Perbaikan":"🔧 Alat Perbaikan Data Lanjutan"}
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
                        <div style={{fontSize:11,color:C.muted,marginTop:4}}>Pakai kalau titik lokasi Gudang di peta hilang/salah, padahal data Kapasitas Gudang untuk gudang itu sudah live — menarik ulang koordinat lat/lng dari sana.</div>
                      </div>
                      <div>
                        <button style={sty.btn("ghost","sm")} onClick={() => dedupeGudangDanSubGudang()}>🧹 Gabungkan Gudang Duplikat</button>
                        <div style={{fontSize:11,color:C.muted,marginTop:4}}>Pakai kalau ada 2 Gudang/Sub Gudang dengan nama sama yang seharusnya satu (biasanya bikin denah/koordinat kelihatan "hilang" karena data nyasar ke ID yang berbeda).</div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
            {/* ── SUB-TAB: MASTER KATALOG ── */}
            {stockSubTab==="katalog" && hasRole(currentUser, "ADMIN") && (
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
                    style={{padding:"6px 12px",borderRadius:20,border:`1px solid ${katalogFilterBelumMara?"#f59e0b":C.border}`,background:katalogFilterBelumMara?"#fef3c7":"white",color:katalogFilterBelumMara?"#92400e":C.text,fontSize:11,fontWeight:700,cursor:"pointer",whiteSpace:"nowrap"}}>
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
              <div style={{...sty.card,padding:0,overflowX:"auto"}}>
                <table style={{width:"100%",borderCollapse:"collapse",fontSize:12,minWidth:860}}>
                  <thead>
                    <tr style={{background:C.sidebar,color:"white"}}>
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
                          <td style={{padding:"8px 10px"}}>
                            <span style={sty.jenisBadge(k.jenisBarang)}>{k.jenisBarang||"-"}</span>
                            {k.pendingOpnameId && <div style={{marginTop:3}}><span style={{padding:"1px 6px",borderRadius:10,fontSize:8,fontWeight:700,background:"#dbeafe",color:"#1e40af"}}>⏳ Pending Approval</span></div>}
                            {k.belumDicocokkanMara && <div style={{marginTop:3}}><span style={{padding:"1px 6px",borderRadius:10,fontSize:8,fontWeight:700,background:"#fef3c7",color:"#92400e"}}>⚠️ Belum MARA</span></div>}
                          </td>
                          <td style={{padding:"8px 10px",whiteSpace:"nowrap"}}>{k.satuan}</td>
                          <td style={{padding:"8px 10px"}}><span style={{padding:"2px 7px",borderRadius:20,fontSize:10,fontWeight:700,background:bs.bg,color:bs.fg,whiteSpace:"nowrap"}}>{getSAPLabel(k.katalog)}</span></td>
                          <td style={{padding:"8px 10px"}}>
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


            {/* ── SUB-TAB: SATPAM ── */}
            {stockSubTab==="satpam" && (
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(260px,1fr))",gap:14}}>
                {satpamList.length===0 && <div style={{...sty.card,gridColumn:"1/-1",textAlign:"center",color:C.muted,padding:30}}>Belum ada data Satpam. {hasRole(currentUser, "ADMIN") && "Klik \"+ Tambah Satpam\" untuk menambahkan."}</div>}
                {satpamList.map(sp=>(
                  <div key={sp.id} style={{...sty.card,borderTop:`3px solid ${C.accent}`}}>
                    <div style={{display:"flex",gap:10,alignItems:"center",marginBottom:10}}>
                      <div style={{width:44,height:44,borderRadius:"50%",background:"#eff6ff",display:"flex",alignItems:"center",justifyContent:"center",fontSize:20,border:`1px solid #bfdbfe`}}>🛡️</div>
                      <div>
                        <div style={{fontWeight:700,fontSize:14}}>{sp.name}</div>
                        <div style={{fontSize:11,color:C.muted}}>{sp.id}{sp.telp ? ` • ${sp.telp}` : ""}</div>
                      </div>
                    </div>
                    {hasRole(currentUser, "ADMIN") && (
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
              <div>
                {/* Ringkasan — sebelumnya cuma teks kecil di subtitle halaman, sekarang
                    KPI supaya langsung kelihatan skala struktur org tanpa harus scroll/
                    expand semua (keluhan user 2026-07-06: "kurang informatif"). */}
                <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))",gap:12,marginBottom:16}}>
                  {[
                    {label:"Total UIT",val:uitList.length,color:C.accent},
                    {label:"Total UPT",val:uptList.length,color:"#0369a1"},
                    {label:"Total ULTG",val:ultgList.length,color:"#0891b2"},
                  ].map(kpi=>(
                    <div key={kpi.label} style={{...sty.card,borderTop:`3px solid ${kpi.color}`,padding:14,textAlign:"center"}}>
                      <div style={{fontSize:11,color:C.muted,marginBottom:4}}>{kpi.label}</div>
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
                      <div key={uit.id} style={{...sty.card,padding:0,overflow:"hidden",borderLeft:"4px solid #003087"}}>
                        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",padding:14,cursor:"pointer",background:"#f8fafc"}} onClick={toggleUit}>
                          <div style={{display:"flex",gap:10,alignItems:"flex-start",minWidth:0}}>
                            <div style={{fontSize:22,flexShrink:0}}>🏢</div>
                            <div style={{minWidth:0}}>
                              <div style={{display:"flex",gap:6,alignItems:"center",flexWrap:"wrap"}}>
                                <span style={{fontSize:9,fontWeight:800,color:"white",background:C.sidebar,padding:"2px 6px",borderRadius:4,letterSpacing:0.5}}>UIT</span>
                                <span style={{fontWeight:800,fontSize:14}}>{uit.kode} — {uit.nama}</span>
                              </div>
                              <div style={{fontSize:11,color:C.muted,marginTop:3}}>📍 {uit.alamat||"Alamat belum diisi"}</div>
                              <div style={{fontSize:11,color:C.muted,marginTop:1}}>{uptOfUit.length} UPT • {totalUltgOfUit} ULTG</div>
                            </div>
                          </div>
                          <div style={{display:"flex",gap:6,alignItems:"center",flexShrink:0}} onClick={e=>e.stopPropagation()}>
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
                                      <div key={upt.id} style={{background:"white",border:`1px solid ${C.border}`,borderRadius:8,padding:10}}>
                                        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",flexWrap:"wrap",gap:8}}>
                                          <div style={{display:"flex",gap:8,alignItems:"flex-start",minWidth:0}}>
                                            <div style={{fontSize:16,flexShrink:0}}>📍</div>
                                            <div style={{minWidth:0}}>
                                              <div style={{display:"flex",gap:6,alignItems:"center",flexWrap:"wrap"}}>
                                                <span style={{fontSize:9,fontWeight:800,color:"#0369a1",background:"#e0f2fe",padding:"1px 6px",borderRadius:4}}>UPT</span>
                                                <span style={{fontWeight:700,fontSize:13}}>{upt.kode} — {upt.nama}</span>
                                              </div>
                                              <div style={{fontSize:11,color:C.muted,marginTop:2}}>{upt.alamat||"Alamat belum diisi"} • {ultgOfUpt.length} ULTG</div>
                                            </div>
                                          </div>
                                          {hasRole(currentUser, "ADMIN") && (
                                            <div style={{display:"flex",gap:4,flexShrink:0}}>
                                              <button style={{...sty.btn("ghost","sm"),padding:"3px 8px"}} onClick={()=>openAddULTG(upt.id)}>+ ULTG</button>
                                              <button title="Edit" style={{...sty.btn("ghost","sm"),padding:"3px 8px"}} onClick={()=>openEditUPT(upt)}>✏️</button>
                                              <button title="Hapus" style={{...sty.btn("danger","sm"),padding:"3px 8px"}} onClick={()=>deleteUPT(upt.id)}>🗑️</button>
                                            </div>
                                          )}
                                        </div>
                                        {ultgOfUpt.length>0 && (
                                          <div style={{display:"flex",flexWrap:"wrap",gap:6,marginTop:8,paddingLeft:24}}>
                                            {ultgOfUpt.map(ultg=>(
                                              <div key={ultg.id} style={{display:"flex",alignItems:"center",gap:6,background:"#f0fdf4",border:`1px solid #bbf7d0`,borderRadius:20,padding:"4px 10px",fontSize:11}}>
                                                <span>🏘️ <b>{ultg.kode}</b> {ultg.nama}</span>
                                                {hasRole(currentUser, "ADMIN") && (
                                                  <span style={{display:"flex",gap:2,marginLeft:2}}>
                                                    <button title="Edit" style={{...sty.btn("ghost","sm"),padding:"1px 4px",fontSize:10}} onClick={()=>openEditULTG(ultg)}>✏️</button>
                                                    <button title="Hapus" style={{...sty.btn("danger","sm"),padding:"1px 4px",fontSize:10}} onClick={()=>deleteULTG(ultg.id)}>🗑️</button>
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
              <div>
                {/* Notifikasi approval blok lokasi sudah dipindahkan ke menu "✅ Approval" — lihat di sana. */}
                {gudangList.length===0 && <div style={{...sty.card,textAlign:"center",color:C.muted,padding:30}}>Belum ada Master Gudang.</div>}
                {gudangList.map(g=>{
                  const upt = uptList.find(u=>u.id===g.uptId);
                  const bloklokasi = lokasiList.filter(l=>l.gudangId===g.id);
                  const blokWithCoord = bloklokasi.filter(l=>l.mapX!=null);
                  const isExpanded = expandedGudangId===g.id;
                  const subsOfGudang = subGudangList.filter(sg=>sg.gudangId===g.id);
                  return (
                    <div key={g.id} style={{...sty.card,marginBottom:10,borderTop:`3px solid #003087`}}>
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",cursor:"pointer"}} onClick={()=>setExpandedGudangId(isExpanded?null:g.id)}>
                        <div>
                          <div style={{fontWeight:800,fontSize:15}}>🏭 {g.nama}</div>
                          <div style={{fontSize:12,color:C.muted}}>{g.kode} • {upt?.nama||"-"} • {g.alamat||"-"}</div>
                          <div style={{fontSize:11,color:C.muted,marginTop:2}}>{bloklokasi.length} blok terkait, {blokWithCoord.length} sudah ter-peta{subsOfGudang.length>0?` • ${subsOfGudang.length} Sub Gudang`:""}</div>
                        </div>
                        <div style={{display:"flex",gap:6,alignItems:"center"}}>
                          {hasRole(currentUser, "ADMIN") && (
                            <div style={{display:"flex",gap:6}} onClick={e=>e.stopPropagation()}>
                              <button style={sty.btn("ghost","sm")} onClick={()=>openEditGudang(g)}>✏️ Edit</button>
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

                        {g.denahImageData && (
                          <div style={{marginBottom:12}}>
                            <div style={{fontSize:11,fontWeight:700,color:C.muted,marginBottom:6}}>Preview Denah (peta keseluruhan Gudang):</div>
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
                            <div style={{fontSize:11,color:"#0369a1",background:"#eff6ff",border:"1px solid #bfdbfe",borderRadius:8,padding:"8px 12px"}}>
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
                              {grp.sg && <div style={{fontSize:13,fontWeight:800,marginBottom:8,display:"flex",alignItems:"center",gap:8}}>🏢 Sub Gudang: {grp.nama}{subKodeMap[grp.sg.id] && <span title="Kode singkatan Sub Gudang (dipakai sebagai tag di depan kode blok)" style={{fontSize:10,fontWeight:800,color:"#1e3a8a",background:"#dbeafe",border:"1px solid #bfdbfe",padding:"1px 7px",borderRadius:6}}>{subKodeMap[grp.sg.id]}</span>}</div>}

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
                                <div style={{fontSize:11,color:"#92400e",background:"#fef3c7",border:"1px solid #fcd34d",borderRadius:8,padding:"8px 12px",marginBottom:10}}>
                                  ⚠️ {grp.blok.length} blok belum dikelompokkan ke Sub Gudang manapun. Klik ✏️ di baris blok untuk assign ke Sub Gudang yang benar, baru atur koordinatnya di sana.
                                </div>
                              )}

                              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                                <div style={{fontSize:12,color:C.muted}}>📍 Daftar Blok Lokasi ({grp.blok.length})</div>
                                {hasRole(currentUser, "ADMIN") && !isUnregistered && <span style={{fontSize:10,color:C.muted,fontStyle:"italic"}}>➕ Tambah blok lewat 🛠️ Kelola Denah & Koordinat di atas</span>}
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
                                            {grp.sg && subKodeMap[grp.sg.id] && <span title={`Sub Gudang: ${grp.sg.nama}`} style={{fontSize:9,fontWeight:800,color:"#1e3a8a",background:"#dbeafe",border:"1px solid #bfdbfe",padding:"1px 6px",borderRadius:6,flexShrink:0}}>{subKodeMap[grp.sg.id]}</span>}
                                            <span style={{fontWeight:700}}>{l.kode}</span>
                                            {l.nama && <span style={{color:C.muted,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{l.nama}</span>}
                                            {l.status==="PENDING" && <span style={{fontSize:9,fontWeight:700,color:"#92400e",background:"#fef3c7",padding:"1px 6px",borderRadius:10}}>MENUNGGU APPROVAL TL</span>}
                                            {!hasCoord && <span style={{fontSize:9,fontWeight:700,color:"#92400e",background:"#fef3c7",padding:"1px 6px",borderRadius:10}}>BELUM ADA KOORDINAT</span>}
                                          </div>
                                          <div style={{display:"flex",alignItems:"center",gap:8,flexShrink:0}}>
                                            <span style={{fontSize:11,color:n>0?C.accent:C.muted,fontWeight:700}}>{n} item</span>
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
                                        <div style={{fontSize:13,fontWeight:700,display:"flex",alignItems:"center",gap:8}}>{grp.sg?"🏢":"📦"} {grp.nama}{grp.sg && subKodeMap[grp.sg.id] && <span style={{fontSize:9,fontWeight:800,color:"#1e3a8a",background:"#dbeafe",border:"1px solid #bfdbfe",padding:"1px 6px",borderRadius:6}}>{subKodeMap[grp.sg.id]}</span>}</div>
                                        <div style={{display:"flex",alignItems:"center",gap:8}}>
                                          <span style={{fontSize:11,color:C.muted}}>{grp.blok.length} blok</span>
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

            {/* ── SUB-TAB: KELOLA AKUN (ADMIN only) ── */}
            {stockSubTab==="akun" && hasRole(currentUser, "ADMIN") && (
              <div style={sty.card}>
                {users.length===0 ? (
                  <div style={{textAlign:"center",color:C.muted,padding:30}}>Belum ada akun terdaftar.</div>
                ) : (
                  <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
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
              />
            )}
          </div>
        )}
        {tab==="transaction" && (
          <div>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
              <div>
                <h1 style={{fontSize:22,fontWeight:900,display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
                  {(TUG_UI[tugSubTab]||{}).title || tugSubTab}
                  <span style={{fontSize:11,fontWeight:700,color:C.muted,background:C.border,borderRadius:6,padding:"2px 8px"}}>{(TUG_UI[tugSubTab]||{}).code || tugSubTab}</span>
                </h1>
                <p style={{color:C.muted,fontSize:13}}>{(TUG_UI[tugSubTab]||{}).desc || ""}</p>
              </div>
              {(hasRole(currentUser, ...CAN_CREATE) || hasRole(currentUser, "ADMIN_ULTG")) && (tugSubTab==="TUG3"||tugSubTab==="TUG10"||tugSubTab==="TUG9"||tugSubTab==="TUG8"||tugSubTab==="TUG5") && <button style={sty.btn("primary")} onClick={()=>openNewTxn(tugSubTab)}>➕ {(TUG_UI[tugSubTab]||{}).buat || "Buat Baru"}</button>}
            </div>

            <div style={{display:"flex",gap:8,marginBottom:10,alignItems:"center",flexWrap:"wrap"}}>
              <span style={{fontSize:12,fontWeight:800,color:C.accent}}>{(TUG_GROUP_UI[tugGroup]||{}).icon} {(TUG_GROUP_UI[tugGroup]||{}).label}</span>
              <span style={{fontSize:11,color:C.muted}}>— {(TUG_GROUP_UI[tugGroup]||{}).hint}</span>
            </div>
            <div style={{display:"flex",gap:8,marginBottom:14,flexWrap:"wrap"}}>
              {(tugGroup==="penerimaan" ? ["TUG3","TUG10"]
                : tugGroup==="pengeluaran" ? ["TUG9","TUG8"]
                : tugGroup==="laporan" ? ["TUG15"]
                : ["TUG5"]
              ).map(id=>{
                const u = TUG_UI[id]||{}; const on = tugSubTab===id;
                return (
                <button key={id} onClick={()=>setTugSubTab(id)} title={u.code} style={{
                  display:"flex", alignItems:"center", gap:12, textAlign:"left", cursor:"pointer",
                  padding:isMobile?"12px 14px":"12px 16px", borderRadius:14, minHeight:60,
                  width:isMobile?"100%":260,
                  border:`2px solid ${on?C.accent:C.border}`,
                  background:on?C.accent:C.surface, color:on?"white":C.text,
                  boxShadow:on?"0 4px 14px rgba(29,78,216,0.30)":"0 1px 3px rgba(15,23,42,0.06)",
                  transition:"all .15s",
                }}>
                  <span style={{fontSize:22, width:42, height:42, flexShrink:0, borderRadius:11, display:"flex", alignItems:"center", justifyContent:"center", background:on?"rgba(255,255,255,0.22)":C.bg}}>{TUG_ICON[id]||"📄"}</span>
                  <span style={{display:"flex", flexDirection:"column", lineHeight:1.2}}>
                    <span style={{fontSize:14,fontWeight:800}}>{u.chip||id}</span>
                    <span style={{fontSize:10,fontWeight:600,opacity:on?.85:.6,marginTop:1}}>{u.code||id}</span>
                  </span>
                </button>
                );
              })}
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
          <div>
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
                {id:"ALL", label:"Semua", count:total},
                {id:"TUG", label:"TUG", count:tugCount},
                {id:"ALAT_BERAT", label:"Alat Berat", count:alatBeratCount},
                {id:"OPNAME", label:"Stock Opname", count:opnameCount},
                {id:"STOCK_COUNT", label:"Stock Count", count:stockCountCount},
                {id:"STOK", label:"Pemindahan/Edit/Hapus Stok", count:stokCount},
                {id:"LOKASI", label:"Lokasi/Blok", count:lokasiCount},
                {id:"KAPASITAS", label:"Kapasitas Gudang", count:capCount},
              ].filter(c=>c.id==="ALL"||c.count>0);
              return (
                <div style={{marginBottom:12}}>
                  <h1 style={{fontSize:22,fontWeight:900}}>Approval</h1>
                  <p style={{color:C.muted,fontSize:13,marginBottom:total>0?10:0}}>{total} item menunggu persetujuan atau tindakan kamu ({ROLES[currentUser.role]})</p>
                  {/* Filter jenis approval + pageSize — tepat di bawah subtitle, langsung
                      nyambung ke list di bawahnya (bukan 1 list panjang campur aduk semua jenis). */}
                  {total>0 && (
                    <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"center",paddingBottom:10,borderBottom:`1px solid ${C.border}`}}>
                      {chips.map(c=>{
                        const active = approvalTypeFilter===c.id;
                        return (
                          <button key={c.id} onClick={()=>setApprovalTypeFilter(c.id)}
                            style={{display:"flex",alignItems:"center",gap:5,padding:"5px 12px",borderRadius:20,border:`1.5px solid ${active?C.accent:C.border}`,background:active?C.accent:"white",color:active?"white":C.muted,fontWeight:700,fontSize:11,cursor:"pointer"}}>
                            <span>{c.label}</span>
                            <span style={{fontWeight:900}}>({c.count})</span>
                          </button>
                        );
                      })}
                      <div style={{display:"flex",alignItems:"center",gap:6,fontSize:11,color:C.muted,marginLeft:"auto"}}>
                        Tampilkan
                        <select style={{...sty.select,width:"auto",padding:"3px 6px",minHeight:"unset",fontSize:11}} value={approvalPageSize} onChange={e=>setApprovalPageSize(Number(e.target.value))}>
                          {[10,20,50].map(n=><option key={n} value={n}>{n}</option>)}
                        </select>
                        item/halaman
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}

            {(approvalTypeFilter==="ALL"||approvalTypeFilter==="TUG") && (
              <div style={{fontWeight:800,fontSize:14,margin:"4px 0 10px"}}>🔄 Transaksi TUG</div>
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
                          <div style={{fontSize:11,color:C.muted}}>{lokAsal?.kode||"—"} → {s.pendingLokasiKode} • Diajukan oleh {pemohon?.name||"?"} • {fmtDate(s.moveRequestedAt)}</div>
                        </div>
                        <div style={{display:"flex",gap:6}}>
                          <button style={sty.btn("primary","sm")} onClick={()=>approveStockMove(s.id)}>✓ Setuju</button>
                          <button style={sty.btn("danger","sm")} onClick={()=>rejectStockMove(s.id)}>✕ Tolak</button>
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
                          <div style={{fontSize:11,color:C.muted}}>{lokAsal?.kode||"—"} → {s.pendingLokasiKode} • Diajukan oleh {pemohon?.name||"?"} • {fmtDate(s.moveRequestedAt)}</div>
                        </div>
                        <div style={{display:"flex",gap:6}}>
                          <button style={sty.btn("primary","sm")} onClick={()=>approveStockMove(s.id)}>✓ Setuju</button>
                          <button style={sty.btn("danger","sm")} onClick={()=>rejectStockMove(s.id)}>✕ Tolak</button>
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
                          <div style={{fontSize:11,color:C.muted}}>Diajukan oleh {pemohon?.name||"?"} • {fmtDate(s.deleteRequestedAt)}</div>
                        </div>
                        <div style={{display:"flex",gap:6}}>
                          <button style={sty.btn("primary","sm")} onClick={()=>approveStockDelete(s.id)}>✓ Setuju</button>
                          <button style={sty.btn("danger","sm")} onClick={()=>rejectStockDelete(s.id)}>✕ Tolak</button>
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
                          <div style={{fontSize:11,color:C.muted}}>{opn.items?.length||0} item • Selisih: {selisihCount} item • Diajukan oleh {pengaju?.name||"?"} • {fmtDate(opn.submittedAt)}</div>
                        </div>
                        <div style={{display:"flex",gap:6,flexShrink:0}}>
                          <button style={sty.btn("primary","sm")} onClick={()=>hasRole(currentUser, "ASMAN")?approveOpname_Asman(opn,""):approveOpname_Manager(opn,"")}>✓ Setuju</button>
                          <button style={sty.btn("danger","sm")} onClick={()=>{
                            const reason = window.prompt("Alasan penolakan Stock Opname ini?");
                            if (reason) rejectOpname(opn, reason);
                          }}>✕ Tolak</button>
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
                        <div style={{fontSize:11,color:C.muted}}>No. Katalog {item.katalogKode} • SAP {fmtNum(item.qtySap)} vs Aplikasi {item.katalogId?fmtNum(item.qtyApp):"Tidak terdaftar"} {item.satuan} • Selisih {item.selisih>0?"+":""}{fmtNum(item.selisih)} ({item.selisihPct}%) • {fmtDate(session.uploadedAt)}</div>
                      </div>
                      <div style={{display:"flex",gap:6,flexShrink:0}}>
                        <button style={sty.btn("primary","sm")} onClick={()=>approveStockCountItem(session.id, item.id, "")}>✓ Setuju</button>
                        <button style={sty.btn("danger","sm")} onClick={()=>{
                          const reason = window.prompt("Alasan penolakan temuan Stock Count ini?");
                          if (reason) rejectStockCountItem(session.id, item.id, reason);
                        }}>✕ Tolak</button>
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

      </div>

      {/* STOCK MODAL (Data Stok = junction of Katalog x Lokasi) */}
      {stockModal && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000}}>
          <div style={{...sty.card,width:520,maxWidth:"100%",maxHeight:"90vh",overflowY:"auto"}}>
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
          <div style={{...sty.card,width:460,maxWidth:"100%",maxHeight:"90vh",overflowY:"auto"}}>
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
          <div style={{...sty.card,width:520,maxWidth:"100%",maxHeight:"85vh",overflowY:"auto"}}>
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
          <div style={{...sty.card,width:420,maxWidth:"100%"}}>
            <h3 style={{fontSize:18,fontWeight:800,marginBottom:20}}>{lokasiModal==="edit"?"Edit Master Lokasi":"Tambah Lokasi Gudang Baru"}</h3>
            {gudangList.length===0 ? (
              <div style={{background:"#fef3c7",border:`1px solid #fcd34d`,borderRadius:8,padding:"10px 12px",fontSize:12,color:"#92400e",marginBottom:16}}>⚠️ Belum ada Master Gudang. Tambahkan Gudang dulu di menu "Master Data" → "Master Gudang" sebelum bisa mengisi Blok — data harus berjenjang: Gudang dulu, baru Blok.</div>
            ) : (
              <div style={{background:"#dbeafe",border:`1px solid #93c5fd`,borderRadius:8,padding:"10px 12px",fontSize:12,color:"#1e40af",marginBottom:16}}>ℹ️ Pilih Gudang dulu, baru isi data Blok-nya (berjenjang).</div>
            )}
            <div style={{marginBottom:12}}>
              <label style={sty.label}>Gudang *</label>
              <select style={sty.select} value={lokasiForm.gudangId||""} disabled={gudangList.length===0 || lokasiModal==="edit"} onChange={e=>setLokasiForm(lf=>({...lf,gudangId:e.target.value||null,subGudangId:null}))}>
                <option value="">-- Pilih Gudang --</option>
                {gudangList.map(g=><option key={g.id} value={g.id}>{g.nama}</option>)}
              </select>
              {lokasiModal==="edit" && <div style={{fontSize:10,color:C.muted,marginTop:4}}>Gudang tidak bisa diubah saat edit blok. Hapus & buat ulang blok jika perlu pindah Gudang.</div>}
            </div>
            {lokasiForm.gudangId && (
              <div style={{marginBottom:12}}>
                <label style={sty.label}>Sub Gudang</label>
                <select style={sty.select} value={lokasiForm.subGudangId||""} disabled={lokasiModal==="edit"} onChange={e=>setLokasiForm(lf=>({...lf,subGudangId:e.target.value||null}))}>
                  <option value="">-- Umum / Tidak ada Sub Gudang --</option>
                  {subGudangList.filter(sg=>sg.gudangId===lokasiForm.gudangId).map(sg=><option key={sg.id} value={sg.id}>{sg.nama}</option>)}
                </select>
                {lokasiModal==="edit" && <div style={{fontSize:10,color:C.muted,marginTop:4}}>Sub Gudang tidak bisa diubah saat edit blok.</div>}
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
            <div style={{fontSize:11,color:"#92400e",background:"#fef3c7",border:"1px solid #fcd34d",borderRadius:8,padding:"8px 12px",marginBottom:20}}>
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
              <div style={{fontSize:11,color:"#92400e",background:"#fef3c7",border:"1px solid #fcd34d",borderRadius:8,padding:"8px 12px",marginBottom:20}}>
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
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000}}>
          <div style={{...sty.card,width:400,maxWidth:"100%"}}>
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
          <div style={{...sty.card,width:420,maxWidth:"100%"}}>
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
      {/* CARI DENGAN FOTO — modal upload foto query untuk visual search Data Stok */}
      {photoSearchOpen && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000,padding:16}} onClick={()=>!photoSearchLoading&&setPhotoSearchOpen(false)}>
          <div style={{...sty.card,width:420,maxWidth:"100%"}} onClick={e=>e.stopPropagation()}>
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
            <div style={{...sty.card,width:560,maxWidth:"100%",maxHeight:"90vh",overflowY:"auto"}} onClick={e=>e.stopPropagation()}>
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
          <div style={{...sty.card,width:560,maxWidth:"100%",maxHeight:"90vh",overflowY:"auto"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
              <div>
                <h3 style={{fontSize:16,fontWeight:800}}>📍 Lokasi di Peta Gudang</h3>
                <p style={{fontSize:11,color:C.muted}}>{petaMiniDetail.petaInfo?.subGudang ? `${petaMiniDetail.gudang.nama} — ${petaMiniDetail.petaInfo.subGudang.nama}` : petaMiniDetail.gudang.nama} — Blok: {petaMiniDetail.lokasi.kode} {petaMiniDetail.lokasi.nama}</p>
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
                <div style={{position:"absolute",top:-24,left:"50%",transform:"translateX(-50%)",background:"#dc2626",color:"white",fontSize:9,fontWeight:700,padding:"2px 6px",borderRadius:4,whiteSpace:"nowrap"}}>{petaMiniDetail.lokasi.kode}</div>
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
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000}}>
          <div style={{...sty.card,width:460,maxWidth:"100%"}}>
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
          <div style={{...sty.card,width:540,maxWidth:"100%",maxHeight:"90vh",overflowY:"auto"}}>
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

      {/* KONFIRMASI GUDANG BARU DARI IMPORT KAPASITAS GUDANG — muncul saat "Setujui &
          Publish" di Approval mendeteksi baris yang bakal jadi Gudang baru (tidak cocok
          Gudang existing manapun di UPT yang sama). Permintaan user 2026-07-06: sebelum
          ini, Gudang baru langsung dibuat otomatis tanpa konfirmasi, jadi variasi kecil
          penulisan nama gudang di Excel bikin duplikat. */}
      {capacityReviewImportId && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000,padding:20}}>
          <div style={{...sty.card,width:600,maxWidth:"100%",maxHeight:"90vh",overflowY:"auto"}}>
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
                    <div style={{fontSize:11,color:C.muted,marginBottom:8}}>UPT: {c.upt}</div>
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
            <div style={{display:"flex",gap:10}}>
              <button style={{...sty.btn("ghost"),flex:1}} onClick={()=>{setCapacityReviewImportId(null);setCapacityReviewCandidates([]);setCapacityReviewDecisions({});}}>Batal</button>
              <button style={{...sty.btn("primary"),flex:2}} onClick={confirmCapacityApproval}>✅ Konfirmasi & Lanjutkan Approve</button>
            </div>
          </div>
        </div>
      )}

      {/* MATURITY ASSESSMENT MODAL — input manual Admin untuk Dashboard */}
      {maturityModal && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000}}>
          <div style={{...sty.card,width:460,maxWidth:"100%"}}>
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
          <div style={{...sty.card,width:440,maxWidth:"100%"}}>
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
          <div style={{...sty.card,width:440,maxWidth:"100%"}}>
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
          <div style={{...sty.card,width:440,maxWidth:"100%"}}>
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

      {/* KELOLA AKUN MODAL — daftarkan user baru (ADMIN only) */}
      {akunModal && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000}}>
          <div style={{...sty.card,width:460,maxWidth:"100%"}}>
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
                <h3 style={{fontSize:18,fontWeight:800,marginBottom:20}}>{akunModal==="edit"?"Edit Akun":"Daftarkan Akun Baru"}</h3>
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
                            <div style={{fontSize:11,marginTop:4,color:filled>=quota?"#dc2626":C.muted}}>
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
                          <div style={{fontSize:11,marginTop:4,color:filled>=quota?"#dc2626":C.muted}}>
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
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000}}>
          <div style={{...sty.card,width:400,maxWidth:"100%"}}>
            <h3 style={{fontSize:18,fontWeight:800,marginBottom:20}}>🔑 Ganti Password</h3>
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
          <div style={{...sty.card,width:700,maxWidth:"100%",maxHeight:"92vh",overflowY:"auto"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
              <h3 style={{fontSize:18,fontWeight:800}}>Formulir TUG-5 — Daftar Permintaan Barang</h3>
              <span style={{fontSize:11,color:"#0098da",fontWeight:700}}>No: {docSeq}.TUG-5/...</span>
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
                    <div key={idx} style={{display:"flex",alignItems:isMobile?"stretch":"center",flexDirection:isMobile?"column":"row",gap:8,border:`1px solid ${C.border}`,borderRadius:8,padding:"8px 10px",marginBottom:8,background:"white",cursor:"pointer"}} onClick={()=>setTug5ExpandedIdx(idx)}>
                      <span style={{fontSize:11,fontWeight:700,color:C.muted}}>#{idx+1}</span>
                      <span style={{flex:1,fontSize:12,fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{kat ? `${kat.name} [${kat.katalog||"-"}]` : <span style={{color:C.muted,fontStyle:"italic"}}>Belum dipilih</span>}</span>
                      <div style={{display:"flex",alignItems:"center",justifyContent:isMobile?"space-between":"flex-start",gap:8,flexWrap:"wrap"}}>
                        <span style={{fontSize:11,color:C.accent,fontWeight:700}}>Qty: {si.permintaan||0}{kat?.satuan?` ${kat.satuan}`:""}</span>
                        <span style={{fontSize:11,color:C.muted}}>✏️ Edit</span>
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
                  {kat && <div style={{fontSize:10,color:C.muted,marginBottom:8}}>Nomor Normalisasi: {kat.katalog||"-"} • Satuan: {kat.satuan}</div>}
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
          <div style={{...sty.card,width:680,maxWidth:"100%",maxHeight:"92vh",overflowY:"auto"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
              <h3 style={{fontSize:18,fontWeight:800}}>Formulir {txnForm.docType.replace("TUG","TUG-")} — {txnForm.docType==="TUG9"?"Bon Pemakaian":"Pemakaian Unit Lain"}</h3>
              <span style={{fontSize:11,color:"#0098da",fontWeight:700}}>No: {docSeq}.{txnForm.docType.replace("TUG","TUG-")}/...</span>
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
                {satpamList.map(sp=><option key={sp.id} value={sp.id}>{sp.name}</option>)}
              </select>
              {satpamList.length===0 && <div style={{fontSize:10,color:C.muted,marginTop:4}}>Belum ada data Satpam. Tambahkan di menu Master Data → tab Satpam.</div>}
            </div>

            <div style={{fontSize:12,fontWeight:800,color:C.accent,marginBottom:8,borderBottom:`1px solid ${C.border}`,paddingBottom:4}}>BARANG / MATERIAL</div>
            <div style={{fontSize:10,color:C.muted,marginBottom:8,fontStyle:"italic"}}>💡 Barang yang sama bisa ada di lokasi berbeda — pastikan pilih baris dengan lokasi yang benar.</div>
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
                          <div style={{fontSize:10,color:C.muted}}>📍 {s.lokasi} • {s.jenisBarang!=="Non-Stock"?`Stok: ${fmtNum(s.qty)} ${s.unit}`:"Non-Stock"}</div>
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
                      <div style={{fontSize:11,fontWeight:600,marginBottom:4,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{stock?.name||"-"}</div>
                      <input type="file" accept="image/*" capture="environment" onChange={e=>handleMaterialImg(e, si.stockId)} style={{fontSize:10,color:C.muted,width:"100%"}}/>
                      {existingPhoto && <img src={existingPhoto.img} alt={stock?.name} style={{width:"100%",height:60,objectFit:"cover",borderRadius:6,marginTop:6}}/>}
                    </div>
                  );
                })}
                {txnForm.stockItems.filter(si=>si.stockId).length===0 && <div style={{fontSize:11,color:C.muted,fontStyle:"italic"}}>Pilih barang terlebih dahulu untuk upload foto material</div>}
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
      {txnModal && txnForm && txnForm.docType==="TUG10" && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000,padding:20}}>
          <div style={{...sty.card,width:700,maxWidth:"100%",maxHeight:"92vh",overflowY:"auto"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
              <h3 style={{fontSize:18,fontWeight:800}}>Formulir TUG-10 — Bon Pengembalian</h3>
              <span style={{fontSize:11,color:"#0098da",fontWeight:700}}>No: {docSeq}.TUG-10/...</span>
            </div>
            <div style={{background:"#fef3c7",border:`1px solid #fcd34d`,borderRadius:8,padding:"8px 12px",fontSize:12,color:"#92400e",marginBottom:16}}>⚠️ Transaksi akan PENDING sampai disetujui TL Logistik / Asman. Stok akan BERTAMBAH saat disetujui.</div>

            <div style={{fontSize:12,fontWeight:800,color:C.accent,marginBottom:8,borderBottom:`1px solid ${C.border}`,paddingBottom:4}}>DATA PEKERJAAN</div>
            <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"1fr 1fr",gap:12,marginBottom:14}}>
              <div><label style={sty.label}>Pekerjaan (jenis)</label><input style={sty.input} value={txnForm.pekerjaan} onChange={e=>setTxnForm(tf=>({...tf,pekerjaan:e.target.value}))} placeholder="cth: Penggantian"/></div>
              <div><label style={sty.label}>No. BA Penggantian</label><input style={sty.input} value={txnForm.noBAPenggantian} onChange={e=>setTxnForm(tf=>({...tf,noBAPenggantian:e.target.value}))} placeholder="0266/PT-SD/VI/2026"/></div>
              <div style={{gridColumn:"1/-1"}}><label style={sty.label}>Nama Pekerjaan *</label><input style={sty.input} value={txnForm.namaPekerjaan} onChange={e=>setTxnForm(tf=>({...tf,namaPekerjaan:e.target.value}))} placeholder="cth: Pengembalian Material Relay GIS Darmo dan GIS Waru"/></div>
              <div style={{gridColumn:"1/-1"}}><label style={sty.label}>Lokasi Pekerjaan *</label><input style={sty.input} value={txnForm.lokasiPekerjaan} onChange={e=>setTxnForm(tf=>({...tf,lokasiPekerjaan:e.target.value}))} placeholder="cth: GIS Darmo dan GIS Waru"/></div>
            </div>

            <div style={{fontSize:12,fontWeight:800,color:C.accent,marginBottom:8,borderBottom:`1px solid ${C.border}`,paddingBottom:4}}>PIHAK & LOKASI PENYIMPANAN</div>
            <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"1fr 1fr",gap:12,marginBottom:14}}>
              <div>
                <label style={sty.label}>Yang Menyerahkan *</label>
                <input style={sty.input} value={txnForm.menyerahkanNama} onChange={e=>setTxnForm(tf=>({...tf,menyerahkanNama:e.target.value}))}/>
              </div>
              <div>
                <label style={sty.label}>Lokasi Penyimpanan di Gudang (Master Lokasi) *</label>
                <select style={sty.select} value={txnForm.lokasiTujuanId||""} onChange={e=>setTxnForm(tf=>({...tf,lokasiTujuanId:e.target.value}))}>
                  <option value="">-- Pilih Lokasi --</option>
                  {lokasiList.map(l=><option key={l.id} value={l.id}>{l.kode} {l.keterangan?`— ${l.keterangan}`:""}</option>)}
                </select>
                {lokasiList.length===0 && <div style={{fontSize:10,color:"#be185d",marginTop:4}}>Belum ada Blok Lokasi. Tambahkan dulu di menu Master Data → Master Gudang.</div>}
              </div>
            </div>

            <div style={{fontSize:12,fontWeight:800,color:C.accent,marginBottom:8,borderBottom:`1px solid ${C.border}`,paddingBottom:4}}>BARANG / MATERIAL RETUR</div>
            <div style={{fontSize:10,color:C.muted,marginBottom:8,fontStyle:"italic"}}>💡 Pilih dari katalog yang sudah ada, atau daftarkan barang baru langsung di sini.</div>
            {txnForm.stockItems.map((si,idx)=>(
              <div key={idx} style={{border:`1px solid ${C.border}`,borderRadius:10,padding:12,marginBottom:10,background:"#f9fafb"}}>
                <div style={{display:"flex",gap:8,marginBottom:8}}>
                  <button type="button" style={{...sty.btn(si.katalogMode==="existing"?"primary":"ghost","sm"),flex:1}} onClick={()=>updateItemRow(idx,"katalogMode","existing")}>📑 Dari Katalog</button>
                  <button type="button" style={{...sty.btn(si.katalogMode==="new"?"primary":"ghost","sm"),flex:1}} onClick={()=>updateItemRow(idx,"katalogMode","new")}>✨ Barang Baru</button>
                  {txnForm.stockItems.length>1 && <button type="button" title="Hapus barang retur ini" style={{...sty.btn("danger","sm")}} onClick={()=>removeItemRow(idx)}>✕</button>}
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
                    <div style={{gridColumn:"1/-1"}}><label style={sty.label}>Nama Barang Baru</label><input style={sty.input} value={si.namaBaru} onChange={e=>updateItemRow(idx,"namaBaru",e.target.value)} placeholder="cth: Relay CCP Bongkaran"/></div>
                    <div><label style={sty.label}>Nomor Katalog</label><input style={sty.input} value={si.katalogBaru} onChange={e=>updateItemRow(idx,"katalogBaru",e.target.value)}/></div>
                    <div><label style={sty.label}>Satuan</label><input style={sty.input} value={si.satuanBaru} onChange={e=>updateItemRow(idx,"satuanBaru",e.target.value)} placeholder="cth: BH, pcs, unit"/></div>
                    <div style={{gridColumn:"1/-1"}}><label style={sty.label}>Kategori</label><select style={sty.select} value={si.categoryBaru} onChange={e=>updateItemRow(idx,"categoryBaru",e.target.value)}>{CATEGORIES.map(c=><option key={c}>{c}</option>)}</select></div>
                  </div>
                )}

                <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"1fr 1fr",gap:8,marginBottom:8}}>
                  <div><label style={sty.label}>Jumlah</label><input style={sty.input} type="number" inputMode="decimal" min="1" value={si.qty} onChange={e=>updateItemRow(idx,"qty",Number(e.target.value))}/></div>
                  <div><label style={sty.label}>Nomor Asset</label><input style={sty.input} value={si.noAsset} onChange={e=>updateItemRow(idx,"noAsset",e.target.value)}/></div>
                </div>

                <div style={{marginBottom:8}}>
                  <label style={sty.label}>Status Material</label>
                  <div style={{display:"flex",flexDirection:isMobile?"column":"row",gap:8}}>
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
                  <input type="file" accept="image/*" capture="environment" onChange={e=>handleImg(e, img=>updateItemRow(idx,"fotoBarangRetur",img))} style={{fontSize:12,color:C.text,width:"100%"}}/>
                  {si.fotoBarangRetur && <img src={si.fotoBarangRetur} alt="barang" style={{width:isMobile?"100%":120,height:isMobile?140:80,objectFit:"cover",borderRadius:6,marginTop:6}}/>}
                </div>

                {si.statusMaterial==="Bongkaran ATTB (MTU)" && (
                  <div style={{background:"#fffbeb",border:`1px solid #fde68a`,borderRadius:8,padding:10}}>
                    <div style={{fontSize:11,fontWeight:700,color:"#92400e",marginBottom:8}}>📋 Data Tambahan Wajib — Bongkaran ATTB (MTU)</div>
                    <div style={{marginBottom:8}}><label style={sty.label}>Nomor Seri Material *</label><input style={sty.input} value={si.noSeri} onChange={e=>updateItemRow(idx,"noSeri",e.target.value)} placeholder="cth: SN-2024-001"/></div>
                    <div>
                      <label style={sty.label}>Foto Nameplate *</label>
                      <input type="file" accept="image/*" capture="environment" onChange={e=>handleImg(e, img=>updateItemRow(idx,"fotoNameplate",img))} style={{fontSize:12,color:C.text,width:"100%"}}/>
                      {si.fotoNameplate && <img src={si.fotoNameplate} alt="nameplate" style={{width:isMobile?"100%":120,height:isMobile?140:80,objectFit:"cover",borderRadius:6,marginTop:6}}/>}
                    </div>
                  </div>
                )}
              </div>
            ))}
            <button type="button" style={{...sty.btn("ghost","sm"),marginBottom:14}} onClick={addItemRow}>+ Tambah Barang Retur Lain</button>

            {txnForm.stockItems.some(si=>si.statusMaterial==="Bongkaran ATTB (MTU)") && (
              <div style={{marginBottom:16}}>
                <label style={sty.label}>Upload Surat BA Pengembalian * (foto)</label>
                <input type="file" accept="image/*" capture="environment" onChange={e=>handleImg(e, img=>setTxnForm(tf=>({...tf,fotoBAPengembalian:img})))} style={{fontSize:12,color:C.text}}/>
                {txnForm.fotoBAPengembalian && <img src={txnForm.fotoBAPengembalian} alt="BA Pengembalian" style={{width:isMobile?"100%":120,height:isMobile?140:80,objectFit:"cover",borderRadius:6,marginTop:6,border:`1px solid ${C.border}`}}/>}
              </div>
            )}

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
          <div style={{...sty.card,width:700,maxWidth:"100%",maxHeight:"92vh",overflowY:"auto"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
              <h3 style={{fontSize:18,fontWeight:800}}>Formulir TUG-3 Karantina — Bon Penerimaan</h3>
              <span style={{fontSize:11,color:"#0098da",fontWeight:700}}>No: {docSeq}.TUG-3/...</span>
            </div>
            <div style={{background:"#dbeafe",border:`1px solid #93c5fd`,borderRadius:8,padding:"8px 12px",fontSize:12,color:"#1e40af",marginBottom:16}}>ℹ️ Setelah diajukan: TL Logistik approve → lanjut isi TUG-4 → Manager approve → lengkapi lampiran → Asman approve → stok masuk gudang.</div>

            <div style={{fontSize:12,fontWeight:800,color:C.accent,marginBottom:8,borderBottom:`1px solid ${C.border}`,paddingBottom:4}}>DATA PENERIMAAN</div>
            <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"1fr 1fr",gap:12,marginBottom:10}}>
              <div><label style={sty.label}>Tanggal Diterima *</label><input type="date" style={sty.input} value={txnForm.tanggalDiterima} onChange={e=>setTxnForm(tf=>({...tf,tanggalDiterima:e.target.value}))}/></div>
              <div><label style={sty.label}>Dari (Supplier) *</label><input style={sty.input} value={txnForm.dariSupplier} onChange={e=>setTxnForm(tf=>({...tf,dariSupplier:e.target.value}))} placeholder="cth: PT. Sedayu"/></div>
              <div style={{gridColumn:"1/-1"}}><label style={sty.label}>Dengan</label><input style={sty.input} value={txnForm.denganKirim} onChange={e=>setTxnForm(tf=>({...tf,denganKirim:e.target.value}))} placeholder="cth: Dikirim Langsung"/></div>
            </div>
            <div style={{fontSize:10,fontWeight:700,color:C.muted,textTransform:"uppercase",letterSpacing:".5px",marginBottom:8}}>Dokumen Pengiriman</div>
            <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"1fr 1fr",gap:12,marginBottom:10}}>
              <div><label style={sty.label}>No. Surat Jalan</label><input style={sty.input} value={txnForm.noSuratJalan} onChange={e=>setTxnForm(tf=>({...tf,noSuratJalan:e.target.value}))}/></div>
              <div><label style={sty.label}>Tgl. Surat Jalan</label><input type="date" style={sty.input} value={txnForm.tglSuratJalan} onChange={e=>setTxnForm(tf=>({...tf,tglSuratJalan:e.target.value}))}/></div>
              <div><label style={sty.label}>No. SPK / Surat Pesanan</label><input style={sty.input} value={txnForm.noSpk} onChange={e=>setTxnForm(tf=>({...tf,noSpk:e.target.value}))}/></div>
              <div><label style={sty.label}>Tgl. SPK</label><input type="date" style={sty.input} value={txnForm.tglSpk} onChange={e=>setTxnForm(tf=>({...tf,tglSpk:e.target.value}))}/></div>
            </div>
            <div style={{fontSize:10,fontWeight:700,color:C.muted,textTransform:"uppercase",letterSpacing:".5px",marginBottom:8}}>Dokumen Keuangan</div>
            <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"1fr 1fr",gap:12,marginBottom:14}}>
              <div><label style={sty.label}>No. Faktur / Bukti Kas</label><input style={sty.input} value={txnForm.noFaktur} onChange={e=>setTxnForm(tf=>({...tf,noFaktur:e.target.value}))}/></div>
              <div><label style={sty.label}>Tgl. Faktur</label><input type="date" style={sty.input} value={txnForm.tglFaktur} onChange={e=>setTxnForm(tf=>({...tf,tglFaktur:e.target.value}))}/></div>
              <div><label style={sty.label}>No. Amandemen/Kontrak</label><input style={sty.input} value={txnForm.noAmandemen} onChange={e=>setTxnForm(tf=>({...tf,noAmandemen:e.target.value}))}/></div>
              <div><label style={sty.label}>Biaya Angkutan</label><input type="number" inputMode="decimal" style={sty.input} value={txnForm.biayaAngkutan} onChange={e=>setTxnForm(tf=>({...tf,biayaAngkutan:Number(e.target.value)}))}/></div>
            </div>

            <div style={{fontSize:12,fontWeight:800,color:C.accent,marginBottom:8,borderBottom:`1px solid ${C.border}`,paddingBottom:4}}>BARANG / SPARE PARTS</div>
            <div style={{fontSize:10,color:C.muted,marginBottom:8,fontStyle:"italic"}}>💡 Pilih dari katalog yang sudah ada, atau daftarkan barang baru langsung di sini.</div>
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
                if (dp.docType==="TUG10") downloadTUG10HTML(dp, katalogList, lokasiList, users, showToast);
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
              srcDoc={dp.docType==="TUG10" ? buildTUG10HTML(dp, katalogList, lokasiList, users) : dp.docType==="TUG3" ? buildTUG3HTML(dp, katalogList, lokasiList, timMutuList, users) : dp.docType==="TUG5" ? buildTUG5HTML(dp, katalogList, uitList, users, ultgList) : dp.docType==="TUG7" ? buildTUG7HTML(dp, katalogList, uitList, uptList, users) : buildTUG9HTML(dp, enrichedStocks, users, satpamList)}
              style={{width:"100%",height:"100%",border:"none"}}
            />
          </div>
          <div style={{padding:"8px 18px",background:"#fef3c7",fontSize:11,color:"#92400e",flexShrink:0}}>
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
    return { id: kid, data: { name: kat?.name||kid, katalog: kat?.katalog||null, satuan: kat?.satuan||null, jenisBarang: kat?.jenisBarang||null } };
  });
  // ignore-duplicates (bukan merge-duplicates): baris katalog yang sudah ada
  // (disinkron lewat syncMasterTable("katalog",...) di jalur utama) TIDAK BOLEH
  // ditimpa payload minimal di sini — kalau di-merge, field data jsonb lengkap
  // (merk/type/keterangan/dst) bisa hilang, cuma menyisakan 4 field ini.
  // Insert ini murni jaga-jaga FK (katalog_id di tug15_history) untuk id yang
  // belum sempat tersinkron dari jalur utama.
  const katRes = await fetch(`${SUPABASE_URL}/rest/v1/katalog?on_conflict=id`, {
    method: "POST",
    headers: { ...headers, "Prefer": "resolution=ignore-duplicates" },
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

  // Pastikan katalog-nya ada dulu (FK target). ignore-duplicates supaya tidak
  // menimpa data jsonb lengkap milik baris yang sudah tersinkron via jalur utama.
  const katalogPayload = katalogIds.map(kid => {
    const kat = katalogList.find(k=>k.id===kid);
    return { id: kid, data: { name: kat?.name||kid, katalog: kat?.katalog||null, satuan: kat?.satuan||null, jenisBarang: kat?.jenisBarang||null } };
  });
  const katRes = await fetch(`${SUPABASE_URL}/rest/v1/katalog?on_conflict=id`, {
    method: "POST",
    headers: { ...headers, "Prefer": "resolution=ignore-duplicates" },
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

// Kompres + resize foto ke JPEG di bawah target ukuran, mengembalikan data URL.
// Dipakai sebelum upload ke Storage (foto transaksi TUG, stok, visual-search)
// supaya hemat penyimpanan/bandwidth. Menerima File maupun data URL.
//   maxBytes : batas ukuran hasil (default 1MB; SIM/KTP pakai ~300KB).
//   maxDim   : sisi terpanjang maksimum (px) sebelum kualitas diturunkan.
async function compressImage(input, { maxBytes = 1_000_000, maxDim = 1600 } = {}) {
  const srcUrl = typeof input === "string" ? input : URL.createObjectURL(input);
  try {
    const img = await new Promise((resolve, reject) => {
      const im = new Image();
      im.onload = () => resolve(im);
      im.onerror = () => reject(new Error("Gagal memuat gambar untuk kompresi."));
      im.src = srcUrl;
    });
    let width = img.naturalWidth || img.width;
    let height = img.naturalHeight || img.height;
    const scale = Math.min(1, maxDim / Math.max(width, height));
    width = Math.max(1, Math.round(width * scale));
    height = Math.max(1, Math.round(height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";                 // cegah PNG transparan jadi hitam saat ke JPEG
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);

    const bytesOf = (u) => Math.ceil((u.length - (u.indexOf(",") + 1)) * 0.75);
    let quality = 0.85;
    let dataUrl = canvas.toDataURL("image/jpeg", quality);
    while (bytesOf(dataUrl) > maxBytes && quality > 0.4) {
      quality -= 0.1;
      dataUrl = canvas.toDataURL("image/jpeg", quality);
    }
    // Masih kegedean di kualitas minimum → kecilkan dimensi lalu ulang.
    if (bytesOf(dataUrl) > maxBytes && Math.max(width, height) > 800) {
      return compressImage(dataUrl, { maxBytes, maxDim: Math.round(Math.max(width, height) * 0.75) });
    }
    return dataUrl;
  } finally {
    if (typeof input !== "string") URL.revokeObjectURL(srcUrl);
  }
}

function dataUrlToBlob(dataUrl) {
  const match = dataUrl.match(/^data:(.*?);base64,(.*)$/);
  if (!match) throw new Error("Format foto tidak valid (bukan base64 dataURL).");
  const mime = match[1] || "image/jpeg";
  const binary = atob(match[2]);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

// ── Foto transaksi TUG → Supabase Storage (bukan base64 di blob) ─────────────
// SIM/KTP = data pribadi → bucket privat, disimpan sbg penanda "priv:<path>",
// ditampilkan lewat signed URL. Foto lain → bucket publik (URL langsung).
const TXN_PHOTO_SLOTS = [
  { field: "fotoKendaraan",         bucket: "tug-photos",       maxBytes: 1_000_000 },
  { field: "fotoSimKtp",            bucket: "tug-docs-private",  maxBytes:   300_000 },
  { field: "fotoSuratPengembalian", bucket: "tug-photos",       maxBytes: 1_000_000 },
  { field: "fotoBAPengembalian",    bucket: "tug-photos",       maxBytes: 1_000_000 },
  { field: "fotoSuratJalanImg",     bucket: "tug-photos",       maxBytes: 1_000_000 },
  { field: "fotoKontrak",           bucket: "tug-photos",       maxBytes: 1_000_000 },
];
const _isDataUrl = (v) => typeof v === "string" && v.startsWith("data:");

async function _uploadTxnPhoto(dataUrl, bucket, path) {
  const blob = dataUrlToBlob(dataUrl);
  const { error } = await supabase.storage.from(bucket).upload(path, blob, { upsert: true, contentType: blob.type });
  if (error) throw error;
  return bucket === "tug-docs-private"
    ? `priv:${path}`                                                     // render via signed URL
    : supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl;
}

// Upload semua foto base64 sebuah transaksi ke Storage → ganti jadi URL/penanda.
// Foto yang gagal upload (mis. offline) dibiarkan base64 & dicatat di `pending`
// (transaksi tetap tersimpan + dokumen tetap bisa dibuat; disinkron ulang nanti).
async function processTxnPhotos(txn, prefix) {
  if (!supabase) return { data: txn, pending: [] };
  const t = { ...txn };
  const pending = [];
  for (const { field, bucket, maxBytes } of TXN_PHOTO_SLOTS) {
    if (_isDataUrl(t[field])) {
      try { t[field] = await _uploadTxnPhoto(await compressImage(t[field], { maxBytes }), bucket, `${prefix}/${field}.jpg`); }
      catch { pending.push(field); }
    }
  }
  if (Array.isArray(t.fotoMaterial)) {
    t.fotoMaterial = await Promise.all(t.fotoMaterial.map(async (fm) => {
      if (!_isDataUrl(fm?.img)) return fm;
      try { return { ...fm, img: await _uploadTxnPhoto(await compressImage(fm.img, { maxBytes: 1_000_000 }), "tug-photos", `${prefix}/material-${fm.stockId}.jpg`) }; }
      catch { pending.push(`material:${fm.stockId}`); return fm; }
    }));
  }
  if (Array.isArray(t.stockItems)) {
    t.stockItems = await Promise.all(t.stockItems.map(async (si, idx) => {
      const nsi = { ...si };
      for (const field of ["fotoNameplate", "fotoBarangRetur"]) {
        if (_isDataUrl(nsi[field])) {
          try { nsi[field] = await _uploadTxnPhoto(await compressImage(nsi[field], { maxBytes: 1_000_000 }), "tug-photos", `${prefix}/item${idx}-${field}.jpg`); }
          catch { pending.push(`item${idx}.${field}`); }
        }
      }
      return nsi;
    }));
  }
  if (pending.length) t._fotoPending = true; else if (t._fotoPending) delete t._fotoPending;
  return { data: t, pending };
}

// SIM/KTP "priv:<path>" → signed URL (1 jam) untuk ditampilkan/dicetak.
async function resolveTxnPrivPhotos(txn) {
  if (!supabase || !txn || typeof txn.fotoSimKtp !== "string" || !txn.fotoSimKtp.startsWith("priv:")) return txn;
  try {
    const { data } = await supabase.storage.from("tug-docs-private").createSignedUrl(txn.fotoSimKtp.slice(5), 3600);
    return data?.signedUrl ? { ...txn, fotoSimKtp: data.signedUrl } : txn;
  } catch { return txn; }
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

    // Foto hasil migrasi AppSheet sudah berupa URL Storage (bukan base64 data URL).
    // Tidak perlu di-upload ulang — cukup pakai URL-nya langsung sebagai
    // fotoKeseluruhanUrl (dipakai halaman scan QR). Tanpa guard ini, dataUrlToBlob
    // akan error karena img bukan format "data:...;base64,".
    if (!/^data:/i.test(img)) {
      const katRes = await fetch(`${SUPABASE_URL}/rest/v1/katalog?on_conflict=id`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json", "Prefer": "resolution=merge-duplicates" },
        body: JSON.stringify([{ id: kat.id, data: { ...kat, fotoKeseluruhanUrl: img } }]),
      });
      if (!katRes.ok) throw new Error(`Gagal simpan URL foto ke katalog: ${await katRes.text()}`);
      synced[kat.id] = fingerprint;
      uploadCount++;
      continue;
    }

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
    // Kirim seluruh objek `kat` (state React, sudah lengkap) + fotoKeseluruhanUrl
    // sebagai `data` jsonb — BUKAN payload minimal — supaya merge-duplicates di
    // sini tidak menghapus field lain (merk/type/keterangan/dst) milik baris ini.
    const katRes = await fetch(`${SUPABASE_URL}/rest/v1/katalog?on_conflict=id`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json", "Prefer": "resolution=merge-duplicates" },
      body: JSON.stringify([{ id: kat.id, data: { ...kat, fotoKeseluruhanUrl: publicUrl } }]),
    });
    if (!katRes.ok) throw new Error(`Gagal simpan URL foto ke katalog: ${await katRes.text()}`);

    synced[kat.id] = fingerprint;
    uploadCount++;
  }
  localStorage.setItem(FOTO_SYNCED_HASHES_STORAGE, JSON.stringify(synced));
  return { uploadCount };
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

























// ─── AI AGENT PAGE (Forecast + Chat terintegrasi) ────────────────────────
// Panel kurasi FAQ Bot (Admin only) — tampilkan pertanyaan nyata dari bot WA/Telegram
// yang dijawab buruk (kena feedback 👎 atau jawabannya kedengaran "menyerah"), Admin
// tulis jawaban resmi → tersimpan ke ai_faq_curated → ikut di-embed ke rag_chunks
// (lewat syncRagChunks) supaya pertanyaan serupa besok-besok langsung dijawab benar.





function AIAgentPage({ enrichedStocks, katalogList, stocks, txns,
  rencanaKedatanganList, chatHistory, setChatHistory, chatInput, setChatInput,
  chatLoading, chatEndRef, sendChat, syncRagChunks, syncWarnotoState, syncStocksSnapshot, ragSyncing, ragLastSync, currentUser, C, sty }) {

  const [showFaqPanel, setShowFaqPanel] = useState(false);
  const [showTgPanel, setShowTgPanel] = useState(false);

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
        {hasRole(currentUser, "ADMIN") && (
          <div style={{textAlign:"right"}}>
            <div style={{display:"flex",gap:8,justifyContent:"flex-end",flexWrap:"wrap"}}>
              <button style={{...sty.btn("ghost","sm"),opacity:ragSyncing?0.6:1}} disabled={ragSyncing} onClick={async()=>{await syncStocksSnapshot(); await syncRagChunks(); await syncWarnotoState();}}>
                {ragSyncing?"Menyinkron...":"🔄 Sync Knowledge Base (RAG + Bot Telegram)"}
              </button>
              <button style={sty.btn(showFaqPanel?"primary":"ghost","sm")} onClick={()=>setShowFaqPanel(v=>!v)}>
                🧠 Kelola FAQ Bot
              </button>
              <button style={sty.btn(showTgPanel?"primary":"ghost","sm")} onClick={()=>setShowTgPanel(v=>!v)}>
                📱 Kelola User Telegram
              </button>
            </div>
            {ragLastSync && <div style={{fontSize:10,color:C.muted,marginTop:4}}>Terakhir sync: {fmtDate(ragLastSync)}</div>}
          </div>
        )}
      </div>

      {showFaqPanel && hasRole(currentUser, "ADMIN") && <AIFaqPanel sty={sty} C={C} onSaved={async()=>{await syncRagChunks(true);}}/>}
      {showTgPanel && hasRole(currentUser, "ADMIN") && <TelegramWhitelistPanel sty={sty} C={C} currentUser={currentUser}/>}

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
                  <div style={{width:34,height:34,borderRadius:"50%",background:C.sidebar,display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,marginRight:8,flexShrink:0}}>⚡</div>
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
                <div style={{width:34,height:34,borderRadius:"50%",background:C.sidebar,display:"flex",alignItems:"center",justifyContent:"center"}}>⚡</div>
                <div style={{background:"#f8fafc",border:`1px solid ${C.border}`,borderRadius:12,padding:"10px 14px",fontSize:12,color:C.muted}}>
                  Menganalisa data gudang... ⏳
                </div>
              </div>
            )}
            <div ref={chatEndRef}/>
          </div>
          {/* Input */}
          <div style={{display:"flex",gap:8}}>
            <button title="Bersihkan riwayat chat" style={{...sty.btn("ghost","sm"),flexShrink:0}} onClick={()=>setChatHistory([{role:"ai",text:`Halo! Ada yang bisa saya bantu tentang data gudang ${WAREHOUSE}?`}])}>🗑️</button>
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
function ForecastStokPage({ katalogList, setKatalogList, stocks, txns, forecastDetail, setForecastDetail,
  forecastDetailResult, setForecastDetailResult, forecastDetailLoading, forecastDrillDown,
  setTab, sendChat,
  materialCadangData, setMaterialCadangData, maraReference, setMaraReference,
  materialCadangHealthData, setMaterialCadangHealthData,
  materialCadangAiInsights, setMaterialCadangAiInsights,
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
          materialCadangHealthData={materialCadangHealthData}
          setMaterialCadangHealthData={setMaterialCadangHealthData}
          materialCadangAiInsights={materialCadangAiInsights}
          setMaterialCadangAiInsights={setMaterialCadangAiInsights}
          maraReference={maraReference}
          setMaraReference={setMaraReference}
          catalogMasterRef={catalogMasterRef}
          setCatalogMasterRef={setCatalogMasterRef}
          katalogList={katalogList}
          setKatalogList={setKatalogList}
          stocks={stocks}
          txns={txns}
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



// ─── STOCK OPNAME TAB ────────────────────────────────────────────────────

function StockOpnameTab({ opnameList, stocks, katalogList, currentUser, users, sty, C,
  saveOpname, submitOpname, approveOpname_Asman, approveOpname_Manager, rejectOpname, deleteOpname,
  openScanner, showToast, gudangList, lokasiList, addNonStockFoundItem, isMobile }) {

  const [activeTab, setActiveTab] = useState("list"); // "list"|"form-sap"|"form-nonsap"|"detail"
  const [activeOpname, setActiveOpname] = useState(null);
  const [page, setPage] = useState(0);
  const [filterStatus, setFilterStatus] = useState("semua");
  const [rejectingId, setRejectingId] = useState(null);
  const [rejectReason, setRejectReason] = useState("");
  const [catatanApproval, setCatatanApproval] = useState("");
  const [csvLoading, setCsvLoading] = useState(false);
  const [validationErrors, setValidationErrors] = useState([]);
  const [highlightIdx, setHighlightIdx] = useState(null); // baris hasil scan QR — cuma bantu temukan & fokus, bukan pengganti hitung fisik
  const qtyInputRefs = useRef({});
  const [pageSize, setPageSize] = useState(10);

  // "Tambah Material Ditemukan" (Opname Non-SAP) — form untuk barang fisik yang belum
  // tercatat sama sekali di sistem, ditemukan sambil opname jalan.
  const [tambahModal, setTambahModal] = useState(false);
  const [tambahForm, setTambahForm] = useState({ nama:"", satuan:"", qty:"", gudangId:"", lokasiId:"", foto:null });
  const [maraQuery, setMaraQuery] = useState("");
  const [maraResults, setMaraResults] = useState([]);
  const [maraLoading, setMaraLoading] = useState(false);
  const [maraPicked, setMaraPicked] = useState(null); // {kode_material, nama, satuan} atau null
  const [maraSkip, setMaraSkip] = useState(false); // user pilih "Tidak ada di MARA / lewati dulu"
  const [tambahBusy, setTambahBusy] = useState(false);
  const [qrResult, setQrResult] = useState(null); // katalog object baru, tampilkan label QR setelah simpan

  // Antrian dari file "Usulan Pencocokan MARA" yang di-upload — starting point untuk
  // "Tambah Material Ditemukan", BUKAN jalur upload-langsung-masuk-sistem. Tiap baris tetap
  // wajib direview satu per satu (qty fisik + lokasi diisi ulang saat itu), cuma nama/kandidat
  // kode MARA-nya sudah keisi duluan supaya Admin tidak perlu cari dari nol.
  const [tambahQueue, setTambahQueue] = useState([]);
  const [queueUploadBusy, setQueueUploadBusy] = useState(false);
  const [activeQueueId, setActiveQueueId] = useState(null); // baris antrian yang sedang diproses di modal

  async function handleUploadUsulan(e) {
    const f = e.target.files[0]; if (!f) return;
    setQueueUploadBusy(true);
    try {
      const buf = await f.arrayBuffer();
      const rows = parseUsulanPencocokanXLSX(buf);
      if (!rows.length) { showToast("File tidak punya baris yang bisa dibaca (cek sheet 'usulan_pencocokan').","error"); }
      else { setTambahQueue(rows); showToast(`✅ ${rows.length} baris usulan dimuat — proses satu per satu lewat daftar di bawah.`); }
    } catch (err) {
      showToast("Gagal membaca file: " + err.message, "error");
    }
    setQueueUploadBusy(false);
    e.target.value = "";
  }

  async function searchMaraForOpname(q) {
    setMaraQuery(q); setMaraPicked(null);
    if (!q || q.trim().length < 2) { setMaraResults([]); return; }
    if (!supabase) return;
    setMaraLoading(true);
    const terms = expandQueryForIlikeSearch(q);
    const orFilter = terms.map(t => `nama.ilike.%${t}%`).join(",");
    const { data, error } = await supabase.from("mara_catalog")
      .select("kode_material,nama,satuan").or(orFilter).limit(15);
    setMaraLoading(false);
    setMaraResults(error ? [] : (data || []));
  }

  function openTambahModal(queueItem) {
    setTambahForm({ nama:queueItem?.nama||"", satuan:queueItem?.satuanFile||"", qty:"", gudangId:"", lokasiId:"", foto:null });
    setMaraQuery(""); setMaraResults([]); setMaraSkip(false);
    // Kalau baris antrian sudah punya kandidat MARA (skor KUAT/LEMAH), langsung pre-fill —
    // Admin tetap bisa tap "Ganti" kalau ternyata salah/mau cari ulang.
    setMaraPicked(queueItem?.maraCode ? { kode_material: queueItem.maraCode, nama: queueItem.maraNama, satuan: queueItem.satuanFile } : null);
    setActiveQueueId(queueItem?.id || null);
    setQrResult(null);
    setTambahModal(true);
  }

  async function submitTambahMaterial() {
    const f = tambahForm;
    if (!f.nama.trim()) { showToast("Nama material wajib diisi.","error"); return; }
    if (!f.qty || Number(f.qty) <= 0) { showToast("Qty fisik wajib diisi.","error"); return; }
    if (!f.lokasiId) { showToast("Lokasi (Gudang/Blok) wajib diisi.","error"); return; }
    if (!maraPicked && !maraSkip) { showToast("Cari & pilih kode MARA dulu, atau tap \"Tidak ada di MARA / lewati dulu\".","error"); return; }
    setTambahBusy(true);
    const newKatalog = await addNonStockFoundItem({
      opnameId: activeOpname.id,
      nama: f.nama.trim(),
      katalogCode: maraPicked?.kode_material || null,
      satuan: maraPicked?.satuan || f.satuan || "-",
      qty: Number(f.qty),
      lokasiId: f.lokasiId,
      foto: f.foto,
      belumDicocokkanMara: !maraPicked && maraSkip,
    });
    setTambahBusy(false);
    if (!newKatalog) return;
    setActiveOpname(prev => ({
      ...prev,
      items: [...(prev.items||[]), {
        katalogId: newKatalog.id, namaBarang: newKatalog.name, noKatalog: newKatalog.katalog,
        satuan: newKatalog.satuan, qtySistem: 0, qtsFisik: Number(f.qty), selisih: 0,
        statusItem: "MATERIAL_BARU_NONSAP", keterangan: "", lokasiId: f.lokasiId,
        fotoKeseluruhan: f.foto || null, belumDicocokkanMara: !maraPicked && maraSkip,
      }],
    }));
    setQrResult(newKatalog);
    if (activeQueueId) {
      setTambahQueue(q => q.map(item => item.id === activeQueueId ? { ...item, status: "DONE" } : item));
    }
    showToast(`✅ "${newKatalog.name}" tersimpan (${newKatalog.katalog})`);
  }

  function skipQueueItem(id) {
    setTambahQueue(q => q.map(item => item.id === id ? { ...item, status: "SKIP" } : item));
  }

  // Scan QR label material (Kartu Gantung TUG-2) untuk LOMPAT ke baris yang benar di tabel opname
  // ini — TIDAK mengisi qty otomatis, cuma navigasi. Angka hasil hitung fisik tetap wajib diketik
  // manual (aturan yang disepakati user 2026-07-07: scan bukan pengganti hitung fisik).
  function handleScanQty() {
    openScanner({ onDetect: (code) => {
      const items = activeOpname?.items || [];
      const scannedKatalogId = extractKatalogIdFromScan(code);
      let idx = scannedKatalogId ? items.findIndex(it => it.katalogId === scannedKatalogId) : -1;
      if (idx < 0) idx = items.findIndex(it => it.noKatalog && normalizeKatalog(it.noKatalog) === normalizeKatalog(code));
      if (idx < 0) { showToast(`Kode ${code} tidak ditemukan di daftar item opname ini`, "error"); return; }
      setPage(Math.floor(idx / pageSize));
      setHighlightIdx(idx);
      showToast(`📷 Ditemukan: ${items[idx].namaBarang} — ketik qty hasil hitung fisik.`);
      setTimeout(() => {
        const el = qtyInputRefs.current[idx];
        if (el) { el.focus(); el.scrollIntoView({behavior:"smooth", block:"center"}); }
      }, 50);
    }});
  }

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
      const kat = katalogByNo[sr.katalog];
      if(!kat) {
        items.push({
          katalogId: null, namaBarang: sr.nama, noKatalog: sr.katalog, satuan: sr.satuan,
          qtySistem: 0, qtySAP: sr.qty, qtsFisik: 0, selisih: 0,
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
      // Item "🆕 Material Baru" (dari SAP maupun temuan Non-SAP) tetap ditandai begitu walau
      // qty-nya diedit ulang — jangan sampai berubah jadi status SESUAI/SELISIH biasa cuma
      // karena user koreksi angka setelah simpan awal.
      const isMaterialBaru = ["TIDAK_ADA_DI_SISTEM","MATERIAL_BARU_NONSAP"].includes(items[realIdx].statusItem);
      if(field==="qtsFisik" && !isMaterialBaru) {
        items[realIdx].selisih = Number(value) - items[realIdx].qtySistem;
        items[realIdx].statusItem = items[realIdx].selisih===0?"SESUAI":"SELISIH";
      }
      return {...prev, items};
    });
  }

  function validate() {
    const errors = [];
    const isNonSapSession = activeOpname?.jenisAlur === "NON_SAP";
    (activeOpname.items||[]).forEach((item,i)=>{
      if(item.qtsFisik==null||item.qtsFisik==="") errors.push(`Baris ${i+1}: qty fisik belum diisi`);
      if(item.selisih!==0 && !item.keterangan?.trim()) errors.push(`Baris ${i+1} (${item.namaBarang}): keterangan wajib diisi jika ada selisih`);
      // Opname Non-SAP: lokasi WAJIB diisi untuk semua item (baseline maupun temuan baru) —
      // ini yang membuktikan opname fisik benar-benar dilakukan, bukan cuma isi qty dari kursi.
      if(isNonSapSession && !item.lokasiId) errors.push(`Baris ${i+1} (${item.namaBarang}): lokasi (Gudang/Blok) wajib diisi`);
    });
    setValidationErrors(errors);
    // Tombol Submit sekarang cuma ada di bawah tabel (setelah paginasi) — kalau validasi gagal
    // dan cuma diam-diam set state tanpa toast, dengan item ratusan baris user tidak akan sadar
    // submit-nya gagal (kotak error tampil di ATAS tabel, jauh di luar layar). Sesi jadi
    // nyangkut DRAFT selamanya tanpa penjelasan — persis kasus yang dilaporkan user 2026-07-07
    // ("tidak masuk ke approval asman").
    if (errors.length>0) {
      showToast(`❌ Belum bisa disubmit — ${errors.length} item belum lengkap (qty fisik/keterangan). Scroll ke atas untuk detail.`, "error");
      setPage(0);
      if (typeof window!=="undefined") window.scrollTo({top:0, behavior:"smooth"});
    }
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
    const totalPages = Math.ceil(items.length/pageSize);
    const pageItems = items.slice(page*pageSize, (page+1)*pageSize);
    const prog = getProgress();
    const selisihCount = items.filter(i=>i.selisih!==0).length;

    return (
      <div>
        {/* Header — cuma navigasi & judul. Tombol Simpan/Submit sengaja HANYA di bawah tabel
            (dulu sempat dobel atas+bawah, membingungkan user — keluhan 2026-07-07). */}
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:16}}>
          <div>
            <button style={{...sty.btn("ghost","sm"),marginBottom:6}} onClick={()=>{setActiveTab("list");setActiveOpname(null);}}>← Kembali ke Daftar</button>
            <h1 style={{fontSize:20,fontWeight:900}}>Stock Opname — {activeOpname.jenisAlur}</h1>
            <p style={{color:C.muted,fontSize:12}}>Semester {activeOpname.semester} • {activeOpname.kategori}</p>
          </div>
          {isReadOnly && activeOpname.status==="SELESAI" && (
            <button style={sty.btn("ghost")} onClick={()=>downloadBeritaAcara(activeOpname)}>📄 Download Berita Acara</button>
          )}
        </div>

        {/* Tambah Material Ditemukan + Upload Usulan Pencocokan — cuma Opname Non-SAP.
            Pola card biru + label sama persis dengan "Step 1: Upload File SAP" di bawah,
            supaya konsisten dengan menu Opname lain (keluhan user 2026-07-08). */}
        {!isSAP && !isReadOnly && (
          <>
            <div style={{...sty.card,marginBottom:14,background:"#eff6ff",border:`1px solid #bfdbfe`}}>
              <div style={{fontSize:12,fontWeight:800,color:"#1d4ed8",marginBottom:8}}>
                📋 Material Non-Stock yang Ditemukan
              </div>
              <div style={{display:"flex",flexDirection:"column",gap:8}}>
                <button style={{...sty.btn("primary"),width:"100%"}} onClick={()=>openTambahModal()}>
                  ➕ Tambah Material Ditemukan
                </button>
                <label style={{...sty.btn("ghost"),width:"100%",textAlign:"center",cursor:queueUploadBusy?"default":"pointer",opacity:queueUploadBusy?0.6:1}}>
                  {queueUploadBusy?"Memuat...":"📂 Upload Usulan Pencocokan"}
                  <input type="file" accept=".xlsx,.XLSX,.xls" style={{display:"none"}} onChange={handleUploadUsulan} disabled={queueUploadBusy}/>
                </label>
              </div>
              <div style={{fontSize:10,color:C.muted,marginTop:8}}>
                "Tambah Material" untuk barang yang belum pernah tercatat di mana pun. "Upload Usulan Pencocokan" untuk file review yang sudah disiapkan sebelumnya (kode MARA sudah dicocokkan, tinggal diverifikasi fisik).
              </div>
            </div>

            {/* Antrian dari file usulan — tiap baris tetap wajib direview manual (qty+lokasi
                diisi ulang saat itu), file cuma pre-fill nama & kandidat kode MARA-nya. */}
            {tambahQueue.length>0 && (
              <div style={{...sty.card,marginBottom:14,padding:12}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                  <div style={{fontSize:12,fontWeight:800}}>
                    📋 Antrian dari File ({tambahQueue.filter(q=>q.status==="DONE").length}/{tambahQueue.length} diproses)
                  </div>
                  <button title="Batalkan & tutup antrian ini" style={sty.btn("ghost","sm")} onClick={()=>{ if(window.confirm("Batalkan antrian ini? Baris yang belum diproses akan hilang dari daftar (material yang sudah tersimpan TIDAK ikut terhapus).")) setTambahQueue([]); }}>✕ Batal</button>
                </div>
                <div style={{fontSize:10,color:C.muted,marginBottom:10}}>
                  Qty di file ini data lama (AppSheet) — bukan angka final. Tetap wajib dihitung fisik ulang & isi lokasi tiap kali diproses.
                </div>
                <div style={{maxHeight:280,overflowY:"auto"}}>
                  {tambahQueue.map(q=>(
                    <div key={q.id} style={{display:"flex",alignItems:"center",gap:8,padding:"6px 8px",borderBottom:`1px solid ${C.border}`,opacity:q.status!=="PENDING"?0.5:1}}>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{fontSize:11,fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{q.nama}</div>
                        <div style={{fontSize:9,color:C.muted}}>
                          Katalog asli: {q.katalogAsli||"-"} • Qty file: {q.qtyFile||"-"} •{" "}
                          <span style={{fontWeight:700,color:q.skor==="KUAT"?"#166534":q.skor==="LEMAH"?"#92400e":"#991b1b"}}>{q.skor}</span>
                          {q.maraCode && ` (${q.maraCode})`}
                        </div>
                      </div>
                      {q.status==="PENDING" ? (
                        <div style={{display:"flex",gap:4,flexShrink:0}}>
                          <button style={sty.btn("primary","sm")} onClick={()=>openTambahModal(q)}>Proses</button>
                          <button style={sty.btn("ghost","sm")} onClick={()=>skipQueueItem(q.id)}>Lewati</button>
                        </div>
                      ) : (
                        <span style={{fontSize:10,fontWeight:700,color:q.status==="DONE"?C.green:C.muted,flexShrink:0}}>
                          {q.status==="DONE"?"✅ Selesai":"⏭️ Dilewati"}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {/* Upload CSV SAP */}
        {isSAP && !isReadOnly && (
          <div style={{...sty.card,marginBottom:14,background:"#eff6ff",border:`1px solid #bfdbfe`}}>
            <div style={{fontSize:12,fontWeight:800,color:"#1d4ed8",marginBottom:8}}>
              📂 Step 1: Upload File SAP
            </div>
            {/* Tombol berstyle, sama persis pola dengan Stock Count — dulu cuma <input type="file">
                polos tanpa styling di sini, beda tampilan dari upload SAP di tempat lain (keluhan
                user 2026-07-07: "samakan proses upload filenya agar user lebih familiar"). */}
            <label style={{...sty.btn("primary"),cursor:csvLoading?"default":"pointer",opacity:csvLoading?0.6:1}}>
              {csvLoading ? "Memproses..." : "📂 Upload CSV/XLSX SAP"}
              <input type="file" accept=".csv,.CSV,.xlsx,.XLSX,.xls" onChange={handleCSVUpload} disabled={csvLoading} style={{display:"none"}}/>
            </label>
            {activeOpname.sapUploadedAt && (
              <div style={{fontSize:11,color:C.green,marginTop:6}}>
                ✅ {activeOpname.totalRowsSAP} baris SAP dibaca • {items.length} item total • {fmtDate(activeOpname.sapUploadedAt)}
              </div>
            )}
            <div style={{fontSize:10,color:C.muted,marginTop:6}}>
              Format: CSV/XLSX export SAP MM (PEMAT_DDMMYYYY). Kolom yang dipakai: Material, Material Description, Base Unit of Measure, Unrestricted Use Stock, Valuation Type. Kalau file punya lebih dari 1 sheet dengan header sama, semua ikut terbaca.
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
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(80px,1fr))",gap:8,marginTop:10}}>
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
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:8,marginBottom:8,flexWrap:"wrap"}}>
                {!isReadOnly ? (
                  <div style={{display:"flex",alignItems:"center",gap:8}}>
                    <button style={sty.btn("ghost","sm")} onClick={handleScanQty}>📷 Scan QR untuk cari baris</button>
                    <span style={{fontSize:10,color:C.muted}}>Scan cuma membantu temukan & lompat ke barisnya — qty hasil hitung fisik tetap wajib diketik manual.</span>
                  </div>
                ) : <div/>}
                <div style={{display:"flex",alignItems:"center",gap:6,fontSize:11,color:C.muted}}>
                  Tampilkan:
                  {[10,20,50].map(n=>(
                    <button key={n} onClick={()=>{setPageSize(n);setPage(0);}}
                      style={{padding:"3px 9px",borderRadius:5,border:`1px solid ${pageSize===n?C.accent:C.border}`,background:pageSize===n?C.accent:"white",color:pageSize===n?"white":C.text,fontSize:11,fontWeight:pageSize===n?700:400,cursor:"pointer"}}>
                      {n}
                    </button>
                  ))}
                </div>
              </div>
              <table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
                <thead>
                  <tr style={{background:C.sidebar,color:"white"}}>
                    {!isMobile && <th style={{padding:"7px 8px",textAlign:"center",width:36}}>No</th>}
                    <th style={{padding:"7px 8px",textAlign:"left"}}>Nama Barang</th>
                    {!isMobile && <th style={{padding:"7px 8px",textAlign:"center"}}>No Katalog</th>}
                    <th style={{padding:"7px 8px",textAlign:"center"}}>Sat</th>
                    {!isMobile && <th style={{padding:"7px 8px",textAlign:"center"}}>Qty Sistem</th>}
                    {isSAP && <th style={{padding:"7px 8px",textAlign:"center"}}>Qty SAP</th>}
                    <th style={{padding:"7px 8px",textAlign:"center"}}>Qty Fisik</th>
                    <th style={{padding:"7px 8px",textAlign:"center"}}>Selisih</th>
                    <th style={{padding:"7px 8px",textAlign:"center"}}>Status</th>
                    {!isSAP && <th style={{padding:"7px 8px",textAlign:"center"}}>📍 Lokasi *</th>}
                    <th style={{padding:"7px 8px",textAlign:"left"}}>Keterangan</th>
                    <th style={{padding:"7px 8px",textAlign:"center"}}>📷 Foto</th>
                  </tr>
                </thead>
                <tbody>
                  {pageItems.map((item,pageIdx)=>{
                    const realIdx = page*pageSize + pageIdx;
                    const isHighlighted = highlightIdx===realIdx;
                    const rowBg = isHighlighted ? "#dbeafe" : item.statusItem==="MATERIAL_BARU_NONSAP" ? "#eff6ff" : item.statusItem==="SESUAI"?"white":item.statusItem==="TIDAK_ADA_DI_SISTEM"?"#fefce8":item.statusItem==="TIDAK_ADA_DI_SAP"?"#f8fafc":"#fff5f5";
                    const statusBadge = item.statusItem==="SESUAI"
                      ? {bg:"#dcfce7",fg:"#166534",label:"✅ Sesuai"}
                      : item.statusItem==="TIDAK_ADA_DI_SAP"
                      ? {bg:"#f3f4f6",fg:"#6b7280",label:"○ Tdk di SAP"}
                      : item.statusItem==="TIDAK_ADA_DI_SISTEM"
                      ? {bg:"#fef3c7",fg:"#92400e",label:"⚠️ Tdk di Sistem"}
                      : item.statusItem==="MATERIAL_BARU_NONSAP"
                      ? {bg:"#dbeafe",fg:"#1e40af",label:"🆕 Baru (Non-Stock)"}
                      : {bg:"#fee2e2",fg:"#991b1b",label:"🔴 Selisih"};
                    const itemGudangId = lokasiList?.find(l=>l.id===item.lokasiId)?.gudangId || "";
                    return (
                      <tr key={realIdx} style={{borderBottom:`1px solid ${C.border}`,background:rowBg,outline:isHighlighted?`2px solid #3b82f6`:"none"}}>
                        {!isMobile && <td style={{padding:"6px 8px",textAlign:"center",color:C.muted,fontSize:10}}>{realIdx+1}</td>}
                        <td style={{padding:"6px 8px",fontWeight:600,maxWidth:isMobile?120:200,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                          {item.namaBarang}
                          {item.statusItem==="TIDAK_ADA_DI_SISTEM" && (
                            <div style={{fontSize:9,fontWeight:700,color:"#92400e",whiteSpace:"normal"}}>🆕 Material baru — akan dibuatkan Master Katalog + Data Stok saat sesi ini disetujui Manager (kalau qty fisik diisi &gt;0)</div>
                          )}
                          {item.statusItem==="MATERIAL_BARU_NONSAP" && (
                            <div style={{fontSize:9,fontWeight:700,color:"#1e40af",whiteSpace:"normal"}}>🆕 Ditemukan saat opname — sudah aktif sebagai "Pending Approval", dikonfirmasi penuh saat Manager approve sesi ini.{item.belumDicocokkanMara && " ⚠️ Belum dicocokkan ke MARA."}</div>
                          )}
                        </td>
                        {!isMobile && <td style={{padding:"6px 8px",textAlign:"center",fontFamily:"monospace",fontSize:10}}>{item.noKatalog}</td>}
                        <td style={{padding:"6px 8px",textAlign:"center"}}>{item.satuan}</td>
                        {!isMobile && <td style={{padding:"6px 8px",textAlign:"center",fontWeight:600}}>{fmtNum(item.qtySistem)}</td>}
                        {isSAP && <td style={{padding:"6px 8px",textAlign:"center",color:item.qtySAP!=null?C.text:"#9ca3af"}}>{item.qtySAP!=null?fmtNum(item.qtySAP):"—"}</td>}
                        <td style={{padding:"4px 6px",textAlign:"center"}}>
                          {!isReadOnly
                            ? <input type="number" inputMode="decimal" min="0" value={item.qtsFisik} ref={el=>{qtyInputRefs.current[realIdx]=el;}}
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
                        {!isSAP && (
                          <td style={{padding:"4px 6px"}}>
                            {!isReadOnly ? (
                              <div style={{display:"flex",flexDirection:"column",gap:3}}>
                                <select value={itemGudangId} onChange={e=>{ updateItem(realIdx,"lokasiId",""); updateItem(realIdx,"_gudangTmp",e.target.value); }}
                                  style={{width:110,padding:"3px 4px",border:`1px solid ${C.border}`,borderRadius:4,fontSize:9}}>
                                  <option value="">-- Gudang --</option>
                                  {(gudangList||[]).map(g=><option key={g.id} value={g.id}>{g.kode||g.nama}</option>)}
                                </select>
                                <select value={item.lokasiId||""} onChange={e=>updateItem(realIdx,"lokasiId",e.target.value)}
                                  disabled={!itemGudangId && !item._gudangTmp}
                                  style={{width:110,padding:"3px 4px",border:`1px solid ${!item.lokasiId?C.red:C.border}`,borderRadius:4,fontSize:9}}>
                                  <option value="">-- Blok --</option>
                                  {(lokasiList||[]).filter(l=>l.gudangId===(itemGudangId||item._gudangTmp)).map(l=><option key={l.id} value={l.id}>{l.kode}</option>)}
                                </select>
                              </div>
                            ) : (
                              <span style={{fontSize:10}}>{lokasiList?.find(l=>l.id===item.lokasiId)?.kode || "-"}</span>
                            )}
                          </td>
                        )}
                        <td style={{padding:"4px 6px"}}>
                          {!isReadOnly
                            ? <input value={item.keterangan||""}
                                onChange={e=>updateItem(realIdx,"keterangan",e.target.value)}
                                placeholder={item.selisih!==0?"Wajib diisi...":"Opsional"}
                                style={{width:130,padding:"3px 6px",border:`1px solid ${item.selisih!==0&&!item.keterangan?C.red:C.border}`,borderRadius:4,fontSize:10}}/>
                            : <span style={{fontSize:10,color:C.muted}}>{item.keterangan||"-"}</span>}
                        </td>
                        <td style={{padding:"4px 6px"}}>
                          <div style={{display:"flex",gap:4,justifyContent:"center"}}>
                            {[["fotoKeseluruhan","🖼️","Foto Keseluruhan"],["fotoNameplate","🏷️","Foto Nameplate"]].map(([field,icon,label])=>(
                              <label key={field} title={label}
                                style={{width:28,height:28,borderRadius:5,border:`1px solid ${C.border}`,display:"flex",alignItems:"center",justifyContent:"center",cursor:isReadOnly?"default":"pointer",overflow:"hidden",background:item[field]?"transparent":"#f9fafb",flexShrink:0}}>
                                {item[field]
                                  ? <img src={item[field]} alt={label} style={{width:"100%",height:"100%",objectFit:"cover"}}/>
                                  : <span style={{fontSize:12,color:"#9ca3af"}}>{icon}</span>}
                                {!isReadOnly && (
                                  <input type="file" accept="image/*" capture="environment" style={{display:"none"}}
                                    onChange={e=>{
                                      const f=e.target.files[0]; if(!f) return;
                                      const r=new FileReader();
                                      r.onload=ev=>updateItem(realIdx,field,ev.target.result);
                                      r.readAsDataURL(f);
                                    }}/>
                                )}
                              </label>
                            ))}
                          </div>
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

            {/* Aksi Simpan/Submit — sengaja HANYA di sini (bawah tabel), bukan di header juga,
                supaya tidak dobel/membingungkan (keluhan user 2026-07-07). */}
            {!isReadOnly && (
              <div style={{display:"flex",justifyContent:"flex-end",gap:8,marginBottom:16}}>
                <button style={sty.btn("ghost")} onClick={()=>saveOpname(activeOpname)}>💾 Simpan Draft</button>
                <button style={{...sty.btn("primary"), opacity:prog.pct<100?0.5:1}}
                  onClick={async ()=>{
                    // BUG KRITIS (ditemukan 2026-07-07): dulu saveOpname(activeOpname) dan
                    // submitOpname(activeOpname) dipanggil beruntun TANPA menunggu satu sama lain.
                    // submitOpname sudah menulis SELURUH data opn (spread {...opn}) + status
                    // PENDING_ASMAN — saveOpname menulis objek yang SAMA tapi masih status DRAFT.
                    // Karena keduanya sync ke Supabase secara paralel (network, bukan lagi
                    // localStorage yang instan), race condition: kalau upsert dari saveOpname
                    // (DRAFT) selesai BELAKANGAN dari upsert submitOpname (PENDING_ASMAN), hasil
                    // akhir di database balik jadi DRAFT lagi — submit "hilang" diam-diam padahal
                    // toast sukses tetap muncul. Ini akar masalah sesi opname tidak pernah sampai
                    // ke approval Asman walau semua qty sudah lengkap. Fix: submitOpname saja
                    // (sudah mencakup semua yang dilakukan saveOpname), di-await, baru pindah tab.
                    if(!validate()) return;
                    await submitOpname(activeOpname);
                    setActiveTab("list"); setActiveOpname(null);
                  }}>
                  📋 Submit ke Asman
                </button>
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

        {/* MODAL: Tambah Material Ditemukan (Opname Non-SAP) — 1 layar per barang,
            cari kode MARA dulu, lalu isi qty/lokasi/foto, simpan langsung dapat QR untuk ditempel. */}
        {tambahModal && (
          <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000,padding:12}}>
            <div style={{...sty.card,width:420,maxWidth:"100%",maxHeight:"92vh",overflowY:"auto"}}>
              {qrResult ? (
                <>
                  <h3 style={{fontSize:16,fontWeight:800,marginBottom:14}}>🏷️ Label QR Siap Dicetak</h3>
                  {(() => {
                    const scanUrl = `${window.location.origin}/?scan=${encodeURIComponent(qrResult.id)}`;
                    const qrImgUrl = `https://api.qrserver.com/v1/create-qr-code/?size=260x260&data=${encodeURIComponent(scanUrl)}`;
                    return (
                      <div style={{border:`3px solid ${C.accent}`,borderRadius:10,padding:16,background:"white",textAlign:"center",marginBottom:14}}>
                        <img src={qrImgUrl} alt="QR" width={160} height={160} style={{display:"block",margin:"0 auto"}}/>
                        <div style={{fontSize:13,fontWeight:800,marginTop:10}}>{qrResult.name}</div>
                        <div style={{fontSize:11,color:C.muted,marginTop:4}}>Kode: {qrResult.katalog}</div>
                        <span style={{display:"inline-block",marginTop:8,padding:"3px 10px",borderRadius:20,fontSize:10,fontWeight:700,background:"#dbeafe",color:"#1e40af"}}>Non-Stock — Pending Approval</span>
                      </div>
                    );
                  })()}
                  <div style={{fontSize:11,color:C.muted,textAlign:"center",marginBottom:16}}>
                    Screenshot/print gambar QR di atas, tempel ke barang fisik sekarang juga.
                  </div>
                  <button style={{...sty.btn("primary"),width:"100%",marginBottom:8}} onClick={()=>{ setTambahModal(false); setQrResult(null); setActiveQueueId(null); }}>
                    ➡️ Lanjut ke Material Berikutnya
                  </button>
                  <button style={{...sty.btn("ghost"),width:"100%"}} onClick={()=>setQrResult(null)}>← Lihat Ulang Form</button>
                </>
              ) : (
                <>
                  <h3 style={{fontSize:16,fontWeight:800,marginBottom:14}}>➕ Tambah Material Ditemukan</h3>
                  {activeQueueId && (() => {
                    const q = tambahQueue.find(x=>x.id===activeQueueId);
                    return q ? (
                      <div style={{background:"#eff6ff",border:"1px solid #bfdbfe",borderRadius:8,padding:10,marginBottom:12,fontSize:11}}>
                        📋 Dari file usulan — Katalog asli AppSheet: <b>{q.katalogAsli||"-"}</b>, Qty file (data lama, cek ulang fisik): <b>{q.qtyFile||"-"}</b>
                      </div>
                    ) : null;
                  })()}
                  <div style={{marginBottom:10}}>
                    <label style={sty.label}>Nama Material *</label>
                    <input style={sty.input} value={tambahForm.nama} onChange={e=>{setTambahForm(f=>({...f,nama:e.target.value})); searchMaraForOpname(e.target.value);}} placeholder="Ketik nama, sistem cari otomatis ke MARA..."/>
                  </div>
                  {maraLoading && <div style={{fontSize:11,color:C.muted,marginBottom:8}}>Mencari ke MARA...</div>}
                  {!maraPicked && maraResults.length>0 && (
                    <div style={{border:`1px solid ${C.border}`,borderRadius:8,marginBottom:10,maxHeight:160,overflowY:"auto"}}>
                      {maraResults.map(r=>(
                        <div key={r.kode_material} onClick={()=>{setMaraPicked(r); setMaraResults([]); setMaraSkip(false);}}
                          style={{padding:"6px 8px",fontSize:11,borderBottom:`1px solid ${C.border}`,cursor:"pointer"}}>
                          <b>{r.kode_material}</b> — {r.nama} ({r.satuan})
                        </div>
                      ))}
                    </div>
                  )}
                  {maraPicked ? (
                    <div style={{background:"#f0fdf4",border:"1px solid #86efac",borderRadius:8,padding:10,marginBottom:10,fontSize:11}}>
                      ✅ Dipilih: <b>{maraPicked.kode_material}</b> — {maraPicked.nama}
                      <button style={{...sty.btn("ghost","sm"),marginLeft:8}} onClick={()=>setMaraPicked(null)}>Ganti</button>
                    </div>
                  ) : (
                    <button style={{...sty.btn(maraSkip?"primary":"ghost","sm"),width:"100%",marginBottom:10}} onClick={()=>setMaraSkip(true)}>
                      ⏭️ Tidak ada di MARA / lewati dulu (kode sementara dibuat otomatis)
                    </button>
                  )}
                  {!maraPicked && (
                    <div style={{marginBottom:10}}>
                      <label style={sty.label}>Satuan {maraSkip?"*":""}</label>
                      <input style={sty.input} value={tambahForm.satuan} onChange={e=>setTambahForm(f=>({...f,satuan:e.target.value}))} placeholder="cth: BH, M, SET"/>
                    </div>
                  )}
                  <div style={{marginBottom:10}}>
                    <label style={sty.label}>Qty Fisik *</label>
                    <input type="number" inputMode="decimal" min="0" style={sty.input} value={tambahForm.qty} onChange={e=>setTambahForm(f=>({...f,qty:e.target.value}))}/>
                  </div>
                  <div style={{marginBottom:10}}>
                    <label style={sty.label}>Gudang *</label>
                    <select style={sty.select} value={tambahForm.gudangId} onChange={e=>setTambahForm(f=>({...f,gudangId:e.target.value,lokasiId:""}))}>
                      <option value="">-- Pilih Gudang --</option>
                      {(gudangList||[]).map(g=><option key={g.id} value={g.id}>{g.kode||g.nama}</option>)}
                    </select>
                  </div>
                  <div style={{marginBottom:10}}>
                    <label style={sty.label}>Blok Lokasi *</label>
                    <select style={sty.select} value={tambahForm.lokasiId} onChange={e=>setTambahForm(f=>({...f,lokasiId:e.target.value}))} disabled={!tambahForm.gudangId}>
                      <option value="">-- Pilih Blok --</option>
                      {(lokasiList||[]).filter(l=>l.gudangId===tambahForm.gudangId).map(l=><option key={l.id} value={l.id}>{l.kode}</option>)}
                    </select>
                  </div>
                  <div style={{marginBottom:14}}>
                    <label style={sty.label}>📷 Foto Barang</label>
                    <label style={{...sty.btn("ghost"),display:"block",textAlign:"center",cursor:"pointer"}}>
                      {tambahForm.foto ? "✅ Foto sudah diambil (tap untuk ganti)" : "📷 Ambil Foto"}
                      <input type="file" accept="image/*" capture="environment" style={{display:"none"}}
                        onChange={e=>{ const f=e.target.files[0]; if(!f) return; const r=new FileReader(); r.onload=ev=>setTambahForm(fm=>({...fm,foto:ev.target.result})); r.readAsDataURL(f); }}/>
                    </label>
                    {tambahForm.foto && <img src={tambahForm.foto} alt="preview" style={{width:"100%",maxHeight:160,objectFit:"cover",borderRadius:8,marginTop:8}}/>}
                  </div>
                  <div style={{display:"flex",gap:10}}>
                    <button style={{...sty.btn("ghost"),flex:1}} onClick={()=>{setTambahModal(false);setActiveQueueId(null);}} disabled={tambahBusy}>Batal</button>
                    <button style={{...sty.btn("primary"),flex:2,opacity:tambahBusy?0.6:1}} onClick={submitTambahMaterial} disabled={tambahBusy}>{tambahBusy?"Menyimpan...":"💾 Simpan & Lihat QR"}</button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── LIST VIEW ────────────────────────────────────────────────────────────
  const pendingForMe = opnameList.filter(o=>
    (o.status==="PENDING_ASMAN"&&hasRole(currentUser, "ASMAN"))||
    (o.status==="PENDING_MANAGER"&&hasRole(currentUser, "MANAGER"))
  );

  return (
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
        <div>
          <h1 style={{fontSize:22,fontWeight:900}}>📋 Stock Opname</h1>
          <p style={{color:C.muted,fontSize:13}}>Dilakukan 1× per semester — bandingkan data sistem vs lapangan & SAP</p>
        </div>
        {hasRole(currentUser, "ADMIN","TL") && (
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
                {opn.status==="DRAFT" && hasRole(currentUser, "ADMIN","TL") && <button title="Hapus sesi opname" style={sty.btn("danger","sm")} onClick={()=>deleteOpname(opn.id)}>🗑️</button>}
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
              <tr style={{background:C.sidebar,color:"white"}}>
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
function HeavyEquipmentTabV2({ equipmentList, loans, currentUser, users, sty, C, handleImg, saveEdit, createLoan, approveLoan, rejectLoan, completeLoan, showToast }) {
  const appUptShort = (typeof UPT !== "undefined" ? UPT : "").replace(/^UPT\s+/i, "").trim();
  const myUpt = currentUser?.upt || currentUser?.uptName || appUptShort || "";
  const isMSB = hasRole(currentUser, "MSB","Manager UIT");
  // Dulu 2 sub-tab terpisah ("List Alat" vs "Peminjaman & Histori") dengan filter UPT yang
  // di-reset kontradiktif tiap pindah tab (list pakai UPT sendiri, loans di-reset ke "Semua UPT"
  // padahal unifiedLoans-nya sendiri tidak pernah benar-benar difilter UPT) — digabung jadi 1
  // halaman tunggal (permintaan user 2026-07-06). `effectiveUptFilter` jadi SATU sumber kebenaran
  // scoping: non-MSB dikunci ke UPT sendiri (tidak bisa diubah — mereka cuma boleh urus UPT-nya),
  // MSB/Manager UIT tetap bebas pilih "Semua UPT" atau fokus ke 1 UPT tertentu via dropdown.
  const [myUptSelected, setMyUptSelected] = useState(isMSB ? "" : (myUpt || ""));
  const effectiveUptFilter = isMSB ? myUptSelected : (myUpt || "");
  const [categoryFilter, setCategoryFilter] = useState("ALL");
  const [kondisiFilter, setKondisiFilter] = useState("ALL");
  const [loanCategoryFilter, setLoanCategoryFilter] = useState("ALL");
  const [loanForm, setLoanForm] = useState({equipmentId:"", requesterUpt:myUpt||"", namaPekerjaan:"", tanggalAmbil:"", tanggalKembali:"", keperluan:"", catatan:""});
  const [rejectingId, setRejectingId] = useState(null);
  const [reason, setReason] = useState("");
  const [editingEquipment, setEditingEquipment] = useState(null);
  const [editForm, setEditForm] = useState({statusAlat:"LAYAK", foto:null});

  const normalizedLoans = loans.map(l=>({
    ...l,
    ownerUpt:getHeavyEquipmentLoanOwnerUpt(l),
    requesterUpt:getHeavyEquipmentLoanRequesterUpt(l),
    tanggalAmbil:getHeavyEquipmentLoanStartDate(l),
    tanggalKembali:getHeavyEquipmentLoanReturnDate(l),
    namaPekerjaan:getHeavyEquipmentLoanJobName(l),
    runtimeStatus:getHeavyEquipmentLoanRuntimeStatus(l),
  })).sort((a,b)=>(b.requestedAt||0)-(a.requestedAt||0));
  // Loan yang MENYANGKUT UPT yang sedang di-scope (pemilik ATAU peminjam) — dulu tidak ada
  // filter UPT sama sekali di sini, jadi peminjaman antar 2 UPT lain (sama sekali tidak
  // melibatkan UPT Surabaya) ikut nongol ke semua orang yang buka menu ini. Dipakai untuk
  // Overdue panel, KPI ringkasan, dan Peminjaman & Histori sekaligus supaya konsisten.
  const scopedLoans = normalizedLoans.filter(l => !effectiveUptFilter || l.ownerUpt===effectiveUptFilter || l.requesterUpt===effectiveUptFilter);
  const uptOptions = Array.from(new Set([
    ...equipmentList.map(e=>e.upt),
    ...normalizedLoans.map(l=>l.ownerUpt),
    ...normalizedLoans.map(l=>l.requesterUpt),
  ].filter(Boolean))).sort();
  const canManage = hasRole(currentUser, "ADMIN","TL");
  // Ajukan Peminjaman = "kita mau pinjam alat", jadi alat yang ditawarkan HARUS di luar UPT
  // sendiri (non-MSB) — pinjam alat sendiri lewat form sendiri tidak masuk akal. MSB/Manager UIT
  // memfasilitasi peminjaman UPT mana pun, jadi tetap lihat semua alat.
  const borrowableEquipment = equipmentList.filter(e => e.availabilityStatus!=="DIPINJAM" && !["MAINTENANCE","KIR"].includes(e.statusAlat) && (isMSB || e.upt!==myUpt));
  const selectedEquipment = equipmentList.find(e=>e.id===loanForm.equipmentId);
  const requesterOptions = selectedEquipment ? uptOptions.filter(u=>u!==selectedEquipment.upt) : uptOptions;
  const pendingCount = scopedLoans.filter(isPendingHeavyEquipmentLoan).length;
  const dipinjamCount = scopedLoans.filter(l=>l.runtimeStatus==="DIPINJAM").length;
  const overdueCount = scopedLoans.filter(l=>l.runtimeStatus==="OVERDUE").length;
  const issueCount = equipmentList.filter(e=>["PERLU_SERVICE","RUSAK"].includes(e.statusAlat)).length;
  const availableCount = equipmentList.filter(e=>e.availabilityStatus!=="DIPINJAM" && !["MAINTENANCE","KIR"].includes(e.statusAlat)).length;
  const maintenanceCount = equipmentList.filter(e=>e.statusAlat==="MAINTENANCE").length;

  // 5 status alat yang bisa dipilih Admin/TL lewat tombol Edit Alat
  const STATUS_ALAT_OPTIONS = [
    {value:"LAYAK", label:"Layak"},
    {value:"MAINTENANCE", label:"Maintenance"},
    {value:"PERLU_SERVICE", label:"Perlu Servis"},
    {value:"RUSAK", label:"Rusak"},
    {value:"KIR", label:"Sedang KIR"},
  ];

  const statusMeta = {
    LAYAK:{label:"Layak", bg:"#dcfce7", fg:C.green},
    PERLU_SERVICE:{label:"Perlu Servis", bg:"#fef3c7", fg:"#92400e"},
    RUSAK:{label:"Rusak", bg:"#fee2e2", fg:C.red},
    KIR:{label:"Sedang KIR", bg:"#dbeafe", fg:"#1d4ed8"},
    TERSEDIA:{label:"Tersedia", bg:"#e0f2fe", fg:"#0369a1"},
    DIPINJAM:{label:"Dipinjam", bg:"#ffedd5", fg:"#c2410c"},
    MAINTENANCE:{label:"Maintenance", bg:"#e5e7eb", fg:"#4b5563"},
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
    (!effectiveUptFilter || e.upt===effectiveUptFilter) &&
    (categoryFilter==="ALL" || getEquipmentCategory(e)===categoryFilter) &&
    (kondisiFilter==="ALL" || e.statusAlat===kondisiFilter || (kondisiFilter==="DIPINJAM" && !!activeLoanForEquipment(e.id)))
  );
  const unifiedLoans = scopedLoans
    .filter(l=>(loanCategoryFilter==="ALL"||getEquipmentCategory(equipmentList.find(e=>e.id===l.equipmentId)||{})===loanCategoryFilter))
    .sort((a,b)=>(b.requestedAt||0)-(a.requestedAt||0));


  async function submitLoan() {
    await createLoan(loanForm);
    setLoanForm({equipmentId:"", requesterUpt:myUpt||"", namaPekerjaan:"", tanggalAmbil:"", tanggalKembali:"", keperluan:"", catatan:""});
  }

  // Kondisi overview data
  const kondisiGroups = [
    {id:"ALL",      label:"Semua Alat",     color:C.accent,   count:equipmentList.filter(e=>!effectiveUptFilter||e.upt===effectiveUptFilter).length},
    {id:"LAYAK",    label:"Layak",          color:C.green,    count:equipmentList.filter(e=>(!effectiveUptFilter||e.upt===effectiveUptFilter)&&e.statusAlat==="LAYAK").length},
    {id:"DIPINJAM", label:"Dipinjam",       color:"#c2410c",  count:equipmentList.filter(e=>(!effectiveUptFilter||e.upt===effectiveUptFilter)&&activeLoanForEquipment(e.id)).length},
    {id:"MAINTENANCE", label:"Maintenance", color:"#4b5563",  count:equipmentList.filter(e=>(!effectiveUptFilter||e.upt===effectiveUptFilter)&&e.statusAlat==="MAINTENANCE").length},
    {id:"KIR",      label:"Sedang KIR",     color:"#1d4ed8",  count:equipmentList.filter(e=>(!effectiveUptFilter||e.upt===effectiveUptFilter)&&e.statusAlat==="KIR").length},
    {id:"PERLU_SERVICE", label:"Perlu Servis", color:"#f59e0b", count:equipmentList.filter(e=>(!effectiveUptFilter||e.upt===effectiveUptFilter)&&e.statusAlat==="PERLU_SERVICE").length},
    {id:"RUSAK",    label:"Rusak",          color:C.red,      count:equipmentList.filter(e=>(!effectiveUptFilter||e.upt===effectiveUptFilter)&&e.statusAlat==="RUSAK").length},
  ].filter(g=>g.id==="ALL"||g.count>0);

  return (
    <div>
      {/* Header */}
      <h1 style={{fontSize:20,fontWeight:900,marginBottom:12}}>🚜 Alat Berat & Peminjaman UPT</h1>

      {/* Blok khusus Overdue — sekarang discope ke UPT yang sedang di-scope (dulu tidak difilter
          UPT sama sekali, jadi overdue milik UPT lain ikut nongol & bisa "Ditandai Kembali" oleh
          Admin/TL/Asman Surabaya yang tidak ada urusan sama sekali — keluhan user 2026-07-06). */}
      {overdueCount > 0 && (
        <div style={{...sty.card,marginBottom:12,borderLeft:`4px solid ${C.red}`,background:"#fef2f2"}}>
          <div style={{fontWeight:800,fontSize:14,marginBottom:10,color:C.red}}>⚠️ Alat Berat Overdue ({overdueCount})</div>
          {scopedLoans.filter(l=>l.runtimeStatus==="OVERDUE").map(l=>{
            const eq = equipmentList.find(e=>e.id===l.equipmentId);
            const pemohon = users.find(u=>u.id===l.requestedBy);
            return (
              <div key={l.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"8px 0",borderBottom:`1px solid ${C.border}`,gap:10,flexWrap:"wrap"}}>
                <div>
                  <div style={{fontSize:12,fontWeight:700}}>{eq?.nama||l.equipmentId} • {l.ownerUpt} → {l.requesterUpt}</div>
                  <div style={{fontSize:11,color:C.muted}}>Rencana kembali: {l.tanggalKembali||"-"} • {l.namaPekerjaan||"-"} • Diajukan oleh {pemohon?.name||"?"}</div>
                </div>
                {hasRole(currentUser, "ADMIN","TL","ASMAN") && (
                  <button style={sty.btn("success","sm")} onClick={()=>completeLoan(l.id)}>Tandai Kembali</button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Filter UPT — MSB/Manager UIT bebas pilih (mengelola banyak UPT), role lain dikunci ke
          UPT sendiri (tidak ada dropdown, tidak bisa diubah — permintaan user 2026-07-06). */}
      {isMSB ? (
        <div style={{display:"flex",gap:10,alignItems:"flex-end",flexWrap:"wrap",marginBottom:12}}>
          <div style={{minWidth:180}}>
            <label style={{...sty.label,marginBottom:3}}>Filter UPT</label>
            <select style={sty.select} value={myUptSelected} onChange={e=>setMyUptSelected(e.target.value)}>
              <option value="">Semua UPT</option>
              {uptOptions.map(u=><option key={u} value={u}>{u}</option>)}
            </select>
          </div>
          <div style={{fontSize:12,color:C.muted,paddingBottom:6}}>
            {myUptSelected ? <>Alat & peminjaman <b style={{color:C.accent}}>{myUptSelected}</b></> : "Menampilkan semua UPT"}
          </div>
        </div>
      ) : (
        <div style={{fontSize:12,color:C.muted,marginBottom:12}}>
          Menampilkan alat & peminjaman <b style={{color:C.accent}}>UPT {myUpt||"Surabaya"}</b>
        </div>
      )}

      {/* Ringkasan KPI — dulu cuma muncul di tab "Peminjaman & Histori", sekarang selalu tampil
          di atas (1 halaman tunggal, tidak ada tab lagi). */}
      <div style={{display:"flex",gap:16,flexWrap:"wrap",marginBottom:14,padding:"9px 14px",background:"#f8fafc",borderRadius:10,border:`1px solid ${C.border}`,fontSize:12,alignItems:"center"}}>
        {(()=>{
          const base = equipmentList.filter(e=>!effectiveUptFilter||e.upt===effectiveUptFilter);
          const maint = base.filter(e=>["MAINTENANCE","KIR"].includes(e.statusAlat)).length;
          const avail = base.filter(e=>!activeLoanForEquipment(e.id) && !["MAINTENANCE","KIR"].includes(e.statusAlat)).length;
          const pinjam = base.filter(e=>{ const l=activeLoanForEquipment(e.id); return l&&l.runtimeStatus==="DIPINJAM"; }).length;
          return [
            {label:"Total Alat",val:base.length,color:C.accent},
            {label:"Tersedia",val:avail,color:C.green},
            {label:"Dipinjam",val:pinjam,color:"#c2410c"},
            {label:"Maintenance/KIR",val:maint,color:maint?"#4b5563":C.muted},
            {label:"Overdue",val:overdueCount,color:overdueCount?C.red:C.muted},
            {label:"Pending Approval",val:pendingCount,color:pendingCount?"#92400e":C.muted},
          ].map(k=>(
            <div key={k.label} style={{display:"flex",alignItems:"baseline",gap:4}}>
              <span style={{color:C.muted}}>{k.label}:</span>
              <span style={{fontWeight:900,fontSize:14,color:k.color}}>{k.val}</span>
            </div>
          ));
        })()}
      </div>

      {/* Overview kondisi — clickable chips, filter grid "Daftar Alat Berat" di bawah */}
      <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:16}}>
        {kondisiGroups.map(g=>{
          const active = kondisiFilter===g.id;
          return (
            <button key={g.id} onClick={()=>setKondisiFilter(g.id)}
              style={{display:"flex",alignItems:"center",gap:6,padding:"6px 14px",borderRadius:20,border:`2px solid ${active?g.color:C.border}`,background:active?g.color:"white",color:active?"white":g.color,fontWeight:700,fontSize:12,cursor:"pointer",boxShadow:active?"0 2px 8px rgba(0,0,0,.12)":"none"}}>
              <span style={{fontWeight:900,fontSize:14}}>{g.count}</span>
              <span>{g.label}</span>
            </button>
          );
        })}
      </div>

      {/* ── SECTION: Daftar Alat Berat ── */}
      <h2 style={{fontSize:14,fontWeight:900,color:C.muted,textTransform:"uppercase",letterSpacing:1,marginBottom:10}}>🚜 Daftar Alat Berat</h2>
      <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:10}}>
        {EQUIPMENT_CATEGORIES.map(cat=>{
          const active = categoryFilter===cat.id;
          const count = equipmentList.filter(e=>
            (!effectiveUptFilter||e.upt===effectiveUptFilter)&&
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
      <div style={{fontSize:11,color:C.muted,marginBottom:10}}>
        Menampilkan <b style={{color:C.text}}>{filteredEquipment.length}</b> alat
        {kondisiFilter!=="ALL"&&<span> • Kondisi: <b style={{color:C.accent}}>{kondisiGroups.find(g=>g.id===kondisiFilter)?.label}</b></span>}
        {categoryFilter!=="ALL"&&<span> • Kategori: <b style={{color:C.accent}}>{EQUIPMENT_CATEGORIES.find(c=>c.id===categoryFilter)?.label}</b></span>}
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(300px,1fr))",gap:12,marginBottom:24}}>
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
              {["MAINTENANCE","KIR"].includes(eq.statusAlat) && <div style={{background:"#f3f4f6",border:`1px solid ${C.border}`,borderRadius:8,padding:10,fontSize:11,lineHeight:1.5}}><div style={{fontWeight:900,color:"#4b5563"}}>{eq.statusAlat==="KIR"?"🔵 Sedang KIR":"🔧 Sedang Maintenance"}</div><div style={{color:C.muted}}>Tidak bisa dipinjam UPT lain sampai statusnya berubah.</div></div>}
              {lastLoan && <div style={{fontSize:11,color:C.muted,borderTop:`1px solid ${C.border}`,paddingTop:8}}>Terakhir dipinjam oleh <b>{lastLoan.requesterUpt || "-"}</b> untuk pekerjaan <b>{lastLoan.namaPekerjaan || "-"}</b>.</div>}
              {canManage && <button style={sty.btn("ghost","sm")} onClick={()=>{setEditingEquipment(eq.id);setEditForm({statusAlat:eq.statusAlat||"LAYAK", foto:eq.foto||null});}}>✏️ Edit Alat</button>}
            </div>
          );
        })}
      </div>

      {/* ── SECTION: Ajukan Peminjaman + Peminjaman & Histori ── */}
      <h2 style={{fontSize:14,fontWeight:900,color:C.muted,textTransform:"uppercase",letterSpacing:1,marginBottom:10}}>📜 Peminjaman & Histori</h2>
      <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:14}}>
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

      <div style={{display:"grid",gridTemplateColumns:canManage?"minmax(260px,300px) 1fr":"1fr",gap:14,alignItems:"start"}}>

        {/* Form ajukan (Admin/TL only) — alat yang ditawarkan HARUS di luar UPT sendiri untuk
            role non-MSB (Surabaya selalu peminjam di form ini, lihat borrowableEquipment). */}
        {canManage && (
          <div style={sty.card}>
            <div style={{fontSize:13,fontWeight:900,marginBottom:10}}>Ajukan Peminjaman</div>
            <div style={{marginBottom:8}}>
              <label style={sty.label}>Alat {!isMSB && <span style={{fontWeight:400,color:C.muted}}>(di luar UPT {myUpt||"Surabaya"})</span>}</label>
              <select style={sty.select} value={loanForm.equipmentId} onChange={e=>setLoanForm(f=>({...f,equipmentId:e.target.value,requesterUpt:isMSB?"":(myUpt||"")}))}>
                <option value="">-- Pilih alat --</option>
                {borrowableEquipment.map(e=><option key={e.id} value={e.id}>{e.upt} — {e.nama} ({e.kapasitas||"-"})</option>)}
              </select>
              {selectedEquipment&&<div style={{fontSize:10,color:C.muted,marginTop:3}}>Pemilik: <b>{selectedEquipment.upt}</b></div>}
            </div>
            <div style={{marginBottom:8}}>
              <label style={sty.label}>UPT Peminjam</label>
              {isMSB ? (
                <select style={sty.select} value={loanForm.requesterUpt} onChange={e=>setLoanForm(f=>({...f,requesterUpt:e.target.value}))}>
                  <option value="">-- Pilih UPT --</option>
                  {requesterOptions.map(u=><option key={u} value={u}>{u}</option>)}
                </select>
              ) : (
                <div style={{...sty.input,background:"#f3f4f6",color:C.muted,display:"flex",alignItems:"center"}}>UPT {myUpt||"Surabaya"}</div>
              )}
            </div>
            <div style={{marginBottom:8}}><label style={sty.label}>Nama Pekerjaan</label><input style={sty.input} value={loanForm.namaPekerjaan} onChange={e=>setLoanForm(f=>({...f,namaPekerjaan:e.target.value}))} placeholder="Contoh: Penggantian PMT Bay Trafo 1"/></div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6,marginBottom:8}}><div><label style={sty.label}>Tgl Ambil</label><input style={sty.input} type="date" value={loanForm.tanggalAmbil} onChange={e=>setLoanForm(f=>({...f,tanggalAmbil:e.target.value}))}/></div><div><label style={sty.label}>Tgl Kembali</label><input style={sty.input} type="date" value={loanForm.tanggalKembali} onChange={e=>setLoanForm(f=>({...f,tanggalKembali:e.target.value}))}/></div></div>
            <div style={{marginBottom:8}}><label style={sty.label}>Keperluan</label><textarea style={{...sty.input,minHeight:60}} value={loanForm.keperluan} onChange={e=>setLoanForm(f=>({...f,keperluan:e.target.value}))}/></div>
            <div style={{marginBottom:10}}><label style={sty.label}>Catatan</label><input style={sty.input} value={loanForm.catatan} onChange={e=>setLoanForm(f=>({...f,catatan:e.target.value}))}/></div>
            <button style={{...sty.btn("primary"),width:"100%"}} onClick={submitLoan}>Ajukan Peminjaman</button>
          </div>
        )}

        {/* Unified loan list: aktif + histori, discope ke UPT yang sedang aktif, newest first */}
        <div>
          <div style={{fontSize:12,fontWeight:800,color:C.muted,textTransform:"uppercase",letterSpacing:1,marginBottom:8}}>
            {isMSB && !myUptSelected ? "Peminjaman & Histori — Semua UPT" : `Peminjaman & Histori — UPT ${effectiveUptFilter||myUpt||"Surabaya"}`}
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
                  {isActive&&["DIPINJAM","OVERDUE"].includes(loan.runtimeStatus)&&hasRole(currentUser, "ADMIN","TL","ASMAN")&&(
                    <button style={{...sty.btn("ghost","sm"),marginTop:6}} onClick={()=>completeLoan(loan.id)}>Tandai Kembali</button>
                  )}
                  {["DIPINJAM","OVERDUE","SELESAI"].includes(loan.runtimeStatus) && (
                    <button style={{...sty.btn("ghost","sm"),marginTop:6,marginLeft:isActive&&["DIPINJAM","OVERDUE"].includes(loan.runtimeStatus)&&hasRole(currentUser, "ADMIN","TL","ASMAN")?6:0}} onClick={()=>downloadHeavyEquipmentLoanHTML(loan, eq, users, showToast)}>📄 Cetak Dokumen</button>
                  )}
                </div>
              );
            })}
          </div>
        </div>

      </div>

      {/* MODAL EDIT ALAT — status alat + upload foto sekaligus, Admin/TL saja */}
      {editingEquipment && (()=>{
        const eq = equipmentList.find(e=>e.id===editingEquipment);
        if (!eq) return null;
        return (
          <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000,padding:16}}>
            <div style={{...sty.card,width:420,maxWidth:"100%",maxHeight:"90vh",overflowY:"auto"}}>
              <h3 style={{fontSize:16,fontWeight:800,marginBottom:4}}>✏️ Edit Alat</h3>
              <div style={{fontSize:12,color:C.muted,marginBottom:16}}>{eq.nama} — {eq.upt}</div>
              <div style={{height:150,borderRadius:10,background:"#f3f4f6",border:`1px solid ${C.border}`,overflow:"hidden",display:"flex",alignItems:"center",justifyContent:"center",marginBottom:12}}>
                {editForm.foto ? <img src={editForm.foto} alt={eq.nama} style={{width:"100%",height:"100%",objectFit:"cover"}}/> : <div style={{fontSize:38,color:"#9ca3af"}}>🚜</div>}
              </div>
              <label style={{...sty.btn("ghost","sm"),textAlign:"center",display:"block",marginBottom:16}}>
                📷 {editForm.foto?"Ganti Foto":"Upload Foto"}
                <input type="file" accept="image/*" capture="environment" style={{display:"none"}} onChange={e=>handleImg(e, img=>setEditForm(f=>({...f,foto:img})))}/>
              </label>
              <div style={{marginBottom:16}}>
                <label style={sty.label}>Status Alat</label>
                <select style={sty.select} value={editForm.statusAlat} onChange={e=>setEditForm(f=>({...f,statusAlat:e.target.value}))}>
                  {STATUS_ALAT_OPTIONS.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
                {["MAINTENANCE","KIR"].includes(editForm.statusAlat) && <div style={{fontSize:10,color:C.muted,marginTop:4}}>⚠️ Alat tidak bisa dipinjam UPT lain selama status ini.</div>}
                {eq.availabilityStatus==="DIPINJAM" && ["MAINTENANCE","KIR"].includes(editForm.statusAlat) && <div style={{fontSize:10,color:C.red,marginTop:4}}>Alat sedang dipinjam — tidak bisa diubah ke status ini sampai kembali.</div>}
              </div>
              <div style={{display:"flex",gap:10}}>
                <button style={{...sty.btn("ghost"),flex:1}} onClick={()=>setEditingEquipment(null)}>Batal</button>
                <button style={{...sty.btn("primary"),flex:2}} onClick={async()=>{await saveEdit(eq.id, editForm);setEditingEquipment(null);}}>💾 Simpan</button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

// AttbTab — pipeline monitoring penghapusan aset material ATTB, lihat docs/ATTB_SPEC.md.
// Pola konsisten HeavyEquipmentTabV2: chip filter + kartu, scoping UPT via effectiveUptFilter.
function AttbTab({ attbList, currentUser, users, sty, C, createItem, saveEdit, submitToKI, approveToKI, rejectToKI, advanceStage, markBelumLanjut, bulkImport, showToast, gudangList=[], subGudangList=[], lokasiList=[], setPetaMiniDetail, deleteItem, askConfirmDelete, bongkaranPool=[], handleImg }) {
  const canDelete = hasRole(currentUser, "ADMIN");
  // Key TUG-10 yang sudah "diusulkan" jadi item ATTB (untuk tandai pool yg sudah dipakai).
  const promotedKeys = new Set(attbList.map(a=>a.sourceTug10Key).filter(Boolean));
  const bongkaranBelum = bongkaranPool.filter(p=>!promotedKeys.has(p.key));
  // Batalkan tanda "Belum Lanjut" (lanjutkan lagi, tetap di tahap yang sama).
  async function resumeBelumLanjut(item) { await saveEdit(item.id, { lanjutBelumLanjut:false, keteranganTidakLanjut:"" }); }
  // Usulkan 1 material bongkaran (dari pool TUG-10) menjadi kandidat ATTB Tahap 1 (AE.1).
  async function promoteBongkaran(p) {
    await createItem({
      jenisAset:"MATERIAL",
      description: p.nama,
      nomorAT: p.noAsset || "",
      noEquipment: p.noSeri || "",
      kuantitas: p.qty!=null ? String(p.qty) : "",
      satuan: p.satuan || "",
      keterangan: `Eks Bongkaran ATTB (MTU) dari ${p.tug10No}${p.namaPekerjaan?` — ${p.namaPekerjaan}`:""}`,
      sourceTug10Key: p.key,
      foto: p.foto || null, // pakai foto dari input TUG-10 (foto barang/nameplate)
    });
  }
  const [attbGudangFilter, setAttbGudangFilter] = useState({}); // per-item id -> gudangId (utk filter dropdown Sub Gudang & Blok)
  const [attbSubGudangFilter, setAttbSubGudangFilter] = useState({}); // per-item id -> subGudangId (utk filter dropdown Blok)
  // Resolve lokasi master-data yang tersimpan di item -> objek {lok, gdg, sg, petaInfo, teks}
  // untuk tampilan + tombol peta. Pola sama Data Stok, tapi ATTB juga simpan gudangId/subGudangId
  // sendiri (independen dari lokasiId/Blok) — ditemukan 2026-07-10: beberapa Sub Gudang (mis.
  // BUDURAN) belum punya Blok terdaftar sama sekali di Master Data, jadi kalau lokasi cuma
  // disimpan lewat lokasiId (harus sampai pilih Blok), pilihan Gudang/Sub Gudang untuk area
  // begitu tidak pernah bisa tersimpan — kelihatan "hilang" tiap kali halaman di-render ulang.
  const resolveLokasiMaster = (item) => {
    const lok = lokasiList.find(l=>l.id===item.lokasiId);
    if (lok) {
      const gdg = lok.gudangId ? gudangList.find(g=>g.id===lok.gudangId) : null;
      const sg = lok.subGudangId ? subGudangList.find(s=>s.id===lok.subGudangId) : null;
      const petaInfo = getLokasiPetaInfo(lok, gdg, subGudangList);
      const teks = [gdg?.nama, sg?.nama, lok.kode].filter(Boolean).join(" / ");
      return { lok, gdg, sg, petaInfo, teks };
    }
    if (item.gudangId) {
      const gdg = gudangList.find(g=>g.id===item.gudangId) || null;
      const sg = item.subGudangId ? subGudangList.find(s=>s.id===item.subGudangId) : null;
      const teks = [gdg?.nama, sg?.nama].filter(Boolean).join(" / ");
      return { lok:null, gdg, sg, petaInfo:null, teks };
    }
    return null;
  };
  async function setAttbLokasi(item, newLokasiId) {
    await saveEdit(item.id, { lokasiId: newLokasiId || null });
  }
  const appUptShort = (typeof UPT !== "undefined" ? UPT : "").replace(/^UPT\s+/i, "").trim();
  const myUpt = currentUser?.upt || currentUser?.uptName || appUptShort || "";
  const isMSB = hasRole(currentUser, "MSB","Manager UIT");
  const [myUptSelected, setMyUptSelected] = useState(isMSB ? "" : (myUpt || ""));
  const effectiveUptFilter = isMSB ? myUptSelected : (myUpt || "");
  const canManage = hasRole(currentUser, "ADMIN","TL");

  const [stageFilter, setStageFilter] = useState("USULAN_AE1"); // default buka langsung ke Tahap 1 (Usulan AE.1 ke Unit Induk)
  const [belumLanjutOnly, setBelumLanjutOnly] = useState(false);
  const [attbSearch, setAttbSearch] = useState("");
  const [jenisFilter, setJenisFilter] = useState("ALL");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [waktuFilter, setWaktuFilter] = useState("ALL");
  const [attbPageSize, setAttbPageSize] = useState(20);
  const [attbPage, setAttbPage] = useState(1);
  const [showAddForm, setShowAddForm] = useState(false);
  const emptyAddForm = { jenisAset:"MATERIAL", description:"", nomorAT:"", nomorATTB:"", assetClass:"", assetType:"", nilaiPerolehan:"", nilaiBuku:"", alasanPenghapusbukuan:"", keterangan:"" };
  const [addForm, setAddForm] = useState(emptyAddForm);
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [rejectingId, setRejectingId] = useState(null);
  const [rejectReason, setRejectReason] = useState("");
  const [belumLanjutId, setBelumLanjutId] = useState(null);
  const [belumLanjutNote, setBelumLanjutNote] = useState("");

  // Import Excel (jenis MATERIAL) — lihat docs/ATTB_SPEC.md bagian 7a/7b.
  // UPT tidak dipilih manual — otomatis ikut UPT login admin (effectiveUptFilter/myUpt).
  const importUpt = effectiveUptFilter || myUpt || "";
  // Format baku Waktu Usulan Penghapusan: "Semester {1/2} - {tahun}". Tahun default =
  // tahun berjalan; sediakan juga tahun sebelumnya untuk data historis (mis. file 4).
  const currentYear = new Date().getFullYear();
  const attbTahunOptions = [currentYear, currentYear-1];
  const [showImportPanel, setShowImportPanel] = useState(false);
  const [importTarget, setImportTarget] = useState("TAHAP1");
  const [importSemester, setImportSemester] = useState("2"); // "1" / "2"
  const [importTahun, setImportTahun] = useState(currentYear);
  const importWaktu = `Semester ${importSemester} - ${importTahun}`;
  const [importing, setImporting] = useState(false);
  const [importPreview, setImportPreview] = useState(null);
  const [importIncludeHidden, setImportIncludeHidden] = useState(false); // default: baris hidden di Excel DILEWATI
  const [importOverwrite, setImportOverwrite] = useState(false); // "tiban": timpa data eksisting dgn Waktu Usulan sama
  const [importRaw, setImportRaw] = useState(null); // {rawRows, rowsMeta, sheetName, fileName} dari file terupload

  async function handleImportFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    try {
      const buf = await file.arrayBuffer();
      // File 4 bisa ~200MB (banyak sheet dokumentasi foto) — parse metadata dulu
      // (bookSheets: cepat, cuma daftar nama sheet), cari sheet target, baru parse
      // HANYA sheet itu (opsi `sheets`). Tanpa ini browser bisa freeze/crash karena
      // memparse semua sheet gambar. cellStyles:true supaya `!rows` terisi -> tahu
      // baris mana yang di-hide/di-filter di Excel (dipakai untuk opsi sertakan/lewati).
      const wbMeta = XLSX.read(buf, { type:"array", bookSheets:true });
      const sheetName = wbMeta.SheetNames.find(s=>s.toUpperCase().includes("AE.3.1F")) || wbMeta.SheetNames.find(s=>s.toUpperCase().includes("AT OP")) || wbMeta.SheetNames[0];
      const wb = XLSX.read(buf, { type:"array", cellDates:true, cellStyles:true, sheets:[sheetName] });
      const ws = wb.Sheets[sheetName];
      const rawRows = XLSX.utils.sheet_to_json(ws, { header:1, raw:false, defval:"" });
      const rowsMeta = ws["!rows"] || [];
      setImportRaw({ rawRows, rowsMeta, sheetName, fileName: file.name });
    } catch(err) {
      showToast("Gagal baca file: " + err.message, "error");
    }
    setImporting(false);
    e.target.value = "";
  }

  // Bangun ulang preview tiap raw data / opsi hidden / tiban / target / UPT / waktu berubah,
  // supaya semua toggle langsung mengubah hitungan tanpa upload ulang.
  useEffect(() => {
    if (!importRaw) { setImportPreview(null); return; }
    const { rawRows, rowsMeta, sheetName, fileName } = importRaw;
    const hiddenCount = rawRows.filter((_,i)=>rowsMeta[i] && rowsMeta[i].hidden===true).length;
    const rows = importIncludeHidden ? rawRows : rawRows.filter((_,i)=>!(rowsMeta[i] && rowsMeta[i].hidden===true));
    const opts = { upt: importUpt.trim(), waktuUsulanPenghapusan: importWaktu.trim() };
    const parsed = importTarget==="TAHAP1" ? parseAttbMaterialFile2(rows, opts) : parseAttbMaterialFile4(rows, opts);
    // Mode "tiban": item eksisting dgn Waktu Usulan (+UPT) sama akan ditimpa, jadi
    // TIDAK dihitung sebagai duplikat (nomornya akan dibuat ulang dari file).
    const matchWaktu = a => a.waktuUsulanPenghapusan===importWaktu && (a.upt||"")===(importUpt||"");
    const overwriteCount = importOverwrite ? attbList.filter(matchWaktu).length : 0;
    const keptNomorAT = new Set(attbList.filter(a => importOverwrite ? !matchWaktu(a) : true).map(a=>a.nomorAT).filter(Boolean));
    const withDup = parsed.map(r => ({ ...r, _duplicate: keptNomorAT.has(r.nomorAT) }));
    setImportPreview({ records: withDup, fileName, sheetName, newCount: withDup.filter(r=>!r._duplicate).length, dupCount: withDup.filter(r=>r._duplicate).length, hiddenCount, overwriteCount });
  }, [importRaw, importIncludeHidden, importOverwrite, importTarget, importUpt, importWaktu, attbList]);

  async function confirmImport() {
    if (!importPreview) return;
    // buang flag _duplicate sebelum simpan (cuma penanda UI)
    const records = importPreview.records.map(({_duplicate, ...r})=>r);
    const runImport = async () => {
      await bulkImport(records, importTarget, { overwrite: importOverwrite, waktu: importWaktu, upt: importUpt });
      setImportRaw(null);
      setImportPreview(null);
      setShowImportPanel(false);
    };
    // Mode tiban yang benar-benar menghapus data lama = destruktif -> konfirmasi dulu.
    if (importOverwrite && importPreview.overwriteCount>0 && askConfirmDelete) {
      askConfirmDelete({
        title:"Tiban (Timpa) Data Eksisting?",
        message:`${importPreview.overwriteCount} item lama dengan Waktu Usulan "${importWaktu}" (UPT ${importUpt}) akan DIHAPUS, lalu diganti ${importPreview.newCount} item dari file ini.`,
        warning:"Data lama yang ditimpa tidak bisa dikembalikan. Pastikan file sudah benar.",
        confirmLabel:"♻️ Ya, Tiban & Import",
        onConfirm: runImport,
      });
    } else {
      await runImport();
    }
  }

  const uptOptions = Array.from(new Set(attbList.map(a=>a.upt).filter(Boolean))).sort();
  const scopedList = attbList.filter(a => !effectiveUptFilter || a.upt===effectiveUptFilter);
  const stageCounts = ATTB_STAGES.reduce((acc,s)=>{ acc[s.code]=scopedList.filter(a=>a.stage===s.code).length; return acc; }, {});
  const belumLanjutCount = scopedList.filter(a=>a.lanjutBelumLanjut).length;
  const pendingApprovalCount = scopedList.filter(isPendingAttbApproval).length;
  // Opsi dropdown filter diturunkan dari data yang ada (bukan hardcode) supaya
  // hanya menampilkan nilai yang benar-benar dipakai.
  const jenisOptions = Array.from(new Set(scopedList.map(a=>a.jenisAset).filter(Boolean)));
  const statusOptions = Array.from(new Set(scopedList.map(a=>a.approvalStatus||"DRAFT").filter(Boolean)));
  const waktuOptions = Array.from(new Set(scopedList.map(a=>a.waktuUsulanPenghapusan).filter(Boolean))).sort();
  const q = attbSearch.trim().toLowerCase();
  const filteredList = scopedList
    .filter(a => stageFilter==="ALL" || a.stage===stageFilter)
    .filter(a => !belumLanjutOnly || a.lanjutBelumLanjut)
    .filter(a => jenisFilter==="ALL" || a.jenisAset===jenisFilter)
    .filter(a => statusFilter==="ALL" || (a.approvalStatus||"DRAFT")===statusFilter)
    .filter(a => waktuFilter==="ALL" || a.waktuUsulanPenghapusan===waktuFilter)
    .filter(a => !q || [a.nomorAT, a.nomorATTB, a.description, a.merkType, a.spesifikasi, a.bay, a.lokasi, a.noEquipment, a.keterangan].some(v => String(v||"").toLowerCase().includes(q)))
    // Tiebreaker pakai id (2026-07-10): data hasil import batch punya createdAt IDENTIK untuk
    // puluhan/ratusan baris sekaligus (cuma 2 nilai unik utk 151 item ATTB) - kalau createdAt
    // seri, urutannya jatuh ke urutan mentah hasil fetch Supabase, yang bisa berubah tiap baris
    // itu di-upsert (kena reorder di storage). Efeknya baris "melompat" posisi begitu lokasi
    // diisi. Tiebreaker stabil (id) bikin urutan selalu deterministik, tidak terpengaruh upsert.
    .sort((a,b)=>(b.createdAt||0)-(a.createdAt||0) || String(a.id).localeCompare(String(b.id)));
  const attbTotalPages = Math.max(1, Math.ceil(filteredList.length / attbPageSize));
  const attbPageClamped = Math.min(attbPage, attbTotalPages);
  const pagedList = filteredList.slice((attbPageClamped-1)*attbPageSize, attbPageClamped*attbPageSize);
  // Reset ke halaman 1 saat filter/scope berubah supaya tidak nyangkut di halaman kosong.
  useEffect(()=>{ setAttbPage(1); }, [stageFilter, belumLanjutOnly, effectiveUptFilter, attbPageSize, attbSearch, jenisFilter, statusFilter, waktuFilter]);

  function renderField(field, form, setForm) {
    return (
      <div key={field.key} style={{marginBottom:8}}>
        <label style={sty.label}>{field.label}</label>
        {field.type==="select" ? (
          <select style={sty.select} value={form[field.key] ?? ""} onChange={e=>setForm(f=>({...f,[field.key]:e.target.value}))}>
            <option value="">-- Pilih --</option>
            {field.options.map(o=><option key={o} value={o}>{o}</option>)}
          </select>
        ) : (
          <input style={sty.input} type={field.type==="number"?"number":field.type==="date"?"date":"text"}
            value={form[field.key] ?? ""} onChange={e=>setForm(f=>({...f,[field.key]:e.target.value}))}/>
        )}
      </div>
    );
  }

  async function submitAdd() {
    await createItem(addForm);
    setAddForm(emptyAddForm);
    setShowAddForm(false);
  }

  const stageColor = stage => [C.accent,"#7c3aed","#0891b2","#ea580c",C.green][attbStageIndex(stage)] || C.muted;

  return (
    <div>
      <h1 style={{fontSize:20,fontWeight:900,marginBottom:12}}>🗂️ ATTB — Penghapusan Aset Material</h1>

      {isMSB ? (
        <div style={{display:"flex",gap:10,alignItems:"flex-end",flexWrap:"wrap",marginBottom:12}}>
          <div style={{minWidth:180}}>
            <label style={{...sty.label,marginBottom:3}}>Filter UPT</label>
            <select style={sty.select} value={myUptSelected} onChange={e=>setMyUptSelected(e.target.value)}>
              <option value="">Semua UPT</option>
              {uptOptions.map(u=><option key={u} value={u}>{u}</option>)}
            </select>
          </div>
        </div>
      ) : (
        <div style={{fontSize:12,color:C.muted,marginBottom:12}}>
          Menampilkan item ATTB <b style={{color:C.accent}}>UPT {myUpt||"Surabaya"}</b>
        </div>
      )}

      <div style={{display:"flex",gap:16,flexWrap:"wrap",marginBottom:14,padding:"9px 14px",background:"#f8fafc",borderRadius:10,border:`1px solid ${C.border}`,fontSize:12,alignItems:"center"}}>
        <div style={{display:"flex",alignItems:"baseline",gap:4}}><span style={{color:C.muted}}>Total Item:</span><span style={{fontWeight:900,fontSize:14,color:C.accent}}>{scopedList.length}</span></div>
        <div style={{display:"flex",alignItems:"baseline",gap:4}}><span style={{color:C.muted}}>Pending Approval:</span><span style={{fontWeight:900,fontSize:14,color:pendingApprovalCount?"#92400e":C.muted}}>{pendingApprovalCount}</span></div>
        <div style={{display:"flex",alignItems:"baseline",gap:4}}><span style={{color:C.muted}}>Belum Lanjut:</span><span style={{fontWeight:900,fontSize:14,color:belumLanjutCount?C.red:C.muted}}>{belumLanjutCount}</span></div>
      </div>

      {/* Pipeline 5 tahap ATTB — kartu berurutan dihubungkan panah (proses maju
          menuju lelang). Klik kartu untuk memfilter tabel per tahap. */}
      <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap",marginBottom:10}}>
        <button onClick={()=>setStageFilter("ALL")} style={{display:"flex",alignItems:"center",gap:6,padding:"6px 14px",borderRadius:20,border:`2px solid ${stageFilter==="ALL"?C.accent:C.border}`,background:stageFilter==="ALL"?C.accent:"white",color:stageFilter==="ALL"?"white":C.accent,fontWeight:700,fontSize:12,cursor:"pointer"}}>
          <span style={{fontWeight:900,fontSize:14}}>{scopedList.length}</span><span>Semua Tahap</span>
        </button>
        {belumLanjutCount>0 && (
          <button onClick={()=>setBelumLanjutOnly(b=>!b)} style={{display:"flex",alignItems:"center",gap:6,padding:"6px 14px",borderRadius:20,border:`2px solid ${belumLanjutOnly?C.red:"#fecaca"}`,background:belumLanjutOnly?C.red:"#fef2f2",color:belumLanjutOnly?"white":C.red,fontWeight:700,fontSize:12,cursor:"pointer"}}>
            ⚠️ Belum Lanjut ({belumLanjutCount})
          </button>
        )}
      </div>
      <div style={{display:"flex",alignItems:"stretch",flexWrap:"wrap",gap:0,marginBottom:16}}>
        {/* Pra-tahap: Material Bongkaran ATTB (MTU) dari TUG-10 — sumber kandidat sebelum AE.1 */}
        {(()=>{ const active = stageFilter==="SUMBER"; const color="#6b7280"; return (
          <Fragment key="SUMBER">
            <button onClick={()=>setStageFilter("SUMBER")} title="Material Bongkaran ATTB dari TUG-10"
              style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:3,padding:"10px 12px",minWidth:120,borderRadius:12,border:`2px dashed ${active?color:"#cbd5e1"}`,background:active?color:"#f8fafc",color:active?"white":C.text,cursor:"pointer",boxShadow:active?`0 2px 10px ${color}55`:"none",transition:"all .15s"}}>
              <div style={{display:"flex",alignItems:"center",gap:6}}>
                <span style={{fontSize:16}}>🧰</span>
                <span style={{fontSize:20,fontWeight:900,color:active?"white":color}}>{bongkaranBelum.length}</span>
              </div>
              <span style={{fontSize:11,fontWeight:700,textAlign:"center",lineHeight:1.2,color:active?"white":C.muted}}>Material Bongkaran<br/>(TUG-10)</span>
            </button>
            <div style={{display:"flex",alignItems:"center",justifyContent:"center",padding:"0 2px",color:C.muted,fontSize:22,fontWeight:900,alignSelf:"center"}}>→</div>
          </Fragment>
        ); })()}
        {ATTB_STAGES.map((s,i)=>{
          const active = stageFilter===s.code;
          const color = stageColor(s.code);
          const isLast = i===ATTB_STAGES.length-1;
          return (
            <Fragment key={s.code}>
              <button onClick={()=>setStageFilter(s.code)} title={`Filter: ${s.label}`}
                style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:3,padding:"10px 12px",minWidth:120,borderRadius:12,border:`2px solid ${active?color:C.border}`,background:active?color:"white",color:active?"white":C.text,cursor:"pointer",boxShadow:active?`0 2px 10px ${color}55`:"none",transition:"all .15s"}}>
                <div style={{display:"flex",alignItems:"center",gap:6}}>
                  <span style={{width:20,height:20,borderRadius:"50%",display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:900,background:active?"rgba(255,255,255,0.25)":color+"22",color:active?"white":color}}>{i+1}</span>
                  <span style={{fontSize:20,fontWeight:900,color:active?"white":color}}>{stageCounts[s.code]||0}</span>
                </div>
                <span style={{fontSize:11,fontWeight:700,textAlign:"center",lineHeight:1.2,color:active?"white":C.muted}}>{s.label}</span>
              </button>
              {!isLast && (
                <div style={{display:"flex",alignItems:"center",justifyContent:"center",padding:"0 2px",color:C.muted,fontSize:22,fontWeight:900,alignSelf:"center"}}>→</div>
              )}
            </Fragment>
          );
        })}
        {/* Tujuan akhir proses */}
        <div style={{display:"flex",alignItems:"center",justifyContent:"center",padding:"0 2px",color:C.green,fontSize:22,fontWeight:900,alignSelf:"center"}}>→</div>
        <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:2,padding:"10px 14px",minWidth:90,borderRadius:12,border:`2px dashed ${C.green}`,background:"#f0fdf4",alignSelf:"center"}}>
          <span style={{fontSize:20}}>🔨</span>
          <span style={{fontSize:11,fontWeight:800,color:C.green,textAlign:"center",lineHeight:1.2}}>LELANG<br/>oleh KI</span>
        </div>
      </div>

      {canManage && stageFilter!=="SUMBER" && (
        <div style={{display:"flex",gap:8,marginBottom:16,flexWrap:"wrap"}}>
          <button style={sty.btn("ghost")} onClick={()=>{setImportRaw(null);setImportPreview(null);setImportOverwrite(false);setImportIncludeHidden(false);setShowImportPanel(true);}}>📥 Import Excel (Material)</button>
        </div>
      )}

      {/* ── PRA-TAHAP: Pool Material Bongkaran ATTB (MTU) dari TUG-10 ── */}
      {stageFilter==="SUMBER" && (
        <div>
          <div style={{...sty.card,marginBottom:12,background:"#f8fafc",borderLeft:`4px solid #6b7280`,padding:"10px 14px",fontSize:12,color:C.muted}}>
            🧰 Daftar material <b>Bongkaran ATTB (MTU)</b> yang masuk lewat TUG-10 (retur). Ini sumber kandidat sebelum diusulkan ke AE.1. Klik <b>Usulkan ATTB</b> untuk memindahkan material ke pipeline (Tahap 1 — Usulan AE.1 ke Unit Induk).
          </div>
          <div style={{fontSize:11,color:C.muted,marginBottom:10}}>Total <b style={{color:C.text}}>{bongkaranPool.length}</b> material bongkaran • <b style={{color:C.accent}}>{bongkaranBelum.length}</b> belum diusulkan</div>
          <div style={{...sty.card,padding:0,overflowX:"auto",marginBottom:24}}>
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:12,minWidth:820}}>
              <thead>
                <tr style={{background:C.sidebar,color:"white"}}>
                  {["Material","Qty","No Seri","No Asset","Sumber TUG-10","Tanggal","Status TUG-10","Aksi"].map(h=>(
                    <th key={h} style={{padding:"9px 10px",textAlign:h==="Aksi"?"center":"left",whiteSpace:"nowrap",fontSize:11}}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {bongkaranPool.length===0 && (
                  <tr><td colSpan={8} style={{padding:30,textAlign:"center",color:C.muted}}>Belum ada material Bongkaran ATTB (MTU) dari TUG-10.</td></tr>
                )}
                {bongkaranPool.map(p=>{
                  const sudah = promotedKeys.has(p.key);
                  return (
                    <tr key={p.key} style={{borderBottom:`1px solid ${C.border}`,borderLeft:`3px solid ${sudah?C.green:"#6b7280"}`,opacity:sudah?0.65:1}}>
                      <td style={{padding:"8px 10px",fontWeight:600,minWidth:180}}>{p.nama}</td>
                      <td style={{padding:"8px 10px",whiteSpace:"nowrap"}}>{p.qty} {p.satuan}</td>
                      <td style={{padding:"8px 10px",whiteSpace:"nowrap"}}>{p.noSeri||"—"}</td>
                      <td style={{padding:"8px 10px",whiteSpace:"nowrap"}}>{p.noAsset||"—"}</td>
                      <td style={{padding:"8px 10px",whiteSpace:"nowrap"}}>{p.tug10No}{p.namaPekerjaan?<div style={{fontSize:10,color:C.muted}}>{p.namaPekerjaan}</div>:null}</td>
                      <td style={{padding:"8px 10px",whiteSpace:"nowrap"}}>{p.tanggal?new Date(p.tanggal).toLocaleDateString("id-ID"):"—"}</td>
                      <td style={{padding:"8px 10px"}}><span style={{padding:"2px 8px",borderRadius:20,fontSize:10,fontWeight:700,background:p.status==="APPROVED"?"#dcfce7":"#fef3c7",color:p.status==="APPROVED"?C.green:"#92400e"}}>{p.status||"-"}</span></td>
                      <td style={{padding:"8px 10px",textAlign:"center"}}>
                        {sudah
                          ? <span style={{fontSize:10,fontWeight:700,color:C.green}}>✅ Sudah diusulkan</span>
                          : canManage
                            ? <button style={sty.btn("primary","sm")} onClick={()=>promoteBongkaran(p)}>➕ Usulkan ATTB</button>
                            : <span style={{fontSize:10,color:C.muted}}>—</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {stageFilter!=="SUMBER" && <>
      {/* Bar filter data — search bebas + dropdown jenis/status/waktu usulan */}
      <div style={{display:"flex",gap:10,flexWrap:"wrap",alignItems:"center",marginBottom:12}}>
        <div style={{position:"relative",flex:1,minWidth:220}}>
          <input style={{...sty.input,paddingRight:28}} placeholder="🔍 Cari nomor AT/ATTB, deskripsi, merk, bay, lokasi..." value={attbSearch} onChange={e=>setAttbSearch(e.target.value)}/>
          {attbSearch && <button onClick={()=>setAttbSearch("")} title="Hapus pencarian" style={{position:"absolute",right:6,top:"50%",transform:"translateY(-50%)",background:"transparent",border:"none",cursor:"pointer",fontSize:14,color:C.muted,padding:4,lineHeight:1}}>✕</button>}
        </div>
        {jenisOptions.length>1 && (
          <select style={{...sty.select,width:"auto",minWidth:130}} value={jenisFilter} onChange={e=>setJenisFilter(e.target.value)}>
            <option value="ALL">Semua Jenis</option>
            {jenisOptions.map(j=><option key={j} value={j}>{ATTB_JENIS_ASET_LABEL[j]||j}</option>)}
          </select>
        )}
        <select style={{...sty.select,width:"auto",minWidth:130}} value={statusFilter} onChange={e=>setStatusFilter(e.target.value)}>
          <option value="ALL">Semua Status</option>
          {statusOptions.map(s=><option key={s} value={s}>{s}</option>)}
        </select>
        {waktuOptions.length>0 && (
          <select style={{...sty.select,width:"auto",minWidth:150}} value={waktuFilter} onChange={e=>setWaktuFilter(e.target.value)}>
            <option value="ALL">Semua Waktu Usulan</option>
            {waktuOptions.map(w=><option key={w} value={w}>{w}</option>)}
          </select>
        )}
        {(attbSearch||jenisFilter!=="ALL"||statusFilter!=="ALL"||waktuFilter!=="ALL") && (
          <button style={sty.btn("ghost","sm")} onClick={()=>{setAttbSearch("");setJenisFilter("ALL");setStatusFilter("ALL");setWaktuFilter("ALL");}}>Reset filter</button>
        )}
      </div>

      <div style={{fontSize:11,color:C.muted,marginBottom:10}}>Menampilkan <b style={{color:C.text}}>{filteredList.length}</b> item</div>

      {/* Tampilan tabel horizontal, pola sama dengan Data Stok (header biru,
          baris ringkas, border kiri berwarna per tahap). Form Tolak/Belum Lanjut
          muncul sebagai baris expand di bawah baris item terkait. */}
      <div style={{...sty.card,padding:0,overflowX:"auto",marginBottom:12}}>
        <table style={{width:"100%",borderCollapse:"collapse",fontSize:12,minWidth:920}}>
          <thead>
            <tr style={{background:C.sidebar,color:"white"}}>
              {["Nomor AT/ATTB","Jenis / UPT","Deskripsi","Lokasi","Nilai Perolehan","Nilai Buku","Status","Tahap","Aksi"].map(h=>(
                <th key={h} style={{padding:"9px 10px",textAlign:h==="Aksi"?"center":h.startsWith("Nilai")?"right":"left",whiteSpace:"nowrap",fontSize:11}}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filteredList.length===0 && (
              <tr><td colSpan={9} style={{padding:30,textAlign:"center",color:C.muted}}>Belum ada item ATTB untuk filter ini.</td></tr>
            )}
            {pagedList.map(item=>{
              const canApproveThis = isPendingAttbApproval(item) && canApproveAttb(currentUser, item);
              const borderColor = item.lanjutBelumLanjut ? "#f59e0b" : stageColor(item.stage);
              return (
                <Fragment key={item.id}>
                  <tr style={{borderBottom:`1px solid ${C.border}`,borderLeft:`3px solid ${borderColor}`}}>
                    <td style={{padding:"8px 10px",whiteSpace:"nowrap"}}>
                      <div style={{display:"flex",gap:8,alignItems:"center"}}>
                        <div style={{width:34,height:34,flexShrink:0,borderRadius:6,overflow:"hidden",border:`1px solid ${C.border}`,background:"#f3f4f6",display:"flex",alignItems:"center",justifyContent:"center"}}>
                          {item.foto ? <img src={item.foto} alt="foto" style={{width:"100%",height:"100%",objectFit:"cover"}}/> : <span style={{fontSize:15,color:"#9ca3af"}}>📦</span>}
                        </div>
                        <div>
                          <div style={{fontWeight:700,color:C.text}}>{item.nomorATTB || item.nomorAT || item.id}</div>
                          {item.waktuUsulanPenghapusan && <div style={{fontSize:9,color:C.muted,marginTop:1}}>🕘 {item.waktuUsulanPenghapusan}</div>}
                        </div>
                      </div>
                    </td>
                    <td style={{padding:"8px 10px",whiteSpace:"nowrap"}}>
                      <div style={{fontWeight:600}}>{ATTB_JENIS_ASET_LABEL[item.jenisAset]||item.jenisAset}</div>
                      <div style={{fontSize:10,color:C.muted}}>{item.upt}</div>
                    </td>
                    <td style={{padding:"8px 10px",minWidth:180,maxWidth:280}}>
                      <div style={{fontWeight:600,color:C.text}}>{item.description||"-"}</div>
                      {item.bay && <div style={{fontSize:10,color:C.muted,marginTop:2}}>⚡ Asal: {item.bay}</div>}
                      {item.approvalStatus==="DRAFT" && item.alasanTolak && <div style={{fontSize:10,color:C.red,marginTop:2}}>Ditolak: {item.alasanTolak}</div>}
                    </td>
                    <td onClick={e=>e.stopPropagation()} style={{padding:"8px 10px",minWidth:180,maxWidth:230}}>
                      {(()=>{
                        const loc = resolveLokasiMaster(item);
                        const selGudangId = attbGudangFilter[item.id] ?? item.gudangId ?? loc?.gdg?.id ?? "";
                        const subsForGudang = subGudangList.filter(sg=>sg.gudangId===selGudangId);
                        const selSubGudangId = attbSubGudangFilter[item.id] ?? item.subGudangId ?? loc?.sg?.id ?? "";
                        const blokOptions = lokasiList.filter(l=>l.gudangId===selGudangId && (subsForGudang.length===0 || (l.subGudangId||"")===selSubGudangId));
                        const canLihatPeta = !!loc?.petaInfo;
                        if (canManage) {
                          return (
                            <div style={{display:"flex",flexDirection:"column",gap:3}}>
                              <select value={selGudangId} style={{...sty.select,fontSize:11,padding:"4px 6px",minHeight:"unset"}}
                                onChange={e=>{ const v=e.target.value; setAttbGudangFilter(prev=>({...prev,[item.id]:v})); setAttbSubGudangFilter(prev=>({...prev,[item.id]:""})); saveEdit(item.id, { gudangId: v||null, subGudangId: null, lokasiId: null }); }}>
                                <option value="">-- Pilih Gudang --</option>
                                {gudangList.map(g=><option key={g.id} value={g.id}>{g.nama}</option>)}
                              </select>
                              {subsForGudang.length>0 && (
                                <select value={selSubGudangId} style={{...sty.select,fontSize:11,padding:"4px 6px",minHeight:"unset"}}
                                  onChange={e=>{ const v=e.target.value; setAttbSubGudangFilter(prev=>({...prev,[item.id]:v})); saveEdit(item.id, { subGudangId: v||null, lokasiId: null }); }}>
                                  <option value="">-- Pilih Sub Gudang --</option>
                                  {subsForGudang.map(sg=><option key={sg.id} value={sg.id}>{sg.nama}</option>)}
                                </select>
                              )}
                              {selGudangId && blokOptions.length===0 && (subsForGudang.length===0 || selSubGudangId) && (
                                <div style={{fontSize:9,color:"#b45309",fontStyle:"italic"}}>⚠️ Belum ada Blok terdaftar di sini (atur di Master Data → Master Gudang) — pilihan Gudang{subsForGudang.length>0?"/Sub Gudang":""} tetap tersimpan.</div>
                              )}
                              <div style={{display:"flex",gap:3,alignItems:"center"}}>
                                <select value={item.lokasiId||""} style={{...sty.select,fontSize:11,padding:"4px 6px",minHeight:"unset",flex:1}}
                                  onChange={e=>setAttbLokasi(item, e.target.value)}>
                                  <option value="">-- Pilih Blok --</option>
                                  {blokOptions.map(l=><option key={l.id} value={l.id}>{l.kode}{l.nama?" — "+l.nama:""}</option>)}
                                </select>
                                <button title={canLihatPeta?"Lihat di Peta Gudang":!item.lokasiId?"Blok belum diisi":"Blok ini belum diplot di denah / denah belum diupload"}
                                  style={{...sty.btn("ghost","sm"),padding:"4px 7px",borderColor:canLihatPeta?"#fca5a5":C.border,color:canLihatPeta?"#dc2626":C.muted,opacity:canLihatPeta?1:0.5}}
                                  onClick={()=>{ if(canLihatPeta){ setPetaMiniDetail && setPetaMiniDetail({stock:item, lokasi:loc.lok, gudang:loc.gdg, petaInfo:loc.petaInfo}); } else { showToast(!item.lokasiId?"Blok/Lokasi belum diisi.":"Blok ini belum diplot koordinatnya di denah (atur di Master Data → Master Gudang).","error"); } }}>📍</button>
                              </div>
                            </div>
                          );
                        }
                        return (
                          <div>
                            {loc ? <div style={{fontWeight:600,color:C.text,fontSize:11}}>📍 {loc.teks}</div> : <div style={{fontSize:11,color:C.muted,fontStyle:"italic"}}>Belum diisi</div>}
                          </div>
                        );
                      })()}
                    </td>
                    <td style={{padding:"8px 10px",textAlign:"right",whiteSpace:"nowrap"}}>{item.nilaiPerolehan?Number(item.nilaiPerolehan).toLocaleString("id-ID"):"—"}</td>
                    <td style={{padding:"8px 10px",textAlign:"right",whiteSpace:"nowrap",color:item.nilaiBuku?C.text:C.muted}}>{item.nilaiBuku?Number(item.nilaiBuku).toLocaleString("id-ID"):"—"}</td>
                    <td style={{padding:"8px 10px"}}>
                      <span style={{padding:"2px 8px",borderRadius:20,fontSize:10,fontWeight:700,background:"#f3f4f6",color:C.muted,whiteSpace:"nowrap"}}>{item.approvalStatus||"DRAFT"}</span>
                    </td>
                    <td style={{padding:"8px 10px"}}>
                      <div style={{display:"flex",flexDirection:"column",gap:3,alignItems:"flex-start"}}>
                        <span style={{padding:"2px 8px",borderRadius:20,fontSize:10,fontWeight:800,background:stageColor(item.stage)+"22",color:stageColor(item.stage),whiteSpace:"nowrap"}}>{attbStageLabel(item.stage)}</span>
                        {item.lanjutBelumLanjut && <span title={`Belum Lanjut: ${item.keteranganTidakLanjut||"-"}`} style={{padding:"2px 8px",borderRadius:20,fontSize:10,fontWeight:800,background:"#fef3c7",color:"#92400e",whiteSpace:"nowrap",cursor:"help"}}>⏸ Ditahan</span>}
                      </div>
                    </td>
                    <td style={{padding:"8px 10px"}}>
                      <div style={{display:"flex",gap:4,flexWrap:"wrap",justifyContent:"center"}}>
                        {canManage && <button title="Edit" style={{...sty.btn("ghost","sm"),padding:"5px 8px"}} onClick={()=>{setEditingId(item.id);setEditForm({...item});}}>✏️</button>}
                        {canApproveThis && (
                          <>
                            <button style={sty.btn("success","sm")} onClick={()=>approveToKI(item.id)}>Approve</button>
                            <button style={sty.btn("danger","sm")} onClick={()=>{setRejectingId(item.id);setRejectReason("");}}>Tolak</button>
                          </>
                        )}
                        {/* Kontrol Lanjut / Belum Lanjut — compact segmented, aktif di Tahap 1 (Usulan AE.1)
                            & Tahap 2 (AE.1 s.d AE.4). Tahap 3-4 cuma tombol Lanjut. */}
                        {canManage && ["USULAN_AE1","AE1_AE4"].includes(item.stage) && (
                          <div style={{display:"inline-flex",borderRadius:8,overflow:"hidden",border:`1px solid ${C.border}`}}>
                            <button title="Lanjut ke tahap berikutnya" onClick={()=>advanceStage(item.id)}
                              style={{border:"none",cursor:"pointer",padding:"5px 10px",fontSize:11,fontWeight:800,background:"#dcfce7",color:C.green,whiteSpace:"nowrap"}}>▶ Lanjut</button>
                            <button title={item.lanjutBelumLanjut?"Sedang Belum Lanjut — klik untuk lanjutkan lagi":"Tandai Belum Lanjut"}
                              onClick={()=>{ if(item.lanjutBelumLanjut){ resumeBelumLanjut(item); } else { setBelumLanjutId(item.id); setBelumLanjutNote(""); } }}
                              style={{border:"none",borderLeft:`1px solid ${C.border}`,cursor:"pointer",padding:"5px 10px",fontSize:11,fontWeight:800,background:item.lanjutBelumLanjut?"#f59e0b":"#fffbeb",color:item.lanjutBelumLanjut?"white":"#92400e",whiteSpace:"nowrap"}}>{item.lanjutBelumLanjut?"⏸ Ditahan":"⏸ Belum"}</button>
                          </div>
                        )}
                        {canManage && ["CEK_DEKOM","CEK_KJPP"].includes(item.stage) && (
                          <button style={sty.btn("ghost","sm")} onClick={()=>advanceStage(item.id)}>▶ Lanjut</button>
                        )}
                        {canDelete && (
                          <button title="Hapus item ATTB" style={{...sty.btn("danger","sm"),padding:"5px 8px"}}
                            onClick={()=>askConfirmDelete && askConfirmDelete({
                              title:"Hapus Item ATTB?",
                              message:`${item.nomorATTB||item.nomorAT||item.id} — ${item.description||"-"}`,
                              warning:"Data item ATTB ini akan dihapus permanen dari daftar & database. Tindakan ini tidak bisa di-undo.",
                              confirmLabel:"🗑️ Ya, Hapus",
                              onConfirm:()=>deleteItem(item.id),
                            })}>🗑️</button>
                        )}
                      </div>
                    </td>
                  </tr>
                  {(rejectingId===item.id || belumLanjutId===item.id) && (
                    <tr style={{borderLeft:`3px solid ${borderColor}`}}>
                      <td colSpan={9} style={{padding:"8px 10px",background:"#fef2f2"}}>
                        {rejectingId===item.id && (
                          <div>
                            <textarea style={{...sty.input,minHeight:50}} placeholder="Alasan penolakan..." value={rejectReason} onChange={e=>setRejectReason(e.target.value)}/>
                            <div style={{display:"flex",gap:6,marginTop:6}}>
                              <button style={sty.btn("ghost","sm")} onClick={()=>setRejectingId(null)}>Batal</button>
                              <button style={sty.btn("danger","sm")} onClick={async()=>{await rejectToKI(item.id, rejectReason);setRejectingId(null);}}>Tolak</button>
                            </div>
                          </div>
                        )}
                        {belumLanjutId===item.id && (
                          <div>
                            <textarea style={{...sty.input,minHeight:50}} placeholder="Alasan Belum Lanjut..." value={belumLanjutNote} onChange={e=>setBelumLanjutNote(e.target.value)}/>
                            <div style={{display:"flex",gap:6,marginTop:6}}>
                              <button style={sty.btn("ghost","sm")} onClick={()=>setBelumLanjutId(null)}>Batal</button>
                              <button style={sty.btn("danger","sm")} onClick={async()=>{await markBelumLanjut(item.id, belumLanjutNote);setBelumLanjutId(null);}}>Simpan</button>
                            </div>
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {filteredList.length > 0 && (
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:24,flexWrap:"wrap",gap:10}}>
          <div style={{display:"flex",alignItems:"center",gap:8,fontSize:12,color:C.muted}}>
            Tampilkan
            <select style={{...sty.select,width:"auto",padding:"4px 8px",minHeight:"unset",fontSize:12}} value={attbPageSize} onChange={e=>setAttbPageSize(Number(e.target.value))}>
              {[20,50,100].map(n=><option key={n} value={n}>{n}</option>)}
            </select>
            item per halaman — {filteredList.length} total
          </div>
          <div style={{display:"flex",alignItems:"center",gap:6}}>
            <button style={{...sty.btn("ghost","sm")}} disabled={attbPageClamped<=1} onClick={()=>setAttbPage(p=>Math.max(1,p-1))}>← Sebelumnya</button>
            <span style={{fontSize:12,color:C.muted,padding:"0 6px"}}>Halaman {attbPageClamped} / {attbTotalPages}</span>
            <button style={{...sty.btn("ghost","sm")}} disabled={attbPageClamped>=attbTotalPages} onClick={()=>setAttbPage(p=>Math.min(attbTotalPages,p+1))}>Berikutnya →</button>
          </div>
        </div>
      )}
      </>}

      {/* MODAL IMPORT EXCEL — jenis MATERIAL, 2 format sumber -> 2 tahap target berbeda */}
      {showImportPanel && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000,padding:16}}>
          <div style={{...sty.card,width:640,maxWidth:"100%",maxHeight:"90vh",overflowY:"auto"}}>
            <h3 style={{fontSize:16,fontWeight:800,marginBottom:4}}>📥 Import Excel ATTB (Material)</h3>
            <p style={{fontSize:11,color:C.muted,marginBottom:14}}>Baris data dideteksi otomatis lewat kolom Nomor AT/ATTB. Baris yang nomor AT-nya sudah ada di daftar akan otomatis dilewati (tidak dobel). 💡 Kalau punya kedua file (kandidat baru + yang sudah disetujui), import <b>Tahap 2 dulu</b>, baru Tahap 1 — supaya item yang sudah disetujui otomatis ke-skip saat import Tahap 1, tidak dobel-catat.</p>

            <div style={{marginBottom:8}}>
              <label style={sty.label}>Target Tahap</label>
              <select style={sty.select} value={importTarget} onChange={e=>setImportTarget(e.target.value)}>
                <option value="TAHAP1">Tahap 1 — Kandidat Baru (format "Bursa Material belum diusulkan")</option>
                <option value="TAHAP2">Tahap 2 — Sudah Disetujui (format resmi "Template AE.3.1f")</option>
              </select>
            </div>
            <div style={{marginBottom:8}}>
              <label style={sty.label}>UPT</label>
              <div style={{...sty.input,background:"#f3f4f6",color:C.text,display:"flex",alignItems:"center",fontWeight:600}}>{importUpt||"(UPT login tidak terdeteksi)"}</div>
              <div style={{fontSize:10,color:C.muted,marginTop:2}}>Otomatis mengikuti UPT login admin.</div>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:8}}>
              <div>
                <label style={sty.label}>Waktu Usulan — Semester</label>
                <select style={sty.select} value={importSemester} onChange={e=>setImportSemester(e.target.value)}>
                  <option value="1">Semester 1</option>
                  <option value="2">Semester 2</option>
                </select>
              </div>
              <div>
                <label style={sty.label}>Tahun</label>
                <select style={sty.select} value={importTahun} onChange={e=>setImportTahun(Number(e.target.value))}>
                  {attbTahunOptions.map(y=><option key={y} value={y}>{y}</option>)}
                </select>
              </div>
            </div>
            <div style={{fontSize:11,color:C.muted,marginBottom:8}}>Tersimpan sebagai: <b style={{color:C.accent}}>{importWaktu}</b></div>

            <label style={{display:"flex",alignItems:"center",gap:8,fontSize:12,marginBottom:8,cursor:"pointer",padding:"8px 10px",background:"#f8fafc",border:`1px solid ${C.border}`,borderRadius:8}}>
              <input type="checkbox" checked={importIncludeHidden} onChange={e=>setImportIncludeHidden(e.target.checked)}/>
              <span>Sertakan baris yang di-<b>hide</b>/di-filter di Excel
                {importPreview && importPreview.hiddenCount>0 && <span style={{color:"#92400e",fontWeight:700}}> — ada {importPreview.hiddenCount} baris hidden, saat ini <b>{importIncludeHidden?"disertakan":"dilewati"}</b></span>}
                {importPreview && importPreview.hiddenCount===0 && <span style={{color:C.muted}}> (file ini tidak punya baris hidden)</span>}
              </span>
            </label>

            <label style={{display:"flex",alignItems:"center",gap:8,fontSize:12,marginBottom:12,cursor:"pointer",padding:"8px 10px",background:importOverwrite?"#fef2f2":"#f8fafc",border:`1px solid ${importOverwrite?"#fecaca":C.border}`,borderRadius:8}}>
              <input type="checkbox" checked={importOverwrite} onChange={e=>setImportOverwrite(e.target.checked)}/>
              <span>♻️ <b>Tiban (timpa)</b> semua data eksisting dengan Waktu Usulan = <b>{importWaktu}</b>
                {importOverwrite && importPreview && <span style={{color:C.red,fontWeight:700}}> — {importPreview.overwriteCount} item lama akan dihapus & diganti isi file</span>}
                {!importOverwrite && <span style={{color:C.muted}}> (default: data lama dipertahankan, hanya menambah yang baru)</span>}
              </span>
            </label>

            <label style={{...sty.btn("primary"),cursor:"pointer",display:"inline-block",marginBottom:12}}>
              {importing?"⏳ Memproses...":"📂 Upload File Excel"}
              <input type="file" accept=".xlsx" style={{display:"none"}} onChange={handleImportFile} disabled={importing}/>
            </label>

            {importPreview && (
              <div>
                <div style={{fontSize:12,fontWeight:700,marginBottom:6}}>Preview: {importPreview.fileName} (Sheet: {importPreview.sheetName})</div>
                <div style={{display:"flex",gap:10,marginBottom:10}}>
                  <div style={{padding:"6px 12px",borderRadius:8,background:"#f0fdf4",border:`1px solid #bbf7d0`,textAlign:"center"}}>
                    <div style={{fontSize:10,color:C.muted}}>Baru</div>
                    <div style={{fontSize:16,fontWeight:800,color:C.green}}>{importPreview.newCount}</div>
                  </div>
                  <div style={{padding:"6px 12px",borderRadius:8,background:"#f3f4f6",border:`1px solid ${C.border}`,textAlign:"center"}}>
                    <div style={{fontSize:10,color:C.muted}}>Dilewati (duplikat)</div>
                    <div style={{fontSize:16,fontWeight:800,color:C.muted}}>{importPreview.dupCount}</div>
                  </div>
                  {importPreview.hiddenCount>0 && (
                    <div style={{padding:"6px 12px",borderRadius:8,background:"#fef9c3",border:`1px solid #fde68a`,textAlign:"center"}}>
                      <div style={{fontSize:10,color:"#92400e"}}>Hidden di Excel (dilewati)</div>
                      <div style={{fontSize:16,fontWeight:800,color:"#92400e"}}>{importPreview.hiddenCount}</div>
                    </div>
                  )}
                </div>
                <div style={{overflowX:"auto",maxHeight:280,overflowY:"auto",marginBottom:12,border:`1px solid ${C.border}`,borderRadius:8}}>
                  <table style={{width:"100%",borderCollapse:"collapse",fontSize:11,minWidth:480}}>
                    <thead style={{background:C.sidebar,color:"white",position:"sticky",top:0}}>
                      <tr>{["Nomor AT","Description","Nilai Perolehan","Status"].map(h=><th key={h} style={{padding:"6px 8px",textAlign:"left",whiteSpace:"nowrap"}}>{h}</th>)}</tr>
                    </thead>
                    <tbody>
                      {importPreview.records.map((r,i)=>(
                        <tr key={i} style={{borderBottom:`1px solid ${C.border}`,background:r._duplicate?"#f9fafb":"white",opacity:r._duplicate?0.6:1}}>
                          <td style={{padding:"4px 8px"}}>{r.nomorAT}</td>
                          <td style={{padding:"4px 8px"}}>{r.description}</td>
                          <td style={{padding:"4px 8px",textAlign:"right"}}>{r.nilaiPerolehan?.toLocaleString("id-ID")}</td>
                          <td style={{padding:"4px 8px"}}>{r._duplicate?"Duplikat — dilewati":"Baru"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <div style={{display:"flex",gap:10,marginTop:10}}>
              <button style={{...sty.btn("ghost"),flex:1}} onClick={()=>{setShowImportPanel(false);setImportRaw(null);setImportPreview(null);}}>Batal</button>
              <button style={{...sty.btn("primary"),flex:2}} disabled={!importPreview || importPreview.newCount===0} onClick={confirmImport}>
                💾 Import {importPreview?.newCount||0} Item Baru
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL TAMBAH — pilih jenis aset dulu, field menyesuaikan (Tahap 1) */}
      {showAddForm && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000,padding:16}}>
          <div style={{...sty.card,width:480,maxWidth:"100%",maxHeight:"90vh",overflowY:"auto"}}>
            <h3 style={{fontSize:16,fontWeight:800,marginBottom:16}}>+ Tambah Kandidat ATTB (Tahap 1)</h3>
            <div style={{marginBottom:8}}>
              <label style={sty.label}>Jenis Aset</label>
              <select style={sty.select} value={addForm.jenisAset} onChange={e=>setAddForm(f=>({...f,jenisAset:e.target.value}))}>
                {ATTB_JENIS_ASET.map(j=><option key={j} value={j}>{ATTB_JENIS_ASET_LABEL[j]}</option>)}
              </select>
            </div>
            {ATTB_CORE_FIELDS.map(f=>renderField(f, addForm, setAddForm))}
            {(ATTB_FIELDS_BY_JENIS[addForm.jenisAset]||[]).map(f=>renderField(f, addForm, setAddForm))}
            <div style={{display:"flex",gap:10,marginTop:10}}>
              <button style={{...sty.btn("ghost"),flex:1}} onClick={()=>setShowAddForm(false)}>Batal</button>
              <button style={{...sty.btn("primary"),flex:2}} onClick={submitAdd}>💾 Simpan</button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL EDIT — field tahap berikutnya baru muncul setelah item mencapai tahap itu */}
      {editingId && (()=>{
        const item = attbList.find(a=>a.id===editingId);
        if (!item) return null;
        const stageIdx = attbStageIndex(item.stage);
        return (
          <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000,padding:16}}>
            <div style={{...sty.card,width:520,maxWidth:"100%",maxHeight:"90vh",overflowY:"auto"}}>
              <h3 style={{fontSize:16,fontWeight:800,marginBottom:4}}>✏️ Edit ATTB</h3>
              <div style={{fontSize:12,color:C.muted,marginBottom:16}}>{item.nomorATTB||item.id} — {ATTB_JENIS_ASET_LABEL[item.jenisAset]||item.jenisAset}</div>

              {/* Foto barang — bisa ditambah/diperbarui di semua tahap. Untuk material
                  eks Bongkaran TUG-10, foto awal sudah ter-isi dari input TUG-10. */}
              <div style={{fontSize:11,fontWeight:800,color:C.muted,textTransform:"uppercase",marginBottom:6}}>Foto Barang</div>
              <div style={{height:170,borderRadius:10,background:"#f3f4f6",border:`1px solid ${C.border}`,overflow:"hidden",display:"flex",alignItems:"center",justifyContent:"center",marginBottom:8}}>
                {editForm.foto ? <img src={editForm.foto} alt="Foto barang ATTB" style={{width:"100%",height:"100%",objectFit:"cover"}}/> : <div style={{fontSize:36,color:"#9ca3af"}}>📦</div>}
              </div>
              <div style={{display:"flex",gap:8,marginBottom:16}}>
                <label style={{...sty.btn("ghost","sm"),flex:1,textAlign:"center",cursor:"pointer"}}>
                  📷 {editForm.foto?"Ganti Foto":"Upload Foto"}
                  <input type="file" accept="image/*" capture="environment" style={{display:"none"}} onChange={e=>handleImg && handleImg(e, img=>setEditForm(f=>({...f,foto:img})))}/>
                </label>
                {editForm.foto && <button style={sty.btn("danger","sm")} onClick={()=>setEditForm(f=>({...f,foto:null}))}>🗑️ Hapus Foto</button>}
              </div>

              <div style={{fontSize:11,fontWeight:800,color:C.muted,textTransform:"uppercase",marginBottom:6}}>Data Inti</div>
              {ATTB_CORE_FIELDS.map(f=>renderField(f, editForm, setEditForm))}
              {(ATTB_FIELDS_BY_JENIS[item.jenisAset]||[]).map(f=>renderField(f, editForm, setEditForm))}
              <div style={{fontSize:10,color:C.muted,marginBottom:8,fontStyle:"italic"}}>📍 Lokasi/Blok Gudang diatur langsung di kolom Lokasi pada tabel (pilih Gudang → Blok), lengkap dengan tombol lihat di peta.</div>

              {stageIdx>=1 && <>
                <div style={{fontSize:11,fontWeight:800,color:C.muted,textTransform:"uppercase",margin:"12px 0 6px"}}>Tahap 2 — AE.1 s.d. AE.4</div>
                {ATTB_STAGE2_FIELDS.map(f=>renderField(f, editForm, setEditForm))}
                {item.jenisAset==="MATERIAL" && (
                  <div style={{marginBottom:8}}>
                    <label style={sty.label}>Kategori Material</label>
                    <select style={sty.select} value={editForm.kategoriMaterial||""} onChange={e=>setEditForm(f=>({...f,kategoriMaterial:e.target.value}))}>
                      <option value="">-- Pilih --</option>
                      <option value="Trafo">Trafo</option>
                      <option value="Non Trafo">Non Trafo</option>
                    </select>
                  </div>
                )}
              </>}
              {stageIdx>=2 && <>
                <div style={{fontSize:11,fontWeight:800,color:C.muted,textTransform:"uppercase",margin:"12px 0 6px"}}>Tahap 3 — Siap Cek Dekom</div>
                {ATTB_STAGE3_FIELDS.map(f=>renderField(f, editForm, setEditForm))}
              </>}
              {stageIdx>=3 && <>
                <div style={{fontSize:11,fontWeight:800,color:C.muted,textTransform:"uppercase",margin:"12px 0 6px"}}>Tahap 4 — Cek KJPP</div>
                {ATTB_STAGE4_FIELDS.map(f=>renderField(f, editForm, setEditForm))}
              </>}
              {stageIdx>=4 && <>
                <div style={{fontSize:11,fontWeight:800,color:C.muted,textTransform:"uppercase",margin:"12px 0 6px"}}>Tahap 5 — Menunggu Lelang</div>
                {ATTB_STAGE5_FIELDS.map(f=>renderField(f, editForm, setEditForm))}
              </>}

              {item.stageHistory?.length>0 && (
                <div style={{marginTop:12}}>
                  <div style={{fontSize:11,fontWeight:800,color:C.muted,textTransform:"uppercase",marginBottom:6}}>Riwayat Tahap</div>
                  <div style={{display:"flex",flexDirection:"column",gap:4,maxHeight:120,overflowY:"auto"}}>
                    {[...item.stageHistory].reverse().map((h,i)=>(
                      <div key={i} style={{fontSize:11,color:C.muted,borderLeft:`2px solid ${C.border}`,paddingLeft:8}}>
                        <b style={{color:C.text}}>{attbStageLabel(h.stage)}</b> — {users.find(u=>u.id===h.oleh)?.name||h.oleh} • {h.tanggal?new Date(h.tanggal).toLocaleString("id-ID"):"-"}
                        {h.catatan && <div>{h.catatan}</div>}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div style={{display:"flex",gap:10,marginTop:16}}>
                <button style={{...sty.btn("ghost"),flex:1}} onClick={()=>setEditingId(null)}>Batal</button>
                <button style={{...sty.btn("primary"),flex:2}} onClick={async()=>{await saveEdit(item.id, editForm);setEditingId(null);}}>💾 Simpan</button>
              </div>
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

// QR di label Kartu Gantung TUG-2 (lihat KartuGantungModal "Label QR Print") berisi URL lengkap
// "?scan=<katalogId>", bukan sekadar nomor katalog. Ekstrak katalogId-nya supaya scan QR fisik di
// rak langsung match ke material yang benar, baik via URL utuh maupun fallback regex kalau kamera
// cuma menangkap sebagian teks. Top-level (bukan nested di komponen App) supaya dipakai ulang di
// komponen anak juga (mis. StockOpnameTab), bukan cuma di handleScanResult.
function extractKatalogIdFromScan(code) {
  try { const u = new URL(code); const id = u.searchParams.get("scan"); if (id) return id; } catch {}
  const m = code.match(/[?&]scan=([^&\s]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

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
    // Semua field numerik pakai parseIndoNumber (standarisasi titik/koma, lihat definisinya) —
    // sebelumnya beda-beda tempat pakai regex ad-hoc yang tidak konsisten (bug dilaporkan user
    // 2026-07-07: qty "103,5" bisa kebaca "1.035" kalau titik-desimal diperlakukan sebagai ribuan).
    const populasi = parseIndoNumber(findCol(row, COL.populasi));
    const failure5y = parseIndoNumber(findCol(row, COL.failure5y));
    const penggantian5y = parseIndoNumber(findCol(row, COL.penggantian5y));
    const emergency5y = parseIndoNumber(findCol(row, COL.emergency5y));
    const leadTime = parseIndoNumber(findCol(row, COL.leadTime));
    const ttf = parseIndoNumber(findCol(row, COL.ttf));
    const breakdownRaw = String(findCol(row, COL.breakdown)||"TIDAK").trim().toUpperCase();
    const breakdown = ["YA","Y","YES","TRUE","1"].includes(breakdownRaw);
    const hargaInput = parseIndoNumber(findCol(row, COL.harga));

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

function getMaterialCadangHealthStatus(score) {
  if (score <= 30) return { label:"Critical", color:"#dc2626", bg:"#fef2f2" };
  if (score <= 55) return { label:"High Risk", color:"#ea580c", bg:"#fff7ed" };
  if (score <= 75) return { label:"Watch", color:"#f59e0b", bg:"#fefce8" };
  return { label:"Healthy", color:"#16a34a", bg:"#dcfce7" };
}

function getMaterialCadangAction(r) {
  if (r.treatment !== "Material Cadang") return "Monitor Saja";
  if ((r.dataConfidence||100) < 65) return "Validasi Data Failure";
  if ((r.healthIndex||100) <= 30) return r.gapQty > 0 ? "Prioritaskan Pengadaan" : "Review Lead Time";
  if ((r.healthIndex||100) <= 55) return r.gapQty > 0 ? "Ajukan Apply Min Qty" : "Review Lead Time";
  if ((r.healthIndex||100) <= 75) return "Monitor Saja";
  return "Monitor Saja";
}

function calculateMaterialCadangHealthIndex(result, context = {}) {
  const maxLeadTime = context.maxLeadTime || 1;
  const maxGapValue = context.maxGapValue || 1;
  const stockCoverage = result.recommendedQty > 0 ? Math.min(1, (result.currentQty||0) / result.recommendedQty) : 1;
  const stockRisk = result.treatment === "Material Cadang" ? (1 - stockCoverage) * 35 : 0;
  const classRisk = { A1:20, A2:15, B1:10, B2:7, C:2 }[result.abcClass] || 5;
  const leadRisk = Math.min(1, (result.leadTime||0) / maxLeadTime) * 15;
  const failureBase = Math.max(result.failure5y||0, result.penggantian5y||0, result.emergency5y||0);
  const failureRisk = Math.min(15, failureBase * 3 + (result.breakdown ? 4 : 0) + ((result.emergency5y||0) > 0 ? 4 : 0));
  const valueRisk = Math.min(10, ((result.gapQty||0) * (result.harga||0) / maxGapValue) * 10);
  let confidence = 100;
  const flags = [];
  if (!result.harga || result.harga <= 0) { confidence -= 12; flags.push("Harga kosong"); }
  if ((result.warnings||[]).length) { confidence -= Math.min(18, result.warnings.length * 8); flags.push(...result.warnings); }
  if (!result.cluster) { confidence -= 10; flags.push("Equipment cluster kosong"); }
  if ((result.failure5y||0) === 0 && ((result.penggantian5y||0) > 0 || (result.emergency5y||0) > 0)) {
    confidence -= 15; flags.push("Failure 0 tetapi ada penggantian/emergency");
  }
  if ((result.leadTime||0) <= 0 || (result.ttf||0) <= 0) { confidence -= 20; flags.push("Lead time/TTF tidak valid"); }
  confidence = Math.max(20, Math.min(100, Math.round(confidence)));
  const confidencePenalty = (100 - confidence) * 0.15;
  const riskScore = Math.min(100, Math.round(stockRisk + classRisk + leadRisk + failureRisk + valueRisk + confidencePenalty));
  const healthIndex = Math.max(0, Math.min(100, 100 - riskScore));
  const status = getMaterialCadangHealthStatus(healthIndex);
  return {
    healthIndex,
    healthStatus: status.label,
    healthColor: status.color,
    healthBg: status.bg,
    riskScore,
    dataConfidence: confidence,
    aiRecommendation: getMaterialCadangAction({ ...result, healthIndex, dataConfidence: confidence }),
    healthBreakdown: {
      stockRisk: Math.round(stockRisk),
      classRisk: Math.round(classRisk),
      leadTimeRisk: Math.round(leadRisk),
      failureRisk: Math.round(failureRisk),
      valueRisk: Math.round(valueRisk),
      confidencePenalty: Math.round(confidencePenalty),
    },
    dataQualityFlags: flags,
  };
}

function enrichMaterialCadangHealthResults(results) {
  const materialResults = (results||[]).filter(r => r.treatment === "Material Cadang");
  const maxLeadTime = Math.max(1, ...materialResults.map(r => r.leadTime||0));
  const maxGapValue = Math.max(1, ...materialResults.map(r => (r.gapQty||0) * (r.harga||0)));
  return (results||[]).map(r => {
    const health = calculateMaterialCadangHealthIndex(r, { maxLeadTime, maxGapValue });
    return { ...r, ...health };
  });
}

function buildMaterialCadangAiContext(run, results, stocks, katalogList, txns) {
  const material = (results||[]).filter(r => r.treatment === "Material Cadang");
  const topRisks = [...material].sort((a,b) => (a.healthIndex||100) - (b.healthIndex||100)).slice(0,12);
  const counts = results.reduce((acc,r)=>{
    const st = r.healthStatus || "Unclassified";
    acc[st] = (acc[st]||0)+1;
    return acc;
  }, {});
  return {
    runId: run?.id,
    createdAt: run?.createdAt,
    totalItems: results.length,
    statusCounts: counts,
    avgHealthIndex: results.length ? Math.round(results.reduce((a,r)=>a+(r.healthIndex||0),0)/results.length) : 0,
    avgDataConfidence: results.length ? Math.round(results.reduce((a,r)=>a+(r.dataConfidence||0),0)/results.length) : 0,
    totalGapQty: material.reduce((a,r)=>a+(r.gapQty||0),0),
    totalGapValue: material.reduce((a,r)=>a+((r.gapQty||0)*(r.harga||0)),0),
    topRisks: topRisks.map(r=>({
      katalogId:r.katalogId, noKatalog:r.noKat, nama:r.katalogName||r.namaMaterial, cluster:r.cluster,
      healthIndex:r.healthIndex, healthStatus:r.healthStatus, dataConfidence:r.dataConfidence,
      abcClass:r.abcClass, policy:r.policy, currentQty:r.currentQty, recommendedQty:r.recommendedQty,
      gapQty:r.gapQty, gapValue:(r.gapQty||0)*(r.harga||0), leadTime:r.leadTime,
      failure5y:r.failure5y, penggantian5y:r.penggantian5y, emergency5y:r.emergency5y,
      dataQualityFlags:r.dataQualityFlags||[], aiRecommendation:r.aiRecommendation,
    })),
  };
}

async function generateMaterialCadangAiInsights(run, results, stocks, katalogList, txns) {
  const context = buildMaterialCadangAiContext(run, results, stocks, katalogList, txns);
  const fallback = {
    id: "MCAI-" + Date.now(),
    runId: run.id,
    status: import.meta.env.VITE_GROQ_API_KEY ? "UNAVAILABLE" : "NO_API_KEY",
    model: "llama-3.3-70b-versatile",
    createdAt: Date.now(),
    executiveSummary: import.meta.env.VITE_GROQ_API_KEY ? "AI insight belum tersedia. Perhitungan Health Index lokal tetap dapat digunakan." : "AI insight belum tersedia karena VITE_GROQ_API_KEY belum diisi. Perhitungan Health Index lokal tetap dapat digunakan.",
    topRisks: context.topRisks.slice(0,5).map(r => `${r.nama} (${r.noKatalog}) - ${r.healthStatus}, HI ${r.healthIndex}`),
    dataQualityFindings: ["Gunakan tabel Health Index untuk melihat flag kualitas data per material."],
    recommendedActions: ["Review material Critical/High Risk dan ajukan apply minQty melalui approval Asman."],
    procurementPriority: context.topRisks.slice(0,5).map(r => r.noKatalog),
    validationNeeded: context.topRisks.filter(r => (r.dataConfidence||100) < 70).map(r => r.noKatalog),
    materialInsights: [],
  };
  if (!import.meta.env.VITE_GROQ_API_KEY) return fallback;
  try {
    const resp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method:"POST",
      headers:{ "Content-Type":"application/json", "Authorization":`Bearer ${import.meta.env.VITE_GROQ_API_KEY}` },
      body:JSON.stringify({
        model:"llama-3.3-70b-versatile",
        temperature:0.2,
        max_tokens:1800,
        messages:[
          { role:"system", content:`Kamu adalah AI analis manajemen Material Cadang WARNOTO PLN. Jawab hanya JSON valid. Jangan mengubah angka resmi. Beri insight manajemen singkat, audit-friendly, dan rekomendasi read-only.` },
          { role:"user", content:`Buat AI insight Health Index Material Cadang dari konteks berikut. Output JSON dengan key: executiveSummary, topRisks, dataQualityFindings, recommendedActions, procurementPriority, validationNeeded, materialInsights. materialInsights item: {noKatalog,nama,diagnosis,recommendation,confidence}. Konteks:\n${JSON.stringify(context).slice(0,14000)}` }
        ]
      })
    });
    if (!resp.ok) throw new Error(`Groq ${resp.status}`);
    const data = await resp.json();
    const text = data.choices?.[0]?.message?.content || "";
    const jsonText = text.match(/\{[\s\S]*\}/)?.[0] || text;
    const parsed = JSON.parse(jsonText);
    return { ...fallback, ...parsed, status:"ANSWERED", createdAt:Date.now(), runId:run.id };
  } catch (err) {
    return { ...fallback, status:"ERROR", errorMessage:err.message, createdAt:Date.now() };
  }
}

function mapApplyAuditRow(r) {
  return {
    id: r.auditId, apply_id: r.id, run_id: r.runId||null, katalog_id: r.katalogId||null,
    no_katalog: r.noKatalog||null, requested_min_qty: r.recommendedQty ?? null,
    previous_min_qty: null, approved_min_qty: r.appliedMinQty ?? null, action: r.action,
    actor: r.actor, acted_at: r.actedAt, note: r.notes || r.rejectReason || null, audit_payload: r,
  };
}

function UsulanKatalogTab({ maraReference, setMaraReference, katalogList, setKatalogList, currentUser, sty, C, saveToCloud, showToast }) {
  const [maraLoading, setMaraLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedRows, setSelectedRows] = useState([]); // { katalog, description, satuan, materialGroup }
  const [drafts, setDrafts] = useState([]); // usulan pending approval
  const [rejectingId, setRejectingId] = useState(null);
  const [rejectReason, setRejectReason] = useState("");

  const canApprove = hasRole(currentUser, "ASMAN","TL");
  const canEdit = hasRole(currentUser, "ADMIN","TL");

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
                  <thead style={{background:C.sidebar,color:"white",position:"sticky",top:0}}>
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

function MaterialCadangTab({ materialCadangData, setMaterialCadangData, materialCadangHealthData, setMaterialCadangHealthData, materialCadangAiInsights, setMaterialCadangAiInsights, maraReference, setMaraReference, catalogMasterRef, setCatalogMasterRef, katalogList, setKatalogList, stocks, txns, currentUser, sty, C, saveToCloud, showToast }) {
  const [subTab, setSubTab] = useState("dashboard");
  const [importing, setImporting] = useState(false);
  const [importPreview, setImportPreview] = useState(null); // { rows, stats, fileName }
  const [analisisResult, setAnalisisResult] = useState(null); // hasil hitung terbaru
  const [maraLoading, setMaraLoading] = useState(false);
  const [maraSearch, setMaraSearch] = useState("");
  const [applyConfirm, setApplyConfirm] = useState(null); // { item } yang akan di-apply ke minQty
  const [applyNotes, setApplyNotes] = useState("");
  const [detailItem, setDetailItem] = useState(null);
  const [aiInsightLoading, setAiInsightLoading] = useState(false);

  const canEdit = hasRole(currentUser, "ADMIN","TL");
  const canApprove = hasRole(currentUser, "ASMAN");

  // Guard defensif terhadap shape data lama/tidak lengkap dari localStorage/CLOUD
  // (mis. tersimpan sebelum field ini ada) — tanpa ini, akses .slice/.filter
  // langsung ke field undefined bikin seluruh halaman blank putih (belum ada
  // Error Boundary di app ini untuk menangkap crash render seperti ini).
  const mcData = { imports: materialCadangData?.imports||[], analyses: materialCadangData?.analyses||[], applyHistory: materialCadangData?.applyHistory||[] };
  const mcHealth = { imports: materialCadangHealthData?.imports||[], analysisRuns: materialCadangHealthData?.analysisRuns||[], healthResults: materialCadangHealthData?.healthResults||[], applyAudit: materialCadangHealthData?.applyAudit||[] };
  const mcAi = { runs: materialCadangAiInsights?.runs||[], materialInsights: materialCadangAiInsights?.materialInsights||[] };

  // Analisis terakhir dari data tersimpan
  const latestAnalysis = mcData.analyses.slice(-1)[0] || null;
  const latestHealthRun = mcHealth.analysisRuns.slice(-1)[0] || null;
  const latestHealthResults = latestHealthRun
    ? mcHealth.healthResults.filter(r => r.runId === latestHealthRun.id)
    : [];
  const latestResults = latestHealthResults.length ? latestHealthResults : enrichMaterialCadangHealthResults(latestAnalysis?.results || []);
  const latestAiInsight = latestHealthRun
    ? mcAi.runs.find(r => r.runId === latestHealthRun.id)
    : null;

  // Summary dari hasil analisis
  const summary = latestResults.reduce((acc, r) => {
    acc.total++;
    if (r.healthStatus) acc.healthCounts[r.healthStatus] = (acc.healthCounts[r.healthStatus]||0) + 1;
    acc.healthSum += r.healthIndex || 0;
    acc.confidenceSum += r.dataConfidence || 0;
    if (r.treatment !== "Material Cadang") { acc.persediaan++; return acc; }
    if (r.currentQty >= r.recommendedQty && r.recommendedQty > 0) acc.aman++;
    else if (r.currentQty > 0 && r.currentQty < r.recommendedQty) acc.kurang++;
    else if (r.recommendedQty > 0 && r.currentQty === 0) acc.kosong++;
    acc.gapQty += r.gapQty;
    acc.gapNilai += r.gapQty * (r.harga || 0);
    return acc;
  }, { total:0, aman:0, kurang:0, kosong:0, persediaan:0, gapQty:0, gapNilai:0, healthSum:0, confidenceSum:0, healthCounts:{} });
  summary.avgHealth = summary.total ? Math.round(summary.healthSum / summary.total) : 0;
  summary.avgConfidence = summary.total ? Math.round(summary.confidenceSum / summary.total) : 0;

  // Pending apply (menunggu Asman)
  const pendingApply = mcData.applyHistory.filter(h => h.status === "PENDING_ASMAN");

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
    const baseResults = hitungMaterialCadang(importPreview.rows, stocks, katalogList);
    const results = enrichMaterialCadangHealthResults(baseResults);
    const runId = "MCHI-" + Date.now();
    const newAnalysis = {
      id: "MCANA-" + Date.now(),
      importFileName: importPreview.fileName,
      createdBy: currentUser.id,
      createdAt: Date.now(),
      results,
      params: { periodYears:5, slMandatory:0.99, slOptimum:0.95, slEconomic:0.90 },
    };
    const importRecord = {
      id: "MCIMP-" + Date.now(),
      fileName: importPreview.fileName,
      importedBy: currentUser.id,
      importedAt: Date.now(),
      stats: importPreview.stats,
    };
    const healthRun = {
      id: runId,
      legacyAnalysisId: newAnalysis.id,
      importId: importRecord.id,
      importFileName: importPreview.fileName,
      createdBy: currentUser.id,
      createdAt: Date.now(),
      modelAi: "llama-3.3-70b-versatile",
      params: newAnalysis.params,
    };
    const healthRows = results.map(r => ({ ...r, runId, resultId:`${runId}-${r.katalogId||r.noKat}-${String(r.cluster||"").replace(/\s+/g,"_")}` }));
    const updated = { ...mcData, analyses: [...mcData.analyses, newAnalysis] };
    const updatedHealth = {
      ...mcHealth,
      imports: [...(mcHealth.imports||[]), importRecord],
      analysisRuns: [...(mcHealth.analysisRuns||[]), healthRun],
      healthResults: [...(mcHealth.healthResults||[]), ...healthRows],
    };
    setMaterialCadangData(updated);
    setMaterialCadangHealthData(updatedHealth);
    await saveToCloud({ materialCadangData: updated, materialCadangHealthData: updatedHealth });
    setAnalisisResult(healthRows);
    setSubTab("health");
    showToast("Health Index Material Cadang berhasil dihitung.", "success");

    // Backup ke Supabase (audit trail) — append-only, tidak mengubah angka
    // deterministic di atas, murni menyimpan apa yang sudah dihitung lokal.
    syncMaterialCadangRows("material_cadang_imports", [importRecord], r => ({
      id: r.id, file_name: r.fileName, imported_by: r.importedBy, imported_at: r.importedAt,
      total_rows: r.stats?.total||0, valid_rows: r.stats?.match||0, warning_rows: r.stats?.warning||0,
      invalid_rows: (r.stats?.invalid||0)+(r.stats?.unmatched||0), data_quality: r.stats||{}, raw_meta: {},
    }));
    syncMaterialCadangRows("material_cadang_analysis_runs", [healthRun], r => ({
      id: r.id, import_id: r.importId, legacy_analysis_id: r.legacyAnalysisId, created_by: r.createdBy,
      created_at: r.createdAt, model_ai: r.modelAi, params: r.params||{}, summary: {},
    }));
    syncMaterialCadangRows("material_cadang_health_results", healthRows, r => ({
      id: r.resultId, run_id: r.runId, katalog_id: r.katalogId||null, no_katalog: r.noKat||null,
      nama_material: r.katalogName||r.namaMaterial||null, health_index: r.healthIndex, health_status: r.healthStatus,
      risk_score: r.riskScore, data_confidence: r.dataConfidence, abc_class: r.abcClass, policy: r.policy,
      current_qty: r.currentQty, recommended_qty: r.recommendedQty, gap_qty: r.gapQty,
      gap_value: (r.gapQty||0)*(r.harga||0), deterministic_breakdown: r.healthBreakdown||{},
      data_quality_flags: r.dataQualityFlags||[], result_payload: r,
    }));

    setAiInsightLoading(true);
    const aiRun = await generateMaterialCadangAiInsights(healthRun, healthRows, stocks, katalogList, txns);
    const materialInsights = (aiRun.materialInsights||[]).map((m, idx)=>({ ...m, id:`${aiRun.id}-MI-${idx}`, runId }));
    const updatedAi = {
      runs: [...(mcAi.runs||[]), { ...aiRun, materialInsights: undefined }],
      materialInsights: [...(mcAi.materialInsights||[]), ...materialInsights],
    };
    setMaterialCadangAiInsights(updatedAi);
    await saveToCloud({ materialCadangAiInsights: updatedAi });
    setAiInsightLoading(false);
    if (aiRun.status === "ANSWERED") showToast("AI Management Insight berhasil dibuat.", "success");
    else showToast("Health Index selesai. AI insight belum tersedia, data lokal tetap aman.", "error");

    // Backup insight ke Supabase — 1 baris scope RUN (ringkasan) + N baris scope
    // MATERIAL (per item). AI cuma menulis kolom insight/diagnosis/rekomendasi,
    // tidak ada kolom angka resmi (healthIndex dst) di tabel ini sama sekali.
    const runInsightRow = {
      id: aiRun.id, runId: aiRun.runId, insight_scope: "RUN", model: aiRun.model, status: aiRun.status,
      confidence: null, executive_summary: aiRun.executiveSummary||null, diagnosis: null, recommendation: null,
      flags: aiRun.dataQualityFindings||[], created_at: aiRun.createdAt,
      insight_payload: { topRisks: aiRun.topRisks, recommendedActions: aiRun.recommendedActions, procurementPriority: aiRun.procurementPriority, validationNeeded: aiRun.validationNeeded },
    };
    syncMaterialCadangRows("material_cadang_ai_insights", [runInsightRow], r => ({
      id: r.id, run_id: r.runId, no_katalog: null, insight_scope: r.insight_scope, model: r.model,
      status: r.status, confidence: r.confidence, executive_summary: r.executive_summary,
      diagnosis: r.diagnosis, recommendation: r.recommendation, flags: r.flags, insight_payload: r.insight_payload,
      created_at: r.created_at,
    }));
    if (materialInsights.length) {
      syncMaterialCadangRows("material_cadang_ai_insights", materialInsights, r => ({
        id: r.id, run_id: r.runId, no_katalog: r.noKatalog||null, insight_scope: "MATERIAL", model: aiRun.model,
        status: aiRun.status, confidence: r.confidence ?? null, executive_summary: null,
        diagnosis: r.diagnosis||null, recommendation: r.recommendation||null, flags: [], insight_payload: r,
        created_at: aiRun.createdAt,
      }));
    }
  }

  async function handleAjukanApply(item) {
    const existing = mcData.applyHistory.find(h => h.katalogId === item.katalogId && h.status === "PENDING_ASMAN");
    if (existing) { showToast("Pengajuan untuk material ini sudah ada, tunggu keputusan Asman.", "error"); return; }
    const entry = {
      id: "MCAPPLY-" + Date.now(),
      katalogId: item.katalogId,
      namaBarang: item.katalogName || item.namaMaterial,
      noKatalog: item.noKat,
      recommendedQty: item.recommendedQty,
      abcClass: item.abcClass,
      policy: item.policy,
      runId: item.runId,
      healthIndex: item.healthIndex,
      healthStatus: item.healthStatus,
      status: "PENDING_ASMAN",
      requestedBy: currentUser.id,
      requestedAt: Date.now(),
      notes: applyNotes.trim(),
    };
    const updated = { ...mcData, applyHistory: [...mcData.applyHistory, entry] };
    const auditEntry = { ...entry, auditId:`${entry.id}-REQ`, action:"REQUEST_APPLY_MIN_QTY", actor:currentUser.id, actedAt:Date.now() };
    const updatedHealth = {
      ...mcHealth,
      applyAudit: [...(mcHealth.applyAudit||[]), auditEntry],
    };
    setMaterialCadangData(updated);
    setMaterialCadangHealthData(updatedHealth);
    await saveToCloud({ materialCadangData: updated, materialCadangHealthData: updatedHealth });
    syncMaterialCadangRows("material_cadang_apply_audit", [auditEntry], mapApplyAuditRow);
    setApplyConfirm(null); setApplyNotes("");
    showToast("Pengajuan apply minQty dikirim ke Asman.", "success");
  }

  async function handleApproveApply(applyId) {
    const entry = mcData.applyHistory.find(h => h.id === applyId);
    if (!entry) return;
    // Update minQty di katalogList
    const updated = katalogList.map(k =>
      k.id === entry.katalogId ? { ...k, minQty: entry.recommendedQty, minQtyUpdatedAt: Date.now(), minQtyUpdatedBy: currentUser.id } : k
    );
    setKatalogList(updated);
    // Tandai apply sebagai APPROVED
    const updatedMC = {
      ...mcData,
      applyHistory: mcData.applyHistory.map(h =>
        h.id===applyId ? {...h, status:"APPROVED", approvedBy:currentUser.id, approvedAt:Date.now()} : h
      )
    };
    const approveAuditEntry = { ...entry, auditId:`${applyId}-APPROVE-${Date.now()}`, action:"APPROVE_APPLY_MIN_QTY", actor:currentUser.id, actedAt:Date.now(), appliedMinQty:entry.recommendedQty };
    const updatedHealth = {
      ...mcHealth,
      applyAudit: [...(mcHealth.applyAudit||[]), approveAuditEntry],
    };
    setMaterialCadangData(updatedMC);
    setMaterialCadangHealthData(updatedHealth);
    await saveToCloud({ katalogList: updated, materialCadangData: updatedMC, materialCadangHealthData: updatedHealth });
    syncMaterialCadangRows("material_cadang_apply_audit", [approveAuditEntry], mapApplyAuditRow);
    showToast(`Min Qty ${entry.namaBarang} berhasil diperbarui ke ${entry.recommendedQty}.`, "success");
  }

  async function handleRejectApply(applyId, reason) {
    const entry = mcData.applyHistory.find(h => h.id === applyId);
    const updated = {
      ...mcData,
      applyHistory: mcData.applyHistory.map(h => h.id===applyId ? {...h, status:"REJECTED", rejectedBy:currentUser.id, rejectedAt:Date.now(), rejectReason:reason} : h)
    };
    const rejectAuditEntry = { ...(entry||{}), auditId:`${applyId}-REJECT-${Date.now()}`, action:"REJECT_APPLY_MIN_QTY", actor:currentUser.id, actedAt:Date.now(), rejectReason:reason };
    const updatedHealth = {
      ...mcHealth,
      applyAudit: [...(mcHealth.applyAudit||[]), rejectAuditEntry],
    };
    setMaterialCadangData(updated);
    setMaterialCadangHealthData(updatedHealth);
    await saveToCloud({ materialCadangData: updated, materialCadangHealthData: updatedHealth });
    syncMaterialCadangRows("material_cadang_apply_audit", [rejectAuditEntry], mapApplyAuditRow);
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
  const latestMaterialInsights = latestHealthRun
    ? mcAi.materialInsights.filter(m => m.runId === latestHealthRun.id)
    : [];
  const aiByNoKatalog = {};
  latestMaterialInsights.forEach(m => { if (m.noKatalog) aiByNoKatalog[normalizeKatalog(m.noKatalog)] = m; });
  const TABS = [
    {id:"health",label:"Health Index"},
    {id:"ai",label:"AI Insight"},
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
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))",gap:12,marginBottom:16}}>
                {[
                  {label:"Critical",val:summary.healthCounts.Critical||0,color:"#dc2626"},
                  {label:"High Risk",val:summary.healthCounts["High Risk"]||0,color:"#ea580c"},
                  {label:"Watch",val:summary.healthCounts.Watch||0,color:"#f59e0b"},
                  {label:"Healthy",val:summary.healthCounts.Healthy||0,color:"#16a34a"},
                  {label:"Avg Health",val:summary.avgHealth+"/100",color:C.accent},
                  {label:"Data Confidence",val:summary.avgConfidence+"%",color:"#0f766e"},
                ].map(kpi=>(
                  <div key={kpi.label} style={{...sty.card,borderLeft:`4px solid ${kpi.color}`,padding:12}}>
                    <div style={{fontSize:11,color:C.muted,marginBottom:4,fontWeight:700}}>{kpi.label}</div>
                    <div style={{fontSize:20,fontWeight:900,color:kpi.color}}>{kpi.val}</div>
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

      {/* HEALTH INDEX */}
      {subTab==="health" && (
        <div>
          {displayResults.length === 0 ? (
            <div style={{...sty.card,textAlign:"center",padding:30,color:C.muted}}>Belum ada Health Index. Upload dan hitung data Material Cadang terlebih dahulu.</div>
          ) : (
            <div style={{...sty.card,padding:0,overflowX:"auto"}}>
              <table style={{width:"100%",borderCollapse:"collapse",fontSize:11,minWidth:1100}}>
                <thead style={{background:C.sidebar,color:"white"}}>
                  <tr>
                    {["No Katalog","Nama Material","Health Index","Status","Confidence","Kelas","Policy","Stok","Ideal","Gap","Nilai Gap","AI Recommendation"].map(h=>(
                      <th key={h} style={{padding:"8px 10px",textAlign:"left",whiteSpace:"nowrap"}}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[...displayResults].sort((a,b)=>(a.healthIndex||100)-(b.healthIndex||100)).map((r,i)=>{
                    const ai = aiByNoKatalog[normalizeKatalog(r.noKat)];
                    const rec = ai?.recommendation || r.aiRecommendation || "Monitor Saja";
                    return (
                      <tr key={i} style={{borderBottom:`1px solid ${C.border}`,cursor:"pointer"}} onClick={()=>setDetailItem(r)}>
                        <td style={{padding:"6px 10px",color:"#0098da",fontWeight:700}}>{r.noKat}</td>
                        <td style={{padding:"6px 10px",maxWidth:200,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{r.katalogName||r.namaMaterial}</td>
                        <td style={{padding:"6px 10px",fontWeight:900,color:r.healthColor}}>{r.healthIndex}</td>
                        <td style={{padding:"6px 10px"}}><span style={{padding:"2px 8px",borderRadius:999,background:r.healthBg,color:r.healthColor,fontWeight:800,fontSize:10}}>{r.healthStatus}</span></td>
                        <td style={{padding:"6px 10px",fontWeight:700,color:(r.dataConfidence||0)<70?C.red:C.green}}>{r.dataConfidence}%</td>
                        <td style={{padding:"6px 10px",fontWeight:700}}>{r.abcClass}</td>
                        <td style={{padding:"6px 10px",fontSize:10,color:C.muted}}>{r.policy}</td>
                        <td style={{padding:"6px 10px",fontWeight:700}}>{r.currentQty}</td>
                        <td style={{padding:"6px 10px",fontWeight:700}}>{r.recommendedQty}</td>
                        <td style={{padding:"6px 10px",fontWeight:700,color:r.gapQty>0?C.red:C.green}}>{r.gapQty>0?"-"+r.gapQty:0}</td>
                        <td style={{padding:"6px 10px",color:r.gapQty>0?"#7c3aed":C.muted}}>{r.gapQty>0?"Rp "+fmtNum(r.gapQty*(r.harga||0)):"-"}</td>
                        <td style={{padding:"6px 10px",fontWeight:700,color:rec==="Prioritaskan Pengadaan"?C.red:rec==="Ajukan Apply Min Qty"?"#f59e0b":C.muted}}>{rec}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* AI INSIGHT */}
      {subTab==="ai" && (
        <div>
          {!latestAiInsight ? (
            <div style={{...sty.card,textAlign:"center",padding:30,color:C.muted}}>
              {aiInsightLoading ? "AI sedang menyusun insight manajemen..." : "AI insight belum tersedia. Jalankan Import & Hitung untuk membuat insight."}
            </div>
          ) : (
            <div style={{display:"grid",gridTemplateColumns:"minmax(0,1.2fr) minmax(280px,.8fr)",gap:14}}>
              <div style={{...sty.card}}>
                <div style={{fontSize:11,color:C.muted,fontWeight:800,textTransform:"uppercase",marginBottom:6}}>Executive Summary</div>
                <div style={{fontSize:14,lineHeight:1.6,fontWeight:600,marginBottom:16}}>{latestAiInsight.executiveSummary}</div>
                <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(220px,1fr))",gap:12}}>
                  <div>
                    <div style={{fontWeight:800,fontSize:13,marginBottom:8,color:C.red}}>Top Risks</div>
                    {(latestAiInsight.topRisks||[]).slice(0,8).map((x,i)=><div key={i} style={{fontSize:12,padding:"5px 0",borderBottom:`1px solid ${C.border}`}}>{typeof x==="string"?x:(x.nama||x.noKatalog||JSON.stringify(x))}</div>)}
                  </div>
                  <div>
                    <div style={{fontWeight:800,fontSize:13,marginBottom:8,color:"#f59e0b"}}>Data Quality Findings</div>
                    {(latestAiInsight.dataQualityFindings||[]).slice(0,8).map((x,i)=><div key={i} style={{fontSize:12,padding:"5px 0",borderBottom:`1px solid ${C.border}`}}>{typeof x==="string"?x:JSON.stringify(x)}</div>)}
                  </div>
                </div>
              </div>
              <div style={{...sty.card}}>
                <div style={{fontWeight:800,fontSize:13,marginBottom:10}}>Recommended Actions</div>
                {(latestAiInsight.recommendedActions||[]).slice(0,10).map((x,i)=><div key={i} style={{fontSize:12,padding:"7px 0",borderBottom:`1px solid ${C.border}`}}>{typeof x==="string"?x:JSON.stringify(x)}</div>)}
                <div style={{fontWeight:800,fontSize:13,marginTop:16,marginBottom:8}}>Validation Needed</div>
                {(latestAiInsight.validationNeeded||[]).length===0 ? <div style={{fontSize:12,color:C.muted}}>Tidak ada material yang ditandai wajib validasi.</div> : (latestAiInsight.validationNeeded||[]).slice(0,12).map((x,i)=><span key={i} style={{display:"inline-block",fontSize:11,fontWeight:700,color:"#92400e",background:"#fef3c7",borderRadius:999,padding:"3px 8px",margin:"0 5px 5px 0"}}>{typeof x==="string"?x:(x.noKatalog||JSON.stringify(x))}</span>)}
                <div style={{fontSize:10,color:C.muted,marginTop:12}}>Status: {latestAiInsight.status || "-"} {latestAiInsight.errorMessage ? `- ${latestAiInsight.errorMessage}` : ""}</div>
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
                  <thead style={{position:"sticky",top:0,background:C.sidebar,color:"white"}}>
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
                <thead style={{background:C.sidebar,color:"white"}}>
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
                    const hasPending = mcData.applyHistory.find(h=>h.katalogId===r.katalogId&&h.status==="PENDING_ASMAN");
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
                      <button style={sty.btn("primary","sm")} onClick={()=>handleApproveApply(h.id)}>Setuju & Apply Min Qty</button>
                      <button style={sty.btn("danger","sm")} onClick={()=>handleRejectApply(h.id, "Ditolak Asman")}>Tolak</button>
                    </div>
                  )}
                  {false && canApprove && (
                    <div style={{display:"flex",gap:8,marginTop:10}}>
                      <button style={sty.btn("primary","sm")} onClick={async ()=>{
                        const updated = {...mcData, applyHistory: mcData.applyHistory.map(x=>x.id===h.id?{...x,status:"APPROVED_APPLIED",decidedBy:currentUser.id,decidedAt:Date.now()}:x)};
                        setMaterialCadangData(updated);
                        await saveToCloud({materialCadangData:updated});
                        showToast("Apply minQty disetujui.", "success");
                      }}>✅ Setuju</button>
                      <button style={sty.btn("danger","sm")} onClick={async ()=>{
                        const updated = {...mcData, applyHistory: mcData.applyHistory.map(x=>x.id===h.id?{...x,status:"REJECTED",decidedBy:currentUser.id,decidedAt:Date.now()}:x)};
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
            <div style={{marginTop:12,padding:10,background:detailItem.healthBg||"#f8fafc",border:`1px solid ${detailItem.healthColor||C.border}`,borderRadius:8}}>
              <div style={{display:"flex",justifyContent:"space-between",gap:12,alignItems:"center",marginBottom:8}}>
                <div>
                  <div style={{fontSize:10,color:C.muted,fontWeight:800,textTransform:"uppercase"}}>Health Index</div>
                  <div style={{fontSize:24,fontWeight:900,color:detailItem.healthColor||C.text}}>{detailItem.healthIndex ?? "-"} / 100</div>
                </div>
                <span style={{padding:"4px 10px",borderRadius:999,background:"white",color:detailItem.healthColor||C.text,fontWeight:900,fontSize:11}}>{detailItem.healthStatus||"-"}</span>
              </div>
              {detailItem.healthBreakdown && (
                <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(120px,1fr))",gap:8,fontSize:11}}>
                  {Object.entries(detailItem.healthBreakdown).map(([k,v])=>(
                    <div key={k}><span style={{color:C.muted}}>{k}</span><div style={{fontWeight:800}}>{v}</div></div>
                  ))}
                </div>
              )}
            </div>
            {aiByNoKatalog[normalizeKatalog(detailItem.noKat)] && (
              <div style={{marginTop:12,padding:10,background:"#eff6ff",border:"1px solid #bfdbfe",borderRadius:8,fontSize:12}}>
                <div style={{fontWeight:800,color:"#1d4ed8",marginBottom:6}}>AI Insight</div>
                <div><b>Diagnosis:</b> {aiByNoKatalog[normalizeKatalog(detailItem.noKat)].diagnosis || "-"}</div>
                <div style={{marginTop:4}}><b>Rekomendasi:</b> {aiByNoKatalog[normalizeKatalog(detailItem.noKat)].recommendation || detailItem.aiRecommendation || "-"}</div>
              </div>
            )}
            {(detailItem.dataQualityFlags||[]).length > 0 && (
              <div style={{marginTop:8,padding:8,background:"#fff7ed",borderRadius:6,fontSize:11,color:"#9a3412"}}>
                Data flags: {detailItem.dataQualityFlags.join(" | ")}
              </div>
            )}
            {canEdit && detailItem.treatment==="Material Cadang" && detailItem.recommendedQty>0 && (
              <div style={{display:"flex",justifyContent:"flex-end",gap:8,marginTop:14}}>
                {mcData.applyHistory.find(h=>h.katalogId===detailItem.katalogId&&h.status==="PENDING_ASMAN")
                  ? <span style={{fontSize:11,color:"#f59e0b",fontWeight:800}}>Pengajuan apply minQty sedang menunggu Asman</span>
                  : <button style={sty.btn("primary","sm")} onClick={()=>{ setApplyConfirm(detailItem); setDetailItem(null); }}>Ajukan Apply Min Qty</button>
                }
              </div>
            )}
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
    // Delegasi ke parseIndoNumber global (standarisasi 1 aturan titik/koma di semua import,
    // 2026-07-07) — cuma beda di sini: string kosong balikin NaN (bukan 0), supaya pemanggil di
    // bawah (normPct/normNum, lat/lng) tetap bisa bedakan "kosong/tidak diisi" dari "memang 0".
    const s = String(v==null?"":v).trim();
    if (!s) return NaN;
    return parseIndoNumber(s);
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
  const canEdit = hasRole(currentUser, "ADMIN","TL");

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
              <thead style={{background:C.sidebar,color:"white",position:"sticky",top:0}}>
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
                    <td style={{padding:"5px 8px"}}><span style={{fontSize:10,fontWeight:700,color:r.statusKapasitas==="KRITIS"?C.red:r.statusKapasitas==="WASPADA"?"#f59e0b":C.green}}>{KAPASITAS_LABEL[r.statusKapasitas]||r.statusKapasitas}</span></td>
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



// ════════════════════════════════════════════════════════════════════
// MIGRASI DATA TAB
// ════════════════════════════════════════════════════════════════════
function MigrasiDataTab({ stocks, katalogList, lokasiList, txns, migratedTug15History, setMigratedTug15History, migrasiPendingReview, setMigrasiPendingReview, maraReference, setMaraReference, maraUploadLoading, maraUploadProgress, uploadMaraToDB, currentUser, sty, C, saveToCloud, setStocks, setKatalogList, setTxns, showToast }) {
  const [step, setStep] = useState("upload"); // "upload" | "preview" | "backup" | "done"
  const [sapFile, setSapFile] = useState(null);
  const [sapRows, setSapRows] = useState([]);
  // Baris "Match WARNOTO" (sudah ada di katalog) TIDAK ditimpa secara default —
  // Admin harus centang eksplisit per baris kalau memang mau timpa dengan data
  // import ini (2026-07-04, permintaan user: jangan pernah timpa data existing
  // diam-diam).
  const [overwriteRows, setOverwriteRows] = useState(new Set());
  const [applyProgress, setApplyProgress] = useState(""); // teks progres tahap-per-tahap saat Apply Cutover, supaya kelihatan jalan/stuck
  const [applyProgressPct, setApplyProgressPct] = useState(0); // 0-100, dipakai bareng applyProgress untuk progress bar bernomor
  const [lastCutoverSummary, setLastCutoverSummary] = useState(null); // ringkasan hasil cutover terakhir, ditampilkan di step "done"
  const [nonSapRows, setNonSapRows] = useState([]);
  const [parsedSAP, setParsedSAP] = useState([]);
  const [parsedNonSAP, setParsedNonSAP] = useState([]);
  const [previewStats, setPreviewStats] = useState(null);
  const [busy, setBusy] = useState(false);
  const [maraLoading, setMaraLoading] = useState(false);

  // Parse CSV SAP format PEMAT
  // Referensi format export SAP (diajarkan user 2026-07-02, lihat memory
  // warnoto_sap_export_format.md): Plant=kode UPT (3611=UPT Surabaya),
  // Material Type ZST1=Persediaan/ZCAD=Cadang (sumber utama), panjang kode
  // katalog (10 digit=Cadang) TETAP dipakai sebagai referensi pembanding/
  // validasi silang (bukan cuma fallback) — kalau dua sinyal ini beda,
  // di-flag `materialTypeMismatch` untuk direview, bukan diam-diam dipilih
  // salah satu. Valuation Type (BURSA/PRE-MEMORY) HANYA berlaku untuk
  // sub-klasifikasi material Persediaan (ZST1) — kalau ZCAD (Cadang), jangan
  // di-override jadi Bursa/Pre-Memory walau valType kebetulan cocok string-nya.
  // Quality Inspection/Blocked/In Transit Stock TIDAK auto-include maupun
  // auto-exclude ke qty utama — cuma di-flag `needsStockReview` supaya Admin
  // yang putuskan manual di preview, sesuai instruksi eksplisit user.
  function parseSAPMigration(rows) {
    return rows.map(row => {
      const material = String(row["Material"]||row["material"]||"").trim();
      const noKat = normalizeKatalog(material);
      const desc = String(row["Material Description"]||row["material description"]||"").trim();
      const satuan = String(row["Base Unit of Measure"]||"").trim() || "BH";
      // Dulu SELALU menghapus semua titik dulu baru konversi koma — kalau nilai aslinya pakai
      // titik sebagai TANDA DESIMAL (mis. "103.5", bukan ribuan), titiknya ikut terhapus jadi
      // "1035" (SANGAT BERBAHAYA, qty stok terdistorsi 10x). Sekarang pakai parseIndoNumber yang
      // membedakan titik-ribuan vs titik-desimal berdasar polanya, bukan asumsi buta (bug
      // dilaporkan user 2026-07-07).
      const qty = parseIndoNumber(row["Unrestricted Use Stock"]||row["unrestricted use stock"]);
      const valType = String(row["Valuation Type"]||"").trim().toUpperCase();
      const harga = parseIndoNumber(row["Harga Satuan"]);
      const materialType = String(row["Material Type"]||"").trim().toUpperCase();
      const plant = String(row["Plant"]||"").trim();
      const qiStock = parseIndoNumber(row["Quality Inspection Stock"]);
      const blockedStock = parseIndoNumber(row["Blocked Stock"]);
      const transitStock = parseIndoNumber(row["In Transit Stock"]);

      const kodePanjang10 = noKat.length === 10;
      let jenisBarang;
      if (materialType === "ZCAD") jenisBarang = "Cadang";
      else if (materialType === "ZST1") jenisBarang = "Persediaan";
      else jenisBarang = kodePanjang10 ? "Cadang" : "Persediaan"; // Material Type tidak dikenali, andalkan panjang kode
      // Valuation Type cuma sub-klasifikasi untuk jalur Persediaan (ZST1) — default "Persediaan"
      // (normal) kalau bukan BURSA/PRE-MEMORY. Tidak berlaku untuk Cadang (ZCAD).
      if (jenisBarang === "Persediaan") {
        if (valType === "BURSA") jenisBarang = "Persediaan Bursa";
        else if (valType === "PRE-MEMORY") jenisBarang = "Pre Memory";
      }
      // Validasi silang: Material Type vs panjang kode katalog beda sinyal -> flag review,
      // bukan diam-diam pilih salah satu (cuma relevan kalau Material Type dikenali).
      const materialTypeMismatch = (materialType==="ZCAD" && !kodePanjang10) || (materialType==="ZST1" && kodePanjang10);

      const plantMismatch = !!(plant && plant !== "3611");
      const needsStockReview = qiStock>0 || blockedStock>0 || transitStock>0;

      return { noKat, material, desc, satuan, qty, jenisBarang, harga, valType, materialType, plant, qiStock, blockedStock, transitStock, plantMismatch, needsStockReview, materialTypeMismatch, _valid: noKat.length > 0 && qty >= 0 };
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

  // BUG DITEMUKAN 2026-07-02: matchMara sebelumnya cek ke `maraReference` (state session-only,
  // diisi lewat tombol upload TERPISAH khusus di tab ini) — BUKAN tabel Supabase `mara_catalog`
  // yang sungguhan dipakai user (42.703 baris, diupload lewat Master Data → Master Katalog).
  // Karena user tidak pernah upload lewat tombol yang di tab ini, maraReference selalu kosong,
  // jadi SEMUA baris salah tampil "tidak match MARA". Fix: query mara_catalog langsung, dengan
  // normalisasi kode (MARA pakai 15 digit zero-padded, App pakai kode pendek tanpa padding —
  // sama seperti bug yang sudah pernah difix di applyMaraToKatalog/backfill kategori).
  async function buildPreview() {
    setBusy(true);
    setApplyProgress("🔄 Menyiapkan perbandingan data...");
    setApplyProgressPct(2);
    const warnotoSet = new Set(katalogList.map(k=>normalizeKatalog(k.katalog)));

    // BUG DITEMUKAN 2026-07-04: query tanpa .range() cuma balikin ~1000 baris
    // pertama (default limit PostgREST/Supabase) — mara_catalog punya 42.703
    // baris, jadi kode yang bukan di 1000 baris pertama SELALU "tidak match"
    // walau sebenarnya ada di referensi MARA (dikonfirmasi manual oleh user).
    // Fix: ambil semua baris per halaman 1000 sampai habis. Ini butuh puluhan
    // request berurutan (~43 halaman untuk 42.703 baris) — kasih progress
    // bernomor 1-100% per halaman supaya kelihatan jalan, bukan stuck
    // (permintaan user 2026-07-04).
    let maraSet = new Set();
    if (supabase) {
      // Hitung dulu total baris supaya persentase progres akurat (bukan cuma teks).
      const { count: maraTotal } = await supabase.from("mara_catalog").select("*", { count: "exact", head: true });
      let from = 0;
      const pageSize = 1000;
      let fetchError = null;
      let page = 1;
      while (true) {
        const pct = maraTotal ? Math.min(98, 5 + Math.round((from / maraTotal) * 85)) : Math.min(90, 5 + page * 5);
        setApplyProgressPct(pct);
        setApplyProgress(`📥 Memuat referensi MARA (${maraSet.size}${maraTotal?`/${maraTotal}`:""} kode terbaca)...`);
        const { data, error } = await supabase.from("mara_catalog").select("kode_material").range(from, from + pageSize - 1);
        if (error) { fetchError = error; break; }
        if (!data || data.length === 0) break;
        data.forEach(m => maraSet.add(m.kode_material.replace(/^0+/, "")));
        if (data.length < pageSize) break;
        from += pageSize;
        page++;
      }
      if (fetchError) showToast("Gagal cek referensi MARA: " + fetchError.message, "error");
    }
    setApplyProgressPct(95);
    setApplyProgress("🧮 Menghitung status match & selisih qty...");

    // Qty existing di aplikasi per No Katalog (dijumlah semua lokasi) — dipakai
    // untuk banding qty file upload vs qty aplikasi (permintaan user 2026-07-04):
    // sama persis → "Match", beda → otomatis tandai opsi Timpa (bukan cuma
    // tersedia, tapi di-pre-check) supaya Admin sadar ada selisih qty.
    const qtyByKatalog = new Map();
    stocks.forEach(s => {
      const k = katalogList.find(kk=>kk.id===s.katalogId);
      if (!k) return;
      const kode = normalizeKatalog(k.katalog);
      qtyByKatalog.set(kode, (qtyByKatalog.get(kode)||0) + (s.qty||0));
    });

    const sapResult = sapRows.map(r => {
      const matchWarnoto = warnotoSet.has(r.noKat);
      const existingQty = matchWarnoto ? (qtyByKatalog.get(r.noKat)||0) : null;
      const qtyMatch = matchWarnoto ? existingQty === r.qty : null;
      return {
        ...r,
        matchWarnoto,
        matchMara: maraSet.has(r.noKat),
        existingQty,
        qtyMatch,
      };
    });
    // Baris matched dengan qty BEDA otomatis di-pre-check "Timpa" (bukan dipaksa,
    // Admin masih bisa un-check kalau memang mau pertahankan qty existing) —
    // baris dengan qty SAMA tidak perlu keputusan apa-apa, dibiarkan default.
    setOverwriteRows(new Set(sapResult.filter(r=>r.matchWarnoto && r.qtyMatch===false).map(r=>r.noKat)));

    const byJenis = {};
    sapResult.forEach(r => { byJenis[r.jenisBarang] = (byJenis[r.jenisBarang]||0) + 1; });

    const totalQty = sapResult.reduce((s,r)=>s+r.qty,0);
    const totalNilai = sapResult.reduce((s,r)=>s+(r.qty*r.harga),0);

    setPreviewStats({ sapResult, byJenis, totalQty, totalNilai });
    setApplyProgressPct(100);
    setStep("preview");
    setBusy(false);
    setApplyProgress("");
    setApplyProgressPct(0);
  }

  // Recompute ringkasan (byJenis/totalQty/totalNilai) setelah sapResult diubah manual di preview.
  function recomputeStats(sapResult) {
    const byJenis = {};
    sapResult.forEach(r => { byJenis[r.jenisBarang] = (byJenis[r.jenisBarang]||0) + 1; });
    const totalQty = sapResult.reduce((s,r)=>s+r.qty,0);
    const totalNilai = sapResult.reduce((s,r)=>s+(r.qty*r.harga),0);
    return { sapResult, byJenis, totalQty, totalNilai };
  }
  // Aksi review manual: gabung qty Quality Inspection/Blocked/In Transit ke qty utama (Unrestricted).
  function moveReviewToUnrestricted(noKat) {
    setPreviewStats(ps => {
      if (!ps) return ps;
      const sapResult = ps.sapResult.map(r => {
        if (r.noKat !== noKat) return r;
        const tambahan = (r.qiStock||0) + (r.blockedStock||0) + (r.transitStock||0);
        return { ...r, qty: r.qty + tambahan, qiStock:0, blockedStock:0, transitStock:0, needsStockReview:false };
      });
      return recomputeStats(sapResult);
    });
    showToast(`Qty review digabung ke Unrestricted untuk ${noKat}.`, "success");
  }
  // Aksi review manual: keluarkan baris ini total dari daftar yang akan diimpor.
  function removeFromImportList(noKat) {
    setPreviewStats(ps => {
      if (!ps) return ps;
      const sapResult = ps.sapResult.filter(r => r.noKat !== noKat);
      return recomputeStats(sapResult);
    });
    showToast(`${noKat} dihapus dari daftar impor.`, "success");
  }

  async function handleBackupAndApply() {
    if (!previewStats) return;
    setBusy(true);
    setApplyProgressPct(5);
    setApplyProgress("⏳ Menyiapkan backup JSON...");
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

      setApplyProgressPct(25);
      setApplyProgress("🔄 Menghitung baris yang perlu diperbarui...");

      // 2. Build katalog — MERGE ke katalogList existing, BUKAN timpa total. Bug lama: array
      // hasil cuma berisi baris dari file yang lagi diupload (previewStats.sapResult), jadi
      // upload kedua (mis. file Material Cadang setelah Persediaan) menghapus semua katalog/
      // stok dari upload pertama yang tidak ada di file kedua. Sekarang mulai dari list
      // existing, cuma upsert baris yang ada di file ini — baris lain yang tidak disentuh
      // TETAP ada.
      // Baris "Match WARNOTO" (sudah ada di katalog): DEFAULT dibiarkan apa adanya,
      // hanya ditimpa kalau Admin eksplisit centang "Timpa" untuk baris itu
      // (overwriteRows). Baris baru (tidak match) TIDAK langsung masuk ke
      // katalogList/stocks — dikumpulkan ke antrian migrasiPendingReview,
      // menunggu Admin approve satu-satu (2026-07-04).
      const now = Date.now();
      const katalogById = new Map(katalogList.map(k=>[normalizeKatalog(k.katalog), k]));
      const newPendingReview = [];
      previewStats.sapResult.forEach(r => {
        const existing = katalogById.get(r.noKat);
        if (existing) {
          if (overwriteRows.has(r.noKat)) {
            katalogById.set(r.noKat, { ...existing, jenisBarang: r.jenisBarang, satuan: r.satuan || existing.satuan });
          }
          // else: biarkan data existing apa adanya, tidak disentuh.
        } else {
          newPendingReview.push({
            id: "MIGREV-" + r.noKat + "-" + now,
            noKat: r.noKat,
            desc: r.desc,
            satuan: r.satuan,
            jenisBarang: r.jenisBarang,
            harga: r.harga,
            qty: r.qty,
            sourceFile: sapFile || "",
            status: "PENDING",
            requestedBy: currentUser.id,
            requestedAt: now,
          });
        }
      });
      const newKatalog = Array.from(katalogById.values());
      const updatedPendingReview = [...(migrasiPendingReview||[]), ...newPendingReview];

      // 3. Build stocks — HANYA update qty/harga baris yang match DAN ditandai timpa.
      // Baris baru TIDAK dibuat di sini (masuk migrasiPendingReview di atas, baru
      // dibuat stok-nya kalau Admin approve).
      // BUG DITEMUKAN 2026-07-04: kalau 1 katalog punya >1 baris stok (beda lokasi/blok),
      // Map stockByKode dulu cuma nyimpen baris TERAKHIR (yang lain ketiban/hilang dari
      // Map) — qty SAP (angka total, bukan per-lokasi) ditimpakan ke SATU baris lokasi
      // secara acak, baris lokasi lain dibiarkan basi. User laporkan "data stock tidak
      // update" — akar masalahnya kemungkinan ini untuk katalog yang stoknya tersebar di
      // banyak lokasi. Fix: kalau katalog ini py >1 baris stok, JANGAN auto-update (kita
      // tidak tahu qty SAP itu harus dialokasikan ke lokasi mana) — masukkan ke daftar
      // multiLokasiSkipped, biar Admin sesuaikan manual per lokasi lewat Edit Data Stok.
      const stocksByKode = new Map(); // kode -> array baris stok
      stocks.forEach(s => {
        const k = katalogList.find(kk=>kk.id===s.katalogId);
        if (!k) return;
        const kode = normalizeKatalog(k.katalog);
        if (!stocksByKode.has(kode)) stocksByKode.set(kode, []);
        stocksByKode.get(kode).push(s);
      });
      const multiLokasiSkipped = [];
      const stocksById = new Map(stocks.map(s=>[s.id, s]));
      previewStats.sapResult.filter(r=>r.qty>0 && overwriteRows.has(r.noKat)).forEach(r => {
        const kat = katalogById.get(r.noKat);
        if (!kat) return; // baru/tidak match — ditangani lewat pending review
        const rows = stocksByKode.get(r.noKat) || [];
        if (rows.length > 1) {
          multiLokasiSkipped.push({ noKat: r.noKat, desc: r.desc, qtyFile: r.qty, lokasiCount: rows.length });
          return; // ambigu, jangan auto-timpa salah satu lokasi — Admin sesuaikan manual
        }
        // rows.length===0: BUG DITEMUKAN 2026-07-04 — sebelumnya kasus ini malah
        // di-skip diam-diam (katalog match tapi belum pernah punya baris stok
        // sama sekali), jadi katalog "masuk" tapi Data Stok Gudang tetap 0 baris.
        // Sekarang: kalau belum ada baris stok, BUAT baris baru (bukan cuma
        // update baris existing) — sama seperti perilaku untuk item benar-benar
        // baru, cuma katalog-nya sudah ada duluan.
        // BUG DITEMUKAN 2026-07-04 (laporan kedua): default ke lokasiList[0] (lokasi
        // PERTAMA di seluruh Master Lokasi, tidak ada hubungannya dengan file yang
        // diupload — kolom Storage Location di SAP memang sengaja diabaikan, jadi
        // WARNOTO tidak punya info lokasi real untuk item baru). Sekarang dibiarkan
        // KOSONG ("— Belum diisi —") — Admin isi manual lewat dropdown Gudang/Blok
        // yang sudah ada di Data Stok, bukan ditebak sistem.
        const existing = rows[0] || null;
        const row = {
          ...(existing || {}),
          id: existing?.id || ("STK-MIG-"+r.noKat+"-"+now),
          katalogId: kat.id,
          lokasiId: existing?.lokasiId || null,
          qty: r.qty,
          price: r.harga || existing?.price || 0,
          minQty: existing?.minQty || 0,
          unit: r.satuan,
          jenisBarang: r.jenisBarang,
          name: r.desc,
          katalog: r.noKat,
          category: existing?.category || r.desc.split(";")[0].trim() || "Material",
          sapBaselineQty: r.qty,
          sapBaselineAt: now,
          createdAt: existing?.createdAt || now,
          updatedAt: now,
        };
        stocksById.set(row.id, row);
      });
      const newStocks = Array.from(stocksById.values());

      // 4. Arsipkan histori TUG lama sebagai migrasi — cuma sekali (run pertama). Kalau wizard
      // ini dijalankan berkali-kali (mis. Persediaan lalu Cadang), jangan wipe txns aktif yang
      // sudah berjalan normal di antara 2 proses migrasi itu.
      const isFirstMigration = (migratedTug15History||[]).length === 0;
      const migHistory = isFirstMigration ? txns.map(t => ({...t, _migrasiSource:"WARNOTO_TEST"})) : migratedTug15History;
      if (isFirstMigration) setMigratedTug15History(migHistory);
      const newTxns = isFirstMigration ? [] : txns;

      // 5. Apply cutover
      setKatalogList(newKatalog);
      setStocks(newStocks);
      setTxns(newTxns);
      setMigrasiPendingReview(updatedPendingReview);
      setApplyProgressPct(60);
      setApplyProgress("☁️ Menyimpan ke localStorage & Supabase (katalog, stok, antrian review)...");
      await saveToCloud({
        katalogList: newKatalog,
        stocks: newStocks,
        txns: newTxns,
        migratedTug15History: migHistory,
        migrasiPendingReview: updatedPendingReview,
      });

      setApplyProgressPct(100);
      setApplyProgress("✅ Selesai.");
      setStep("done");
      const overwriteCount = previewStats.sapResult.filter(r => katalogById.has(r.noKat) && overwriteRows.has(r.noKat)).length - multiLokasiSkipped.length;
      setLastCutoverSummary({ overwriteCount, newItemCount: newPendingReview.length, multiLokasiSkipped });
      showToast(
        `Cutover selesai. ${overwriteCount} baris stok diperbarui, ` +
        `${newPendingReview.length} item baru masuk antrian review Admin` +
        (multiLokasiSkipped.length ? `, ${multiLokasiSkipped.length} baris DILEWATI karena tersebar di >1 lokasi (perlu update manual)` : "") +
        `. Sisanya data existing dibiarkan apa adanya.`,
        "success"
      );
    } catch(err) {
      showToast("Cutover gagal: " + err.message, "error");
      setApplyProgress("");
      setApplyProgressPct(0);
    }
    setBusy(false);
  }

  // Progress bar bernomor 1-100% (bukan cuma teks "Memproses...") supaya
  // Admin bisa lihat apakah proses jalan atau macet (permintaan user 2026-07-04).
  function ProgressBar() {
    if (!busy) return null;
    const pct = Math.max(1, applyProgressPct);
    return (
      <div style={{width:"100%",maxWidth:420,marginTop:8}}>
        <div style={{display:"flex",justifyContent:"space-between",fontSize:11,color:C.accent,fontWeight:700,marginBottom:3}}>
          <span>{applyProgress || "Memproses..."}</span>
          <span>{pct}%</span>
        </div>
        <div style={{width:"100%",height:8,background:"#e5e7eb",borderRadius:6,overflow:"hidden"}}>
          <div style={{width:`${pct}%`,height:"100%",background:C.accent,borderRadius:6,transition:"width 0.2s"}}/>
        </div>
      </div>
    );
  }

  function toggleOverwriteRow(noKat) {
    setOverwriteRows(prev => {
      const next = new Set(prev);
      if (next.has(noKat)) next.delete(noKat); else next.add(noKat);
      return next;
    });
  }

  // Admin approve 1 item dari antrian review — baru di sini katalog+stok
  // benar-benar dibuat (merge-safe, sama seperti pola cutover di atas).
  async function approveMigrasiPending(itemId) {
    const item = (migrasiPendingReview||[]).find(i => i.id === itemId);
    if (!item) return;
    const now = Date.now();
    const katId = "KAT-MIG-" + item.noKat;
    const existingKat = katalogList.find(k => normalizeKatalog(k.katalog) === item.noKat);
    const newKatalogList = existingKat ? katalogList : [...katalogList, {
      id: katId, katalog: item.noKat, name: item.desc,
      category: item.desc.split(";")[0].trim() || "Material",
      jenisBarang: item.jenisBarang, satuan: item.satuan,
      keterangan: "Import migrasi SAP " + (item.sourceFile||"") + " (disetujui Admin)",
      createdAt: now,
    }];
    const finalKatId = existingKat?.id || katId;
    // Sama seperti fix di handleBackupAndApply: JANGAN tebak lokasi — kosongkan,
    // Admin isi manual (lihat catatan bug 2026-07-04 di atas).
    const newStocksList = item.qty > 0 ? [...stocks, {
      id: "STK-MIG-" + item.noKat + "-" + now,
      katalogId: finalKatId, lokasiId: null,
      qty: item.qty, price: item.harga || 0, minQty: 0, unit: item.satuan,
      jenisBarang: item.jenisBarang, name: item.desc, katalog: item.noKat,
      category: item.desc.split(";")[0].trim() || "Material",
      sapBaselineQty: item.qty, sapBaselineAt: now, createdAt: now, updatedAt: now,
    }] : stocks;
    const newPending = migrasiPendingReview.map(i => i.id===itemId ? {...i, status:"APPROVED", decidedBy:currentUser.id, decidedAt:now} : i);
    setKatalogList(newKatalogList);
    setStocks(newStocksList);
    setMigrasiPendingReview(newPending);
    await saveToCloud({ katalogList: newKatalogList, stocks: newStocksList, migrasiPendingReview: newPending });
    showToast(`${item.desc} disetujui dan ditambahkan ke Master Katalog/Data Stok.`, "success");
  }

  async function rejectMigrasiPending(itemId) {
    const newPending = migrasiPendingReview.map(i => i.id===itemId ? {...i, status:"REJECTED", decidedBy:currentUser.id, decidedAt:Date.now()} : i);
    setMigrasiPendingReview(newPending);
    await saveToCloud({ migrasiPendingReview: newPending });
    showToast("Item ditolak, tidak ditambahkan ke Master Katalog.", "success");
  }

  // Bug lokasi ditemukan 2026-07-04: sebelum fix di atas, baris stok baru hasil
  // migrasi (id berawalan "STK-MIG-") auto-diisi lokasiList[0] (lokasi PERTAMA
  // di Master Lokasi, bukan hasil pembacaan file). Tidak bisa dibedakan otomatis
  // mana yang memang ditinggal begitu vs yang sudah sengaja dikonfirmasi manual
  // oleh Admin ke lokasi yang sama — jadi ditampilkan sebagai daftar review,
  // Admin putuskan satu-per-satu (atau sekaligus) pertahankan/kosongkan.
  //
  // PERBAIKAN 2026-07-04 (kedua): filter awal membandingkan ke lokasiId ===
  // lokasiList[0]?.id — tapi urutan baris dari Supabase TIDAK terjamin stabil
  // antar reload (query lokasi tidak pakai ORDER BY), jadi lokasiList[0] bisa
  // beda tiap kali app dimuat, dan panel jadi tidak menangkap baris yang
  // sebelumnya memang salah. Fix: tangkap SEMUA baris hasil migrasi yang
  // punya lokasi tapi belum direview — tidak bergantung ke lokasi mana pun.
  //
  // PERBAIKAN 2026-07-04 (ketiga): filter cuma cek prefix "STK-MIG-", tapi
  // banyak baris ternyata berasal dari fitur "Import dari SAP" LAMA (sudah
  // dihapus tombolnya, lihat commit 5958153) yang pakai prefix "STK-SAP-" —
  // baris-baris itu masih ada di data existing dan ikut kena bug lokasi yang
  // sama. Fix: terima kedua prefix.
  const locationReviewCandidates = (stocks||[]).filter(s =>
    /^STK-(MIG|SAP)-/.test(String(s.id||"")) && s.lokasiId && !s.locationReviewed
  );

  async function keepMigrasiLocation(stockId) {
    const newStocks = stocks.map(s => s.id===stockId ? {...s, locationReviewed:true} : s);
    setStocks(newStocks);
    await saveToCloud({ stocks: newStocks });
    showToast("Lokasi dipertahankan.", "success");
  }

  async function clearMigrasiLocation(stockId) {
    const newStocks = stocks.map(s => s.id===stockId ? {...s, lokasiId:null, locationReviewed:true} : s);
    setStocks(newStocks);
    await saveToCloud({ stocks: newStocks });
    showToast("Lokasi dikosongkan — isi manual lewat Data Stok.", "success");
  }

  async function clearAllMigrasiLocations() {
    if (!window.confirm(`Kosongkan lokasi untuk SEMUA ${locationReviewCandidates.length} baris ini sekaligus? Tindakan ini tidak bisa di-undo.`)) return;
    const ids = new Set(locationReviewCandidates.map(s=>s.id));
    const newStocks = stocks.map(s => ids.has(s.id) ? {...s, lokasiId:null, locationReviewed:true} : s);
    setStocks(newStocks);
    await saveToCloud({ stocks: newStocks });
    showToast(`${ids.size} baris dikosongkan — isi manual lewat Data Stok.`, "success");
  }

  return (
    <div>
      {/* Judul "Migrasi Data SAP/Non-SAP" sudah ditampilkan header Master Data
          di atas (lihat App.jsx ~line 5769) — h1 di sini dihapus supaya tidak
          dobel (ditemukan user 2026-07-04). */}

      {(migrasiPendingReview||[]).some(i=>i.status==="PENDING") && (
        <div style={{...sty.card,marginBottom:16,borderLeft:`4px solid #f59e0b`}}>
          <div style={{fontWeight:800,fontSize:14,marginBottom:10,color:"#92400e"}}>
            📋 Menunggu Review Admin ({migrasiPendingReview.filter(i=>i.status==="PENDING").length} item baru dari Migrasi Data)
          </div>
          <div style={{display:"flex",flexDirection:"column",gap:8,maxHeight:320,overflowY:"auto"}}>
            {migrasiPendingReview.filter(i=>i.status==="PENDING").map(item=>(
              <div key={item.id} style={{display:"flex",alignItems:"center",gap:10,border:`1px solid ${C.border}`,borderRadius:8,padding:"8px 12px",background:"white"}}>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontWeight:700,fontSize:12,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{item.desc}</div>
                  <div style={{fontSize:10,color:C.muted}}>No. Katalog {item.noKat} • {item.jenisBarang} • Qty {item.qty} {item.satuan} • {item.harga?("Rp "+fmtNum(item.harga)):"-"} • dari {item.sourceFile}</div>
                </div>
                <button style={sty.btn("primary","sm")} onClick={()=>approveMigrasiPending(item.id)}>✅ Setujui</button>
                <button style={sty.btn("danger","sm")} onClick={()=>rejectMigrasiPending(item.id)}>✕ Tolak</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {locationReviewCandidates.length > 0 && (
        <div style={{...sty.card,marginBottom:16,borderLeft:`4px solid #dc2626`}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:8,marginBottom:6}}>
            <div style={{fontWeight:800,fontSize:14,color:"#991b1b"}}>
              📍 Review Lokasi Otomatis ({locationReviewCandidates.length} baris stok)
            </div>
            <button style={sty.btn("danger","sm")} onClick={clearAllMigrasiLocations}>🗑️ Kosongkan Semua ({locationReviewCandidates.length})</button>
          </div>
          <div style={{fontSize:11,color:C.muted,marginBottom:10}}>
            Baris-baris ini pernah dibuat migrasi lalu dengan lokasi ditebak otomatis (bug yang sudah diperbaiki) —
            sebagian mungkin sudah Anda konfirmasi/set manual, sebagian mungkin belum. Cek satu-satu:
            kalau lokasinya memang benar, klik "Pertahankan". Kalau bukan, klik "Kosongkan" lalu isi lokasi yang
            benar manual lewat Data Stok. Kalau Anda yakin SEMUA baris ini memang belum pernah diisi manual,
            pakai "Kosongkan Semua" di kanan atas.
          </div>
          <div style={{display:"flex",flexDirection:"column",gap:8,maxHeight:320,overflowY:"auto"}}>
            {locationReviewCandidates.map(s=>{
              const kat = katalogList.find(k=>k.id===s.katalogId);
              const lok = lokasiList.find(l=>l.id===s.lokasiId);
              const gudang = lok?.gudangId;
              return (
                <div key={s.id} style={{display:"flex",alignItems:"center",gap:10,border:`1px solid ${C.border}`,borderRadius:8,padding:"8px 12px",background:"white"}}>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontWeight:700,fontSize:12,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{s.name||kat?.name}</div>
                    <div style={{fontSize:10,color:C.muted}}>No. Katalog {s.katalog||kat?.katalog} • Qty {s.qty} • Lokasi saat ini: {lok?.kode||"-"}</div>
                  </div>
                  <button style={sty.btn("primary","sm")} onClick={()=>keepMigrasiLocation(s.id)}>✅ Pertahankan</button>
                  <button style={sty.btn("danger","sm")} onClick={()=>clearMigrasiLocation(s.id)}>🗑️ Kosongkan</button>
                </div>
              );
            })}
          </div>
        </div>
      )}

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
            {/* Tombol "Lanjut" sengaja DI DALAM kotak upload yang sama, dan baru
                muncul setelah file berhasil diupload (bukan selalu tampil abu-abu
                menunggu diaktifkan) — sebelumnya dirender terpisah di luar kotak
                ini, terkesan tidak nyambung dengan langkah 1 (keluhan user 2026-07-06). */}
            {sapRows.length>0 && (
              <div style={{marginTop:14,paddingTop:14,borderTop:`1px solid ${C.border}`,display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
                <button style={sty.btn("primary")} disabled={busy} onClick={buildPreview}>
                  {busy ? "⏳ Memproses..." : "Lanjut → Preview Rekonsiliasi"}
                </button>
                {busy && <button style={{...sty.btn("ghost","sm")}} onClick={()=>{setBusy(false);setApplyProgress("");setApplyProgressPct(0);}}>Reset (jika stuck)</button>}
              </div>
            )}
          </div>
          <ProgressBar/>
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
              {label:"⚠️ Perlu Review Stok",val:previewStats.sapResult.filter(r=>r.needsStockReview).length,color:C.red},
              {label:"⚠️ Plant ≠ 3611",val:previewStats.sapResult.filter(r=>r.plantMismatch).length,color:C.red},
              {label:"⚠️ Jenis Barang Beda Sinyal",val:previewStats.sapResult.filter(r=>r.materialTypeMismatch).length,color:C.red},
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
          {previewStats.sapResult.some(r=>r.needsStockReview) && (
            <div style={{...sty.card,marginBottom:12,borderLeft:`4px solid ${C.red}`}}>
              <div style={{fontWeight:700,marginBottom:4,color:C.red}}>⚠️ Perlu Review Manual — Qty di luar "Unrestricted Use Stock"</div>
              <div style={{fontSize:11,color:C.muted,marginBottom:8}}>Baris ini punya qty di Quality Inspection/Blocked/In Transit Stock — TIDAK otomatis ditambahkan ke Data Stok. Putuskan per baris: gabung ke Unrestricted, atau hapus barisnya dari daftar impor. Kalau dibiarkan, qty tambahan ini tetap diabaikan (cuma qty Unrestricted yang ikut masuk).</div>
              <div style={{maxHeight:220,overflowY:"auto"}}>
                <table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
                  <thead><tr style={{background:"#fef2f2"}}>{["No Katalog","Deskripsi","Unrestricted","Quality Insp.","Blocked","In Transit","Aksi"].map(h=><th key={h} style={{padding:"5px 8px",textAlign:"left"}}>{h}</th>)}</tr></thead>
                  <tbody>
                    {previewStats.sapResult.filter(r=>r.needsStockReview).map((r,i)=>(
                      <tr key={i} style={{borderBottom:`1px solid ${C.border}`}}>
                        <td style={{padding:"5px 8px",fontWeight:700,color:"#0098da"}}>{r.noKat}</td>
                        <td style={{padding:"5px 8px"}}>{r.desc}</td>
                        <td style={{padding:"5px 8px",textAlign:"right"}}>{r.qty}</td>
                        <td style={{padding:"5px 8px",textAlign:"right",color:r.qiStock>0?C.red:C.muted}}>{r.qiStock||"-"}</td>
                        <td style={{padding:"5px 8px",textAlign:"right",color:r.blockedStock>0?C.red:C.muted}}>{r.blockedStock||"-"}</td>
                        <td style={{padding:"5px 8px",textAlign:"right",color:r.transitStock>0?C.red:C.muted}}>{r.transitStock||"-"}</td>
                        <td style={{padding:"5px 8px",whiteSpace:"nowrap"}}>
                          <button style={{...sty.btn("ghost","sm"),padding:"3px 8px",marginRight:4}} onClick={()=>moveReviewToUnrestricted(r.noKat)}>➡️ Ke Unrestricted</button>
                          <button style={{...sty.btn("danger","sm"),padding:"3px 8px"}} onClick={()=>removeFromImportList(r.noKat)}>🗑️ Hapus</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          {previewStats.sapResult.some(r=>r.plantMismatch) && (
            <div style={{...sty.card,marginBottom:12,borderLeft:`4px solid ${C.red}`}}>
              <div style={{fontWeight:700,color:C.red}}>⚠️ {previewStats.sapResult.filter(r=>r.plantMismatch).length} baris punya kode Plant selain 3611 (UPT Surabaya)</div>
              <div style={{fontSize:11,color:C.muted,marginTop:4}}>Data ini tetap ikut diproses sebagai UPT Surabaya — kalau ini sebenarnya milik UPT lain, hapus dulu barisnya dari file sebelum upload ulang.</div>
            </div>
          )}
          {previewStats.sapResult.some(r=>r.materialTypeMismatch) && (
            <div style={{...sty.card,marginBottom:12,borderLeft:`4px solid ${C.red}`}}>
              <div style={{fontWeight:700,color:C.red}}>⚠️ {previewStats.sapResult.filter(r=>r.materialTypeMismatch).length} baris: Material Type dan panjang kode katalog beda sinyal</div>
              <div style={{fontSize:11,color:C.muted,marginTop:4}}>Contoh: Material Type bilang ZCAD (Cadang) tapi kodenya bukan 10 digit, atau sebaliknya ZST1 (Persediaan) tapi kodenya 10 digit. Jenis barang yang dipakai sistem tetap ikut Material Type (kolom "Jenis" di tabel) — cek manual baris ini sebelum apply, siapa tahu ada data yang salah input.</div>
            </div>
          )}
          <div style={{...sty.card,padding:0,overflowX:"auto",marginBottom:16,maxHeight:350,overflowY:"auto"}}>
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:11,minWidth:700}}>
              <thead style={{background:C.sidebar,color:"white",position:"sticky",top:0}}>
                <tr>
                  {["No Katalog","Deskripsi","Jenis","Qty File","Qty Aplikasi","Harga","Match WARNOTO","Match MARA","Timpa?","Review"].map(h=>(
                    <th key={h} style={{padding:"7px 8px",textAlign:"left",whiteSpace:"nowrap"}}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {previewStats.sapResult.slice(0,200).map((r,i)=>(
                  <tr key={i} style={{borderBottom:`1px solid ${C.border}`,background:r.needsStockReview||r.plantMismatch||r.materialTypeMismatch?"#fef2f2":!r.matchWarnoto?"#fefce8":"white"}}>
                    <td style={{padding:"5px 8px",fontWeight:700,color:"#0098da"}}>{r.noKat}</td>
                    <td style={{padding:"5px 8px",maxWidth:200,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{r.desc}</td>
                    <td style={{padding:"5px 8px",fontSize:10}}>{r.jenisBarang}</td>
                    <td style={{padding:"5px 8px",textAlign:"right"}}>{r.qty}</td>
                    <td style={{padding:"5px 8px",textAlign:"right",color:r.qtyMatch===false?C.red:r.qtyMatch===true?C.green:C.muted,fontWeight:r.qtyMatch===false?700:400}}>
                      {r.matchWarnoto ? r.existingQty : "-"}
                    </td>
                    <td style={{padding:"5px 8px",textAlign:"right"}}>{r.harga?fmtNum(r.harga):"-"}</td>
                    <td style={{padding:"5px 8px",textAlign:"center"}}>{r.matchWarnoto?"✅":"🆕"}</td>
                    <td style={{padding:"5px 8px",textAlign:"center"}}>{r.matchMara?"✅":"-"}</td>
                    <td style={{padding:"5px 8px",textAlign:"center"}}>
                      {!r.matchWarnoto ? (
                        <span style={{fontSize:10,color:"#f59e0b",fontWeight:700}}>📋 Review Admin</span>
                      ) : r.qtyMatch ? (
                        <span style={{fontSize:10,color:C.green,fontWeight:700}}>✅ Qty sama</span>
                      ) : (
                        <label style={{display:"flex",alignItems:"center",justifyContent:"center",gap:4,cursor:"pointer",fontSize:10,color:overwriteRows.has(r.noKat)?C.red:C.muted}}>
                          <input type="checkbox" checked={overwriteRows.has(r.noKat)} onChange={()=>toggleOverwriteRow(r.noKat)} />
                          Timpa
                        </label>
                      )}
                    </td>
                    <td style={{padding:"5px 8px",textAlign:"center"}}>{r.needsStockReview?"⚠️ Stok":r.plantMismatch?"⚠️ Plant":r.materialTypeMismatch?"⚠️ Jenis":""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{...sty.card,marginBottom:16,borderLeft:`4px solid ${C.accent}`,fontSize:12}}>
            <strong>ℹ️ Aturan Apply:</strong> baris <strong>Match WARNOTO ✅</strong> dengan qty file = qty aplikasi otomatis
            <strong> "✅ Qty sama"</strong> — tidak ada yang perlu diputuskan, dibiarkan apa adanya.
            Kalau qty-nya <strong>beda</strong>, kotak "Timpa" otomatis TERCENTANG (Admin bisa un-check kalau tetap mau
            pertahankan qty aplikasi) — total <strong>{overwriteRows.size} baris</strong> ditandai timpa saat ini.
            Baris <strong>🆕 baru</strong> (belum ada di katalog) TIDAK langsung ditambahkan — masuk ke antrian "Menunggu Review Admin"
            di bawah, baru dibuat setelah di-approve satu-per-satu.
          </div>
          <div style={{display:"flex",gap:8}}>
            <button style={sty.btn("ghost")} onClick={()=>setStep("upload")}>← Kembali</button>
            <button style={sty.btn("primary")} onClick={()=>setStep("backup")}>Lanjut → Backup & Apply</button>
          </div>
        </div>
      )}

      {step==="backup" && (() => {
        const newItemCount = previewStats?.sapResult?.filter(r=>!r.matchWarnoto).length || 0;
        const nothingToChange = overwriteRows.size === 0 && newItemCount === 0;
        if (nothingToChange) {
          return (
            <div style={{...sty.card,textAlign:"center",padding:30}}>
              <div style={{fontSize:36,marginBottom:10}}>✅</div>
              <div style={{fontWeight:800,fontSize:15,marginBottom:6}}>Tidak ada perubahan yang perlu di-apply</div>
              <div style={{fontSize:12,color:C.muted,marginBottom:16}}>
                Semua {previewStats?.sapResult?.length||0} baris di file ini sudah cocok 100% dengan data di aplikasi
                (qty sama, tidak ada item baru) — tidak perlu backup/cutover, data existing tidak disentuh sama sekali.
              </div>
              <div style={{display:"flex",gap:10,justifyContent:"center"}}>
                <button style={sty.btn("ghost")} onClick={()=>setStep("preview")}>← Kembali ke Preview</button>
                <button style={sty.btn("primary")} onClick={()=>{ setStep("upload"); setSapFile(null); setSapRows([]); setPreviewStats(null); }}>Selesai, Upload File Lain</button>
              </div>
            </div>
          );
        }
        return (
        <div style={{...sty.card}}>
          <div style={{fontWeight:700,fontSize:16,marginBottom:12}}>⚠️ Konfirmasi Backup & Apply Cutover</div>
          <div style={{background:"#fef9c3",border:"1px solid #fbbf24",borderRadius:8,padding:14,marginBottom:16,fontSize:13}}>
            <strong>Tindakan ini akan:</strong>
            <ul style={{marginTop:8,paddingLeft:20,lineHeight:1.8}}>
              <li>Mendownload backup JSON lengkap data sebelum cutover</li>
              <li>Baris <strong>Match WARNOTO</strong> yang TIDAK dicentang "Timpa" akan dibiarkan apa adanya (aman)</li>
              <li>Baris <strong>Match WARNOTO</strong> yang dicentang "Timpa" ({overwriteRows.size} baris) akan diperbarui dengan data dari file ini</li>
              <li>Baris <strong>baru</strong> ({newItemCount} item) masuk antrian "Menunggu Review Admin" — belum masuk Master Katalog/Data Stok</li>
              <li>Mengosongkan transaksi TUG test lama (disimpan ke histori migrasi, hanya sekali di run pertama)</li>
              <li>Data yang ditimpa <strong>tidak bisa di-undo</strong> kecuali restore dari backup</li>
            </ul>
          </div>
          <div style={{display:"flex",gap:10,alignItems:"center",flexWrap:"wrap"}}>
            <button style={{...sty.btn("danger"),opacity:busy?0.6:1}} onClick={handleBackupAndApply} disabled={busy}>
              {busy?"⏳ Memproses...":"📥 Download Backup & Apply Cutover"}
            </button>
            <button style={sty.btn("ghost")} onClick={()=>setStep("preview")} disabled={busy}>← Batal</button>
            {busy && <button style={{...sty.btn("ghost","sm")}} onClick={()=>{setBusy(false);setApplyProgress("");setApplyProgressPct(0);}}>Reset (jika stuck)</button>}
          </div>
          <ProgressBar/>
        </div>
        );
      })()}

      {step==="done" && (
        <div style={{...sty.card,textAlign:"center",padding:40}}>
          <div style={{fontSize:40,marginBottom:12}}>✅</div>
          <div style={{fontWeight:800,fontSize:18,marginBottom:8,color:C.green}}>Cutover Selesai!</div>
          <div style={{fontSize:13,color:C.muted,marginBottom:12}}>
            Data existing yang TIDAK dicentang "Timpa" dibiarkan apa adanya. Histori TUG lama tersimpan di "Migrasi TUG-15".
          </div>
          {lastCutoverSummary && (
            <div style={{textAlign:"left",display:"inline-block",background:"#f8fafc",border:`1px solid ${C.border}`,borderRadius:8,padding:14,marginBottom:16,fontSize:12}}>
              <div>✅ <strong>{lastCutoverSummary.overwriteCount}</strong> baris stok diperbarui (sesuai centang "Timpa")</div>
              <div>📋 <strong>{lastCutoverSummary.newItemCount}</strong> item baru masuk antrian Menunggu Review Admin</div>
              {lastCutoverSummary.multiLokasiSkipped.length > 0 && (
                <div style={{marginTop:8,color:"#b91c1c"}}>
                  <div>⚠️ <strong>{lastCutoverSummary.multiLokasiSkipped.length}</strong> baris DILEWATI — katalog ini tersebar di lebih dari 1 lokasi, sistem tidak tahu qty file SAP harus dialokasikan ke lokasi mana. Sesuaikan manual lewat Edit Data Stok:</div>
                  <ul style={{marginTop:4,paddingLeft:18}}>
                    {lastCutoverSummary.multiLokasiSkipped.slice(0,10).map((m,i)=>(
                      <li key={i}>{m.noKat} — {m.desc} (qty file: {m.qtyFile}, tersebar di {m.lokasiCount} lokasi)</li>
                    ))}
                    {lastCutoverSummary.multiLokasiSkipped.length > 10 && <li>...dan {lastCutoverSummary.multiLokasiSkipped.length-10} lainnya</li>}
                  </ul>
                </div>
              )}
            </div>
          )}
          <div style={{display:"flex",gap:10,justifyContent:"center"}}>
            <button style={sty.btn("primary")} onClick={()=>{setStep("upload");setLastCutoverSummary(null);}}>Lakukan Migrasi Lagi</button>
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

// Lembar cetak barcode/QR kartu gantung (5×5 cm/label). QR di-generate LOKAL (library qrcode —
// offline & andal untuk cetak massal), encode katalog.id yang sama dgn label per-1 TUG-2.
async function buildBarcodeSheetHTML(katalogItems, lokasiByKatalog) {
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;" }[c]));
  const labels = await Promise.all(katalogItems.map(async (k) => {
    const scanUrl = `${window.location.origin}/?scan=${encodeURIComponent(k.id)}`;
    const qr = await QRCode.toDataURL(scanUrl, { margin: 1, width: 220 });
    const lok = (lokasiByKatalog[k.id] || []).join("; ") || "-";
    return `<div class="label"><img src="${qr}" alt="QR"/><div class="nm">${esc(k.name || "-")}</div><div class="kt">No. Kat: ${esc(k.katalog || "-")}</div><div class="meta">${esc(k.jenisBarang || "-")} · ${esc(getSAPLabel(k.katalog))}</div><div class="lk">📍 ${esc(lok)}</div></div>`;
  }));
  return `<!doctype html><html lang="id"><head><meta charset="utf-8"/><title>Cetak Barcode Kartu Gantung — ${labels.length} label</title>
<style>
  @page { size: A4; margin: 8mm; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, sans-serif; background: #e5e7eb; }
  .bar { position: sticky; top: 0; background: #0b2559; color: #fff; padding: 10px 16px; text-align: center; font-size: 13px; font-weight: 700; z-index: 10; }
  .bar button { background: #16a34a; color: #fff; border: none; border-radius: 6px; padding: 8px 18px; font-size: 13px; font-weight: 700; cursor: pointer; margin-left: 12px; }
  .sheet { display: flex; flex-wrap: wrap; gap: 3mm; padding: 8mm; }
  .label { width: 5cm; height: 5cm; border: 1px dashed #94a3b8; border-radius: 4px; padding: 2.5mm; display: flex; flex-direction: column; align-items: center; text-align: center; background: #fff; page-break-inside: avoid; overflow: hidden; }
  .label img { width: 26mm; height: 26mm; }
  .label .nm { font-size: 7.5px; font-weight: 700; line-height: 1.12; margin-top: 1mm; max-height: 2.3em; overflow: hidden; }
  .label .kt { font-size: 7px; color: #374151; margin-top: 0.5mm; }
  .label .meta { font-size: 6.5px; color: #111; font-weight: 700; margin-top: 0.5mm; }
  .label .lk { font-size: 6.5px; color: #374151; margin-top: auto; max-height: 2.2em; overflow: hidden; line-height: 1.1; }
  @media print { .bar { display: none; } body { background: #fff; } .sheet { padding: 0; } }
</style></head><body>
<div class="bar">🏷️ ${labels.length} label barcode 5×5 cm — potong per kotak, tempel di kartu gantung <button onclick="window.print()">🖨️ Print / Save PDF</button></div>
<div class="sheet">${labels.join("")}</div>
</body></html>`;
}

// Modal Admin: filter (jenis barang + SAP/Non-SAP) lalu cetak lembar barcode massal.
function BarcodePrintModal({ katalogList, stocks, lokasiList, gudangList, C, sty, onClose }) {
  const [jenisSel, setJenisSel] = useState(() => new Set(JENIS_BARANG));
  const [sapSel, setSapSel] = useState("ALL"); // ALL | SAP | NONSAP
  const [busy, setBusy] = useState(false);

  const lokasiByKatalog = {};
  (stocks || []).forEach((s) => {
    if (!s.katalogId) return;
    const lok = lokasiList.find((l) => l.id === s.lokasiId);
    const gdg = lok?.gudangId ? gudangList.find((g) => g.id === lok.gudangId) : null;
    const txt = `${gdg?.nama || ""}${lok?.kode ? " / " + lok.kode : ""}`.trim();
    if (txt) { (lokasiByKatalog[s.katalogId] = lokasiByKatalog[s.katalogId] || new Set()).add(txt); }
  });
  Object.keys(lokasiByKatalog).forEach((k) => { lokasiByKatalog[k] = Array.from(lokasiByKatalog[k]); });

  const allJenis = jenisSel.size === JENIS_BARANG.length;
  const filtered = katalogList.filter((k) => {
    const jenisOk = allJenis ? true : jenisSel.has(k.jenisBarang);
    const isSap = getSAPLabel(k.katalog).startsWith("SAP");
    const sapOk = sapSel === "ALL" || (sapSel === "SAP" && isSap) || (sapSel === "NONSAP" && !isSap);
    return jenisOk && sapOk;
  });
  const toggleJenis = (j) => setJenisSel((prev) => { const n = new Set(prev); n.has(j) ? n.delete(j) : n.add(j); return n; });

  async function cetak() {
    if (!filtered.length || busy) return;
    setBusy(true);
    try {
      const w = window.open("", "_blank");
      const html = await buildBarcodeSheetHTML(filtered, lokasiByKatalog);
      if (w) { w.document.write(html); w.document.close(); }
    } finally { setBusy(false); }
  }

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.5)", zIndex:2000, display:"flex", alignItems:"center", justifyContent:"center", padding:16 }} onClick={onClose}>
      <div style={{ ...sty.card, maxWidth:560, width:"100%", maxHeight:"90vh", overflowY:"auto" }} onClick={(e)=>e.stopPropagation()}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:6 }}>
          <div style={{ fontSize:17, fontWeight:800 }}>🖨️ Cetak Semua Barcode (Kartu Gantung)</div>
          <button onClick={onClose} style={{ background:"transparent", border:"none", fontSize:20, cursor:"pointer", color:C.muted }}>✕</button>
        </div>
        <div style={{ fontSize:12, color:C.muted, marginBottom:14 }}>Label QR 5×5 cm untuk ditempel di kartu gantung fisik. QR meng-encode ID katalog yang sama dengan label TUG-2 — kartu lama tetap valid.</div>
        <div style={{ fontSize:12, fontWeight:700, marginBottom:6 }}>Jenis Barang</div>
        <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginBottom:14 }}>
          {JENIS_BARANG.map((j) => {
            const on = jenisSel.has(j);
            return <button key={j} onClick={()=>toggleJenis(j)} style={{ padding:"5px 12px", borderRadius:20, border:`1px solid ${on?C.accent:C.border}`, background:on?C.accent:"white", color:on?"white":C.muted, fontSize:11, fontWeight:700, cursor:"pointer" }}>{j}</button>;
          })}
        </div>
        <div style={{ fontSize:12, fontWeight:700, marginBottom:6 }}>Status SAP</div>
        <div style={{ display:"flex", gap:6, marginBottom:16 }}>
          {[{id:"ALL",label:"Semua"},{id:"SAP",label:"SAP"},{id:"NONSAP",label:"Non-SAP"}].map((o)=>(
            <button key={o.id} onClick={()=>setSapSel(o.id)} style={{ padding:"5px 14px", borderRadius:20, border:`1px solid ${sapSel===o.id?C.accent:C.border}`, background:sapSel===o.id?C.accent:"white", color:sapSel===o.id?"white":C.muted, fontSize:11, fontWeight:700, cursor:"pointer" }}>{o.label}</button>
          ))}
        </div>
        <div style={{ background:C.bg, borderRadius:10, padding:"12px 14px", display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16 }}>
          <span style={{ fontSize:13, color:C.text }}>Akan dicetak</span>
          <span style={{ fontSize:20, fontWeight:800, color:C.accent }}>{filtered.length} label</span>
        </div>
        <div style={{ display:"flex", gap:10 }}>
          <button onClick={onClose} style={{ ...sty.btn("ghost"), flex:1 }}>Batal</button>
          <button onClick={cetak} disabled={!filtered.length || busy} style={{ ...sty.btn("primary"), flex:2, opacity:(!filtered.length||busy)?0.5:1 }}>{busy ? "Menyiapkan QR..." : `🖨️ Cetak ${filtered.length} Label`}</button>
        </div>
      </div>
    </div>
  );
}

function KartuGantungModal({ katalog, stocks, txns, lokasiList, gudangList, sty, C, onClose }) {
  const [view, setView] = useState("riwayat"); // "riwayat" | "label"
  const history = buildKartuGantungHistory(katalog, txns, stocks, lokasiList);
  const lokasiTerkait = [...new Set(stocks.filter(s=>s.katalogId===katalog.id).map(s=>s.lokasiId))].map(lid=>lokasiList.find(l=>l.id===lid)?.kode).filter(Boolean);
  const dominantJenis = stocks.find(s=>s.katalogId===katalog.id)?.jenisBarang || "Persediaan";
  const accent = jenisBarangAccentColor(dominantJenis);
  const sampleFoto = stocks.find(s=>s.katalogId===katalog.id && s.img)?.img || null;

  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.6)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1500,padding:20}}>
      <div style={{...sty.card,width:560,maxWidth:"100%",maxHeight:"92vh",overflowY:"auto"}}>
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
                  <tr style={{background:C.sidebar,color:"white"}}>
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
              <button onClick={async()=>{
                const lokMap={};
                (stocks||[]).filter(s=>s.katalogId===katalog.id).forEach(s=>{
                  const lok=(lokasiList||[]).find(l=>l.id===s.lokasiId);
                  const gdg=lok?.gudangId?(gudangList||[]).find(g=>g.id===lok.gudangId):null;
                  const txt=`${gdg?.nama||""}${lok?.kode?" / "+lok.kode:""}`.trim();
                  if(txt){(lokMap[katalog.id]=lokMap[katalog.id]||new Set()).add(txt);}
                });
                if(lokMap[katalog.id])lokMap[katalog.id]=Array.from(lokMap[katalog.id]);
                const w=window.open("","_blank");
                const html=await buildBarcodeSheetHTML([katalog],lokMap);
                if(w){w.document.write(html);w.document.close();}
              }} style={{...sty.btn("primary"),marginBottom:12}}>🖨️ Cetak Label (Print / Save PDF)</button>
              <div style={{fontSize:11,color:C.muted,textAlign:"center",marginBottom:14,maxWidth:320}}>
                Klik "Cetak Label" untuk print/simpan PDF label 5×5 cm (QR + nama + lokasi). Scan QR dari HP untuk lihat riwayat TUG-2 material ini tanpa login.
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
  ultgList, approveTUG5_MgrULTG, rejectTUG5_MgrULTG, adoptTUG5ULTG, openDraftTug9, isMobile=false }) {
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
  const ultgPoolAdopt = hasRole(currentUser, "ADMIN","TL") ? tug5UltgTxns.filter(t =>
    t.stage==="APPROVED_ULTG" && !t.adoptedBy &&
    (currentUser?.role==="SUPERADMIN" || (ultgList||[]).find(u=>u.id===t.ultgId)?.parentUptId === currentUserUptId)
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
      {!hasRole(currentUser, "ADMIN_ULTG","MGR_ULTG") && (
      <>
      <div style={{fontSize:13,fontWeight:800,color:C.accent,borderBottom:`1px solid ${C.border}`,paddingBottom:6,marginBottom:4}}>📋 TUG-5 — Permintaan Barang UPT</div>
      {tug5Txns.length===0 && <div style={{...sty.card,textAlign:"center",color:C.muted,padding:20}}>Belum ada TUG-5.</div>}
      {tug5Txns.map(t=>{
        const uit = uitList.find(u=>u.id===t.uitId);
        const creator = users.find(u=>u.id===t.createdBy)||{};
        return (
          <div key={t.id} style={{...sty.card}}>
            <div style={{display:"flex",flexDirection:isMobile?"column":"row",justifyContent:"space-between",alignItems:isMobile?"stretch":"flex-start",gap:8,marginBottom:8}}>
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
              {t.stage==="PENDING_ASMAN" && hasRole(currentUser, "ASMAN") && (
                rejectingId===t.id
                  ? <><button style={sty.btn("danger","sm")} onClick={()=>{rejectTUG5_Asman(t,reason);setRejectingId(null);setReason("");}}>Konfirmasi Tolak</button><button style={sty.btn("ghost","sm")} onClick={()=>setRejectingId(null)}>Batal</button></>
                  : <><button style={sty.btn("success","sm")} onClick={()=>approveTUG5_Asman(t)}>✅ Setujui (Asman)</button><button style={{...sty.btn("ghost","sm"),border:`1px solid ${C.red}`,color:C.red}} onClick={()=>{setRejectingId(t.id);setReason("");}}>❌ Tolak</button></>
              )}
              {t.stage==="PENDING_MANAGER" && hasRole(currentUser, "MANAGER") && (
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
      {(hasRole(currentUser, "ADMIN_ULTG","MGR_ULTG","ADMIN","TL")) && (
        <>
          <div style={{fontSize:13,fontWeight:800,color:"#0369a1",borderBottom:`1px solid ${C.border}`,paddingBottom:6,marginTop:8,marginBottom:4}}>🏘️ TUG-5 — Permintaan Material dari ULTG</div>
          {currentUser.role==="MGR_ULTG" && !currentUser.ultgId && (
            <div style={{...sty.card,background:"#fef2f2",border:"1px solid #fecaca",color:"#991b1b",fontSize:12,padding:12,marginBottom:8}}>
              ⚠️ Akun kamu belum terhubung ke unit ULTG manapun, jadi tombol "Setujui" tidak akan muncul di list manapun. Hubungi Admin untuk melengkapi field ULTG di profil kamu.
            </div>
          )}
          {tug5UltgTxns.length===0 && <div style={{...sty.card,textAlign:"center",color:C.muted,padding:20}}>Belum ada TUG-5 dari ULTG.</div>}
          {tug5UltgTxns.slice(ultgListPage*5, ultgListPage*5+5).map(t=>{
            const ultg = (ultgList||[]).find(u=>u.id===t.ultgId);
            const creator = users.find(u=>u.id===t.createdBy)||{};
            const canApprove = t.stage==="PENDING_MGR_ULTG" && (currentUser.role==="SUPERADMIN" || (currentUser.role==="MGR_ULTG" && t.ultgId===currentUser.ultgId));
            const canAdopt = t.stage==="APPROVED_ULTG" && !t.adoptedBy && hasRole(currentUser, "ADMIN","TL") &&
              (currentUser.role==="SUPERADMIN" || ultg?.parentUptId === currentUserUptId);
            const isExpanded = ultgExpandedId===t.id;

            if (!isExpanded) {
              return (
                <div key={t.id} style={{display:"flex",alignItems:isMobile?"stretch":"center",flexDirection:isMobile?"column":"row",gap:10,border:`1px solid ${C.border}`,borderLeft:"3px solid #0369a1",borderRadius:8,padding:"8px 12px",marginBottom:6,background:"white",cursor:"pointer"}} onClick={()=>setUltgExpandedId(t.id)}>
                  <span style={{fontWeight:700,fontSize:12}}>{t.docNumbers?.tug5}</span>
                  <span style={{fontSize:11,color:C.muted,flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{ultg?.nama||t.ultgId} • {t.namaPekerjaan||t.keteranganUmum||"-"} • {fmtDate(t.createdAt)}</span>
                  <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
                    {stageBadge5(t)}
                    {canAdopt && <span style={{fontSize:10,fontWeight:700,color:"#0369a1"}}>👉 Siap Diadopsi</span>}
                  </div>
                </div>
              );
            }

            return (
              <div key={t.id} style={{...sty.card,borderLeft:"3px solid #0369a1"}}>
                <div style={{display:"flex",flexDirection:isMobile?"column":"row",justifyContent:"space-between",alignItems:isMobile?"stretch":"flex-start",gap:8,marginBottom:8}}>
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
      {(hasRole(currentUser, "ADMIN_UIT","MGR_LOGISTIK_UIT","ADMIN","TL","ASMAN","MANAGER")) && (
        <>
          <div style={{fontSize:13,fontWeight:800,color:"#7c3aed",borderBottom:`1px solid ${C.border}`,paddingBottom:6,marginTop:8,marginBottom:4}}>🏢 TUG-7 — Perintah Penyerahan Barang (Level UIT)</div>
          {tug7Txns.length===0 && <div style={{...sty.card,textAlign:"center",color:C.muted,padding:20}}>Belum ada TUG-7.</div>}
          {tug7Txns.map(t=>{
            const uptPengirim = uptList.find(u=>u.id===t.uptPengirimId);
            const tug5Ref = txns.find(x=>x.id===t.tug5Id);
            return (
              <div key={t.id} style={{...sty.card,borderLeft:`3px solid #7c3aed`}}>
                <div style={{display:"flex",flexDirection:isMobile?"column":"row",justifyContent:"space-between",alignItems:isMobile?"stretch":"flex-start",gap:8,marginBottom:8}}>
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
                  {t.stage==="DRAFT_UIT" && hasRole(currentUser, "ADMIN_UIT") && (
                    <button style={sty.btn("primary","sm")} onClick={()=>{setTug7Form({uptPengirimId:t.uptPengirimId||"",atasBebanRekening:t.atasBebanRekening||"",perintahKerja:t.perintahKerja||"",kodeAkun:t.kodeAkun||"",fungsi:t.fungsi||""});setTug7Modal(t);}}>📝 Lengkapi TUG-7</button>
                  )}
                  {t.stage==="PENDING_MGR_LOGISTIK" && hasRole(currentUser, "MGR_LOGISTIK_UIT") && (
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
              <div style={{display:"flex",flexDirection:isMobile?"column":"row",justifyContent:"space-between",alignItems:isMobile?"stretch":"flex-start",gap:8,marginBottom:8}}>
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
              {hasRole(currentUser, "ADMIN","TL") && (
                <button style={sty.btn("success","sm")} onClick={()=>konfirmasiDraftTUG8(t)}>✅ Konfirmasi — Aktifkan TUG-8 ini</button>
              )}
            </div>
          ))}
        </>
      )}

      {/* TUG-7 lengkapi modal */}
      {tug7Modal && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1500,padding:20}}>
          <div style={{...sty.card,width:480,maxWidth:"100%",maxHeight:"90vh",overflowY:"auto"}}>
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
            <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"1fr 1fr 1fr",gap:8,marginBottom:16}}>
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
                {t.stage==="PENDING_TL" && hasRole(currentUser, "TL") && (
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
                {t.stage==="MENUNGGU_TUG4" && hasRole(currentUser, "ADMIN","TL") && (
                  <button style={sty.btn("primary","sm")} onClick={()=>openTug4Modal(t)}>📋 Isi Form TUG-4</button>
                )}
                {/* Stage 2b: Manager approves TUG-4 */}
                {t.stage==="PENDING_MANAGER" && hasRole(currentUser, "MANAGER") && (
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
                {t.stage==="MENUNGGU_FINAL" && hasRole(currentUser, "ADMIN","TL") && (
                  <button style={sty.btn("primary","sm")} onClick={()=>openFinalModal(t)}>📎 Lengkapi Lampiran Final</button>
                )}
                {/* Stage 3b: Asman approves final */}
                {t.stage==="PENDING_ASMAN" && hasRole(currentUser, "ASMAN") && (
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
          <div style={{...sty.card,width:480,maxWidth:"100%",maxHeight:"90vh",overflowY:"auto"}}>
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
          <div style={{...sty.card,width:500,maxWidth:"100%",maxHeight:"90vh",overflowY:"auto"}}>
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

function ApprovalTab({ pendingTxns, stocks, katalogList, lokasiList, users, sty, C, approveTxn, rejectTxn, currentUser, uptList, submitTUG7_AdminUIT, approveTUG7_MgrLogistik, rejectTUG7_MgrLogistik, konfirmasiDraftTUG8, gudangCapacityImports, approveCapacityImport, rejectCapacityImport, approveLokasiChange, rejectLokasiChange, ultgList, approveTUG5_MgrULTG, rejectTUG5_MgrULTG, heavyEquipmentPendingCount, opnamePendingCount=0, stockCountPendingCount=0, approvalTypeFilter="ALL", approvalPageSize=10 }) {
  const [rejectingId, setRejectingId] = useState(null);
  const [reason, setReason] = useState("");
  const [tug7Form, setTug7Form] = useState({});
  const [tug7Modal, setTug7Modal] = useState(null);
  const [rejectingCapId, setRejectingCapId] = useState(null);
  const [capReason, setCapReason] = useState("");
  const [tugPage, setTugPage] = useState(1);
  const [capPage, setCapPage] = useState(1);
  const [lokasiPage, setLokasiPage] = useState(1);
  useEffect(() => { setTugPage(1); setCapPage(1); setLokasiPage(1); }, [approvalTypeFilter, approvalPageSize]);
  const canApproveCap = hasRole(currentUser, "TL","ASMAN");
  const pendingCapacityImports = (gudangCapacityImports||[]).filter(i=>i.status==="PENDING_ASMAN");
  const pendingLokasiChanges = hasRole(currentUser, "TL") ? (lokasiList||[]).filter(l=>l.status==="PENDING") : [];
  const showTug = approvalTypeFilter==="ALL"||approvalTypeFilter==="TUG";
  const showCap = approvalTypeFilter==="ALL"||approvalTypeFilter==="KAPASITAS";
  const showLokasi = approvalTypeFilter==="ALL"||approvalTypeFilter==="LOKASI";
  const pagedTxns = showTug ? pendingTxns.slice((tugPage-1)*approvalPageSize, tugPage*approvalPageSize) : [];
  const pagedCapacityImports = showCap ? pendingCapacityImports.slice((capPage-1)*approvalPageSize, capPage*approvalPageSize) : [];
  const pagedLokasiChanges = showLokasi ? pendingLokasiChanges.slice((lokasiPage-1)*approvalPageSize, lokasiPage*approvalPageSize) : [];
  function renderPager(page, setPage, totalItems) {
    if (totalItems <= approvalPageSize) return null;
    const totalPages = Math.max(1, Math.ceil(totalItems/approvalPageSize));
    return (
      <div style={{display:"flex",justifyContent:"flex-end",alignItems:"center",gap:6,marginTop:8,marginBottom:12}}>
        <button style={{...sty.btn("ghost","sm")}} disabled={page<=1} onClick={()=>setPage(p=>Math.max(1,p-1))}>← Sebelumnya</button>
        <span style={{fontSize:11,color:C.muted,padding:"0 4px"}}>Halaman {page} / {totalPages}</span>
        <button style={{...sty.btn("ghost","sm")}} disabled={page>=totalPages} onClick={()=>setPage(p=>Math.min(totalPages,p+1))}>Berikutnya →</button>
      </div>
    );
  }
  // BUG DITEMUKAN 2026-07-04 (fix layout 2026-07-06): panel "Pemindahan Blok/
  // Gudang Data Stok"/"Edit Data Stok"/"Hapus Data Stok"/"Peminjaman Alat
  // Berat" dirender inline SESUDAH <ApprovalTab> (lihat App.jsx ~line 6510-
  // 6650, ApprovalTab sengaja dipanggil PALING AWAL supaya judul "Approval"
  // tidak tertimbun di bawah panel-panel itu), tapi hitungan "X item menunggu
  // persetujuan" dan status kosong "Semua sudah diproses" di ApprovalTab
  // TIDAK tahu soal panel-panel itu — jadi kelihatan kontradiktif (badge
  // bilang 0/"selesai" padahal ada 1 item nyata di bawahnya) dan sidebar juga
  // tidak ikut kasih notifikasi badge untuk ini. Tambahkan ke hitungan supaya
  // konsisten.
  const pendingStockMoves = hasRole(currentUser, "TL") ? (stocks||[]).filter(s=>s.lokasiMovePending && s.lokasiMoveApprover==="TL")
    : hasRole(currentUser, "ASMAN") ? (stocks||[]).filter(s=>s.lokasiMovePending && s.lokasiMoveApprover==="ASMAN") : [];
  const pendingStockEdits = hasRole(currentUser, "TL") ? (stocks||[]).filter(s=>s.editPending) : [];
  const pendingStockDeletes = hasRole(currentUser, "TL") ? (stocks||[]).filter(s=>s.deletePending) : [];
  const pendingStockCount = pendingStockMoves.length + pendingStockEdits.length + pendingStockDeletes.length;

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

  // Heading section — cuma tampil kalau filter "Semua" dipilih (kalau filter spesifik sudah
  // dipilih, judul filter itu sendiri sudah cukup jelas). Sebelumnya TUG/Kapasitas Gudang/
  // Lokasi-Blok dirender berurutan sebagai satu list tanpa pemisah visual, jadi approval
  // "Tambah/Ubah/Hapus Blok" terkesan ikut masuk ke approval transaksi TUG (keluhan user
  // 2026-07-06).
  function sectionHeading(icon, text) {
    return <div style={{fontSize:11,fontWeight:800,color:C.muted,letterSpacing:0.5,textTransform:"uppercase",margin:"14px 0 10px",paddingBottom:6,borderBottom:`2px solid ${C.border}`}}>{icon} {text}</div>;
  }

  return (
    <div>
      {pendingTxns.length===0 && pendingCapacityImports.length===0 && pendingLokasiChanges.length===0 && pendingStockCount===0 && !(heavyEquipmentPendingCount>0) && !(opnamePendingCount>0) && !(stockCountPendingCount>0) ? (
        <div style={{...sty.card,textAlign:"center",padding:40}}>
          <div style={{fontSize:48,marginBottom:12}}>✅</div>
          <div style={{fontSize:16,fontWeight:700}}>Semua sudah diproses</div>
        </div>
      ) : !showTug ? null : <>
      {approvalTypeFilter==="ALL" && pendingTxns.length>0 && sectionHeading("📄","Transaksi TUG")}
      {pagedTxns.map(t=>{
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
              {isTUG8Draft && hasRole(currentUser, "ADMIN","TL") && (
                <button style={{...sty.btn("success"),flex:1}} onClick={()=>konfirmasiDraftTUG8(t)}>✅ Konfirmasi Draft TUG-8 — Aktifkan</button>
              )}
              {/* TUG-7 Draft UIT */}
              {isTUG7Draft && hasRole(currentUser, "ADMIN_UIT") && (
                <button style={{...sty.btn("primary"),flex:1}} onClick={()=>{setTug7Form({uptPengirimId:"",atasBebanRekening:"",perintahKerja:t.perintahKerja||"",kodeAkun:t.kodeAkun||"",fungsi:t.fungsi||""});setTug7Modal(t);}}>📝 Lengkapi TUG-7 (Pilih UPT Pengirim)</button>
              )}
              {t.docType==="TUG7" && t.stage==="PENDING_MGR_LOGISTIK" && hasRole(currentUser, "MGR_LOGISTIK_UIT") && (
                rejectingId===t.id
                  ? <><button style={{...sty.btn("danger"),flex:1}} onClick={()=>{rejectTUG7_MgrLogistik(t,reason);setRejectingId(null);setReason("");}}>❌ Konfirmasi Tolak</button><button style={{...sty.btn("ghost"),flex:1}} onClick={()=>setRejectingId(null)}>Batal</button></>
                  : <><button style={{...sty.btn("success"),flex:1}} onClick={()=>approveTUG7_MgrLogistik(t)}>✅ SETUJUI TUG-7 → Generate Draft TUG-8</button><button style={{...sty.btn("ghost"),flex:1,border:`1px solid ${C.red}`,color:C.red}} onClick={()=>{setRejectingId(t.id);setReason("");}}>❌ TOLAK</button></>
              )}
              {/* TUG-5 dari ULTG — approval Manager ULTG */}
              {t.docType==="TUG5" && t.sourceType==="ULTG" && t.stage==="PENDING_MGR_ULTG" && hasRole(currentUser, "MGR_ULTG") && (
                rejectingId===t.id
                  ? <><button style={{...sty.btn("danger"),flex:1}} onClick={()=>{rejectTUG5_MgrULTG(t,reason);setRejectingId(null);setReason("");}}>❌ Konfirmasi Tolak</button><button style={{...sty.btn("ghost"),flex:1}} onClick={()=>setRejectingId(null)}>Batal</button></>
                  : <><button style={{...sty.btn("success"),flex:1}} onClick={()=>approveTUG5_MgrULTG(t)}>✅ SETUJUI (Manager ULTG)</button><button style={{...sty.btn("ghost"),flex:1,border:`1px solid ${C.red}`,color:C.red}} onClick={()=>{setRejectingId(t.id);setReason("");}}>❌ TOLAK</button></>
              )}
            </div>
          </div>
        );
      })}
      </>}
      {showTug && renderPager(tugPage, setTugPage, pendingTxns.length)}

      {/* Approval Import Kapasitas Gudang — TL/Asman saja */}
      {approvalTypeFilter==="ALL" && showCap && canApproveCap && pendingCapacityImports.length>0 && sectionHeading("📐","Kapasitas Gudang")}
      {showCap && canApproveCap && pagedCapacityImports.map(imp=>(
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
                    <td style={{padding:"4px 8px",fontWeight:700,color:r.statusKapasitas==="KRITIS"?C.red:r.statusKapasitas==="WASPADA"?"#f59e0b":C.green}}>{KAPASITAS_LABEL[r.statusKapasitas]||r.statusKapasitas}</td>
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
      {showCap && canApproveCap && renderPager(capPage, setCapPage, pendingCapacityImports.length)}

      {/* Approval Perubahan Lokasi/Blok — TL saja. Heading "Lokasi & Gudang" ini sengaja
          mencakup juga panel "Pemindahan Blok/Edit/Hapus Data Stok" yang dirender di parent
          SESUDAH ApprovalTab (lihat komentar pendingStockMoves di atas) — keduanya sama-sama
          soal lokasi fisik gudang, dan tidak ada konten lain di antaranya jadi tetap terlihat
          1 section yang sama. */}
      {approvalTypeFilter==="ALL" && showLokasi && (pendingLokasiChanges.length>0 || pendingStockCount>0) && sectionHeading("📍","Lokasi & Gudang")}
      {showLokasi && pagedLokasiChanges.map(l=>{
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
      {showLokasi && renderPager(lokasiPage, setLokasiPage, pendingLokasiChanges.length)}

      {/* TUG-7 lengkapi modal */}
      {tug7Modal && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1500,padding:20}}>
          <div style={{...sty.card,width:480,maxWidth:"100%",maxHeight:"90vh",overflowY:"auto"}}>
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
