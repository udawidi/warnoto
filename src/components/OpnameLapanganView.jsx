// Layar hitung lapangan (Fase 2d Stock Opname) — satu tangan, HP/tablet: pilih blok -> scan/tap
// item -> ketik qty -> simpan & lanjut. Overlay di atas StockOpnameTab (dipanggil dari tombol
// "Mulai/Lanjut Hitung"), TIDAK menggantikan tabel desktop yang sudah ada.
import { useState } from "react";
import { BarcodeScanner } from "./BarcodeScanner.jsx";
import { useHardwareScanner } from "../hooks/useHardwareScanner.js";
import { extractKatalogIdFromScan, extractLokasiIdFromScan, normalizeKatalog, blokKeyOf, getItemBlocks } from "../lib/sap.js";

export function OpnameLapanganView({ activeOpname, setQtyForBlok, confirmRecount, lokasiList, gudangList,
  currentUser, sty, C, showToast, onClose, onOpenTambahMaterial, onSimpanDraft }) {
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
  const blockList = [...blockMap.values()].sort((a, b) => (a.key === "_TANPA_LOKASI" ? 1 : 0) - (b.key === "_TANPA_LOKASI" ? 1 : 0));
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

  const blokAktif = blockList.find(b => b.key === lokasiAktif);

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
    setLokasiAktif(key); setScanning(false); setScreen("items");
  }

  // Scanner alat (HID) — hanya aktif di layar item/hitung, blockInput menutup bug hasil scan ikut
  // terketik ke kolom qty; onScanStart blur field qty yang lagi fokus SEBELUM karakter scan masuk
  // (uji akseptansi kritis: kursor di kolom qty lalu tembak scanner -> angka TIDAK boleh kotor).
  useHardwareScanner((code) => handleItemScan(code, false), {
    enabled: (screen === "items" || screen === "hitung") && !scanning,
    blockInput: true,
    onScanStart: () => { setReceiving(true); setTimeout(() => setReceiving(false), 400); const el = document.activeElement; if (el && typeof el.blur === "function") el.blur(); },
  });

  function handleSimpanQty(lanjutScan) {
    if (qtyInput === "" || isNaN(Number(qtyInput))) { showToast("Isi qty dulu.", "error"); return; }
    setQtyForBlok(itemAktifIdx, lokasiAktif, qtyInput);
    showToast(`✔ ${items[itemAktifIdx].namaBarang}: ${qtyInput} ${items[itemAktifIdx].satuan}`);
    setItemAktifIdx(null); setQtyInput("");
    setScreen("items");
    if (lanjutScan && viaCamera) { setScanFor("item"); setScanning(true); }
  }

  function handleTandaiNihil(realIdx) {
    setQtyForBlok(realIdx, lokasiAktif, 0);
    showToast(`0 dicatat — "${items[realIdx].namaBarang}" tidak ditemukan di blok ini.`);
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
    <div style={overlayStyle}>
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
          <div style={headerBar}>
            <div>
              <div style={{ fontSize: 17, fontWeight: 800 }}>📱 Mode Lapangan</div>
              <div style={{ fontSize: 12, color: C.muted }}>Pilih blok untuk mulai hitung</div>
            </div>
            <button style={sty.btn("ghost", "sm")} onClick={onClose}>✕ Tutup</button>
          </div>
          <div style={body}>
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
                <div key={b.key} tabIndex={0} onClick={() => { setLokasiAktif(b.key); setScreen("items"); }}
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
          <div style={headerBar}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 17, fontWeight: 800 }}>{blokAktif.gudangKode ? `${blokAktif.gudangKode} — ` : ""}{blokAktif.lokasiKode}</div>
              <div style={{ fontSize: 12, color: C.muted }}>{filled}/{total} terhitung{selisihCount > 0 ? ` • ${selisihCount} selisih` : ""}{receiving ? " • 📡 menerima scan..." : ""}</div>
            </div>
            <button style={sty.btn("ghost", "sm")} onClick={() => setScreen("blok")}>← Ganti Blok</button>
          </div>
          <div style={body}>
            {blokAktif.entries.map(({ item, realIdx }) => {
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
                  <button style={{ ...sty.btn("ghost", "sm"), marginTop: 8 }} onClick={(e) => { e.stopPropagation(); handleTandaiNihil(realIdx); }}>
                    ❌ Tidak ditemukan (0)
                  </button>
                </div>
              );
            })}
          </div>
          <div style={{ position: "sticky", bottom: 0, padding: 14, background: C.bg, borderTop: `1px solid ${C.border}`, display: "flex", gap: 10 }}>
            <button style={{ ...sty.btn("ghost"), flex: 1 }} onClick={onSimpanDraft}>💾 Simpan Draft</button>
            <button style={{ ...sty.btn("primary"), flex: 2 }} onClick={() => { setScanFor("item"); setScanning(true); }}>📷 Scan Barang</button>
          </div>
        </>
      )}

      {/* ── Layar 3: kartu hitung (dari scan langsung atau "catat di blok ini") ─── */}
      {(screen === "hitung" || screen === "hitung-usul") && itemAktifIdx != null && (() => {
        const item = items[itemAktifIdx];
        return (
          <>
            <div style={headerBar}>
              <div style={{ fontSize: 17, fontWeight: 800 }}>Hitung Fisik</div>
              <button style={sty.btn("ghost", "sm")} onClick={() => { setItemAktifIdx(null); setScreen("items"); }}>✕ Batal</button>
            </div>
            <div style={body}>
              <div style={{ ...sty.card, marginBottom: 16 }}>
                <div style={{ fontSize: 17, fontWeight: 800 }}>{item.namaBarang}</div>
                <div style={{ fontSize: 13, color: C.muted, marginTop: 4 }}>No. Katalog: {item.noKatalog} • Satuan: {item.satuan}</div>
                <div style={{ fontSize: 13, color: C.muted }}>Qty Sistem: {item.qtySistem}</div>
                {screen === "hitung-usul" && <div style={{ fontSize: 12, color: "#b45309", fontWeight: 700, marginTop: 6 }}>📍 Dicatat di blok ini (beda dari lokasi aslinya) — ditandai untuk pindah lokasi.</div>}
              </div>
              <label style={sty.label}>Qty Hasil Hitung Fisik</label>
              <input autoFocus type="number" inputMode="decimal" min="0" style={{ ...sty.input, fontSize: 32, fontWeight: 800, textAlign: "center", padding: "18px 12px" }}
                value={qtyInput} onChange={e => setQtyInput(e.target.value)} />
            </div>
            <div style={{ position: "sticky", bottom: 0, padding: 14, background: C.bg, borderTop: `1px solid ${C.border}`, display: "flex", flexDirection: "column", gap: 8 }}>
              <button style={{ ...sty.btn("primary"), minHeight: 48 }} onClick={() => {
                if (qtyInput === "" || isNaN(Number(qtyInput))) { showToast("Isi qty dulu.", "error"); return; }
                if (screen === "hitung-usul") { setQtyForBlok(itemAktifIdx, lokasiAktif, qtyInput, { usulPindahLokasi: true }); showToast(`✔ Dicatat di blok ini — ${item.namaBarang}: ${qtyInput}`); setItemAktifIdx(null); setQtyInput(""); setScreen("items"); }
                else handleSimpanQty(true);
              }}>
                ✔ Simpan &amp; Scan Berikutnya
              </button>
              <button style={sty.btn("ghost")} onClick={() => handleSimpanQty(false)}>✔ Simpan Saja</button>
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
              <div style={headerBar}>
                <div style={{ fontSize: 17, fontWeight: 800 }}>🔁 Hitung Ulang ({recountQueue.length} tersisa)</div>
                <button style={sty.btn("ghost", "sm")} onClick={() => setScreen("blok")}>← Kembali</button>
              </div>
              <div style={body}>
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
              <div style={{ position: "sticky", bottom: 0, padding: 14, background: C.bg, borderTop: `1px solid ${C.border}` }}>
                <button style={{ ...sty.btn("primary"), width: "100%", minHeight: 48 }} onClick={() => {
                  if (recountQty === "" || isNaN(Number(recountQty))) { showToast("Isi qty dulu.", "error"); return; }
                  confirmRecount(realIdx, recountQty);
                  setRecountQty("");
                }}>
                  ✔ Konfirmasi
                </button>
              </div>
            </>
          );
        })()
      )}
    </div>
  );
}
