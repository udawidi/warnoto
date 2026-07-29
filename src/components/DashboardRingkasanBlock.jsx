// Komponen DashboardRingkasanBlock — dipindah dari App.jsx (refactor batch 2c).
// Murni relokasi blok dashboard/ringkasan (tab==="dashboard" && dashTab==="ringkasan"); JSX/logic tidak berubah.
import { hasRole } from "../lib/roles.js";
import { fmtDate } from "../lib/utils.js";

export function DashboardRingkasanBlock({
  C, currentUser, gudangList, petaWilayahDivRef, stockCountList,
  setTab, setOpnameSubTab,
}){
  return (
          <div className="dashboard-insight-grid">
            <section className="dashboard-insight-card dashboard-map-card">
              <div className="dashboard-insight-card__header">
                <div>
                  <strong>Peta Wilayah Gudang UPT Surabaya</strong>
                  <span>{gudangList.filter(g=>g.lat!=null&&g.lng!=null).length} dari {gudangList.length} gudang memiliki koordinat GPS</span>
                </div>
                <span className="dashboard-insight-card__badge">Peta operasional</span>
              </div>
              <div ref={petaWilayahDivRef} className="dashboard-map-canvas"/>
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
