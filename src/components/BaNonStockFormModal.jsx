import { useMemo, useState } from "react";
import { hasRole } from "../lib/roles.js";
import { validateBaNonStockPhoto } from "../lib/baNonStockSync.js";
import { PhotoSlot } from "./PhotoSlot.jsx";

const emptyItem = () => ({ nama:"", qty:"", satuan:"", keterangan:"" });

export function BaNonStockFormModal({ C, sty, currentUser, initialValue, onClose, onSave, onSubmit, gudangList=[], satpamList=[], users=[], uptList=[], currentUptId, isMobile=false }) {
  const [form,setForm]=useState(()=>({jenis:"NON_STOCK",tanggal:new Date().toISOString().slice(0,10),gudangId:"",satpamId:"",penerimaNama:"",penerimaJabatan:"",penerimaUnit:"",sumber:"",tujuan:"",referensi:"",keperluan:"",items:[emptyItem()],foto1:null,foto2:null,...(initialValue||{})}));
  const [busy,setBusy]=useState(false);
  const set=(key,value)=>setForm(v=>({...v,[key]:value}));
  const updateItem=(i,key,value)=>set("items",form.items.map((item,index)=>index===i?{...item,[key]:value}:item));
  const selectedUptId=hasRole(currentUser,"SUPERADMIN") ? (form.uptId||"") : (currentUptId||"");
  const uptId=hasRole(currentUser,"SUPERADMIN")
    ? selectedUptId
    : (currentUptId||"");
  const warehouses=useMemo(()=>gudangList.filter(item=>(selectedUptId ? (item.uptId||item.upt_id)===selectedUptId : !hasRole(currentUser,"SUPERADMIN"))),[gudangList,selectedUptId,currentUser]);
  const guards=satpamList.filter(item=>!form.gudangId||item.gudangId===form.gudangId);
  const teamLeaders=users.filter(user=>user.role==="TL"&&(!uptId||user.uptId===uptId||user.upt_id===uptId));
  const handleEvidence=(event,setter)=>{const file=event.target.files?.[0];if(!file)return;const error=validateBaNonStockPhoto(file);if(error){alert(error);event.target.value="";return;}setter(file);};
  async function save(submit){
    if(!uptId)return alert("Pilih UPT terlebih dahulu.");
    const items=form.items.filter(item=>item.nama.trim()||item.qty||item.satuan.trim()||item.keterangan.trim());
    if(submit&&(!items.length||items.some(item=>!item.nama.trim()||!(Number(item.qty)>0)||!item.satuan.trim())))return alert("Lengkapi nama, qty, dan satuan setiap material.");
    if(submit&&(!form.gudangId||!form.satpamId||!form.penerimaNama.trim()||!form.penerimaJabatan.trim()||!form.penerimaUnit.trim()||!form.sumber.trim()||!form.tujuan.trim()||!form.referensi.trim()||!form.keperluan.trim()||!form.foto1||!form.foto2))return alert("Lengkapi seluruh identitas, gudang, satpam, referensi, dan dua foto.");
    setBusy(true);try{const saved=await onSave?.({...form,uptId,items});if(!saved)return;if(submit){const submitted=await onSubmit?.(saved);if(!submitted)return;}onClose();}finally{setBusy(false);}
  }
  const field=(label,control,key)=><div key={key}><label style={sty.label}>{label}</label>{control}</div>;
  const section=(title,children)=><section style={{marginBottom:16}}><div style={{fontSize:12,fontWeight:800,color:C.accent,marginBottom:9,borderBottom:`1px solid ${C.border}`,paddingBottom:5}}>{title}</div>{children}</section>;
  const grid={display:"grid",gridTemplateColumns:isMobile?"1fr":"1fr 1fr",gap:12};
  return <div role="dialog" aria-modal="true" aria-label="Form BA Non Stock" style={{position:"fixed",inset:0,zIndex:1000,background:"rgba(0,0,0,.5)",display:"flex",alignItems:"center",justifyContent:"center",padding:isMobile?10:20}}>
    <div style={{...sty.card,width:680,maxWidth:"100%",maxHeight:"90dvh",overflowY:"auto"}}>
      <div style={sty.modalHeader}><span style={{fontWeight:800,fontSize:15}}>BA Pengeluaran Material Non Stock / Pinjam</span><div style={{display:"flex",alignItems:"center",gap:12,flexShrink:0}}><span style={{fontSize:12,fontWeight:700,color:"white",background:"rgba(255,255,255,.18)",borderRadius:10,padding:"3px 9px",whiteSpace:"nowrap"}}>{initialValue?.docNumber||"Nomor saat diajukan"}</span><button type="button" onClick={onClose} aria-label="Tutup" style={{background:"transparent",border:0,color:"white",fontSize:24,lineHeight:1,cursor:"pointer",padding:0}}>×</button></div></div>
      <div>
        <div style={{background:"#fef3c7",border:"1px solid #f59e0b",borderRadius:10,padding:"9px 12px",fontSize:12,color:"#92400e",marginBottom:16}}>Material diinput manual dan tidak mengurangi Data Stok. Pengajuan menunggu persetujuan Team Leader.</div>
        {section("DATA BERITA ACARA",<div style={grid}>
          {field("Jenis BA",<select style={sty.select} value={form.jenis} onChange={e=>set("jenis",e.target.value)}><option value="NON_STOCK">Non Stock</option><option value="PINJAM">Pinjam</option></select>)}
          {field("Tanggal",<input type="date" style={sty.input} value={form.tanggal||""} onChange={e=>set("tanggal",e.target.value)}/>)}
          {hasRole(currentUser,"SUPERADMIN") && field("UPT",<select style={sty.select} value={selectedUptId} onChange={e=>setForm(v=>({...v,uptId:e.target.value,gudangId:"",satpamId:""}))}><option value="">Pilih UPT terlebih dahulu</option>{uptList.map(item=><option key={item.id} value={item.id}>{item.nama||item.name||item.data?.nama||item.id}</option>)}</select>)}
          {field("Gudang",<select style={sty.select} value={form.gudangId||""} disabled={hasRole(currentUser,"SUPERADMIN")&&!selectedUptId} onChange={e=>setForm(v=>({...v,gudangId:e.target.value,satpamId:""}))}><option value="">Pilih gudang</option>{warehouses.map(item=><option key={item.id} value={item.id}>{item.nama||item.name||item.data?.nama||item.id}</option>)}</select>)}
          {field("Satpam",<select style={sty.select} value={form.satpamId||""} disabled={!form.gudangId} onChange={e=>set("satpamId",e.target.value)}><option value="">Pilih satpam</option>{guards.map(item=><option key={item.id} value={item.id}>{item.name||item.nama||item.id}</option>)}</select>)}
          {field("Sumber / Pengirim",<input style={sty.input} value={form.sumber||""} onChange={e=>set("sumber",e.target.value)}/>)}{field("Unit Tujuan",<input style={sty.input} value={form.tujuan||""} onChange={e=>set("tujuan",e.target.value)}/>)}
          {field("Dokumen Referensi",<input style={sty.input} value={form.referensi||""} onChange={e=>set("referensi",e.target.value)}/>)}{field("Keperluan",<input style={sty.input} value={form.keperluan||""} onChange={e=>set("keperluan",e.target.value)}/>)}
        </div>)}
        {section("DATA PENERIMA",<div style={grid}>
          {field("Penerima Material",<input style={sty.input} value={form.penerimaNama||""} onChange={e=>set("penerimaNama",e.target.value)}/>)}{field("Jabatan Penerima",<input style={sty.input} value={form.penerimaJabatan||""} onChange={e=>set("penerimaJabatan",e.target.value)}/>)}
          {field("Unit / Perusahaan Penerima",<input style={sty.input} value={form.penerimaUnit||""} onChange={e=>set("penerimaUnit",e.target.value)}/>)}{field("Team Leader",<input style={{...sty.input,opacity:.82}} readOnly value={teamLeaders.map(user=>user.name).join(", ")||"Diisi saat approval"}/>)}
        </div>)}
        {section(`MATERIAL NON STOCK / PINJAM (${form.items.length})`,<><div>{form.items.map((item,index)=><div key={index} style={{border:`1px solid ${C.border}`,borderRadius:10,padding:10,marginBottom:8,background:C.surface}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}><span style={{fontSize:12,fontWeight:800,color:C.muted}}>MATERIAL {index+1}</span><button type="button" style={{...sty.btn("danger","sm"),padding:"3px 8px"}} onClick={()=>set("items",form.items.length===1?[emptyItem()]:form.items.filter((_,i)=>i!==index))} aria-label="Hapus material">×</button></div>
          <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"2fr 1fr 1fr",gap:8}}>{[["nama","Nama material"],["qty","Qty"],["satuan","Satuan"]].map(([key,label])=>field(label,<input aria-label={label} style={sty.input} type={key==="qty"?"number":"text"} min={key==="qty"?"0.01":undefined} step={key==="qty"?"any":undefined} value={item[key]} onChange={e=>updateItem(index,key,e.target.value)}/>,key))}</div>
          <div style={{marginTop:8}}>{field("Keterangan",<input aria-label="Keterangan" style={sty.input} value={item.keterangan} onChange={e=>updateItem(index,"keterangan",e.target.value)}/>)}</div>
        </div>)}</div><button type="button" style={sty.btn("ghost","sm")} onClick={()=>set("items",[...form.items,emptyItem()])}>+ Tambah Material</button></>)}
        {section("EVIDEN FOTO",<div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"1fr 1fr",gap:12}}>
          <PhotoSlot label="Foto label / packing list" required value={form.foto1} onChange={img=>set("foto1",img)} onRemove={()=>set("foto1",null)} handleImg={handleEvidence} sty={sty} C={C}/><PhotoSlot label="Foto material sudah dimuat" required value={form.foto2} onChange={img=>set("foto2",img)} onRemove={()=>set("foto2",null)} handleImg={handleEvidence} sty={sty} C={C}/>
        </div>)}
      </div>
      <div style={{...sty.stickyFooter,position:"sticky",bottom:0,zIndex:1}}><button type="button" disabled={busy} style={{...sty.btn("ghost"),background:C.bg,color:C.text,border:`1px solid ${C.border}`,flex:1}} onClick={onClose}>Batal</button><button type="button" disabled={busy} style={{...sty.btn("ghost"),background:C.bg,color:C.text,border:`1px solid ${C.border}`,flex:1}} onClick={()=>save(false)}>Simpan Draft</button><button type="button" disabled={busy||!hasRole(currentUser,"ADMIN","TL","SUPERADMIN")} style={{...sty.btn("primary"),flex:1}} onClick={()=>save(true)}>{busy?"Menyimpan...":"Ajukan ke TL"}</button></div>
    </div>
  </div>;
}
