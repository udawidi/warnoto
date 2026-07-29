import { useEffect, useMemo, useRef, useState } from "react";
import { can } from "../lib/perms.js";
import { OperationsHero } from "./OperationsHero.jsx";
import {
  ClipboardText,
  Plus,
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

const KONDISI = ["BAIK", "RUSAK_RINGAN", "RUSAK_BERAT", "PERLU_KALIBRASI"];
const KELAYAKAN = ["READY", "MAINTENANCE", "RETEST", "ATTB_RECOMMENDED"];
const CHECKLIST_KEYS = [
  ["kebersihan", "Kebersihan"],
  ["bebasKarat", "Bebas karat"],
  ["bebasBocor", "Bebas bocor"],
  ["kemasanBaik", "Kemasan baik"],
];
const UPT_SBY = "UPT-SBY";
const MANAGER_UPT_SBY = "Yaya Supriman";
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
  rolePerms,
  C,
  sty,
  showToast,
  isMobile,
}) {
  const [view, setView] = useState("form");
  const [items, setItems] = useState([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQuery, setPickerQuery] = useState("");
  const [expandedItemIndex, setExpandedItemIndex] = useState(null);
  const [pelaksanaLogistik, setPelaksanaLogistik] = useState(currentUser?.name || "");
  const [pelaksaraPemeliharaan, setPelaksaraPemeliharaan] = useState("");
  const [saving, setSaving] = useState(false);
  const [lastSavedBa, setLastSavedBa] = useState(null);
  const [expandedBatchId, setExpandedBatchId] = useState(null);
  const [batchPhotoUrls, setBatchPhotoUrls] = useState({});
  const [printBatch, setPrintBatch] = useState(null);
  const pickerSearchRef = useRef(null);
  const writer = ["ADMIN", "TL"].includes(currentUser?.role) && can(currentUser, "aksi.buatInspeksiMaterial", rolePerms);

  const today = todayJakarta();

  // Stok Cadang canonical: hanya yang katalognya jenisBarang==="Cadang".
  const cadangStockOptions = useMemo(() => {
    const cadangKatalogIds = new Set(
      katalogList.filter(k => k?.jenisBarang === "Cadang").map(k => k.id),
    );
    return stocks
      .filter(s => cadangKatalogIds.has(s.katalogId))
      .map(stock => {
        const katalog = katalogList.find(k => k.id === stock.katalogId);
        const lokasi = lokasiList.find(l => l.id === stock.lokasiId);
        return { stock, katalog, lokasi };
      });
  }, [stocks, katalogList, lokasiList]);

  // Gudang terkunci dari material pertama; material berikutnya harus dari gudang yang sama.
  const lockedGudangId = useMemo(() => {
    if (!items.length) return null;
    const first = items[0];
    const lokasi = lokasiList.find(l => l.id === first.lokasiId);
    return lokasi?.gudangId || null;
  }, [items, lokasiList]);

  const lockedGudang = useMemo(
    () => gudangList.find(g => g.id === lockedGudangId) || null,
    [gudangList, lockedGudangId],
  );

  const pickerResults = useMemo(() => {
    const q = pickerQuery.trim().toLowerCase();
    const alreadySelected = new Set(items.map(it => it.stockId));
    return cadangStockOptions
      .filter(opt => !alreadySelected.has(opt.stock.id))
      .filter(opt => !lockedGudangId || opt.lokasi?.gudangId === lockedGudangId)
      .filter(opt => {
        if (!q) return true;
        const label = `${opt.katalog?.katalog || ""} ${opt.katalog?.name || ""} ${opt.stock.name || ""}`.toLowerCase();
        return label.includes(q);
      })
      .slice(0, 50);
  }, [cadangStockOptions, items, lockedGudangId, pickerQuery]);

  const completeCount = items.filter(itemComplete).length;
  const formInvalid = !items.length || items.some(it => !itemComplete(it)) || !pelaksanaLogistik.trim() || !pelaksaraPemeliharaan.trim();

  useEffect(() => {
    if (pickerOpen && pickerSearchRef.current) pickerSearchRef.current.focus();
  }, [pickerOpen]);

  useEffect(() => {
    if (expandedBatchId) {
      const batch = materialInspectionBatches.find(b => b.id === expandedBatchId);
      const paths = batch?.items?.flatMap(it => it.photoPaths || []) || [];
      if (!paths.length) { setBatchPhotoUrls({}); return; }
      let active = true;
      loadInspectionPhotoUrls(paths).then(urls => { if (active) setBatchPhotoUrls(urls); });
      return () => { active = false; };
    }
    setBatchPhotoUrls({});
  }, [expandedBatchId, materialInspectionBatches]);

  function addItem(stockId) {
    const opt = cadangStockOptions.find(o => o.stock.id === stockId);
    if (!opt) return;
    const nextIndex = items.length;
    setItems(prev => {
      if (prev.length >= MATERIAL_INSPECTION_MAX_ITEMS_PER_BATCH) return prev;
      if (prev.some(it => it.stockId === stockId)) return prev;
      return [...prev, emptyItem(opt.stock, opt.katalog, opt.lokasi)];
    });
    setExpandedItemIndex(nextIndex);
    setPickerOpen(false);
    setPickerQuery("");
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
    setItems(prev => prev.map((it, i) => {
      if (i !== index) return it;
      const combined = [...it.photos, ...incoming];
      if (combined.length > MATERIAL_INSPECTION_MAX_PHOTOS) {
        showToast("Maksimal dua foto per material.", "error");
        return it;
      }
      return { ...it, photos: combined };
    }));
  }

  function removePhoto(index, photoIndex) {
    setItems(prev => prev.map((it, i) => (i === index ? { ...it, photos: it.photos.filter((_, p) => p !== photoIndex) } : it)));
  }

  function resetForm() {
    setItems([]);
    setExpandedItemIndex(null);
    setPelaksaraPemeliharaan("");
    setPickerOpen(false);
    setPickerQuery("");
  }

  async function saveBatch() {
    if (!writer) return;
    if (!items.length) { showToast("Minimal satu material harus diperiksa.", "error"); return; }
    if (!pelaksanaLogistik.trim()) { showToast("Pelaksana Logistik wajib diisi.", "error"); return; }
    if (!pelaksaraPemeliharaan.trim()) { showToast("Pelaksara Pemeliharaan wajib diisi.", "error"); return; }
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
        uptId: UPT_SBY,
        gudangId: lockedGudangId,
        tanggal: today,
        pelaksanaLogistik: pelaksanaLogistik.trim(),
        pelaksaraPemeliharaan: pelaksaraPemeliharaan.trim(),
        managerUpt: MANAGER_UPT_SBY,
        namaUpt: currentUser?.upt || "UPT Surabaya",
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
          scope={currentUser?.upt || "UPT Surabaya"}
          metrics={[
            { label: "BA Tersimpan", value: materialInspectionBatches.length },
            { label: "Material di Form", value: items.length },
            { label: "Lengkap", value: `${completeCount}/${items.length}` },
            { label: writer ? "Akses Tulis" : "Akses Baca", value: writer ? "ADMIN/TL" : "VIEWER" },
          ]}
        />
      </div>

      {/* Sub-tab switch — segmented control navy aktif */}
      <div className="no-print" style={{
        display: "flex",
        flexDirection: isMobile ? "column" : "row",
        gap: 6,
        background: C.bg,
        borderRadius: 12,
        padding: 5,
        border: `1.5px solid ${C.border}`,
      }}>
        {tabs.map(t => (
          <button key={t.id} onClick={() => setView(t.id)} style={{
            ...(isMobile ? {} : { flex: 1 }),
            padding: "10px 16px",
            minHeight: isMobile ? 44 : undefined,
            borderRadius: 8,
            border: "none",
            cursor: "pointer",
            fontSize: 14,
            fontWeight: 800,
            background: view === t.id ? "linear-gradient(180deg,#2f6bf0,#1d4ed8)" : "transparent",
            color: view === t.id ? "#ffffff" : C.text,
            boxShadow: view === t.id ? "0 3px 10px rgba(29,78,216,0.35)" : "none",
            whiteSpace: isMobile ? "normal" : "nowrap",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
          }}>
            <ClipboardText size={16} weight={view === t.id ? "fill" : "regular"} />
            {t.label}
          </button>
        ))}
      </div>

      {view === "form" && writer && (
        <div className="no-print" style={{ ...sty.card, display: "grid", gap: 18 }}>
          {/* Langkah 1 — Identitas BA */}
          <StepHeader n={1} title="Identitas Berita Acara" C={C} />
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(auto-fit,minmax(200px,1fr))", gap: 10 }}>
            <ChipReadonly label="Tanggal" value={today} C={C} />
            <ChipReadonly label="UPT" value={UPT_SBY} C={C} />
            <ChipReadonly label="Gudang" value={lockedGudang?.nama || "Terkunci otomatis"} muted={!lockedGudang} C={C} />
            <ChipReadonly label="Nomor BA" value={lastSavedBa?.nomorBa || "Otomatis saat simpan"} muted={!lastSavedBa} C={C} />
            <ChipReadonly label="Manager UPT" value={MANAGER_UPT_SBY} C={C} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(auto-fit,minmax(220px,1fr))", gap: 12 }}>
            <label style={labelStyle(C)}>Pelaksana Logistik *
              <input style={{ ...sty.input, marginTop: 4 }} value={pelaksanaLogistik} onChange={e => setPelaksanaLogistik(e.target.value)} placeholder="Nama pelaksana logistik" />
            </label>
            <label style={labelStyle(C)}>Pelaksara Pemeliharaan *
              <input style={{ ...sty.input, marginTop: 4 }} value={pelaksaraPemeliharaan} onChange={e => setPelaksaraPemeliharaan(e.target.value)} placeholder="Nama pelaksara pemeliharaan" />
            </label>
          </div>
          <p style={{ margin: 0, fontSize: 12, color: C.muted }}>Field bertanda * wajib diisi sebelum menyimpan BA.</p>

          {/* Langkah 2 — Pilih material */}
          <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 16, display: "grid", gap: 12 }}>
            <StepHeader n={2} title="Pilih Material Cadang" C={C} trailing={
              <span style={{ fontSize: 12, fontWeight: 800, color: C.muted }}>
                Material {items.length}/{MATERIAL_INSPECTION_MAX_ITEMS_PER_BATCH}
              </span>
            } />
            {items.length > 0 && (
              <div style={{ height: 6, borderRadius: 999, background: C.border, overflow: "hidden" }}>
                <div style={{ width: `${progressPct}%`, height: "100%", background: "linear-gradient(90deg,#2f6bf0,#1d4ed8)", transition: "width .2s" }} />
              </div>
            )}
            <div className="approval-actions" style={{ justifyContent: "flex-start" }}>
              <button
                className="approval-btn--primary"
                disabled={items.length >= MATERIAL_INSPECTION_MAX_ITEMS_PER_BATCH}
                onClick={() => setPickerOpen(v => !v)}
                style={{ display: "inline-flex", alignItems: "center", gap: 8 }}
              >
                <Plus size={16} weight="bold" /> {pickerOpen ? "Tutup Pemilihan" : "Tambah Material Cadang"}
              </button>
            </div>
            {items.length >= MATERIAL_INSPECTION_MAX_ITEMS_PER_BATCH && (
              <p style={{ margin: 0, fontSize: 12, color: C.muted }}>Maksimal {MATERIAL_INSPECTION_MAX_ITEMS_PER_BATCH} material per BA tercapai.</p>
            )}

            {pickerOpen && (
              <div style={{
                border: `1.5px solid ${C.accent}40`,
                borderRadius: 12,
                padding: 14,
                display: "grid",
                gap: 10,
                background: C.surface,
                boxShadow: "0 8px 24px -10px rgba(29,78,216,0.25)",
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, border: `1px solid ${C.border}`, borderRadius: 10, paddingLeft: 12, background: C.bg }}>
                  <MagnifyingGlass size={16} color={C.muted} />
                  <input
                    ref={pickerSearchRef}
                    style={{ ...sty.input, border: "none", background: "transparent", paddingLeft: 0, flex: 1 }}
                    placeholder={lockedGudang ? `Cari material Cadang di ${lockedGudang.nama}…` : "Cari material Cadang…"}
                    value={pickerQuery}
                    onChange={e => setPickerQuery(e.target.value)}
                  />
                </div>
                {lockedGudang && (
                  <p style={{ margin: 0, fontSize: 12, color: C.muted }}>
                    Gudang terkunci: <b style={{ color: C.text }}>{lockedGudang.nama}</b> — material dari gudang lain tidak bisa dipilih.
                  </p>
                )}
                {pickerResults.length === 0 ? (
                  <div style={{ padding: 24, textAlign: "center", color: C.muted, fontSize: 13 }}>
                    <Package size={32} weight="thin" style={{ opacity: 0.5 }} />
                    <p style={{ margin: "8px 0 0" }}>Tidak ada material Cadang tersedia{lockedGudang ? ` di gudang ${lockedGudang.nama}` : ""}.</p>
                  </div>
                ) : (
                  <div style={{ display: "grid", gap: 6, maxHeight: 320, overflowY: "auto", paddingRight: 4 }}>
                    {pickerResults.map(opt => (
                      <button key={opt.stock.id} onClick={() => addItem(opt.stock.id)} style={{
                        textAlign: "left", padding: "10px 12px", borderRadius: 10,
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
              </div>
            )}

            {items.length === 0 ? (
              <div style={{
                border: `1.5px dashed ${C.border}`, borderRadius: 14, padding: isMobile ? 28 : 40,
                textAlign: "center", display: "grid", gap: 14, justifyItems: "center",
              }}>
                <div style={{ width: 64, height: 64, borderRadius: "50%", background: C.bg, display: "grid", placeItems: "center", color: C.accent }}>
                  <Stack size={32} weight="thin" />
                </div>
                <div>
                  <h3 style={{ margin: "0 0 4px", fontSize: 16 }}>Belum ada material</h3>
                  <p style={{ margin: 0, fontSize: 13, color: C.muted }}>Pilih material Cadang dari stok untuk mulai inspeksi.</p>
                </div>
                <div className="approval-actions" style={{ justifyContent: "center" }}>
                  <button className="approval-btn--primary" onClick={() => setPickerOpen(true)} style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                    <Plus size={16} weight="bold" /> Tambah Material Cadang
                  </button>
                </div>
              </div>
            ) : (
              <div style={{ display: "grid", gap: 12 }}>
                <StepHeader n={3} title="Isi Hasil Inspeksi per Material" C={C} trailing={
                  <span style={{ fontSize: 12, color: C.muted }}>
                    {completeCount === items.length ? "Semua lengkap" : (completeCount + "/" + items.length + " lengkap — klik material untuk membuka")}
                  </span>
                } />
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

          {/* Langkah 4 — Simpan */}
          <div style={{
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
              <StepHeader n={4} title="Simpan Berita Acara" C={C} />
              <span style={{ fontSize: 13, fontWeight: 700, color: C.text, paddingLeft: 36 }}>
                {items.length} material · {items.length && completeCount === items.length ? "siap disimpan" : `${completeCount}/${items.length || 0} lengkap`}
              </span>
              <span style={{ fontSize: 12, color: C.muted, paddingLeft: 36 }}>
                {formInvalid ? "Lengkapi pelaksana & dua foto per material sebelum simpan." : "Semua materi lengkap, siap membuat BA."}
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
          <StepHeader n={1} title="Riwayat Berita Acara" C={C} />
          {materialInspectionBatches.length === 0 ? (
            <p style={{ margin: 0, fontSize: 13, color: C.muted }}>Belum ada BA tersimpan.</p>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(auto-fit,minmax(320px,1fr))", gap: 12 }}>
              {materialInspectionBatches.map(batch => (
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
            <div>Pelaksara Pemeliharaan<br /><br /><br /><b>{printBatch.pelaksaraPemeliharaan || "—"}</b></div>
            <div>Manager UPT<br /><br /><br /><b>{printBatch.managerUpt || "—"}</b></div>
          </div>
        </article>
      )}
    </div>
  );
}

function StepHeader({ n, title, C, trailing }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <span style={{
        width: 26, height: 26, borderRadius: "50%", flex: "0 0 auto",
        background: "linear-gradient(180deg,#2f6bf0,#1d4ed8)", color: "#fff",
        display: "grid", placeItems: "center", fontSize: 12, fontWeight: 900,
      }}>{n}</span>
      <h3 style={{ margin: 0, fontSize: 15, fontWeight: 800, color: C.text }}>{title}</h3>
      {trailing && <span style={{ marginLeft: "auto" }}>{trailing}</span>}
    </div>
  );
}

function ChipReadonly({ label, value, muted, C }) {
  return (
    <div style={{
      border: `1px solid ${C.border}`, borderRadius: 10, padding: "8px 12px",
      background: C.surface, display: "grid", gap: 2,
    }}>
      <span style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: ".4px" }}>{label}</span>
      <span style={{ fontSize: 13, fontWeight: 700, color: muted ? C.muted : C.text }}>{value}</span>
    </div>
  );
}

function ItemCard({ item, index, expanded, isMobile, C, sty, onToggle, onUpdate, onChecklist, onAddPhotos, onRemovePhoto, onRemove }) {
  const previews = usePhotoPreviews(item.photos);
  const complete = itemComplete(item);
  return (
    <div style={{
      border: `1.5px solid ${expanded ? C.accent : C.border}`, borderRadius: 12, overflow: "hidden",
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
          <MicroStep n="3.1" title="Identitas material (terkunci)" C={C}>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
              <ChipReadonly label="No. Katalog" value={item.noKatalog || "—"} C={C} />
              <ChipReadonly label="Lokasi" value={item.lokasiNama || "—"} C={C} />
              <ChipReadonly label="Qty" value={`${item.qtyStok} ${item.satuan}`} C={C} />
              <span style={{ flex: 1 }} />
              <button
                className="approval-btn--cancel"
                onClick={onRemove}
                style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12 }}
              >
                <Trash size={14} /> Hapus material
              </button>
            </div>
          </MicroStep>

          {/* 3.2 — Penilaian */}
          <MicroStep n="3.2" title="Penilaian" C={C}>
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
          <MicroStep n="3.3" title="Checklist Visual" C={C}>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {CHECKLIST_KEYS.map(([key, label]) => {
                const on = item.checklist[key];
                return (
                  <button key={key} type="button" onClick={() => onChecklist(key, !on)} style={{
                    display: "inline-flex", alignItems: "center", gap: 6,
                    padding: "8px 12px", minHeight: 36, borderRadius: 999, cursor: "pointer",
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
          <MicroStep n="3.4" title="Keterangan & Catatan" C={C}>
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
          <MicroStep n="3.5" title="Foto Inspeksi (wajib tepat 2)" C={C} trailing={
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
                    <span style={{ fontSize: 11, fontWeight: 800, color: C.muted, textTransform: "uppercase" }}>Foto {slot + 1}</span>
                    {url ? (
                      <div style={{ position: "relative" }}>
                        <img src={url} alt={`Foto ${slot + 1}`} style={{ width: "100%", height: 92, objectFit: "cover", borderRadius: 8, border: `1px solid ${C.border}` }} />
                        <button onClick={() => onRemovePhoto(slot)} style={{ position: "absolute", top: -8, right: -8, borderRadius: "50%", border: "none", background: "#dc2626", color: "#fff", width: 22, height: 22, fontSize: 13, cursor: "pointer", lineHeight: 1, display: "grid", placeItems: "center" }}>×</button>
                      </div>
                    ) : (
                      <label style={{ display: "grid", gap: 4, justifyItems: "center", cursor: "pointer", color: C.muted }}>
                        <Camera size={22} weight="thin" />
                        <span style={{ fontSize: 11 }}>Tambah foto</span>
                        <input
                          type="file"
                          accept="image/jpeg,image/png,image/webp"
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

function MicroStep({ n, title, C, trailing, children }) {
  return (
    <div style={{ display: "grid", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 11, fontWeight: 800, color: C.accent }}>{n}</span>
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
      border: `1px solid ${C.border}`, borderRadius: 12, padding: 12, display: "grid", gap: 10,
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
        <MetaChip C={C}>Pemeliharaan: {batch.pelaksaraPemeliharaan || "—"}</MetaChip>
        <MetaChip C={C}>Manager: {batch.managerUpt || "—"}</MetaChip>
      </div>
      {expanded && (batch.items || []).length > 0 && (
        <div style={{ display: "grid", gap: 8, marginTop: 4, borderTop: `1px solid ${C.border}`, paddingTop: 10 }}>
          {(batch.items || []).map((it, i) => (
            <div key={it.id || i} style={{ border: `1px solid ${C.border}`, borderRadius: 8, padding: 10, fontSize: 13, display: "grid", gap: 4 }}>
              <div style={{ fontWeight: 800 }}>{it.namaBarang || "Material"}</div>
              <div style={{ color: C.muted, fontSize: 12 }}>{it.noKatalog || "—"} · {it.lokasiNama || "—"} · {it.qtyStok} {it.satuan}</div>
              <div style={{ fontSize: 12 }}>Kondisi: <b>{it.kondisi || "—"}</b> · Kelayakan: <b>{it.statusKelayakan || "—"}</b></div>
              {it.keteranganVisual && <div style={{ fontSize: 12, color: C.muted }}>Keterangan: {it.keteranganVisual}</div>}
              {it.photoPaths?.length > 0 && (
                <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
                  {it.photoPaths.map((p, pi) => photoUrls[p] ? (
                    <img key={pi} src={photoUrls[p]} alt={`Foto ${pi + 1}`} style={{ width: 70, height: 70, objectFit: "cover", borderRadius: 6, border: `1px solid ${C.border}` }} />
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
      display: "inline-block", padding: "3px 9px", borderRadius: 999, fontSize: 11, fontWeight: bold ? 800 : 600,
      background: C.bg, color: bold ? C.text : C.muted, border: `1px solid ${C.border}`,
    }}>{children}</span>
  );
}