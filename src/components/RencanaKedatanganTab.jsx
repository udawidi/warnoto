// Komponen RencanaKedatanganTab — dipindah dari App.jsx (refactor Fase 5a).
import { useState } from "react";
import { hasRole } from "../lib/roles.js";
import { SearchableSelect } from "./SearchableSelect.jsx";

export function RencanaKedatanganTab({ rencanaList, katalogList, currentUser, sty, C, saveRencana, deleteRencana, aiExtractKontrak }) {
  const [showForm, setShowForm] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState("");
  const [form, setForm] = useState({ id:"", noKontrak:"", tanggalKontrak:"", supplier:"", tanggalSerahTerima:"", items:[{namaBarang:"",jumlah:1,satuan:"unit",katalogId:"",keterangan:""}] });

  function newForm() {
    setForm({id:`RK-${Date.now()}`, noKontrak:"", tanggalKontrak:"", supplier:"", tanggalSerahTerima:"", items:[{namaBarang:"",jumlah:1,satuan:"unit",katalogId:"",keterangan:""}]});
    setShowForm(true); setAiError("");
  }
  function handlePdfUpload(e) {
    const f = e.target.files[0]; if(!f) return;
    const r = new FileReader();
    r.onload = ev => {
      const base64 = ev.target.result.split(",")[1];
      aiExtractKontrak(base64,
        (parsed) => {
          setForm(prev=>({
            ...prev,
            noKontrak: parsed.noKontrak||prev.noKontrak,
            tanggalKontrak: parsed.tanggalKontrak||prev.tanggalKontrak,
            supplier: parsed.supplier||prev.supplier,
            tanggalSerahTerima: parsed.tanggalSerahTerima||prev.tanggalSerahTerima,
            items: (parsed.items||[]).length>0
              ? parsed.items.map(it=>({namaBarang:it.namaBarang||"",jumlah:it.jumlah||1,satuan:it.satuan||"unit",katalogId:"",keterangan:""}))
              : prev.items
          }));
        },
        (err)=>setAiError(err),
        setAiLoading
      );
    };
    r.readAsDataURL(f);
  }
  function updateItem(i,k,v) { setForm(f=>({...f,items:f.items.map((it,idx)=>idx===i?{...it,[k]:v}:it)})); }
  function addItem() { setForm(f=>({...f,items:[...f.items,{namaBarang:"",jumlah:1,satuan:"unit",katalogId:"",keterangan:""}]})); }
  function removeItem(i) { setForm(f=>({...f,items:f.items.filter((_,idx)=>idx!==i)})); }

  const today = Date.now();
  const canEdit = hasRole(currentUser, "ADMIN","TL","PENGADAAN");

  return (
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
        <div>
          <h1 style={{fontSize:22,fontWeight:900}}>📅 Rencana Kedatangan Barang</h1>
          <p style={{color:C.muted,fontSize:13}}>Input dari surat rencana pengiriman material vendor — AI ekstrak otomatis</p>
        </div>
        {canEdit && <button style={sty.btn("primary")} onClick={newForm}>+ Input Rencana Baru</button>}
      </div>

      {/* Form input rencana kedatangan */}
      {showForm && (
        <div style={{...sty.card,marginBottom:20,borderLeft:`4px solid ${C.accent}`}}>
          <h3 style={{fontSize:15,fontWeight:800,marginBottom:12}}>Input Rencana Kedatangan</h3>
          <div style={{background:"#eff6ff",border:`1px solid #bfdbfe`,borderRadius:8,padding:10,marginBottom:14}}>
            <div style={{fontSize:12,fontWeight:700,color:"#1d4ed8",marginBottom:6}}>🤖 Upload Surat Rencana Pengiriman Material dari Vendor — AI akan ekstrak otomatis</div>
            <input type="file" accept=".pdf" onChange={handlePdfUpload} style={{fontSize:12}}/>
            {aiLoading && <div style={{fontSize:11,color:"#1d4ed8",marginTop:6}}>⏳ AI sedang membaca surat...</div>}
            {aiError && <div style={{fontSize:11,color:C.red,marginTop:6}}>❌ {aiError}</div>}
            <div style={{fontSize:10,color:C.muted,marginTop:4}}>Dokumen ini biasanya mencantumkan no. kontrak & tanggal rencana kirim/tiba barang. Setelah upload, review hasilnya di bawah dan edit jika perlu.</div>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:12}}>
            <div><label style={sty.label}>No. Kontrak</label><input style={sty.input} value={form.noKontrak} onChange={e=>setForm(f=>({...f,noKontrak:e.target.value}))}/></div>
            <div><label style={sty.label}>Supplier</label><input style={sty.input} value={form.supplier} onChange={e=>setForm(f=>({...f,supplier:e.target.value}))}/></div>
            <div><label style={sty.label}>Tanggal Kontrak</label><input type="date" style={sty.input} value={form.tanggalKontrak} onChange={e=>setForm(f=>({...f,tanggalKontrak:e.target.value}))}/></div>
            <div><label style={sty.label}>Tanggal Serah Terima / Delivery</label><input type="date" style={sty.input} value={form.tanggalSerahTerima} onChange={e=>setForm(f=>({...f,tanggalSerahTerima:e.target.value}))}/></div>
          </div>
          <div style={{fontSize:12,fontWeight:800,color:C.accent,marginBottom:8}}>Daftar Item Barang</div>
          {form.items.map((item,i)=>(
            <div key={i} style={{border:`1px solid ${C.border}`,borderRadius:8,padding:10,marginBottom:8,background:"#f9fafb"}}>
              <div style={{display:"grid",gridTemplateColumns:"2fr 1fr 1fr",gap:8,marginBottom:6}}>
                <div><label style={sty.label}>Nama Barang</label><input style={sty.input} value={item.namaBarang} onChange={e=>updateItem(i,"namaBarang",e.target.value)}/></div>
                <div><label style={sty.label}>Jumlah</label><input type="number" inputMode="decimal" min="1" style={sty.input} value={item.jumlah} onChange={e=>updateItem(i,"jumlah",Number(e.target.value))}/></div>
                <div><label style={sty.label}>Satuan</label><input style={sty.input} value={item.satuan} onChange={e=>updateItem(i,"satuan",e.target.value)}/></div>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr auto",gap:8,alignItems:"flex-end"}}>
                <div>
                  <label style={sty.label}>Link ke Master Katalog (opsional)</label>
                  <SearchableSelect
                    options={katalogList}
                    value={item.katalogId||""}
                    onChange={v=>updateItem(i,"katalogId",v)}
                    getLabel={k=>`${k.name} [${k.katalog||"-"}]`}
                    getSearchText={k=>`${k.name} ${k.katalog||""}`}
                    placeholder="-- Cari & pilih jika ada --"
                    sty={sty} C={C} isMobile={isMobile}
                  />
                </div>
                <div><label style={sty.label}>Keterangan</label><input style={sty.input} value={item.keterangan||""} onChange={e=>updateItem(i,"keterangan",e.target.value)}/></div>
                {form.items.length>1 && <button style={{...sty.btn("danger","sm"),height:36}} onClick={()=>removeItem(i)}>✕</button>}
              </div>
            </div>
          ))}
          <button style={{...sty.btn("ghost","sm"),marginBottom:14}} onClick={addItem}>+ Tambah Item</button>
          <div style={{display:"flex",gap:10}}>
            <button style={{...sty.btn("ghost"),flex:1}} onClick={()=>setShowForm(false)}>Batal</button>
            <button style={{...sty.btn("primary"),flex:2}} onClick={()=>{saveRencana(form);setShowForm(false);}}>💾 Simpan</button>
          </div>
        </div>
      )}

      {/* List Rencana */}
      {rencanaList.length===0 && !showForm && (
        <div style={{...sty.card,textAlign:"center",color:C.muted,padding:40}}>
          <div style={{fontSize:36,marginBottom:12}}>📅</div>
          <div style={{fontSize:14,fontWeight:700}}>Belum ada rencana kedatangan barang</div>
          {canEdit && <div style={{fontSize:12,marginTop:4}}>Klik "+ Input Kontrak Baru" untuk menambahkan</div>}
        </div>
      )}
      {rencanaList.slice().sort((a,b)=>new Date(a.tanggalSerahTerima)-new Date(b.tanggalSerahTerima)).map(r=>{
        const tglMs = r.tanggalSerahTerima ? new Date(r.tanggalSerahTerima).getTime() : 0;
        const isLate = tglMs > 0 && tglMs < today;
        return (
          <div key={r.id} style={{...sty.card,marginBottom:12,borderLeft:`4px solid ${isLate?C.red:C.green}`}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:8}}>
              <div>
                <div style={{fontWeight:800,fontSize:14}}>{r.noKontrak||"No Kontrak -"}</div>
                <div style={{fontSize:12,color:C.muted}}>Supplier: {r.supplier||"-"} • Kontrak: {r.tanggalKontrak||"-"}</div>
                <div style={{fontSize:12,fontWeight:700,color:isLate?C.red:C.green,marginTop:2}}>
                  📅 Serah Terima: {r.tanggalSerahTerima||"-"} {isLate && "⚠️ TERLAMBAT"}
                </div>
              </div>
              {canEdit && <button title="Hapus" style={{...sty.btn("danger","sm")}} onClick={()=>deleteRencana(r.id)}>🗑️</button>}
            </div>
            <div style={{background:"#f9fafb",borderRadius:8,padding:8}}>
              {(r.items||[]).map((item,i)=>{
                const kat = katalogList.find(k=>k.id===item.katalogId);
                return (
                  <div key={i} style={{fontSize:12,padding:"3px 0",display:"flex",justifyContent:"space-between"}}>
                    <span>📦 {item.namaBarang} <b>x{item.jumlah}</b> {item.satuan}</span>
                    {kat && <span style={{fontSize:10,color:"#0098da"}}>→ {kat.name}</span>}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
