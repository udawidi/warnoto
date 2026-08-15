import { useEffect, useMemo, useState } from "react";
import { fmtDate } from "../lib/utils.js";
import { fmtNum } from "../lib/ragShared.mjs";

const norm = value => String(value ?? "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
const num = value => Number.isFinite(Number(value)) ? Number(value) : 0;
const mapPercent = value => {
  if (value == null || String(value).trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n : null;
};
export function PetaGudangTab({ gudangList = [], subGudangList = [], lokasiList = [], stocks = [], sty, C, gudangCapacityList = [], uptOptions = [], uptFilter = "", setUptFilter }) {
  const [selectedGudangId, setSelectedGudangId] = useState(gudangList[0]?.id || "");
  const [selectedScopeId, setSelectedScopeId] = useState("main");
  const [hoveredLokasi, setHoveredLokasi] = useState(null);
  const [filterHanyaBerisi, setFilterHanyaBerisi] = useState(false);

  useEffect(() => {
    if (!gudangList.length) { if (selectedGudangId) setSelectedGudangId(""); return; } // UPT tanpa gudang: kosongkan pilihan supaya sub-gudang tak nyangkut di UPT lain
    if (gudangList.some(g => g.id === selectedGudangId)) return;
    const withContent = gudangList.find(g => g.denahImageData || subGudangList.some(s => s.gudangId === g.id && s.denahImageData));
    setSelectedGudangId((withContent || gudangList[0]).id);
  }, [gudangList, subGudangList, selectedGudangId]);

  const gudang = gudangList.find(g => g.id === selectedGudangId);
  const subs = useMemo(() => subGudangList.filter(s => s.gudangId === selectedGudangId), [subGudangList, selectedGudangId]);
  const mappedSubs = useMemo(() => subs.filter(s => s.denahImageData), [subs]);
  useEffect(() => {
    if (selectedScopeId !== "main" && !mappedSubs.some(s => s.id === selectedScopeId)) setSelectedScopeId("main");
  }, [selectedScopeId, mappedSubs]);
  const selectedSub = mappedSubs.find(s => s.id === selectedScopeId);
  const scope = useMemo(() => selectedSub ? { id: selectedSub.id, name: selectedSub.nama, image: selectedSub.denahImageData, isSub: true } : gudang ? { id: gudang.id, name: gudang.nama, image: gudang.denahImageData, isSub: false } : null, [selectedSub, gudang]);
  const blocks = scope ? lokasiList.filter(l => {
    if (scope.isSub) return l.subGudangId === scope.id && mapPercent(l.subMapX) != null && mapPercent(l.subMapY) != null;
    return l.gudangId === scope.id && !l.subGudangId && mapPercent(l.mapX) != null && mapPercent(l.mapY) != null;
  }) : [];
  const stockAt = id => stocks.filter(s => s.lokasiId === id);
  const visibleBlocks = filterHanyaBerisi ? blocks.filter(l => stockAt(l.id).length) : blocks;

  const capacity = useMemo(() => {
    if (!scope) return null;
    const target = norm(scope.name), parent = norm(gudang?.nama);
    const rows = gudangCapacityList.filter(r => {
      const warehouse = norm(r.gudang);
      if (scope.isSub) {
        const sub = norm(r.subGudang || r.subGudangNama || r.namaSubGudang);
        return sub === target && (!parent || !warehouse || warehouse === parent);
      }
      return warehouse === target;
    });
    if (!rows.length) return null;
    const luas = rows.reduce((s, r) => s + num(r.luasLahanM2), 0), terpakai = rows.reduce((s, r) => s + num(r.luasTerpakaiM2), 0);
    const sisa = rows.reduce((s, r) => s + num(r.sisaLuasM2), 0) || Math.max(0, luas - terpakai), pct = luas > 0 ? terpakai / luas : 0;
    const statusKapasitas = pct >= 0.9 ? "KRITIS" : pct >= 0.75 ? "WASPADA" : "AMAN";
    return { luasLahanM2: luas, luasTerpakaiM2: terpakai, sisaLuasM2: sisa, persentaseTerpakai: pct, statusKapasitas };
  }, [gudangCapacityList, scope]);

  const selectScope = id => { setSelectedScopeId(id || "main"); setHoveredLokasi(null); };
  const renderTooltip = (l, x) => {
    const list = stockAt(l.id), pending = l.status === "PENDING", empty = !list.length;
    return <div className="warehouse-map-tooltip" style={{ position: "absolute", top: 20, left: x < 25 ? 0 : x > 75 ? "auto" : "50%", right: x > 75 ? 0 : "auto", transform: x >= 25 && x <= 75 ? "translateX(-50%)" : "none", background: "white", border: `1px solid ${C.border}`, borderRadius: 10, padding: 10, minWidth: 200, maxWidth: 280, boxShadow: "0 4px 16px rgba(0,0,0,.15)", zIndex: 20 }}>
      <div style={{ fontWeight: 800, fontSize: 12, marginBottom: 6, borderBottom: `1px solid ${C.border}`, paddingBottom: 4 }}>📍 {l.kode} — {l.nama}</div>
      {pending && <div style={{ fontSize: 12, color: "#92400e", fontWeight: 700, marginBottom: 6 }}>⏳ Menunggu approval TL</div>}
      {empty ? <div style={{ fontSize: 12, color: C.muted, fontStyle: "italic" }}>Tidak ada barang di blok ini</div> : list.slice(0, 5).map((s, i) => <div key={i} style={{ fontSize: 12, padding: "2px 0", display: "flex", justifyContent: "space-between" }}><span style={{ maxWidth: 150, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>{s.name}</span><span style={{ fontWeight: 700, color: C.accent, marginLeft: 8 }}>{fmtNum(s.qty)} {s.unit}</span></div>)}
      {list.length > 5 && <div style={{ fontSize: 12, color: C.muted, marginTop: 4 }}>+{list.length - 5} item lainnya</div>}
      <div style={{ fontSize: 12, color: C.muted, marginTop: 6 }}>Koordinat tersimpan: {x.toFixed(1)}%, {mapPercent(l.subGudangId ? l.subMapY : l.mapY)?.toFixed(1) ?? "-"}%</div>
    </div>;
  };

  return <div>
    <div className="warehouse-map-toolbar" style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", gap: 12, marginBottom: 10, padding: 12, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14 }}>
      {uptOptions.length > 0 && (
        <div className="warehouse-map-toolbar__field" style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 12, fontWeight: 800, color: C.muted, textTransform: "uppercase", letterSpacing: ".5px" }}>1. UPT</span>
          <select aria-label="Filter UPT" style={{ ...sty.select, minHeight: 44, width: 190 }} value={uptFilter} onChange={e => setUptFilter?.(e.target.value)}>
            <option value="">Semua UPT</option>
            {uptOptions.map(u => <option key={u.id} value={u.id}>{u.nama}</option>)}
          </select>
        </div>
      )}
      <div className="warehouse-map-toolbar__field" style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <span style={{ fontSize: 12, fontWeight: 800, color: C.muted, textTransform: "uppercase", letterSpacing: ".5px" }}>{uptOptions.length > 0 ? "2. " : ""}Gudang</span>
        <select aria-label="Pilih Gudang" style={{ ...sty.select, minHeight: 44, width: 200 }} value={selectedGudangId} onChange={e => { setSelectedGudangId(e.target.value); setSelectedScopeId("main"); setHoveredLokasi(null); }}>
          {gudangList.length ? gudangList.map(g => <option key={g.id} value={g.id}>{g.nama}</option>) : <option value="">— tidak ada gudang —</option>}
        </select>
      </div>
      <div className="warehouse-map-toolbar__field" style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <span style={{ fontSize: 12, fontWeight: 800, color: C.muted, textTransform: "uppercase", letterSpacing: ".5px" }}>{uptOptions.length > 0 ? "3. " : ""}Denah</span>
        <select aria-label="Pilih tampilan denah" style={{ ...sty.select, minHeight: 44, width: 220 }} value={selectedScopeId} onChange={e => selectScope(e.target.value)}>
          <option value="main">Gudang utama{gudang?.denahImageData ? "" : " (belum ada denah)"}</option>
          {mappedSubs.map(s => <option key={s.id} value={s.id}>Sub Gudang — {s.nama}</option>)}
        </select>
      </div>
      <label style={{ fontSize: 12, color: C.muted, display: "flex", alignItems: "center", gap: 6, minHeight: 44, marginLeft: "auto" }}><input type="checkbox" checked={filterHanyaBerisi} onChange={e => setFilterHanyaBerisi(e.target.checked)} /> Hanya blok berisi barang</label>
    </div>
    <p style={{ color: C.muted, fontSize: 12, margin: "0 0 16px" }}>Visualisasi blok dan material pada denah gudang. Koordinat peta bersifat read-only.</p>
    {!gudangList.length && <div style={{ ...sty.card, textAlign: "center", padding: 60, color: C.muted }}>Belum ada Gudang.</div>}
    {gudang && !scope?.image && <div style={{ ...sty.card, textAlign: "center", padding: 48, color: C.muted }}>Denah {scope?.name || gudang.nama} belum diupload.</div>}
    {scope?.image && <>
      <div style={{ ...sty.card, marginBottom: 14, padding: 12 }}><strong>{scope.name}</strong><div style={{ fontSize: 12, color: C.muted }}>{scope.isSub ? "Sub Gudang" : "Gudang utama"}</div></div>
      {capacity ? <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(120px,1fr))", gap: 8, marginBottom: 14 }}>{[["Luas", `${fmtNum(Math.round(num(capacity.luasLahanM2)))} m²`],["Terpakai", `${fmtNum(Math.round(num(capacity.luasTerpakaiM2)))} m²`],["Sisa", `${fmtNum(Math.round(num(capacity.sisaLuasM2)))} m²`],["Persentase", `${(num(capacity.persentaseTerpakai) * 100).toFixed(1)}%`],["Status", capacity.statusKapasitas || "-"]].map(([k,v]) => <div key={k} style={{ ...sty.card, padding: "9px 12px" }}><div style={{ fontSize: 12, color: C.muted, fontWeight: 700 }}>{k}</div><div style={{ fontSize: 15, fontWeight: 800 }}>{v}</div></div>)}</div> : <div style={{ ...sty.card, padding: 12, marginBottom: 14, color: C.muted, fontSize: 12 }}>Belum ada record kapasitas yang cocok untuk “{scope.name}”.</div>}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>{[["Total Blok", blocks.length, C.text],["Berisi Barang", blocks.filter(l => stockAt(l.id).length).length, C.green],["Kosong", blocks.filter(l => !stockAt(l.id).length && l.status !== "PENDING").length, C.muted],["Pending Approval", blocks.filter(l => l.status === "PENDING").length, "#92400e"],["Total Item Tersimpan", blocks.reduce((n, l) => n + stockAt(l.id).length, 0), C.accent]].map(([k,v,c]) => <div key={k} style={{ ...sty.card, padding: "8px 14px", minWidth: 110 }}><div style={{ fontSize: 12, color: C.muted, fontWeight: 700, textTransform: "uppercase" }}>{k}</div><div style={{ fontSize: 17, fontWeight: 800, color: c }}>{v}</div></div>)}</div>
      <div className="warehouse-map-layout" style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 280px", gap: 16 }}>
        <div style={{ ...sty.card, padding: 10, display: "flex", justifyContent: "center", alignItems: "flex-start" }}><div style={{ position: "relative", maxWidth: 680, width: "100%", height: "fit-content", alignSelf: "flex-start" }}><img src={scope.image} alt={`Denah ${scope.name}`} style={{ width: "100%", height: "auto", display: "block", borderRadius: 10, border: `1px solid ${C.border}` }} />{visibleBlocks.map(l => { const list = stockAt(l.id), empty = !list.length, pending = l.status === "PENDING", active = hoveredLokasi === l.id, x = mapPercent(scope.isSub ? l.subMapX : l.mapX), y = mapPercent(scope.isSub ? l.subMapY : l.mapY); return <div key={l.id} title={`${l.kode}${empty ? " (kosong)" : ` — ${list.length} item`}`} style={{ position: "absolute", left: `${x}%`, top: `${y}%`, transform: "translate(-50%,-50%)", width: 12, height: 12, borderRadius: "50%", background: pending || empty ? "#9ca3af" : "#dc2626", border: pending ? "2px dashed white" : "2px solid white", cursor: "pointer", boxShadow: active ? "0 0 0 3px rgba(37,99,235,.35)" : "0 1px 4px rgba(0,0,0,.4)", zIndex: active ? 10 : 5 }} onMouseEnter={() => setHoveredLokasi(l.id)} onMouseLeave={() => setHoveredLokasi(null)} onClick={() => setHoveredLokasi(active ? null : l.id)}>{active && renderTooltip(l, x)}</div>; })}</div></div>
        <div><div style={{ ...sty.card, padding: 12, marginBottom: 12 }}><div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>Legenda</div><div style={{ fontSize: 12, marginBottom: 6 }}>🔴 Blok berisi barang</div><div style={{ fontSize: 12, marginBottom: 6 }}>⚪ Blok kosong</div><div style={{ fontSize: 12 }}>⏳ Menunggu approval TL</div></div><div style={{ ...sty.card, padding: 12 }}><div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>Daftar Blok ({visibleBlocks.length})</div>{visibleBlocks.length ? visibleBlocks.map(l => <div key={l.id} style={{ minHeight: 44, padding: "7px 0", borderBottom: `1px solid ${C.border}`, cursor: "pointer", background: hoveredLokasi === l.id ? "#eff6ff" : "transparent" }} onMouseEnter={() => setHoveredLokasi(l.id)} onMouseLeave={() => setHoveredLokasi(null)} onClick={() => setHoveredLokasi(hoveredLokasi === l.id ? null : l.id)}><strong style={{ fontSize: 12 }}>{l.kode}</strong><div style={{ fontSize: 12, color: C.muted }}>{l.nama || "-"} · {stockAt(l.id).length} item</div></div>) : <div style={{ fontSize: 12, color: C.muted, padding: 16, textAlign: "center" }}>Tidak ada blok untuk ditampilkan</div>}</div></div>
      </div>
    </>}
    {gudang && mappedSubs.length > 0 && <div style={{ marginTop: 24 }}><div style={{ fontSize: 13, fontWeight: 800, marginBottom: 10 }}>🏢 Denah Sub Gudang</div><div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))", gap: 16 }}>{mappedSubs.map(s => { const bs = lokasiList.filter(l => l.subGudangId === s.id && l.subMapX != null); return <button type="button" key={s.id} onClick={() => selectScope(s.id)} style={{ ...sty.card, padding: 12, textAlign: "left", cursor: "pointer", minHeight: 44, border: selectedScopeId === s.id ? `2px solid ${C.accent}` : undefined }}><strong style={{ fontSize: 13 }}>{s.nama}</strong><div style={{ fontSize: 12, color: C.muted, margin: "3px 0 8px" }}>{bs.length} blok terpetakan · {bs.filter(l => stockAt(l.id).length).length} berisi barang{s.denahUploadedAt ? <> · {fmtDate(s.denahUploadedAt)}</> : null}</div><img src={s.denahImageData} alt={`Denah ${s.nama}`} style={{ width: "100%", height: "auto", display: "block", borderRadius: 10, border: `1px solid ${C.border}` }} /></button>; })}</div></div>}
  </div>;
}
