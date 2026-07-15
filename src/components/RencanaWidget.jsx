// Komponen RencanaWidget — dipindah dari App.jsx (refactor Fase 4d).

export function RencanaWidget({ rencanaKedatanganList, C, sty, setTab }) {
  const today = Date.now();
  const plus30 = today + 30*24*60*60*1000;
  const upcoming = rencanaKedatanganList
    .flatMap(r=>(r.items||[]).map(item=>({...item, noKontrak:r.noKontrak, supplier:r.supplier, tanggalSerahTerima:r.tanggalSerahTerima})))
    .filter(item=>{const d=item.tanggalSerahTerima?new Date(item.tanggalSerahTerima).getTime():0; return d<=plus30;})
    .sort((a,b)=>new Date(a.tanggalSerahTerima)-new Date(b.tanggalSerahTerima));
  return (
    <div style={{...sty.card,marginBottom:16}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
        <h3 style={{fontSize:13,fontWeight:700}}>📅 Rencana Kedatangan (30 Hari)</h3>
        <button style={sty.btn("ghost","sm")} onClick={()=>setTab("rencana")}>Lihat Semua</button>
      </div>
      {upcoming.length===0 && (
        <div style={{textAlign:"center",padding:"16px 0",color:C.muted,fontSize:12}}>
          Tidak ada rencana kedatangan barang dalam 30 hari ke depan.
        </div>
      )}
      {upcoming.slice(0,5).map((item,i)=>{
        const isLate = item.tanggalSerahTerima && new Date(item.tanggalSerahTerima).getTime()<today;
        return (
          <div key={i} style={{padding:"6px 0",borderBottom:`1px solid ${C.border}`,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <div>
              <div style={{fontSize:12,fontWeight:600}}>{item.namaBarang}</div>
              <div style={{fontSize:12,color:C.muted}}>{item.supplier} • {item.jumlah} {item.satuan}</div>
            </div>
            <div style={{textAlign:"right"}}>
              <div style={{fontSize:12,fontWeight:700,color:isLate?"#dc2626":"#16a34a"}}>{item.tanggalSerahTerima||"-"}</div>
              {isLate && <div style={{fontSize:12,color:"#dc2626",fontWeight:700}}>⚠️ Terlambat</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
