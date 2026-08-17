// Komponen IntegrasiApiTab — Fase 1 "Integrasi API": Admin membuat/mencabut
// API-key ter-scope untuk aplikasi pihak ketiga (SAP S/4HANA) membaca data
// WARNOTO lewat Edge Function supabase/functions/integration-api.
import { useState, useEffect, useCallback } from "react";
import { Copy, Trash, Plus, Warning } from "@phosphor-icons/react";
import { supabase } from "../supabaseClient.js";

const SCOPES = [
  { key: "read:stock", label: "Baca Data Stok" },
  { key: "read:catalog", label: "Baca Master Katalog" },
  { key: "read:tug", label: "Baca Riwayat TUG" },
];

export function IntegrasiApiTab({ sty, C, showToast }) {
  const [keys, setKeys] = useState([]);
  const [loading, setLoading] = useState(true);
  const [label, setLabel] = useState("");
  const [selectedScopes, setSelectedScopes] = useState(new Set());
  const [expiresAt, setExpiresAt] = useState(""); // yyyy-mm-dd dari <input type="date">, kosong = tak kedaluwarsa
  const [allowedIpsText, setAllowedIpsText] = useState(""); // pisah koma, kosong = semua IP
  const [busy, setBusy] = useState(false);
  const [freshKey, setFreshKey] = useState(null); // { plaintext, key_prefix } — ditampilkan sekali

  const loadKeys = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.functions.invoke("integration-api/keys", { method: "GET" });
    if (error || data?.ok === false) {
      showToast?.("Gagal memuat daftar API key: " + (data?.error || error?.message || String(error)), "error");
    } else {
      setKeys(data?.keys || []);
    }
    setLoading(false);
  }, [showToast]);

  useEffect(() => { loadKeys(); }, [loadKeys]);

  function toggleScope(scopeKey) {
    setSelectedScopes(prev => {
      const next = new Set(prev);
      next.has(scopeKey) ? next.delete(scopeKey) : next.add(scopeKey);
      return next;
    });
  }

  async function createKey() {
    if (!label.trim()) return showToast?.("Label wajib diisi.", "error");
    if (selectedScopes.size === 0) return showToast?.("Pilih minimal satu scope.", "error");
    setBusy(true);
    try {
      const ips = allowedIpsText.split(",").map(s => s.trim()).filter(Boolean);
      const { data, error } = await supabase.functions.invoke("integration-api/keys", {
        method: "POST",
        body: {
          label: label.trim(),
          scopes: [...selectedScopes],
          // Akhir hari (23:59:59 lokal) supaya key tetap berlaku sepanjang tanggal yang dipilih.
          expires_at: expiresAt ? new Date(`${expiresAt}T23:59:59`).toISOString() : null,
          allowed_ips: ips.length ? ips : null,
        },
      });
      if (error || data?.ok === false) {
        showToast?.("Gagal membuat key: " + (data?.error || error?.message || String(error)), "error");
        return;
      }
      setFreshKey(data.key);
      setLabel("");
      setSelectedScopes(new Set());
      setExpiresAt("");
      setAllowedIpsText("");
      await loadKeys();
    } finally {
      setBusy(false);
    }
  }

  async function revokeKey(id) {
    if (!confirm("Cabut API key ini? Aplikasi pihak ketiga yang memakainya akan langsung ditolak.")) return;
    const { data, error } = await supabase.functions.invoke("integration-api/revoke", { method: "POST", body: { id } });
    if (error || data?.ok === false) {
      showToast?.("Gagal mencabut key: " + (data?.error || error?.message || String(error)), "error");
      return;
    }
    showToast?.("API key dicabut.", "success");
    await loadKeys();
  }

  function copyPlaintext() {
    navigator.clipboard?.writeText(freshKey.plaintext);
    showToast?.("Key disalin ke clipboard.", "success");
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {freshKey && (
        <div style={{ ...sty.card, background: "#fef3c7", border: "1px solid #f59e0b" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 800, fontSize: 13, color: "#92400e", marginBottom: 8 }}>
            <Warning size={16} weight="bold" /> Simpan key ini sekarang — tidak bisa dilihat lagi setelah ditutup
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <code style={{ fontSize: 13, background: "#fff", padding: "8px 12px", borderRadius: 8, border: "1px solid #f59e0b", wordBreak: "break-all" }}>{freshKey.plaintext}</code>
            <button className="approval-btn--primary" onClick={copyPlaintext}><Copy size={14} /> Copy</button>
            <button className="approval-btn--cancel" onClick={() => setFreshKey(null)}>Tutup</button>
          </div>
        </div>
      )}

      <div style={sty.card}>
        <div style={{ fontWeight: 800, fontSize: 15, color: C.text, marginBottom: 12 }}>Buat API Key Baru</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10, maxWidth: 420 }}>
          <div>
            <label style={sty.label}>Label</label>
            <input style={sty.input} value={label} onChange={e => setLabel(e.target.value)} placeholder="mis. SAP S/4HANA Production" />
          </div>
          <div>
            <label style={sty.label}>Scope</label>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {SCOPES.map(s => (
                <label key={s.key} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: C.text }}>
                  <input type="checkbox" checked={selectedScopes.has(s.key)} onChange={() => toggleScope(s.key)} />
                  {s.label} <span style={{ color: C.muted, fontSize: 12 }}>({s.key})</span>
                </label>
              ))}
            </div>
          </div>
          <div>
            <label style={sty.label}>Kedaluwarsa (opsional)</label>
            <input type="date" style={sty.input} value={expiresAt} onChange={e => setExpiresAt(e.target.value)} />
          </div>
          <div>
            <label style={sty.label}>IP Diizinkan (opsional, pisah koma)</label>
            <input style={sty.input} value={allowedIpsText} onChange={e => setAllowedIpsText(e.target.value)} placeholder="mis. 10.91.21.5, 203.0.113.10 — kosong = semua IP" />
          </div>
          <button className="approval-btn--primary" disabled={busy} onClick={createKey} style={{ alignSelf: "flex-start" }}>
            <Plus size={14} /> Buat Key
          </button>
        </div>
      </div>

      <div style={sty.card}>
        <div style={{ fontWeight: 800, fontSize: 15, color: C.text, marginBottom: 12 }}>Daftar API Key</div>
        {loading ? (
          <div style={{ color: C.muted, fontSize: 13 }}>Memuat...</div>
        ) : keys.length === 0 ? (
          <div style={{ color: C.muted, fontSize: 13 }}>Belum ada API key.</div>
        ) : (
          <div className="mobile-card-table" style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 640 }}>
              <thead>
                <tr style={{ textAlign: "left", fontSize: 12, color: C.muted, textTransform: "uppercase" }}>
                  <th style={{ padding: "8px 6px" }}>Label</th>
                  <th style={{ padding: "8px 6px" }}>Prefix</th>
                  <th style={{ padding: "8px 6px" }}>Scope</th>
                  <th style={{ padding: "8px 6px" }}>Kedaluwarsa</th>
                  <th style={{ padding: "8px 6px" }}>IP Diizinkan</th>
                  <th style={{ padding: "8px 6px" }}>Terakhir Dipakai</th>
                  <th style={{ padding: "8px 6px" }}>Status</th>
                  <th style={{ padding: "8px 6px" }}></th>
                </tr>
              </thead>
              <tbody>
                {keys.map(k => {
                  const isExpired = k.expires_at && new Date(k.expires_at) < new Date();
                  return (
                  <tr key={k.id} className="mobile-card-table__row" style={{ borderTop: `1px solid ${C.border}`, fontSize: 13 }}>
                    <td data-label="Label" className="mobile-card-table__title" style={{ padding: "8px 6px", color: C.text, fontWeight: 700 }}>{k.label}</td>
                    <td data-label="Prefix" style={{ padding: "8px 6px" }}><code>{k.key_prefix}…</code></td>
                    <td data-label="Scope" style={{ padding: "8px 6px", color: C.muted }}>{(k.scopes || []).join(", ")}</td>
                    <td data-label="Kedaluwarsa" style={{ padding: "8px 6px", color: C.muted }}>{k.expires_at ? new Date(k.expires_at).toLocaleDateString("id-ID") : "—"}</td>
                    <td data-label="IP Diizinkan" style={{ padding: "8px 6px", color: C.muted }}>{(k.allowed_ips || []).length ? k.allowed_ips.join(", ") : "Semua"}</td>
                    <td data-label="Terakhir Dipakai" style={{ padding: "8px 6px", color: C.muted }}>{k.last_used_at ? `${new Date(k.last_used_at).toLocaleString("id-ID")}${k.last_used_ip ? " ("+k.last_used_ip+")" : ""}` : "Belum pernah"}</td>
                    <td data-label="Status" style={{ padding: "8px 6px" }}>
                      <span style={sty.statusBadge(k.revoked_at ? "REJECTED" : isExpired ? "REJECTED" : "APPROVED")}>{k.revoked_at ? "Dicabut" : isExpired ? "Kedaluwarsa" : "Aktif"}</span>
                    </td>
                    <td data-label="" style={{ padding: "8px 6px" }}>
                      {!k.revoked_at && (
                        <button className="approval-btn--danger" onClick={() => revokeKey(k.id)}><Trash size={14} /> Cabut</button>
                      )}
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
