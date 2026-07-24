import React, { useState, useMemo, useEffect, useRef } from "react";
import { fmtDate, uid } from "../lib/utils.js";
import { normalizeKatalog, matchesMaterialSearch } from "../lib/sap.js";

const KONDISI_OPTIONS = [
  { value: "BAIK", label: "BAIK", color: "#10b981", bg: "rgba(16, 185, 129, 0.15)" },
  { value: "RUSAK_RINGAN", label: "RUSAK RINGAN", color: "#f59e0b", bg: "rgba(245, 158, 11, 0.15)" },
  { value: "RUSAK_BERAT", label: "RUSAK BERAT", color: "#ef4444", bg: "rgba(239, 68, 68, 0.15)" },
  { value: "PERLU_KALIBRASI", label: "PERLU KALIBRASI", color: "#3b82f6", bg: "rgba(59, 130, 246, 0.15)" },
];

const STATUS_KELAYAKAN = [
  { value: "READY", label: "Siap Pakai (Ready)", color: "#10b981" },
  { value: "MAINTENANCE", label: "Perlu Maintenance", color: "#f59e0b" },
  { value: "RETEST", label: "Perlu Re-test / Kalibrasi", color: "#3b82f6" },
  { value: "ATTB_RECOMMENDED", label: "Rekomendasi Afkir / ATTB", color: "#ef4444" },
];

const JENIS_MTU_OPTIONS = ["CT", "CB 150kV", "DS 150kV", "LA 150kV", "Transformator", "PT / CVT", "NGR", "Cubicle", "Lainnya"];

export function InspeksiMaterialCadangTab({
  stocks = [],
  katalogList = [],
  lokasiList = [],
  materialInspections = [],
  currentUser,
  C = {},
  sty = {},
  isMobile,
  showToast,
  canMutate = false,
  onSaveInspection
}) {
  const [subTab, setSubTab] = useState(() => canMutate ? "formInspeksi" : "riwayat");
  const [stockSearchQuery, setStockSearchQuery] = useState("");
  const [stockDropdownOpen, setStockDropdownOpen] = useState(false);
  const dropdownRef = useRef(null);

  // Selected Stock Item
  const [selectedStockId, setSelectedStockId] = useState("");
  const [selectedKatalogId, setSelectedKatalogId] = useState("");
  const [noKatalog, setNoKatalog] = useState("");
  const [namaBarang, setNamaBarang] = useState("");
  const [lokasiNama, setLokasiNama] = useState("GUDANG KETINTANG");
  const [qtyStok, setQtyStok] = useState(1);
  const [satuan, setSatuan] = useState("BH");

  // Form Details
  const [jenisMtu, setJenisMtu] = useState("CT");
  const [noSloc, setNoSloc] = useState("2000");
  const [jenisPeruntukan, setJenisPeruntukan] = useState("SPARE");
  const [estimasiPenyimpanan, setEstimasiPenyimpanan] = useState("2 Tahun");
  const [kondisi, setKondisi] = useState("BAIK");
  const [statusKelayakan, setStatusKelayakan] = useState("READY");
  const [keteranganVisual, setKeteranganVisual] = useState("");
  const [catatan, setCatatan] = useState("");
  const [paramKebersihan, setParamKebersihan] = useState(true);
  const [paramBebasKarat, setParamBebasKarat] = useState(true);
  const [paramBebasBocor, setParamBebasBocor] = useState(true);
  const [paramKemasanBaik, setParamKemasanBaik] = useState(true);
  const [foto1, setFoto1] = useState(null);
  const [foto2, setFoto2] = useState(null);
  const [saving, setSaving] = useState(false);

  // Modal Cetak Berita Acara (BA)
  const [printModal, setPrintModal] = useState(false);
  const [baData, setBaData] = useState(null);
  
  // Field Form Header Berita Acara
  const [baNoDokumen, setBaNoDokumen] = useState(`4/BA-INSPEKSI/UPT-SBYA/April/${new Date().getFullYear()}`);
  const [baTanggal, setBaTanggal] = useState(new Date().toISOString().split("T")[0]);
  const [baNamaGudang, setBaNamaGudang] = useState("GUDANG KETINTANG");
  const [baNoSloc, setBaNoSloc] = useState("2000");
  const [baNamaUpt, setBaNamaUpt] = useState("UPT Surabaya");
  const [baPelaksanaLogistik, setBaPelaksanaLogistik] = useState(currentUser?.name || "WIDI FERDIAN");
  const [baPelaksanaPemeliharaan, setBaPelaksanaPemeliharaan] = useState("M. HASSAN");
  const [baManagerUpt, setBaManagerUpt] = useState("YAYA SUPRIMAN");

  // Click outside to close stock search dropdown
  useEffect(() => {
    function handleClickOutside(e) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setStockDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (!canMutate) setSubTab("riwayat");
  }, [canMutate]);

  // Map stocks dengan metadata katalog & lokasi
  const enrichedStocks = useMemo(() => {
    return (stocks || []).map(s => {
      const kat = (katalogList || []).find(k => k.id === s.katalogId) || {};
      const normKat = normalizeKatalog(kat);
      const lok = (lokasiList || []).find(l => l.id === s.lokasiId) || {};
      const name = normKat.name || s.namaMaterial || s.materialDescription || s.name || "Material Stok";
      const noKatVal = normKat.noKat || s.noKatalog || s.noKat || "-";
      const uomVal = normKat.satuan || s.satuan || "BH";
      const lokVal = lok.nama || s.lokasiNama || s.lokasiId || "GUDANG KETINTANG";

      return {
        ...s,
        katalogName: name,
        noKat: noKatVal,
        satuan: uomVal,
        lokasiNama: lokVal,
        searchLabel: `${noKatVal} - ${name} (${lokVal})`
      };
    });
  }, [stocks, katalogList, lokasiList]);

  // Filtered stock list for autocomplete dropdown
  const filteredStockOptions = useMemo(() => {
    const q = stockSearchQuery.toLowerCase().trim();
    if (!q) return enrichedStocks.slice(0, 30);
    return enrichedStocks.filter(item => 
      matchesMaterialSearch([item.searchLabel, item.katalogName, item.noKat, item.lokasiNama], q)
    );
  }, [enrichedStocks, stockSearchQuery]);

  // Handle Pilih Barang dari Autocomplete Dropdown
  function selectStockItem(item) {
    setSelectedStockId(item.id);
    setSelectedKatalogId(item.katalogId || "");
    setNoKatalog(item.noKat);
    setNamaBarang(item.katalogName);
    setLokasiNama(item.lokasiNama);
    setQtyStok(item.qty || 1);
    setSatuan(item.satuan || "BH");

    // Auto detect jenis MTU
    const nameUpper = item.katalogName.toUpperCase();
    if (nameUpper.includes("CT") || nameUpper.includes("CURRENT TRANSFORMER")) setJenisMtu("CT");
    else if (nameUpper.includes("CB") || nameUpper.includes("CIRCUIT BREAKER")) setJenisMtu("CB 150kV");
    else if (nameUpper.includes("DS") || nameUpper.includes("DISCONNECTING")) setJenisMtu("DS 150kV");
    else if (nameUpper.includes("LA") || nameUpper.includes("ARRESTER")) setJenisMtu("LA 150kV");
    else if (nameUpper.includes("TRANSFORMATOR") || nameUpper.includes("TRAFO")) setJenisMtu("Transformator");

    setStockSearchQuery("");
    setStockDropdownOpen(false);
  }

  // Handle Upload Foto Tunggal (Foto 1 & Foto 2)
  function handleSinglePhotoAdd(e, setFotoFn) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFotoFn({ name: file.name, file, url: URL.createObjectURL(file), size: file.size, contentType: file.type });
    e.target.value = "";
  }

  // Simpan Hasil Inspeksi
  async function handleSaveInspeksi() {
    if (!canMutate) {
      showToast && showToast("Akun Anda hanya memiliki akses baca untuk Inspeksi Material.", "error");
      return;
    }
    if (!namaBarang.trim()) {
      showToast && showToast("Pilih atau isi nama barang material terlebih dahulu.", "error");
      return;
    }
    setSaving(true);
    try {
      const entry = {
        id: "INSP-" + Date.now() + "-" + uid().slice(-4),
        stockId: selectedStockId || null,
        katalogId: selectedKatalogId || null,
        noKatalog: noKatalog.trim() || "-",
        namaBarang: namaBarang.trim(),
        lokasiNama: lokasiNama.trim() || "GUDANG KETINTANG",
        qtyStok: Number(qtyStok) || 1,
        satuan: satuan.trim() || "BH",
        jenisMtu,
        noSloc,
        jenisPeruntukan,
        estimasiPenyimpanan,
        kondisi,
        statusKelayakan,
        keteranganVisual: keteranganVisual.trim() || (kondisi === "BAIK" ? "BAIK" : "PERLU PERHATIAN"),
        catatan: catatan.trim(),
        checklist: {
          kebersihan: paramKebersihan,
          bebasKarat: paramBebasKarat,
          bebasBocor: paramBebasBocor,
          kemasanBaik: paramKemasanBaik
        },
        inspectorId: currentUser?.id,
        inspectorName: currentUser?.name || currentUser?.username || "Auditor Logistik",
        createdAt: Date.now()
      };

      const saved = await onSaveInspection?.(entry, [foto1, foto2].filter(Boolean));
      if (!saved) {
        showToast && showToast("Gagal menyimpan inspeksi ke server. Form dan data foto tetap terbuka untuk dicoba lagi.", "error");
        return;
      }
      showToast && showToast(`✅ Inspeksi untuk ${namaBarang} berhasil disimpan.`);
      
      // Buka modal cetak Berita Acara (BA)
      openBaModal([saved]);
    } catch (err) {
      console.error("Error simpan inspeksi:", err);
      showToast && showToast("Gagal menyimpan inspeksi.", "error");
    } finally {
      setSaving(false);
    }
  }

  // Menyiapkan Modal Berita Acara untuk daftar inspeksi yang dipilih
  function openBaModal(items) {
    if (!items || !items.length) {
      showToast && showToast("Pilih minimal 1 item hasil inspeksi untuk cetak BA.", "error");
      return;
    }
    const first = items[0];
    setBaNamaGudang(first.lokasiNama || "GUDANG KETINTANG");
    setBaNoSloc(first.noSloc || "2000");
    setBaData({
      items,
      allFotos: items.flatMap(i => i.fotos || [])
    });
    setPrintModal(true);
  }

  // Trigger Print Browser
  function handleTriggerPrint() {
    window.print();
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* CSS Cetak khusus Berita Acara (@media print) */}
      <style dangerouslySetInnerHTML={{
        __html: `
        @media print {
          body * {
            visibility: hidden;
          }
          .ba-print-container, .ba-print-container * {
            visibility: visible;
          }
          .ba-print-container {
            position: absolute;
            left: 0;
            top: 0;
            width: 100%;
            padding: 0;
            margin: 0;
            background: white !important;
            color: black !important;
            font-family: 'Times New Roman', Times, serif;
          }
          .no-print {
            display: none !important;
          }
          .page-break {
            page-break-before: always;
          }
        }
      ` }} />

      {/* Sub-tab Navigation Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: `1px solid ${C.border || "#e2e8f0"}`, paddingBottom: 12, flexWrap: "wrap", gap: 12 }}>
        <div style={{ display: "flex", gap: 8 }}>
          {canMutate && (
            <button
              style={{ ...sty.btn(subTab === "formInspeksi" ? "primary" : "ghost", "sm") }}
              onClick={() => setSubTab("formInspeksi")}
            >
              📝 Formulir Inspeksi Material
            </button>
          )}

          <button
            style={{ ...sty.btn(subTab === "riwayat" ? "primary" : "ghost", "sm") }}
            onClick={() => setSubTab("riwayat")}
          >
            📋 Riwayat Hasil Inspeksi ({materialInspections.length})
          </button>
        </div>

        {materialInspections.length > 0 && (
          <button
            style={{ ...sty.btn("primary", "sm"), background: "#10b981", borderColor: "#059669" }}
            onClick={() => openBaModal(materialInspections)}
          >
            📄 Cetak Berita Acara (BA) Resmi
          </button>
        )}
      </div>

      {!canMutate && (
        <div style={{ padding: "10px 12px", borderRadius: 10, background: C.bg || "#f8fafc", border: `1px solid ${C.border || "#e2e8f0"}`, color: C.muted || "#64748b", fontSize: 12 }}>
          Akses baca saja — Anda dapat melihat riwayat dan mencetak Berita Acara, tetapi tidak dapat membuat atau mengubah inspeksi.
        </div>
      )}

      {/* SUB-TAB 1: FORMULIR INSPEKSI MATERIAL (LANGSUNG TERSEDIA) */}
      {canMutate && subTab === "formInspeksi" && (
        <div style={{ background: C.surface || "#ffffff", border: `1px solid ${C.border || "#e2e8f0"}`, borderRadius: 14, padding: 22, boxShadow: "0 4px 16px rgba(0,0,0,0.04)", maxWidth: 850, margin: "0 auto", width: "100%" }}>
          
          <div style={{ marginBottom: 18, borderBottom: `1px solid ${C.border || "#e2e8f0"}`, paddingBottom: 12 }}>
            <span style={{ fontSize: 10, fontWeight: 800, color: C.accent || "#2563eb", textTransform: "uppercase", letterSpacing: "0.5px" }}>FORMULIR BERITA ACARA INSPEKSI MTU</span>
            <h3 style={{ fontSize: 17, fontWeight: 800, color: C.text || "#0f172a", margin: "2px 0" }}>Input Data & Pemeriksaan Visual Material</h3>
            <p style={{ fontSize: 11, color: C.muted || "#64748b", margin: 0 }}>Pilih barang dari Data Stok atau ketik rincian material untuk membuat dokumen Berita Acara resmi.</p>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            
            {/* BAGIAN 1: CARI & PILIH BARANG DARI DATA STOK */}
            <div ref={dropdownRef} style={{ position: "relative", background: C.bg || "#f8fafc", padding: 16, borderRadius: 12, border: `1.5px solid ${C.border || "#cbd5e1"}` }}>
              <label style={{ ...sty.label, marginBottom: 6, display: "block", color: C.text || "#0f172a", fontWeight: 800 }}>
                🔍 Cari & Pilih Material dari Data Stok Gudang
              </label>
              
              <input
                style={{ ...sty.input, fontSize: 13, background: C.surface || "#ffffff", color: C.text || "#0f172a" }}
                placeholder="Ketik no katalog, nama barang (misal: CT, CB, LA), lokasi gudang..."
                value={stockSearchQuery || (namaBarang ? `${noKatalog} - ${namaBarang}` : "")}
                onFocus={() => setStockDropdownOpen(true)}
                onChange={e => {
                  setStockSearchQuery(e.target.value);
                  setStockDropdownOpen(true);
                }}
              />

              {/* Dropdown Results Autocomplete */}
              {stockDropdownOpen && (
                <div style={{
                  position: "absolute",
                  top: "100%",
                  left: 0,
                  right: 0,
                  zIndex: 100,
                  background: C.surface || "#ffffff",
                  border: `1px solid ${C.border || "#cbd5e1"}`,
                  borderRadius: 10,
                  marginTop: 4,
                  maxHeight: 240,
                  overflowY: "auto",
                  boxShadow: "0 10px 25px rgba(0,0,0,0.15)"
                }}>
                  {filteredStockOptions.length === 0 ? (
                    <div style={{ padding: 12, fontSize: 12, color: C.muted || "#64748b", textAlign: "center" }}>
                      Tidak ada barang stok yang cocok. Anda tetap dapat mengisi formulir secara manual di bawah.
                    </div>
                  ) : (
                    filteredStockOptions.map(stk => (
                      <div
                        key={stk.id}
                        onClick={() => selectStockItem(stk)}
                        style={{
                          padding: "10px 14px",
                          borderBottom: `1px solid ${C.border || "#f1f5f9"}`,
                          cursor: "pointer",
                          transition: "background 0.15s",
                          background: stk.id === selectedStockId ? (C.bg || "#eff6ff") : "transparent"
                        }}
                      >
                        <div style={{ fontSize: 12, fontWeight: 800, color: C.text || "#0f172a" }}>
                          <span style={{ color: C.accent || "#2563eb", marginRight: 8 }}>[{stk.noKat}]</span>
                          {stk.katalogName}
                        </div>
                        <div style={{ fontSize: 11, color: C.muted || "#64748b", marginTop: 2, display: "flex", gap: 12 }}>
                          <span>📍 {stk.lokasiNama}</span>
                          <span>📦 Qty Stok: <strong>{stk.qty || 0} {stk.satuan}</strong></span>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}

              {/* Summary Pill Barang yang Terpilih */}
              {namaBarang && (
                <div style={{ marginTop: 10, padding: "8px 12px", borderRadius: 8, background: C.surface || "#ffffff", border: `1px solid ${C.border || "#e2e8f0"}`, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                  <div style={{ fontSize: 11, color: C.text || "#0f172a" }}>
                    <span style={{ fontWeight: 800, color: C.accent || "#2563eb" }}>✓ Terpilih:</span> [{noKatalog}] <strong>{namaBarang}</strong> · Lokasi: {lokasiNama} ({qtyStok} {satuan})
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedStockId("");
                      setSelectedKatalogId("");
                      setNoKatalog("");
                      setNamaBarang("");
                      setStockSearchQuery("");
                    }}
                    style={{ background: "none", border: "none", color: "#ef4444", cursor: "pointer", fontSize: 11, fontWeight: 700 }}
                  >
                    ✕ Reset Pilihan
                  </button>
                </div>
              )}
            </div>

            {/* BAGIAN 2: RINCIAN MATERIAL & BA */}
            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(2, 1fr)", gap: 12 }}>
              <div>
                <label style={{ ...sty.label, marginBottom: 4, display: "block" }}>Nomor Katalog Material</label>
                <input
                  style={{ ...sty.input, fontSize: 12 }}
                  value={noKatalog}
                  onChange={e => setNoKatalog(e.target.value)}
                  placeholder="Contoh: 1002050628"
                />
              </div>

              <div>
                <label style={{ ...sty.label, marginBottom: 4, display: "block" }}>Material Description (Nama Material) *</label>
                <input
                  style={{ ...sty.input, fontSize: 12 }}
                  value={namaBarang}
                  onChange={e => setNamaBarang(e.target.value)}
                  placeholder="Contoh: CT;150kV;K;150-300/1A;5P20;36kV;N"
                />
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(4, 1fr)", gap: 12 }}>
              <div>
                <label style={{ ...sty.label, marginBottom: 4, display: "block" }}>Jenis MTU *</label>
                <select
                  style={{ ...sty.input, width: "100%", fontSize: 12, fontWeight: 700, background: C.surface, color: C.text }}
                  value={jenisMtu}
                  onChange={e => setJenisMtu(e.target.value)}
                >
                  {JENIS_MTU_OPTIONS.map(m => (
                    <option key={m} value={m} style={{ background: C.surface, color: C.text }}>{m}</option>
                  ))}
                </select>
              </div>

              <div>
                <label style={{ ...sty.label, marginBottom: 4, display: "block" }}>Base Unit (UOM)</label>
                <input
                  style={{ ...sty.input, fontSize: 12 }}
                  value={satuan}
                  onChange={e => setSatuan(e.target.value)}
                  placeholder="BH / U / SET / MTR"
                />
              </div>

              <div>
                <label style={{ ...sty.label, marginBottom: 4, display: "block" }}>Quantity *</label>
                <input
                  type="number"
                  style={{ ...sty.input, fontSize: 12 }}
                  value={qtyStok}
                  onChange={e => setQtyStok(e.target.value)}
                  placeholder="1"
                />
              </div>

              <div>
                <label style={{ ...sty.label, marginBottom: 4, display: "block" }}>No SLoc</label>
                <input
                  style={{ ...sty.input, fontSize: 12 }}
                  value={noSloc}
                  onChange={e => setNoSloc(e.target.value)}
                  placeholder="2000"
                />
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(2, 1fr)", gap: 12 }}>
              <div>
                <label style={{ ...sty.label, marginBottom: 4, display: "block" }}>Jenis Peruntukan</label>
                <select
                  style={{ ...sty.input, width: "100%", fontSize: 12, fontWeight: 700, background: C.surface, color: C.text }}
                  value={jenisPeruntukan}
                  onChange={e => setJenisPeruntukan(e.target.value)}
                >
                  <option value="SPARE" style={{ background: C.surface, color: C.text }}>SPARE (Cadang)</option>
                  <option value="PERSEDIAAN" style={{ background: C.surface, color: C.text }}>PERSEDIAAN</option>
                  <option value="ATTB" style={{ background: C.surface, color: C.text }}>ATTB (Afkir)</option>
                </select>
              </div>

              <div>
                <label style={{ ...sty.label, marginBottom: 4, display: "block" }}>Estimasi Waktu Penyimpanan di Gudang</label>
                <input
                  style={{ ...sty.input, fontSize: 12 }}
                  value={estimasiPenyimpanan}
                  onChange={e => setEstimasiPenyimpanan(e.target.value)}
                  placeholder="Contoh: 2 Tahun, 7 Bulan, 3 TAHUN..."
                />
              </div>
            </div>

            {/* BAGIAN 3: KONDISI VISUAL & KETERANGAN */}
            <div>
              <label style={{ ...sty.label, marginBottom: 6, display: "block" }}>Kondisi Visual Barang *</label>
              <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(2, 1fr)", gap: 10 }}>
                {KONDISI_OPTIONS.map(opt => (
                  <div
                    key={opt.value}
                    onClick={() => setKondisi(opt.value)}
                    style={{
                      padding: 12,
                      borderRadius: 10,
                      border: `2px solid ${kondisi === opt.value ? opt.color : C.border || "#cbd5e1"}`,
                      background: kondisi === opt.value ? opt.bg : "transparent",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      transition: "all 0.15s"
                    }}
                  >
                    <input type="radio" checked={kondisi === opt.value} onChange={() => setKondisi(opt.value)} />
                    <span style={{ fontSize: 12, fontWeight: 700, color: kondisi === opt.value ? opt.color : C.text || "#0f172a" }}>{opt.label}</span>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <label style={{ ...sty.label, marginBottom: 4, display: "block" }}>Keterangan Visual (Info Tambahan) *</label>
              <input
                style={{ ...sty.input, fontSize: 12 }}
                value={keteranganVisual}
                onChange={e => setKeteranganVisual(e.target.value)}
                placeholder="Contoh: PELINDUNG KERAMIK CT SOBEK / PELINDUNG TERPAL MULAI COPOT / BAIK"
              />
            </div>

            <div>
              <label style={{ ...sty.label, marginBottom: 6, display: "block" }}>Status Kelayakan Pakai *</label>
              <select
                style={{ ...sty.input, width: "100%", fontSize: 12, fontWeight: 700, background: C.surface, color: C.text }}
                value={statusKelayakan}
                onChange={e => setStatusKelayakan(e.target.value)}
              >
                {STATUS_KELAYAKAN.map(s => (
                  <option key={s.value} value={s.value} style={{ background: C.surface, color: C.text }}>{s.label}</option>
                ))}
              </select>
            </div>

            {/* Checklist Parameter Inspeksi */}
            <div style={{ background: C.bg || "#f8fafc", padding: 14, borderRadius: 10, border: `1px solid ${C.border || "#e2e8f0"}` }}>
              <label style={{ ...sty.label, marginBottom: 10, display: "block", color: C.text || "#0f172a" }}>Checklist Parameter Inspeksi</label>
              <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(2, 1fr)", gap: 10 }}>
                <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, cursor: "pointer" }}>
                  <input type="checkbox" checked={paramKebersihan} onChange={e => setParamKebersihan(e.target.checked)} />
                  <span>Kebersihan Area & Barang</span>
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, cursor: "pointer" }}>
                  <input type="checkbox" checked={paramBebasKarat} onChange={e => setParamBebasKarat(e.target.checked)} />
                  <span>Bebas Karat / Korosi</span>
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, cursor: "pointer" }}>
                  <input type="checkbox" checked={paramBebasBocor} onChange={e => setParamBebasBocor(e.target.checked)} />
                  <span>Bebas Kebocoran / Kelembaban</span>
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, cursor: "pointer" }}>
                  <input type="checkbox" checked={paramKemasanBaik} onChange={e => setParamKemasanBaik(e.target.checked)} />
                  <span>Kemasan / Packaging Utuh</span>
                </label>
              </div>
            </div>

            {/* Upload 2 Foto Evidence */}
            <div>
              <label style={{ ...sty.label, marginBottom: 8, display: "block", color: C.text || "#0f172a", fontWeight: 800 }}>
                Upload 2 Foto Hasil Inspeksi (Untuk Lampiran Dokumen BA) *
              </label>
              
              <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 14 }}>
                {/* SLOT FOTO 1 */}
                <div style={{
                  border: `2px dashed ${foto1 ? "#10b981" : (C.border || "#cbd5e1")}`,
                  borderRadius: 12,
                  padding: 12,
                  background: foto1 ? "rgba(16, 185, 129, 0.05)" : (C.bg || "#f8fafc"),
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  minHeight: 150
                }}>
                  <div style={{ fontSize: 11, fontWeight: 800, color: C.text || "#0f172a", marginBottom: 8 }}>
                    📷 Foto 1: Kondisi Visual / Fisik Material
                  </div>

                  {foto1 ? (
                    <div style={{ position: "relative", width: "100%", height: 130, borderRadius: 8, overflow: "hidden", border: `1px solid ${C.border || "#cbd5e1"}` }}>
                      <img src={foto1.url} alt="Foto 1" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                      <button
                        type="button"
                        onClick={() => setFoto1(null)}
                        style={{
                          position: "absolute",
                          top: 4,
                          right: 4,
                          background: "rgba(239, 68, 68, 0.9)",
                          color: "white",
                          border: "none",
                          borderRadius: "50%",
                          width: 22,
                          height: 22,
                          cursor: "pointer",
                          fontSize: 12,
                          fontWeight: 800,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center"
                        }}
                      >✕</button>
                      <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, background: "rgba(0,0,0,0.6)", color: "white", padding: "2px 6px", fontSize: 9, textOverflow: "ellipsis", overflow: "hidden", whiteSpace: "nowrap" }}>
                        {foto1.name}
                      </div>
                    </div>
                  ) : (
                    <label style={{ cursor: "pointer", width: "100%", display: "flex", flexDirection: "column", alignItems: "center", padding: "10px 0" }}>
                      <span style={{ fontSize: 26, marginBottom: 4 }}>📷</span>
                      <span style={{ fontSize: 12, fontWeight: 800, color: C.accent || "#2563eb" }}>+ Upload Foto 1</span>
                      <span style={{ fontSize: 10, color: C.muted || "#64748b", marginTop: 2 }}>Pilih file gambar (JPG/PNG)</span>
                      <input type="file" accept="image/*" hidden onChange={(e) => handleSinglePhotoAdd(e, setFoto1)} />
                    </label>
                  )}
                </div>

                {/* SLOT FOTO 2 */}
                <div style={{
                  border: `2px dashed ${foto2 ? "#10b981" : (C.border || "#cbd5e1")}`,
                  borderRadius: 12,
                  padding: 12,
                  background: foto2 ? "rgba(16, 185, 129, 0.05)" : (C.bg || "#f8fafc"),
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  minHeight: 150
                }}>
                  <div style={{ fontSize: 11, fontWeight: 800, color: C.text || "#0f172a", marginBottom: 8 }}>
                    📷 Foto 2: Nameplate / Tagging / Packaging
                  </div>

                  {foto2 ? (
                    <div style={{ position: "relative", width: "100%", height: 130, borderRadius: 8, overflow: "hidden", border: `1px solid ${C.border || "#cbd5e1"}` }}>
                      <img src={foto2.url} alt="Foto 2" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                      <button
                        type="button"
                        onClick={() => setFoto2(null)}
                        style={{
                          position: "absolute",
                          top: 4,
                          right: 4,
                          background: "rgba(239, 68, 68, 0.9)",
                          color: "white",
                          border: "none",
                          borderRadius: "50%",
                          width: 22,
                          height: 22,
                          cursor: "pointer",
                          fontSize: 12,
                          fontWeight: 800,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center"
                        }}
                      >✕</button>
                      <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, background: "rgba(0,0,0,0.6)", color: "white", padding: "2px 6px", fontSize: 9, textOverflow: "ellipsis", overflow: "hidden", whiteSpace: "nowrap" }}>
                        {foto2.name}
                      </div>
                    </div>
                  ) : (
                    <label style={{ cursor: "pointer", width: "100%", display: "flex", flexDirection: "column", alignItems: "center", padding: "10px 0" }}>
                      <span style={{ fontSize: 26, marginBottom: 4 }}>📷</span>
                      <span style={{ fontSize: 12, fontWeight: 800, color: C.accent || "#2563eb" }}>+ Upload Foto 2</span>
                      <span style={{ fontSize: 10, color: C.muted || "#64748b", marginTop: 2 }}>Pilih file gambar (JPG/PNG)</span>
                      <input type="file" accept="image/*" hidden onChange={(e) => handleSinglePhotoAdd(e, setFoto2)} />
                    </label>
                  )}
                </div>
              </div>
            </div>

            {/* Catatan Auditor */}
            <div>
              <label style={{ ...sty.label, marginBottom: 6, display: "block" }}>Catatan Tambahan Auditor</label>
              <textarea
                style={{ ...sty.input, minHeight: 70, fontSize: 12 }}
                placeholder="Catatan internal tambahan..."
                value={catatan}
                onChange={e => setCatatan(e.target.value)}
              />
            </div>

            {/* Submit Buttons */}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 10 }}>
              <button style={{ ...sty.btn("primary") }} disabled={saving} onClick={handleSaveInspeksi}>
                {saving ? "Memproses..." : "💾 Simpan & Buat Berita Acara (BA)"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* SUB-TAB 2: RIWAYAT HASIL INSPEKSI */}
      {subTab === "riwayat" && (
        <div style={{ background: C.surface || "#ffffff", border: `1px solid ${C.border || "#e2e8f0"}`, borderRadius: 14, padding: 18, boxShadow: "0 2px 8px rgba(0,0,0,0.04)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, flexWrap: "wrap", gap: 10 }}>
            <h3 style={{ fontSize: 15, fontWeight: 800, color: C.text || "#0f172a", margin: 0 }}>Riwayat Hasil Inspeksi Material Cadang</h3>
            {materialInspections.length > 0 && (
              <button
                style={{ ...sty.btn("primary", "sm"), background: "#10b981", borderColor: "#059669" }}
                onClick={() => openBaModal(materialInspections)}
              >
                📄 Cetak Berita Acara Seluruh Hasil ({materialInspections.length} Item)
              </button>
            )}
          </div>
          
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: C.bg || "#f8fafc", color: C.text || "#0f172a", borderBottom: `2px solid ${C.border || "#e2e8f0"}`, textAlign: "left" }}>
                  <th style={{ padding: "10px 12px" }}>Tanggal</th>
                  <th style={{ padding: "10px 12px" }}>Jenis MTU</th>
                  <th style={{ padding: "10px 12px" }}>No Katalog</th>
                  <th style={{ padding: "10px 12px" }}>Material Description</th>
                  <th style={{ padding: "10px 12px" }}>Qty</th>
                  <th style={{ padding: "10px 12px" }}>Estimasi Penyimpanan</th>
                  <th style={{ padding: "10px 12px" }}>Kondisi Visual</th>
                  <th style={{ padding: "10px 12px" }}>Keterangan</th>
                  <th style={{ padding: "10px 12px" }}>Foto</th>
                  <th style={{ padding: "10px 12px" }}>Aksi</th>
                </tr>
              </thead>
              <tbody>
                {(materialInspections || []).map(insp => {
                  const kondMeta = KONDISI_OPTIONS.find(k => k.value === insp.kondisi);

                  return (
                    <tr key={insp.id} style={{ borderBottom: `1px solid ${C.border || "#f1f5f9"}` }}>
                      <td style={{ padding: "10px 12px" }}>{fmtDate(insp.createdAt)}</td>
                      <td style={{ padding: "10px 12px", fontWeight: 700, color: C.accent || "#2563eb" }}>{insp.jenisMtu || "CT"}</td>
                      <td style={{ padding: "10px 12px", fontWeight: 700 }}>{insp.noKatalog}</td>
                      <td style={{ padding: "10px 12px", fontWeight: 700, color: C.text || "#0f172a" }}>{insp.namaBarang}</td>
                      <td style={{ padding: "10px 12px" }}>{insp.qtyStok} {insp.satuan}</td>
                      <td style={{ padding: "10px 12px" }}>{insp.estimasiPenyimpanan || "-"}</td>
                      <td style={{ padding: "10px 12px" }}>
                        {kondMeta ? (
                          <span style={{ fontSize: 10, fontWeight: 800, color: kondMeta.color, background: kondMeta.bg, padding: "2px 8px", borderRadius: 6 }}>
                            {kondMeta.label}
                          </span>
                        ) : insp.kondisi}
                      </td>
                      <td style={{ padding: "10px 12px", fontSize: 11 }}>{insp.keteranganVisual || "BAIK"}</td>
                      <td style={{ padding: "10px 12px" }}>
                        {(insp.fotos || []).length > 0 ? (
                          <span style={{ fontSize: 11, fontWeight: 700, color: C.accent || "#2563eb" }}>📷 {insp.fotos.length} foto</span>
                        ) : "-"}
                      </td>
                      <td style={{ padding: "10px 12px" }}>
                        <button
                          style={{ ...sty.btn("ghost", "sm"), padding: "4px 8px", fontSize: 11 }}
                          onClick={() => openBaModal([insp])}
                        >
                          🖨️ BA Item Ini
                        </button>
                      </td>
                    </tr>
                  );
                })}

                {(!materialInspections || materialInspections.length === 0) && (
                  <tr>
                    <td colSpan="10" style={{ textAlign: "center", padding: 30, color: C.muted || "#64748b" }}>
                      Belum ada riwayat inspeksi material cadang.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* MODAL & PREVIEW CETAK BERITA ACARA (BA) */}
      {printModal && baData && (
        <div className="no-print" style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(15, 23, 42, 0.75)", backdropFilter: "blur(4px)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div style={{ background: C.surface || "#ffffff", color: C.text || "#0f172a", width: "100%", maxWidth: 900, maxHeight: "90vh", borderRadius: 16, display: "flex", flexDirection: "column", overflow: "hidden", boxShadow: "0 25px 50px -12px rgba(0,0,0,0.3)" }}>
            
            {/* Modal Control Header */}
            <div style={{ padding: "14px 20px", background: "#0f172a", color: "white", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 18 }}>📄</span>
                <div>
                  <strong style={{ fontSize: 14, display: "block" }}>Preview Berita Acara Visual Inspeksi MTU</strong>
                  <span style={{ fontSize: 11, color: "#94a3b8" }}>Formulir Berita Acara Inspeksi Fisik Material Persediaan, Cadang, dan ATTB</span>
                </div>
              </div>
              <div style={{ display: "flex", gap: 10 }}>
                <button
                  style={{ ...sty.btn("primary", "sm"), background: "#10b981", borderColor: "#059669", fontWeight: 800, padding: "6px 16px" }}
                  onClick={handleTriggerPrint}
                >
                  🖨️ Cetak / Download PDF
                </button>
                <button
                  style={{ ...sty.btn("ghost", "sm"), color: "#94a3b8" }}
                  onClick={() => setPrintModal(false)}
                >
                  ✕ Tutup
                </button>
              </div>
            </div>

            {/* Modal Body: Form Edit Header BA & Live Document Preview */}
            <div style={{ flex: 1, overflowY: "auto", padding: 20, background: C.bg || "#f8fafc" }}>
              
              {/* Form Input Header BA */}
              <div style={{ background: C.surface || "#ffffff", borderRadius: 12, padding: 16, marginBottom: 20, border: `1px solid ${C.border || "#e2e8f0"}` }}>
                <h4 style={{ fontSize: 12, fontWeight: 800, color: C.accent || "#1e3a8a", margin: "0 0 12px 0", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                  ⚙️ Pengaturan Header & Penandatangan Berita Acara
                </h4>
                <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(3, 1fr)", gap: 10 }}>
                  <div>
                    <label style={{ fontSize: 10, fontWeight: 700, color: C.muted || "#64748b", display: "block", marginBottom: 2 }}>No. Dokumen BA</label>
                    <input style={{ ...sty.input, fontSize: 11, padding: "4px 8px" }} value={baNoDokumen} onChange={e => setBaNoDokumen(e.target.value)} />
                  </div>
                  <div>
                    <label style={{ fontSize: 10, fontWeight: 700, color: C.muted || "#64748b", display: "block", marginBottom: 2 }}>Nama Gudang</label>
                    <input style={{ ...sty.input, fontSize: 11, padding: "4px 8px" }} value={baNamaGudang} onChange={e => setBaNamaGudang(e.target.value)} />
                  </div>
                  <div>
                    <label style={{ fontSize: 10, fontWeight: 700, color: C.muted || "#64748b", display: "block", marginBottom: 2 }}>No SLoc</label>
                    <input style={{ ...sty.input, fontSize: 11, padding: "4px 8px" }} value={baNoSloc} onChange={e => setBaNoSloc(e.target.value)} />
                  </div>
                  <div>
                    <label style={{ fontSize: 10, fontWeight: 700, color: C.muted || "#64748b", display: "block", marginBottom: 2 }}>Nama UPT</label>
                    <input style={{ ...sty.input, fontSize: 11, padding: "4px 8px" }} value={baNamaUpt} onChange={e => setBaNamaUpt(e.target.value)} />
                  </div>
                  <div>
                    <label style={{ fontSize: 10, fontWeight: 700, color: C.muted || "#64748b", display: "block", marginBottom: 2 }}>Pelaksana (Logistik)</label>
                    <input style={{ ...sty.input, fontSize: 11, padding: "4px 8px" }} value={baPelaksanaLogistik} onChange={e => setBaPelaksanaLogistik(e.target.value)} />
                  </div>
                  <div>
                    <label style={{ fontSize: 10, fontWeight: 700, color: C.muted || "#64748b", display: "block", marginBottom: 2 }}>Pelaksana (Pemeliharaan)</label>
                    <input style={{ ...sty.input, fontSize: 11, padding: "4px 8px" }} value={baPelaksanaPemeliharaan} onChange={e => setBaPelaksanaPemeliharaan(e.target.value)} />
                  </div>
                  <div>
                    <label style={{ fontSize: 10, fontWeight: 700, color: C.muted || "#64748b", display: "block", marginBottom: 2 }}>Manager UPT</label>
                    <input style={{ ...sty.input, fontSize: 11, padding: "4px 8px" }} value={baManagerUpt} onChange={e => setBaManagerUpt(e.target.value)} />
                  </div>
                </div>
              </div>

              {/* DOKUMEN CETAK BERITA ACARA (Sesuai Format Gambar Sample User) */}
              <div className="ba-print-container" style={{ background: "white", padding: 30, borderRadius: 8, boxShadow: "0 4px 12px rgba(0,0,0,0.08)", color: "#000000", fontFamily: "'Times New Roman', Times, serif" }}>
                
                {/* HALAMAN 1: BERITA ACARA VISUAL INSPEKSI MTU DI GUDANG */}
                <div>
                  <div style={{ textAlign: "center", marginBottom: 20 }}>
                    <h2 style={{ fontSize: 16, fontWeight: "bold", textDecoration: "underline", margin: 0, textTransform: "uppercase", letterSpacing: "0.5px" }}>
                      BERITA ACARA VISUAL INSPEKSI MTU DI GUDANG
                    </h2>
                    <div style={{ fontSize: 12, fontStyle: "italic", marginTop: 2 }}>
                      {baNoDokumen}
                    </div>
                  </div>

                  <table style={{ fontSize: 12, border: "none", marginBottom: 16, width: "100%", maxWidth: 450, borderCollapse: "collapse" }}>
                    <tbody>
                      <tr>
                        <td style={{ width: 120, padding: "2px 0" }}>Tanggal</td>
                        <td style={{ width: 15 }}>:</td>
                        <td style={{ fontWeight: "bold" }}>{baTanggal}</td>
                      </tr>
                      <tr>
                        <td style={{ padding: "2px 0" }}>Nama Gudang</td>
                        <td>:</td>
                        <td style={{ fontWeight: "bold" }}>{baNamaGudang}</td>
                      </tr>
                      <tr>
                        <td style={{ padding: "2px 0" }}>No SLoc</td>
                        <td>:</td>
                        <td style={{ fontWeight: "bold" }}>{baNoSloc}</td>
                      </tr>
                      <tr>
                        <td style={{ padding: "2px 0" }}>Nama UPT</td>
                        <td>:</td>
                        <td style={{ fontWeight: "bold" }}>{baNamaUpt}</td>
                      </tr>
                    </tbody>
                  </table>

                  <p style={{ fontSize: 11, lineHeight: 1.5, textAlign: "justify", marginBottom: 14 }}>
                    Bahwa sesuai tanggal dan lokasi gudang tersebut diatas, telah dilaksanakan Pemeriksaan Kondisi Visual terhadap MTU yang berada di Gudang oleh Bidang Logistik dan Pemeliharaan, Sebagai Berikut:
                  </p>

                  {/* TABEL HASIL INSPEKSI MTU */}
                  <table style={{ width: "100%", fontSize: 11, borderCollapse: "collapse", border: "1.5px solid #000000", marginBottom: 20 }}>
                    <thead>
                      <tr style={{ textAlign: "center", background: "#f1f5f9" }}>
                        <th style={{ border: "1px solid #000000", padding: 6, width: "10%" }}>Jenis MTU</th>
                        <th style={{ border: "1px solid #000000", padding: 6, width: "12%" }}>Nomor Katalog Material</th>
                        <th style={{ border: "1px solid #000000", padding: 6, width: "22%" }}>Material Description</th>
                        <th style={{ border: "1px solid #000000", padding: 6, width: "8%" }}>Base Unit Of Measure</th>
                        <th style={{ border: "1px solid #000000", padding: 6, width: "7%" }}>Quantity</th>
                        <th style={{ border: "1px solid #000000", padding: 6, width: "10%" }}>Jenis Peruntukan</th>
                        <th style={{ border: "1px solid #000000", padding: 6, width: "13%" }}>Estimasi Bulan & Tahun Awal Penyimpanan di Gudang</th>
                        <th style={{ border: "1px solid #000000", padding: 6, width: "8%" }}>Kondisi Visual</th>
                        <th style={{ border: "1px solid #000000", padding: 6, width: "10%" }}>Keterangan (jika terdapat info tambahan)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {baData.items.map((item, idx) => (
                        <tr key={idx} style={{ textAlign: "center" }}>
                          <td style={{ border: "1px solid #000000", padding: 6, fontWeight: "bold" }}>{item.jenisMtu || "CT"}</td>
                          <td style={{ border: "1px solid #000000", padding: 6 }}>{item.noKatalog}</td>
                          <td style={{ border: "1px solid #000000", padding: 6, textAlign: "left" }}>{item.namaBarang}</td>
                          <td style={{ border: "1px solid #000000", padding: 6 }}>{item.satuan || "BH"}</td>
                          <td style={{ border: "1px solid #000000", padding: 6, fontWeight: "bold" }}>{item.qtyStok}</td>
                          <td style={{ border: "1px solid #000000", padding: 6 }}>{item.jenisPeruntukan || "SPARE"}</td>
                          <td style={{ border: "1px solid #000000", padding: 6 }}>{item.estimasiPenyimpanan || "2 Tahun"}</td>
                          <td style={{ border: "1px solid #000000", padding: 6, fontWeight: "bold" }}>{item.kondisi}</td>
                          <td style={{ border: "1px solid #000000", padding: 6, textAlign: "left", fontSize: 10 }}>{item.keteranganVisual || "BAIK"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  <p style={{ fontSize: 11, marginBottom: 30 }}>
                    Demikian Berita Acara ini kami buat, agar dapat dipergunakan sebagaimana mestinya
                  </p>

                  {/* PENANDATANGAN 3 PIHAK */}
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, textAlign: "center", fontSize: 11, marginBottom: 40 }}>
                    <div>
                      <div style={{ fontWeight: "bold" }}>Pelaksana</div>
                      <div style={{ fontSize: 10, color: "#334155" }}>(Bidang Logistik)</div>
                      <div style={{ height: 60 }} />
                      <div style={{ fontWeight: "bold", textDecoration: "underline" }}>{baPelaksanaLogistik}</div>
                    </div>

                    <div>
                      <div style={{ fontWeight: "bold" }}>Pelaksana</div>
                      <div style={{ fontSize: 10, color: "#334155" }}>(Bidang Pemeliharaan)</div>
                      <div style={{ height: 60 }} />
                      <div style={{ fontWeight: "bold", textDecoration: "underline" }}>{baPelaksanaPemeliharaan}</div>
                    </div>
                  </div>

                  <div style={{ textAlign: "center", fontSize: 11 }}>
                    <div style={{ fontWeight: "bold" }}>Mengetahui</div>
                    <div style={{ fontWeight: "bold" }}>MANAGER UPT</div>
                    <div style={{ height: 60 }} />
                    <div style={{ fontWeight: "bold", textDecoration: "underline" }}>{baManagerUpt}</div>
                  </div>
                </div>

                {/* HALAMAN 2: LAMPIRAN DOKUMENTASI FOTO (Grid 3 Kolom) */}
                {baData.allFotos && baData.allFotos.length > 0 && (
                  <div className="page-break" style={{ marginTop: 40, paddingTop: 20 }}>
                    {/* Header Dokumen Lampiran */}
                    <table style={{ width: "100%", fontSize: 10, borderCollapse: "collapse", border: "1.5px solid #000000", marginBottom: 14 }}>
                      <tbody>
                        <tr>
                          <td rowSpan={2} style={{ border: "1px solid #000000", padding: 6, fontWeight: "bold", textAlign: "center", fontSize: 11, width: "60%" }}>
                            FORMULIR BERITA ACARA INSPEKSI FISIK MATERIAL PERSEDIAAN, CADANG, DAN ATTB
                          </td>
                          <td style={{ border: "1px solid #000000", padding: 4, width: "15%", fontWeight: "bold" }}>No. Dokumen</td>
                          <td style={{ border: "1px solid #000000", padding: 4, width: "25%" }}>{baNoDokumen}</td>
                        </tr>
                        <tr>
                          <td style={{ border: "1px solid #000000", padding: 4, fontWeight: "bold" }}>Tanggal</td>
                          <td style={{ border: "1px solid #000000", padding: 4 }}>{baTanggal}</td>
                        </tr>
                      </tbody>
                    </table>

                    <h3 style={{ fontSize: 13, fontWeight: "bold", textAlign: "center", margin: "14px 0", textTransform: "uppercase" }}>
                      LAMPIRAN DOKUMENTASI
                    </h3>

                    {/* Grid Foto 3 Kolom */}
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, border: "1.5px solid #000000", padding: 10 }}>
                      {baData.allFotos.map((foto, idx) => (
                        <div key={idx} style={{ border: "1px solid #cbd5e1", borderRadius: 4, overflow: "hidden", background: "#f8fafc", padding: 4 }}>
                          <img src={foto.url} alt={`Dokumentasi ${idx + 1}`} style={{ width: "100%", height: 180, objectFit: "cover", display: "block" }} />
                          <div style={{ fontSize: 9, textAlign: "center", marginTop: 4, color: "#334155", fontWeight: "bold" }}>
                            Foto #{idx + 1} ({foto.name})
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
