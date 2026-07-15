// Komponen CollapsibleSection — dipindah dari App.jsx (refactor Fase 4d).
import { useState } from "react";

// Sub-section Dashboard yang bisa dibuka/tutup (klik judul). Status buka/tutup
// disimpan per-user di localStorage supaya konsisten antar kunjungan.
export function CollapsibleSection({ id, title, icon, defaultOpen = true, C, children }) {
  const storeKey = "warnoto_dash_open_" + id;
  const [open, setOpen] = useState(() => {
    try { const v = localStorage.getItem(storeKey); return v === null ? defaultOpen : v === "1"; } catch { return defaultOpen; }
  });
  const toggle = () => setOpen(o => { const n = !o; try { localStorage.setItem(storeKey, n ? "1" : "0"); } catch { /* ignore */ } return n; });
  return (
    <div style={{ marginBottom: 14 }}>
      <button onClick={toggle} style={{ width:"100%", display:"flex", alignItems:"center", gap:8, background:"transparent", border:"none", borderBottom:`1px solid ${C.border}`, padding:"8px 2px", cursor:"pointer", textAlign:"left" }}>
        <span style={{ fontSize:12, color:C.muted, width:14, flexShrink:0 }}>{open ? "▼" : "▶"}</span>
        <span style={{ fontSize:13, fontWeight:800, color:C.text }}>{icon} {title}</span>
        {!open && <span style={{ fontSize:12, color:C.muted, marginLeft:"auto" }}>klik untuk buka</span>}
      </button>
      {open && <div style={{ marginTop: 10 }}>{children}</div>}
    </div>
  );
}
