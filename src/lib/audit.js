import { supabase } from "../supabaseClient.js";
import { isDemoMode } from "./demo.js";

// Catat jejak audit (append-only, tabel audit_log). Fire-and-forget:
// gagal insert cuma warning console, tidak boleh mengganggu alur user.
export function logAudit(user, action, entity, entityId = null, detail = null) {
  try {
    if (!supabase || isDemoMode()) return;
    supabase.from("audit_log").insert({
      user_id: user?.id || null, user_name: user?.name || null, role: user?.role || null,
      action, entity, entity_id: entityId != null ? String(entityId) : null, detail,
    }).then(({ error }) => { if (error) console.warn("logAudit:", error.message); });
  } catch {}
}
