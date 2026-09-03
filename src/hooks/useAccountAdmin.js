import { useState } from "react";
import { supabase, usernameToAuthEmail } from "../supabaseClient.js";
import { ROLES } from "../lib/roles.js";
import { isDemoMode } from "../lib/demo.js";
import { logAudit } from "../lib/audit.js";

// Domain "Manajemen Akun/User" (kelola akun ADMIN + ganti password mandiri) —
// diekstrak murni dari PLNWarehouse() (App.jsx), TANPA perubahan logic.
// reloadUsers dioper dari App.jsx karena ia menulis ke state `users` yang
// bukan bagian domain ini (lihat setUsers di App.jsx).
export function useAccountAdmin({ currentUser, showToast, reloadUsers }) {
  const [akunModal, setAkunModal] = useState(null); // null | "add"
  const [akunForm, setAkunForm] = useState({});
  const [akunBusy, setAkunBusy] = useState(false);
  const [akunResult, setAkunResult] = useState(null); // {username,password} setelah sukses daftar
  const [gantiPasswordModal, setGantiPasswordModal] = useState(false);
  const [gantiPasswordForm, setGantiPasswordForm] = useState({oldPassword:"", newPassword:"", confirmPassword:""});
  const [gantiPasswordBusy, setGantiPasswordBusy] = useState(false);

  // Kelola Akun (ADMIN only) — daftarkan user baru lewat Edge Function
  // admin-create-user (service_role di server, supaya sesi Admin yang lagi
  // login tidak ketimpa jadi sesi user baru seperti kalau pakai signUp() biasa
  // langsung dari browser).
  function openAddAkun() {
    setAkunForm({username:"", password:"", name:"", role:"VIEWER", jabatan:"", officialPhone:"", uptId:"", ultgId:"", uitId:"", pengadaanScope:"UPT", gudangIds:[]});
    setAkunResult(null);
    setAkunModal("add");
  }
  function openEditAkun(u) {
    setAkunForm({id:u.id, username:u.username, password:"", name:u.name||"", role:u.role||"VIEWER", jabatan:u.jabatan||"", officialPhone:u.officialPhone||"", uptId:u.uptId||"", ultgId:u.ultgId||"", uitId:u.uitId||"", pengadaanScope:u.uitId?"UIT":"UPT", gudangIds:Array.isArray(u.gudangIds)?u.gudangIds:[]});
    setAkunResult(null);
    setAkunModal("edit");
  }
  // Role level-UIT (ADMIN_UIT/ASMAN_LOG_UIT/MGR_LOGISTIK_UIT) dan PENGADAAN mode UIT
  // pakai uitId, bukan uptId — field-nya saling eksklusif di form (lihat render modal).
  // ADMIN_LOG_PUSAT tidak termasuk: nasional, tidak terikat satu UIT.
  function isUitScopedRole(f) {
    return ["ADMIN_UIT","ASMAN_LOG_UIT","MGR_LOGISTIK_UIT"].includes(f.role) || (f.role==="PENGADAAN" && f.pengadaanScope==="UIT");
  }
  // Peran nasional (Pusat): lingkupnya seluruh UPT dan UIT, jadi tidak memilih
  // unit apa pun. Tanpa cabang ini ia jatuh ke "UPT wajib dipilih" dan menyimpan
  // upt_id yang salah secara semantik untuk peran nasional.
  function isNationalRole(f) { return f.role === "ADMIN_LOG_PUSAT"; }
  async function submitAkunEdit() {
    if (isDemoMode()) { showToast("Mode demo: manajemen akun dinonaktifkan.","error"); return; }
    const f = akunForm;
    if (!f.name?.trim()) { showToast("Nama lengkap wajib diisi.","error"); return; }
    if (!f.jabatan?.trim()) { showToast("Jabatan wajib diisi.","error"); return; }
    const national = isNationalRole(f);
    const uitScoped = isUitScopedRole(f);
    if (national) { /* lingkup nasional — tidak memilih UPT maupun UIT */ }
    else if (uitScoped) { if (!f.uitId) { showToast(`Role ${ROLES[f.role]} wajib memilih unit UIT.`,"error"); return; } }
    else { if (!f.uptId) { showToast("UPT wajib dipilih.","error"); return; } }
    if ((f.role==="ADMIN_ULTG"||f.role==="MGR_ULTG") && !f.ultgId) { showToast(`Role ${ROLES[f.role]} wajib memilih unit ULTG.`,"error"); return; }
    if (f.password && f.password.length < 6) { showToast("Password baru minimal 6 karakter.","error"); return; }
    setAkunBusy(true);
    const { data, error } = await supabase.functions.invoke("admin-update-user", { body: {
      userId: f.id, name: f.name.trim(), role: f.role, jabatan: f.jabatan||"", officialPhone: f.officialPhone||"",
      uptId: (national || uitScoped) ? "" : (f.uptId||""), ultgId: f.ultgId||"", uitId: uitScoped ? (f.uitId||"") : "",
      pengadaanScope: f.pengadaanScope||"UPT", newPassword: f.password||"",
      gudangIds: (Array.isArray(f.gudangIds) && f.gudangIds.length) ? f.gudangIds : null, // null = semua gudang
    }});
    setAkunBusy(false);
    if (error || !data?.ok) { showToast(data?.error || error?.message || "Gagal menyimpan perubahan akun.","error"); return; }
    setAkunModal(null);
    await reloadUsers();
    logAudit(currentUser, "UPDATE", "akun", f.username, {nama:f.name, role:f.role});
    showToast("✅ Akun berhasil diperbarui!");
  }
  async function submitAkunBaru() {
    if (isDemoMode()) { showToast("Mode demo: manajemen akun dinonaktifkan.","error"); return; }
    const f = akunForm;
    if (!f.username?.trim()) { showToast("Username wajib diisi.","error"); return; }
    if (!f.password || f.password.length < 6) { showToast("Password minimal 6 karakter.","error"); return; }
    if (!f.name?.trim()) { showToast("Nama lengkap wajib diisi.","error"); return; }
    if (!f.jabatan?.trim()) { showToast("Jabatan wajib diisi.","error"); return; }
    const national = isNationalRole(f);
    const uitScoped = isUitScopedRole(f);
    if (national) { /* lingkup nasional — tidak memilih UPT maupun UIT */ }
    else if (uitScoped) { if (!f.uitId) { showToast(`Role ${ROLES[f.role]} wajib memilih unit UIT.`,"error"); return; } }
    else { if (!f.uptId) { showToast("UPT wajib dipilih.","error"); return; } }
    if ((f.role==="ADMIN_ULTG"||f.role==="MGR_ULTG") && !f.ultgId) { showToast(`Role ${ROLES[f.role]} wajib memilih unit ULTG.`,"error"); return; }
    setAkunBusy(true);
    const { data, error } = await supabase.functions.invoke("admin-create-user", { body: {
      username: f.username.trim().toLowerCase(), password: f.password, name: f.name.trim(),
      role: f.role, jabatan: f.jabatan||"", officialPhone: f.officialPhone||"", uptId: (national || uitScoped) ? "" : (f.uptId||""), ultgId: f.ultgId||"",
      uitId: uitScoped ? (f.uitId||"") : "", pengadaanScope: f.pengadaanScope||"UPT",
      gudangIds: (Array.isArray(f.gudangIds) && f.gudangIds.length) ? f.gudangIds : null, // null = semua gudang
    }});
    setAkunBusy(false);
    if (error || !data?.ok) { showToast(data?.error || error?.message || "Gagal mendaftarkan akun.","error"); return; }
    setAkunResult({username: f.username.trim().toLowerCase(), password: f.password});
    await reloadUsers();
    logAudit(currentUser, "CREATE", "akun", f.username.trim().toLowerCase(), {nama:f.name, role:f.role});
    showToast("✅ Akun berhasil didaftarkan!");
  }

  // Ganti password mandiri (semua role, akun sendiri) — re-auth pakai password
  // lama dulu (signInWithPassword) sebelum panggil updateUser, supaya device
  // dengan sesi aktif yang lagi dipegang orang lain tidak bisa ganti password
  // pemilik akun tanpa tahu password lamanya.
  function openGantiPassword() {
    setGantiPasswordForm({oldPassword:"", newPassword:"", confirmPassword:""});
    setGantiPasswordModal(true);
  }
  async function submitGantiPassword() {
    if (isDemoMode()) { showToast("Mode demo: ganti password dinonaktifkan.","error"); return; }
    const f = gantiPasswordForm;
    if (!f.oldPassword) { showToast("Password lama wajib diisi.","error"); return; }
    if (!f.newPassword || f.newPassword.length < 6) { showToast("Password baru minimal 6 karakter.","error"); return; }
    if (f.newPassword !== f.confirmPassword) { showToast("Konfirmasi password baru tidak cocok.","error"); return; }
    setGantiPasswordBusy(true);
    const { error: reauthErr } = await supabase.auth.signInWithPassword({
      email: usernameToAuthEmail(currentUser.username), password: f.oldPassword,
    });
    if (reauthErr) {
      setGantiPasswordBusy(false);
      showToast("Password lama salah.","error");
      return;
    }
    const { error: updateErr } = await supabase.auth.updateUser({ password: f.newPassword });
    setGantiPasswordBusy(false);
    if (updateErr) { showToast("Gagal mengubah password: "+updateErr.message,"error"); return; }
    setGantiPasswordModal(false);
    logAudit(currentUser, "UPDATE", "akun", currentUser.username, {gantiPassword:true});
    showToast("✅ Password berhasil diubah!");
  }

  // Reset 2FA (TOTP) akun lain — recovery admin saat user kehilangan HP
  // authenticator (2FA wajib semua user, tanpa ini akun terkunci permanen).
  // Lewat Edge Function service_role (pola sama admin-create-user), bukan
  // langsung dari browser karena admin.mfa.deleteFactor butuh service_role key.
  async function resetMfa(u) {
    if (isDemoMode()) { showToast("Mode demo: reset 2FA dinonaktifkan.","error"); return; }
    if (!window.confirm(`Reset verifikasi 2 langkah untuk ${u.name}? User akan diminta scan ulang QR saat login berikutnya.`)) return;
    const { data, error } = await supabase.functions.invoke("admin-reset-mfa", { body: { userId: u.id } });
    if (error || !data?.ok) { showToast(data?.error || error?.message || "Gagal mereset verifikasi 2 langkah.","error"); return; }
    logAudit(currentUser, "UPDATE", "akun", u.username, { resetMfa:true });
    showToast("✅ Verifikasi 2 langkah direset — user akan diminta enroll ulang.");
  }

  return {
    akunModal, setAkunModal, akunForm, setAkunForm, akunBusy, setAkunBusy, akunResult, setAkunResult,
    gantiPasswordModal, setGantiPasswordModal, gantiPasswordForm, setGantiPasswordForm, gantiPasswordBusy, setGantiPasswordBusy,
    openAddAkun, openEditAkun, isUitScopedRole, isNationalRole, submitAkunEdit, submitAkunBaru,
    openGantiPassword, submitGantiPassword, resetMfa,
  };
}
