# Rencana Aplikasi Android (APK) WARNOTO

Dokumen ini adalah planning tracker untuk membungkus WARNOTO (React/Vite, App.jsx) menjadi
aplikasi Android yang bisa diinstall sebagai file APK, menggunakan **Capacitor**.

Status: **PLANNING**, dibuat 2026-07-09.
Dicicil per sesi — centang checklist di bawah tiap tahap selesai, jangan lompat tahap.
Testing dilakukan manual oleh user di HP fisik khusus (bukan emulator).

---

## 1. Keputusan yang Sudah Diambil

| Pertanyaan | Keputusan |
|---|---|
| Simpan planning di mana? | Dokumen ini (`docs/ANDROID_APP_PLAN.md`), diupdate tiap sesi kerja |
| Target akhir | **APK** (via Capacitor), bukan cuma PWA "Add to Home Screen" |
| Ikon app | **Konsep A — "Petir Gudang"** dipilih (navy radial `#123f96→#071f4d` + petir kuning `#ffc629`), lihat section 4 |
| Siapa yang test | User sendiri, punya HP fisik khusus untuk uji coba tiap tahap |

## 2. Kenapa Capacitor (bukan PWA polos)

WARNOTO sudah pakai kamera (upload foto denah/opname via `<input type="file" capture>`),
banyak modal/popup, dan koneksi Supabase real-time. Capacitor membungkus build web yang
sama (`dist/`) ke dalam project Android native, jadi:
- Tetap 1 codebase React (App.jsx) — tidak ada logic bisnis yang ditulis ulang.
- Hasil akhirnya file `.apk` yang bisa di-sideload ke HP mana pun tanpa Play Store dulu.
- Kalau nanti mau ke Play Store, tinggal generate signed bundle dari project yang sama.
- Ikon, splash screen, warna status bar bisa diatur native (lebih rapi dari PWA banner biasa).

## 3. Tahapan Kerja (checklist, dicicil per sesi)

### Tahap 1 — Branding & Aset Visual
- [x] Finalisasi konsep ikon app — **Konsep A "Petir Gudang" dipilih** (2026-07-09)
- [ ] Export ikon ke semua ukuran yang dibutuhkan Android (adaptive icon: foreground + background layer, 512x512 Play Store listing)
- [ ] Desain splash screen (logo di tengah, background warna tema `#003087`)
- [ ] Tetapkan nama app resmi & package ID (mis. `id.pln.warnoto` atau `com.pln.uptsby.warnoto`)

### Tahap 2 — Setup Project Capacitor
- [ ] Install `@capacitor/core`, `@capacitor/cli`, `@capacitor/android` sebagai dev dependency
- [ ] `npx cap init` (isi nama app + package ID dari Tahap 1)
- [ ] Pastikan `vite build` menghasilkan `dist/` yang valid sebagai `webDir` Capacitor
- [ ] `npx cap add android` — generate folder `android/` (project Android Studio)
- [ ] Commit awal project Capacitor (folder `android/` masuk git, kecuali build artifact)

### Tahap 3 — Konfigurasi Native
- [ ] Pasang ikon & splash hasil Tahap 1 ke project `android/`
- [ ] Set permission Android yang dibutuhkan: **Camera** (upload foto denah/opname), **Internet**, **Storage** (kalau perlu simpan file lokal)
- [ ] Cek status bar / safe-area di mode fullscreen native (WARNOTO sudah punya `isMobile` logic — sinkronkan warna status bar dengan sidebar `#003087`)
- [ ] Tangani tombol Back Android (jangan sampai keluar app tanpa sengaja saat lagi isi form)
- [ ] Ganti CDN Leaflet (`unpkg.com`) ke bundle lokal — supaya peta gudang tidak gagal load kalau CDN lambat/diblokir di jaringan kantor

### Tahap 4 — Build & Test di HP Fisik
- [ ] `npx cap sync` setelah tiap perubahan `dist/`
- [ ] Build debug APK dari Android Studio (atau `./gradlew assembleDebug`)
- [ ] Sideload ke HP test user, coba alur utama: login, Data Stok, upload foto opname, Master Gudang, notifikasi approval
- [ ] Catat bug/ketidaksesuaian di section 6 dokumen ini

### Tahap 5 — Release Prep (setelah Tahap 4 stabil)
- [ ] Buat signing key (keystore) — **simpan aman, hilang = tidak bisa update app yang sama selamanya**
- [ ] Build release APK signed
- [ ] Putuskan distribusi: bagikan file `.apk` langsung (internal PLN) vs submit ke Play Store (perlu akun Developer, biaya sekali $25, proses review Google)
- [ ] (Kalau Play Store) siapkan listing: screenshot, deskripsi, kebijakan privasi

## 4. Konsep Desain Ikon — Terpilih

**Konsep A — "Petir Gudang"** dipilih dari 3 preview (artifact, 2026-07-09).

- Background: gradient radial navy `#123f96 → #071f4d`
- Mark utama: 1 bentuk petir kuning `#ffc629` (polygon tunggal), diposisikan di dalam
  safe-zone lingkaran adaptive icon supaya tetap utuh di launcher apa pun
- Lapisan tambahan: siluet atap gudang putih 13% opacity di belakang petir (detail halus,
  baru kelihatan di ukuran besar — di ukuran kecil/24px yang dominan cuma petirnya)
- Alasan pilih: kontras tertinggi dari 3 kandidat, paling gampang dikenali di ukuran ikon
  sebenarnya (~24-48px di kebanyakan launcher Android), warnanya langsung nyambung ke
  sidebar App.jsx tanpa perlu penjelasan tambahan ke user

Belum dibuat sebagai file SVG/PNG produksi — itu masuk item checklist Tahap 1 di atas
("Export ikon ke semua ukuran"), dieksekusi di sesi kerja berikutnya (di luar mode planning).

## 5. Risiko

- **Signing key hilang** = tidak bisa rilis update ke APK/app yang sama lagi (harus buat app baru dari nol). Simpan backup keystore di 2 tempat berbeda begitu dibuat.
- **CDN Leaflet eksternal** — kalau jaringan kantor PLN memblokir `unpkg.com`, peta gudang bisa gagal render di app native. Perlu diselesaikan sebelum rilis (Tahap 3).
- **Bundle JS besar (~2.2MB)** — load pertama di HP dengan koneksi lambat bisa terasa lama; evaluasi code-splitting kalau jadi masalah nyata di HP test.
- **Update ke depan** — setiap perubahan `App.jsx` yang signifikan butuh `npx cap sync` + build APK baru + install ulang di HP (tidak otomatis seperti versi web). Perlu SOP kecil supaya tidak lupa.
- Tahap 1-2 tidak menyentuh logic bisnis App.jsx sama sekali — risiko ke fitur existing minimal.

## 6. Log Progres & Catatan

*(diisi tiap sesi kerja berikutnya)*

- 2026-07-09 — Dokumen dibuat, planning awal disepakati. Belum mulai eksekusi Tahap 1.
- 2026-07-09 — Konsep ikon dipilih: **A — Petir Gudang**. Tahap 1 sisanya (export ukuran ikon,
  splash screen, nama app/package ID) siap dieksekusi di sesi berikutnya.
