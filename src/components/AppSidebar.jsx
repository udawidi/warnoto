import { UPT } from "../constants.js";
import { PLN_LOGO_DATA_URI } from "../assets/plnLogoBase64.js";
import { hasRole } from "../lib/roles.js";
import { can } from "../lib/perms.js";
import { SidebarNavItem } from "./SidebarNavItem.jsx";
import { SidebarIcon } from "./SidebarIcon.jsx";

export function AppSidebar({
  C, sty, isMobile,
  mobileMenuOpen, setMobileMenuOpen,
  sidebarCompact, setSidebarCollapsed,
  navItems, tab, setTab,
  tugExpanded, setTugExpanded, tugGroup, setTugGroup, setTugSubTab, isUltgRole,
  masterExpanded, setMasterExpanded, stockSubTab, setStockSubTab,
  opnameExpanded, setOpnameExpanded, opnameSubTab, setOpnameSubTab, stockCountPendingCount,
  currentUser, rolePerms,
  cloudSaving, dataRefreshing, lastSaved,
}) {
  return (
    <>
      {/* Overlay gelap di belakang drawer sidebar saat dibuka di HP — tap di luar drawer untuk menutup */}
      {isMobile && mobileMenuOpen && (
        <div className="app-sidebar-overlay" onClick={()=>setMobileMenuOpen(false)}/>
      )}

      {/* SIDEBAR — di desktop tetap menempel di kiri; di HP jadi drawer yang slide-in dari kiri,
          disembunyikan (translateX(-100%)) sampai tombol ☰ ditekan. */}
      <aside className={`app-sidebar${sidebarCompact?" is-collapsed":""}${isMobile?" is-mobile":""}${mobileMenuOpen?" is-open":""}`} style={{
        width:isMobile?"min(86vw, 286px)":sidebarCompact?76:260, background:C.sidebar, display:"flex", flexDirection:"column", flexShrink:0,
        ...(isMobile ? {
          position:"fixed", top:0, left:0, bottom:0, zIndex:1500,
          transform:mobileMenuOpen ? "translateX(0)" : "translateX(-100%)",
          boxShadow:"8px 0 32px rgba(0,0,0,0.28)",
        } : {}),
      }} aria-label="Navigasi utama">
        <div className="app-sidebar__header" style={{padding:sidebarCompact?"14px 12px":"14px",borderBottom:"1px solid rgba(255,255,255,0.12)"}}>
          {sidebarCompact ? (
            <button className="app-sidebar__brand-button" onClick={()=>setSidebarCollapsed(false)} title="Buka sidebar" aria-label="Buka sidebar">
              <img src={PLN_LOGO_DATA_URI} alt="Logo PLN"/>
            </button>
          ) : (
          <div style={{display:"flex",alignItems:"center",gap:11,minWidth:0}}>
            <div className="app-sidebar__brand-mark" style={{width:38,height:38,background:"white",borderRadius:9,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,padding:5,boxShadow:"0 2px 8px rgba(0,0,0,0.22)"}}><img src={PLN_LOGO_DATA_URI} alt="Logo PLN" style={{maxWidth:"100%",maxHeight:"100%",objectFit:"contain"}}/></div>
            <div style={{minWidth:0,lineHeight:1.15,flex:1}}>
              <div style={{color:"white",fontWeight:800,fontSize:17,letterSpacing:".5px"}}>WARNOTO</div>
              <div style={{color:"rgba(255,255,255,0.6)",fontSize:12,letterSpacing:".5px",textTransform:"uppercase",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{UPT}</div>
            </div>
            {isMobile && (
            <button
              className="app-sidebar__toggle"
              onClick={()=>setMobileMenuOpen(false)}
              title="Tutup menu"
              aria-label="Tutup menu"
            ><SidebarIcon name="close" size={17}/></button>
            )}
          </div>
          )}
        </div>
        <div className="app-sidebar__nav" style={{flex:1,padding:sidebarCompact?"12px 10px":"12px 9px",overflowY:"auto",overflowX:"hidden"}}>
          {navItems.map(n => {
            if (n.id === "transaction") {
              // TUG item: accordion parent — click expands, sub-items navigate
              const isActive = tab === "transaction";
              return (
                <div key="transaction">
                  <button
                    className={`sidebar-nav-item sidebar-nav-parent${isActive?" is-active":""}`}
                    style={{minHeight:isMobile?44:undefined}}
                    onClick={()=>{ if(sidebarCompact) { setSidebarCollapsed(false); setTugExpanded(true); } else setTugExpanded(e=>!e); }}
                    title={sidebarCompact?n.label:undefined}
                    aria-label={n.label}
                  >
                    <span className="sidebar-nav-item__icon">{n.icon}</span>
                    {!sidebarCompact && <span className="sidebar-nav-item__label">{n.label}</span>}
                    {!sidebarCompact && <span className="sidebar-nav-item__chevron" style={{transform:tugExpanded?"rotate(90deg)":"rotate(0deg)"}}><SidebarIcon name="chevron" size={14}/></span>}
                  </button>
                  {tugExpanded && !sidebarCompact && (
                    <div className="sidebar-subnav" style={{marginBottom:4}}>
                      {(isUltgRole ? [
                        {id:"permintaan",icon:<SidebarIcon name="request" size={16}/>,label:"Minta Barang",defaultSub:"TUG5"},
                      ] : [
                        {id:"penerimaan",icon:<SidebarIcon name="inbound" size={16}/>,label:"Barang Masuk",defaultSub:"TUG3"},
                        {id:"pengeluaran",icon:<SidebarIcon name="outbound" size={16}/>,label:"Barang Keluar",defaultSub:"TUG9"},
                        {id:"permintaan",icon:<SidebarIcon name="request" size={16}/>,label:"Minta Barang",defaultSub:"TUG5"},
                        {id:"laporan",icon:<SidebarIcon name="report" size={16}/>,label:"Laporan",defaultSub:"TUG15"},
                      ]).map(sub=>{
                        const subActive = isActive && tugGroup===sub.id;
                        return (
                          <button
                            key={sub.id}
                            style={{display:"flex",alignItems:"center",gap:8,width:"100%",padding:"7px 12px 7px 32px",minHeight:isMobile?44:undefined,borderRadius:8,border:"none",cursor:"pointer",background:subActive?"rgba(255,255,255,0.12)":"transparent",color:subActive?"white":"rgba(255,255,255,0.55)",fontSize:12,fontWeight:subActive?700:400,marginBottom:1,textAlign:"left",borderLeft:subActive?"2px solid rgba(255,255,255,0.4)":"2px solid transparent"}}
                            onClick={()=>{setTab("transaction"); setTugGroup(sub.id); setTugSubTab(sub.defaultSub); setMobileMenuOpen(false);}}
                          >
                            <span>{sub.icon}</span> {sub.label}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            }
            if (n.id === "master") {
              // Master Data item: accordion parent — click expands, sub-items navigate
              const isActive = tab === "master";
              return (
                <div key="master">
                  <button
                    className={`sidebar-nav-item sidebar-nav-parent${isActive?" is-active":""}`}
                    style={{minHeight:isMobile?44:undefined}}
                    onClick={()=>{ if(sidebarCompact) { setSidebarCollapsed(false); setMasterExpanded(true); } else setMasterExpanded(e=>!e); }}
                    title={sidebarCompact?n.label:undefined}
                    aria-label={n.label}
                  >
                    <span className="sidebar-nav-item__icon">{n.icon}</span>
                    {!sidebarCompact && <span className="sidebar-nav-item__label">{n.label}</span>}
                    {!sidebarCompact && <span className="sidebar-nav-item__chevron" style={{transform:masterExpanded?"rotate(90deg)":"rotate(0deg)"}}><SidebarIcon name="chevron" size={14}/></span>}
                  </button>
                  {masterExpanded && !sidebarCompact && (
                    <div className="sidebar-subnav" style={{marginBottom:4}}>
                      {(isMobile ? [
                        {id:"katalog",icon:<SidebarIcon name="catalog" size={16}/>,label:"Master Katalog"},
                      ] : [
                        {id:"katalog",icon:<SidebarIcon name="catalog" size={16}/>,label:"Master Katalog"},
                        {id:"satpam",icon:<SidebarIcon name="shield" size={16}/>,label:"Satpam"},
                        {id:"timmutu",icon:<SidebarIcon name="users" size={16}/>,label:"Tim Mutu"},
                        {id:"organisasi",icon:<SidebarIcon name="organization" size={16}/>,label:"Struktur Organisasi"},
                        {id:"gudang",icon:<SidebarIcon name="warehouse" size={16}/>,label:"Master Gudang"},
                        ...(can(currentUser, "aksi.kelolaAkun", rolePerms) ? [{id:"akun",icon:<SidebarIcon name="user" size={16}/>,label:"Kelola Akun"}] : []),
                        ...(hasRole(currentUser, "ADMIN") ? [{id:"migrasi",icon:<SidebarIcon name="migrate" size={16}/>,label:"Migrasi Data"},{id:"auditLog",icon:<SidebarIcon name="shield" size={16}/>,label:"Audit Log"},{id:"perms",icon:<SidebarIcon name="shield" size={16}/>,label:"Matrix Izin"}] : []),
                      ]).map(sub=>{
                        const subActive = isActive && stockSubTab===sub.id;
                        return (
                          <button
                            key={sub.id}
                            style={{display:"flex",alignItems:"center",gap:8,width:"100%",padding:"7px 12px 7px 32px",minHeight:isMobile?44:undefined,borderRadius:8,border:"none",cursor:"pointer",background:subActive?"rgba(255,255,255,0.12)":"transparent",color:subActive?"white":"rgba(255,255,255,0.55)",fontSize:12,fontWeight:subActive?700:400,marginBottom:1,textAlign:"left",borderLeft:subActive?"2px solid rgba(255,255,255,0.4)":"2px solid transparent"}}
                            onClick={()=>{setTab("master"); setStockSubTab(sub.id); setMobileMenuOpen(false);}}
                          >
                            <span>{sub.icon}</span> {sub.label}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            }
            if (n.id === "opname") {
              // Stock Opname & Stock Count digabung 1 menu: accordion parent — click expands, sub-items navigate
              const isActive = tab === "opname";
              return (
                <div key="opname">
                  <button
                    className={`sidebar-nav-item sidebar-nav-parent${isActive?" is-active":""}`}
                    style={{minHeight:isMobile?44:undefined}}
                    onClick={()=>{ if(sidebarCompact) { setSidebarCollapsed(false); setOpnameExpanded(true); } else setOpnameExpanded(e=>!e); }}
                    title={sidebarCompact?n.label:undefined}
                    aria-label={n.label}
                  >
                    <span className="sidebar-nav-item__icon">{n.icon}</span>
                    {!sidebarCompact && <span className="sidebar-nav-item__label">{n.label}</span>}
                    {n.badge>0 && <span className={`sidebar-nav-item__badge${sidebarCompact?" is-compact":""}`}>{n.badge}</span>}
                    {!sidebarCompact && <span className="sidebar-nav-item__chevron" style={{transform:opnameExpanded?"rotate(90deg)":"rotate(0deg)"}}><SidebarIcon name="chevron" size={14}/></span>}
                  </button>
                  {opnameExpanded && !sidebarCompact && (
                    <div className="sidebar-subnav" style={{marginBottom:4}}>
                      {[
                        {id:"opname",icon:<SidebarIcon name="opname" size={16}/>,label:"Stock Opname"},
                        {id:"stockCount",icon:<SidebarIcon name="report" size={16}/>,label:"Stock Count",badge:stockCountPendingCount},
                      ].map(sub=>{
                        const subActive = isActive && opnameSubTab===sub.id;
                        return (
                          <button
                            key={sub.id}
                            style={{display:"flex",alignItems:"center",gap:8,width:"100%",padding:"7px 12px 7px 32px",minHeight:isMobile?44:undefined,borderRadius:8,border:"none",cursor:"pointer",background:subActive?"rgba(255,255,255,0.12)":"transparent",color:subActive?"white":"rgba(255,255,255,0.55)",fontSize:12,fontWeight:subActive?700:400,marginBottom:1,textAlign:"left",borderLeft:subActive?"2px solid rgba(255,255,255,0.4)":"2px solid transparent"}}
                            onClick={()=>{setTab("opname"); setOpnameSubTab(sub.id); setMobileMenuOpen(false);}}
                          >
                            <span>{sub.icon}</span> {sub.label} {sub.badge>0 && <span style={{background:"#dc2626",color:"white",borderRadius:20,padding:"1px 6px",fontSize:12,fontWeight:800,marginLeft:4}}>{sub.badge}</span>}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            }
            return (
              <SidebarNavItem
                key={n.id}
                item={n}
                active={tab===n.id}
                isMobile={isMobile}
                collapsed={sidebarCompact}
                onClick={()=>{setTab(n.id); if(n.id!=="transaction") setTugExpanded(false); if(n.id!=="master") setMasterExpanded(false); if(n.id!=="opname") setOpnameExpanded(false); setMobileMenuOpen(false);}}
              />
            );
          })}
        </div>
        {!isMobile && (
          <div className="app-sidebar__footer">
            <button
              className="app-sidebar__footer-toggle"
              onClick={()=>setSidebarCollapsed(v=>!v)}
              title={sidebarCompact?"Buka sidebar":"Sembunyikan menu"}
              aria-label={sidebarCompact?"Buka sidebar":"Sembunyikan menu"}
            >
              <SidebarIcon name={sidebarCompact?"expand":"collapse"} size={16}/>
            </button>
          </div>
        )}
        <div className="app-sidebar__cloud" style={{padding:sidebarCompact?"10px":"8px 16px",borderTop:"1px solid rgba(255,255,255,0.1)",fontSize:12,color:"rgba(255,255,255,0.58)"}} title={sidebarCompact?(cloudSaving?"Menyimpan...":dataRefreshing?"Menyinkronkan data...":lastSaved?"Tersimpan":"Cloud Storage Aktif"):undefined}>
          <SidebarIcon name="cloud" size={16}/>
          {!sidebarCompact && <span>{cloudSaving ? "Menyimpan..." : dataRefreshing ? "Menyinkronkan data..." : lastSaved ? "Tersimpan" : "Cloud Storage Aktif"}</span>}
        </div>

      </aside>
    </>
  );
}
