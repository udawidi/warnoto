// Komponen SearchableSelect — dipindah dari App.jsx (refactor Fase 4).
import { useState, useEffect, useRef } from "react";
import { matchesMaterialSearch } from "../lib/sap.js";

// Ganti <select> raksasa (semua barang/material dijejer dalam 1 dropdown
// panjang) dengan field cari + daftar hasil yang bisa disaring sambil
// mengetik — dipakai di semua form TUG saat memilih barang/material.
export function SearchableSelect({ options, value, onChange, getLabel, getSearchText, renderOption, placeholder="-- Cari & pilih barang --", sty, C, emptyText="Tidak ada barang yang cocok", isMobile=false }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  const selected = options.find(o=>o.id===value);

  useEffect(() => {
    function onDocClick(e) { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  // Dipakai di semua form TUG (TUG-5/7/8/9/10, Stock Opname) buat pilih material —
  // dulu cuma substring polos, sekarang pakai mesin sinonim PLN yang sama dengan
  // Data Stok/Master Katalog (matchesMaterialSearch), biar user yang ketik bahasa
  // awam ("pemutus", "penangkal petir") tetap nemu barangnya di sini juga.
  const filtered = options.filter(o => matchesMaterialSearch([getSearchText?getSearchText(o):getLabel(o)], query));

  return (
    <div ref={wrapRef} style={{position:"relative"}}>
      <input
        style={sty.input}
        placeholder={placeholder}
        value={open ? query : (selected ? getLabel(selected) : "")}
        onFocus={()=>{setOpen(true); setQuery("");}}
        onChange={e=>{setQuery(e.target.value); setOpen(true);}}
      />
      {open && (
        <div style={{position:"absolute",zIndex:50,top:"100%",left:0,right:0,background:"white",border:`1px solid ${C.border}`,borderRadius:8,marginTop:2,maxHeight:260,overflowY:"auto",boxShadow:"0 8px 24px rgba(0,0,0,0.15)"}}>
          {value && (
            <div onClick={()=>{onChange("");setOpen(false);setQuery("");}} style={{padding:"8px 10px",fontSize:11,color:C.muted,cursor:"pointer",borderBottom:`1px solid ${C.border}`}}>✕ Kosongkan pilihan</div>
          )}
          {filtered.length===0 && <div style={{padding:"12px 10px",fontSize:12,color:C.muted,textAlign:"center"}}>{emptyText}</div>}
          {filtered.slice(0,50).map(o=>(
            <div key={o.id} onClick={()=>{onChange(o.id);setOpen(false);setQuery("");}}
              style={{padding:isMobile?"12px 10px":"8px 10px",minHeight:isMobile?44:undefined,display:"flex",flexDirection:"column",justifyContent:"center",fontSize:isMobile?13:12,cursor:"pointer",background:o.id===value?"#eff6ff":"white",borderBottom:`1px solid #f1f5f9`}}>
              {renderOption?renderOption(o):getLabel(o)}
            </div>
          ))}
          {filtered.length>50 && <div style={{padding:"6px 10px",fontSize:10,color:C.muted,textAlign:"center"}}>+{filtered.length-50} lainnya — ketik lebih spesifik untuk menyaring</div>}
        </div>
      )}
    </div>
  );
}
