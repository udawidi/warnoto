// Layar hitung lapangan (Fase 2d Stock Opname) — satu tangan, HP/tablet: pilih blok -> scan/tap
// item -> ketik qty -> simpan & lanjut. Overlay di atas StockOpnameTab (dipanggil dari tombol
// "Mulai/Lanjut Hitung"), TIDAK menggantikan tabel desktop yang sudah ada.
import { useState } from "react";
import { Barcode, FloppyDisk, MapPin, MagnifyingGlass } from "@phosphor-icons/react";
import { BarcodeScanner } from "./BarcodeScanner.jsx";
import { useHardwareScanner } from "../hooks/useHardwareScanner.js";
import { extractKatalogIdFromScan, extractLokasiIdFromScan, normalizeKatalog, blokKeyOf, getItemBlocks } from "../lib/sap.js";

export function OpnameLapanganView({ activeOpname, setQtyForBlok, confirmRecount, lokasiList, gudangList,
  currentUser, sty, C, showToast, onClose, onOpenTambahMaterial, onSimpanDraft, onUploadPhoto }) {
  const items = activeOpname?.items || [];

  // Peta blok -> daftar {item, realIdx} yang dimiliki blok itu.
  const blockMap = new Map();
  items.forEach((item, realIdx) => {
    getItemBlocks(item, lokasiList, gudangList).forEach(b => {
      const key = blokKeyOf(b.lokasiId);
      if (!blockMap.has(key)) blockMap.set(key, { key, lokasiKode: b.lokasiKode || "Tanpa Lokasi", gudangKode: b.gudangKode || null, entries: [] });
      blockMap.get(key).entries.push({ item, realIdx });
    });
  });
  const blockList = [...blockMap.values()].sort((a, b) => {
    const aTanpaLokasi = a.key === "_TANPA_LOKASI";
    const bTanpaLokasi = b.key === "_TANPA_LOKASI";
    if (aTanpaLokasi || bTanpaLokasi) return Number(aTanpaLokasi) - Number(bTanpaLokasi);
    return `${a.gudangKode || ""} ${a.lokasiKode || ""}`.localeCompare(
      `${b.gudangKode || ""} ${b.lokasiKode || ""}`,
      undefined,
      { numeric: true, sensitivity: "base" },
    );
  });
  const recountQueue = items.map((item, realIdx) => ({ item, realIdx })).filter(x => x.item.recount?.perluUlang);

  const [screen, setScreen] = useState("blok"); // blok | items | hitung | recount
  const [lokasiAktif, setLokasiAktif] = useState(null);
  const [itemAktifIdx, setItemAktifIdx] = useState(null);
  const [qtyInput, setQtyInput] = useState("");
  const [scanning, setScanning] = useState(false); // kamera terbuka (blok atau item)
  const [scanFor, setScanFor] = useState(null); // "blok" | "item"
  const [viaCamera, setViaCamera] = useState(false); // scan terakhir dari kamera -> reopen otomatis setelah simpan
  const [receiving, setReceiving] = useState(false); // indikator "menerima scan..." dari scanner alat
  const [notFound, setNotFound] = useState(null); // {code, matchIdx}
  const [recountQty, setRecountQty] = useState("");
  const [saving, setSaving] = useState(false);
  const [photoUploading, setPhotoUploading] = useState(false);
  const [materialQuery, setMaterialQuery] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);

  const blokAktif = blockList.find(b => b.key === lokasiAktif);
  const normalizedQuery = materialQuery.trim().toLowerCase();
  const filteredEntries = blokAktif?.entries.filter(({ item }) => !normalizedQuery || [item.noKatalog, item.namaBarang].some(value => String(value || "").toLowerCase().includes(normalizedQuery))) || [];

  function openHitung(idx, fromCamera) {
    const item = items[idx];
    // Fase B (blind count): entri seeded (belum benar-benar dihitung, at==null) tidak boleh
    // prefill angka buku — cuma prefill kalau memang sudah dihitung nyata sebelumnya.
    const entry = item.hitungPerLokasi?.[lokasiAktif];
    const existing = entry?.at != null ? entry.qty : null;
    setItemAktifIdx(idx);
    setQtyInput(existing != null ? String(existing) : "");
    setViaCamera(!!fromCamera);
    setScanning(false);
    setScreen("hitung");
  }

  function matchItem(code) {
    const scannedKatalogId = extractKatalogIdFromScan(code);
    let idx = scannedKatalogId ? items.findIndex(it => it.katalogId === scannedKatalogId) : -1;
    if (idx < 0) idx = items.findIndex(it => it.noKatalog && normalizeKatalog(it.noKatalog) === normalizeKatalog(code));
    return idx;
  }

  function handleItemScan(code, fromCamera) {
    const idx = matchItem(code);
    if (idx < 0) { setNotFound({ code, matchIdx: -1 }); setScanning(false); return; }
    const item = items[idx];
    const inBlok = getItemBlocks(item, lokasiList, gudangList).some(b => blokKeyOf(b.lokasiId) === lokasiAktif);
    if (!inBlok) { setNotFound({ code, matchIdx: idx }); setScanning(false); return; }
    openHitung(idx, fromCamera);
  }

  function handleBlokScan(code) {
    const lokasiId = extractLokasiIdFromScan(code);
    const key = blokKeyOf(lokasiId);
    if (!blockMap.has(key)) { showToast(`Blok pada QR ini tidak ada di sesi opname ini.`, "error"); setScanning(false); return; }
    setLokasiAktif(key); setMaterialQuery(""); setScanning(false); setScreen("items");
  }

  // Scanner alat (HID) — hanya aktif di layar item (bukan layar "hitung"). Di layar hitung,
  // kolom qty diketik MANUAL; scanner burst-detector + onScanStart(blur) tak bisa membedakan
  // ketikan manusia dari scanner, jadi keystroke pertama mem-blur field -> angka tak bisa
  // diketik di desktop (bug 2026-09). Alur normal: scan item di layar items -> hitung -> simpan
  // -> balik ke items (scanner aktif lagi) -> scan berikutnya. Scan-jump saat qty fokus dilepas.
  useHardwareScanner((code) => handleItemScan(code, false), {
    enabled: screen === "items" && !scanning && !searchFocused,
    blockInput: true,
    onScanStart: () => { setReceiving(true); setTimeout(() => setReceiving(false), 400); const el = document.activeElement; if (el && typeof el.blur === "function") el.blur(); },
  });

  async function handleSimpanQty(lanjutScan) {
    if (saving) return;
    if (qtyInput === "" || isNaN(Number(qtyInput))) { showToast("Isi qty dulu.", "error"); return; }
    if (Number(qtyInput) > 0 && !items[itemAktifIdx]?.fotoKeseluruhan) { showToast("Foto Keseluruhan wajib diunggah untuk qty fisik lebih dari 0.", "error"); return; }
    setSaving(true);
    try {
      const saved = await setQtyForBlok(itemAktifIdx, lokasiAktif, qtyInput);
      if (!saved) return;
      showToast(`✔ Tersimpan ke server · ${items[itemAktifIdx].namaBarang}: ${qtyInput} ${items[itemAktifIdx].satuan}`);
      setItemAktifIdx(null); setQtyInput("");
      setScreen("items");
      if (lanjutScan && viaCamera) { setScanFor("item"); setScanning(true); }
    } finally { setSaving(false); }
  }

  async function handlePhoto(file, field) {
    if (!file || !onUploadPhoto || itemAktifIdx === null) return;
    setPhotoUploading(true);
    try { await onUploadPhoto(itemAktifIdx, field, file); }
    finally { setPhotoUploading(false); }
  }

  function renderPhotoCapture(item) {
    if (!item) return null;
    const required = Number(qtyInput) > 0;
    return <div style={{ marginTop: 14, padding: 12, border: `1px solid ${required && !item.fotoKeseluruhan ? C.red : C.border}`, borderRadius: 10, background: "#fafafa" }}>
      <div style={{ fontSize: 12, fontWeight: 800, marginBottom: 8 }}>Foto Stock Opname {required && <span style={{ color: C.red }}>* wajib</span>}</div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {[["fotoKeseluruhan", "Foto Keseluruhan", true], ["fotoNameplate", "Foto Nameplate", false]].map(([field, label, isRequired]) => <label key={field} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: 8, border: `1px solid ${isRequired && required && !item[field] ? C.red : C.border}`, borderRadius: 8, cursor: photoUploading ? "wait" : "pointer", fontSize: 12, fontWeight: 700 }}>
          {item[field] ? <img src={item[field]} alt={label} style={{ width: 44, height: 44, objectFit: "cover", borderRadius: 6 }} /> : "📷"}
          <span>{item[field] ? "Ganti " : "Ambil "}{label}</span>
          <input type="file" accept="image/*" capture="environment" disabled={photoUploading} style={{ display: "none" }} onChange={e => { const file = e.target.files?.[0]; e.target.value = ""; handlePhoto(file, field); }} />
        </label>)}
      </div>
      {required && !item.fotoKeseluruhan && <div style={{ marginTop: 6, color: C.red, fontSize: 11 }}>Upload minimal 1 Foto Keseluruhan sebelum menyimpan qty.</div>}
    </div>;
  }

  async function handleTandaiNihil(realIdx) {
    if (saving) return;
    setSaving(true);
    try {
      const saved = await setQtyForBlok(realIdx, lokasiAktif, 0);
      if (saved) showToast(`✔ Tersimpan ke server · 0 dicatat untuk "${items[realIdx].namaBarang}".`);
    } finally { setSaving(false); }
  }

  function resolveCatatDiBlokIni() {
    if (!notFound || notFound.matchIdx < 0) return;
    const idx = notFound.matchIdx;
    setNotFound(null);
    setItemAktifIdx(idx);
    setQtyInput("");
    setViaCamera(false);
    setScreen("hitung-usul"); // varian hitung: simpan juga menandai usulPindahLokasi
  }

  // Fase B: "sudah dihitung" = entri punya at!=null (bukan sekadar ada, karena seed awal sudah
  // punya qty=qtySistem dengan at:null — cek presence saja bikin progress lompat 100% instan).
  const filled = blokAktif ? blokAktif.entries.filter(e => e.item.hitungPerLokasi?.[lokasiAktif]?.at != null).length : 0;
  const total = blokAktif ? blokAktif.entries.length : 0;
  const selisihCount = blokAktif ? blokAktif.entries.filter(e => e.item.selisih !== 0).length : 0;

  const overlayStyle = { position: "fixed", inset: 0, background: C.bg, zIndex: 900, display: "flex", flexDirection: "column", overflowY: "auto" };
  const headerBar = { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "14px 16px", borderBottom: `1px solid ${C.border}`, position: "sticky", top: 0, background: C.bg, zIndex: 1 };
  const body = { padding: 16, flex: 1 };

  return (
    <div className="opname-field-mode" style={overlayStyle}>
      {scanning && (
        <BarcodeScanner
          continuous={scanFor === "item"}
          onDetect={(code) => scanFor === "blok" ? handleBlokScan(code) : handleItemScan(code, true)}
          onClose={() => setScanning(false)}
        />
      )}

      {/* ── Layar 1: pilih blok ─────────────────────────────────────────── */}
      {screen === "blok" && (
        <>
          <div className="opname-field-mode__header" style={headerBar}>
            <div>
              <div style={{ fontSize: 17, fontWeight: 800 }}>📱 Mode Lapangan</div>
              <div style={{ fontSize: 12, color: C.muted }}>Pilih blok untuk mulai hitung</div>
            </div>
            <button style={sty.btn("ghost", "sm")} onClick={onClose}>✕ Tutup</button>
          </div>
          <div className="opname-field-mode__body" style={body}>
            {recountQueue.length > 0 && (
              <button style={{ ...sty.btn("primary"), width: "100%", minHeight: 44, marginBottom: 14, background: "#dc2626" }} onClick={() => setScreen("recount")}>
                🔁 Hitung Ulang ({recountQueue.length}) — item selisih wajib dikonfirmasi
              </button>
            )}
            <button style={{ ...sty.btn("primary"), width: "100%", minHeight: 44, marginBottom: 14 }} onClick={() => { setScanFor("blok"); setScanning(true); }}>
              📷 Scan QR Blok
            </button>
            <div style={{ fontSize: 12, fontWeight: 700, color: C.muted, marginBottom: 8 }}>Atau pilih manual:</div>
            {blockList.map(b => {
              const f = b.entries.filter(e => e.item.hitungPerLokasi?.[b.key]?.at != null).length;
              return (
                <div key={b.key} tabIndex={0} onClick={() => { setLokasiAktif(b.key); setMaterialQuery(""); setScreen("items"); }}
                  style={{ ...sty.card, marginBottom: 10, cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <div style={{ fontSize: 15, fontWeight: 700 }}>{b.gudangKode ? `${b.gudangKode} — ` : ""}{b.lokasiKode}</div>
                    <div style={{ fontSize: 12, color: C.muted }}>{f}/{b.entries.length} item terhitung</div>
                  </div>
                  <div style={{ fontSize: 20, fontWeight: 900, color: f === b.entries.length ? C.green : C.accent }}>{f}/{b.entries.length}</div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* ── Layar 2: daftar item di blok aktif ──────────────────────────── */}
      {screen === "items" && blokAktif && (
        <>
          <div className="opname-field-mode__header" style={headerBar}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 17, fontWeight: 800 }}>{blokAktif.gudangKode ? `${blokAktif.gudangKode} — ` : ""}{blokAktif.lokasiKode}</div>
              <div style={{ fontSize: 12, color: C.muted }}>{filled}/{total} terhitung{selisihCount > 0 ? ` • ${selisihCount} selisih` : ""}{receiving ? " • 📡 menerima scan..." : ""}</div>
            </div>
            <button className="opname-field-mode__change-block" style={{ ...sty.btn("ghost", "sm"), display: "inline-flex", alignItems: "center", gap: 6 }} onClick={() => { setMaterialQuery(""); setScreen("blok"); }}><MapPin size={17} weight="bold" aria-hidden="true" />Pilih Blok</button>
          </div>
          <div className="opname-field-mode__body" style={body}>
            <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
              <MagnifyingGlass size={18} weight="bold" aria-hidden="true" />
              <input type="search" value={materialQuery} onChange={e => setMaterialQuery(e.target.value)} onFocus={() => setSearchFocused(true)} onBlur={() => setSearchFocused(false)} placeholder="Cari no katalog atau nama material" aria-label="Cari no katalog atau nama material" style={{ ...sty.input, flex: 1, minHeight: 44, fontSize: 16 }} />
            </label>
            {filteredEntries.map(({ item, realIdx }) => {
              const entryAktif = item.hitungPerLokasi?.[lokasiAktif];
              const done = entryAktif?.at != null;
              const terhitung = done ? entryAktif.qty : null;
              return (
                <div key={realIdx} tabIndex={0} onClick={() => openHitung(realIdx, false)}
                  style={{ ...sty.card, marginBottom: 10, borderLeft: `4px solid ${done ? (item.selisih !== 0 ? "#f59e0b" : C.green) : C.border}`, cursor: "pointer" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontSize: 15, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.namaBarang}</div>
                      <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>No. Katalog: {item.noKatalog} • Satuan: {item.satuan}</div>
                      <div style={{ fontSize: 12, color: C.muted }}>Qty Sistem: {item.qtySistem}</div>
                    </div>
                    <div style={{ textAlign: "right", flexShrink: 0 }}>
                      {done ? <div style={{ fontSize: 20, fontWeight: 900, color: item.selisih !== 0 ? "#f59e0b" : C.green }}>{terhitung}</div> : <div style={{ fontSize: 12, color: C.muted, fontWeight: 700 }}>Belum</div>}
                    </div>
                  </div>
                  <div className="opname-field-mode__zero-action">
                    <button disabled={saving} style={{ ...sty.btn("ghost", "sm"), opacity: saving ? 0.65 : 1 }} onClick={(e) => { e.stopPropagation(); handleTandaiNihil(realIdx); }}>
                      Catat 0 di Blok Ini
                    </button>
                    <span>Material tidak ditemukan secara fisik di blok aktif.</span>
                  </div>
                </div>
              );
            })}
            {filteredEntries.length === 0 && <div style={{ padding: 16, color: C.muted, textAlign: "center" }}>Material tidak ditemukan di blok ini.</div>}
          </div>
          <div className="opname-field-mode__actions" style={{ position: "sticky", bottom: 0, padding: 14, background: C.bg, borderTop: `1px solid ${C.border}`, display: "flex", gap: 10 }}>
            <button disabled={saving} className="opname-field-mode__draft" style={{ ...sty.btn("ghost"), flex: 1, opacity: saving ? 0.65 : 1 }} onClick={onSimpanDraft}><FloppyDisk size={17} weight="bold" aria-hidden="true" />{saving ? "Menyimpan..." : "Draft"}</button>
            <button disabled={saving} className="opname-field-mode__scan" style={{ ...sty.btn("primary"), flex: 2, opacity: saving ? 0.65 : 1 }} onClick={() => { setScanFor("item"); setScanning(true); }}><Barcode size={17} weight="bold" aria-hidden="true" />Scan</button>
          </div>
        </>
      )}

      {/* ── Layar 3: kartu hitung (dari scan langsung atau "catat di blok ini") ─── */}
      {(screen === "hitung" || screen === "hitung-usul") && itemAktifIdx != null && (() => {
        const item = items[itemAktifIdx];
        return (
          <>
            <div className="opname-field-mode__header" style={headerBar}>
              <div style={{ fontSize: 17, fontWeight: 800 }}>Hitung Fisik</div>
              <button style={sty.btn("ghost", "sm")} onClick={() => { setItemAktifIdx(null); setScreen("items"); }}>✕ Batal</button>
            </div>
            <div className="opname-field-mode__body" style={body}>
              <div style={{ ...sty.card, marginBottom: 16 }}>
                <div style={{ fontSize: 17, fontWeight: 800 }}>{item.namaBarang}</div>
                <div style={{ fontSize: 13, color: C.muted, marginTop: 4 }}>No. Katalog: {item.noKatalog} • Satuan: {item.satuan}</div>
                <div style={{ fontSize: 13, color: C.muted }}>Qty Sistem: {item.qtySistem}</div>
                {screen === "hitung-usul" && <div style={{ fontSize: 12, color: "#b45309", fontWeight: 700, marginTop: 6 }}>📍 Dicatat di blok ini (beda dari lokasi aslinya) — ditandai untuk pindah lokasi.</div>}
              </div>
        {renderPhotoCapture(item)}
        <label style={sty.label}>Qty Hasil Hitung Fisik</label>
              <input autoFocus type="number" inputMode="decimal" min="0" style={{ ...sty.input, fontSize: 32, fontWeight: 800, textAlign: "center", padding: "18px 12px" }}
                value={qtyInput} onChange={e => setQtyInput(e.target.value)} />
            </div>
            <div className="opname-field-mode__actions" style={{ position: "sticky", bottom: 0, padding: 14, background: C.bg, borderTop: `1px solid ${C.border}`, display: "flex", flexDirection: "column", gap: 8 }}>
              <button disabled={saving} style={{ ...sty.btn("primary"), minHeight: 48, opacity: saving ? 0.65 : 1 }} onClick={async () => {
                if (qtyInput === "" || isNaN(Number(qtyInput))) { showToast("Isi qty dulu.", "error"); return; }
                if (Number(qtyInput) > 0 && !item.fotoKeseluruhan) { showToast("Foto Keseluruhan wajib diunggah untuk qty fisik lebih dari 0.", "error"); return; }
                if (screen === "hitung-usul") { if (saving) return; setSaving(true); try { const saved = await setQtyForBlok(itemAktifIdx, lokasiAktif, qtyInput, { usulPindahLokasi: true }); if (!saved) return; showToast(`✔ Tersimpan ke server · ${item.namaBarang}: ${qtyInput}`); setItemAktifIdx(null); setQtyInput(""); setScreen("items"); } finally { setSaving(false); } }
                else handleSimpanQty(true);
              }}>
                {saving ? "Menyimpan ke server..." : "✔ Simpan & Scan Berikutnya"}
              </button>
              <button disabled={saving} style={{ ...sty.btn("ghost"), opacity: saving ? 0.65 : 1 }} onClick={() => handleSimpanQty(false)}>{saving ? "Menyimpan ke server..." : "✔ Simpan Saja"}</button>
            </div>
          </>
        );
      })()}

      {/* ── Dialog: barang tak ada di daftar blok ini ───────────────────── */}
      {notFound && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 950, padding: 12 }}>
          <div style={{ ...sty.card, width: 380, maxWidth: "100%" }}>
            <h3 style={{ fontSize: 15, fontWeight: 800, marginBottom: 10 }}>⚠️ Barang Tidak Ditemukan</h3>
            <p style={{ fontSize: 13, color: C.muted, marginBottom: 16 }}>
              {notFound.matchIdx >= 0
                ? `"${items[notFound.matchIdx].namaBarang}" ada di sesi ini tapi bukan di blok yang sedang dihitung.`
                : `Kode "${notFound.code}" tidak ditemukan di sesi opname ini.`}
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {notFound.matchIdx >= 0 && <button style={sty.btn("primary")} onClick={resolveCatatDiBlokIni}>📍 Catat di Blok Ini</button>}
              <button style={sty.btn("ghost")} onClick={() => { setNotFound(null); onOpenTambahMaterial(); }}>➕ Tambah Material Ditemukan</button>
              <button style={sty.btn("ghost")} onClick={() => setNotFound(null)}>✕ Batal</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Layar 4: antrian hitung ulang (Fase 2e) ─────────────────────── */}
      {screen === "recount" && (
        recountQueue.length === 0 ? (
          <>
            <div style={headerBar}>
              <div style={{ fontSize: 17, fontWeight: 800 }}>🔁 Hitung Ulang</div>
              <button style={sty.btn("ghost", "sm")} onClick={() => setScreen("blok")}>← Kembali</button>
            </div>
            <div style={body}><div style={{ ...sty.card, textAlign: "center", color: C.green, fontWeight: 700 }}>✅ Semua item selisih sudah dikonfirmasi.</div></div>
          </>
        ) : (() => {
          const { item, realIdx } = recountQueue[0];
          return (
            <>
              <div className="opname-field-mode__header" style={headerBar}>
                <div style={{ fontSize: 17, fontWeight: 800 }}>🔁 Hitung Ulang ({recountQueue.length} tersisa)</div>
                <button style={sty.btn("ghost", "sm")} onClick={() => setScreen("blok")}>← Kembali</button>
              </div>
              <div className="opname-field-mode__body" style={body}>
                <div style={{ ...sty.card, marginBottom: 16 }}>
                  <div style={{ fontSize: 17, fontWeight: 800 }}>{item.namaBarang}</div>
                  <div style={{ fontSize: 13, color: C.muted, marginTop: 4 }}>No. Katalog: {item.noKatalog} • Satuan: {item.satuan}</div>
                  <div style={{ fontSize: 13, color: C.muted }}>Qty Sistem: {item.qtySistem}</div>
                  <div style={{ fontSize: 12, color: "#b45309", fontWeight: 700, marginTop: 8 }}>Hitung ulang TANPA melihat angka hitung pertama — kalau beda, angka kedua ini yang dipakai.</div>
                </div>
                <label style={sty.label}>Qty Hasil Hitung Ulang</label>
                <input autoFocus type="number" inputMode="decimal" min="0" style={{ ...sty.input, fontSize: 32, fontWeight: 800, textAlign: "center", padding: "18px 12px" }}
                  value={recountQty} onChange={e => setRecountQty(e.target.value)} />
              </div>
              <div className="opname-field-mode__actions" style={{ position: "sticky", bottom: 0, padding: 14, background: C.bg, borderTop: `1px solid ${C.border}` }}>
                <button disabled={saving} style={{ ...sty.btn("primary"), width: "100%", minHeight: 48, opacity: saving ? 0.65 : 1 }} onClick={async () => {
                  if (saving) return;
                  if (recountQty === "" || isNaN(Number(recountQty))) { showToast("Isi qty dulu.", "error"); return; }
                  setSaving(true);
                  try {
                    const saved = await confirmRecount(realIdx, recountQty);
                    if (saved) { setRecountQty(""); showToast("✔ Hasil hitung ulang tersimpan ke server."); }
                  } finally { setSaving(false); }
                }}>
                  {saving ? "Menyimpan ke server..." : "✔ Konfirmasi"}
                </button>
              </div>
            </>
          );
        })()
      )}
    </div>
  );
}
