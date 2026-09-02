// Komponen DashboardRingkasanBlock — dipindah dari App.jsx (refactor batch 2c).
// Murni relokasi blok dashboard/ringkasan (tab==="dashboard" && dashTab==="ringkasan"); JSX/logic tidak berubah.
import { hasRole } from "../lib/roles.js";
import { fmtDate } from "../lib/utils.js";
import { UPT_MAP_COLOR } from "../theme.js";

export function DashboardRingkasanBlock({
  C, currentUser, gudangList, uptList, uptNama, petaWilayahDivRef, stockCountList,
  setTab, setOpnameSubTab, showAlatBerat, setShowAlatBerat, showLiveAlat, setShowLiveAlat,
}){
  // Legenda warna per-UPT hanya relevan kalau peta memang menampilkan >1 UPT sekaligus
  // (viewer UIT/Pusat) — dicek langsung dari isi gudangList (sudah discope App.jsx),
  // bukan cek tier role terpisah, supaya otomatis benar kalau scoping berubah nanti.
  const mapUptIds = [...new Set(gudangList.map(g=>g.uptId).filter(Boolean))];
  return (
          <div className="dashboard-insight-grid">
            <section className="dashboard-insight-card dashboard-map-card">
              <div className="dashboard-insight-card__header">
                <div>
                  <strong>Peta Wilayah Gudang {uptNama}</strong>
                  <span>{gudangList.filter(g=>g.lat!=null&&g.lng!=null).length} dari {gudangList.length} gudang memiliki koordinat GPS</span>
                </div>
                <label style={{display:"flex",alignItems:"center",gap:5,fontSize:12,color:C.muted,fontWeight:600,cursor:"pointer"}}>
                  <input type="checkbox" checked={!!showAlatBerat} onChange={e=>setShowAlatBerat(e.target.checked)}/>
                  Alat Berat
                </label>
                <label style={{display:"flex",alignItems:"center",gap:5,fontSize:12,color:C.muted,fontWeight:600,cursor:"pointer"}}>
                  <input type="checkbox" checked={!!showLiveAlat} onChange={e=>setShowLiveAlat(e.target.checked)}/>
                  Alat Live
                </label>
                <span className="dashboard-insight-card__badge">Peta operasional</span>
              </div>
              <div ref={petaWilayahDivRef} className="dashboard-map-canvas"/>
              {showLiveAlat && (
                <div style={{display:"flex",flexWrap:"wrap",gap:"6px 14px",padding:"10px 2px 2px",fontSize:12,color:C.muted,fontWeight:600}}>
                  <span>🏗️ Crane</span><span>🚚 Truck</span><span>🛗 Manlift</span>
                </div>
              )}
              {mapUptIds.length>1 && (
                <div style={{display:"flex",flexWrap:"wrap",gap:"6px 14px",padding:"10px 2px 2px"}}>
                  {mapUptIds.map(uptId => (
                    <span key={uptId} style={{display:"flex",alignItems:"center",gap:5,fontSize:12,color:C.muted,fontWeight:600}}>
                      <span style={{width:10,height:10,borderRadius:"50%",background:UPT_MAP_COLOR[uptId]||"#dc2626",display:"inline-block"}}/>
                      {uptList.find(u=>u.id===uptId)?.nama || uptId}
                    </span>
                  ))}
                </div>
              )}
              {gudangList.filter(g=>g.lat==null||g.lng==null).length>0 && hasRole(currentUser, "ADMIN") && (
                <div className="dashboard-insight-card__notice">Ada gudang yang belum memiliki koordinat GPS. Lengkapi melalui Master Data.</div>
              )}
            </section>

            {(()=>{
              const latest = stockCountList[0];
              return (
                <section className="dashboard-insight-card dashboard-performance-card">
                  <div className="dashboard-insight-card__header">
                    <div>
                      <strong>Kinerja Stock Count</strong>
                      <span>Perbandingan SAP dan stok aplikasi</span>
                    </div>
                    <button className="dashboard-text-action" onClick={()=>{setTab("opname");setOpnameSubTab("stockCount");}}>Lihat detail</button>
                  </div>
                  {!latest ? (
                    <div className="dashboard-performance-empty">Belum ada sesi Stock Count. Jalankan unggah CSV SAP dari menu Stock Count.</div>
                  ) : (
                    <>
                      <div className="dashboard-performance-score">
                        <strong style={{color:latest.summary.akuratPct>=90?C.green:latest.summary.akuratPct>=70?C.yellow:C.red}}>{latest.summary.akuratPct}%</strong>
                        <span>Akurasi sesi terakhir</span>
                      </div>
                      <div className="dashboard-performance-meta">
                        <div><strong>{latest.summary.akuratCount}</strong><span>Item akurat</span></div>
                        <div><strong>{latest.summary.totalItem}</strong><span>Total item</span></div>
                        <div><strong>{fmtDate(latest.uploadedAt)}</strong><span>Tanggal sesi</span></div>
                      </div>
                      {latest.items.some(i=>i.approval==="PENDING") && (
                        <div className="dashboard-insight-card__notice">{latest.items.filter(i=>i.approval==="PENDING").length} temuan menunggu approval Asman.</div>
                      )}
                    </>
                  )}
                </section>
              );
            })()}
          </div>
  );
}
