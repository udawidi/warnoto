// Modal-modal Master Data — Struktur Organisasi (dipindah dari App.jsx, refactor batch 1).
// Satpam, Tim Mutu, UIT, UPT, ULTG.

export function SatpamModal({ satpamModal, setSatpamModal, satpamForm, setSatpamForm, visibleGudangList, uptList, handleSatpamFoto, saveSatpam, sty, C }) {
  return (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000,padding:16}}>
          <div style={{...sty.card,width:400,maxWidth:"100%",maxHeight:"90dvh",overflowY:"auto"}}>
            <div style={sty.modalHeader}><span style={{fontWeight:800,fontSize:15}}>{satpamModal==="edit"?"Edit Satpam":"Tambah Satpam Baru"}</span><button onClick={()=>setSatpamModal(null)} style={{background:"transparent",border:"none",color:"white",fontSize:24,lineHeight:1,cursor:"pointer",padding:0,opacity:0.85}}>×</button></div>
            <div style={{marginBottom:12}}>
              <label style={sty.label}>Nama Satpam</label>
              <input style={sty.input} value={satpamForm.name||""} onChange={e=>setSatpamForm(sf=>({...sf,name:e.target.value}))} placeholder="cth: Robby Demas Riady"/>
            </div>
            <div style={{marginBottom:12}}>
              <label style={sty.label}>No. Telepon (opsional)</label>
              <input style={sty.input} value={satpamForm.telp||""} onChange={e=>setSatpamForm(sf=>({...sf,telp:e.target.value}))} placeholder="08xxxxxxxxxx"/>
            </div>
            <div style={{marginBottom:12}}>
              <label style={sty.label}>Bertugas di Gudang (opsional)</label>
              <select style={sty.select} value={satpamForm.gudangId||""} onChange={e=>setSatpamForm(sf=>({...sf,gudangId:e.target.value}))}>
                <option value="">-- Belum di-assign gudang --</option>
                {visibleGudangList.map(g=>{ const up=uptList.find(u=>u.id===g.uptId); return <option key={g.id} value={g.id}>{g.nama}{up?` — ${up.nama}`:""}</option>; })}
              </select>
              <div style={{fontSize:12,color:C.muted,marginTop:4}}>Nama satpam akan muncul di dokumen TUG-10 sesuai gudang tempat barang disimpan.</div>
            </div>
            <div style={{marginBottom:12}}>
              <label style={sty.label}>Foto (opsional)</label>
              <div style={{display:"flex",gap:12,alignItems:"center"}}>
                <div style={{width:96,height:96,borderRadius:12,background:"#f3f4f6",border:`1px solid ${C.border}`,overflow:"hidden",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                  {satpamForm.foto ? <img src={satpamForm.foto} alt="Foto satpam" style={{width:"100%",height:"100%",objectFit:"cover"}}/> : <span style={{fontSize:30}}>🛡️</span>}
                </div>
                <div style={{display:"flex",flexDirection:"column",gap:6}}>
                  <label style={{...sty.btn("ghost","sm"),textAlign:"center",cursor:"pointer"}}>
                    📷 {satpamForm.foto?"Ganti Foto":"Upload Foto"}
                    <input type="file" accept="image/*" capture="environment" style={{display:"none"}} onChange={handleSatpamFoto}/>
                  </label>
                  {satpamForm.foto && <button style={sty.btn("danger","sm")} onClick={()=>setSatpamForm(sf=>({...sf,foto:null}))}>Hapus Foto</button>}
                </div>
              </div>
            </div>
            <div style={{display:"flex",gap:10,marginTop:20}}>
              <button style={{...sty.btn("ghost"),flex:1}} onClick={()=>setSatpamModal(null)}>Batal</button>
              <button style={{...sty.btn("primary"),flex:2}} onClick={saveSatpam}>💾 Simpan ke Cloud</button>
            </div>
          </div>
        </div>
  );
}

export function TimMutuModal({ timMutuModal, setTimMutuModal, timMutuForm, setTimMutuForm, saveTimMutu, sty, C }) {
  return (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000,padding:16}}>
          <div style={{...sty.card,width:420,maxWidth:"100%",maxHeight:"90dvh",overflowY:"auto"}}>
            <div style={sty.modalHeader}><span style={{fontWeight:800,fontSize:15}}>Edit {timMutuForm.label}</span><button onClick={()=>setTimMutuModal(null)} style={{background:"transparent",border:"none",color:"white",fontSize:24,lineHeight:1,cursor:"pointer",padding:0,opacity:0.85}}>×</button></div>
            <p style={{fontSize:12,color:C.muted,marginBottom:16}}>Paket tim ini tetap (tidak bisa diganti namanya) — hanya anggotanya yang bisa diedit.</p>
            <div style={{marginBottom:12}}>
              <label style={sty.label}>Ketua</label>
              <input style={sty.input} value={timMutuForm.ketua||""} onChange={e=>setTimMutuForm(tf=>({...tf,ketua:e.target.value}))}/>
            </div>
            <div style={{marginBottom:12}}>
              <label style={sty.label}>Sekretaris</label>
              <input style={sty.input} value={timMutuForm.sekretaris||""} onChange={e=>setTimMutuForm(tf=>({...tf,sekretaris:e.target.value}))}/>
            </div>
            <div style={{marginBottom:12}}>
              <label style={sty.label}>Anggota 1</label>
              <input style={sty.input} value={timMutuForm.anggota1||""} onChange={e=>setTimMutuForm(tf=>({...tf,anggota1:e.target.value}))}/>
            </div>
            <div style={{marginBottom:12}}>
              <label style={sty.label}>Anggota 2</label>
              <input style={sty.input} value={timMutuForm.anggota2||""} onChange={e=>setTimMutuForm(tf=>({...tf,anggota2:e.target.value}))}/>
            </div>
            <div style={{marginBottom:12}}>
              <label style={sty.label}>Anggota 3</label>
              <input style={sty.input} value={timMutuForm.anggota3||""} onChange={e=>setTimMutuForm(tf=>({...tf,anggota3:e.target.value}))}/>
            </div>
            <div style={{display:"flex",gap:10,marginTop:20}}>
              <button style={{...sty.btn("ghost"),flex:1}} onClick={()=>setTimMutuModal(null)}>Batal</button>
              <button style={{...sty.btn("primary"),flex:2}} onClick={saveTimMutu}>💾 Simpan ke Cloud</button>
            </div>
          </div>
        </div>
  );
}

export function UitModal({ uitModal, setUitModal, uitForm, setUitForm, saveUIT, sty }) {
  return (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000,padding:16}}>
          <div style={{...sty.card,width:440,maxWidth:"100%",maxHeight:"90dvh",overflowY:"auto"}}>
            <div style={sty.modalHeader}><span style={{fontWeight:800,fontSize:15}}>{uitModal==="edit"?"Edit UIT":"Tambah UIT Baru"}</span><button onClick={()=>setUitModal(null)} style={{background:"transparent",border:"none",color:"white",fontSize:24,lineHeight:1,cursor:"pointer",padding:0,opacity:0.85}}>×</button></div>
            <div style={{marginBottom:12}}><label style={sty.label}>Kode UIT</label><input style={sty.input} value={uitForm.kode||""} onChange={e=>setUitForm(f=>({...f,kode:e.target.value}))} placeholder="cth: UIT-JBM"/></div>
            <div style={{marginBottom:12}}><label style={sty.label}>Nama Lengkap UIT</label><input style={sty.input} value={uitForm.nama||""} onChange={e=>setUitForm(f=>({...f,nama:e.target.value}))} placeholder="cth: PT PLN (PERSERO) UNIT INDUK TRANSMISI JAWA BAGIAN TIMUR DAN BALI"/></div>
            <div style={{marginBottom:16}}><label style={sty.label}>Alamat</label><input style={sty.input} value={uitForm.alamat||""} onChange={e=>setUitForm(f=>({...f,alamat:e.target.value}))}/></div>
            <div style={{display:"flex",gap:10}}><button style={{...sty.btn("ghost"),flex:1}} onClick={()=>setUitModal(null)}>Batal</button><button style={{...sty.btn("primary"),flex:2}} onClick={saveUIT}>💾 Simpan</button></div>
          </div>
        </div>
  );
}

export function UptModal({ uptModal, setUptModal, uptForm, setUptForm, uitList, saveUPT, sty }) {
  return (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000,padding:16}}>
          <div style={{...sty.card,width:440,maxWidth:"100%",maxHeight:"90dvh",overflowY:"auto"}}>
            <div style={sty.modalHeader}><span style={{fontWeight:800,fontSize:15}}>{uptModal==="edit"?"Edit UPT":"Tambah UPT Baru"}</span><button onClick={()=>setUptModal(null)} style={{background:"transparent",border:"none",color:"white",fontSize:24,lineHeight:1,cursor:"pointer",padding:0,opacity:0.85}}>×</button></div>
            <div style={{marginBottom:12}}><label style={sty.label}>Kode UPT</label><input style={sty.input} value={uptForm.kode||""} onChange={e=>setUptForm(f=>({...f,kode:e.target.value}))} placeholder="cth: UPT-MLG"/></div>
            <div style={{marginBottom:12}}><label style={sty.label}>Nama UPT</label><input style={sty.input} value={uptForm.nama||""} onChange={e=>setUptForm(f=>({...f,nama:e.target.value}))} placeholder="cth: UPT Malang"/></div>
            <div style={{marginBottom:12}}><label style={sty.label}>Alamat</label><input style={sty.input} value={uptForm.alamat||""} onChange={e=>setUptForm(f=>({...f,alamat:e.target.value}))}/></div>
            <div style={{marginBottom:16}}>
              <label style={sty.label}>Unit Induk (UIT)</label>
              <select style={sty.select} value={uptForm.uitId||""} onChange={e=>setUptForm(f=>({...f,uitId:e.target.value}))}>
                <option value="">-- Pilih UIT --</option>
                {uitList.map(u=><option key={u.id} value={u.id}>{u.kode} — {u.nama}</option>)}
              </select>
            </div>
            <div style={{display:"flex",gap:10}}><button style={{...sty.btn("ghost"),flex:1}} onClick={()=>setUptModal(null)}>Batal</button><button style={{...sty.btn("primary"),flex:2}} onClick={saveUPT}>💾 Simpan</button></div>
          </div>
        </div>
  );
}

export function UltgModal({ ultgModal, setUltgModal, ultgForm, setUltgForm, uptList, saveULTG, sty }) {
  return (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000,padding:16}}>
          <div style={{...sty.card,width:440,maxWidth:"100%",maxHeight:"90dvh",overflowY:"auto"}}>
            <div style={sty.modalHeader}><span style={{fontWeight:800,fontSize:15}}>{ultgModal==="edit"?"Edit ULTG":"Tambah ULTG Baru"}</span><button onClick={()=>setUltgModal(null)} style={{background:"transparent",border:"none",color:"white",fontSize:24,lineHeight:1,cursor:"pointer",padding:0,opacity:0.85}}>×</button></div>
            <div style={{marginBottom:12}}><label style={sty.label}>Kode ULTG</label><input style={sty.input} value={ultgForm.kode||""} onChange={e=>setUltgForm(f=>({...f,kode:e.target.value}))} placeholder="cth: ULTG-SBU"/></div>
            <div style={{marginBottom:12}}><label style={sty.label}>Nama ULTG</label><input style={sty.input} value={ultgForm.nama||""} onChange={e=>setUltgForm(f=>({...f,nama:e.target.value}))} placeholder="cth: ULTG Surabaya Utara"/></div>
            <div style={{marginBottom:16}}>
              <label style={sty.label}>UPT Induk *</label>
              <select style={sty.select} value={ultgForm.parentUptId||""} onChange={e=>setUltgForm(f=>({...f,parentUptId:e.target.value}))}>
                <option value="">-- Pilih UPT --</option>
                {uptList.map(u=><option key={u.id} value={u.id}>{u.kode} — {u.nama}</option>)}
              </select>
            </div>
            <div style={{display:"flex",gap:10}}><button style={{...sty.btn("ghost"),flex:1}} onClick={()=>setUltgModal(null)}>Batal</button><button style={{...sty.btn("primary"),flex:2}} onClick={saveULTG}>💾 Simpan</button></div>
          </div>
        </div>
  );
}
