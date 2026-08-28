// Komponen KapasitasGudangTab — dipindah dari App.jsx (refactor Fase 5a).
import { useState } from "react";
import { ChartBar, WarningCircle, Warehouse, ArrowsClockwise } from "@phosphor-icons/react";
import { KAPASITAS_LABEL, UIT, UPT } from "../constants.js";
import { fmtNum } from "../lib/ragShared.mjs";
import { hasRole, getScopeUptIds } from "../lib/roles.js";
import { supabase } from "../supabaseClient.js";
import { PetaGudangTab } from "./PetaGudangTab.jsx";

// Threshold status kapasitas — sama dengan KapasitasGudangImportTab.jsx (revalidateRecord).
function statusFromUtil(pct) {
  if (pct >= 0.90) return "KRITIS";
  if (pct >= 0.75) return "WASPADA";
  return "AMAN";
}

export function KapasitasGudangTab({ gudangCapacityList, gudangCapacityImports=[], gudangList, subGudangList, lokasiList, stocks, currentUser, uptList=[], sty, C, setTab, setStockSubTab, showToast, onSynced, onSaveCapacityRow }) {
  const [subTab, setSubTab] = useState("dashboard");
  const [filterUPT, setFilterUPT] = useState("ALL");
  const [petaUptFilter, setPetaUptFilter] = useState(""); // "" = semua; peta pakai uptId (gudang.uptId)
  const [filterStatus, setFilterStatus] = useState("ALL");
  const [detailRecord, setDetailRecord] = useState(null);
  const [editRecord, setEditRecord] = useState(null);
  const [syncing, setSyncing] = useState(false);

  const canEdit = hasRole(currentUser, "ADMIN","TL","SUPERADMIN");
  const pendingImports = gudangCapacityImports.filter(item=>item.status==="PENDING_ASMAN").length;

  function saveEditRecord() {
    const luasLahanM2 = Number(editRecord.luasLahanM2)||0;
    const luasTerpakaiM2 = Number(editRecord.luasTerpakaiM2)||0;
    const sisaLuasM2 = luasLahanM2 - luasTerpakaiM2;
    const persentaseTerpakai = luasLahanM2 > 0 ? luasTerpakaiM2/luasLahanM2 : 0;
    const updated = { ...editRecord, luasLahanM2, luasTerpakaiM2, sisaLuasM2, persentaseTerpakai, statusKapasitas: statusFromUtil(persentaseTerpakai) };
    onSaveCapacityRow?.(updated);
    setEditRecord(null);
    if (detailRecord?.id === updated.id) setDetailRecord(updated);
  }

  async function syncFromSheet() {
    if (syncing) return;
    if (!confirm("Sinkron data kapasitas dari Google Sheet? Data kapasitas akan diperbarui.")) return;
    setSyncing(true);
    try {
      const { data, error } = await supabase.functions.invoke("sync-kapasitas", { method: "POST" });
      const err = error || data?.error;
      if (err) {
        showToast("Gagal sinkron: " + (data?.error || error?.message || String(err)), "error");
        return;
      }
      showToast(`Sinkron berhasil: ${data.kapasitas} kapasitas, ${data.gudang} gudang, ${data.sub_gudang} sub-gudang.`, "success");
      await onSynced?.();
    } catch (e) {
      showToast("Gagal sinkron: " + e.message, "error");
    } finally {
      setSyncing(false);
    }
  }

  // Daftar UPT unik dari data (string label, bukan Master UPT)
  const uptLabelList = [...new Set(gudangCapacityList.map(r=>r.upt))].sort();

  const filtered = gudangCapacityList.filter(r =>
    (filterUPT==="ALL" || r.upt===filterUPT) &&
    (filterStatus==="ALL" || r.statusKapasitas===filterStatus)
  );
  // Peta Utilisasi filter per-UPT untuk viewer multi-UPT (UIT/Pusat). Opsi dari SCOPE viewer
  // (getScopeUptIds) bukan dari data kapasitas yang ada — supaya UPT tanpa data kapasitas tetap
  // bisa dipilih (konsisten pola stockUptFilterOptions). Filter gudang peta by gudang.uptId.
  const petaScope = getScopeUptIds(currentUser, uptList);
  const petaUptOptions = petaScope === null ? uptList
    : (Array.isArray(petaScope) && petaScope.length > 1 ? uptList.filter(u => petaScope.includes(u.id)) : []);
  const petaGudangList = petaUptFilter ? gudangList.filter(g => g.uptId === petaUptFilter) : gudangList;

  // KPI aggregat
  const totalLahan = gudangCapacityList.reduce((s,r)=>s+r.luasLahanM2,0);
  const totalTerpakai = gudangCapacityList.reduce((s,r)=>s+r.luasTerpakaiM2,0);
  const totalSisa = totalLahan - totalTerpakai;
  const utilTotal = totalLahan > 0 ? totalTerpakai / totalLahan : 0;
  const kritis = gudangCapacityList.filter(r=>r.statusKapasitas==="KRITIS").length;
  const waspada = gudangCapacityList.filter(r=>r.statusKapasitas==="WASPADA").length;
  const aman = gudangCapacityList.filter(r=>r.statusKapasitas==="AMAN").length;

  // Ranking UPT (weighted utilization)
  const uptRanking = Object.entries(
    gudangCapacityList.reduce((acc,r) => {
      if (!acc[r.upt]) acc[r.upt] = {lahan:0,terpakai:0};
      acc[r.upt].lahan += r.luasLahanM2;
      acc[r.upt].terpakai += r.luasTerpakaiM2;
      return acc;
    }, {})
  ).map(([upt,v])=>({upt, util: v.lahan>0?v.terpakai/v.lahan:0, lahan:v.lahan, terpakai:v.terpakai}))
   .sort((a,b)=>b.util-a.util);

  const TABS = [
    {id:"dashboard",label:"Ringkasan Kapasitas",caption:"KPI dan tingkat utilisasi"},
    {id:"data",label:"Data Kapasitas Gudang",caption:"Daftar luas dan pemakaian"},
    {id:"peta",label:"Peta Utilisasi",caption:"Sebaran kapasitas gudang"},
  ];

  return (
    <div className="workspace-page capacity-page">
      <section className="kpi-banner capacity-summary-banner" aria-label="Ringkasan kapasitas gudang">
        <div className="capacity-summary-banner__header">
          <div><span>Warehouse capacity</span><strong>Data Kapasitas Gudang</strong></div>
          <small>Laporan utilisasi luas gudang berbasis m² — UIT JBM</small>
          {hasRole(currentUser, "ADMIN") && (
            <button style={sty.btn("ghost","sm")} disabled={syncing} onClick={syncFromSheet} aria-label="Sinkron dari Sheet">
              <ArrowsClockwise size={14} weight="fill" aria-hidden style={{verticalAlign:"-0.15em",marginRight:6}} className={syncing?"capacity-spin":""}/>
              {syncing ? "Menyinkron…" : "Sinkron dari Sheet"}
            </button>
          )}
        </div>
        {gudangCapacityList.length > 0 && (
          <div className="capacity-summary-banner__metrics">
            {[
              {label:"Total Luas Lahan",val:fmtNum(Math.round(totalLahan))+" m²"},
              {label:"Total Terpakai",val:fmtNum(Math.round(totalTerpakai))+" m²"},
              {label:"Sisa Luas",val:fmtNum(Math.round(totalSisa))+" m²"},
              {label:"Utilization Total",val:(utilTotal*100).toFixed(1)+"%",cls:utilTotal>=0.9?"is-danger":utilTotal>=0.75?"is-alert":""},
              {label:"Penuh (≥90%)",val:kritis,cls:"is-danger"},
              {label:"Terbatas (75-89%)",val:waspada,cls:"is-alert"},
              {label:"Cukup (<75%)",val:aman,cls:"is-ok"},
            ].map(kpi=>(
              <div key={kpi.label} className={`kpi-banner__item${kpi.cls?" "+kpi.cls:""}`}>
                <strong>{kpi.val}</strong><span>{kpi.label}</span>
              </div>
            ))}
          </div>
        )}
      </section>
      <div className="capacity-tabs" role="tablist" aria-label="Tampilan kapasitas gudang">
        {TABS.map(t=>(
          <button key={t.id} className={subTab===t.id?"is-active":""} onClick={()=>setSubTab(t.id)} role="tab" aria-selected={subTab===t.id}>
            <strong>{t.label}</strong><span>{t.caption}</span>
          </button>
        ))}
      </div>

      <div className="capacity-content" style={{position:"relative"}}>
      {syncing && (
        <div className="capacity-skeleton-overlay" style={{position:"absolute",inset:0,zIndex:10,background:"rgba(255,255,255,0.85)",display:"flex",flexDirection:"column",alignItems:"center",paddingTop:24}}>
          <div style={{fontSize:12,fontWeight:700,color:C.muted,marginBottom:16}}>Menyinkron data kapasitas…</div>
          <div style={{width:"100%",maxWidth:900,padding:"0 16px"}}>
            {[0,1,2,3,4].map(i=>(
              <div key={i} className="capacity-skeleton" style={{height:16,background:"#eef2f7",borderRadius: 10,marginBottom:10}}/>
            ))}
          </div>
        </div>
      )}
      {/* DASHBOARD */}
      {subTab==="dashboard" && (
        <div>
          {gudangCapacityList.length === 0 ? (
            <div style={{...sty.card,textAlign:"center",padding:40,color:C.muted}}>
              <Warehouse size={40} weight="regular" aria-hidden style={{color:C.muted,marginBottom:12}}/>
              <div style={{fontWeight:700,fontSize:15,marginBottom:8}}>Data kapasitas gudang belum tersedia</div>
              <div style={{fontSize:13,marginBottom:8}}>
                {pendingImports>0
                  ? `${pendingImports} file import masih menunggu approval Asman. Data akan tampil setelah import disetujui.`
                  : "Belum ada record kapasitas live. Import file KAPASITAS GUDANG UIT JBM.xlsx melalui Master Data → Master Gudang."}
              </div>
              <div style={{fontSize:12,marginBottom:20,color:C.muted}}>Sumber halaman ini adalah data import yang sudah berstatus disetujui, bukan file draft.</div>
              {canEdit && <button style={sty.btn("primary")} onClick={()=>{setTab("master");setStockSubTab("gudang");}}>Buka Master Gudang untuk Import</button>}
            </div>
          ) : (
            <div>
              <div className="capacity-ranking-grid" style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16,marginBottom:16}}>
                <div style={{...sty.card}}>
                  <div style={{fontWeight:700,marginBottom:10}}><ChartBar size={15} weight="fill" aria-hidden style={{verticalAlign:"-0.15em",marginRight:6,color:C.muted}}/>Ranking UPT (Utilisasi)</div>
                  {uptRanking.map((u,i)=>(
                    <div key={u.upt} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"8px 0",borderBottom:`1px solid ${C.border}`}}>
                      <div>
                        <div style={{fontWeight:700,fontSize:12}}>#{i+1} {u.upt}</div>
                        <div style={{fontSize:12,color:C.muted,fontVariantNumeric:"tabular-nums"}}>{fmtNum(Math.round(u.terpakai))} / {fmtNum(Math.round(u.lahan))} m²</div>
                      </div>
                      <div style={{textAlign:"right"}}>
                        <div style={{fontWeight:800,color:u.util>=0.9?C.red:u.util>=0.75?"#b45309":"#15803d",fontVariantNumeric:"tabular-nums"}}>{(u.util*100).toFixed(1)}%</div>
                        <div style={{width:80,height:6,background:"#e6eaf1",borderRadius: 10,marginTop:3}}>
                          <div style={{width:(u.util*100)+"%",height:"100%",background:u.util>=0.9?C.red:u.util>=0.75?"#f59e0b":C.green,borderRadius: 10}}/>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                <div style={{...sty.card}}>
                  <div style={{fontWeight:700,marginBottom:10}}><WarningCircle size={15} weight="fill" aria-hidden style={{verticalAlign:"-0.15em",marginRight:6,color:"#dc2626"}}/>Sub-Gudang Paling Penuh</div>
                  {gudangCapacityList.filter(r=>r.statusKapasitas==="KRITIS").sort((a,b)=>b.persentaseTerpakai-a.persentaseTerpakai).slice(0,8).map((r,i)=>(
                    <div key={i} style={{padding:"7px 0",borderBottom:`1px solid ${C.border}`}}>
                      <div style={{display:"flex",justifyContent:"space-between"}}>
                        <div style={{fontSize:12,fontWeight:600}}>{r.subGudang}</div>
                        <span style={{color:C.red,fontWeight:800,fontSize:12}}>{(r.persentaseTerpakai*100).toFixed(1)}%</span>
                      </div>
                      <div style={{fontSize:12,color:C.muted}}>{r.upt} — {r.gudang}</div>
                    </div>
                  ))}
                  {gudangCapacityList.filter(r=>r.statusKapasitas==="KRITIS").length===0 && <div style={{color:C.muted,fontSize:12}}>Tidak ada sub-gudang penuh saat ini.</div>}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* DATA KAPASITAS */}
      {subTab==="data" && (
        <div>
          <div className="capacity-filterbar" style={{display:"flex",gap:8,marginBottom:12,flexWrap:"wrap"}}>
            <select style={{...sty.select,maxWidth:180}} value={filterUPT} onChange={e=>setFilterUPT(e.target.value)}>
              <option value="ALL">Semua UPT</option>
              {uptLabelList.map(u=><option key={u}>{u}</option>)}
            </select>
            <select style={{...sty.select,maxWidth:180}} value={filterStatus} onChange={e=>setFilterStatus(e.target.value)}>
              <option value="ALL">Semua Status</option>
              <option value="KRITIS">Penuh</option>
              <option value="WASPADA">Terbatas</option>
              <option value="AMAN">Cukup</option>
            </select>
            <span style={{color:C.muted,fontSize:12,alignSelf:"center"}}>{filtered.length} record</span>
          </div>
          <div className="capacity-data-list" style={{...sty.card,padding:0,overflowX:"auto"}}>
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:12,minWidth:900}}>
              <thead style={{background:C.sidebar,color:"white"}}>
                <tr>
                  {["UPT","Gudang","Sub Gudang","Luas Lahan (m²)","Terpakai (m²)","Sisa (m²)","Utilisasi","Status","Diperbarui","Detail"].map(h=>(
                    <th key={h} style={{padding:"8px 10px",textAlign:"left",whiteSpace:"nowrap"}}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((r,i)=>(
                  <tr className="capacity-data-card" key={i} style={{borderBottom:`1px solid ${C.border}`,background:r.statusKapasitas==="KRITIS"?"#fef2f2":r.statusKapasitas==="WASPADA"?"#fefce8":"white"}}>
                    <td data-label="UPT" style={{padding:"6px 10px",fontWeight:700}}>{r.upt}</td>
                    <td data-label="Gudang" style={{padding:"6px 10px"}}>{r.gudang}</td>
                    <td data-label="Sub Gudang" style={{padding:"6px 10px",fontWeight:600}}>{r.subGudang}</td>
                    <td data-label="Luas" style={{padding:"6px 10px",textAlign:"right"}}>{fmtNum(Math.round(r.luasLahanM2))} m²</td>
                    <td data-label="Terpakai" style={{padding:"6px 10px",textAlign:"right"}}>{fmtNum(Math.round(r.luasTerpakaiM2))} m²</td>
                    <td data-label="Sisa" style={{padding:"6px 10px",textAlign:"right"}}>{fmtNum(Math.round(r.sisaLuasM2))} m²</td>
                    <td data-label="Utilisasi" style={{padding:"6px 10px"}}>
                      <div style={{display:"flex",alignItems:"center",gap:6}}>
                        <div style={{width:60,height:6,background:"#e6eaf1",borderRadius: 10}}>
                          <div style={{width:Math.min(100,(r.persentaseTerpakai*100))+"%",height:"100%",background:r.statusKapasitas==="KRITIS"?C.red:r.statusKapasitas==="WASPADA"?"#f59e0b":C.green,borderRadius: 10}}/>
                        </div>
                        <span style={{fontWeight:700,color:r.statusKapasitas==="KRITIS"?C.red:r.statusKapasitas==="WASPADA"?"#b45309":"#15803d",fontVariantNumeric:"tabular-nums"}}>{(r.persentaseTerpakai*100).toFixed(1)}%</span>
                      </div>
                    </td>
                    <td data-label="Status" style={{padding:"6px 10px"}}>
                      <span style={{padding:"2px 8px",borderRadius:10,fontSize:12,fontWeight:700,background:r.statusKapasitas==="KRITIS"?"#fef2f2":r.statusKapasitas==="WASPADA"?"#fefce8":"#f0fdf4",color:r.statusKapasitas==="KRITIS"?C.red:r.statusKapasitas==="WASPADA"?"#b45309":"#15803d"}}>{KAPASITAS_LABEL[r.statusKapasitas]||r.statusKapasitas}</span>
                    </td>
                    <td data-label="Update" style={{padding:"6px 10px",fontSize:12,color:C.muted}}>{r.waktuUpdate||"-"}</td>
                    <td data-label="Aksi" style={{padding:"6px 10px"}}>
                      <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                        <button style={sty.btn("ghost","sm")} onClick={()=>setDetailRecord(r)}>Detail</button>
                        {canEdit && <button style={sty.btn("ghost","sm")} onClick={()=>setEditRecord({...r})}>Edit</button>}
                      </div>
                    </td>
                  </tr>
                ))}
                {filtered.length===0 && <tr><td colSpan={10} style={{padding:20,textAlign:"center",color:C.muted}}>Tidak ada data</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}


      {/* SUB-TAB PETA GUDANG */}
      {subTab==="peta" && (
        <PetaGudangTab
          gudangList={petaGudangList}
          subGudangList={subGudangList}
          lokasiList={lokasiList}
          stocks={stocks||[]}
          sty={sty} C={C}
          gudangCapacityList={gudangCapacityList}
          uptOptions={petaUptOptions}
          uptFilter={petaUptFilter}
          setUptFilter={setPetaUptFilter}
        />
      )}

      </div>

      {detailRecord && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:2000,padding:20}} onClick={()=>setDetailRecord(null)}>
          <div className="capacity-detail-modal" style={{...sty.card,maxWidth:480,width:"100%",maxHeight:"90dvh",overflowY:"auto"}} onClick={e=>e.stopPropagation()}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12,gap:8}}>
              <h3 style={{fontWeight:800}}>{detailRecord.subGudang}</h3>
              <div style={{display:"flex",gap:6,flexShrink:0,alignItems:"center"}}>
                {canEdit && <button style={sty.btn("ghost","sm")} onClick={()=>setEditRecord({...detailRecord})}>Edit</button>}
                <button onClick={()=>setDetailRecord(null)} aria-label="Tutup" style={{width:36,height:36,minWidth:36,borderRadius:8,border:`1px solid ${C.border}`,background:C.surface||"white",color:C.text,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",lineHeight:1,fontWeight:800,fontSize:15}}>✕</button>
              </div>
            </div>
            {(() => {
              const matchedGudang = gudangList.find(g=>g.id===detailRecord.matchedGudangId);
              const fotoSrc = matchedGudang?.fotoGudang || matchedGudang?.denahImageData || null;
              return fotoSrc ? (
                <img src={fotoSrc} alt="Foto gudang" style={{width:"100%",maxHeight:220,objectFit:"cover",borderRadius: 14,marginBottom:12}}/>
              ) : (
                <div style={{...sty.card,padding:16,textAlign:"center",color:C.muted,fontSize:12,marginBottom:12,background:"#f9fafb"}}>Belum ada foto gudang.</div>
              );
            })()}
            <div className="capacity-detail-grid" style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,fontSize:12,marginBottom:12}}>
              {[["UPT",detailRecord.upt],["Gudang",detailRecord.gudang],["Tipe",detailRecord.typeGudang||"-"],["Alamat",detailRecord.alamat||"-"],
                ["Luas Lahan",fmtNum(Math.round(detailRecord.luasLahanM2))+" m²"],["Terpakai",fmtNum(Math.round(detailRecord.luasTerpakaiM2))+" m²"],
                ["Sisa",fmtNum(Math.round(detailRecord.sisaLuasM2))+" m²"],["Utilisasi",(detailRecord.persentaseTerpakai*100).toFixed(1)+"%"],
                ["Komposisi Persediaan",(detailRecord.persediaanPct*100).toFixed(0)+"%"],["Komposisi Cadang",(detailRecord.cadangPct*100).toFixed(0)+"%"],
                ["Narahubung",detailRecord.contactPerson||"-"],["Diperbarui",detailRecord.waktuUpdate||"-"],
              ].map(([k,v])=>(
                <div key={k} style={{padding:"6px 8px",background:"#f9fafb",borderRadius: 10}}>
                  <div style={{fontSize:12,color:C.muted}}>{k}</div>
                  <div style={{fontWeight:700,marginTop:2}}>{v}</div>
                </div>
              ))}
            </div>
            {detailRecord.keterangan && <div style={{fontSize:12,color:C.muted,marginBottom:8}}>{detailRecord.keterangan}</div>}
            {detailRecord.linkGudang && <a href={detailRecord.linkGudang} target="_blank" rel="noreferrer" style={{fontSize:12,color:C.accent}}>Link Gudang</a>}
          </div>
        </div>
      )}

      {editRecord && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:2100,padding:20}} onClick={()=>setEditRecord(null)}>
          <div className="capacity-detail-modal" style={{...sty.card,maxWidth:480,width:"100%",maxHeight:"90dvh",overflowY:"auto"}} onClick={e=>e.stopPropagation()}>
            <div style={{display:"flex",justifyContent:"space-between",marginBottom:12}}>
              <h3 style={{fontWeight:800}}>Edit Kapasitas — {editRecord.subGudang}</h3>
              <button style={sty.btn("ghost","sm")} onClick={()=>setEditRecord(null)} aria-label="Tutup">✕</button>
            </div>
            <div className="capacity-detail-grid" style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,fontSize:12,marginBottom:12}}>
              <div>
                <label style={sty.label}>Luas Lahan (m²)</label>
                <input style={sty.input} type="number" min={0} value={editRecord.luasLahanM2} onChange={e=>setEditRecord(r=>({...r,luasLahanM2:parseFloat(e.target.value)||0}))}/>
              </div>
              <div>
                <label style={sty.label}>Luas Terpakai (m²)</label>
                <input style={sty.input} type="number" min={0} value={editRecord.luasTerpakaiM2} onChange={e=>setEditRecord(r=>({...r,luasTerpakaiM2:parseFloat(e.target.value)||0}))}/>
              </div>
              <div>
                <label style={sty.label}>Persediaan (%)</label>
                <input style={sty.input} type="number" min={0} max={100} value={Math.round((editRecord.persediaanPct||0)*100)} onChange={e=>setEditRecord(r=>({...r,persediaanPct:(parseFloat(e.target.value)||0)/100}))}/>
              </div>
              <div>
                <label style={sty.label}>Cadang (%)</label>
                <input style={sty.input} type="number" min={0} max={100} value={Math.round((editRecord.cadangPct||0)*100)} onChange={e=>setEditRecord(r=>({...r,cadangPct:(parseFloat(e.target.value)||0)/100}))}/>
              </div>
              <div>
                <label style={sty.label}>Pre-Memory (%)</label>
                <input style={sty.input} type="number" min={0} max={100} value={Math.round((editRecord.preMemoryPct||0)*100)} onChange={e=>setEditRecord(r=>({...r,preMemoryPct:(parseFloat(e.target.value)||0)/100}))}/>
              </div>
              <div>
                <label style={sty.label}>ATTB (%)</label>
                <input style={sty.input} type="number" min={0} max={100} value={Math.round((editRecord.attbPct||0)*100)} onChange={e=>setEditRecord(r=>({...r,attbPct:(parseFloat(e.target.value)||0)/100}))}/>
              </div>
              <div>
                <label style={sty.label}>Lainnya (%)</label>
                <input style={sty.input} type="number" min={0} max={100} value={Math.round((editRecord.lainnyaPct||0)*100)} onChange={e=>setEditRecord(r=>({...r,lainnyaPct:(parseFloat(e.target.value)||0)/100}))}/>
              </div>
              <div>
                <label style={sty.label}>Narahubung</label>
                <input style={sty.input} value={editRecord.contactPerson||""} onChange={e=>setEditRecord(r=>({...r,contactPerson:e.target.value}))}/>
              </div>
            </div>
            <div style={{marginBottom:12}}>
              <label style={sty.label}>Link Gudang</label>
              <input style={sty.input} value={editRecord.linkGudang||""} onChange={e=>setEditRecord(r=>({...r,linkGudang:e.target.value}))}/>
            </div>
            <div style={{marginBottom:16}}>
              <label style={sty.label}>Keterangan</label>
              <textarea style={{...sty.input,minHeight:60}} value={editRecord.keterangan||""} onChange={e=>setEditRecord(r=>({...r,keterangan:e.target.value}))}/>
            </div>
            <div style={{fontSize:12,color:C.muted,marginBottom:12}}>
              Utilisasi baru: <strong>{editRecord.luasLahanM2>0 ? ((editRecord.luasTerpakaiM2/editRecord.luasLahanM2)*100).toFixed(1) : "0.0"}%</strong> ({statusFromUtil(editRecord.luasLahanM2>0?editRecord.luasTerpakaiM2/editRecord.luasLahanM2:0)==="KRITIS"?"Penuh":statusFromUtil(editRecord.luasLahanM2>0?editRecord.luasTerpakaiM2/editRecord.luasLahanM2:0)==="WASPADA"?"Terbatas":"Cukup"})
            </div>
            <div style={{display:"flex",gap:10}}>
              <button style={{...sty.btn("ghost"),flex:1}} onClick={()=>setEditRecord(null)}>Batal</button>
              <button style={{...sty.btn("primary"),flex:2}} onClick={saveEditRecord}>💾 Simpan</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
