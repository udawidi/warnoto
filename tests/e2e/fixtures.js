const { test: base, expect } = require("@playwright/test");

const E2E_PROFILE = {
  id: "e2e-superadmin",
  name: "E2E Mobile Reviewer",
  username: "e2e",
  role: "SUPERADMIN",
  jabatan: "Quality Assurance",
  avatar: "E2",
  upt: "Surabaya",
  gudangIds: null,
};

const HEAVY_EQUIPMENT = [
  { id:"HE-E2E-01", upt:"Surabaya", lokasi:"Gudang Ketintang", nama:"Truck Crane 8 Ton", jenis:"Angkat Angkut", merkType:"Nissan", kapasitas:"8 TON", nomorSeri:"E2E-CR-001", tahun:"2024", kondisi:"Baik", statusAlat:"LAYAK", availabilityStatus:"TERSEDIA", foto:null },
  { id:"HE-E2E-02", upt:"Gresik", lokasi:"Gudang Tandes", nama:"Forklift Toyota", jenis:"Angkat Angkut", merkType:"Toyota", kapasitas:"5 TON", nomorSeri:"E2E-FL-002", tahun:"2023", kondisi:"Baik", statusAlat:"LAYAK", availabilityStatus:"DIPINJAM", foto:null },
  { id:"HE-E2E-03", upt:"Surabaya", lokasi:"Gudang Wonorejo", nama:"Mobile Manlift", jenis:"Angkat", merkType:"Haulotte", kapasitas:"200 KG", nomorSeri:"E2E-ML-003", tahun:"2022", kondisi:"Service Time", statusAlat:"PERLU_SERVICE", availabilityStatus:"TERSEDIA", foto:null },
];

const HEAVY_LOANS = [
  { id:"LOAN-E2E-01", equipmentId:"HE-E2E-02", ownerUpt:"Gresik", requesterUpt:"Surabaya", tanggalAmbil:"2026-07-01", tanggalKembali:"2026-07-10", namaPekerjaan:"Penggantian PMT Bay Trafo", keperluan:"Mobilisasi material", status:"OVERDUE", requestedBy:"e2e-superadmin", requestedAt:1782864000000 },
  { id:"LOAN-E2E-02", equipmentId:"HE-E2E-01", ownerUpt:"Surabaya", requesterUpt:"Malang", tanggalAmbil:"2026-07-20", tanggalKembali:"2026-07-25", namaPekerjaan:"Pemeliharaan Gardu Induk", keperluan:"Pengangkatan peralatan", status:"PENDING_OWNER_ASMAN", requestedBy:"e2e-superadmin", requestedAt:1784505600000 },
];

const CATALOG = [
  { id:"KAT-E2E-01", katalog:"301234567", name:"Isolator Keramik 150 kV", satuan:"BUAH" },
  { id:"KAT-E2E-02", katalog:"309876543", name:"Lightning Arrester 150 kV", satuan:"SET" },
];

const STOCKS = [
  { id:"ST-E2E-01", katalogId:"KAT-E2E-01", name:"Isolator Keramik 150 kV", qty:2, minQty:5, unit:"BUAH", price:1250000, jenisBarang:"Material Cadang" },
  { id:"ST-E2E-02", katalogId:"KAT-E2E-02", name:"Lightning Arrester 150 kV", qty:12, minQty:4, unit:"SET", price:8500000, jenisBarang:"Material Cadang" },
];

const MATERIAL_RESULT = {
  katalogId:"KAT-E2E-01", noKat:"301234567", katalogName:"Isolator Keramik 150 kV", katalogSatuan:"BUAH",
  treatment:"Material Cadang", cluster:"Switchyard", abcClass:"A1", policy:"Mandatory",
  currentQty:2, recommendedQty:6, gapQty:4, harga:1250000, populasi:24,
  failure5y:3, penggantian5y:2, emergency5y:1, leadTime:120, ttf:500,
  breakdown:true, cumulativeValuePct:15,
};

const WAREHOUSE_CAPACITY = [
  { id:"CAP-E2E-01", upt:"Surabaya", gudang:"Gudang Ketintang", subGudang:"Material Utama", luasLahanM2:1200, luasTerpakaiM2:1080, sisaLuasM2:120, persentaseTerpakai:0.9, statusKapasitas:"KRITIS", waktuUpdate:"20 Jul 2026" },
  { id:"CAP-E2E-02", upt:"Gresik", gudang:"Gudang Tandes", subGudang:"Material Cadang", luasLahanM2:900, luasTerpakaiM2:495, sisaLuasM2:405, persentaseTerpakai:0.55, statusKapasitas:"AMAN", waktuUpdate:"19 Jul 2026" },
];

const CLOUD_FIXTURES = {
  pln_stocks_v4: STOCKS,
  pln_katalog_v4: CATALOG,
  pln_lokasi_v4: [],
  pln_txns_v3: [
    { id:"TUG9-E2E-01", docType:"TUG9", status:"APPROVED", createdAt:1777507200000, approvedAt:1777507200000, namaPekerjaan:"Pemeliharaan Gardu Induk", lokasiPekerjaan:"GI Rungkut", penerimaNama:"Tim Har", penerimaUnit:"ULTG Surabaya", docNumbers:{ tug9:"TUG-9/E2E/001" }, stockItems:[{ stockId:"ST-E2E-01", qty:8 }] },
  ],
  pln_docseq_v3: 196,
  pln_rencana_v1: [],
  pln_opname_v1: [],
  pln_stockcount_v1: [],
  pln_approval_history_v1: [],
  pln_maturity_v1: [],
  pln_heavy_equipment_v1: HEAVY_EQUIPMENT,
  pln_heavy_equipment_loans_v1: HEAVY_LOANS,
  pln_attb_v1: [],
  pln_material_cadang_v1: { imports:[], analyses:[{ id:"MCANA-E2E-01", createdAt:1784505600000, results:[MATERIAL_RESULT] }], applyHistory:[] },
  pln_material_cadang_health_v1: { imports:[], analysisRuns:[], healthResults:[], applyAudit:[] },
  pln_material_cadang_ai_insights_v1: { runs:[], materialInsights:[] },
  pln_gudang_capacity_v1: WAREHOUSE_CAPACITY,
  pln_gudang_capacity_imports_v1: [],
  pln_migrated_tug15_v1: [],
  pln_migrasi_pending_review_v1: [],
};

const FORBIDDEN_HOSTS = [
  /(^|\.)supabase\.co$/i,
  /(^|\.)groq\.com$/i,
  /(^|\.)cohere\.com$/i,
];

const EXPECTED_OFFLINE_CONSOLE_ERRORS = [
  "Auto-sync Supabase gagal: Supabase belum dikonfigurasi",
  "Gagal load tg_allowed_users: TypeError: Cannot read properties of null",
  "Gagal load data FAQ panel: TypeError: Cannot read properties of null",
];

const test = base.extend({
  actorProfile: [E2E_PROFILE, { option:true }],
  cloudOverrides: [{}, { option:true }],
  isolatedPage: async ({ page, context, actorProfile, cloudOverrides }, use) => {
    const forbiddenRequests = [];
    const pageErrors = [];
    const consoleErrors = [];
    page.on("pageerror", error => pageErrors.push(error.message));
    page.on("console", message => {
      if (message.type() !== "error") return;
      if (EXPECTED_OFFLINE_CONSOLE_ERRORS.some(prefix => message.text().startsWith(prefix))) return;
      consoleErrors.push(message.text());
    });
    await context.addInitScript(({ profile, cloud }) => {
      localStorage.clear();
      sessionStorage.clear();
      localStorage.setItem("sb-e2e-auth-token", JSON.stringify({ e2e: true }));
      localStorage.setItem("warnoto_profile_cache_v2", JSON.stringify({ endpoint: undefined, profile }));
      localStorage.setItem("warnoto_theme", "light");
      Object.entries(cloud).forEach(([key, value]) => {
        localStorage.setItem(`warnoto_${key}`, JSON.stringify(value));
      });
    }, { profile:actorProfile, cloud:{ ...CLOUD_FIXTURES, ...cloudOverrides } });

    await context.route("**/*", async route => {
      const url = new URL(route.request().url());
      if (FORBIDDEN_HOSTS.some(pattern => pattern.test(url.hostname))) {
        forbiddenRequests.push(url.href);
        await route.abort("blockedbyclient");
        return;
      }
      await route.continue();
    });

    await use(page);
    expect(forbiddenRequests, `Production/external requests detected:\n${forbiddenRequests.join("\n")}`).toEqual([]);
    expect(pageErrors, `Uncaught page errors:\n${pageErrors.join("\n")}`).toEqual([]);
    expect(consoleErrors, `Console errors:\n${consoleErrors.join("\n")}`).toEqual([]);
  },
});

module.exports = { test, expect };
