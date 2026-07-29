// Modal-modal Master Data (dipindah dari App.jsx, refactor batch 1).
// Katalog, Lokasi (Blok), Gudang edit, Gudang add (wizard 3 langkah).
import { extractLatLngFromAddress } from "../lib/masterSync.js";

export function KatalogModal({ katalogModal, setKatalogModal, katalogForm, setKatalogForm, maraSearch, setMaraSearch, setMaraSearchResults, maraSearchLoading, maraSearchError, maraSearchResults, searchMaraCatalog, applyMaraToKatalog, openScanner, saveKatalog, isMobile, CATEGORIES, sty, C }) {
  return (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000,padding:16}}>
          <div style={{...sty.card,width:460,maxWidth:"100%",maxHeight:"90dvh",overflowY:"auto"}}>
            <div style={sty.modalHeader}><span style={{fontWeight:800,fontSize:15}}>{katalogModal==="edit"?"Edit Master Katalog":"Tambah Katalog Barang Baru"}</span><button onClick={()=>setKatalogModal(null)} style={{background:"transparent",border:"none",color:"white",fontSize:24,lineHeight:1,cursor:"pointer",padding:0,opacity:0.85}}>×</button></div>
            {/* MARA Referensi Search */}
            <div style={{marginBottom:16,background:"#f0f9ff",border:"1px solid #bae6fd",borderRadius:10,padding:12}}>
              <div style={{fontSize:12,fontWeight:800,color:"#0369a1",marginBottom:8}}>🔍 Cari Referensi MARA</div>
              <div style={{display:"flex",gap:6}}>
                <input style={{...sty.input,flex:1}} value={maraSearch} placeholder="Ketik nama material MARA (min. 2 huruf)..."
                  onChange={e=>searchMaraCatalog(e.target.value)}/>
                {maraSearch && <button style={sty.btn("ghost","sm")} onClick={()=>{setMaraSearch("");setMaraSearchResults([])}}>✕</button>}
              </div>
              {maraSearchLoading && <div style={{fontSize:12,color:"#0369a1",marginTop:6}}>Mencari...</div>}
              {maraSearchError && <div style={{fontSize:12,color:C.red,marginTop:6,padding:"6px 8px",background:"#fef2f2",borderRadius:6}}>⚠️ {maraSearchError}</div>}
              {maraSearchResults.length>0 && (
                <div style={{marginTop:8,maxHeight:180,overflowY:"auto",display:"flex",flexDirection:"column",gap:4}}>
                  {maraSearchResults.map(item=>(
                    <div key={item.kode_material} onClick={()=>applyMaraToKatalog(item)}
                      style={{padding:"6px 10px",borderRadius:7,border:"1px solid #bae6fd",background:C.surface,cursor:"pointer",fontSize:12,display:"flex",justifyContent:"space-between",gap:8}}
                      onMouseEnter={e=>e.currentTarget.style.background="#e0f2fe"}
                      onMouseLeave={e=>e.currentTarget.style.background=C.surface}>
                      <div>
                        <span style={{fontWeight:700,color:"#0369a1"}}>{item.kode_material}</span>
                        <span style={{color:"#334155",marginLeft:8}}>{item.nama}</span>
                      </div>
                      <span style={{color:"#64748b",flexShrink:0}}>{item.satuan}</span>
                    </div>
                  ))}
                </div>
              )}
              {maraSearch.length>=2 && !maraSearchLoading && maraSearchResults.length===0 && (
                <div style={{fontSize:12,color:"#64748b",marginTop:6}}>Tidak ada hasil untuk "{maraSearch}"</div>
              )}
              <div style={{fontSize:12,color:"#94a3b8",marginTop:6}}>Klik item untuk auto-fill form. MARA tersimpan di database.</div>
            </div>
            {katalogForm._maraLocked && (
              <div style={{marginBottom:12,display:"flex",justifyContent:"space-between",alignItems:"center",background:"#f0fdf4",border:"1px solid #bbf7d0",borderRadius:8,padding:"8px 10px"}}>
                <span style={{fontSize:12,color:"#166534"}}>🔒 Terkunci dari referensi MARA — Nomor Katalog, Nama, Kategori, Satuan tidak bisa diketik manual.</span>
                <button type="button" style={{...sty.btn("ghost","sm"),flexShrink:0}} onClick={()=>setKatalogForm(kf=>({...kf,_maraLocked:false}))}>🔓 Lepas Kunci</button>
              </div>
            )}
            <div style={{marginBottom:12}}>
              <label style={sty.label}>Nomor Katalog PLN</label>
              <div style={{display:"flex",gap:6}}>
                <input style={{...sty.input,...(katalogForm._maraLocked?{background:"#f3f4f6",color:C.muted}:{})}} disabled={!!katalogForm._maraLocked} value={katalogForm.katalog||""} placeholder="cth: 84618768" onChange={e=>setKatalogForm(kf=>({...kf,katalog:e.target.value}))}/>
                <button type="button" style={{...sty.btn("ghost","sm"),flexShrink:0}} disabled={!!katalogForm._maraLocked} onClick={()=>openScanner("katalogForm")}>📷</button>
              </div>
            </div>
            <div style={{marginBottom:12}}><label style={sty.label}>Nama Barang</label><input style={{...sty.input,...(katalogForm._maraLocked?{background:"#f3f4f6",color:C.muted}:{})}} disabled={!!katalogForm._maraLocked} value={katalogForm.name||""} onChange={e=>setKatalogForm(kf=>({...kf,name:e.target.value}))}/></div>
            <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"1fr 1fr",gap:12,marginBottom:12}}>
              <div>
                <label style={sty.label}>Kategori</label>
                {katalogForm._maraLocked ? (
                  <input style={{...sty.input,background:"#f3f4f6",color:C.muted}} disabled value={katalogForm.category||"-"} title="Material Group Desc dari MARA — bukan kategori standar aplikasi"/>
                ) : (
                  <select style={sty.select} value={katalogForm.category||"Lainnya"} onChange={e=>setKatalogForm(kf=>({...kf,category:e.target.value}))}>{CATEGORIES.map(c=><option key={c}>{c}</option>)}</select>
                )}
              </div>
              <div><label style={sty.label}>Satuan Default</label><input style={{...sty.input,...(katalogForm._maraLocked?{background:"#f3f4f6",color:C.muted}:{})}} disabled={!!katalogForm._maraLocked} value={katalogForm.satuan||""} placeholder="cth: unit, pcs, roll" onChange={e=>setKatalogForm(kf=>({...kf,satuan:e.target.value}))}/></div>
            </div>
            <div style={{display:"flex",gap:10,marginTop:20}}>
              <button style={{...sty.btn("ghost"),flex:1}} onClick={()=>setKatalogModal(null)}>Batal</button>
              <button style={{...sty.btn("primary"),flex:2}} onClick={saveKatalog}>💾 Simpan ke Cloud</button>
            </div>
          </div>
        </div>
  );
}

export function LokasiModal({ lokasiModal, setLokasiModal, lokasiForm, setLokasiForm, gudangList, visibleGudangList, subGudangList, saveLokasi, sty, C }) {
  return (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000,padding:16}}>
          <div style={{...sty.card,width:420,maxWidth:"100%",maxHeight:"90dvh",overflowY:"auto"}}>
            <div style={sty.modalHeader}><span style={{fontWeight:800,fontSize:15}}>{lokasiModal==="edit"?"Edit Master Lokasi":"Tambah Lokasi Gudang Baru"}</span><button onClick={()=>setLokasiModal(null)} style={{background:"transparent",border:"none",color:"white",fontSize:24,lineHeight:1,cursor:"pointer",padding:0,opacity:0.85}}>×</button></div>
            {gudangList.length===0 ? (
              <div style={{background:"#fef3c7",border:`1px solid #fcd34d`,borderRadius:8,padding:"10px 12px",fontSize:12,color:"#92400e",marginBottom:16}}>⚠️ Belum ada Master Gudang. Tambahkan Gudang dulu di menu "Master Data" → "Master Gudang" sebelum bisa mengisi Blok — data harus berjenjang: Gudang dulu, baru Blok.</div>
            ) : (
              <div style={{background:"#dbeafe",border:`1px solid #93c5fd`,borderRadius:8,padding:"10px 12px",fontSize:12,color:"#1e40af",marginBottom:16}}>ℹ️ Pilih Gudang dulu, baru isi data Blok-nya (berjenjang).</div>
            )}
            <div style={{marginBottom:12}}>
              <label style={sty.label}>Gudang *</label>
              <select style={sty.select} value={lokasiForm.gudangId||""} disabled={gudangList.length===0 || lokasiModal==="edit"} onChange={e=>setLokasiForm(lf=>({...lf,gudangId:e.target.value||null,subGudangId:null}))}>
                <option value="">-- Pilih Gudang --</option>
                {visibleGudangList.map(g=><option key={g.id} value={g.id}>{g.nama}</option>)}
              </select>
              {lokasiModal==="edit" && <div style={{fontSize:12,color:C.muted,marginTop:4}}>Gudang tidak bisa diubah saat edit blok. Hapus & buat ulang blok jika perlu pindah Gudang.</div>}
            </div>
            {lokasiForm.gudangId && (
              <div style={{marginBottom:12}}>
                <label style={sty.label}>Sub Gudang</label>
                <select style={sty.select} value={lokasiForm.subGudangId||""} disabled={lokasiModal==="edit"} onChange={e=>setLokasiForm(lf=>({...lf,subGudangId:e.target.value||null}))}>
                  <option value="">-- Umum / Tidak ada Sub Gudang --</option>
                  {subGudangList.filter(sg=>sg.gudangId===lokasiForm.gudangId).map(sg=><option key={sg.id} value={sg.id}>{sg.nama}</option>)}
                </select>
                {lokasiModal==="edit" && <div style={{fontSize:12,color:C.muted,marginTop:4}}>Sub Gudang tidak bisa diubah saat edit blok.</div>}
              </div>
            )}
            <div style={{marginBottom:12}}><label style={sty.label}>Kode Lokasi (Blok)</label><input style={sty.input} value={lokasiForm.kode||""} placeholder="cth: Rak A-1" disabled={!lokasiForm.gudangId} onChange={e=>setLokasiForm(lf=>({...lf,kode:e.target.value}))}/></div>
            <div style={{marginBottom:12}}><label style={sty.label}>Keterangan Area</label><input style={sty.input} value={lokasiForm.keterangan||""} placeholder="cth: Area Transformator" disabled={!lokasiForm.gudangId} onChange={e=>setLokasiForm(lf=>({...lf,keterangan:e.target.value}))}/></div>
            <div style={{marginBottom:12}}><label style={sty.label}>Kapasitas Maksimal (m²)</label><input style={sty.input} type="number" inputMode="decimal" value={lokasiForm.kapasitas||0} placeholder="cth: 50" disabled={!lokasiForm.gudangId} onChange={e=>setLokasiForm(lf=>({...lf,kapasitas:Number(e.target.value)}))}/></div>
            <div style={{display:"flex",gap:10,marginTop:20}}>
              <button style={{...sty.btn("ghost"),flex:1}} onClick={()=>setLokasiModal(null)}>Batal</button>
              <button style={{...sty.btn("primary"),flex:2}} disabled={!lokasiForm.gudangId} onClick={saveLokasi}>💾 Simpan ke Cloud</button>
            </div>
          </div>
        </div>
  );
}

export function GudangEditModal({ gudangForm, setGudangForm, uptList, setGudangModal, saveGudang, sty, C }) {
  return (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000,padding:16}}>
          <div style={{...sty.card,width:460,maxWidth:"100%",maxHeight:"90dvh",overflowY:"auto"}}>
            <h3 style={{fontSize:18,fontWeight:800,marginBottom:20}}>Edit Gudang</h3>
            <div style={{marginBottom:12}}><label style={sty.label}>Kode Gudang</label><input style={sty.input} value={gudangForm.kode||""} onChange={e=>setGudangForm(f=>({...f,kode:e.target.value}))} placeholder="cth: GTK"/></div>
            <div style={{marginBottom:12}}><label style={sty.label}>Nama Gudang</label><input style={sty.input} value={gudangForm.nama||""} onChange={e=>setGudangForm(f=>({...f,nama:e.target.value}))} placeholder="cth: Gudang Ketintang"/></div>
            <div style={{marginBottom:12}}>
              <label style={sty.label}>Alamat (format Google Maps)</label>
              <input style={sty.input} value={gudangForm.alamat||""} onChange={e=>{
                const val = e.target.value;
                const r = extractLatLngFromAddress(val);
                setGudangForm(f=>({...f, alamat:val, lat:r?r.lat:f.lat, lng:r?r.lng:f.lng}));
              }} placeholder="cth: MRR6+9M Wonorejo, Surabaya, East Java"/>
              <div style={{fontSize:12,color:C.muted,marginTop:3}}>Tempel alamat persis seperti format Google Maps (kode + area) — koordinat untuk Peta Wilayah otomatis terisi, tidak perlu diisi manual.</div>
            </div>
            <div style={{marginBottom:16}}>
              <label style={sty.label}>UPT</label>
              <select style={sty.select} value={gudangForm.uptId||""} onChange={e=>setGudangForm(f=>({...f,uptId:e.target.value}))}>
                <option value="">-- Pilih UPT --</option>
                {uptList.map(u=><option key={u.id} value={u.id}>{u.kode} — {u.nama}</option>)}
              </select>
            </div>
            <div style={{display:"flex",gap:10}}><button style={{...sty.btn("ghost"),flex:1}} onClick={()=>setGudangModal(null)}>Batal</button><button style={{...sty.btn("primary"),flex:2}} onClick={saveGudang}>💾 Simpan</button></div>
          </div>
        </div>
  );
}

export function GudangAddModal({ gudangWizardStep, setGudangWizardStep, gudangForm, setGudangForm, uptList, gudangList, lokasiList, closeGudangWizard, gudangWizardNext, uploadDenahGudang, denahLoading, suggestKodeFromOcr, wizardBlokDraft, setWizardBlokDraft, addWizardBlok, sty, C }) {
  return (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000,padding:16}}>
          <div style={{...sty.card,width:540,maxWidth:"100%",maxHeight:"90dvh",overflowY:"auto"}}>
            <div style={{display:"flex",gap:6,marginBottom:18}}>
              {[1,2,3].map(n=>(
                <div key={n} style={{flex:1,height:4,borderRadius:4,background:gudangWizardStep>=n?C.accent:C.border}}/>
              ))}
            </div>

            {/* STEP 1: Data Gudang */}
            {gudangWizardStep===1 && (
              <div>
                <h3 style={{fontSize:18,fontWeight:800,marginBottom:6}}>Tambah Gudang Baru</h3>
                <p style={{fontSize:12,color:C.muted,marginBottom:16}}>Langkah 1 dari 3 — Data Gudang</p>
                <div style={{marginBottom:12}}><label style={sty.label}>Kode Gudang</label><input style={sty.input} value={gudangForm.kode||""} onChange={e=>setGudangForm(f=>({...f,kode:e.target.value}))} placeholder="cth: GTK"/></div>
                <div style={{marginBottom:12}}><label style={sty.label}>Nama Gudang</label><input style={sty.input} value={gudangForm.nama||""} onChange={e=>setGudangForm(f=>({...f,nama:e.target.value}))} placeholder="cth: Gudang Ketintang"/></div>
                <div style={{marginBottom:12}}>
                  <label style={sty.label}>Alamat (format Google Maps)</label>
                  <input style={sty.input} value={gudangForm.alamat||""} onChange={e=>{
                    const val = e.target.value;
                    const r = extractLatLngFromAddress(val);
                    setGudangForm(f=>({...f, alamat:val, lat:r?r.lat:f.lat, lng:r?r.lng:f.lng}));
                  }} placeholder="cth: MRR6+9M Wonorejo, Surabaya, East Java"/>
                  <div style={{fontSize:12,color:C.muted,marginTop:3}}>Tempel alamat persis seperti format Google Maps (kode + area) — koordinat untuk Peta Wilayah otomatis terisi, tidak perlu diisi manual.</div>
                </div>
                <div style={{marginBottom:16}}>
                  <label style={sty.label}>UPT</label>
                  <select style={sty.select} value={gudangForm.uptId||""} onChange={e=>setGudangForm(f=>({...f,uptId:e.target.value}))}>
                    <option value="">-- Pilih UPT --</option>
                    {uptList.map(u=><option key={u.id} value={u.id}>{u.kode} — {u.nama}</option>)}
                  </select>
                </div>
                <div style={{display:"flex",gap:10}}>
                  <button style={{...sty.btn("ghost"),flex:1}} onClick={closeGudangWizard}>Batal</button>
                  <button style={{...sty.btn("primary"),flex:2}} onClick={gudangWizardNext}>Lanjut: Upload Denah →</button>
                </div>
              </div>
            )}

            {/* STEP 2: Upload Denah */}
            {gudangWizardStep===2 && (() => {
              const g = gudangList.find(x=>x.id===gudangForm.id);
              return (
                <div>
                  <h3 style={{fontSize:18,fontWeight:800,marginBottom:6}}>Upload Denah Gudang</h3>
                  <p style={{fontSize:12,color:C.muted,marginBottom:16}}>Langkah 2 dari 3 — Opsional, tapi disarankan supaya bisa menambahkan blok di peta.</p>
                  <div style={{fontSize:12,color:C.muted,marginBottom:8}}>💡 Convert PDF denah ke gambar terlebih dahulu (screenshot, foto, atau export dari PDF viewer)</div>
                  <input type="file" accept="image/*" capture="environment" onChange={e=>{const f=e.target.files[0]; if(f) uploadDenahGudang(gudangForm.id,f);}} style={{fontSize:12,color:C.muted}}/>
                  {denahLoading && <div style={{fontSize:12,color:"#1d4ed8",marginTop:8}}>⏳ Mengompres, menyimpan, dan membaca label di gambar (OCR)...</div>}
                  {g?.denahImageData && !denahLoading && (
                    <div style={{marginTop:12}}>
                      <img src={g.denahImageData} alt="Denah Gudang" style={{width:"100%",maxHeight:220,objectFit:"contain",borderRadius:6,border:`1px solid ${C.border}`}}/>
                    </div>
                  )}
                  <div style={{display:"flex",gap:10,marginTop:18}}>
                    <button style={{...sty.btn("ghost"),flex:1}} onClick={closeGudangWizard}>Lewati, Selesai</button>
                    <button style={{...sty.btn("primary"),flex:2}} disabled={!g?.denahImageData} onClick={()=>setGudangWizardStep(3)}>Lanjut: Tambah Blok →</button>
                  </div>
                </div>
              );
            })()}

            {/* STEP 3: Tambah Blok (klik titik di denah) */}
            {gudangWizardStep===3 && (() => {
              const g = gudangList.find(x=>x.id===gudangForm.id);
              const bloklokasi = lokasiList.filter(l=>l.gudangId===gudangForm.id);
              return (
                <div>
                  <h3 style={{fontSize:18,fontWeight:800,marginBottom:6}}>Tambah Blok Lokasi</h3>
                  <p style={{fontSize:12,color:C.muted,marginBottom:12}}>Langkah 3 dari 3 — Klik titik di denah untuk menambah blok. Kode diusulkan otomatis dari OCR, bisa diedit.</p>

                  {/* Catatan: panel usulan blok dari OCR sekarang tampil sebagai popup terpusat (lihat USULAN BLOK DARI DENAH di luar wizard ini) */}

                  {g?.denahImageData ? (
                    <div style={{position:"relative",cursor:"crosshair",display:"inline-block",width:"100%"}}
                      onClick={e=>{
                        const rect = e.currentTarget.getBoundingClientRect();
                        const xPct = Number(((e.clientX - rect.left) / rect.width * 100).toFixed(1));
                        const yPct = Number(((e.clientY - rect.top) / rect.height * 100).toFixed(1));
                        const kodeUsulan = suggestKodeFromOcr(g, xPct, yPct) || `${g.kode||"BLOK"}-${String(bloklokasi.length+1).padStart(2,"0")}`;
                        setWizardBlokDraft({ kode:kodeUsulan, keterangan:"", kapasitas:50, xPct, yPct });
                      }}>
                      <img src={g.denahImageData} alt="Denah" style={{width:"100%",borderRadius:6,border:`2px dashed #3b82f6`,display:"block"}}/>
                      {bloklokasi.filter(l=>l.mapX!=null).map(l=>(
                        <div key={l.id} title={l.kode} style={{position:"absolute",left:`${l.mapX}%`,top:`${l.mapY}%`,transform:"translate(-50%,-50%)",width:14,height:14,borderRadius:"50%",background:l.status==="PENDING"?"#9ca3af":"#dc2626",border:l.status==="PENDING"?"2px dashed white":"2px solid white",boxShadow:"0 1px 4px rgba(0,0,0,0.4)"}}/>
                      ))}
                      {wizardBlokDraft && (
                        <div style={{position:"absolute",left:`${wizardBlokDraft.xPct}%`,top:`${wizardBlokDraft.yPct}%`,transform:"translate(-50%,-50%)",width:16,height:16,borderRadius:"50%",background:"#22c55e",border:"2px solid white",boxShadow:"0 1px 4px rgba(0,0,0,0.4)"}}/>
                      )}
                    </div>
                  ) : <div style={{fontSize:12,color:C.muted,fontStyle:"italic"}}>Denah belum tersedia.</div>}

                  {wizardBlokDraft && (
                    <div style={{background:"#eff6ff",border:`1px solid #bfdbfe`,borderRadius:8,padding:12,marginTop:12}} onClick={e=>e.stopPropagation()}>
                      <div style={{marginBottom:8}}><label style={sty.label}>Kode Blok</label><input style={sty.input} value={wizardBlokDraft.kode} onChange={e=>setWizardBlokDraft(d=>({...d,kode:e.target.value}))}/></div>
                      <div style={{marginBottom:8}}><label style={sty.label}>Keterangan Area</label><input style={sty.input} value={wizardBlokDraft.keterangan} onChange={e=>setWizardBlokDraft(d=>({...d,keterangan:e.target.value}))}/></div>
                      <div style={{marginBottom:10}}><label style={sty.label}>Kapasitas Maksimal</label><input style={sty.input} type="number" inputMode="decimal" value={wizardBlokDraft.kapasitas} onChange={e=>setWizardBlokDraft(d=>({...d,kapasitas:Number(e.target.value)}))}/></div>
                      <div style={{display:"flex",gap:8}}>
                        <button style={{...sty.btn("ghost","sm"),flex:1}} onClick={()=>setWizardBlokDraft(null)}>Batal</button>
                        <button style={{...sty.btn("primary","sm"),flex:2}} onClick={addWizardBlok}>✓ Tambah Blok Ini</button>
                      </div>
                    </div>
                  )}

                  <div style={{fontSize:12,color:C.muted,marginTop:14}}>Blok di gudang ini: {bloklokasi.length}</div>
                  <div style={{display:"flex",gap:10,marginTop:10}}>
                    <button style={{...sty.btn("primary"),flex:1}} onClick={closeGudangWizard}>✓ Selesai</button>
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
  );
}
