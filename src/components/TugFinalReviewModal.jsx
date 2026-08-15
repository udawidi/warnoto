import { useEffect, useMemo, useState } from "react";
import { fmtNum } from "../lib/ragShared.mjs";

const ATT = [
  ["items", "Saya sudah memeriksa material, kuantitas, satuan, dan lokasi."],
  ["parties", "Saya sudah memeriksa pihak tujuan/penerima dan lampiran pendukung."],
  ["document", "Saya sudah memeriksa rangkuman dokumen final dan dampak stok."],
  ["impact", "Saya memahami perubahan stok yang akan dijalankan setelah approval final."],
];
// Asman tidak lagi mengisi checklist (review cukup di level TL), tetapi
// tug_decide tetap menolak approval FINAL tanpa 4 attestation true
// (TUG_ATTESTATIONS_REQUIRED). Klik "Setujui Final" oleh Asman ITULAH
// pernyataannya, jadi dikirim penuh dari sini.
const ASMAN_ATT = Object.fromEntries(ATT.map(([key]) => [key, true]));
const DOC_KEY ={ TUG3:"tug3", TUG5:"tug5", TUG7:"tug7", TUG8:"tug8", TUG9:"tug9", TUG10:"tug10" };

function docNo(txn) { return txn.docNumbers?.[DOC_KEY[txn.docType]] || txn.id; }
// Trail server bisa punya banyak PREPARED berturut-turut (tiap kali modal review
// dibuka lagi menghasilkan 1 event baru) — ringkas jadi 1 baris + hitungan
// daripada mengulang teks yang sama berkali-kali.
function summarizeTrail(events) {
  if (!events.length) return "belum ada keputusan";
  const collapsed = [];
  for (const e of events) {
    const label = `${e.eventType}${e.stage ? ` (${e.stage})` : ""}`;
    const last = collapsed[collapsed.length - 1];
    if (last && last.label === label) last.count += 1;
    else collapsed.push({ label, count: 1 });
  }
  return collapsed.map(c => c.count > 1 ? `${c.label} ×${c.count}` : c.label).join(" → ");
}
function status(label, kind) {
  const colors = kind === "FAIL" ? ["#fef2f2", "#b91c1c"] : kind === "WARN" ? ["#fffbeb", "#a16207"] : ["#f0fdf4", "#15803d"];
  return <div style={{background:colors[0],color:colors[1],borderRadius: 10,padding:"7px 9px",fontSize:12,marginTop:6}}><b>{kind}</b> - {label}</div>;
}

export function TugFinalReviewModal({ txn, stocks, katalogList, users, pendingTxns=[], sty, C, prepareReview, onApprove, onClose }) {
  const [review, setReview] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [attested, setAttested] = useState({});
  const [previewed, setPreviewed] = useState(false);
  const outgoing = txn.docType === "TUG8" || txn.docType === "TUG9";
  const incoming = txn.docType === "TUG3" || txn.docType === "TUG10";
  // The review RPC is the authority: it is the same document/items snapshot that
  // is hashed and later checked by tug_decide. Cached data is visible only while
  // the request is loading; an incomplete server payload cannot be approved.
  const reviewPayloadComplete = Boolean(
    review && !review.unavailable && review.document && review.identitySnapshot &&
    review.docNumber && review.docType && review.uptId && review.createdBy &&
    Array.isArray(review.items) && review.stage && Array.isArray(review.approvalProgress)
  );
  const serverDocument = reviewPayloadComplete
    ? { ...review.document, docType:review.docType, docNumbers:{ [DOC_KEY[review.docType]]:review.docNumber } }
    : txn;
  const serverIdentity = reviewPayloadComplete ? review.identitySnapshot : {};
  const serverItems = reviewPayloadComplete
    ? review.items.map(item => ({ ...(item.snapshot || {}), stockId:item.stockId, katalogId:item.katalogId, lokasiId:item.lokasiId, qty:item.qty, unit:item.unit }))
    : (loading ? (txn.stockItems || []) : []);
  const reviewStage = reviewPayloadComplete ? review.stage : null;
  const items = useMemo(() => serverItems.map((item, index) => {
    const stock = stocks.find(s => s.id === item.stockId);
    const katalog = katalogList.find(k => k.id === (item.katalogId || stock?.katalogId));
    const qty = Number(item.qty || item.permintaan || 0);
    const snapshot = (review?.stockSnapshot || []).find(s => s.stock_id === item.stockId);
    const current = snapshot ? Number(snapshot.qty) : null;
    const pending = pendingTxns.filter(t => t.id !== txn.id && ["TUG8","TUG9"].includes(t.docType) && t.status === "PENDING").reduce((sum,t) => sum + (t.stockItems || []).filter(x => x.stockId === item.stockId).reduce((q,x) => q + Number(x.qty || 0), 0), 0);
    const after = outgoing && current !== null ? current - qty : incoming && current !== null ? current + qty : null;
    return { index, item, stock, katalog, qty, current, pending, after };
  }), [serverItems, txn, stocks, katalogList, pendingTxns, outgoing, incoming, review]);
  const fail = !reviewPayloadComplete || (outgoing && items.some(i => i.current === null || i.qty <= 0 || i.after < 0));
  const allAttested = ATT.every(([key]) => attested[key]);
  const tlStage = reviewStage === "PENDING_TL";
  const asmanStage = reviewStage === "PENDING_ASMAN";
  const finalLabel = tlStage ? "Setujui TL - Lanjutkan ke Asman" : outgoing ? "Setujui Final & Kurangi Stok" : incoming ? "Setujui Final & Tambah Stok" : "Setujui Final - Tidak Mengubah Stok";

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const result = await prepareReview?.(txn);
        if (!alive) return;
        if (result?.unavailable) setReview({ unavailable:true });
        else if (result?.data) setReview(result.data);
        else setReview({ unavailable:true });
      } catch (e) { if (alive) setError(e.message || "Overview tidak dapat disiapkan. Tutup lalu coba lagi."); }
      finally { if (alive) setLoading(false); }
    })();
    return () => { alive = false; };
    // Sengaja hanya bergantung pada txn.id: `txn` (dari .map state parent) dan
    // `prepareReview` (arrow inline di ApprovalTab) berganti identitas tiap render
    // parent, sehingga deps lengkap membuat RPC tug_prepare_review dipanggil
    // berulang selama modal terbuka -> token review churn -> approval final Asman
    // ditolak server (TUG_REVIEW_REQUIRED/STALE). Satu transaksi = satu prepare.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [txn.id]);

  const serverDocNumber = reviewPayloadComplete ? review.docNumber : docNo(txn);
  const serverDocType = reviewPayloadComplete ? review.docType : txn.docType;
  const creator = users.find(u => u.id === review?.createdBy);
  const preview = { nomor:serverDocNumber, jenis:serverDocType, pekerjaan:serverDocument.namaPekerjaan||serverDocument.pekerjaan, lokasi:serverDocument.lokasiPekerjaan, tujuan:serverDocument.unitTujuan||serverDocument.penerimaUnit, penerima:serverDocument.penerimaNama, material:serverItems.map(i=>({stockId:i.stockId,katalogId:i.katalogId,qty:i.qty||i.permintaan,unit:i.unit||i.satuan})) };
  return <div style={{position:"fixed",inset:0,zIndex:1800,background:"rgba(15,23,42,.58)",display:"flex",alignItems:"center",justifyContent:"center",padding:16}} role="dialog" aria-modal="true" aria-label="Periksa transaksi sebelum approval final">
    <div style={{...sty.card,width:900,maxWidth:"100%",maxHeight:"92dvh",overflowY:"auto",padding:20}}>
      <div style={{display:"flex",justifyContent:"space-between",gap:12,alignItems:"flex-start",marginBottom:14}}><div><div style={{fontSize:12,fontWeight:800,color:C.muted,letterSpacing:.5}}>WAJIB PERIKSA SEBELUM APPROVAL FINAL</div><h2 style={{margin:"4px 0",fontSize:20}}>{reviewPayloadComplete || loading ? `${serverDocType.replace("TUG","TUG-")} / ${serverDocNumber}` : "Review server tidak tersedia"}</h2><div style={{fontSize:12,color:C.muted}}>Overview membaca payload dan snapshot stok server. Perubahan setelah review harus diperiksa ulang.</div></div><button className="approval-btn--cancel" onClick={onClose}>Tutup</button></div>
      {loading && <div style={{padding:14,background:"#eff6ff",color:"#1d4ed8",borderRadius: 10}}>Memuat ulang snapshot transaksi dan stok dari server...</div>}
      {error && status(error,"FAIL")}
      {!loading && !error && (!reviewPayloadComplete ? status("Payload review server tidak lengkap. Approval final diblokir; tutup lalu buka ulang overview.","FAIL") : <>
        {reviewStage === "PENDING_TL" && status("Tahap TL: keputusan ini meneruskan transaksi ke Asman. Stok belum berkurang.","WARN")}
        {reviewStage === "PENDING_ASMAN" && status("Tahap Asman final: stok akan berubah hanya setelah keputusan final ini.","WARN")}
        <section style={{marginBottom:14}}><h3 style={{fontSize:13,margin:"0 0 7px"}}>Identitas dan dokumen</h3><div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(190px,1fr))",gap:8,fontSize:12}}><div><b>Nomor</b><br/>{docNo(serverDocument)}</div><div><b>UPT</b><br/>{serverDocument.uptId || serverDocument.upt_id || txn.uptId || "-"}</div><div><b>Pekerjaan</b><br/>{serverDocument.namaPekerjaan || serverDocument.pekerjaan || serverDocument.keteranganUmum || "-"}</div><div><b>Diajukan oleh</b><br/>{creator?.name || serverDocument.createdBy || txn.createdBy || "-"}</div><div><b>Penerima/Tujuan</b><br/>{serverDocument.penerimaNama || serverDocument.unitTujuan || serverDocument.penerimaUnit || "-"}</div><div><b>TL snapshot</b><br/>{serverIdentity.tl_name || "Diambil server saat dokumen dibuat"}{serverIdentity.tl_phone ? ` / ${serverIdentity.tl_phone}` : ""}</div></div>{status("Nomor dokumen, versi, hash, identitas, dan item berasal dari record canonical server.",review?.unavailable?"FAIL":"PASS")}{!asmanStage && <><details style={{marginTop:8,border:`1px solid ${C.border}`,borderRadius: 10,padding:8}} onToggle={e=>{if(e.currentTarget.open)setPreviewed(true);}}><summary style={{cursor:"pointer",fontWeight:700}}>Buka preview dokumen final</summary><div style={{margin:"8px 0 0",fontSize:12}}><div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(160px,1fr))",gap:8,marginBottom:8}}><div><b>Nomor</b><br/>{preview.nomor}</div><div><b>Jenis</b><br/>{preview.jenis}</div><div><b>Pekerjaan</b><br/>{preview.pekerjaan || "-"}</div><div><b>Lokasi</b><br/>{preview.lokasi || "-"}</div><div><b>Tujuan</b><br/>{preview.tujuan || "-"}</div><div><b>Penerima</b><br/>{preview.penerima || "-"}</div></div><table style={{width:"100%",borderCollapse:"collapse"}}><thead><tr style={{background:"#f8fafc"}}><th style={{padding:6,textAlign:"left"}}>Material</th><th style={{padding:6,textAlign:"right"}}>Qty</th></tr></thead><tbody>{items.map(i=><tr key={i.index} style={{borderTop:`1px solid ${C.border}`}}><td style={{padding:6}}>{i.katalog?.name || i.item.namaBaru || i.stock?.name || i.item.stockId || i.item.katalogId || "Material tidak ditemukan"}</td><td style={{padding:6,textAlign:"right"}}>{fmtNum(i.qty)} {i.katalog?.satuan || i.item.unit || ""}</td></tr>)}</tbody></table></div></details>{Array.isArray(review?.approvalProgress) && <div style={{fontSize:12,color:C.muted,marginTop:8}}>Jejak approval server: {summarizeTrail(review.approvalProgress)}.</div>}</>}</section>
        <section style={{marginBottom:14}}><h3 style={{fontSize:13,margin:"0 0 7px"}}>Dampak material dan stok saat ini</h3><div className="mobile-card-table" style={{overflowX:"auto",border:`1px solid ${C.border}`,borderRadius: 10}}><table style={{width:"100%",fontSize:12,borderCollapse:"collapse"}}><thead><tr style={{background:"#f8fafc"}}>{["Material","Stok saat ini","Perubahan","Proyeksi","Antrean lain"].map(x=><th key={x} style={{padding:8,textAlign:x==="Material"?"left":"right"}}>{x}</th>)}</tr></thead><tbody>{items.map(i=><tr tabIndex={0} className="mobile-card-table__row" key={i.index} style={{borderTop:`1px solid ${C.border}`}}><td data-label="Material" className="mobile-card-table__title" style={{padding:8}}>{i.katalog?.name || i.item.namaBaru || i.stock?.name || "Material tidak ditemukan"}<br/><span style={{color:C.muted}}>{i.stock?.id || i.item.stockId || i.item.katalogId || "tanpa referensi stok"}</span></td><td data-label="Stok saat ini" style={{padding:8,textAlign:"right"}}>{i.current === null ? "-" : fmtNum(i.current)}</td><td data-label="Perubahan" style={{padding:8,textAlign:"right",fontWeight:700,color:outgoing?"#b91c1c":"#15803d"}}>{outgoing?"-":incoming?"+":""}{fmtNum(i.qty)} {i.katalog?.satuan || i.item.unit || ""}</td><td data-label="Proyeksi" style={{padding:8,textAlign:"right",fontWeight:700}}>{i.after === null ? "-" : fmtNum(i.after)}</td><td data-label="Antrean lain" style={{padding:8,textAlign:"right",color:i.pending?"#a16207":C.muted}}>{i.pending || "-"}</td></tr>)}</tbody></table></div>{fail ? status("Server review belum tersedia, stok tidak cukup, atau referensi stok tidak ditemukan. Approval final diblokir.","FAIL") : status("Saldo snapshot server mencukupi. Server akan mengunci dan memeriksa ulang saat final approval.","PASS")}{items.some(i=>i.pending) && status("Ada transaksi pending lain pada material yang sama; saldo diperiksa ulang saat final approval.","WARN")}</section>
        <section style={{marginBottom:14}}><h3 style={{fontSize:13,margin:"0 0 7px"}}>Pihak, lampiran, dan validasi</h3><div style={{fontSize:12}}>Pengemudi: <b>{serverDocument.namaPengemudi || "-"}</b> / Kendaraan: <b>{serverDocument.nopol || serverDocument.noKendaraan || "-"}</b> / Lampiran kendaraan: <b>{serverDocument.fotoKendaraan ? "ada" : "tidak ada"}</b> / SIM/KTP: <b>{serverDocument.fotoSimKtp ? "ada" : "tidak ada"}</b></div>{status("Tidak ada tanda tangan visual profil yang dipakai ulang. Approval internal dicatat sebagai bukti akun, waktu, versi, dan hash; bukan TTE PSrE tersertifikasi.","PASS")}</section>
        {asmanStage ? <section style={{borderTop:`1px solid ${C.border}`,paddingTop:12}}><div className="approval-actions" style={{marginTop:12}}><button className="approval-btn--cancel" onClick={onClose}>Kembali tanpa approval</button><button className="approval-btn--approve" disabled={loading||!!error||fail} onClick={()=>onApprove({reviewToken:review?.reviewToken,attestations:ASMAN_ATT,documentHash:review?.documentHash})}>{finalLabel}</button></div></section> :
        <section style={{borderTop:`1px solid ${C.border}`,paddingTop:12}}><h3 style={{fontSize:13,margin:"0 0 8px"}}>Konfirmasi pemeriksa</h3>{ATT.map(([key,label])=><label key={key} style={{display:"flex",gap:8,alignItems:"flex-start",fontSize:12,marginBottom:8,cursor:"pointer"}}><input type="checkbox" disabled={key==="document"&&!previewed} checked={!!attested[key]} onChange={e=>setAttested(s=>({...s,[key]:e.target.checked}))}/><span>{label}{key==="document"&&!previewed?" (buka preview terlebih dahulu)":""}</span></label>)}<div className="approval-actions" style={{marginTop:12}}><button className="approval-btn--cancel" onClick={onClose}>Kembali tanpa approval</button><button className="approval-btn--approve" disabled={loading||!!error||fail||!allAttested||!previewed} onClick={()=>onApprove({reviewToken:review?.reviewToken,attestations:attested,documentHash:review?.documentHash})}>{finalLabel}</button></div>{(!allAttested||!previewed)&&<div style={{fontSize:12,color:C.muted,marginTop:7}}>Buka preview lalu centang seluruh pernyataan setelah selesai memeriksa data.</div>}</section>}
      </>)}
    </div>
  </div>;
}
