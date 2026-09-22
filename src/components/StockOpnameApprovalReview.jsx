import { useEffect, useMemo, useState } from "react";
import { fmtDate } from "../lib/utils.js";

export function StockOpnameApprovalReview({ opn, C, sty, users = [], lokasiList = [], onApprove, onClose }) {
  const [catatan, setCatatan] = useState("");
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [approvalError, setApprovalError] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  useEffect(() => { setCatatan(""); setChecked(false); setBusy(false); setApprovalError(""); setQuery(""); setFilter("all"); }, [opn?.id]);
  const items = opn?.items || [];
  const discrepancies = useMemo(() => items.filter(i => Number(i.selisih || 0) !== 0), [items]);
  const missingNotes = discrepancies.filter(i => !String(i.keterangan || "").trim());
  const visibleItems = useMemo(() => discrepancies.filter(item => {
    const diff = Number(item.selisih || 0);
    if (filter === "shortage" && diff >= 0) return false;
    if (filter === "surplus" && diff <= 0) return false;
    const needle = query.trim().toLowerCase();
    return !needle || [item.namaBarang, item.nama, item.noKatalog, item.keterangan].some(v => String(v || "").toLowerCase().includes(needle));
  }), [discrepancies, filter, query]);
  const summary = useMemo(() => ({
    total: items.length,
    sesuai: items.length - discrepancies.length,
    selisih: discrepancies.length,
    surplus: discrepancies.filter(i => Number(i.selisih) > 0).length,
    kurang: discrepancies.filter(i => Number(i.selisih) < 0).length,
    belum: items.filter(i => ["TIDAK_ADA_DI_SAP", "TIDAK_ADA_DI_SISTEM", "MATERIAL_BARU_NONSAP"].includes(i.statusItem)).length,
  }), [items, discrepancies]);
  if (!opn) return null;
  const submitter = users.find(u => u.id === opn.dibuatOleh);
  const canApprove = checked && !missingNotes.length && !busy;
  const locationLabel = item => {
    const fallback = item.lokasiId && lokasiList.find(l => String(l.id) === String(item.lokasiId));
    const rows = Array.isArray(item.lokasiBreakdown) ? item.lokasiBreakdown : [];
    const base = item.blok || item.blokKode || item.lokasi || item.lokasiKode || fallback?.kode || fallback?.nama || item.lokasiId || "-";
    return <div>{rows.length ? rows.map((row, i) => <div key={i} style={{marginTop:i ? 4 : 0}}><strong>{row.lokasiKode || row.kode || row.lokasiId || base}</strong>: {row.qty ?? row.qtsFisik ?? "-"}{row.sourceLabel && <div style={{color:C.muted,fontSize:11}}>{row.sourceLabel}</div>}</div>) : base}</div>;
  };
  const photoFields = (item) => [[item.fotoKeseluruhan, "Foto keseluruhan"], [item.fotoNameplate, "Foto nameplate"]].filter(([src]) => src);
  const recount = item => item.recount || item.recountData || item.hitungUlang;
  const approve = async () => {
    if (!canApprove) return;
    setBusy(true);
    setApprovalError("");
    try {
      const result = await onApprove(opn, catatan);
      if (result !== false) onClose();
      else setBusy(false);
    } catch {
      setApprovalError("Approval gagal. Data review dan catatan tetap tersimpan; coba lagi.");
      setBusy(false);
    }
  };
  return <div className="opname-review-dialog" role="dialog" aria-modal="true" aria-labelledby="opname-review-title" style={{position:"fixed",inset:0,zIndex:1200,background:"rgba(15,23,42,.58)",display:"flex",alignItems:"center",justifyContent:"center",padding:12}}>
    <div className="opname-review-dialog__panel" style={{...sty.card,width:960,maxWidth:"100%",maxHeight:"94vh",overflowY:"auto"}}>
      <div style={{display:"flex",justifyContent:"space-between",gap:12,alignItems:"flex-start"}}>
        <div><h2 id="opname-review-title" style={{margin:"0 0 4px",fontSize:18}}>Review Stock Opname sebelum approval</h2><div style={{fontSize:12,color:C.muted}}>Periksa seluruh selisih dan keterangannya.</div></div>
        <button type="button" className="opname-review-dialog__close" aria-label="Tutup review" style={sty.btn("ghost","sm")} onClick={onClose} disabled={busy}>Tutup</button>
      </div>
      <div className="opname-review-dialog__meta" style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))",gap:8,margin:"16px 0"}}>
        {[['Semester',opn.semester],['Jenis',opn.jenisAlur || opn.kategori],['Gudang',opn.gudangKode],['Pengaju',submitter?.name || submitter?.nama || opn.dibuatOleh || "-"],['Diajukan',fmtDate(opn.submittedAt || opn.dibuatAt)]].map(([label,value])=><div key={label} style={{padding:"9px 10px",border:`1px solid ${C.border}`,borderRadius:8}}><div className="opname-review-dialog__small-label" style={{fontSize:11,color:C.muted}}>{label}</div><div style={{fontSize:13,fontWeight:700,overflowWrap:"anywhere"}}>{value || "-"}</div></div>)}
      </div>
      <div className="opname-review-dialog__kpis" style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(100px,1fr))",gap:8,marginBottom:14}}>
        {[['Total',summary.total],['Sesuai',summary.sesuai],['Selisih',summary.selisih],['Surplus',summary.surplus],['Kekurangan',summary.kurang],['Belum terdaftar',summary.belum]].map(([label,value])=><div className="opname-review-dialog__kpi" key={label} style={{padding:"10px",borderRadius:8,background:C.surfaceMuted || "#f8fafc",textAlign:"center"}}><div className="opname-review-dialog__small-label" style={{fontSize:11,color:C.muted}}>{label}</div><strong>{value}</strong></div>)}
      </div>
      {!discrepancies.length ? <div style={{padding:12,borderRadius:8,background:"#ecfdf5",color:"#166534",fontWeight:700}}>Tidak ada selisih pada sesi ini.</div> : <>
        <div className="opname-review-dialog__toolbar" style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"center",marginBottom:10}}><input aria-label="Cari selisih" placeholder="Cari nama, katalog, keterangan..." value={query} onChange={e=>setQuery(e.target.value)} style={{...sty.input,flex:"1 1 260px",minWidth:220}}/><select aria-label="Filter selisih" value={filter} onChange={e=>setFilter(e.target.value)} style={{...sty.input,width:170}}><option value="all">Semua selisih</option><option value="shortage">Kekurangan</option><option value="surplus">Surplus</option></select><span style={{fontSize:12,color:C.muted}}>{visibleItems.length} dari {discrepancies.length} item</span></div>
        <div className="opname-review-dialog__list" style={{display:"grid",gap:10,maxHeight:"36vh",overflowY:"auto",paddingRight:2}}>{visibleItems.map((item,index)=>{ const diff=Number(item.selisih||0); const rec=recount(item); const recUser=rec?.by && users.find(user=>String(user.id)===String(rec.by)); const qtyFields=[["Qty Sistem",item.qtySistem],...((opn.jenisAlur==="SAP" || item.qtySAP != null)?[["Qty SAP",item.qtySAP]]:[]),["Qty Fisik",item.qtsFisik],["Selisih",`${diff>0?"+":""}${item.selisih ?? 0}`]]; return <article className="opname-review-dialog__item" key={`${item.noKatalog || item.namaBarang}-${index}`} style={{border:`1px solid ${C.border}`,borderRadius:10,padding:12,background:C.surface || "#fff"}}>
          <div className="opname-review-dialog__item-header" style={{display:"flex",justifyContent:"space-between",gap:8,flexWrap:"wrap"}}><div><div style={{fontWeight:800}}>{index+1}. {item.namaBarang || item.nama || "-"}</div><div style={{fontSize:12,color:C.muted}}>{item.noKatalog || "-"} {item.satuan ? `• ${item.satuan}` : ""}</div></div><div style={{display:"flex",gap:5,flexWrap:"wrap"}}><span className="opname-review-dialog__small-label" style={{fontSize:11,padding:"3px 7px",borderRadius:999,background:C.surfaceMuted || "#f1f5f9"}}>{item.statusItem || "Selisih"}</span><span className="opname-review-dialog__small-label" style={{fontSize:11,padding:"3px 7px",borderRadius:999,background:diff>0?"#dcfce7":"#fee2e2",color:diff>0?"#166534":"#991b1b",fontWeight:700}}>{diff>0?"Surplus":"Kekurangan"}</span></div></div>
          <div className="opname-review-dialog__quantities" style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(105px,1fr))",gap:6,margin:"10px 0"}}>{qtyFields.map(([label,value])=><div key={label} style={{padding:8,borderRadius:7,background:label==="Selisih"?(diff>0?"#f0fdf4":"#fef2f2"):C.surfaceMuted || "#f8fafc"}}><div className="opname-review-dialog__small-label" style={{fontSize:10,color:C.muted}}>{label}</div><strong style={label==="Selisih"?{color:diff>0?"#166534":"#b91c1c"}:undefined}>{value ?? "-"}</strong></div>)}</div>
          <div style={{fontSize:12,marginBottom:7}}><strong>Lokasi / Blok</strong><div style={{marginTop:3}}>{locationLabel(item)}</div></div><div style={{fontSize:12,padding:8,borderRadius:7,background:item.keterangan?"#fffbeb":"#fef2f2",whiteSpace:"pre-wrap",overflowWrap:"anywhere"}}><strong>Keterangan selisih</strong><div style={{marginTop:3}}>{item.keterangan || <span style={{color:"#b91c1c",fontWeight:700}}>Keterangan belum diisi</span>}</div></div>
          {rec && <div style={{fontSize:12,marginTop:7}}><strong>Hitung ulang</strong>: {rec.cocok === true || rec.hasilCocok === true ? "Hasil cocok" : rec.cocok === false || rec.hasilCocok === false ? "Hasil tidak cocok" : "Tersedia"}{rec.qtyUlang !== undefined ? ` • Qty ulang: ${rec.qtyUlang}` : rec.qty !== undefined ? ` • Qty ulang: ${rec.qty}` : ""}{rec.waktu || rec.at ? ` • ${fmtDate(rec.waktu || rec.at)}` : ""}{recUser?.name || recUser?.nama || rec.petugas || rec.userName ? ` • ${recUser?.name || recUser?.nama || rec.petugas || rec.userName}` : ""}</div>}
          <div style={{marginTop:8}}><strong style={{fontSize:12}}>Foto</strong>{photoFields(item).length ? <div style={{display:"flex",gap:8,marginTop:4,flexWrap:"wrap"}}>{photoFields(item).map(([src,label],i)=><div key={i} style={{fontSize:10,color:C.muted}}><img src={src} alt={`${label} ${item.namaBarang || "material"}`} style={{display:"block",width:64,height:64,objectFit:"cover",borderRadius:6}}/>{label}</div>)}</div> : <div style={{fontSize:11,color:C.muted,marginTop:3}}>Tidak ada foto (opsional)</div>}</div>
        </article>})}{!visibleItems.length && <div style={{padding:14,textAlign:"center",color:C.muted}}>Tidak ada item sesuai filter.</div>}</div>
      </>}
      {missingNotes.length > 0 && <div role="alert" style={{marginTop:12,padding:10,borderRadius:8,background:"#fef2f2",color:"#991b1b",fontSize:12,fontWeight:700}}>Approval diblokir: {missingNotes.length} item selisih belum memiliki keterangan.</div>}
      {approvalError && <div role="alert" style={{marginTop:12,padding:10,borderRadius:8,background:"#fef2f2",color:"#991b1b",fontSize:12,fontWeight:700}}>{approvalError}</div>}
      <label style={{display:"flex",gap:8,alignItems:"flex-start",marginTop:14,fontSize:13,fontWeight:700}}><input type="checkbox" checked={checked} onChange={e=>setChecked(e.target.checked)} /> <span>Saya sudah memeriksa seluruh selisih dan keterangannya.</span></label>
      <label style={{display:"block",marginTop:12,fontSize:12,fontWeight:700}}>Catatan approval (opsional)<textarea style={{...sty.input,display:"block",marginTop:5,minHeight:65}} value={catatan} onChange={e=>setCatatan(e.target.value)} /></label>
      <div className="opname-review-dialog__footer" style={{display:"flex",justifyContent:"flex-end",gap:8,marginTop:14}}><button type="button" style={sty.btn("ghost")} onClick={onClose} disabled={busy}>Batal</button><button type="button" className="approval-btn--approve" onClick={approve} disabled={!canApprove} style={{opacity:canApprove?1:.5}}>{busy ? "Menyimpan..." : "Setujui Final"}</button></div>
    </div>
  </div>;
}
