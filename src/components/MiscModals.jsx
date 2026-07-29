// Kumpulan modal/popup kecil — dipindah dari App.jsx (refactor batch 2g).
// Murni relokasi JSX; tidak ada perubahan tampilan/teks/logic. State & handler
// tetap hidup di App.jsx dan diteruskan sebagai props.
import { ArrowsClockwise, Camera, IdentificationCard, MagnifyingGlass } from "@phosphor-icons/react";

// USULAN BLOK DARI DENAH — popup terpusat (guard hasRole/ocr tetap di App.jsx).
export function OcrSuggestGudangModal({ ocrSuggestGudangId, ocrSuggestSubGudangId, ocrSuggestions, updateOcrSuggestion, removeOcrSuggestion, dismissOcrSuggestions, confirmOcrSuggestions, isMobile, sty, C }) {
  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1100}}>
      <div style={{...sty.card,width:520,maxWidth:"100%",maxHeight:"85dvh",overflowY:"auto"}}>
        <h3 style={{fontSize:18,fontWeight:800,marginBottom:6}}>📋 Usulan Blok dari Denah {ocrSuggestSubGudangId?"(Sub Gudang)":"(Gudang)"} ({ocrSuggestions.length})</h3>
        <p style={{fontSize:12,color:C.muted,marginBottom:16}}>Lengkapi data tiap usulan, lalu konfirmasi untuk mengirim ke approval TL.</p>
        <div style={{display:"flex",flexDirection:"column",gap:12,marginBottom:16}}>
          {ocrSuggestions.map(s=>(
            <div key={s.id} style={{border:`1px solid ${C.border}`,borderRadius:8,padding:12,background:s.checked?"#fefce8":"#f9fafb"}}>
              <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}>
                <input type="checkbox" checked={s.checked} onChange={e=>updateOcrSuggestion(s.id,{checked:e.target.checked})}/>
                <span style={{fontSize:12,color:C.muted}}>Posisi: {s.xPct}%, {s.yPct}%</span>
                <button style={{...sty.btn("danger","sm"),marginLeft:"auto"}} onClick={()=>removeOcrSuggestion(s.id)}>🗑️ Hapus</button>
              </div>
              <div style={{marginBottom:8}}>
                <label style={sty.label}>Nama Area <span style={{color:C.red}}>*wajib</span></label>
                <input style={sty.input} value={s.kode} placeholder="cth: Rak A-1" onChange={e=>updateOcrSuggestion(s.id,{kode:e.target.value})}/>
              </div>
              <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"1fr 1fr",gap:8}}>
                <div>
                  <label style={sty.label}>Jenis Area Penyimpanan</label>
                  <select style={sty.select} value={s.jenisArea||"Rak Tertutup"} onChange={e=>updateOcrSuggestion(s.id,{jenisArea:e.target.value})}>
                    <option value="Rak Tertutup">Rak Tertutup</option>
                    <option value="Rak Terbuka">Rak Terbuka</option>
                    <option value="Lapangan Terbuka">Lapangan Terbuka</option>
                    <option value="Gudang Tertutup">Gudang Tertutup</option>
                    <option value="Container">Container</option>
                    <option value="Lainnya">Lainnya</option>
                  </select>
                </div>
                <div>
                  <label style={sty.label}>Luasan (m²)</label>
                  <input style={sty.input} type="number" inputMode="decimal" value={s.luasan||""} placeholder="cth: 12" onChange={e=>updateOcrSuggestion(s.id,{luasan:e.target.value})}/>
                </div>
              </div>
            </div>
          ))}
        </div>
        <div style={{display:"flex",gap:10}}>
          <button style={{...sty.btn("ghost"),flex:1}} onClick={dismissOcrSuggestions}>Lewati Semua</button>
          <button style={{...sty.btn("primary"),flex:2}} onClick={()=>confirmOcrSuggestions(ocrSuggestGudangId, ocrSuggestSubGudangId)}>✓ Konfirmasi & Tambahkan Blok Terpilih</button>
        </div>
      </div>
    </div>
  );
}

// KONFIRMASI HAPUS BLOK GUDANG
export function LokasiDeleteConfirmModal({ lokasiDeleteConfirm, setLokasiDeleteConfirm, gudangList, stocks, confirmDeleteLokasi, sty, C }) {
  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.55)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1100,padding:16}} onClick={()=>setLokasiDeleteConfirm(null)}>
      <div style={{...sty.card,width:380,maxWidth:"100%",textAlign:"center",boxShadow:"0 20px 50px rgba(0,0,0,0.3)"}} onClick={e=>e.stopPropagation()}>
        <div style={{width:56,height:56,borderRadius:"50%",background:"#fee2e2",display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 14px",fontSize:26}}>🗑️</div>
        <h3 style={{fontSize:16,fontWeight:800,marginBottom:6}}>Hapus Blok Gudang?</h3>
        <div style={{fontSize:13,color:C.muted,marginBottom:14,lineHeight:1.5}}>
          Apakah Anda yakin ingin menghapus blok gudang <b style={{color:C.text}}>{lokasiDeleteConfirm.kode}</b>
          {lokasiDeleteConfirm.keterangan ? <> ({lokasiDeleteConfirm.keterangan})</> : null}
          {" "}pada Gudang <b style={{color:C.text}}>{gudangList.find(g=>g.id===lokasiDeleteConfirm.gudangId)?.nama||"-"}</b>?
        </div>
        <div style={{fontSize:12,color:"#92400e",background:"#fef3c7",border:"1px solid #fcd34d",borderRadius:8,padding:"8px 12px",marginBottom:20}}>
          ⚠️ Tindakan ini tidak bisa dibatalkan dan ada {stocks.filter(s=>s.lokasiId===lokasiDeleteConfirm.id).length} material terdaftar di blok ini.
        </div>
        <div style={{display:"flex",gap:10}}>
          <button style={{...sty.btn("ghost"),flex:1}} onClick={()=>setLokasiDeleteConfirm(null)}>Batal</button>
          <button style={{...sty.btn("danger"),flex:1}} onClick={confirmDeleteLokasi}>🗑️ Ya, Hapus</button>
        </div>
      </div>
    </div>
  );
}

// KONFIRMASI HAPUS — GENERIK (dipakai luas via askConfirmDelete). Logic tetap di App.jsx.
export function ConfirmDialogModal({ confirmDialog, setConfirmDialog, sty, C }) {
  const isWarning = confirmDialog.variant === "warning";
  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.55)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1100,padding:16}} onClick={()=>setConfirmDialog(null)}>
      <div style={{...sty.card,width:380,maxWidth:"100%",textAlign:"center",boxShadow:"0 20px 50px rgba(0,0,0,0.3)"}} onClick={e=>e.stopPropagation()}>
        <div style={{width:56,height:56,borderRadius:"50%",background:isWarning?"#fef3c7":"#fee2e2",display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 14px",fontSize:26}}>{isWarning?"⚠️":"🗑️"}</div>
        <h3 style={{fontSize:16,fontWeight:800,marginBottom:6}}>{confirmDialog.title}</h3>
        <div style={{fontSize:13,color:C.muted,marginBottom:14,lineHeight:1.5}}>{confirmDialog.message}</div>
        {confirmDialog.warning && (
          <div style={{fontSize:12,color:"#92400e",background:"#fef3c7",border:"1px solid #fcd34d",borderRadius:8,padding:"8px 12px",marginBottom:20}}>
            ⚠️ {confirmDialog.warning}
          </div>
        )}
        <div style={{display:"flex",gap:10}}>
          {!isWarning && <button style={{...sty.btn("ghost"),flex:1}} onClick={()=>setConfirmDialog(null)}>Batal</button>}
          <button style={{...sty.btn(isWarning?"primary":"danger"),flex:1}} onClick={()=>{ const fn=confirmDialog.onConfirm; setConfirmDialog(null); fn?.(); }}>{confirmDialog.confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}

// CARI DENGAN FOTO — modal upload foto query untuk visual search Data Stok
export function PhotoSearchModal({ photoSearchOpen, photoSearchLoading, setPhotoSearchOpen, photoSearchMode, setPhotoSearchMode, photoSearchImg, setPhotoSearchImg, handleImg, runPhotoSearch, sty, C }) {
  const searchModes = [
    { m:"bentuk", Icon:MagnifyingGlass, label:"Bentuk Barang" },
    { m:"nameplate", Icon:IdentificationCard, label:"Foto Nameplate" },
  ];
  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000,padding:16}} onClick={()=>!photoSearchLoading&&setPhotoSearchOpen(false)}>
      <div style={{...sty.card,width:420,maxWidth:"100%",maxHeight:"90dvh",overflowY:"auto"}} onClick={e=>e.stopPropagation()}>
        <div style={{display:"flex",alignItems:"center",gap:7,fontWeight:800,fontSize:16,marginBottom:6}}><Camera size={20} weight="bold" aria-hidden="true" /> Cari Barang dengan Foto</div>
        {/* Pilih cara mencari: kemiripan bentuk visual (Cohere) atau baca teks nameplate (OCR.space) */}
        <div style={{display:"flex",gap:8,marginBottom:10}}>
          {searchModes.map(({ m, Icon, label })=>(
            <button key={m} type="button" disabled={photoSearchLoading}
              onClick={()=>setPhotoSearchMode(m)}
              style={{display:"inline-flex",minHeight:44,alignItems:"center",justifyContent:"center",gap:5,flex:1,padding:"8px 6px",borderRadius:8,border:`2px solid ${photoSearchMode===m?C.accent:C.border}`,background:photoSearchMode===m?"#eff6ff":"white",color:photoSearchMode===m?C.accent:C.muted,cursor:"pointer",fontWeight:700,fontSize:12}}>
              <Icon size={17} weight="bold" aria-hidden="true" /> {label}
            </button>
          ))}
        </div>
        <p style={{fontSize:12,color:C.muted,marginBottom:12}}>
          {photoSearchMode==="nameplate"
            ? "Foto papan nama/label barang — sistem membaca teksnya (nomor katalog, type, merk) lalu mencocokkan ke Master Katalog & ke foto nameplate yang sudah di-upload di Data Stok."
            : "Ambil/unggah foto barang — sistem mencari material paling mirip bentuknya di Data Stok (kemiripan ≥75%, maks 10 hasil)."}
        </p>
        <label style={{...sty.btn("ghost"),display:"flex",minHeight:44,alignItems:"center",justifyContent:"center",gap:6,textAlign:"center",cursor:"pointer",marginBottom:10}}>
          {photoSearchImg ? <ArrowsClockwise size={17} weight="bold" aria-hidden="true" /> : <Camera size={17} weight="bold" aria-hidden="true" />}
          {photoSearchImg ? "Ganti Foto" : "Ambil / Pilih Foto"}
          <input type="file" accept="image/*" capture="environment" onChange={e=>handleImg(e, img=>setPhotoSearchImg(img))} style={{display:"none"}}/>
        </label>
        {photoSearchImg && <img src={photoSearchImg} alt="query" style={{width:"100%",maxHeight:220,objectFit:"contain",borderRadius:8,marginBottom:12,border:`1px solid ${C.border}`,background:"#f8fafc"}}/>}
        <div style={{display:"flex",gap:8}}>
          <button style={{...sty.btn("ghost"),flex:1}} disabled={photoSearchLoading} onClick={()=>setPhotoSearchOpen(false)}>Batal</button>
          <button style={{...sty.btn("primary"),flex:2}} disabled={!photoSearchImg||photoSearchLoading} onClick={runPhotoSearch}>{photoSearchLoading?(photoSearchMode==="nameplate"?"Membaca teks...":"Menganalisa..."):(photoSearchMode==="nameplate"?"Baca & Cocokkan Nameplate":"Cari Barang Mirip")}</button>
        </div>
      </div>
    </div>
  );
}

// LIGHTBOX — overview foto full-screen
export function LightboxModal({ lightboxImg, setLightboxImg }) {
  return (
    <div onClick={()=>setLightboxImg(null)} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.85)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:2000,padding:20,cursor:"zoom-out"}}>
      <img src={lightboxImg} alt="Overview" style={{maxWidth:"90vw",maxHeight:"90dvh",objectFit:"contain",borderRadius:8}}/>
      <button style={{position:"fixed",top:20,right:20,background:"#dc2626",color:"white",border:"none",borderRadius:8,padding:"8px 16px",cursor:"pointer",fontSize:14}} onClick={()=>setLightboxImg(null)}>✕ Tutup</button>
    </div>
  );
}

// PETA MINI MODAL — dari card Data Stok
export function PetaMiniDetailModal({ petaMiniDetail, setPetaMiniDetail, lokasiList, sty, C }) {
  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.6)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1500,padding:20}}>
      <div style={{...sty.card,width:560,maxWidth:"100%",maxHeight:"90dvh",overflowY:"auto"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
          <div>
            <h3 style={{fontSize:16,fontWeight:800}}>📍 Lokasi di Peta Gudang</h3>
            <p style={{fontSize:12,color:C.muted}}>{petaMiniDetail.petaInfo?.subGudang ? `${petaMiniDetail.gudang.nama} — ${petaMiniDetail.petaInfo.subGudang.nama}` : petaMiniDetail.gudang.nama} — Blok: {petaMiniDetail.lokasi.kode} {petaMiniDetail.lokasi.nama}</p>
          </div>
          <button style={{background:"#dc2626",color:"white",border:"none",borderRadius:8,padding:"6px 14px",cursor:"pointer",fontSize:12}} onClick={()=>setPetaMiniDetail(null)}>✕</button>
        </div>
        <div style={{position:"relative",width:"100%"}}>
          <img src={petaMiniDetail.petaInfo.denahImageData} alt="Denah" style={{width:"100%",borderRadius:8,display:"block",filter:"brightness(0.7)"}}/>
          {/* Semua blok lain di scope denah yang sama — abu */}
          {(petaMiniDetail.petaInfo.subGudang
            ? lokasiList.filter(l=>l.subGudangId===petaMiniDetail.petaInfo.subGudang.id&&l.subMapX!=null&&l.id!==petaMiniDetail.lokasi.id)
            : lokasiList.filter(l=>l.gudangId===petaMiniDetail.gudang.id&&l.mapX!=null&&l.id!==petaMiniDetail.lokasi.id)
          ).map(l=>{
            const px = petaMiniDetail.petaInfo.subGudang ? l.subMapX : l.mapX;
            const py = petaMiniDetail.petaInfo.subGudang ? l.subMapY : l.mapY;
            return <div key={l.id} style={{position:"absolute",left:`${px}%`,top:`${py}%`,transform:"translate(-50%,-50%)",width:10,height:10,borderRadius:"50%",background:"#9ca3af",border:"1px solid white",opacity:0.6}}/>;
          })}
          {/* Titik merah — lokasi barang ini */}
          <div style={{position:"absolute",left:`${petaMiniDetail.petaInfo.x}%`,top:`${petaMiniDetail.petaInfo.y}%`,transform:"translate(-50%,-50%)"}}>
            <div style={{width:18,height:18,borderRadius:"50%",background:"#dc2626",border:"3px solid white",boxShadow:"0 0 0 3px rgba(220,38,38,0.4)",animation:"pulse 1.5s infinite"}}/>
            <div style={{position:"absolute",top:-24,left:"50%",transform:"translateX(-50%)",background:"#dc2626",color:"white",fontSize:12,fontWeight:700,padding:"2px 6px",borderRadius:4,whiteSpace:"nowrap"}}>{petaMiniDetail.lokasi.kode}</div>
          </div>
        </div>
        <style>{`@keyframes pulse{0%,100%{box-shadow:0 0 0 3px rgba(220,38,38,0.4)}50%{box-shadow:0 0 0 8px rgba(220,38,38,0)}}`}</style>
      </div>
    </div>
  );
}

// KONFIRMASI GUDANG BARU DARI IMPORT KAPASITAS GUDANG
export function CapacityReviewModal({ capacityReviewCandidates, capacityReviewDecisions, setCapacityReviewDecisions, gudangList, setCapacityReviewImportId, setCapacityReviewCandidates, confirmCapacityApproval, sty, C }) {
  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000,padding:20}}>
      <div style={{...sty.card,width:600,maxWidth:"100%",maxHeight:"90dvh",overflowY:"auto"}}>
        <h3 style={{fontSize:18,fontWeight:800,marginBottom:6}}>🔎 Konfirmasi Gudang Baru</h3>
        <p style={{fontSize:12,color:C.muted,marginBottom:16}}>
          {capacityReviewCandidates.length} nama Gudang di file ini tidak cocok dengan Gudang yang sudah ada.
          Untuk tiap baris, pastikan ini memang Gudang baru — atau pilih Gudang existing kalau ini cuma beda penulisan nama (mencegah duplikat).
        </p>
        <div style={{display:"flex",flexDirection:"column",gap:12,marginBottom:16}}>
          {capacityReviewCandidates.map(c => {
            const decision = capacityReviewDecisions[c.key] || {action:"NEW"};
            const gudangDiUpt = gudangList.filter(g=>g.uptId===c.uptId);
            return (
              <div key={c.key} style={{border:`1px solid ${C.border}`,borderRadius:8,padding:12}}>
                <div style={{fontWeight:700,fontSize:13}}>{c.gudang}</div>
                <div style={{fontSize:12,color:C.muted,marginBottom:8}}>UPT: {c.upt}</div>
                <div style={{display:"flex",flexDirection:"column",gap:6}}>
                  <label style={{display:"flex",alignItems:"center",gap:8,fontSize:12,cursor:"pointer"}}>
                    <input type="radio" name={`capdec-${c.key}`} checked={decision.action==="NEW"}
                      onChange={()=>setCapacityReviewDecisions(prev=>({...prev,[c.key]:{action:"NEW"}}))}/>
                    🆕 Ini Gudang baru, buat entri baru
                  </label>
                  <label style={{display:"flex",alignItems:"center",gap:8,fontSize:12,cursor:"pointer"}}>
                    <input type="radio" name={`capdec-${c.key}`} checked={decision.action==="MAP"}
                      onChange={()=>setCapacityReviewDecisions(prev=>({...prev,[c.key]:{action:"MAP", mappedGudangId: c.suggestions[0]?.id || gudangDiUpt[0]?.id || ""}}))}
                      disabled={gudangDiUpt.length===0}/>
                    🔗 Ini sebenarnya Gudang yang sudah ada:
                  </label>
                  {decision.action==="MAP" && (
                    <div style={{marginLeft:26}}>
                      <select style={{...sty.select,fontSize:12}} value={decision.mappedGudangId||""}
                        onChange={e=>setCapacityReviewDecisions(prev=>({...prev,[c.key]:{action:"MAP", mappedGudangId:e.target.value}}))}>
                        <option value="">-- Pilih Gudang --</option>
                        {c.suggestions.length>0 && <optgroup label="Mirip (disarankan)">
                          {c.suggestions.map(g=><option key={g.id} value={g.id}>{g.nama}</option>)}
                        </optgroup>}
                        <optgroup label="Semua Gudang di UPT ini">
                          {gudangDiUpt.map(g=><option key={g.id} value={g.id}>{g.nama}</option>)}
                        </optgroup>
                      </select>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        <div className="approval-actions">
          <button className="approval-btn--cancel" onClick={()=>{setCapacityReviewImportId(null);setCapacityReviewCandidates([]);setCapacityReviewDecisions({});}}>Batal</button>
          <button className="approval-btn--approve" onClick={confirmCapacityApproval}><span className="approval-btn__ic" aria-hidden="true">✓</span>Konfirmasi & Lanjutkan Approve</button>
        </div>
      </div>
    </div>
  );
}
