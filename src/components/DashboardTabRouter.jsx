import React from "react";
import { hasRole } from "../lib/roles.js";
import { fmtDate } from "../lib/utils.js";
import { ExecOverview } from "./ExecOverview.jsx";
import { DashboardDefault } from "./DashboardDefault.jsx";
import { DashboardAsman } from "./DashboardAsman.jsx";
import { DashboardManager } from "./DashboardManager.jsx";
import { DashboardMaturityBanner } from "./DashboardMaturityBanner.jsx";
import { DashboardRingkasanBlock } from "./DashboardRingkasanBlock.jsx";

export function DashboardTabRouter(props) {
  const {
    C, sty, currentUser, isMobile,
    maturityAssessments, MATURITY_LEVELS, WAREHOUSE, setMaturityForm, setMaturityModal,
    dashTab, setDashTab,
    totalVal, lowStocks, forecastSoon, myPendingApprovals,
    stockCountPendingCount, attbPendingCount, attbBelumLanjutCount, stockCountList,
    setTab, setOpnameSubTab,
    enrichedStocks, txns, katalogList, uptList, lokasiList, rencanaKedatanganList,
    topN, setTopN, pemakaianMode, setPemakaianMode,
    heavyEquipmentList, heavyEquipmentLoans, attbList, attbBongkaranPool,
    materialCadangData, gudangList, petaWilayahDivRef,
  } = props;
  return (
    <>
      <div className="dashboard-command">
        <DashboardMaturityBanner
          maturity={maturityAssessments[0]||null}
          levelLabel={maturityAssessments[0]?MATURITY_LEVELS[maturityAssessments[0].level]:""}
          warehouse={WAREHOUSE}
          canAssess={hasRole(currentUser,"ADMIN")}
          formatDate={fmtDate}
          onAssess={()=>{const latest=maturityAssessments[0];setMaturityForm({level:latest?.level||3,catatan:"",tanggalAsesmen:Date.now()});setMaturityModal(true);}}
        />
        <div className="dashboard-mode-switch" role="tablist" aria-label="Tampilan dashboard">
          {[{id:"ringkasan",label:"Ringkasan & Kinerja",caption:"KPI, peta, dan prioritas"},{id:"detail",label:"Overview Gudang",caption:"Stok dan aktivitas operasional"}].map(item=>(
            <button key={item.id} className={dashTab===item.id?"is-active":""} onClick={()=>setDashTab(item.id)} role="tab" aria-selected={dashTab===item.id}>
              <strong>{item.label}</strong><span>{item.caption}</span>
            </button>
          ))}
        </div>
      </div>
      {hasRole(currentUser, "MANAGER") && (
        <>
        {dashTab==="ringkasan" ? (
          <ExecOverview totalVal={totalVal} kritisMaterials={lowStocks} forecastSoon={forecastSoon} approvalCount={myPendingApprovals.length} stockCountPendingCount={stockCountPendingCount} attbActionCount={attbPendingCount+attbBelumLanjutCount} akurasi={stockCountList[0]?.summary?.akuratPct ?? null} maturity={maturityAssessments[0]||null} setTab={setTab} setOpnameSubTab={setOpnameSubTab} C={C} sty={sty} isMobile={isMobile}/>
        ) : (
        <DashboardManager
          stocks={enrichedStocks} txns={txns} katalogList={katalogList}
          uptList={uptList} rencanaKedatanganList={rencanaKedatanganList}
          myPendingApprovals={myPendingApprovals}
          topN={topN} setTopN={setTopN}
          pemakaianMode={pemakaianMode} setPemakaianMode={setPemakaianMode}
          C={C} sty={sty} setTab={setTab}
          heavyEquipmentList={heavyEquipmentList} heavyEquipmentLoans={heavyEquipmentLoans}
          currentUser={currentUser}
          attbList={attbList} attbBongkaranPool={attbBongkaranPool}
          isMobile={isMobile}
        />
        )}
        </>
      )}
      {hasRole(currentUser, "ASMAN") && !hasRole(currentUser, "MANAGER") && (
        <>
        {dashTab==="ringkasan" ? (
          <ExecOverview totalVal={totalVal} kritisMaterials={lowStocks} forecastSoon={forecastSoon} approvalCount={myPendingApprovals.length} stockCountPendingCount={stockCountPendingCount} attbActionCount={attbPendingCount+attbBelumLanjutCount} akurasi={stockCountList[0]?.summary?.akuratPct ?? null} maturity={maturityAssessments[0]||null} setTab={setTab} setOpnameSubTab={setOpnameSubTab} C={C} sty={sty} isMobile={isMobile}/>
        ) : (
        <DashboardAsman
          stocks={enrichedStocks} txns={txns} katalogList={katalogList}
          rencanaKedatanganList={rencanaKedatanganList}
          myPendingApprovals={myPendingApprovals}
          topN={topN} setTopN={setTopN}
          pemakaianMode={pemakaianMode} setPemakaianMode={setPemakaianMode}
          C={C} sty={sty} setTab={setTab}
          heavyEquipmentList={heavyEquipmentList} heavyEquipmentLoans={heavyEquipmentLoans}
          currentUser={currentUser}
          attbList={attbList} attbBongkaranPool={attbBongkaranPool}
          isMobile={isMobile}
        />
        )}
        </>
      )}
      {!hasRole(currentUser, "MANAGER","ASMAN") && (
        <>
        {dashTab==="ringkasan" && (
          <ExecOverview totalVal={totalVal} kritisMaterials={lowStocks} forecastSoon={forecastSoon} approvalCount={myPendingApprovals.length} stockCountPendingCount={stockCountPendingCount} attbActionCount={attbPendingCount+attbBelumLanjutCount} akurasi={stockCountList[0]?.summary?.akuratPct ?? null} maturity={maturityAssessments[0]||null} setTab={setTab} setOpnameSubTab={setOpnameSubTab} C={C} sty={sty} isMobile={isMobile}/>
        )}

        {dashTab==="detail" && (
        <DashboardDefault
          stocks={enrichedStocks} txns={txns} katalogList={katalogList} lokasiList={lokasiList}
          rencanaKedatanganList={rencanaKedatanganList}
          myPendingApprovals={myPendingApprovals}
          lowStocks={lowStocks} totalVal={totalVal}
          topN={topN} setTopN={setTopN}
          pemakaianMode={pemakaianMode} setPemakaianMode={setPemakaianMode}
          C={C} sty={sty} setTab={setTab} currentUser={currentUser}
          heavyEquipmentList={heavyEquipmentList} heavyEquipmentLoans={heavyEquipmentLoans}
          materialCadangData={materialCadangData}
          attbList={attbList} attbBongkaranPool={attbBongkaranPool}
          isMobile={isMobile}
        />
        )}
      </>
      )}

      {dashTab==="ringkasan" && (
        <DashboardRingkasanBlock
          C={C} currentUser={currentUser} gudangList={gudangList}
          petaWilayahDivRef={petaWilayahDivRef} stockCountList={stockCountList}
          setTab={setTab} setOpnameSubTab={setOpnameSubTab}
        />
      )}
    </>
  );
}
