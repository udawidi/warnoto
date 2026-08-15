// Halaman Matrix Izin (ADMIN only) — atur izin efektif per role (kolom) × izin
// (baris, dikelompokkan Menu / Aksi). Nilai awal = efektif (override DB ?? default).
// Simpan → upsert row per role yang berubah ke tabel `role_permissions`; Reset →
// upsert perms '{}' (kembali ke default). SUPERADMIN read-only (selalu penuh).
import { Fragment, useEffect, useMemo, useState } from "react";
import { supabase } from "../supabaseClient.js";
import { ROLES } from "../lib/roles.js";
import { PERM_MENUS, PERM_AKSI, MATRIX_ROLES, effectivePerm, defaultPerm } from "../lib/perms.js";
import { isDemoMode } from "../lib/demo.js";
import { logAudit } from "../lib/audit.js";

const ALL_ROWS = [
  { group: "Menu", items: PERM_MENUS },
  { group: "Aksi", items: PERM_AKSI },
];
const ALL_KEYS = [...PERM_MENUS, ...PERM_AKSI].map(r => r.key);
const EDITABLE_ROLES = MATRIX_ROLES.filter(r => r !== "SUPERADMIN");

// Bangun draft {role:{key:bool}} dari nilai efektif saat ini.
function buildDraft(rolePerms) {
  const d = {};
  EDITABLE_ROLES.forEach(role => {
    d[role] = {};
    ALL_KEYS.forEach(key => { d[role][key] = effectivePerm(role, key, rolePerms); });
  });
  return d;
}

export function PermMatrixPage({ sty, C, currentUser, rolePerms, reloadRolePerms, showToast }) {
  const [draft, setDraft] = useState(() => buildDraft(rolePerms));
  const [saving, setSaving] = useState(false);

  // Sinkronkan ulang saat rolePerms dari DB berubah (mis. setelah simpan/reset).
  useEffect(() => { setDraft(buildDraft(rolePerms)); }, [rolePerms]);

  // Role yang nilainya berbeda dari yang tersimpan (efektif) → perlu di-simpan.
  const changedRoles = useMemo(() => EDITABLE_ROLES.filter(role =>
    ALL_KEYS.some(key => draft[role]?.[key] !== effectivePerm(role, key, rolePerms))
  ), [draft, rolePerms]);

  function toggle(role, key) {
    setDraft(d => ({ ...d, [role]: { ...d[role], [key]: !d[role][key] } }));
  }

  async function saveAll() {
    if (isDemoMode()) { showToast?.("Mode demo: perubahan izin tidak disimpan.", "error"); return; }
    if (!supabase || changedRoles.length === 0) return;
    setSaving(true);
    const by = currentUser?.username || currentUser?.name || null;
    let ok = 0;
    for (const role of changedRoles) {
      const perms = {};
      ALL_KEYS.forEach(key => { perms[key] = !!draft[role][key]; });
      const { error } = await supabase.from("role_permissions").upsert(
        { role, perms, updated_at: new Date().toISOString(), updated_by: by },
        { onConflict: "role" }
      );
      if (error) { showToast?.(`Gagal simpan ${ROLES[role] || role}: ${error.message}`, "error"); continue; }
      ok++;
      const diff = ALL_KEYS.filter(key => perms[key] !== defaultPerm(role, key));
      logAudit(currentUser, "UPDATE", "role_permissions", role, { role, overrideCount: diff.length, overrides: diff });
    }
    setSaving(false);
    if (ok > 0) { await reloadRolePerms?.(); showToast?.(`✅ Izin ${ok} role disimpan.`); }
  }

  async function resetRole(role) {
    if (isDemoMode()) { showToast?.("Mode demo: perubahan izin tidak disimpan.", "error"); return; }
    if (!supabase) return;
    setSaving(true);
    const { error } = await supabase.from("role_permissions").upsert(
      { role, perms: {}, updated_at: new Date().toISOString(), updated_by: currentUser?.username || currentUser?.name || null },
      { onConflict: "role" }
    );
    setSaving(false);
    if (error) { showToast?.(`Gagal reset ${ROLES[role] || role}: ${error.message}`, "error"); return; }
    logAudit(currentUser, "UPDATE", "role_permissions", role, { role, reset: true });
    await reloadRolePerms?.();
    showToast?.(`↩️ Izin ${ROLES[role] || role} dikembalikan ke default.`);
  }

  const cellStyle = { padding: "6px 8px", textAlign: "center", borderBottom: `1px solid ${C.border}`, whiteSpace: "nowrap" };
  const headStyle = { padding: "8px 8px", textAlign: "center", borderBottom: `2px solid ${C.border}`, fontSize: 12, fontWeight: 800, whiteSpace: "nowrap" };

  return (
    <div className="admin-mobile-page permission-matrix-page" style={sty.card}>
      <div className="permission-matrix-page__intro">
        <div tabIndex={0} className="info-note" style={{ fontSize: 12, color: C.muted, maxWidth: 620 }}>
          Centang izin per role. Titik • menandai izin yang <b>berbeda dari default</b>. Perubahan approval bisnis (persetujuan TUG) tetap terkunci di kode dan tidak diatur di sini. Kolom Super Admin selalu penuh.
        </div>
        <button style={{ ...sty.btn("primary"), opacity: (saving || changedRoles.length === 0) ? 0.55 : 1 }}
          disabled={saving || changedRoles.length === 0} onClick={saveAll}>
          {saving ? "Menyimpan..." : `💾 Simpan${changedRoles.length ? ` (${changedRoles.length} role)` : ""}`}
        </button>
      </div>

      <div className="permission-matrix-table">
        <table style={{ borderCollapse: "collapse", fontSize: 12, width: "100%" }}>
          <thead>
            <tr>
              <th style={{ ...headStyle, textAlign: "left", position: "sticky", left: 0, background: C.card || "#fff" }}>Izin</th>
              {MATRIX_ROLES.map(role => (
                <th key={role} style={headStyle}>{ROLES[role] || role}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ALL_ROWS.map(section => (
              <Fragment key={section.group}>
                <tr>
                  <td colSpan={MATRIX_ROLES.length + 1} style={{ padding: "8px 8px 4px", fontSize: 12, fontWeight: 800, color: C.accent, textTransform: "uppercase", letterSpacing: ".4px" }}>{section.group}</td>
                </tr>
                {section.items.map(row => (
                  <tr key={row.key}>
                    <td style={{ padding: "6px 8px", borderBottom: `1px solid ${C.border}`, position: "sticky", left: 0, background: C.card || "#fff", fontWeight: 600 }}>{row.label}</td>
                    {MATRIX_ROLES.map(role => {
                      if (role === "SUPERADMIN") {
                        return <td data-role={ROLES[role] || role} key={role} style={cellStyle}><input type="checkbox" checked readOnly disabled /></td>;
                      }
                      const val = !!draft[role]?.[row.key];
                      const isDiff = val !== defaultPerm(role, row.key);
                      return (
                        <td data-role={ROLES[role] || role} key={role} style={cellStyle}>
                          <span style={{ position: "relative", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
                            <input type="checkbox" checked={val} onChange={() => toggle(role, row.key)} />
                            {isDiff && <span title="Berbeda dari default" style={{ position: "absolute", top: -3, right: -6, width: 6, height: 6, borderRadius: "50%", background: "#f59e0b" }} />}
                          </span>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </Fragment>
            ))}
            <tr>
              <td style={{ padding: "8px 8px", fontSize: 12, fontWeight: 700, color: C.muted, position: "sticky", left: 0, background: C.card || "#fff" }}>Reset</td>
              {MATRIX_ROLES.map(role => (
                <td data-role={ROLES[role] || role} key={role} style={cellStyle}>
                  {role === "SUPERADMIN"
                    ? <span style={{ color: C.muted, fontSize: 12 }}>—</span>
                    : <button style={sty.btn("ghost", "sm")} disabled={saving} onClick={() => resetRole(role)} title="Kembalikan ke default">↩️</button>}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
