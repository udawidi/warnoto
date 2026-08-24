// @ts-nocheck — file ini jalan di runtime Deno (Supabase Edge Functions),
// bukan Node/Vite seperti sisa proyek, jadi `Deno` global dan import
// esm.sh tidak dikenali TypeScript checker bawaan VS Code di sini.
//
// Supabase Edge Function — Admin mengubah profil user yang sudah ada dari
// menu "Kelola Akun" (nama, role, jabatan, UPT, ULTG, dan reset password
// opsional). Username TIDAK bisa diubah di sini karena terikat ke email
// login Supabase Auth (username@warnoto.pln.local) — ganti username berarti
// ganti email akun, di luar cakupan form edit ini.
//
// Kenapa lewat Edge Function (bukan supabase.from("profiles").update()
// langsung dari browser): tabel profiles SENGAJA tidak punya RLS policy
// insert/update untuk role authenticated biasa (lihat schema.sql), supaya
// user tidak bisa menaikkan role-nya sendiri lewat console browser. Admin
// pun tetap "authenticated" di level Postgres, jadi update tetap harus lewat
// service_role di server ini, dengan otorisasi role ADMIN dicek manual.
//
// ── CARA DEPLOY ──
//   npx supabase functions deploy admin-update-user --project-ref tadxodrzoquugnsyejld

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const VALID_ROLES = ["ADMIN","TL","ASMAN","MANAGER","ADMIN_UIT","ASMAN_LOG_UIT","MGR_LOGISTIK_UIT","ADMIN_LOG_PUSAT","ADMIN_ULTG","MGR_ULTG","PENGADAAN","VIEWER","SUPERADMIN"];

// Kuota role per UPT — sama seperti admin-create-user, tapi exclude user yang
// sedang diedit sendiri dari hitungan (dia "pindah slot", bukan nambah slot baru).
const UPT_ROLE_QUOTA = { MANAGER: 1, ASMAN: 1, TL: 1, ADMIN: 1, PENGADAAN: 1 };
const UIT_ROLE_QUOTA = { ADMIN_UIT: 5, ASMAN_LOG_UIT: 1, MGR_LOGISTIK_UIT: 1, PENGADAAN: 1 }; // ADMIN_LOG_PUSAT nasional, tidak terikat 1 UIT
const ROLE_LABELS = { ADMIN: "Admin Gudang", TL: "TL Logistik", ASMAN: "Asman Konstruksi", MANAGER: "Manager", PENGADAAN: "Tim Pengadaan", ADMIN_UIT: "Admin UIT", MGR_LOGISTIK_UIT: "Manager Logistik UIT", ASMAN_LOG_UIT: "Asman Logistik UIT", ADMIN_LOG_PUSAT: "Admin Logistik Pusat" };
const UIT_SCOPED_ROLES = ["ADMIN_UIT", "ASMAN_LOG_UIT", "MGR_LOGISTIK_UIT"];
// Peran nasional (Pusat): lingkupnya seluruh UPT dan UIT, tidak terikat unit mana pun.
const NATIONAL_ROLES = ["ADMIN_LOG_PUSAT"];

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

// Scope UPT: ADMIN hanya boleh kelola akun di UPT sendiri, SUPERADMIN lintas-UPT
// bebas. targetUptLama = UPT profil target di DB SEBELUM diubah, targetUptBaru
// = UPT tujuan dari body request (lihat pemakaian di admin-create-user, yang
// mengirim targetUptLama=targetUptBaru karena belum ada akun lama).
function bolehKelolaAkun(callerRole: string, callerUptId: string | null, targetUptLama: string | null, targetUptBaru: string | null): boolean {
  if (callerRole === "SUPERADMIN") return true;
  return targetUptLama === callerUptId && targetUptBaru === callerUptId;
}

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  try {
    // ── 1. Pastikan pemanggil login DAN role-nya ADMIN ──
    const authHeader = req.headers.get("Authorization") || "";
    const jwt = authHeader.replace(/^Bearer\s+/i, "");
    if (!jwt) return json({ ok: false, error: "Tidak ada sesi login." }, 401);

    const { data: callerAuth, error: callerErr } = await admin.auth.getUser(jwt);
    if (callerErr || !callerAuth?.user) return json({ ok: false, error: "Sesi login tidak valid, silakan login ulang." }, 401);

    const { data: callerProfile } = await admin.from("profiles").select("role, upt_id").eq("id", callerAuth.user.id).single();
    if (!callerProfile || (callerProfile.role !== "ADMIN" && callerProfile.role !== "SUPERADMIN")) {
      return json({ ok: false, error: "Hanya Admin yang bisa mengubah akun." }, 403);
    }

    // ── 2. Validasi input ──
    const body = await req.json().catch(() => ({}));
    const userId = String(body.userId || "").trim();
    const name = String(body.name || "").trim();
    const role = String(body.role || "").trim().toUpperCase();
    const jabatan = body.jabatan ? String(body.jabatan).trim() : null;
    const uptId = body.uptId ? String(body.uptId).trim() : null;
    const ultgId = body.ultgId ? String(body.ultgId).trim() : null;
    const uitId = body.uitId ? String(body.uitId).trim() : null;
    const pengadaanScope = String(body.pengadaanScope || "UPT").trim().toUpperCase();
    const newPassword = body.newPassword ? String(body.newPassword) : "";
    // Batasan akses per gudang (RBAC tingkat 2): null/undefined = semua gudang;
    // selain itu WAJIB array of string (id gudang).
    const gudangIdsRaw = body.gudangIds;
    if (gudangIdsRaw !== null && gudangIdsRaw !== undefined &&
        (!Array.isArray(gudangIdsRaw) || gudangIdsRaw.some((x) => typeof x !== "string"))) {
      return json({ ok: false, error: "gudangIds harus null atau array id gudang (string)." });
    }
    const gudangIds = (Array.isArray(gudangIdsRaw) && gudangIdsRaw.length) ? gudangIdsRaw : null;

    if (!userId) return json({ ok: false, error: "userId wajib diisi." });

    // ── 2a. Scope UPT — ADMIN (bukan SUPERADMIN) hanya boleh ubah akun yang SEKARANG
    //        (UPT lama di DB) maupun SETELAH diubah (UPT baru di body) ada di UPT sendiri.
    //        Cek dua-duanya supaya ADMIN tak bisa akali dengan mengirim uptId=UPT sendiri
    //        padahal mengedit akun yang aslinya di UPT lain.
    const { data: targetProfile, error: targetErr } = await admin.from("profiles").select("upt_id, role").eq("id", userId).single();
    if (targetErr || !targetProfile) return json({ ok: false, error: "Akun target tidak ditemukan." }, 404);
    if (!bolehKelolaAkun(callerProfile.role, callerProfile.upt_id, targetProfile.upt_id, uptId)) {
      return json({ ok: false, error: "ADMIN hanya boleh mengelola akun di UPT sendiri." }, 403);
    }
    if (!name) return json({ ok: false, error: "Nama lengkap wajib diisi." });
    if (!jabatan) return json({ ok: false, error: "Jabatan wajib diisi." });
    if (!VALID_ROLES.includes(role)) {
      return json({ ok: false, error: `Role tidak dikenal. Pilihan valid: ${VALID_ROLES.join(", ")}` });
    }
    if (role === "SUPERADMIN") {
      return json({ ok: false, error: "Role SUPERADMIN tidak bisa diatur lewat menu ini — hubungi pengelola sistem." });
    }
    if ((role === "ADMIN_ULTG" || role === "MGR_ULTG") && !ultgId) {
      return json({ ok: false, error: `Role ${role} wajib memilih unit ULTG.` });
    }
    if (newPassword && newPassword.length < 6) {
      return json({ ok: false, error: "Password baru minimal 6 karakter." });
    }

    const isNational = NATIONAL_ROLES.includes(role);
    const isUitScoped = UIT_SCOPED_ROLES.includes(role) || (role === "PENGADAAN" && pengadaanScope === "UIT");
    if (isNational) {
      // Lingkup nasional — tidak memilih UPT maupun UIT.
    } else if (isUitScoped) {
      if (!uitId) return json({ ok: false, error: `Role ${ROLE_LABELS[role] || role} wajib memilih unit UIT.` });
    } else {
      if (!uptId) return json({ ok: false, error: "UPT wajib dipilih." });
    }

    // ── 2b. Kuota role per UPT/UIT (hard limit), exclude diri sendiri —
    //        peran nasional tidak dikuotakan per unit (tidak punya upt_id/uit_id).
    if (isNational) {
      // tanpa kuota per unit
    } else if (isUitScoped) {
      if (UIT_ROLE_QUOTA[role] !== undefined) {
        const { data: existing, error: quotaErr } = await admin
          .from("profiles").select("name").eq("role", role).eq("uit_id", uitId).neq("id", userId);
        if (quotaErr) return json({ ok: false, error: `Gagal memeriksa kuota role: ${quotaErr.message}` });
        if ((existing?.length || 0) >= UIT_ROLE_QUOTA[role]) {
          const holder = existing[0]?.name || "user lain";
          return json({ ok: false, error: `UIT ini sudah punya ${ROLE_LABELS[role]}: ${holder}. Turunkan role user tersebut dulu sebelum menetapkan yang baru.` });
        }
      }
    } else if (UPT_ROLE_QUOTA[role] !== undefined) {
      const { data: existing, error: quotaErr } = await admin
        .from("profiles").select("name").eq("role", role).eq("upt_id", uptId).neq("id", userId);
      if (quotaErr) return json({ ok: false, error: `Gagal memeriksa kuota role: ${quotaErr.message}` });
      if ((existing?.length || 0) >= UPT_ROLE_QUOTA[role]) {
        const holder = existing[0]?.name || "user lain";
        return json({ ok: false, error: `UPT ini sudah punya ${ROLE_LABELS[role]}: ${holder}. Turunkan role user tersebut dulu sebelum menetapkan yang baru.` });
      }
    }

    // ── 3. Update profil ──
    const { error: profErr } = await admin.from("profiles").update({
      name, role, jabatan,
      upt_id: (isNational || isUitScoped) ? null : uptId,
      ultg_id: ultgId,
      uit_id: isUitScoped ? uitId : null,
      gudang_ids: gudangIds,
    }).eq("id", userId);
    if (profErr) return json({ ok: false, error: `Gagal menyimpan profil: ${profErr.message}` });

    // ── 4. Reset password (opsional) ──
    if (newPassword) {
      const { error: pwErr } = await admin.auth.admin.updateUserById(userId, { password: newPassword });
      if (pwErr) return json({ ok: false, error: `Profil tersimpan tapi gagal reset password: ${pwErr.message}` });
    }

    return json({ ok: true, userId });
  } catch (e) {
    return json({ ok: false, error: `Kesalahan tak terduga: ${e instanceof Error ? e.message : String(e)}` }, 500);
  }
});
