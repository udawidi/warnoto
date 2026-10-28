# AKUN_LOGIN_SPEC.md

# Spesifikasi Aturan Akun & Login WARNOTO

Dokumen ini mengumpulkan semua aturan seputar **akun user, password, dan role** yang dibahas terpisah dari `WARNOTO_DOCS.md`/`SYSTEM_OVERVIEW.md`, supaya tidak bercampur dengan dokumentasi modul lain (Stock Opname, TUG, Material Cadang, dst).

Status dokumen (2026-07-07): **Semua fitur (A, B termasuk kuota UIT, dan C/SUPERADMIN) SUDAH DIIMPLEMENTASIKAN dan dideploy ke production.** Skenario B Fitur A (reset password lupa) DITUTUP — tetap manual ke Admin, tidak jadi fitur baru. Riwayat awal dokumen ini hasil sesi `/plan-warnoto`; bagian yang sudah dieksekusi ditandai eksplisit di bawah.

---

## 1. Konteks Sistem Login Saat Ini

- Login pakai Supabase Auth (`auth.users`), bukan array password polos. Username diterjemahkan ke email palsu `username@warnoto.pln.local` (lihat `App.jsx` fungsi `usernameToAuthEmail`, dan `admin-create-user/index.ts:30`) — **bukan email asli**, jadi alur "lupa password via link email" standar Supabase tidak bisa dipakai apa adanya.
- Tabel `profiles` (schema.sql:233-243): `id, username, name, role, jabatan, avatar, upt_id, ultg_id, created_at`. Role disimpan sebagai teks bebas, divalidasi lewat `VALID_ROLES` di kedua Edge Function.
- Role yang ada sekarang (App.jsx:79): `ADMIN` (Admin Gudang), `TL` (TL Logistik), `ASMAN` (Asman Konstruksi), `MANAGER` (Manager UPT), `ADMIN_UIT`, `MGR_LOGISTIK_UIT`, `ADMIN_ULTG`, `MGR_ULTG`, `PENGADAAN`, `VIEWER`.
- Pendaftaran/edit akun sekarang lewat menu "Kelola Akun" (ADMIN only) → Edge Function `admin-create-user` dan `admin-update-user` (service_role, bypass RLS `profiles` yang sengaja tidak izinkan insert/update dari `authenticated` biasa).
- Reset password oleh Admin sudah ada (`admin-update-user/index.ts:87-91`, field `newPassword` opsional). Yang **belum ada**: user ganti/reset password sendiri.

---

## 2. Fitur A — Ganti Password Mandiri (Self-Service)

**Status: SUDAH DIIMPLEMENTASIKAN (2026-07-07), skenario A saja.** Tombol 🔑 di sidebar (App.jsx, dekat tombol logout) membuka modal ganti password: password lama, password baru, konfirmasi. Re-auth via `signInWithPassword` dulu untuk verifikasi password lama, baru `supabase.auth.updateUser({password})`. Berlaku semua role.

**Skenario B (reset password saat lupa/belum bisa login) DITUTUP (2026-07-07)** — keputusan: tetap manual ke Admin (Kelola Akun → Edit Akun → Reset Password), tidak jadi fitur baru. Opsi lain yang sempat dibahas (arsip):
- Tetap manual ke Admin (status quo).
- User isi username + data verifikasi (NIP/jabatan/UPT) di layar login, cocok → boleh set password baru lewat Edge Function baru.
- Admin generate kode reset sekali pakai, diberikan manual (WA/japri), user pakai kode itu di layar khusus.

### Risiko yang sudah ditangani
- Re-auth password lama wajib sebelum `updateUser` — mencegah device dengan sesi aktif dipakai orang lain ganti password diam-diam.

### Risiko yang masih terbuka
- Tidak ada notifikasi email "password baru saja diubah" (tidak ada email asli) — belum ada audit trail untuk perubahan password mandiri.
- Skenario B (reset tanpa login) berisiko jadi celah keamanan kalau nanti dikerjakan dengan verifikasi identitas yang lemah.

### Pertanyaan terbuka (untuk skenario B, kalau mau dikerjakan)
- Pilih opsi mana dari 3 yang disebut di atas?
- Perlu audit log perubahan password?

---

## 3. Fitur B — Kuota Role per Unit

**Status: Kuota UPT DAN Kuota UIT SUDAH DIIMPLEMENTASIKAN & DIDEPLOY (2026-07-07).**

### Goal
Cegah rangkap jabatan struktural sesuai kuota tiap role dan unit. Admin Gudang dapat diisi hingga 3 orang per UPT; posisi kunci lain tetap mengikuti batasnya masing-masing.

### Keputusan 2026-07-07: kerjakan UPT dulu, UIT ditunda

| Unit | Role | Maksimum | Status |
|---|---|---|---|
| Per UPT | MANAGER (Manager UPT) | 1 | **Dikerjakan sekarang** |
| Per UPT | ASMAN | 1 | **Dikerjakan sekarang** |
| Per UPT | TL | 1 | **Dikerjakan sekarang** |
| Per UPT | ADMIN (Admin Gudang) | 3 | ✅ Selesai (2026-10-28) |
| Per UPT | PENGADAAN (scope UPT) | 1 | ✅ Selesai (2026-07-07) |
| Per UIT | ADMIN_UIT | 1 | ✅ Selesai (2026-07-07) |
| Per UIT | MGR_LOGISTIK_UIT | 1 | ✅ Selesai (2026-07-07) |
| Per UIT | PENGADAAN (scope UIT) | 1 | ✅ Selesai (2026-07-07) |
| Per ULTG | MGR_ULTG | 1 | Ditunda (belum diminta eksekusi) |
| Per ULTG | ADMIN_ULTG | 3 | Ditunda (belum diminta eksekusi) |
| — | VIEWER | tidak terbatas | Default, tidak perlu validasi |
| Global | SUPERADMIN | 1 (bukan per unit) | ✅ Selesai (2026-07-07), lihat bagian 4 |

Catatan desain PENGADAAN (untuk fase UIT nanti): role value tetap `"PENGADAAN"` untuk keduanya, dibedakan lewat kolom mana yang terisi — `upt_id` terisi (+`uit_id` kosong) = Pengadaan-UPT; `uit_id` terisi (+`upt_id` kosong) = Pengadaan-UIT. Satu akun hanya boleh salah satu.

### Kuota UIT — status: SUDAH DIIMPLEMENTASIKAN & DIDEPLOY (2026-07-07)
**Proposal A dijalankan**: kolom `uit_id text` ditambahkan ke `profiles` lewat migration `add_uit_id_to_profiles` (di project `tadxodrzoquugnsyejld`, tanpa FK constraint di `schema.sql` supaya tidak forward-reference ke tabel `uit` yang baru didefinisikan belakangan — FK tetap ada di migration live-nya). Tidak perlu backfill data lama karena dicek kosong (tidak ada akun ADMIN_UIT/MGR_LOGISTIK_UIT/PENGADAAN existing per 2026-07-07).

`admin-create-user`/`admin-update-user` sekarang terima `uitId` + `pengadaanScope` ("UPT"/"UIT"). Role ADMIN_UIT/MGR_LOGISTIK_UIT/PENGADAAN-mode-UIT wajib `uitId`, `uptId` dikosongkan otomatis (saling eksklusif). Form Kelola Akun (App.jsx) punya field UIT terpisah + toggle "Pengadaan UPT"/"Pengadaan UIT" + indikator kuota real-time. `scripts/bulk_create_users.mjs` juga sudah mendukung kolom CSV `uit_id`/`pengadaan_scope` dengan validasi kuota yang sama.

### Alur Pengguna (fase UPT)
1. Admin buka Kelola Akun → pilih Role + UPT.
2. Sistem cek `count(*) from profiles where role=X and upt_id=Y` (exclude user yang sedang diedit sendiri kalau ini alur edit).
3. Kuota penuh → tolak dengan pesan jelas + nama user yang sedang menempati slot.
4. Kuota masih ada → simpan seperti biasa.

### Rencana UI
- Form Kelola Akun tampilkan indikator kuota real-time saat Role+UPT dipilih (mis. "Slot Manager UPT: 1/1 terisi (Budi S.)").
- Submit ditolak dengan pesan error yang jelas, bukan validasi diam-diam.

### Status: SUDAH DIIMPLEMENTASIKAN & DIDEPLOY (2026-07-07)
- **Hard limit dipilih** (bukan soft warning): `admin-create-user` dan `admin-update-user` (Edge Functions) menolak total kalau slot MANAGER/ASMAN/TL/PENGADAAN di 1 UPT sudah terisi, atau slot ADMIN sudah mencapai 3 akun. Pesan error menyebut nama pemegang slot. Admin wajib turunkan role user lama dulu — tidak ada auto-downgrade.
- Indikator kuota real-time ditambahkan di form Kelola Akun (App.jsx), dihitung dari data `users` yang sudah ada di state.
- **Audit data existing (2026-07-07)**: dicek via SQL langsung ke Supabase — hasil **kosong, tidak ada UPT yang melanggar kuota ini**. Tidak ada akun yang perlu diturunkan/dinonaktifkan.
- **`scripts/bulk_create_users.mjs` sudah ditambahkan validasi kuota yang sama** — baseline dihitung dari data existing di DB sebelum loop CSV berjalan, plus tracking in-memory supaya 2 baris CSV yang bentrok (klaim role sama di UPT sama) di batch yang sama juga tertangkap. Re-run CSV yang sama (idempotent, username sama) tetap diizinkan.

### Risiko yang masih perlu diperhatikan ke depan
- **Race condition**: dua Admin daftarkan Manager UPT sama di waktu hampir bersamaan lewat 2 tab browser berbeda — keduanya bisa lolos cek kuota karena belum ada locking/transaksi atomik di Edge Function. Belum terjadi masalah nyata, tapi kalau ke depan dianggap perlu, perlu tambahan re-check tepat sebelum commit.

---

## 4. Fitur C — Role SUPERADMIN (Global)

**Status: SUDAH DIIMPLEMENTASIKAN & DIDEPLOY (2026-07-07). Opsi yang dipilih: (b) Full-access termasuk approval, bypass alur berjenjang.**

### Goal
1 akun khusus dengan akses ke semua data lintas UPT & UIT, exempt dari aturan kuota per-unit (kuota SUPERADMIN = 1 secara global, bukan per unit), dan bisa melakukan approval/aksi role-specific apapun di unit manapun.

### Implementasi
- `"SUPERADMIN"` ditambahkan ke `ROLES` (App.jsx) dan `VALID_ROLES` (kedua Edge Function + `bulk_create_users.mjs`), tapi **ditolak eksplisit** kalau dicoba dibuat/diedit lewat `admin-create-user`/`admin-update-user`/CSV bulk — pesan error "hubungi pengelola sistem". Juga disembunyikan dari dropdown Role di form Kelola Akun.
- Helper terpusat `hasRole(currentUser, ...allowedRoles)` (App.jsx, dekat konstanta `ROLES`) — return `true` kalau `currentUser.role==="SUPERADMIN"`, atau kalau role ada di daftar yang diizinkan. Semua ~140 titik pengecekan role literal (`currentUser.role==="X"`, `.includes(currentUser.role)`) di-refactor pakai helper ini (regex-based, diverifikasi build sukses tiap tahap).
- **Compound-scope gates** (yang tidak cukup cuma bypass role, karena ada pengecekan kepemilikan unit tambahan) ditambal manual satu per satu: `canApproveHeavyEquipmentLoan`, `approveTUG5_MgrULTG`, `approveTxn`/`rejectTxn` (requiredApprover match), `myPendingApprovals`, `ultgPengajuanUntukAdopt`/`ultgPoolAdopt` (adopt TUG-5 ULTG), dan `isMSB` (heavy equipment cross-UPT view) — semua diberi jalur eksplisit `currentUser.role==="SUPERADMIN"` yang bypass syarat kecocokan unit (uptId/ultgId).
- `admin-create-user`/`admin-update-user` juga mengizinkan pemanggil dengan role SUPERADMIN (selain ADMIN) untuk mengelola akun lewat Kelola Akun.
- Akun pertama **dibuat manual lewat SQL** (bukan lewat UI), sesuai keputusan:
  1. Supabase Dashboard → Authentication → Add User (isi email `<username>@warnoto.pln.local` + password).
  2. Trigger `on_auth_user_created` otomatis bikin stub profile role VIEWER.
  3. `update profiles set role='SUPERADMIN', name='...', jabatan='Super Admin' where username='<username>';`

### Batasan yang diketahui (residual, disengaja tidak dikejar lebih jauh)
- Beberapa **badge count**/list-filtering untuk item lintas-UPT (bukan action gate, cuma tampilan jumlah notifikasi) mungkin masih menghitung dari sudut pandang "UPT default" untuk SUPERADMIN alih-alih benar-benar lintas semua unit, karena app ini pada dasarnya didesain 1-UPT-per-deployment (banyak filter pakai konstanta `UPT` global, bukan field per-user). Aksi intinya (approve/reject/adopt) sudah dipastikan bisa dilakukan SUPERADMIN di unit manapun; badge angka di beberapa tempat mungkin belum 100% presisi.
- Riwayat approval (`approvedByAsman`, `approvedByManager`, dst) akan mencatat SUPERADMIN kalau dia yang approve — user sudah setuju ini boleh dibiarkan apa adanya, tidak perlu anotasi "atas nama role X" tambahan.
- Tidak ada audit log terpisah untuk aktivitas SUPERADMIN — risiko keamanan tetap ada kalau kredensial bocor, disarankan password panjang/acak dan tidak dipakai harian.

---

## 5. Ringkasan Status & Urutan Kerja yang Disarankan

1. **Fitur B (kuota UPT)** — ✅ SELESAI & LIVE (2026-07-07): Edge Functions dideploy, indikator UI di Kelola Akun, validasi juga ditambahkan ke `scripts/bulk_create_users.mjs`, audit data existing bersih (tidak ada pelanggaran).
2. **Fitur A (ganti password mandiri)** — ✅ skenario A SELESAI & LIVE (2026-07-07). Skenario B (reset lupa password) DITUTUP — tetap manual ke Admin, bukan fitur baru.
3. **Fitur B lanjutan (kuota UIT)** — ✅ SELESAI & LIVE (2026-07-07), termasuk migrasi kolom `uit_id`.
4. **Fitur C (SUPERADMIN)** — ✅ SELESAI & LIVE (2026-07-07), full-access termasuk bypass approval berjenjang. Lihat batasan residual di bagian 4.

Semua item dari sesi `/plan-warnoto` per 2026-07-07 sudah dieksekusi. Dokumen ini tetap jadi rujukan kalau ada perubahan/perluasan aturan akun-login di masa depan — jangan duplikasi aturan ini di `WARNOTO_DOCS.md`/`SYSTEM_OVERVIEW.md`, cukup taruh referensi silang ke sini kalau perlu.
