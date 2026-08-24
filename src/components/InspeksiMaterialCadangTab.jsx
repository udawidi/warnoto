import { useEffect, useMemo, useRef, useState } from "react";
import { can } from "../lib/perms.js";
import { OperationsHero } from "./OperationsHero.jsx";
import {
  ClipboardText,
  MagnifyingGlass,
  CaretDown,
  Camera,
  CheckCircle,
  Trash,
  Printer,
  Package,
  Stack,
} from "@phosphor-icons/react";
import {
  createMaterialInspectionBatch,
  loadInspectionPhotoUrls,
  MATERIAL_INSPECTION_MAX_PHOTOS,
  MATERIAL_INSPECTION_MAX_ITEMS_PER_BATCH,
} from "../lib/materialInspectionSync.js";
import { getInspectionIdentity, getInspectionScope } from "../lib/inspectionScope.mjs";
import { matchesMaterialSearch } from "../lib/sap.js";

const KONDISI = ["BAIK", "RUSAK_RINGAN", "RUSAK_BERAT", "PERLU_KALIBRASI"];
const KELAYAKAN = ["READY", "MAINTENANCE", "RETEST", "ATTB_RECOMMENDED"];
const CHECKLIST_KEYS = [
  ["kebersihan", "Kebersihan"],
  ["bebasKarat", "Bebas karat"],
  ["bebasBocor", "Bebas bocor"],
  ["kemasanBaik", "Kemasan baik"],
];
const todayJakarta = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });

// Label korporat 12px (override sty.label yang 11px — floor tipografi project).
const labelStyle = C => ({
  fontSize: 12,
  color: C.muted,
  display: "block",
  marginBottom: 4,
  fontWeight: 700,
  letterSpacing: ".2px",
});

function emptyItem(stock, katalog, lokasi) {
  return {
    stockId: stock.id,
    katalogId: stock.katalogId || null,
    lokasiId: stock.lokasiId || null,
    noKatalog: katalog?.katalog || katalog?.noKatalog || "",
    namaBarang: katalog?.name || stock.name || "",
    lokasiNama: lokasi?.kode || lokasi?.nama || "",
    qtyStok: stock.qty || 1,
    satuan: katalog?.satuan || stock.satuan || "BH",
    jenisMtu: katalog?.jenisMtu || "",
    kondisi: "BAIK",
    statusKelayakan: "READY",
    keteranganVisual: "",
    catatan: "",
    checklist: { kebersihan: true, bebasKarat: true, bebasBocor: true, kemasanBaik: true },
    photos: [],
  };
}

// ponytail: object URL leak bounded per session; revoke on URL list change.
function usePhotoPreviews(photos) {
  const urls = useMemo(
    () => photos.map(file => (file instanceof File ? URL.createObjectURL(file) : "")),
    [photos],
  );
  useEffect(() => {
    return () => { urls.forEach(url => { if (url) URL.revokeObjectURL(url); }); };
  }, [urls]);
  return urls;
}

function itemComplete(item) {
  return item.photos.length === MATERIAL_INSPECTION_MAX_PHOTOS;
}

function pelaksaraDisplay(x) {
  return Array.isArray(x) ? x.join(", ") : (x || "—");
}

export function InspeksiMaterialCadangTab({
  stocks = [],
  katalogList = [],
  lokasiList = [],
  gudangList = [],
  materialInspections = [],
  materialInspectionBatches = [],
  onInspectionCreated,
  onInspectionBatchCreated,
  currentUser,
  currentUserUptId,
  uptList = [],
  users = [],
  rolePerms,
  C,
  sty,
  showToast,
  isMobile,
}) {
  const [view, setView] = useState("form");
  const [items, setItems] = useState([]);
  const [selectedGudangId, setSelectedGudangId] = useState("");
  const [pickerQuery, setPickerQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(true);
  const [expandedItemIndex, setExpandedItemIndex] = useState(null);
  const [pelaksanaLogistik, setPelaksanaLogistik] = useState(currentUser?.name || "");
  const [pelaksaraPemeliharaan, setPelaksaraPemeliharaan] = useState([]);
  const [pelaksaraDraft, setPelaksaraDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [lastSavedBa, setLastSavedBa] = useState(null);
  const [expandedBatchId, setExpandedBatchId] = useState(null);
  const [batchPhotoUrls, setBatchPhotoUrls] = useState({});
  const [printBatch, setPrintBatch] = useState(null);
  const pickerSearchRef = useRef(null);
  const writer = ["ADMIN", "TL"].includes(currentUser?.role) && can(currentUser, "aksi.buatInspeksiMaterial", rolePerms);
  const inspectionScope = useMemo(() => getInspectionScope({
    currentUser,
    currentUserUptId,
    gudangList,
    lokasiList,
    stocks,
    materialInspectionBatches,
    uptList,
  }), [currentUser, currentUserUptId, gudangList, lokasiList, stocks, materialInspectionBatches, uptList]);
  const inspectionIdentity = useMemo(() => getInspectionIdentity({
    currentUser,
    currentUserUptId,
    uptList,
    users,
  }), [currentUser, currentUserUptId, uptList, users]);
  // Filter tampilan per-UPT untuk viewer multi-UPT (UIT) — inspectionScope sudah membatasi
  // gudang yang boleh dilihat (UPT sendiri | semua UPT di UIT), dropdown ini cuma
  // mempersempit tampilan lebih lanjut, tidak mengubah data yang boleh diakses.
  const baUptFilterOptions = useMemo(() => {
    const ids = new Set(inspectionScope.gudangList.map(g => g.uptId).filter(Boolean));
    return ids.size > 1 ? uptList.filter(u => ids.has(u.id)) : [];
  }, [inspectionScope.gudangList, uptList]);
  const [baUptFilter, setBaUptFilter] = useState("");
  const baGudangIds = baUptFilter
    ? new Set(inspectionScope.gudangList.filter(g => g.uptId === baUptFilter).map(g => g.id))
    : null;
  const scopedGudangList = baGudangIds ? inspectionScope.gudangList.filter(g => baGudangIds.has(g.id)) : inspectionScope.gudangList;
  const scopedLokasiList = baGudangIds ? inspectionScope.lokasiList.filter(l => baGudangIds.has(l.gudangId)) : inspectionScope.lokasiList;
  const scopedLokasiIds = new Set(scopedLokasiList.map(l => l.id));
  const scopedStocks = baGudangIds ? inspectionScope.stocks.filter(s => scopedLokasiIds.has(s.lokasiId)) : inspectionScope.stocks;
  const scopedBatches = baGudangIds ? inspectionScope.materialInspectionBatches.filter(b => baGudangIds.has(b.gudangId)) : inspectionScope.materialInspectionBatches;

  const today = todayJakarta();

  // Stok Cadang canonical: hanya yang katalognya jenisBarang==="Cadang".
  const cadangStockOptions = useMemo(() => {
    const cadangKatalogIds = new Set(
      katalogList.filter(k => k?.jenisBarang === "Cadang").map(k => k.id),
    );
    return scopedStocks
      .filter(s => cadangKatalogIds.has(s.katalogId))
      .map(stock => {
        const katalog = katalogList.find(k => k.id === stock.katalogId);
        const lokasi = scopedLokasiList.find(l => l.id === stock.lokasiId);
        return { stock, katalog, lokasi };
      });
  }, [scopedStocks, katalogList, scopedLokasiList]);

  // Gudang terkunci dari material pertama; material berikutnya harus dari gudang yang sama.
  const lockedGudangId = useMemo(() => {
    if (!items.length) return null;
    const first = items[0];
    const lokasi = scopedLokasiList.find(l => l.id === first.lokasiId);
    return lokasi?.gudangId || null;
  }, [items, scopedLokasiList]);

  const lockedGudang = useMemo(
    () => scopedGudangList.find(g => g.id === lockedGudangId) || null,
    [scopedGudangList, lockedGudangId],
  );

  const activeGudangId = lockedGudangId || selectedGudangId;

  const pickerResults = useMemo(() => {
    if (!activeGudangId) return [];
    if (!pickerQuery.trim()) return [];
    const alreadySelected = new Set(items.map(it => it.stockId));
    return cadangStockOptions
      .filter(opt => !alreadySelected.has(opt.stock.id))
      .filter(opt => opt.lokasi?.gudangId === activeGudangId)
      .filter(opt => {
        const label = `${opt.katalog?.katalog || ""} ${opt.katalog?.name || ""} ${opt.stock.name || ""}`;
        return matchesMaterialSearch([label], pickerQuery);
      })
      .slice(0, 50);
  }, [cadangStockOptions, items, activeGudangId, pickerQuery]);

  const completeCount = items.filter(itemComplete).length;
  const formInvalid = !items.length || items.some(it => !itemComplete(it)) || !pelaksanaLogistik.trim() || !pelaksaraPemeliharaan.length;

  useEffect(() => {
    if (activeGudangId && pickerSearchRef.current) pickerSearchRef.current.focus();
  }, [activeGudangId]);

  useEffect(() => {
    if (expandedBatchId) {
      const batch = scopedBatches.find(b => b.id === expandedBatchId);
      const paths = batch?.items?.flatMap(it => it.photoPaths || []) || [];
      if (!paths.length) { setBatchPhotoUrls({}); return; }
      let active = true;
      loadInspectionPhotoUrls(paths).then(urls => { if (active) setBatchPhotoUrls(urls); });
      return () => { active = false; };
    }
    setBatchPhotoUrls(previous => Object.keys(previous).length ? {} : previous);
  }, [expandedBatchId, scopedBatches]);

  function addItem(stockId) {
    const opt = cadangStockOptions.find(o => o.stock.id === stockId);
    if (!opt) return;
    if (items.length && opt.lokasi?.gudangId !== lockedGudangId) {
      showToast("Satu BA hanya untuk satu gudang.", "error");
      return;
    }
    const nextIndex = items.length;
    setItems(prev => {
      if (prev.length >= MATERIAL_INSPECTION_MAX_ITEMS_PER_BATCH) return prev;
      if (prev.some(it => it.stockId === stockId)) return prev;
      return [...prev, emptyItem(opt.stock, opt.katalog, opt.lokasi)];
    });
    setExpandedItemIndex(nextIndex);
    setPickerQuery("");
    setSearchOpen(false);
  }

  function removeItem(index) {
    setItems(prev => prev.filter((_, i) => i !== index));
    setExpandedItemIndex(cur => {
      if (cur === null) return null;
      if (cur === index) return null;
      if (cur > index) return cur - 1;
      return cur;
    });
  }

  function toggleItem(index) {
    setExpandedItemIndex(id => (id === index ? null : index));
  }

  function updateItem(index, patch) {
    setItems(prev => prev.map((it, i) => (i === index ? { ...it, ...patch } : it)));
  }

  function updateItemChecklist(index, key, value) {
    setItems(prev => prev.map((it, i) => (i === index ? { ...it, checklist: { ...it.checklist, [key]: value } } : it)));
  }

  function addPhotos(index, files) {
    const incoming = Array.from(files || []);
    let nowComplete = false;
    setItems(prev => prev.map((it, i) => {
      if (i !== index) return it;
      const combined = [...it.photos, ...incoming];
      if (combined.length > MATERIAL_INSPECTION_MAX_PHOTOS) {
        showToast("Maksimal dua foto per material.", "error");
        return it;
      }
      if (combined.length === MATERIAL_INSPECTION_MAX_PHOTOS) nowComplete = true;
      return { ...it, photos: combined };
    }));
    if (nowComplete) setExpandedItemIndex(cur => (cur === index ? null : cur));
  }

  function removePhoto(index, photoIndex) {
    setItems(prev => prev.map((it, i) => (i === index ? { ...it, photos: it.photos.filter((_, p) => p !== photoIndex) } : it)));
  }

  function resetForm() {
    setItems([]);
    setExpandedItemIndex(null);
    setPelaksaraPemeliharaan([]);
    setPelaksaraDraft("");
    setSelectedGudangId("");
    setPickerQuery("");
    setSearchOpen(true);
  }

  function addPelaksara() {
    const name = pelaksaraDraft.trim();
    if (!name) return;
    setPelaksaraPemeliharaan(prev => (prev.includes(name) ? prev : [...prev, name]));
    setPelaksaraDraft("");
  }

  function removePelaksara(name) {
    setPelaksaraPemeliharaan(prev => prev.filter(n => n !== name));
  }

  async function saveBatch() {
    if (!writer) return;
    if (!items.length) { showToast("Minimal satu material harus diperiksa.", "error"); return; }
    if (!pelaksanaLogistik.trim()) { showToast("Pelaksana Logistik wajib diisi.", "error"); return; }
    if (!pelaksaraPemeliharaan.length) { showToast("Pelaksara Pemeliharaan wajib diisi.", "error"); return; }
    for (const [i, it] of items.entries()) {
      if (it.photos.length !== MATERIAL_INSPECTION_MAX_PHOTOS) {
        showToast(`Material baris ${i + 1} wajib punya tepat ${MATERIAL_INSPECTION_MAX_PHOTOS} foto.`, "error");
        return;
      }
    }
    setSaving(true);
    try {
      const header = {
        inspectorId: currentUser.id,
        inspectorName: currentUser.name || currentUser.username || "Pemeriksa",
        uptId: inspectionIdentity.uptId,
        gudangId: lockedGudangId,
        tanggal: today,
        pelaksanaLogistik: pelaksanaLogistik.trim(),
        pelaksaraPemeliharaan: pelaksaraPemeliharaan,
        managerUpt: inspectionIdentity.managerUpt,
        namaUpt: inspectionIdentity.namaUpt,
        namaGudang: lockedGudang?.nama || "",
      };
      const payloadItems = items.map(it => ({
        stockId: it.stockId,
        katalogId: it.katalogId,
        lokasiId: it.lokasiId,
        noKatalog: it.noKatalog,
        namaBarang: it.namaBarang,
        lokasiNama: it.lokasiNama,
        qtyStok: Number(it.qtyStok) || 1,
        satuan: it.satuan,
        jenisMtu: it.jenisMtu,
        kondisi: it.kondisi,
        statusKelayakan: it.statusKelayakan,
        keteranganVisual: it.keteranganVisual,
        catatan: it.catatan,
        checklist: it.checklist,
      }));
      const created = await createMaterialInspectionBatch({
        header,
        items: payloadItems,
        photoFilesPerItem: items.map(it => it.photos),
      });
      onInspectionBatchCreated(created);
      setLastSavedBa(created);
      resetForm();
      setView("history");
      showToast(`BA Inspeksi ${created.nomorBa} tersimpan.`);
    } catch (error) {
      console.error("Simpan BA inspeksi gagal:", error);
      showToast(error.message || "Gagal menyimpan BA inspeksi.", "error");
    } finally {
      setSaving(false);
    }
  }

  async function printBa(batch) {
    const paths = batch?.items?.flatMap(it => it.photoPaths || []) || [];
    const urls = paths.length ? await loadInspectionPhotoUrls(paths) : {};
    setBatchPhotoUrls(urls);
    setPrintBatch(batch);
    setTimeout(() => window.print(), 50);
  }

  const tabs = [
    { id: "form", label: "Buat Inspeksi" },
    { id: "history", label: "History BA" },
  ];

  const progressPct = items.length
    ? Math.round((items.length / MATERIAL_INSPECTION_MAX_ITEMS_PER_BATCH) * 100)
    : 0;

  return (
    <div className="operations-page inspection-page" style={{ display: "grid", gap: 16 }}>
      <style>{`@media screen { .inspection-ba { display:none; } } @media print { body * { visibility:hidden; } .inspection-ba, .inspection-ba * { visibility:visible; } .inspection-ba { position:absolute; inset:0; padding:20px; color:#111; background:#fff; font-family:Georgia,serif; } .no-print { display:none !important; } }`}</style>

      <div className="no-print">
        <OperationsHero
          eyebrow="Material Assurance"
          title="Inspeksi Material Cadang"
          description="Satu Berita Acara memuat 1–10 material Cadang dari satu gudang. Identitas material terkunci, dan riwayat bersifat append-only."
          scope={inspectionIdentity.namaUpt}
          metrics={[
            { label: "BA Tersimpan", value: scopedBatches.length },
            { label: "Material di Form", value: items.length },
            { label: "Lengkap", value: `${completeCount}/${items.length}` },
            { label: writer ? "Akses Tulis" : "Akses Baca", value: writer ? "ADMIN/TL" : "VIEWER" },
          ]}
          controls={baUptFilterOptions.length > 0 ? (
            <div>
              <label>Filter UPT</label>
              <select value={baUptFilter} onChange={e => setBaUptFilter(e.target.value)}>
                <option value="">Semua UPT</option>
                {baUptFilterOptions.map(u => <option key={u.id} value={u.id}>{u.nama}</option>)}
              </select>
            </div>
          ) : null}
        />
      </div>

      {/* Sub-tab switch — segmented control navy aktif (grid 2 kolom biar rata di HP), sticky saat scroll */}
      <div className="no-print" style={{
        display: "grid",
        gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
        gap: 6,
        background: C.bg,
        borderRadius: 14,
        padding: 5,
        border: `1.5px solid ${C.border}`,
        position: "sticky",
        top: 0,
        zIndex: 5,
      }}>
        {tabs.map(t => (
          <button key={t.id} onClick={() => setView(t.id)} style={{
            padding: isMobile ? "10px 12px" : "10px 16px",
            minHeight: 44,
            borderRadius: 10,
            border: "none",
            cursor: "pointer",
            fontSize: isMobile ? 13 : 14,
            fontWeight: 800,
            background: view === t.id ? "#1d4ed8" : "transparent",
            color: view === t.id ? "#ffffff" : C.text,
            boxShadow: view === t.id ? "0 3px 10px rgba(29,78,216,0.35)" : "none",
            whiteSpace: "nowrap",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
          }}>
            <ClipboardText size={16} weight={view === t.id ? "fill" : "regular"} />
            {t.label}
          </button>
        ))}
      </div>

      {view === "form" && writer && (
        <div className="no-print" style={{ ...sty.card, display: "grid", gap: 18 }}>
          {/* Langkah 1 — Identitas BA */}
          <StepHeader title="Identitas Berita Acara" C={C} />
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(auto-fit,minmax(200px,1fr))", gap: 10, alignItems: "start" }}>
            <ChipReadonly label="Tanggal" value={today} C={C} />
            <ChipReadonly label="UPT" value={inspectionIdentity.namaUpt} C={C} />
            {items.length === 0 ? (
              <div style={{
                border: `1px solid ${C.border}`, borderRadius: 10, padding: "8px 12px",
                background: C.surface, display: "grid", gap: 2, minWidth: 0,
              }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: ".4px" }}>Gudang</span>
                <select
                  value={selectedGudangId}
                  onChange={e => setSelectedGudangId(e.target.value)}
                  style={{
                    border: "none", background: "transparent", outline: "none", width: "100%",
                    padding: 0, cursor: "pointer", fontSize: 13,
                    fontWeight: 700, color: selectedGudangId ? C.text : C.muted,
                  }}
                >
                  <option value="">— Pilih gudang —</option>
                  {scopedGudangList.map(g => <option key={g.id} value={g.id}>{g.nama}</option>)}
                </select>
              </div>
            ) : (
              <ChipReadonly label="Gudang" value={lockedGudang?.nama || "—"} C={C} />
            )}
            {items.length > 0 && (
              <p style={{ margin: 0, fontSize: 12, color: C.muted, gridColumn: "1/-1" }}>Gudang terkunci setelah material pertama ditambahkan.</p>
            )}
            <ChipReadonly label="Nomor BA" value={lastSavedBa?.nomorBa || "Otomatis saat simpan"} muted={!lastSavedBa} C={C} />
            <ChipReadonly label="Manager UPT" value={inspectionIdentity.managerUpt} C={C} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(auto-fit,minmax(220px,1fr))", gap: 12, alignItems: "start" }}>
            <div>
              <label style={labelStyle(C)}>Pelaksana Logistik *</label>
              <input style={{ ...sty.input, marginTop: 4 }} value={pelaksanaLogistik} onChange={e => setPelaksanaLogistik(e.target.value)} placeholder="Nama pelaksana logistik" />
            </div>
            <div>
              <label style={labelStyle(C)}>Pelaksara Pemeliharaan *</label>
              <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                <input
                  style={{ ...sty.input, flex: 1 }}
                  value={pelaksaraDraft}
                  onChange={e => setPelaksaraDraft(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addPelaksara(); } }}
                  placeholder="Nama pelaksara pemeliharaan"
                />
                <button type="button" onClick={addPelaksara} className="approval-btn--cancel" style={{ minHeight: 44 }}>Tambah</button>
              </div>
              {pelaksaraPemeliharaan.length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
                  {pelaksaraPemeliharaan.map(name => (
                    <span key={name} style={{
                      display: "inline-flex", alignItems: "center", gap: 6,
                      padding: "6px 10px", borderRadius: 999, fontSize: 13, fontWeight: 700,
                      border: `1.5px solid ${C.green}`, background: "#dcfce7", color: C.green,
                    }}>
                      {name}
                      <button type="button" onClick={() => removePelaksara(name)} style={{
                        border: "none", background: "transparent", color: C.green, cursor: "pointer",
                        fontSize: 15, lineHeight: 1, padding: 0,
                      }}>×</button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
          <p style={{ margin: 0, fontSize: 12, color: C.muted }}>Field bertanda * wajib diisi sebelum menyimpan BA.</p>

          {/* Langkah 2 — Pilih material */}
          <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 16, display: "grid", gap: 12 }}>
            <StepHeader title="Pilih Material Cadang" C={C} trailing={
              <span style={{ fontSize: 12, fontWeight: 800, color: C.muted }}>
                Material {items.length}/{MATERIAL_INSPECTION_MAX_ITEMS_PER_BATCH}
              </span>
            } />
            {items.length > 0 && (
              <div style={{ height: 6, borderRadius: 999, background: C.border, overflow: "hidden" }}>
                <div style={{ width: `${progressPct}%`, height: "100%", background: "#1d4ed8", transition: "width .2s" }} />
              </div>
            )}

            {items.length >= MATERIAL_INSPECTION_MAX_ITEMS_PER_BATCH && (
              <p style={{ margin: 0, fontSize: 12, color: C.muted }}>Maksimal {MATERIAL_INSPECTION_MAX_ITEMS_PER_BATCH} material per BA tercapai.</p>
            )}

            {activeGudangId && items.length > 0 && items.length < MATERIAL_INSPECTION_MAX_ITEMS_PER_BATCH && !searchOpen && (
              <button
                type="button"
                className="approval-btn--primary"
                onClick={() => setSearchOpen(true)}
                style={{ minHeight: 44, width: isMobile ? "100%" : "auto", justifySelf: isMobile ? "stretch" : "start" }}
              >
                ＋ Tambah Material
              </button>
            )}

            {activeGudangId && items.length < MATERIAL_INSPECTION_MAX_ITEMS_PER_BATCH && searchOpen && (
              <div style={{
                border: `1.5px solid ${C.accent}40`,
                borderRadius: 14,
                padding: 14,
                display: "grid",
                gap: 10,
                background: C.surface,
                boxShadow: "0 8px 24px -10px rgba(29,78,216,0.25)",
              }}>
                <button type="button" onClick={() => setSearchOpen(o => !o)} style={{
                  display: "flex", alignItems: "center", gap: 8, minHeight: 44,
                  border: "none", background: "transparent", color: C.text, cursor: "pointer", padding: 0,
                  fontSize: 13, fontWeight: 800, textAlign: "left",
                }}>
                  <MagnifyingGlass size={16} color={C.muted} />
                  <span style={{ flex: 1 }}>Cari Material Cadang</span>
                  <CaretDown size={18} color={C.muted} style={{ transform: searchOpen ? "rotate(180deg)" : "none", transition: "transform .15s" }} />
                </button>
                {searchOpen && (
                  <>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, border: `1px solid ${C.border}`, borderRadius: 10, paddingLeft: 12, background: C.bg }}>
                      <MagnifyingGlass size={16} color={C.muted} />
                      <input
                        ref={pickerSearchRef}
                        style={{ ...sty.input, minHeight: 44, border: "none", background: "transparent", paddingLeft: 0, flex: 1 }}
                        placeholder={lockedGudang ? `Cari material Cadang di ${lockedGudang.nama}…` : "Cari material Cadang…"}
                        value={pickerQuery}
                        onChange={e => setPickerQuery(e.target.value)}
                      />
                      {pickerQuery && (
                        <button type="button" onClick={() => setPickerQuery("")} style={{
                          border: "none", background: "transparent", color: C.muted, cursor: "pointer",
                          fontSize: 17, lineHeight: 1, padding: 8,
                        }}>×</button>
                      )}
                    </div>
                    {pickerQuery.trim() && (
                      <p style={{ margin: 0, fontSize: 12, color: C.muted }}>
                        {pickerResults.length} material Cadang di Gudang {lockedGudang?.nama || scopedGudangList.find(g => g.id === activeGudangId)?.nama || "—"}
                      </p>
                    )}
                    {!pickerQuery.trim() ? (
                      <div style={{ padding: 20, textAlign: "center", color: C.muted, fontSize: 13 }}>
                        Ketik nama atau nomor katalog untuk mencari material.
                      </div>
                    ) : pickerResults.length === 0 ? (
                      <div style={{ padding: 24, textAlign: "center", color: C.muted, fontSize: 13 }}>
                        <Package size={32} weight="thin" style={{ opacity: 0.5 }} />
                        <p style={{ margin: "8px 0 0" }}>Tidak ada material Cadang di gudang ini.</p>
                      </div>
                    ) : (
                      <div style={{ display: "grid", gap: 6, maxHeight: 320, overflowY: "auto", paddingRight: 4 }}>
                        {pickerResults.map(opt => (
                          <button key={opt.stock.id} onClick={() => addItem(opt.stock.id)} style={{
                            textAlign: "left", padding: "10px 12px", borderRadius: 10,
                            minHeight: isMobile ? 44 : undefined,
                            border: `1px solid ${C.border}`, background: "transparent", color: C.text,
                            cursor: "pointer", display: "grid", gap: 2, transition: "border-color .12s, background .12s",
                          }}
                          onMouseEnter={e => { e.currentTarget.style.borderColor = C.accent; e.currentTarget.style.background = `${C.accent}0d`; }}
                          onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.background = "transparent"; }}
                          >
                            <strong style={{ fontSize: 13 }}>{opt.katalog?.katalog || opt.katalog?.noKatalog || "—"}</strong>
                            <span style={{ fontSize: 12, color: C.muted }}>
                              {opt.katalog?.name || opt.stock.name || "Material"} · {opt.lokasi?.kode || opt.lokasi?.nama || "—"} · {opt.stock.qty || 0} {opt.katalog?.satuan || opt.stock.satuan || "BH"}
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            <StepHeader title="Isi Hasil Inspeksi per Material" C={C} trailing={
              items.length > 0 ? (
                <span style={{ fontSize: 12, color: C.muted }}>
                  {completeCount === items.length ? "Semua lengkap" : (completeCount + "/" + items.length + " lengkap — klik material untuk membuka")}
                </span>
              ) : null
            } />
            {items.length === 0 ? (
              <div style={{
                border: `1.5px dashed ${C.border}`, borderRadius: 14, padding: isMobile ? 28 : 40,
                textAlign: "center", display: "grid", gap: 14, justifyItems: "center",
              }}>
                <div style={{ width: 64, height: 64, borderRadius: "50%", background: C.bg, display: "grid", placeItems: "center", color: C.accent }}>
                  <Stack size={32} weight="thin" />
                </div>
                <div>
                  <h3 style={{ margin: "0 0 4px", fontSize: 15 }}>Belum ada material</h3>
                  <p style={{ margin: 0, fontSize: 13, color: C.muted }}>
                    {activeGudangId ? "Cari dan pilih material Cadang di atas untuk mulai inspeksi." : "Pilih gudang dulu untuk mencari material."}
                  </p>
                </div>
              </div>
            ) : (
              <div style={{ display: "grid", gap: 12 }}>
                {items.map((item, index) => (
                  <ItemCard
                    key={item.stockId}
                    item={item}
                    index={index}
                    expanded={expandedItemIndex === index}
                    isMobile={isMobile}
                    C={C}
                    sty={sty}
                    onToggle={() => toggleItem(index)}
                    onUpdate={patch => updateItem(index, patch)}
                    onChecklist={(k, v) => updateItemChecklist(index, k, v)}
                    onAddPhotos={files => addPhotos(index, files)}
                    onRemovePhoto={pi => removePhoto(index, pi)}
                    onRemove={() => removeItem(index)}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Langkah 4 — Simpan (baris aksi compact, in-flow) */}
          <div className="no-print" style={{
            display: "flex",
            flexDirection: isMobile ? "column" : "row",
            alignItems: isMobile ? "stretch" : "center",
            justifyContent: "space-between",
            gap: 12,
            marginTop: 4,
            paddingTop: 16,
            borderTop: `1px solid ${C.border}`,
          }}>
            <div style={{ display: "grid", gap: 2, minWidth: 0, flex: "1 1 auto" }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: C.text }}>Simpan Berita Acara</span>
              <span style={{ fontSize: 12, color: C.muted }}>
                {items.length === 0
                  ? "Tambahkan material dulu"
                  : (completeCount === items.length && !formInvalid ? "Siap disimpan" : `${completeCount}/${items.length} material lengkap`)}
              </span>
            </div>
            <div className="approval-actions" style={{
              flex: isMobile ? "1 1 auto" : "0 0 auto",
              justifyContent: isMobile ? "stretch" : "flex-end",
              alignSelf: isMobile ? "stretch" : "center",
              margin: 0,
            }}>
              <button
                type="button"
                className="approval-btn--primary"
                disabled={saving || formInvalid}
                onClick={saveBatch}
                style={{ minHeight: 44 }}
              >
                <CheckCircle size={16} weight="fill" aria-hidden="true" />
                {saving ? "Menyimpan…" : "Simpan BA Inspeksi"}
              </button>
            </div>
          </div>
        </div>
      )}

      {view === "form" && !writer && (
        <div className="no-print" style={{ ...sty.card, textAlign: "center", color: C.muted, fontSize: 13 }}>
          Akses baca saja. Hanya ADMIN/TL yang dapat membuat Berita Acara inspeksi.
        </div>
      )}

      {view === "history" && (
        <div className="no-print" style={{ ...sty.card, display: "grid", gap: 12 }}>
          <StepHeader title="Riwayat Berita Acara" C={C} />
          {scopedBatches.length === 0 ? (
            <p style={{ margin: 0, fontSize: 13, color: C.muted }}>Belum ada BA tersimpan.</p>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(auto-fit,minmax(320px,1fr))", gap: 12 }}>
              {scopedBatches.map(batch => (
                <BatchCard
                  key={batch.id}
                  batch={batch}
                  expanded={expandedBatchId === batch.id}
                  photoUrls={batchPhotoUrls}
                  isMobile={isMobile}
                  C={C}
                  sty={sty}
                  onToggle={() => setExpandedBatchId(id => (id === batch.id ? null : batch.id))}
                  onPrint={() => printBa(batch)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {printBatch && (
        <article className="inspection-ba">
          <h2 style={{ textAlign: "center", marginBottom: 2, fontSize: 18 }}>BERITA ACARA INSPEKSI MATERIAL CADANG</h2>
          <p style={{ textAlign: "center", marginTop: 0, fontSize: 13 }}>Nomor: {printBatch.nomorBa || "—"}</p>
          <p style={{ fontSize: 13 }}>
            Pada tanggal {printBatch.tanggal || "—"}, telah dilakukan inspeksi material cadang di Gudang {printBatch.namaGudang || printBatch.gudangId || "—"} ({printBatch.namaUpt || printBatch.uptId || "—"}).
          </p>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, marginTop: 8 }}>
            <thead>
              <tr>
                {["No", "Nomor Katalog", "Nama Material", "Lokasi", "Jumlah", "Kondisi", "Kelayakan", "Keterangan"].map(h => (
                  <th key={h} style={{ border: "1px solid #222", padding: 6, textAlign: "left", background: "#eee" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(printBatch.items || []).map((it, i) => (
                <tr key={it.id || i}>
                  <td style={{ border: "1px solid #222", padding: 6 }}>{i + 1}</td>
                  <td style={{ border: "1px solid #222", padding: 6 }}>{it.noKatalog || "—"}</td>
                  <td style={{ border: "1px solid #222", padding: 6 }}>{it.namaBarang || "—"}</td>
                  <td style={{ border: "1px solid #222", padding: 6 }}>{it.lokasiNama || "—"}</td>
                  <td style={{ border: "1px solid #222", padding: 6 }}>{it.qtyStok} {it.satuan || ""}</td>
                  <td style={{ border: "1px solid #222", padding: 6 }}>{it.kondisi || "—"}</td>
                  <td style={{ border: "1px solid #222", padding: 6 }}>{it.statusKelayakan || "—"}</td>
                  <td style={{ border: "1px solid #222", padding: 6 }}>{it.keteranganVisual || it.catatan || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {printBatch.items?.some(it => it.photoPaths?.length) && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 14 }}>
              {printBatch.items.flatMap((it, i) => (it.photoPaths || []).map((p, pi) => (
                <figure key={`${i}-${pi}`} style={{ margin: 0 }}>
                  {batchPhotoUrls[p] ? <img src={batchPhotoUrls[p]} alt={`Foto ${pi + 1}`} style={{ width: 180, maxHeight: 150, objectFit: "cover", border: "1px solid #222" }} /> : null}
                  <figcaption style={{ fontSize: 10, textAlign: "center" }}>{it.namaBarang} #{pi + 1}</figcaption>
                </figure>
              )))}
            </div>
          )}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 16, marginTop: 45, textAlign: "center", fontSize: 12 }}>
            <div>Pelaksana Logistik<br /><br /><br /><b>{printBatch.pelaksanaLogistik || "—"}</b></div>
            <div>Pelaksara Pemeliharaan<br /><br /><br /><b>{pelaksaraDisplay(printBatch.pelaksaraPemeliharaan)}</b></div>
            <div>Manager UPT<br /><br /><br /><b>{printBatch.managerUpt || "—"}</b></div>
          </div>
        </article>
      )}
    </div>
  );
}

function StepHeader({ title, C, trailing }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 10,
      fontSize: 12, fontWeight: 800, color: C.accent, textTransform: "uppercase",
      borderBottom: `1px solid ${C.border}`, paddingBottom: 4,
    }}>
      <span>{title}</span>
      {trailing && <span style={{ marginLeft: "auto", textTransform: "none" }}>{trailing}</span>}
    </div>
  );
}

function ChipReadonly({ label, value, muted, C }) {
  return (
    <div style={{
      border: `1px solid ${C.border}`, borderRadius: 10, padding: "8px 12px",
      background: C.surface, display: "grid", gap: 2,
    }}>
      <span style={{ fontSize: 12, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: ".4px" }}>{label}</span>
      <span style={{ fontSize: 13, fontWeight: 700, color: muted ? C.muted : C.text }}>{value}</span>
    </div>
  );
}

function ItemCard({ item, index, expanded, isMobile, C, sty, onToggle, onUpdate, onChecklist, onAddPhotos, onRemovePhoto, onRemove }) {
  const previews = usePhotoPreviews(item.photos);
  const complete = itemComplete(item);
  return (
    <div style={{
      border: `1.5px solid ${expanded ? C.accent : C.border}`, borderRadius: 14, overflow: "hidden",
      boxShadow: expanded ? "0 6px 18px -8px rgba(29,78,216,0.25)" : "none",
      transition: "border-color .12s, box-shadow .12s",
    }}>
      {/* Header kartu (klik → toggle accordion) */}
      <button onClick={onToggle} style={{
        width: "100%", textAlign: "left", border: "none", background: "transparent",
        color: C.text, cursor: "pointer", padding: "12px 14px",
        display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
      }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 800 }}>{item.namaBarang || "Material"}</div>
          <div style={{ fontSize: 12, color: C.muted }}>
            {item.noKatalog || "—"} · {item.lokasiNama || "—"} · {item.qtyStok} {item.satuan}
          </div>
        </div>
        <span style={{
          display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, fontWeight: 800,
          padding: "3px 10px", borderRadius: 999,
          background: complete ? "#dcfce7" : "#fef3c7", color: complete ? C.green : C.yellow,
          boxShadow: `inset 0 0 0 1px ${complete ? C.green : C.yellow}33`,
        }}>
          {complete ? <CheckCircle size={14} weight="fill" /> : <Camera size={14} weight="fill" />}
          {complete ? "Lengkap" : `Foto ${item.photos.length}/2`}
        </span>
        <CaretDown
          size={18}
          color={C.muted}
          style={{ transform: expanded ? "rotate(180deg)" : "none", transition: "transform .15s" }}
        />
      </button>

      {expanded && (
        <div style={{ borderTop: `1px solid ${C.border}`, padding: 14, display: "grid", gap: 14 }}>
          {/* 3.1 — Identitas terkunci + Hapus material */}
          <MicroStep title="Identitas material (terkunci)" C={C}>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
              <ChipReadonly label="No. Katalog" value={item.noKatalog || "—"} C={C} />
              <ChipReadonly label="Lokasi" value={item.lokasiNama || "—"} C={C} />
              <ChipReadonly label="Qty" value={`${item.qtyStok} ${item.satuan}`} C={C} />
              <span style={{ flex: 1 }} />
              <button
                className="approval-btn--cancel"
                onClick={onRemove}
                style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, minHeight: isMobile ? 44 : undefined }}
              >
                <Trash size={14} /> Hapus material
              </button>
            </div>
          </MicroStep>

          {/* 3.2 — Penilaian */}
          <MicroStep title="Penilaian" C={C}>
            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(auto-fit,minmax(160px,1fr))", gap: 10 }}>
              <label style={labelStyle(C)}>Kondisi
                <select style={{ ...sty.select, marginTop: 4 }} value={item.kondisi} onChange={e => onUpdate({ kondisi: e.target.value })}>
                  {KONDISI.map(v => <option key={v}>{v}</option>)}
                </select>
              </label>
              <label style={labelStyle(C)}>Kelayakan
                <select style={{ ...sty.select, marginTop: 4 }} value={item.statusKelayakan} onChange={e => onUpdate({ statusKelayakan: e.target.value })}>
                  {KELAYAKAN.map(v => <option key={v}>{v}</option>)}
                </select>
              </label>
              <label style={labelStyle(C)}>Jenis MTU
                <input style={{ ...sty.input, marginTop: 4 }} value={item.jenisMtu} onChange={e => onUpdate({ jenisMtu: e.target.value })} placeholder="Contoh: MTU 1 phasa" />
              </label>
            </div>
          </MicroStep>

          {/* 3.3 — Checklist visual (chip toggle) */}
          <MicroStep title="Checklist Visual" C={C}>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {CHECKLIST_KEYS.map(([key, label]) => {
                const on = item.checklist[key];
                return (
                  <button key={key} type="button" onClick={() => onChecklist(key, !on)} style={{
                    display: "inline-flex", alignItems: "center", gap: 6,
                    padding: "8px 12px", minHeight: isMobile ? 44 : 36, borderRadius: 999, cursor: "pointer",
                    fontSize: 13, fontWeight: 700, border: `1.5px solid ${on ? C.green : C.border}`,
                    background: on ? "#dcfce7" : "transparent", color: on ? C.green : C.muted,
                    transition: "all .12s",
                  }}>
                    {on ? <CheckCircle size={15} weight="fill" /> : <span style={{ width: 15, height: 15, borderRadius: "50%", border: `1.5px solid ${C.border}`, display: "inline-block" }} />}
                    {label}
                  </button>
                );
              })}
            </div>
          </MicroStep>

          {/* 3.4 — Keterangan + Catatan */}
          <MicroStep title="Keterangan & Catatan" C={C}>
            <div style={{ display: "grid", gap: 10 }}>
              <label style={labelStyle(C)}>Keterangan Visual
                <textarea style={{ ...sty.input, marginTop: 4, minHeight: 56 }} value={item.keteranganVisual} onChange={e => onUpdate({ keteranganVisual: e.target.value })} placeholder="Contoh: cat mengelupas pada body…" />
              </label>
              <label style={labelStyle(C)}>Catatan
                <textarea style={{ ...sty.input, marginTop: 4, minHeight: 56 }} value={item.catatan} onChange={e => onUpdate({ catatan: e.target.value })} placeholder="Catatan tambahan untuk inspeksi ini…" />
              </label>
            </div>
          </MicroStep>

          {/* 3.5 — Foto wajib 2 */}
          <MicroStep title="Foto Inspeksi (wajib tepat 2)" C={C} trailing={
            <span style={{
              fontSize: 12, fontWeight: 800, padding: "3px 10px", borderRadius: 999,
              background: complete ? "#dcfce7" : "#fee2e2", color: complete ? C.green : C.red,
              boxShadow: `inset 0 0 0 1px ${complete ? C.green : C.red}33`,
            }}>
              {complete ? "2/2 lengkap" : `${item.photos.length}/2 kurang`}
            </span>
          }>
            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "120px 120px", gap: 12, justifyItems: "stretch" }}>
              {[0, 1].map(slot => {
                const file = item.photos[slot];
                const url = previews[slot];
                return (
                  <div key={slot} style={{
                    border: `1.5px dashed ${file ? C.green : C.border}`, borderRadius: 10,
                    padding: 8, minHeight: 120, display: "grid", gap: 6, placeItems: "center",
                    background: file ? "#dcfce722" : "transparent", position: "relative",
                  }}>
                    <span style={{ fontSize: 12, fontWeight: 800, color: C.muted, textTransform: "uppercase" }}>Foto {slot + 1}</span>
                    {url ? (
                      <div style={{ position: "relative" }}>
                        <img src={url} alt={`Foto ${slot + 1}`} style={{ width: "100%", height: 92, objectFit: "cover", borderRadius: 10, border: `1px solid ${C.border}` }} />
                        <button onClick={() => onRemovePhoto(slot)} style={{ position: "absolute", top: -8, right: -8, borderRadius: "50%", border: "none", background: "#dc2626", color: "#fff", width: 22, height: 22, fontSize: 13, cursor: "pointer", lineHeight: 1, display: "grid", placeItems: "center" }}>×</button>
                      </div>
                    ) : (
                      <label style={{ display: "grid", gap: 4, justifyItems: "center", cursor: "pointer", color: C.muted }}>
                        <Camera size={22} weight="thin" />
                        <span style={{ fontSize: 12 }}>Tambah foto</span>
                        <input
                          type="file"
                          accept="image/jpeg,image/png,image/webp"
                          capture="environment"
                          style={{ display: "none" }}
                          onChange={e => { onAddPhotos(e.target.files); e.target.value = ""; }}
                        />
                      </label>
                    )}
                  </div>
                );
              })}
            </div>
          </MicroStep>
        </div>
      )}
    </div>
  );
}

function MicroStep({ title, C, trailing, children }) {
  return (
    <div style={{ display: "grid", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 12, fontWeight: 800, color: C.text, textTransform: "uppercase", letterSpacing: ".3px" }}>{title}</span>
        {trailing && <span style={{ marginLeft: "auto" }}>{trailing}</span>}
      </div>
      {children}
    </div>
  );
}

function BatchCard({ batch, expanded, photoUrls, isMobile, C, sty, onToggle, onPrint }) {
  return (
    <div style={{
      border: `1px solid ${C.border}`, borderRadius: 14, padding: 12, display: "grid", gap: 10,
      boxShadow: "0 1px 2px rgba(16,24,40,0.04)",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start", flexWrap: "wrap" }}>
        <div style={{ display: "grid", gap: 4 }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: C.accent, display: "inline-flex", alignItems: "center", gap: 6 }}>
            <ClipboardText size={14} weight="fill" /> {batch.nomorBa || "—"}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            <MetaChip C={C}>{batch.tanggal || "—"}</MetaChip>
            <MetaChip C={C}>{batch.namaGudang || batch.gudangId || "—"}</MetaChip>
            <MetaChip C={C}>{batch.items?.length || 0} material</MetaChip>
          </div>
        </div>
        <div className="approval-actions approval-actions--compact" style={{ flex: "0 0 auto", alignSelf: "center", margin: 0 }}>
          <button type="button" className="approval-btn--cancel" onClick={onToggle}>
            {expanded ? "Tutup" : "Detail"}
          </button>
          <button type="button" className="approval-btn--cancel" onClick={onPrint}>
            <Printer size={14} aria-hidden="true" /> Cetak BA
          </button>
        </div>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        <MetaChip C={C} bold>UPT: {batch.namaUpt || batch.uptId || "—"}</MetaChip>
        <MetaChip C={C}>Logistik: {batch.pelaksanaLogistik || "—"}</MetaChip>
        <MetaChip C={C}>Pemeliharaan: {pelaksaraDisplay(batch.pelaksaraPemeliharaan)}</MetaChip>
        <MetaChip C={C}>Manager: {batch.managerUpt || "—"}</MetaChip>
      </div>
      {expanded && (batch.items || []).length > 0 && (
        <div style={{ display: "grid", gap: 8, marginTop: 4, borderTop: `1px solid ${C.border}`, paddingTop: 10 }}>
          {(batch.items || []).map((it, i) => (
            <div key={it.id || i} style={{ border: `1px solid ${C.border}`, borderRadius: 10, padding: 10, fontSize: 13, display: "grid", gap: 4 }}>
              <div style={{ fontWeight: 800 }}>{it.namaBarang || "Material"}</div>
              <div style={{ color: C.muted, fontSize: 12 }}>{it.noKatalog || "—"} · {it.lokasiNama || "—"} · {it.qtyStok} {it.satuan}</div>
              <div style={{ fontSize: 12 }}>Kondisi: <b>{it.kondisi || "—"}</b> · Kelayakan: <b>{it.statusKelayakan || "—"}</b></div>
              {it.keteranganVisual && <div style={{ fontSize: 12, color: C.muted }}>Keterangan: {it.keteranganVisual}</div>}
              {it.photoPaths?.length > 0 && (
                <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
                  {it.photoPaths.map((p, pi) => photoUrls[p] ? (
                    <img key={pi} src={photoUrls[p]} alt={`Foto ${pi + 1}`} style={{ width: 70, height: 70, objectFit: "cover", borderRadius: 10, border: `1px solid ${C.border}` }} />
                  ) : null)}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function MetaChip({ C, children, bold }) {
  return (
    <span style={{
      display: "inline-block", padding: "3px 9px", borderRadius: 999, fontSize: 12, fontWeight: bold ? 800 : 600,
      background: C.bg, color: bold ? C.text : C.muted, border: `1px solid ${C.border}`,
    }}>{children}</span>
  );
}
