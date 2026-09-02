// Komponen "Profil" operator (Batch 3b — melengkapi stub Batch 2).
// Load/simpan tabel operator_profile (phone, sio_photo, sia_photo). Nama TIDAK
// disimpan di sini — ikut akun (currentUser.name), read-only.
import { useEffect, useState } from "react";
import { supabase } from "../supabaseClient.js";
import { isDemoMode } from "../lib/demo.js";
import { compressImage } from "../lib/supabaseSync.js";
import { validateHeavyEquipmentPhotoFile } from "../lib/heavyEquipmentPhoto.js";

function DocPhotoCard({ label, photo, onChange, sty, C }) {
  return (
    <div style={{ ...sty.card, padding: 12 }}>
      <label style={{ ...sty.label, marginBottom: 8 }}>{label}</label>
      <div style={{ height: 130, borderRadius: 10, background: "#f3f4f6", border: `1px solid ${C.border}`, overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 10 }}>
        {photo ? <img src={photo} alt={label} style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <div style={{ fontSize: 28, color: "#64748b" }}>📄</div>}
      </div>
      <label style={{ ...sty.btn("ghost", "sm"), textAlign: "center", display: "block" }}>
        📷 {photo ? "Ganti Foto" : "Upload Foto"}
        <input type="file" accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp" capture="environment" style={{ display: "none" }} onChange={onChange} />
      </label>
    </div>
  );
}

export function OperatorProfile({ currentUser, sty, C }) {
  const [phone, setPhone] = useState("");
  const [sioPhoto, setSioPhoto] = useState("");
  const [siaPhoto, setSiaPhoto] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState(null); // {type:"success"|"error", msg}

  useEffect(() => {
    if (!currentUser?.id || isDemoMode()) { setLoading(false); return; }
    let cancelled = false;
    supabase.from("operator_profile").select("*").eq("user_id", currentUser.id).single()
      .then(({ data }) => {
        if (cancelled || !data) return;
        setPhone(data.phone || "");
        setSioPhoto(data.sio_photo || "");
        setSiaPhoto(data.sia_photo || "");
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [currentUser?.id]);

  async function handlePhotoChange(e, setPhoto) {
    const file = e.target.files?.[0];
    const validation = validateHeavyEquipmentPhotoFile(file);
    if (!validation.ok) { setStatus({ type: "error", msg: validation.message }); e.target.value = ""; return; }
    try {
      setPhoto(await compressImage(file, { maxDim: 1280, maxBytes: 400_000 }));
    } catch (error) {
      setStatus({ type: "error", msg: `Gagal memproses foto: ${error?.message || "file tidak dapat dibaca"}.` });
    }
    e.target.value = "";
  }

  async function saveProfile() {
    if (isDemoMode()) { setStatus({ type: "error", msg: "Mode demo: perubahan tidak disimpan." }); return; }
    setSaving(true);
    setStatus(null);
    const { error } = await supabase.from("operator_profile").upsert({
      user_id: currentUser.id, phone, sio_photo: sioPhoto, sia_photo: siaPhoto, updated_at: Date.now(),
    }, { onConflict: "user_id" });
    setSaving(false);
    setStatus(error ? { type: "error", msg: "Gagal menyimpan profil: " + error.message } : { type: "success", msg: "Profil tersimpan." });
  }

  const initial = (currentUser?.name || currentUser?.username || "?").trim().charAt(0).toUpperCase();

  return (
    <div style={{ ...sty.card, maxWidth: 480, margin: "0 auto" }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginBottom: 20 }}>
        <div style={{ width: 64, height: 64, borderRadius: "50%", background: C.brand || "#0f172a", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24, fontWeight: 800, marginBottom: 10 }}>{initial}</div>
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: C.text, textAlign: "center" }}>{currentUser?.name || currentUser?.username}</h2>
        <p style={{ margin: "2px 0 0", fontSize: 13, color: C.muted }}>{currentUser?.role}</p>
      </div>

      {loading ? (
        <p style={{ fontSize: 13, color: C.muted, textAlign: "center" }}>Memuat profil…</p>
      ) : (
        <>
          <label style={{ ...sty.label, marginBottom: 16, display: "block" }}>Nomor HP
            <input type="tel" style={sty.input} value={phone} onChange={e => setPhone(e.target.value)} placeholder="08xxxxxxxxxx" />
          </label>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 16 }}>
            <DocPhotoCard label="Foto SIO" photo={sioPhoto} onChange={e => handlePhotoChange(e, setSioPhoto)} sty={sty} C={C} />
            <DocPhotoCard label="Foto SIA" photo={siaPhoto} onChange={e => handlePhotoChange(e, setSiaPhoto)} sty={sty} C={C} />
          </div>

          {status && (
            <div style={{ marginBottom: 12, padding: 10, borderRadius: 10, fontSize: 13, background: status.type === "error" ? "#fee2e2" : "#dcfce7", color: status.type === "error" ? "#991b1b" : "#166534" }}>
              {status.msg}
            </div>
          )}

          <button style={{ ...sty.btn("primary"), width: "100%" }} disabled={saving} onClick={saveProfile}>
            {saving ? "Menyimpan…" : "Simpan Profil"}
          </button>
        </>
      )}
    </div>
  );
}
