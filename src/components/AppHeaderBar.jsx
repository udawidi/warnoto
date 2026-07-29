import React from "react";
import { SidebarIcon } from "./SidebarIcon.jsx";
import { ROLES } from "../lib/roles.js";
import { isDemoMode, enterDemoMode, exitDemoMode } from "../lib/demo.js";

export function AppHeaderBar({ C, sty, currentUser, isMobile, setMobileMenuOpen, pageMeta, accountMenuRef, theme, setTheme, accountMenuOpen, setAccountMenuOpen, UPT, openGantiPassword, loggingOut, handleLogout }) {
  return (
    <header className="app-workspace-bar">
      {isMobile && (
      <button
        className="app-workspace-bar__menu"
        onClick={()=>setMobileMenuOpen(true)}
        aria-label="Buka menu"
      ><SidebarIcon name="menu" size={20}/></button>
      )}
      <div className="app-workspace-bar__title">
        <span>{pageMeta.eyebrow}</span>
        <strong>{pageMeta.title}</strong>
      </div>
      <div className="app-account" ref={accountMenuRef}>
        <button className={`theme-switch${theme==="dark"?" is-dark":""}`} onClick={()=>setTheme(t=>t==="dark"?"light":"dark")} role="switch" aria-checked={theme==="dark"} aria-label="Mode gelap" title={theme==="dark"?"Mode Terang":"Mode Gelap"}>
          <span className="theme-switch__knob" aria-hidden="true">{theme==="dark"?"🌙":"☀️"}</span>
        </button>
        <button className="app-account__trigger" onClick={()=>setAccountMenuOpen(open=>!open)} aria-expanded={accountMenuOpen} aria-haspopup="menu">
          <span className="app-account__avatar">{currentUser.avatar || currentUser.name?.slice(0,2).toUpperCase()}</span>
          <span className="app-account__identity">
            <small>{UPT}</small>
            <strong>{currentUser.name || "Fajar Sutomo"}</strong>
          </span>
          <span className={`app-account__chevron${accountMenuOpen?" is-open":""}`}><SidebarIcon name="chevron" size={14}/></span>
        </button>
        {accountMenuOpen && (
          <div className="app-account__menu" role="menu">
            <div className="app-account__profile">
              <span className="app-account__avatar is-large">{currentUser.avatar || currentUser.name?.slice(0,2).toUpperCase()}</span>
              <div><strong>{currentUser.name || "Fajar Sutomo"}</strong><span>{ROLES[currentUser.role]}</span></div>
            </div>
            <div className="app-account__unit">{UPT}</div>
            <button role="menuitem" onClick={()=>{setAccountMenuOpen(false);openGantiPassword();}}><SidebarIcon name="key" size={17}/><span>Ganti Password</span></button>
            <button role="menuitem" onClick={()=>{setAccountMenuOpen(false);isDemoMode()?exitDemoMode():enterDemoMode();}}><span aria-hidden="true">🧪</span><span>{isDemoMode()?"Keluar Mode Demo":"Mode Demo (TUG)"}</span></button>
            {/* Menu SENGAJA tidak ditutup di sini: dibiarkan terbuka supaya label "Keluar..." + disabled
                terlihat selama signOut() berjalan (bisa lambat di server self-host). Saat logout sukses
                seluruh header unmount ke form login; kalau gagal, finally di handleLogout mengaktifkan tombol lagi. */}
            <button role="menuitem" className="is-danger" disabled={loggingOut} onClick={()=>handleLogout()}><SidebarIcon name="logout" size={17}/><span>{loggingOut?"Keluar...":"Logout"}</span></button>
          </div>
        )}
      </div>
    </header>
  );
}
