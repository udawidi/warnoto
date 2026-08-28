// Data-driven inventory of stable, user-navigable responsive surfaces.
// menuPath always follows the real sidebar/drawer interaction. actions describe
// additional in-page navigation after the route is open.
const surface = (slug, tab, menuPath, readySelector, actions = []) => ({
  slug, tab, menuPath, readySelector, actions,
});

const SURFACES = [
  surface("dashboard-summary", "dashboard", null, ".dashboard-command"),
  surface("dashboard-detail", "dashboard", null, ".dashboard-command", [
    { role:"tab", name:/Overview Gudang/ },
  ]),
  surface("stock", "stock", ["Data Stok"], ".stock-page"),

  ...[
    ["capacity-summary", /Ringkasan Kapasitas/],
    ["capacity-data", /Data Kapasitas Gudang/],
    ["capacity-map", /Peta Utilisasi/],
  ].map(([slug, name]) => surface(slug, "kapasitasGudang", ["Kapasitas Gudang"], ".capacity-page", [{ role:"tab", name }])),

  ...[
    ["master-catalog", "Master Katalog"], ["master-security", "Satpam"],
    ["master-quality-team", "Tim Mutu"], ["master-organization", "Struktur Organisasi"],
    ["master-warehouse", "Master Gudang"], ["master-accounts", "Kelola Akun"],
    ["master-migration", "Migrasi Data"], ["master-audit-log", "Audit Log"],
    ["master-permissions", "Matrix Izin"],
  ].map(([slug, child]) => surface(slug, "master", ["Master Data", child], ".app-content")),

  surface("tug-3", "transaction", ["TUG", "Barang Masuk"], ".tug-page"),
  surface("tug-10", "transaction", ["TUG", "Barang Masuk"], ".tug-page", [{ role:"tab", name:/Barang Kembali/ }]),
  surface("tug-9", "transaction", ["TUG", "Barang Keluar"], ".tug-page"),
  surface("tug-8", "transaction", ["TUG", "Barang Keluar"], ".tug-page", [{ role:"tab", name:/Kirim ke Unit Lain/ }]),
  surface("tug-5", "transaction", ["TUG", "Minta Barang"], ".tug-page"),
  surface("tug-15", "transaction", ["TUG", "Laporan"], ".tug-page"),

  surface("approval", "approval", ["Approval"], ".app-content"),
  surface("heavy-fleet", "heavyEquipment", ["Alat Berat"], ".heavy-equipment-page"),
  surface("heavy-loans", "heavyEquipment", ["Alat Berat"], ".heavy-equipment-page", [{ role:"tab", name:/Peminjaman & Histori/ }]),
  surface("attb-pipeline", "attb", ["MRWI"], ".attb-page"),
  surface("attb-source", "attb", ["MRWI"], ".attb-page", [{ selector:".attb-stage-card.is-source" }]),
  surface("stock-opname", "opname", ["Stock Opname & Count", "Stock Opname"], ".app-content"),
  surface("stock-count", "opname", ["Stock Opname & Count", "Stock Count"], ".app-content"),
  surface("arrival-plan", "rencana", ["Rencana Kedatangan"], ".app-content"),

  surface("forecast-list", "forecastStok", ["Forecast Stok"], ".forecast-page"),
  ...[
    ["material-dashboard", null], ["material-health", "Health Index"],
    ["material-ai", "AI Insight"], ["material-import", /Import & Hitung/],
    ["material-results", /Hasil Analisis/], ["material-apply", /Apply Min Qty/],
  ].map(([slug, name]) => surface(slug, "forecastStok", ["Forecast Stok"], ".forecast-page", [
    { role:"tab", name:"Material Cadang" },
    ...(name ? [{ role:"button", name }] : []),
  ])),
  surface("material-detail", "forecastStok", ["Forecast Stok"], ".forecast-page", [
    { role:"tab", name:"Material Cadang" },
    { role:"button", name:"Health Index" },
    { selector:"tbody tr", index:0 },
  ]),

  surface("pakwar-welcome", "ai", ["Pak War"], ".ai-agent-page"),
  surface("pakwar-faq", "ai", ["Pak War"], ".ai-agent-page", [{ role:"button", name:"FAQ" }]),
  surface("pakwar-telegram", "ai", ["Pak War"], ".ai-agent-page", [{ role:"button", name:"Telegram" }]),
];

module.exports = { SURFACES };
