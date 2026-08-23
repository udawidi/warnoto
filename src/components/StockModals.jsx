// Modal-modal terkait stok & dokumen (dipindah dari App.jsx, refactor batch 1).
// StockDetailModal (form tambah/edit stok), MaturityAssessmentModal (asesmen manual),
// DocPreviewModal (preview & unduh dokumen TUG).
import { useRef } from "react";
import { JENIS_BARANG, STATUS_SAP } from "../constants.js";
import { resolveStockPhotoUrl } from "../lib/stockCache.js";
import { resolveSapLabel } from "../lib/sap.js";
import { canonicalKatalogCode } from "../lib/normalizeKatalogCode.js";
import { buildTUG9HTML, buildTUG10HTML, downloadTUG10HTML, buildTUG5HTML, buildTUG7HTML, downloadTUG5HTML, buildTUG3HTML, downloadTUG3HTML, downloadTUG9HTML, downloadTUG7HTML } from "../lib/docBuilders.js";
import { SearchableSelect } from "./SearchableSelect.jsx";

// Field-field form edit Data Stok — dipakai INLINE di dalam modal detail (App.jsx,
// mode stockModal==="edit") supaya view+edit jadi SATU modal (bukan dua pop-up
// berlapis). Dulunya bagian dari StockDetailModal (form tambah+edit terpisah),
// tapi jalur "Tambah Data Stok Baru" sudah tidak ada pemanggilnya lagi — jadi ini
// murni form edit sekarang.
export function StockEditFields({ stockModal, stockForm, setStockForm, katalogList, lokasiList, setLightboxImg, handleImg, isMobile, sty, C }) {
  return (
            <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"1fr 1fr",gap:12}}>
              <div style={{gridColumn:"1/-1"}}>
                <label style={sty.label}>Barang (dari Master Katalog)</label>
                <SearchableSelect
                  options={katalogList}
                  value={stockForm.katalogId||""}
                  onChange={id=>setStockForm(sf=>({...sf,katalogId:id}))}
                  getLabel={k=>`${k.name} [${canonicalKatalogCode(k.katalog)}]`}
                  getSearchText={k=>[k.name, k.katalog, k.category, k.jenisBarang, k.keterangan].filter(Boolean).join(" ")}
                  placeholder="-- Cari nama / no katalog / kategori --"
                  sty={sty} C={C} isMobile={isMobile}
                />
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
              <div>
                <label style={sty.label}>Qty di Lokasi Ini</label>
                <input style={{...sty.input, ...(stockModal==="edit"?{background:"#f3f4f6",cursor:"not-allowed"}:{})}} type="number" inputMode="decimal" value={stockForm.qty||0} disabled={stockModal==="edit"} onChange={e=>setStockForm(sf=>({...sf,qty:Number(e.target.value)}))}/>
                {stockModal==="edit" && <div style={{fontSize:12,color: "#64748b",marginTop:4}}>Qty berubah lewat transaksi TUG, tidak diedit manual.</div>}
              </div>
              <div><label style={sty.label}>Min Qty Alert</label><input style={sty.input} type="number" inputMode="decimal" value={stockForm.minQty||0} onChange={e=>setStockForm(sf=>({...sf,minQty:Number(e.target.value)}))}/></div>
              <div>
                <label style={sty.label}>Jenis Barang</label>
                <select style={sty.select} value={stockForm.jenisBarang||"Cadang"} onChange={e=>setStockForm(sf=>({...sf,jenisBarang:e.target.value}))}>{JENIS_BARANG.map(j=><option key={j}>{j}</option>)}</select>
                {stockForm.jenisBarang==="Non-Stock" && <div style={{fontSize:12,color:"#be185d",marginTop:4}}>ℹ️ Barang khusus proyek — tidak dihitung dalam alert stok minimum</div>}
              </div>
              <div>
                <label style={sty.label}>Status Material</label>
                <select style={sty.select} value={stockForm.sapStatus||""} onChange={e=>setStockForm(sf=>({...sf,sapStatus:e.target.value}))}>
                  <option value="">Otomatis (ikuti format no. katalog)</option>
                  {STATUS_SAP.map(s=><option key={s} value={s}>{s}</option>)}
                </select>
                {!stockForm.sapStatus && (
                  <div style={{fontSize:12,color:C.muted,marginTop:4}}>
                    Otomatis → {resolveSapLabel(canonicalKatalogCode(stockForm.katalog || katalogList.find(k=>k.id===stockForm.katalogId)?.katalog), "")}
                  </div>
                )}
              </div>
              <div style={{gridColumn:"1/-1"}}>
                <label style={sty.label}>Foto Kondisi Barang (opsional)</label>
                {stockForm.img && <img src={resolveStockPhotoUrl(stockForm.img)} alt="prev" onClick={()=>setLightboxImg(resolveStockPhotoUrl(stockForm.img))} style={{width:80,height:80,objectFit:"cover",borderRadius: 10,marginBottom:6,border:`1px solid ${C.border}`,display:"block",cursor:"zoom-in"}}/>}
                <label style={{...sty.btn("ghost","sm"),display:"inline-block",cursor:"pointer"}}>
                  🔄 Update Gambar
                  <input type="file" accept="image/*" capture="environment" onChange={e=>handleImg(e, img=>setStockForm(sf=>({...sf,img})))} style={{display:"none"}}/>
                </label>
              </div>
              <div>
                <label style={sty.label}>Foto Nameplate {!stockForm.id?.startsWith("STK-SAP-") && "*"}</label>
                {stockForm.fotoNameplate && <img src={resolveStockPhotoUrl(stockForm.fotoNameplate)} alt="prev" onClick={()=>setLightboxImg(resolveStockPhotoUrl(stockForm.fotoNameplate))} style={{width:80,height:80,objectFit:"cover",borderRadius: 10,marginBottom:6,border:`1px solid ${C.border}`,display:"block",cursor:"zoom-in"}}/>}
                <label style={{...sty.btn("ghost","sm"),display:"inline-block",cursor:"pointer"}}>
                  🔄 Update Gambar
                  <input type="file" accept="image/*" capture="environment" onChange={e=>handleImg(e, img=>setStockForm(sf=>({...sf,fotoNameplate:img})))} style={{display:"none"}}/>
                </label>
              </div>
              <div>
                <label style={sty.label}>Foto Keseluruhan {!stockForm.id?.startsWith("STK-SAP-") && "*"}</label>
                {stockForm.fotoKeseluruhan && <img src={resolveStockPhotoUrl(stockForm.fotoKeseluruhan)} alt="prev" onClick={()=>setLightboxImg(resolveStockPhotoUrl(stockForm.fotoKeseluruhan))} style={{width:80,height:80,objectFit:"cover",borderRadius: 10,marginBottom:6,border:`1px solid ${C.border}`,display:"block",cursor:"zoom-in"}}/>}
                <label style={{...sty.btn("ghost","sm"),display:"inline-block",cursor:"pointer"}}>
                  🔄 Update Gambar
                  <input type="file" accept="image/*" capture="environment" onChange={e=>handleImg(e, img=>setStockForm(sf=>({...sf,fotoKeseluruhan:img})))} style={{display:"none"}}/>
                </label>
              </div>
              {stockForm.id?.startsWith("STK-SAP-") && (
                <div tabIndex={0} className="info-note" style={{gridColumn:"1/-1",fontSize:12,color:C.muted}}>ℹ️ Data hasil import SAP (PEMAT) — foto Nameplate/Keseluruhan akan disinkronkan saat import data PEMAT berikutnya, tidak wajib diisi sekarang.</div>
              )}
            </div>
  );
}

export function MaturityAssessmentModal({ setMaturityModal, maturityForm, setMaturityForm, saveMaturityAssessment, MATURITY_LEVELS, sty }) {
  return (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000,padding:16}}>
          <div style={{...sty.card,width:460,maxWidth:"100%",maxHeight:"90dvh",overflowY:"auto"}}>
            <h3 style={{fontSize:17,fontWeight:800,marginBottom:20}}>🏆 Asesmen Maturity Level Baru</h3>
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
  const iframeRef = useRef(null);
  return (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.6)",display:"flex",flexDirection:"column",zIndex:1500}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"12px 18px",background:C.sidebar,flexShrink:0}}>
            <div style={{color:"white",fontWeight:700,fontSize:13}}>📄 Dokumen {dp.docType.replace("TUG","TUG-")} — {dp.docNumbers?.[docKeyOf(dp)]||dp.draftLabel||dp.id}</div>
            <div style={{display:"flex",gap:8}}>
              <button style={{...sty.btn("success"),padding:"7px 16px"}} onClick={()=>{
                if (dp.docType==="TUG10") downloadTUG10HTML(dp, katalogList, lokasiList, users, satpamList, gudangList, subGudangList, showToast, uptList);
                else if (dp.docType==="TUG3") downloadTUG3HTML(dp, katalogList, lokasiList, timMutuList, users, satpamList, showToast, uptList);
                else if (dp.docType==="TUG5") downloadTUG5HTML(dp, katalogList, uitList, users, showToast, ultgList, uptList);
                else if (dp.docType==="TUG7") downloadTUG7HTML(dp, katalogList, uitList, uptList, users, showToast);
                else downloadTUG9HTML(dp, enrichedStocks, users, satpamList, showToast, uptList);
              }}>⬇️ Unduh File (untuk Print/PDF)</button>
              <button style={{...sty.btn("primary"),padding:"7px 16px"}} onClick={()=>iframeRef.current?.contentWindow?.print()}>🖨️ Print / Save PDF</button>
              <button style={sty.btn("danger","sm")} onClick={()=>setDocPreview(null)}>✕ Tutup</button>
            </div>
          </div>
          <div style={{flex:1,background:"#e5e7eb",overflow:"hidden"}}>
            <iframe
              ref={iframeRef}
              title="Document Preview"
              srcDoc={dp.docType==="TUG10" ? buildTUG10HTML(dp, katalogList, lokasiList, users, satpamList, gudangList, subGudangList, uptList) : dp.docType==="TUG3" ? buildTUG3HTML(dp, katalogList, lokasiList, timMutuList, users, satpamList, uptList) : dp.docType==="TUG5" ? buildTUG5HTML(dp, katalogList, uitList, users, ultgList, uptList) : dp.docType==="TUG7" ? buildTUG7HTML(dp, katalogList, uitList, uptList, users) : buildTUG9HTML(dp, enrichedStocks, users, satpamList, uptList)}
              style={{width:"100%",height:"100%",border:"none"}}
            />
          </div>
          <div tabIndex={0} className="info-note" style={{padding:"8px 18px",background:"#fef3c7",fontSize:12,color:"#92400e",flexShrink:0}}>
            💡 Tips: klik "Unduh File", buka file-nya di browser HP/laptop, lalu pilih menu Print → Save as PDF untuk dapat file PDF asli.
          </div>
        </div>
  );
}
