// Panel Kelola Penerima Notifikasi TUG-8/9 (Admin) — CRUD notif_recipients.
// Fondasi Fitur B (fitur A LITE lanjutan): trigger notif_outbox_on_tug_final
// (migrasi 20260902_notif_outbox.sql) antre baris PENDING per penerima aktif
// di sini saat TUG-8/9 FINAL_APPROVED; notify-dispatch (EF, belum dideploy)
// yang benar-benar mengirim. Pola CRUD disalin dari TelegramWhitelistPanel.jsx
// (tabel dedicated {id,...} langsung, BUKAN blob master jsonb).
import { useState, useEffect } from "react";
import { supabase } from "../supabaseClient.js";
import { isDemoMode } from "../lib/demo.js";
import { hasRole } from "../lib/roles.js";

export function NotifRecipientPanel({ sty, C, currentUser, uptList, showToast }) {
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState([]);
  const [saving, setSaving] = useState(false);
  const [draining, setDraining] = useState(false);
  const [form, setForm] = useState({ channel:"TELEGRAM", target:"", label:"", upt_id:"" });

  async function drainOutbox() {
    if (!supabase) return;
    setDraining(true);
    try {
      const { data, error } = await supabase.functions.invoke("notify-dispatch");
      if (error) throw error;
      showToast?.(`${data?.sent ?? 0} terkirim, ${data?.failed ?? 0} gagal`, data?.failed ? "error" : "success");
    } catch (e) {
      showToast?.("Gagal jalankan pengiriman: " + e.message, "error");
    }
    setDraining(false);
  }

  async function loadItems() {
    if (!supabase) { setItems([]); setLoading(false); return; }
    setLoading(true);
    try {
      const { data, error } = await supabase.from("notif_recipients").select("*").order("created_at",{ascending:false});
      if (error) throw error;
      setItems(data||[]);
    } catch (e) {
      console.error("Gagal load notif_recipients:", e);
    }
    setLoading(false);
  }

  useEffect(() => { loadItems(); }, []);

  async function addItem() {
    if (isDemoMode()) { alert("Mode demo: perubahan tidak disimpan."); return; }
    const target = form.target.trim();
    if (!target) { alert("Target (nomor WA / chat ID Telegram) wajib diisi."); return; }
    if (!form.label.trim()) { alert("Label wajib diisi."); return; }
    setSaving(true);
    try {
      const { error } = await supabase.from("notif_recipients").insert({
        id: `NOTIFREC-${Date.now()}-${Math.random().toString(36).slice(2,8)}`,
        channel: form.channel,
        target,
        label: form.label.trim(),
        upt_id: form.upt_id || null,
        active: true,
        created_at: Date.now(),
      });
      if (error) throw error;
      setForm({ channel:"TELEGRAM", target:"", label:"", upt_id:"" });
      await loadItems();
    } catch (e) {
      alert("Gagal tambah penerima: " + e.message);
    }
    setSaving(false);
  }

  async function toggleActive(r) {
    if (isDemoMode()) { alert("Mode demo: perubahan tidak disimpan."); return; }
    await supabase.from("notif_recipients").update({active: !r.active}).eq("id", r.id);
    loadItems();
  }

  async function removeItem(r) {
    if (isDemoMode()) { alert("Mode demo: perubahan tidak disimpan."); return; }
    if (!confirm(`Hapus penerima notifikasi "${r.label}"?`)) return;
    await supabase.from("notif_recipients").delete().eq("id", r.id);
    loadItems();
  }

  if (!hasRole(currentUser, "ADMIN","SUPERADMIN")) {
    return <div style={{...sty.card,fontSize:12,color:C.muted}}>Hanya Admin/Superadmin yang bisa mengelola penerima notifikasi.</div>;
  }

  return (
    <div style={{...sty.card, marginBottom:16}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:8,marginBottom:4}}>
        <div style={{fontWeight:800,fontSize:13}}>🔔 Kelola Penerima Notifikasi TUG-8/9</div>
        <button style={sty.btn("ghost","sm")} disabled={draining} onClick={drainOutbox}>{draining?"Mengirim...":"Kirim notif tertunda"}</button>
      </div>
      <p tabIndex={0} className="info-note" style={{fontSize:12,color:C.muted,marginBottom:12}}>
        Penerima aktif di daftar ini akan diantrekan notifikasi otomatis (via <code>notif_outbox</code>) saat TUG-8/TUG-9 disetujui final. Pengiriman WA masih menunggu keputusan provider — baris WA akan tercatat FAILED sementara.
      </p>

      <div className="telegram-whitelist-grid" style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:8}}>
        <div>
          <label style={sty.label}>Channel *</label>
          <select style={sty.select} value={form.channel} onChange={e=>setForm(f=>({...f,channel:e.target.value}))}>
            <option value="TELEGRAM">Telegram</option>
            <option value="WA">WhatsApp (belum aktif)</option>
          </select>
        </div>
        <div><label style={sty.label}>Target (chat ID / no. WA) *</label><input style={sty.input} value={form.target} onChange={e=>setForm(f=>({...f,target:e.target.value}))} placeholder="cth: 123456789 / 6281280209297"/></div>
        <div style={{gridColumn:"1/-1"}}><label style={sty.label}>Label *</label><input style={sty.input} value={form.label} onChange={e=>setForm(f=>({...f,label:e.target.value}))} placeholder="cth: Akuntansi UPT Surabaya"/></div>
        <div style={{gridColumn:"1/-1"}}>
          <label style={sty.label}>Scope UPT</label>
          <select style={sty.select} value={form.upt_id} onChange={e=>setForm(f=>({...f,upt_id:e.target.value}))}>
            <option value="">Semua UPT (global)</option>
            {(uptList||[]).map(u=><option key={u.id} value={u.id}>{u.nama}</option>)}
          </select>
        </div>
      </div>
      <button style={sty.btn("success","sm")} disabled={saving} onClick={addItem}>{saving?"Menyimpan...":"+ Tambah Penerima"}</button>

      <div style={{fontSize:12,fontWeight:700,marginTop:16,marginBottom:8}}>Daftar Penerima ({items.length})</div>
      {loading ? <div style={{fontSize:12,color:C.muted}}>Memuat...</div> : (
        items.length===0 ? <div style={{fontSize:12,color:C.muted}}>Belum ada penerima terdaftar.</div> :
        items.map(r=>(
          <div key={r.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:8,padding:"8px 0",borderBottom:`1px solid ${C.border}`}}>
            <div>
              <div style={{fontSize:12,fontWeight:700}}>{r.label} {!r.active && <span style={{fontSize:12,color:C.red,fontWeight:700}}>(nonaktif)</span>}</div>
              <div style={{fontSize:12,color:C.muted}}>{r.channel} • {r.target} • Scope: {uptList?.find(x=>x.id===r.upt_id)?.nama || "Global"}</div>
            </div>
            <div style={{display:"flex",gap:6,flexShrink:0}}>
              <button style={sty.btn(r.active?"ghost":"success","sm")} onClick={()=>toggleActive(r)}>{r.active?"Nonaktifkan":"Aktifkan"}</button>
              <button title="Hapus penerima" style={sty.btn("danger","sm")} onClick={()=>removeItem(r)}>🗑️</button>
            </div>
          </div>
        ))
      )}
    </div>
  );
}
