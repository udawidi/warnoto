// Modal-modal terkait stok & dokumen (dipindah dari App.jsx, refactor batch 1).
// StockDetailModal (form tambah/edit stok), MaturityAssessmentModal (asesmen manual),
// DocPreviewModal (preview & unduh dokumen TUG).
import { JENIS_BARANG } from "../constants.js";
import { resolveStockPhotoUrl } from "../lib/stockCache.js";
import { buildTUG9HTML, buildTUG10HTML, downloadTUG10HTML, buildTUG5HTML, buildTUG7HTML, downloadTUG5HTML, buildTUG3HTML, downloadTUG3HTML, downloadTUG9HTML, downloadTUG7HTML } from "../lib/docBuilders.js";

export function StockDetailModal({ stockModal, setStockModal, stockForm, setStockForm, katalogList, lokasiList, setLightboxImg, handleImg, saveStock, isMobile, sty, C }) {
  return (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000,padding:16}}>
          <div style={{...sty.card,width:520,maxWidth:"100%",maxHeight:"90dvh",overflowY:"auto"}}>
            <div style={sty.modalHeader}><span style={{fontWeight:800,fontSize:15}}>{stockModal==="edit"?"Edit Data Stok":"Tambah Data Stok Baru"}</span><button onClick={()=>setStockModal(null)} style={{background:"transparent",border:"none",color:"white",fontSize:24,lineHeight:1,cursor:"pointer",padding:0,opacity:0.85}}>×</button></div>
            <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"1fr 1fr",gap:12}}>
              <div style={{gridColumn:"1/-1"}}>
                <label style={sty.label}>Barang (dari Master Katalog)</label>
                <select style={sty.select} value={stockForm.katalogId||""} onChange={e=>setStockForm(sf=>({...sf,katalogId:e.target.value}))}>
                  <option value="">-- Pilih Barang --</option>
                  {katalogList.map(k=><option key={k.id} value={k.id}>{k.name} [{k.katalog}]</option>)}
                </select>
                {katalogList.length===0 && <div style={{fontSize:12,color:"#be185d",marginTop:4}}>Belum ada Master Katalog. Tambahkan dulu di tab "Master Katalog".</div>}
              </div>
              <div style={{gridColumn:"1/-1"}}>
                <label style={sty.label}>Lokasi (dari Master Lokasi)</label>
                <select style={sty.select} value={stockForm.lokasiId||""} onChange={e=>setStockForm(sf=>({...sf,lokasiId:e.target.value}))}>
                  <option value="">-- Pilih Lokasi --</option>
                  {lokasiList.map(l=><option key={l.id} value={l.id}>{l.kode} {l.keterangan ? `— ${l.keterangan}` : ""}</option>)}
                </select>
                {lokasiList.length===0 && <div style={{fontSize:12,color:"#be185d",marginTop:4}}>Belum ada Blok Lokasi. Tambahkan dulu di Master Data → Master Gudang.</div>}
              </div>
              <div><label style={sty.label}>Harga Satuan (Rp)</label><input style={sty.input} type="number" inputMode="decimal" value={stockForm.price||0} onChange={e=>setStockForm(sf=>({...sf,price:Number(e.target.value)}))}/></div>
              <div><label style={sty.label}>Qty di Lokasi Ini</label><input style={sty.input} type="number" inputMode="decimal" value={stockForm.qty||0} onChange={e=>setStockForm(sf=>({...sf,qty:Number(e.target.value)}))}/></div>
              <div><label style={sty.label}>Min Qty Alert</label><input style={sty.input} type="number" inputMode="decimal" value={stockForm.minQty||0} onChange={e=>setStockForm(sf=>({...sf,minQty:Number(e.target.value)}))}/></div>
              <div>
                <label style={sty.label}>Jenis Barang</label>
                <select style={sty.select} value={stockForm.jenisBarang||"Cadang"} onChange={e=>setStockForm(sf=>({...sf,jenisBarang:e.target.value}))}>{JENIS_BARANG.map(j=><option key={j}>{j}</option>)}</select>
                {stockForm.jenisBarang==="Non-Stock" && <div style={{fontSize:12,color:"#be185d",marginTop:4}}>ℹ️ Barang khusus proyek — tidak dihitung dalam alert stok minimum</div>}
              </div>
              <div style={{gridColumn:"1/-1"}}>
                <label style={sty.label}>Foto Kondisi Barang (opsional)</label>
                {stockForm.img && <img src={resolveStockPhotoUrl(stockForm.img)} alt="prev" onClick={()=>setLightboxImg(resolveStockPhotoUrl(stockForm.img))} style={{width:80,height:80,objectFit:"cover",borderRadius:8,marginBottom:6,border:`1px solid ${C.border}`,display:"block",cursor:"zoom-in"}}/>}
                <label style={{...sty.btn("ghost","sm"),display:"inline-block",cursor:"pointer"}}>
                  🔄 Update Gambar
                  <input type="file" accept="image/*" capture="environment" onChange={e=>handleImg(e, img=>setStockForm(sf=>({...sf,img})))} style={{display:"none"}}/>
                </label>
              </div>
              <div>
                <label style={sty.label}>Foto Nameplate {!stockForm.id?.startsWith("STK-SAP-") && "*"}</label>
                {stockForm.fotoNameplate && <img src={resolveStockPhotoUrl(stockForm.fotoNameplate)} alt="prev" onClick={()=>setLightboxImg(resolveStockPhotoUrl(stockForm.fotoNameplate))} style={{width:80,height:80,objectFit:"cover",borderRadius:8,marginBottom:6,border:`1px solid ${C.border}`,display:"block",cursor:"zoom-in"}}/>}
                <label style={{...sty.btn("ghost","sm"),display:"inline-block",cursor:"pointer"}}>
                  🔄 Update Gambar
                  <input type="file" accept="image/*" capture="environment" onChange={e=>handleImg(e, img=>setStockForm(sf=>({...sf,fotoNameplate:img})))} style={{display:"none"}}/>
                </label>
              </div>
              <div>
                <label style={sty.label}>Foto Keseluruhan {!stockForm.id?.startsWith("STK-SAP-") && "*"}</label>
                {stockForm.fotoKeseluruhan && <img src={resolveStockPhotoUrl(stockForm.fotoKeseluruhan)} alt="prev" onClick={()=>setLightboxImg(resolveStockPhotoUrl(stockForm.fotoKeseluruhan))} style={{width:80,height:80,objectFit:"cover",borderRadius:8,marginBottom:6,border:`1px solid ${C.border}`,display:"block",cursor:"zoom-in"}}/>}
                <label style={{...sty.btn("ghost","sm"),display:"inline-block",cursor:"pointer"}}>
                  🔄 Update Gambar
                  <input type="file" accept="image/*" capture="environment" onChange={e=>handleImg(e, img=>setStockForm(sf=>({...sf,fotoKeseluruhan:img})))} style={{display:"none"}}/>
                </label>
              </div>
              {stockForm.id?.startsWith("STK-SAP-") && (
                <div style={{gridColumn:"1/-1",fontSize:12,color:C.muted}}>ℹ️ Data hasil import SAP (PEMAT) — foto Nameplate/Keseluruhan akan disinkronkan saat import data PEMAT berikutnya, tidak wajib diisi sekarang.</div>
              )}
            </div>
            <div style={sty.stickyFooter}>
              <button style={{...sty.btn("ghost"),flex:1}} onClick={()=>setStockModal(null)}>Batal</button>
              <button style={{...sty.btn("primary"),flex:2}} onClick={saveStock}>💾 Simpan ke Cloud</button>
            </div>
          </div>
        </div>
  );
}

export function MaturityAssessmentModal({ setMaturityModal, maturityForm, setMaturityForm, saveMaturityAssessment, MATURITY_LEVELS, sty }) {
  return (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000,padding:16}}>
          <div style={{...sty.card,width:460,maxWidth:"100%",maxHeight:"90dvh",overflowY:"auto"}}>
            <h3 style={{fontSize:18,fontWeight:800,marginBottom:20}}>🏆 Asesmen Maturity Level Baru</h3>
            <div style={{marginBottom:12}}>
              <label style={sty.label}>Level (1-5)</label>
              <select style={sty.select} value={maturityForm.level} onChange={e=>setMaturityForm(f=>({...f,level:Number(e.target.value)}))}>
                {[1,2,3,4,5].map(lv=><option key={lv} value={lv}>Level {lv} — {MATURITY_LEVELS[lv]}</option>)}
              </select>
            </div>
            <div style={{marginBottom:12}}>
              <label style={sty.label}>Tanggal Asesmen</label>
              <input style={sty.input} type="date" value={new Date(maturityForm.tanggalAsesmen).toISOString().slice(0,10)} onChange={e=>setMaturityForm(f=>({...f,tanggalAsesmen:new Date(e.target.value).getTime()}))}/>
            </div>
            <div style={{marginBottom:16}}>
              <label style={sty.label}>Catatan (opsional)</label>
              <textarea style={{...sty.input,minHeight:70}} value={maturityForm.catatan} onChange={e=>setMaturityForm(f=>({...f,catatan:e.target.value}))} placeholder="cth: Hasil audit internal triwulan II"/>
            </div>
            <div style={{display:"flex",gap:10}}>
              <button style={{...sty.btn("ghost"),flex:1}} onClick={()=>setMaturityModal(false)}>Batal</button>
              <button style={{...sty.btn("primary"),flex:2}} onClick={async()=>{if (await saveMaturityAssessment(maturityForm) !== false) setMaturityModal(false);}}>💾 Simpan</button>
            </div>
          </div>
        </div>
  );
}

export function DocPreviewModal({ docPreview, setDocPreview, docPreviewDoc, docKeyOf, katalogList, lokasiList, users, satpamList, gudangList, subGudangList, timMutuList, uitList, uptList, ultgList, enrichedStocks, showToast, sty, C }) {
  // dp = transaksi dgn SIM/KTP privat sudah jadi signed URL (foto lain sudah
  // URL publik). Fallback ke docPreview mentah selama resolusi berjalan.
  const dp = docPreviewDoc || docPreview;
  return (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.6)",display:"flex",flexDirection:"column",zIndex:1500}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"12px 18px",background:C.sidebar,flexShrink:0}}>
            <div style={{color:"white",fontWeight:700,fontSize:14}}>📄 Dokumen {dp.docType.replace("TUG","TUG-")} — {dp.docNumbers?.[docKeyOf(dp)]||dp.id}</div>
            <div style={{display:"flex",gap:8}}>
              <button style={{...sty.btn("success"),padding:"7px 16px"}} onClick={()=>{
                if (dp.docType==="TUG10") downloadTUG10HTML(dp, katalogList, lokasiList, users, satpamList, gudangList, subGudangList, showToast);
                else if (dp.docType==="TUG3") downloadTUG3HTML(dp, katalogList, lokasiList, timMutuList, users, showToast);
                else if (dp.docType==="TUG5") downloadTUG5HTML(dp, katalogList, uitList, users, showToast, ultgList);
                else if (dp.docType==="TUG7") downloadTUG7HTML(dp, katalogList, uitList, uptList, users, showToast);
                else downloadTUG9HTML(dp, enrichedStocks, users, satpamList, showToast);
              }}>⬇️ Unduh File (untuk Print/PDF)</button>
              <button style={{background:"#dc2626",color:"white",border:"none",borderRadius:8,padding:"7px 16px",cursor:"pointer",fontSize:13,fontWeight:600}} onClick={()=>setDocPreview(null)}>✕ Tutup</button>
            </div>
          </div>
          <div style={{flex:1,background:"#e5e7eb",overflow:"hidden"}}>
            <iframe
              title="Document Preview"
              srcDoc={dp.docType==="TUG10" ? buildTUG10HTML(dp, katalogList, lokasiList, users, satpamList, gudangList, subGudangList) : dp.docType==="TUG3" ? buildTUG3HTML(dp, katalogList, lokasiList, timMutuList, users) : dp.docType==="TUG5" ? buildTUG5HTML(dp, katalogList, uitList, users, ultgList) : dp.docType==="TUG7" ? buildTUG7HTML(dp, katalogList, uitList, uptList, users) : buildTUG9HTML(dp, enrichedStocks, users, satpamList)}
              style={{width:"100%",height:"100%",border:"none"}}
            />
          </div>
          <div style={{padding:"8px 18px",background:"#fef3c7",fontSize:12,color:"#92400e",flexShrink:0}}>
            💡 Tips: klik "Unduh File", buka file-nya di browser HP/laptop, lalu pilih menu Print → Save as PDF untuk dapat file PDF asli.
          </div>
        </div>
  );
}
