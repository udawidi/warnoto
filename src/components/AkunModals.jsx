// Modal akun (dipindah dari App.jsx, refactor batch 1).
// AkunModal (daftar/edit user), GantiPasswordModal (self-service).
import { ROLES } from "../lib/roles.js";

export function AkunModal({ akunModal, setAkunModal, akunForm, setAkunForm, akunResult, setAkunResult, akunBusy, uitList, uptList, ultgList, users, visibleGudangList, submitAkunEdit, submitAkunBaru, UIT_ROLE_QUOTA, UPT_ROLE_QUOTA, sty, C }) {
  return (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000,padding:16}}>
          <div style={{...sty.card,width:460,maxWidth:"100%",maxHeight:"90dvh",overflowY:"auto"}}>
            {akunResult ? (
              <>
                <h3 style={{fontSize:18,fontWeight:800,marginBottom:14}}>✅ Akun Berhasil Didaftarkan</h3>
                <div style={{background:"#f0fdf4",border:"1px solid #86efac",borderRadius:8,padding:14,marginBottom:14,fontSize:13}}>
                  <div style={{marginBottom:6}}><b>Username:</b> {akunResult.username}</div>
                  <div><b>Password:</b> {akunResult.password}</div>
                </div>
                <div style={{fontSize:12,color:C.muted,marginBottom:16}}>⚠️ Sampaikan kredensial ini ke pemilik akun secara aman. Password ini tidak akan ditampilkan lagi setelah ditutup.</div>
                <button style={{...sty.btn("primary"),width:"100%"}} onClick={()=>{setAkunModal(null);setAkunResult(null);}}>Selesai</button>
              </>
            ) : (
              <>
                <div style={sty.modalHeader}><span style={{fontWeight:800,fontSize:15}}>{akunModal==="edit"?"Edit Akun":"Daftarkan Akun Baru"}</span><button onClick={()=>setAkunModal(null)} style={{background:"transparent",border:"none",color:"white",fontSize:24,lineHeight:1,cursor:"pointer",padding:0,opacity:0.85}}>×</button></div>
                <div style={{marginBottom:12}}>
                  <label style={sty.label}>Username</label>
                  {akunModal==="edit" ? (
                    <div style={{...sty.input,background:C.bg2||"#f3f4f6",color:C.muted}}>{akunForm.username}</div>
                  ) : (
                    <input style={sty.input} value={akunForm.username||""} onChange={e=>setAkunForm(f=>({...f,username:e.target.value}))} placeholder="cth: budi.manager (huruf kecil, tanpa spasi)"/>
                  )}
                </div>
                <div style={{marginBottom:12}}>
                  <label style={sty.label}>{akunModal==="edit"?"Reset Password (opsional)":"Password"}</label>
                  <div style={{display:"flex",gap:6}}>
                    <input style={sty.input} value={akunForm.password||""} onChange={e=>setAkunForm(f=>({...f,password:e.target.value}))} placeholder={akunModal==="edit"?"kosongkan jika tidak diubah":"minimal 6 karakter"}/>
                    <button style={sty.btn("ghost","sm")} onClick={()=>setAkunForm(f=>({...f,password:Math.random().toString(36).slice(-5)+Math.random().toString(36).slice(-5)}))}>🎲 Acak</button>
                  </div>
                </div>
                <div style={{marginBottom:12}}><label style={sty.label}>Nama Lengkap</label><input style={sty.input} value={akunForm.name||""} onChange={e=>setAkunForm(f=>({...f,name:e.target.value}))} placeholder="cth: Budi Santoso"/></div>
                <div style={{marginBottom:12}}>
                  <label style={sty.label}>Role</label>
                  <select style={sty.select} value={akunForm.role||"VIEWER"} onChange={e=>setAkunForm(f=>({...f,role:e.target.value}))}>
                    {Object.entries(ROLES).filter(([id])=>id!=="SUPERADMIN").map(([id,label])=><option key={id} value={id}>{label}</option>)}
                  </select>
                </div>
                <div style={{marginBottom:12}}><label style={sty.label}>Jabatan *</label><input style={sty.input} value={akunForm.jabatan||""} onChange={e=>setAkunForm(f=>({...f,jabatan:e.target.value}))}/></div>
                {akunForm.role==="PENGADAAN" && (
                  <div style={{marginBottom:12}}>
                    <label style={sty.label}>Scope Pengadaan</label>
                    <div style={{display:"flex",gap:8}}>
                      <button type="button" style={{...sty.btn((akunForm.pengadaanScope||"UPT")==="UPT"?"primary":"ghost","sm"),flex:1}} onClick={()=>setAkunForm(f=>({...f,pengadaanScope:"UPT"}))}>Pengadaan UPT</button>
                      <button type="button" style={{...sty.btn(akunForm.pengadaanScope==="UIT"?"primary":"ghost","sm"),flex:1}} onClick={()=>setAkunForm(f=>({...f,pengadaanScope:"UIT"}))}>Pengadaan UIT</button>
                    </div>
                  </div>
                )}
                {(() => {
                  const isUitScopedForm = ["ADMIN_UIT","MGR_LOGISTIK_UIT"].includes(akunForm.role) || (akunForm.role==="PENGADAAN" && akunForm.pengadaanScope==="UIT");
                  if (isUitScopedForm) {
                    return (
                      <div style={{marginBottom:12}}>
                        <label style={sty.label}>UIT *</label>
                        <select style={sty.select} value={akunForm.uitId||""} onChange={e=>setAkunForm(f=>({...f,uitId:e.target.value}))}>
                          <option value="">-- Pilih UIT --</option>
                          {uitList.map(u=><option key={u.id} value={u.id}>{u.kode} — {u.nama}</option>)}
                        </select>
                        {UIT_ROLE_QUOTA[akunForm.role] !== undefined && akunForm.uitId && (() => {
                          const holder = users.find(u => u.role===akunForm.role && u.uitId===akunForm.uitId && u.id!==akunForm.id);
                          const filled = holder ? 1 : 0;
                          const quota = UIT_ROLE_QUOTA[akunForm.role];
                          return (
                            <div style={{fontSize:12,marginTop:4,color:filled>=quota?"#dc2626":C.muted}}>
                              Slot {ROLES[akunForm.role]} di UIT ini: {filled}/{quota} terisi{holder?` (${holder.name})`:""}
                            </div>
                          );
                        })()}
                      </div>
                    );
                  }
                  return (
                    <div style={{marginBottom:12}}>
                      <label style={sty.label}>UPT *</label>
                      <select style={sty.select} value={akunForm.uptId||""} onChange={e=>setAkunForm(f=>({...f,uptId:e.target.value}))}>
                        <option value="">-- Pilih UPT --</option>
                        {uptList.map(u=><option key={u.id} value={u.id}>{u.kode} — {u.nama}</option>)}
                      </select>
                      {UPT_ROLE_QUOTA[akunForm.role] !== undefined && akunForm.uptId && (() => {
                        const holder = users.find(u => u.role===akunForm.role && u.uptId===akunForm.uptId && u.id!==akunForm.id);
                        const filled = holder ? 1 : 0;
                        const quota = UPT_ROLE_QUOTA[akunForm.role];
                        return (
                          <div style={{fontSize:12,marginTop:4,color:filled>=quota?"#dc2626":C.muted}}>
                            Slot {ROLES[akunForm.role]} di UPT ini: {filled}/{quota} terisi{holder?` (${holder.name})`:""}
                          </div>
                        );
                      })()}
                    </div>
                  );
                })()}
                <div style={{marginBottom:16}}>
                  <label style={sty.label}>ULTG {(akunForm.role==="ADMIN_ULTG"||akunForm.role==="MGR_ULTG")?"* (wajib untuk role ULTG)":"(kosongkan jika bukan lingkungan ULTG)"}</label>
                  <select style={sty.select} value={akunForm.ultgId||""} onChange={e=>setAkunForm(f=>({...f,ultgId:e.target.value}))}>
                    <option value="">-- Pilih ULTG --</option>
                    {ultgList.map(u=><option key={u.id} value={u.id}>{u.kode} — {u.nama}</option>)}
                  </select>
                </div>
                {/* RBAC per gudang: kosong = semua gudang (perilaku default). Centang untuk
                    membatasi akun hanya ke gudang tertentu (dropdown/daftar gudang tersaring). */}
                <div style={{marginBottom:16}}>
                  <label style={sty.label}>Batasi Akses Gudang <span style={{fontWeight:400,color:C.muted}}>(kosongkan = semua gudang)</span></label>
                  <div style={{display:"flex",flexWrap:"wrap",gap:8,maxHeight:150,overflowY:"auto",border:`1px solid ${C.border}`,borderRadius:8,padding:10}}>
                    {visibleGudangList.length===0 && <span style={{fontSize:12,color:C.muted}}>Belum ada Master Gudang.</span>}
                    {visibleGudangList.map(g=>{
                      const sel = (akunForm.gudangIds||[]).includes(g.id);
                      return (
                        <label key={g.id} style={{display:"flex",alignItems:"center",gap:6,fontSize:12,cursor:"pointer",padding:"4px 8px",borderRadius:6,background:sel?"#e0f2fe":"transparent",border:`1px solid ${sel?"#0369a1":C.border}`}}>
                          <input type="checkbox" checked={sel} onChange={()=>setAkunForm(f=>{ const cur=f.gudangIds||[]; return {...f, gudangIds: cur.includes(g.id)?cur.filter(x=>x!==g.id):[...cur,g.id]}; })}/>
                          {g.nama}
                        </label>
                      );
                    })}
                  </div>
                </div>
                <div style={{display:"flex",gap:10}}>
                  <button style={{...sty.btn("ghost"),flex:1}} onClick={()=>setAkunModal(null)} disabled={akunBusy}>Batal</button>
                  <button style={{...sty.btn("primary"),flex:2,opacity:akunBusy?0.6:1}} onClick={akunModal==="edit"?submitAkunEdit:submitAkunBaru} disabled={akunBusy}>{akunBusy?(akunModal==="edit"?"Menyimpan...":"Mendaftarkan..."):(akunModal==="edit"?"💾 Simpan Perubahan":"💾 Daftarkan")}</button>
                </div>
              </>
            )}
          </div>
        </div>
  );
}

export function GantiPasswordModal({ setGantiPasswordModal, gantiPasswordForm, setGantiPasswordForm, gantiPasswordBusy, submitGantiPassword, sty }) {
  return (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000,padding:16}}>
          <div style={{...sty.card,width:400,maxWidth:"100%",maxHeight:"90dvh",overflowY:"auto"}}>
            <div style={sty.modalHeader}><span style={{fontWeight:800,fontSize:15}}>🔑 Ganti Password</span><button onClick={()=>setGantiPasswordModal(false)} style={{background:"transparent",border:"none",color:"white",fontSize:24,lineHeight:1,cursor:"pointer",padding:0,opacity:0.85}}>×</button></div>
            <div style={{marginBottom:12}}>
              <label style={sty.label}>Password Lama</label>
              <input type="password" style={sty.input} value={gantiPasswordForm.oldPassword||""} onChange={e=>setGantiPasswordForm(f=>({...f,oldPassword:e.target.value}))}/>
            </div>
            <div style={{marginBottom:12}}>
              <label style={sty.label}>Password Baru</label>
              <input type="password" style={sty.input} value={gantiPasswordForm.newPassword||""} onChange={e=>setGantiPasswordForm(f=>({...f,newPassword:e.target.value}))} placeholder="minimal 6 karakter"/>
            </div>
            <div style={{marginBottom:16}}>
              <label style={sty.label}>Konfirmasi Password Baru</label>
              <input type="password" style={sty.input} value={gantiPasswordForm.confirmPassword||""} onChange={e=>setGantiPasswordForm(f=>({...f,confirmPassword:e.target.value}))}/>
            </div>
            <div style={{display:"flex",gap:10}}>
              <button style={{...sty.btn("ghost"),flex:1}} onClick={()=>setGantiPasswordModal(false)} disabled={gantiPasswordBusy}>Batal</button>
              <button style={{...sty.btn("primary"),flex:2,opacity:gantiPasswordBusy?0.6:1}} onClick={submitGantiPassword} disabled={gantiPasswordBusy}>{gantiPasswordBusy?"Menyimpan...":"💾 Simpan Password Baru"}</button>
            </div>
          </div>
        </div>
  );
}
