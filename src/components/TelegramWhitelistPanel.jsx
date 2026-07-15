// Panel Kelola Whitelist User Bot Telegram (Admin) — CRUD tg_allowed_users. Dipindah Fase 4b.
import { useState, useEffect } from "react";
import { supabase } from "../supabaseClient.js";

// Panel kelola whitelist user Bot Telegram (Admin only) — CRUD langsung ke tabel
// tg_allowed_users, menggantikan alur manual sebelumnya (form PDF + Supabase Dashboard).
// Webhook telegram-webhook cek kolom is_active di tabel ini utk tiap pesan masuk.
export function TelegramWhitelistPanel({ sty, C, currentUser }) {
  const [loading, setLoading] = useState(true);
  const [users, setUsers] = useState([]);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ telegram_user_id:"", telegram_username:"", display_name:"", notes:"" });

  async function loadUsers() {
    setLoading(true);
    try {
      const { data, error } = await supabase.from("tg_allowed_users").select("*").order("added_at",{ascending:false});
      if (error) throw error;
      setUsers(data||[]);
    } catch (e) {
      console.error("Gagal load tg_allowed_users:", e);
    }
    setLoading(false);
  }

  useEffect(() => { loadUsers(); }, []);

  async function addUser() {
    const uid = form.telegram_user_id.trim();
    if (!/^\d+$/.test(uid)) { alert("User ID Telegram harus berupa angka (didapat dari bot @userinfobot di Telegram, bukan @username)."); return; }
    if (!form.display_name.trim()) { alert("Nama wajib diisi."); return; }
    setSaving(true);
    try {
      const { error } = await supabase.from("tg_allowed_users").insert({
        telegram_user_id: uid,
        telegram_username: form.telegram_username.trim() || null,
        display_name: form.display_name.trim(),
        notes: form.notes.trim() || null,
        added_by: currentUser?.name || "web-admin",
        is_active: true,
      });
      if (error) throw error;
      setForm({ telegram_user_id:"", telegram_username:"", display_name:"", notes:"" });
      await loadUsers();
    } catch (e) {
      alert(e.code==="23505" ? "User ID ini sudah terdaftar di whitelist." : "Gagal tambah user: " + e.message);
    }
    setSaving(false);
  }

  async function toggleActive(u) {
    await supabase.from("tg_allowed_users").update({is_active: !u.is_active}).eq("id", u.id);
    loadUsers();
  }

  async function removeUser(u) {
    if (!confirm(`Hapus akses "${u.display_name}" dari whitelist Telegram? Setelah dihapus, user ini harus didaftarkan ulang untuk bisa akses bot lagi.`)) return;
    await supabase.from("tg_allowed_users").delete().eq("id", u.id);
    loadUsers();
  }

  return (
    <div style={{...sty.card, marginBottom:16}}>
      <div style={{fontWeight:800,fontSize:14,marginBottom:4}}>📱 Kelola User Bot Telegram</div>
      <p style={{fontSize:12,color:C.muted,marginBottom:12}}>Hanya user aktif di daftar ini yang bisa chat dengan bot Telegram WARNOTO. User ID Telegram (angka) didapat dengan chat ke bot <b>@userinfobot</b> di Telegram — bukan @username.</p>

      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:8}}>
        <div><label style={sty.label}>User ID Telegram *</label><input style={sty.input} value={form.telegram_user_id} onChange={e=>setForm(f=>({...f,telegram_user_id:e.target.value}))} placeholder="cth: 123456789"/></div>
        <div><label style={sty.label}>Username (opsional)</label><input style={sty.input} value={form.telegram_username} onChange={e=>setForm(f=>({...f,telegram_username:e.target.value}))} placeholder="cth: @budi_pln"/></div>
        <div style={{gridColumn:"1/-1"}}><label style={sty.label}>Nama *</label><input style={sty.input} value={form.display_name} onChange={e=>setForm(f=>({...f,display_name:e.target.value}))} placeholder="cth: Budi Santoso"/></div>
        <div style={{gridColumn:"1/-1"}}><label style={sty.label}>Catatan (opsional)</label><input style={sty.input} value={form.notes} onChange={e=>setForm(f=>({...f,notes:e.target.value}))} placeholder="cth: TL Logistik UPT Surabaya"/></div>
      </div>
      <button style={sty.btn("success","sm")} disabled={saving} onClick={addUser}>{saving?"Menyimpan...":"+ Tambah User"}</button>

      <div style={{fontSize:12,fontWeight:700,marginTop:16,marginBottom:8}}>Daftar User ({users.length})</div>
      {loading ? <div style={{fontSize:12,color:C.muted}}>Memuat...</div> : (
        users.length===0 ? <div style={{fontSize:12,color:C.muted}}>Belum ada user terdaftar.</div> :
        users.map(u=>(
          <div key={u.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:8,padding:"8px 0",borderBottom:`1px solid ${C.border}`}}>
            <div>
              <div style={{fontSize:12,fontWeight:700}}>{u.display_name} {!u.is_active && <span style={{fontSize:12,color:C.red,fontWeight:700}}>(nonaktif)</span>}</div>
              <div style={{fontSize:12,color:C.muted}}>ID: {u.telegram_user_id}{u.telegram_username?` • ${u.telegram_username}`:""}{u.notes?` • ${u.notes}`:""}</div>
            </div>
            <div style={{display:"flex",gap:6,flexShrink:0}}>
              <button style={sty.btn(u.is_active?"ghost":"success","sm")} onClick={()=>toggleActive(u)}>{u.is_active?"Nonaktifkan":"Aktifkan"}</button>
              <button title="Hapus dari whitelist" style={sty.btn("danger","sm")} onClick={()=>removeUser(u)}>🗑️</button>
            </div>
          </div>
        ))
      )}
    </div>
  );
}
