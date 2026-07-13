// Komponen KapasitasGudangTab — dipindah dari App.jsx (refactor Fase 5a).
import { useState } from "react";
import { KAPASITAS_LABEL, UIT, UPT } from "../constants.js";
import { fmtNum } from "../lib/ragShared.mjs";
import { hasRole } from "../lib/roles.js";
import { PetaGudangTab } from "./PetaGudangTab.jsx";

export function KapasitasGudangTab({ gudangCapacityList, gudangList, subGudangList, lokasiList, stocks, currentUser, sty, C, setTab, setStockSubTab }) {
  const [subTab, setSubTab] = useState("dashboard");
  const [filterUPT, setFilterUPT] = useState("ALL");
  const [filterStatus, setFilterStatus] = useState("ALL");
  const [detailRecord, setDetailRecord] = useState(null);

  const canEdit = hasRole(currentUser, "ADMIN","TL");

  // Daftar UPT unik dari data (string label, bukan Master UPT)
  const uptLabelList = [...new Set(gudangCapacityList.map(r=>r.upt))].sort();

  const filtered = gudangCapacityList.filter(r =>
    (filterUPT==="ALL" || r.upt===filterUPT) &&
    (filterStatus==="ALL" || r.statusKapasitas===filterStatus)
  );

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
    {id:"dashboard",label:"📊 Dashboard"},
    {id:"data",label:"📋 Data Kapasitas"},
    {id:"peta",label:"🗺️ Peta Utilisasi Gudang"},
  ];

  return (
    <div>
      <div style={{marginBottom:16}}>
        <h1 style={{fontSize:22,fontWeight:900,marginBottom:4}}>📐 Monitoring Kapasitas Gudang</h1>
        <p style={{color:C.muted,fontSize:13}}>Laporan utilization luas gudang berbasis m2 — UIT JBM</p>
      </div>
      <div style={{display:"flex",gap:8,marginBottom:16,flexWrap:"wrap"}}>
        {TABS.map(t=>(
          <button key={t.id} style={{padding:"8px 16px",borderRadius:8,border:`1px solid ${subTab===t.id?C.accent:C.border}`,background:subTab===t.id?C.accent:"white",color:subTab===t.id?"white":C.muted,fontWeight:700,fontSize:12,cursor:"pointer"}}
            onClick={()=>setSubTab(t.id)}>{t.label}</button>
        ))}
      </div>

      {/* DASHBOARD */}
      {subTab==="dashboard" && (
        <div>
          {gudangCapacityList.length === 0 ? (
            <div style={{...sty.card,textAlign:"center",padding:40,color:C.muted}}>
              <div style={{fontSize:40,marginBottom:12}}>📐</div>
              <div style={{fontWeight:700,fontSize:16,marginBottom:8}}>Data kapasitas gudang belum tersedia</div>
              <div style={{fontSize:13,marginBottom:20}}>Import file KAPASITAS GUDANG UIT JBM.xlsx di menu Master Data → Master Gudang</div>
              {canEdit && <button style={sty.btn("primary")} onClick={()=>{setTab("master");setStockSubTab("gudang");}}>📥 Buka Master Gudang untuk Import</button>}
            </div>
          ) : (
            <div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(160px,1fr))",gap:12,marginBottom:16}}>
                {[
                  {label:"Total Luas Lahan",val:fmtNum(Math.round(totalLahan))+" m²",color:C.accent},
                  {label:"Total Terpakai",val:fmtNum(Math.round(totalTerpakai))+" m²",color:"#7c3aed"},
                  {label:"Sisa Luas",val:fmtNum(Math.round(totalSisa))+" m²",color:C.green},
                  {label:"Utilization Total",val:(utilTotal*100).toFixed(1)+"%",color:utilTotal>=0.9?C.red:utilTotal>=0.75?"#f59e0b":C.green},
                  {label:"🔴 Penuh (≥90%)",val:kritis,color:C.red},
                  {label:"🟡 Terbatas (75-89%)",val:waspada,color:"#f59e0b"},
                  {label:"🟢 Cukup (<75%)",val:aman,color:C.green},
                ].map(kpi=>(
                  <div key={kpi.label} style={{...sty.card,borderTop:`3px solid ${kpi.color}`,padding:14}}>
                    <div style={{fontSize:11,color:C.muted,marginBottom:4}}>{kpi.label}</div>
                    <div style={{fontSize:16,fontWeight:800,color:kpi.color}}>{kpi.val}</div>
                  </div>
                ))}
              </div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16,marginBottom:16}}>
                <div style={{...sty.card}}>
                  <div style={{fontWeight:700,marginBottom:10}}>🏆 Ranking UPT (Utilization)</div>
                  {uptRanking.map((u,i)=>(
                    <div key={u.upt} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"8px 0",borderBottom:`1px solid ${C.border}`}}>
                      <div>
                        <div style={{fontWeight:700,fontSize:12}}>#{i+1} {u.upt}</div>
                        <div style={{fontSize:10,color:C.muted}}>{fmtNum(Math.round(u.terpakai))} / {fmtNum(Math.round(u.lahan))} m²</div>
                      </div>
                      <div style={{textAlign:"right"}}>
                        <div style={{fontWeight:800,color:u.util>=0.9?C.red:u.util>=0.75?"#f59e0b":C.green}}>{(u.util*100).toFixed(1)}%</div>
                        <div style={{width:80,height:6,background:"#e5e7eb",borderRadius:3,marginTop:3}}>
                          <div style={{width:(u.util*100)+"%",height:"100%",background:u.util>=0.9?C.red:u.util>=0.75?"#f59e0b":C.green,borderRadius:3}}/>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                <div style={{...sty.card}}>
                  <div style={{fontWeight:700,marginBottom:10}}>🔴 Sub-Gudang Paling Penuh</div>
                  {gudangCapacityList.filter(r=>r.statusKapasitas==="KRITIS").sort((a,b)=>b.persentaseTerpakai-a.persentaseTerpakai).slice(0,8).map((r,i)=>(
                    <div key={i} style={{padding:"7px 0",borderBottom:`1px solid ${C.border}`}}>
                      <div style={{display:"flex",justifyContent:"space-between"}}>
                        <div style={{fontSize:12,fontWeight:600}}>{r.subGudang}</div>
                        <span style={{color:C.red,fontWeight:800,fontSize:12}}>{(r.persentaseTerpakai*100).toFixed(1)}%</span>
                      </div>
                      <div style={{fontSize:10,color:C.muted}}>{r.upt} — {r.gudang}</div>
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
          <div style={{display:"flex",gap:8,marginBottom:12,flexWrap:"wrap"}}>
            <select style={{...sty.select,maxWidth:180}} value={filterUPT} onChange={e=>setFilterUPT(e.target.value)}>
              <option value="ALL">Semua UPT</option>
              {uptLabelList.map(u=><option key={u}>{u}</option>)}
            </select>
            <select style={{...sty.select,maxWidth:180}} value={filterStatus} onChange={e=>setFilterStatus(e.target.value)}>
              <option value="ALL">Semua Status</option>
              <option value="KRITIS">🔴 Penuh</option>
              <option value="WASPADA">🟡 Terbatas</option>
              <option value="AMAN">🟢 Cukup</option>
            </select>
            <span style={{color:C.muted,fontSize:12,alignSelf:"center"}}>{filtered.length} record</span>
          </div>
          <div style={{...sty.card,padding:0,overflowX:"auto"}}>
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:11,minWidth:900}}>
              <thead style={{background:C.sidebar,color:"white"}}>
                <tr>
                  {["UPT","Gudang","Sub Gudang","Luas Lahan (m²)","Terpakai (m²)","Sisa (m²)","Utilization","Status","Update","Detail"].map(h=>(
                    <th key={h} style={{padding:"8px 10px",textAlign:"left",whiteSpace:"nowrap"}}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((r,i)=>(
                  <tr key={i} style={{borderBottom:`1px solid ${C.border}`,background:r.statusKapasitas==="KRITIS"?"#fef2f2":r.statusKapasitas==="WASPADA"?"#fefce8":"white"}}>
                    <td style={{padding:"6px 10px",fontWeight:700}}>{r.upt}</td>
                    <td style={{padding:"6px 10px"}}>{r.gudang}</td>
                    <td style={{padding:"6px 10px",fontWeight:600}}>{r.subGudang}</td>
                    <td style={{padding:"6px 10px",textAlign:"right"}}>{fmtNum(Math.round(r.luasLahanM2))}</td>
                    <td style={{padding:"6px 10px",textAlign:"right"}}>{fmtNum(Math.round(r.luasTerpakaiM2))}</td>
                    <td style={{padding:"6px 10px",textAlign:"right"}}>{fmtNum(Math.round(r.sisaLuasM2))}</td>
                    <td style={{padding:"6px 10px"}}>
                      <div style={{display:"flex",alignItems:"center",gap:6}}>
                        <div style={{width:60,height:6,background:"#e5e7eb",borderRadius:3}}>
                          <div style={{width:Math.min(100,(r.persentaseTerpakai*100))+"%",height:"100%",background:r.statusKapasitas==="KRITIS"?C.red:r.statusKapasitas==="WASPADA"?"#f59e0b":C.green,borderRadius:3}}/>
                        </div>
                        <span style={{fontWeight:700,color:r.statusKapasitas==="KRITIS"?C.red:r.statusKapasitas==="WASPADA"?"#f59e0b":C.green}}>{(r.persentaseTerpakai*100).toFixed(1)}%</span>
                      </div>
                    </td>
                    <td style={{padding:"6px 10px"}}>
                      <span style={{padding:"2px 8px",borderRadius:10,fontSize:10,fontWeight:700,background:r.statusKapasitas==="KRITIS"?"#fef2f2":r.statusKapasitas==="WASPADA"?"#fefce8":"#f0fdf4",color:r.statusKapasitas==="KRITIS"?C.red:r.statusKapasitas==="WASPADA"?"#92400e":C.green}}>{KAPASITAS_LABEL[r.statusKapasitas]||r.statusKapasitas}</span>
                    </td>
                    <td style={{padding:"6px 10px",fontSize:10,color:C.muted}}>{r.waktuUpdate||"-"}</td>
                    <td style={{padding:"6px 10px"}}>
                      <button style={sty.btn("ghost","sm")} onClick={()=>setDetailRecord(r)}>Detail</button>
                    </td>
                  </tr>
                ))}
                {filtered.length===0 && <tr><td colSpan={10} style={{padding:20,textAlign:"center",color:C.muted}}>Tidak ada data</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}


      {/* Detail modal */}
      {/* SUB-TAB PETA GUDANG */}
      {subTab==="peta" && (
        <PetaGudangTab
          gudangList={gudangList}
          subGudangList={subGudangList}
          lokasiList={lokasiList}
          stocks={stocks||[]}
          sty={sty} C={C}
          currentUser={currentUser}
          gudangCapacityList={gudangCapacityList}
        />
      )}

      {detailRecord && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:2000,padding:20}} onClick={()=>setDetailRecord(null)}>
          <div style={{...sty.card,maxWidth:480,width:"100%",maxHeight:"90vh",overflowY:"auto"}} onClick={e=>e.stopPropagation()}>
            <div style={{display:"flex",justifyContent:"space-between",marginBottom:12}}>
              <h3 style={{fontWeight:800}}>{detailRecord.subGudang}</h3>
              <button style={sty.btn("ghost","sm")} onClick={()=>setDetailRecord(null)}>✕</button>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,fontSize:12,marginBottom:12}}>
              {[["UPT",detailRecord.upt],["Gudang",detailRecord.gudang],["Type",detailRecord.typeGudang||"-"],["Alamat",detailRecord.alamat||"-"],
                ["Luas Lahan",fmtNum(Math.round(detailRecord.luasLahanM2))+" m²"],["Terpakai",fmtNum(Math.round(detailRecord.luasTerpakaiM2))+" m²"],
                ["Sisa",fmtNum(Math.round(detailRecord.sisaLuasM2))+" m²"],["Utilization",(detailRecord.persentaseTerpakai*100).toFixed(1)+"%"],
                ["Komposisi Persediaan",(detailRecord.persediaanPct*100).toFixed(0)+"%"],["Komposisi Cadang",(detailRecord.cadangPct*100).toFixed(0)+"%"],
                ["Contact Person",detailRecord.contactPerson||"-"],["Waktu Update",detailRecord.waktuUpdate||"-"],
              ].map(([k,v])=>(
                <div key={k} style={{padding:"6px 8px",background:"#f9fafb",borderRadius:6}}>
                  <div style={{fontSize:10,color:C.muted}}>{k}</div>
                  <div style={{fontWeight:700,marginTop:2}}>{v}</div>
                </div>
              ))}
            </div>
            {detailRecord.keterangan && <div style={{fontSize:12,color:C.muted,marginBottom:8}}>📝 {detailRecord.keterangan}</div>}
            {detailRecord.linkGudang && <a href={detailRecord.linkGudang} target="_blank" rel="noreferrer" style={{fontSize:12,color:C.accent}}>🔗 Link Gudang</a>}
          </div>
        </div>
      )}
    </div>
  );
}
