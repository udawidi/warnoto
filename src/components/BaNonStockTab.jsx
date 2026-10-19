import { useMemo, useState } from "react";
import { hasRole } from "../lib/roles.js";
import { BaNonStockFormModal } from "./BaNonStockFormModal.jsx";

export function BaNonStockTab({ C, sty, currentUser, records=[], onSave, onSubmit, onPreview, onReview, gudangList=[], satpamList=[], users=[], uptList=[], currentUptId, filterStatus="ALL", tugUptFilter="", isMobile }) {
  const [open,setOpen] = useState(false);
  const [query,setQuery] = useState("");
  const [page,setPage] = useState(1);
  const [pageSize,setPageSize] = useState(10);
  const [editing,setEditing] = useState(null);
  const canCreate = hasRole(currentUser,"ADMIN","TL","SUPERADMIN");
  const filtered = useMemo(() => records.filter(record =>
    (!query || JSON.stringify(record).toLowerCase().includes(query.toLowerCase())) &&
    (filterStatus === "ALL" || record.status === filterStatus) &&
    (!tugUptFilter || record.uptId === tugUptFilter)
  ), [records,query,filterStatus,tugUptFilter]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const list = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  return <div>
    <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:12}}>
      <input type="search" style={{...sty.input,flex:"1 1 240px"}} placeholder="Cari BA atau material…" value={query} onChange={event=>{setQuery(event.target.value);setPage(1)}} />
      {canCreate&&<button style={sty.btn("primary","sm")} onClick={()=>{setEditing(null);setOpen(true)}}>+ Buat BA Non Stock / Pinjam</button>}
    </div>
    {!list.length && <div style={{...sty.card,textAlign:"center",color:C.muted,padding:30}}>Belum ada BA Non Stock / Pinjam.</div>}
    {list.map(record=>{
      const uptName=uptList.find(u=>u.id===record.uptId)?.nama || record.uptId || "UPT belum diisi";
      const gudangName=gudangList.find(g=>g.id===record.gudangId)?.nama || record.gudangId || "Gudang belum diisi";
      const approver=users.find(user=>user.id===(record.status === "REJECTED" ? record.rejectedBy : record.approvedBy))?.name;
      const terminal=["APPROVED","REJECTED"].includes(record.status);
      return <div key={record.id} style={{...sty.card,marginBottom:10}}>
      <div style={{display:"flex",justifyContent:"space-between",gap:8,flexWrap:"wrap"}}><strong>{record.docNumber || "Belum bernomor"} · {record.jenis === "PINJAM" ? "Pinjam" : "Non Stock"}</strong><span style={sty.statusBadge(record.status)}>{record.status === "PENDING" ? "Menunggu TL" : record.status}</span></div>
      <div style={{fontSize:12,color:C.muted,marginTop:5}}>{uptName} · {gudangName} · {record.tanggal || "-"}</div>
      <div style={{fontSize:12,color:C.muted,marginTop:3}}>Pengaju: {users.find(user=>user.id===record.createdBy)?.name || record.createdBy || "-"} · Penerima: {record.penerimaNama || "-"} · {record.items?.length || 0} material</div>
      {terminal && <div style={{fontSize:12,color:C.muted,marginTop:3}}>{approver ? `Diputus oleh: ${approver}` : "Belum ada approver"}</div>}
      {record.rejectionReason && <div style={{fontSize:12,color:C.red,marginTop:5}}>Alasan penolakan: {record.rejectionReason}</div>}
      <div style={{display:"flex",gap:8,marginTop:8,flexWrap:"wrap"}}>
        <button style={sty.btn("ghost","sm")} onClick={()=>onPreview?.(record)}>Pratinjau</button>
        <button style={sty.btn("ghost","sm")} onClick={()=>onPreview?.(record)}>🖨️ Print BA</button>
        {terminal && <button style={sty.btn("ghost","sm")} onClick={()=>onReview?.(record)}>Buka detail</button>}
        {canCreate && ["DRAFT","REJECTED"].includes(record.status) && (record.createdBy===currentUser?.id || hasRole(currentUser,"SUPERADMIN")) && <button style={sty.btn("ghost","sm")} onClick={()=>{setEditing(record);setOpen(true)}}>Edit</button>}
        {hasRole(currentUser,"TL","SUPERADMIN") && record.stage === "PENDING_TL" && <button className="approval-btn--approve" onClick={()=>onReview?.(record)}>Periksa &amp; Setujui</button>}
      </div>
    </div>})}
    {filtered.length>0 && <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:8,flexWrap:"wrap",fontSize:12,color:C.muted}}><span>Tampilkan <select style={{...sty.select,width:"auto",minHeight:"unset",paddingTop:4,paddingBottom:4,paddingLeft:8,paddingRight:8,fontSize:12}} value={pageSize} onChange={e=>{setPageSize(Number(e.target.value));setPage(1)}}>{[10,20,50].map(n=><option key={n} value={n}>{n}</option>)}</select> item · {filtered.length} total</span><span><button style={sty.btn("ghost","sm")} disabled={currentPage<=1} onClick={()=>setPage(value=>value-1)}>← Sebelumnya</button> <span style={{padding:"0 8px"}}>Halaman {currentPage}/{totalPages}</span><button style={sty.btn("ghost","sm")} disabled={currentPage>=totalPages} onClick={()=>setPage(value=>value+1)}>Berikutnya →</button></span></div>}
    {open&&<BaNonStockFormModal C={C} sty={sty} currentUser={currentUser} initialValue={editing} onClose={()=>setOpen(false)} onSave={onSave} onSubmit={onSubmit} gudangList={gudangList} satpamList={satpamList} users={users} uptList={uptList} currentUptId={currentUptId} isMobile={isMobile} />}
  </div>;
}
