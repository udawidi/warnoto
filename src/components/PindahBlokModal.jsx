// Modal "Pindah Blok" — dipisah dari kolom Gudang/Blok tabel Data Stok (batch 1
// simplifikasi tampilan). Logic ADMIN/TL & semantik approval TL lintas-gudang
// dipindah VERBATIM dari DataStokTab (kolom Gudang/Blok lama), tidak diubah.
import { buildAdminStockLocationUpdate } from "../lib/stockLocationApproval.js";
import { hasRole } from "../lib/roles.js";
import { sortBlokOptions } from "../lib/masterSync.js";

export function PindahBlokModal({
  C, sty, currentUser, st, lok, gdg,
  stocks, setStocks, lokasiList, visibleGudangList,
  stockGudangFilter, setStockGudangFilter,
  saveToCloud, showToast, onClose,
}) {
  const noLokasi = !st.lokasiId;
  const effGudangIdForBlok = stockGudangFilter[st.id] ?? st.gudangId ?? gdg?.id ?? "";
  const blokOptionsForStock = sortBlokOptions(lokasiList.filter(l => l.gudangId === effGudangIdForBlok));

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1600, padding: 20 }} onClick={onClose}>
      <div style={{ ...sty.card, width: 420, maxWidth: "100%" }} onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 }}>
          <div>
            <h3 style={{ fontSize: 15, fontWeight: 800 }}>Pindah Blok</h3>
            <p style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>{st.name}</p>
          </div>
          <button aria-label="Tutup pindah blok" style={{ ...sty.btn("danger","sm"), minWidth: 44, minHeight: 44 }} onClick={onClose}>Tutup</button>
        </div>

        <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>Gudang</div>
        {hasRole(currentUser, "ADMIN", "TL") ? (
          <select
            value={stockGudangFilter[st.id] ?? st.gudangId ?? gdg?.id ?? ""}
            style={{ ...sty.select, fontSize: 12 }}
            onChange={e => {
              const v = e.target.value;
              setStockGudangFilter(prev => ({ ...prev, [st.id]: v }));
            }}>
            <option value="">-- Pilih Gudang --</option>
            {visibleGudangList.filter(g => !st.uptId || g.uptId === st.uptId).map(g => <option key={g.id} value={g.id}>{g.kode || g.nama}</option>)}
          </select>
        ) : (
          <div style={{ fontSize: 12, color: C.text }}>{gdg?.kode || gdg?.nama || "—"}</div>
        )}

        <div style={{ fontSize: 12, fontWeight: 700, margin: "12px 0 6px" }}>Blok</div>
        {hasRole(currentUser, "ADMIN") ? (
          <>
            <select
              value={st.lokasiId || ""}
              style={{ ...sty.select, fontSize: 12, border: `1px solid ${noLokasi ? "#f59e0b" : C.border}`, background: noLokasi ? "#fffbeb" : "#f9fafb" }}
              onChange={async e => {
                const newLokasiId = e.target.value;
                const lokSel = lokasiList.find(l => l.id === newLokasiId);
                const sourceLocation = lokasiList.find(l => l.id === st.lokasiId) || (st.lokasiId ? { gudangId: st.gudangId } : null);
                const updated = buildAdminStockLocationUpdate(st, sourceLocation, lokSel, currentUser.id);
                const ns = stocks.map(s => s.id === st.id ? updated : s);
                setStocks(ns);
                // Update lokasi/blok 1 barang — cuma baris ini yang berubah (sync ringan, bukan 212 baris ~18.7MB).
                await saveToCloud({ stocks: ns }, { stocksChangedRows: [updated] });
                showToast(`📍 Lokasi ${st.name} → ${lokSel?.kode || "-"} disimpan.`);
                onClose();
              }}>
              <option value="">-- Pilih Blok --</option>
              {blokOptionsForStock.map(l => <option key={l.id} value={l.id}>{l.kode}{l.nama ? " — " + l.nama : ""}</option>)}
            </select>
            {effGudangIdForBlok && blokOptionsForStock.length === 0 && <div style={{ fontSize: 12, color: "#b45309", fontStyle: "italic", marginTop: 2 }}>⚠️ Belum ada Blok terdaftar di Gudang ini — pilihan Gudang tetap tersimpan.</div>}
          </>
        ) : hasRole(currentUser, "TL") ? (
          <>
            <select
              value={st.lokasiId || ""}
              disabled={st.lokasiMovePending}
              style={{ ...sty.select, fontSize: 12, border: `1px solid ${noLokasi ? "#f59e0b" : C.border}`, background: st.lokasiMovePending ? "#f3f4f6" : noLokasi ? "#fffbeb" : "#f9fafb" }}
              onChange={async e => {
                const newLokasiId = e.target.value;
                const lokSel = lokasiList.find(l => l.id === newLokasiId);
                // TL yang pindahkan stok yang SUDAH punya lokasi ke Gudang lain wajib
                // approval Asman (TL sendiri yang biasanya approve pemindahan Admin,
                // jadi pemindahan lintas Gudang oleh TL butuh persetujuan Asman UPT).
                // Isi lokasi PERTAMA KALI (lok kosong) tetap langsung tanpa approval,
                // sama seperti pindah blok dalam Gudang yang sama.
                const pindahGudang = !!lok && (lokSel?.gudangId || null) !== (lok?.gudangId || null);
                let updated, msg;
                if (pindahGudang) {
                  updated = { ...st, lokasiMovePending: true, lokasiMoveApprover: "ASMAN", pendingLokasiId: newLokasiId, pendingLokasiKode: lokSel?.kode || "-", moveRequestedBy: currentUser.id, moveRequestedAt: Date.now() };
                  msg = `📨 Pemindahan ${st.name} ke Gudang lain (${lokSel?.kode || "-"}) diajukan! Menunggu approval Asman.`;
                } else {
                  updated = { ...st, lokasiId: newLokasiId, lokasi: lokSel?.kode || "-", lokasiMovePending: false, lokasiMoveApprover: null, pendingLokasiId: null, pendingLokasiKode: null };
                  msg = `📍 Blok ${st.name} → ${lokSel?.kode || "-"}`;
                }
                const ns = stocks.map(s => s.id === st.id ? updated : s);
                setStocks(ns);
                // Update lokasi/blok 1 barang — cuma baris ini yang berubah (sync ringan, bukan 212 baris ~18.7MB).
                await saveToCloud({ stocks: ns }, { stocksChangedRows: [updated] });
                showToast(msg);
                onClose();
              }}>
              <option value="">-- Pilih Blok --</option>
              {blokOptionsForStock.map(l => <option key={l.id} value={l.id}>{l.kode}{l.nama ? " — " + l.nama : ""}</option>)}
            </select>
            {effGudangIdForBlok && blokOptionsForStock.length === 0 && <div style={{ fontSize: 12, color: "#b45309", fontStyle: "italic", marginTop: 2 }}>⚠️ Belum ada Blok terdaftar di Gudang ini — pilihan Gudang tetap tersimpan.</div>}
            {st.lokasiMovePending && <div style={{ fontSize: 12, color: "#92400e", fontWeight: 700, marginTop: 2 }}>⏳ Menunggu approval {st.lokasiMoveApprover || "Asman"} → {st.pendingLokasiKode}</div>}
          </>
        ) : (
          <div style={{ fontSize: 12, color: noLokasi ? "#f59e0b" : C.text, fontWeight: noLokasi ? 700 : 400 }}>{noLokasi ? "⚠️ Belum diisi" : st.lokasi || "—"}</div>
        )}
      </div>
    </div>
  );
}
