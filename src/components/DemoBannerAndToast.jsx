import React from "react";
import { isDemoMode, exitDemoMode } from "../lib/demo.js";
import { BarcodeScanner } from "./BarcodeScanner.jsx";

export function DemoBannerAndToast({ C, sty, currentUser, isMobile, toast, savingInfo, scannerOpen, handleScanResult, setScannerOpen }) {
  return (
    <>
      {/* Mode demo per-tab: semua penyimpanan (localStorage + Supabase + Storage)
          dibekukan — lihat isDemoMode() di src/lib/demo.js. Banner ini pengingat
          visual bahwa perubahan di tab ini tidak akan tersimpan. */}
      {isDemoMode() && (
        <div className="demo-banner">
          <span>🧪 MODE DEMO — perubahan TIDAK disimpan</span>
          <button onClick={exitDemoMode}>Keluar</button>
        </div>
      )}
      {/* Di HP: toast dipusatkan & dibatasi lebar (bukan nempel kanan tanpa batas
          lebar) supaya pesan panjang tidak terpotong/keluar layar. */}
      {toast && (
        <div style={isMobile
          ? {position:"fixed",top:16,left:16,right:16,zIndex:9999,background:toast.type==="error"?C.red:C.green,color:"white",padding:"12px 16px",borderRadius:10,fontSize:14,fontWeight:600,boxShadow:"0 8px 24px rgba(0,0,0,0.25)",textAlign:"center"}
          : {position:"fixed",top:20,right:20,maxWidth:420,zIndex:9999,background:toast.type==="error"?C.red:C.green,color:"white",padding:"12px 20px",borderRadius:10,fontSize:13,fontWeight:600,boxShadow:"0 8px 24px rgba(0,0,0,0.2)"}
        }>{toast.msg}</div>
      )}
      {savingInfo && (
        <div style={{position:"fixed",inset:0,zIndex:3000,background:"rgba(15,23,42,0.55)",backdropFilter:"blur(2px)",display:"flex",alignItems:"center",justifyContent:"center",padding:20}}>
          <div style={{background:C.surface,borderRadius:16,padding:"28px 32px",width:360,maxWidth:"100%",textAlign:"center",boxShadow:"0 24px 64px rgba(2,6,23,0.35)",borderTop:`4px solid ${C.accent}`}}>
            <div className="txn-spinner" style={{width:44,height:44,margin:"0 auto 16px",border:`4px solid #e2e8f0`,borderTopColor:C.accent,borderRadius:"50%"}}/>
            <div style={{fontSize:14,fontWeight:800,color:C.text,marginBottom:4}}>Menyimpan Transaksi</div>
            <div style={{fontSize:12,color:C.muted,marginBottom:savingInfo.total>0?12:0}}>{savingInfo.label}{savingInfo.total>0?` (${savingInfo.done}/${savingInfo.total})`:""}</div>
            {savingInfo.total>0 && (
              <div style={{height:6,background:"#e2e8f0",borderRadius:999,overflow:"hidden"}}>
                <div style={{height:"100%",width:`${Math.round((savingInfo.done/savingInfo.total)*100)}%`,background:C.accent,borderRadius:999,transition:"width .3s ease"}}/>
              </div>
            )}
            <div style={{fontSize:12,color:C.muted,marginTop:14}}>Mohon tunggu, jangan tutup halaman ini.</div>
          </div>
        </div>
      )}
      {scannerOpen && <BarcodeScanner onDetect={handleScanResult} onClose={()=>setScannerOpen(false)}/>}
    </>
  );
}
