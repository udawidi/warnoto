# Instruksi Kerja: Penguatan Sistem WARNOTO

**Dibuat:** 2026-09-16 · **Penyusun:** Claude (Vendor A, arsitek) · **Pelaksana:** Codex (Vendor B)
**Status:** belum dikerjakan

Dokumen ini swasembada. Semua angka di sini adalah hasil audit langsung terhadap kode pada
2026-09-16 — **jangan mengaudit ulang**, langsung kerjakan. Kalau ada angka yang ternyata tidak
cocok dengan kondisi kode saat kamu membacanya, berarti sudah ada perubahan sejak dokumen ini
dibuat: hentikan, laporkan selisihnya ke user, jangan menebak.

Tujuan: memperkuat fundamental, keamanan, dan struktur WARNOTO memakai standar industri yang
gratis dan bisa diterapkan langsung. Tidak ada fitur baru. Tidak ada rewrite.

---

## 0. Baca ini sebelum menyentuh apa pun

### 0.1 Yang SUDAH aman — jangan diutak-atik

Postur keamanan WARNOTO sudah di atas rata-rata aplikasi internal. Daftar berikut sudah
terverifikasi benar pada 2026-09-16. Kalau kamu tergoda "memperbaiki" salah satunya, berhenti —
kemungkinan besar kamu akan melemahkannya.

| Sudah ada | Bukti | Jangan |
|---|---|---|
| CSP Level 3, HSTS, `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, `frame-ancestors 'none'`, `object-src 'none'` | `vercel.json` | Jangan melonggarkan CSP untuk memperbaiki sesuatu. Ada preseden: tombol Print mati di produksi karena popup mewarisi CSP; solusinya `unsafe-hashes` + hash sha256 spesifik, bukan `unsafe-inline` |
| SRI untuk Leaflet dari unpkg | `index.html:13-14`, `integrity` + `crossorigin` | Jangan hapus atribut `integrity` saat menaikkan versi Leaflet — hitung ulang hash-nya |
| Allowlist host Supabase | `src/supabaseClient.js` | Jangan ganti daftar literal jadi `endsWith`/regex/wildcard. Alasannya tertulis di komentar kode: `endsWith` akan meloloskan `evilwarnoto.com` |
| Otorisasi di lapisan data (RLS Postgres) | migrasi `supabase/migrations/` | Jangan memindahkan pengecekan izin ke sisi aplikasi. RLS lebih kuat |
| Nol `dangerouslySetInnerHTML`; ada `docBuildersXss.test.mjs` | `src/`, `tests/unit/` | Jangan memperkenalkan yang pertama |
| 43 unit test, banyak `*.contract.test.mjs` | `tests/unit/` | Jangan menghapus atau melemahkan test untuk membuat CI hijau |
| Sentry + ErrorBoundary | `src/main.jsx` | — |
| Snapshot tag harian untuk rollback | `.github/workflows/daily-snapshot.yml` | — |
| Conventional Commits + SemVer | riwayat git, `package.json` | Ikuti: `feat:`, `fix:`, `docs:`, `chore:` |

### 0.2 Gap nyata yang dikerjakan dokumen ini

Semua perlindungan di atas saat ini dijaga oleh kedisiplinan manusia. **Tidak ada satu pun mesin
yang memeriksanya.** Itulah gap utamanya — bukan kurangnya perlindungan.

| Gap | Bukti | Standar |
|---|---|---|
| CI hanya menjalankan `npm run build` | `.github/workflows/ci.yml` — 43 test tak pernah jalan otomatis | NIST SSDF PW.7/PW.8 |
| Tidak ada linter sama sekali | tidak ada `eslint.config.js`/`tsconfig.json`/`jsconfig.json` | CWE Top 25 |
| 2 kerentanan high aktif | `image-size` via `pptxgenjs` | OWASP A06:2021 |
| Dependensi tidak dipantau | tidak ada `dependabot.yml`, `npm audit` tidak di CI | OWASP A06:2021 |
| Batas arsitektur tidak ditegakkan | 11 file `src/components/` memanggil `supabase.from(` langsung | OWASP ASVS V1 |
| Keputusan menumpuk di satu file | `HANDOFF.md` 174 KB | ADR (Nygard) |
| Aksesibilitas tidak terukur | tidak ada `eslint-plugin-jsx-a11y` | WCAG 2.2 AA |
| 82 pemakaian `localStorage` mentah | tersebar, tanpa wrapper, bisa melempar exception | OWASP ASVS V8 |

### 0.3 Prinsip yang mengikat pelaksanaan

1. **Gelombang 1 tidak mengubah perilaku aplikasi sama sekali.** Yang ditambah hanya gerbang
   pemeriksa. Kalau sebuah langkah di Gelombang 1 menuntut perubahan kode aplikasi, kamu salah
   jalan — berhenti dan laporkan.
2. **Aturan lint baru selalu mulai dari `warn`, bukan `error`.** Aturan yang langsung memerahkan
   42 ribu baris akan dimatikan orang dalam seminggu. Naikkan ke `error` hanya setelah
   pelanggarannya nol.
3. **Kerjakan berurutan.** Gelombang 1 dulu, utuh, sebelum menyentuh Gelombang 2.
4. **Review-first.** User memverifikasi sebelum commit/push. Jangan commit tanpa diminta.

### 0.4 Protokol kerja

- Dev lokal: `npm run dev`, port **3001**. Build: `npm run build`.
- **Alur rilis (staging di-PARKED sejak 2026-09-04, branch `staging` sudah dihapus):**
  edit → commit → verifikasi `npm run dev` di localhost (backend production) → localhost OK →
  push `main` (deploy Vercel otomatis). **Jangan** `vercel --prod` — folder `outputs/` yang berat
  akan ikut terunggah.
- Ada hook `pre-commit` di `utils/hooks/pre-commit` yang auto-menaikkan versi patch tiap commit.
  Jangan dirusak atau di-bypass.
- **Commit per file** (`git add <file>` spesifik, **jangan** `git add -A`). Ada preseden: beberapa
  sesi agen berjalan bersamaan di folder yang sama dan `git add -A` menyapu perubahan uncommitted
  sesi lain sampai ada catatan yang hilang.
- Setelah mengedit kode, jalankan `graphify update .` supaya knowledge graph tetap sinkron.
- Perbarui `HANDOFF.md` (Status + satu baris Log handoff) setiap menyelesaikan satu gelombang —
  jangan menunggu akhir sesi, kuota bisa habis mendadak.
- Perubahan skema database = ajukan proposal dulu, eksekusi hanya setelah user mengonfirmasi.

---

## Gelombang 1 — Gerbang otomatis

**Perkiraan: ~2 jam. Risiko: sangat rendah (nol perubahan perilaku aplikasi).**
**Ini bagian dengan nilai terbesar. Kalau pekerjaan berhenti di sini pun, sebagian besar tujuan
sudah tercapai.**

### 1.1 Tangani kerentanan yang aktif sekarang

Jalankan:

```bash
npm audit --omit=dev
```

Hasil per 2026-09-16: **2 high severity** — `image-size` (infinite loop saat parsing ICNS/JXL/HEIF,
berujung denial of service) yang masuk lewat `pptxgenjs`.

**Analisis paparan (sudah dilakukan, jangan diulang):** `pptxgenjs` dipakai **hanya** di
`src/hooks/useMaturity.jsx` untuk ekspor slide. Berjalan di browser, memproses gambar milik
aplikasi sendiri — bukan gambar yang dikirim penyerang. Dampak nyatanya mendekati nol.

> ### DILARANG: `npm audit fix --force`
>
> npm akan mengusulkan `pptxgenjs@1.1.5`. Versi yang dipakai sekarang adalah `^4.0.1` — usulan itu
> **penurunan versi mayor** dan akan merusak ekspor maturity. Jangan jalankan, jangan "coba dulu".

**Tindakan:**
1. Jangan ubah `package.json`.
2. Catat sebagai risiko yang diterima — jadi ADR `0005` di Gelombang 2.2.
3. Yang penting bukan menambalnya, melainkan **mulai memantau** (1.3 dan 1.4), supaya kerentanan
   berikutnya — yang mungkin sungguh berbahaya — tidak lolos diam-diam.

**Selesai bila:** `package.json` tidak berubah, dan alasan penerimaan risiko tercatat.

### 1.2 Pasang ESLint

**Tambah devDependency:**

```bash
npm i -D eslint @eslint/js eslint-plugin-react-hooks eslint-plugin-jsx-a11y globals
```

**Buat `eslint.config.js`** — flat config ESLint 9 (bukan `.eslintrc`, format itu sudah usang).

Rule dan levelnya persis seperti tabel ini. Jangan menambah rule lain di luar ini; setiap rule
tambahan adalah kebisingan yang membuat orang berhenti membaca keluaran linter.

| Rule | Level | Alasan |
|---|---|---|
| `no-undef` | **error** | Menangkap kelas bug yang sudah pernah menggigit project ini: build Vite hijau tetapi `ReferenceError` muncul di browser. Ini rule terpenting di sini |
| `react-hooks/rules-of-hooks` | **error** | `App.jsx` punya 122 `useState`. Hook yang terpanggil kondisional = bug senyap yang sangat sulit dilacak |
| `react-hooks/exhaustive-deps` | warn | Menemukan data basi, tetapi terlalu banyak positif palsu untuk dijadikan error. **Jangan diberesi massal** |
| `no-unused-vars` | warn | Kode warisan 42 ribu baris. Kalau dijadikan error, CI merah permanen |
| `jsx-a11y` (recommended) | warn | WCAG 2.2 AA, gratis dan otomatis. Aplikasi ini dipakai di gudang sambil berdiri — kontras dan target sentuh bukan formalitas |

**Wajib masuk `ignores`:** `node_modules`, `dist`, `outputs`, `graphify-out`, `playwright-report`,
`test-results`, `migration-tools`, `scripts/oneoff`.

**Tambah script** di `package.json`:

```json
"lint": "eslint ."
```

**Gerbang — jangan lewati:**

```bash
npm run lint
```

Catat jumlah `error` dan `warning`. **Semua `error` harus NOL sebelum melanjutkan ke 1.3.**
Kalau `no-undef` menemukan sesuatu, itu bug produksi yang sedang menunggu giliran — perbaiki, dan
laporkan temuannya ke user secara eksplisit karena itu bug nyata, bukan sekadar kerapian.

Jumlah `warning` boleh berapa pun. Jangan memberesi warning di langkah ini.

### 1.3 Jadikan CI benar-benar menguji

**File:** `.github/workflows/ci.yml`

Saat ini job `build` hanya menjalankan `npm ci` lalu `npm run build`. Akibatnya 43 unit test yang
sudah ditulis tidak pernah dieksekusi otomatis — ada, tetapi tidak menjaga apa pun.

Ubah menjadi rantai berurutan pada job yang sama:

```
npm ci  →  npm run lint  →  npm test  →  npm audit --omit=dev --audit-level=high  →  npm run build
```

`npm test` sudah terdefinisi dan menjalankan 43 unit test di `tests/unit/`. Ini perubahan sekitar
5 baris YAML dengan nilai tertinggi di seluruh dokumen ini.

**Step audit:** karena 1.1 sengaja tidak menambal, step ini akan gagal. Beri
`continue-on-error: true` sehingga hasilnya tetap tampil di log tanpa memblokir merge.

> Jangan menurunkan `--audit-level` ke `critical` untuk membuatnya hijau. Itu menyembunyikan
> masalah, bukan menyelesaikannya.

**Job terpisah (paralel):** `npm run test:csp`. Jangan menaruhnya di rantai utama — perintah itu
melakukan build lalu menyajikan `dist`, jauh lebih lambat, dan akan menyumbat umpan balik PR.

**Catatan:** workflow saat ini memicu pada `push` dan `pull_request` ke `staging` dan `main`.
Branch `staging` sudah dihapus, jadi praktis hanya `main` yang aktif. Biarkan keduanya terdaftar
(tidak berbahaya, dan berguna kalau staging dihidupkan lagi).

**Selesai bila:** push ke `main` memperlihatkan keempat step di tab Actions, dan log `npm test`
benar-benar menampilkan eksekusi 43 test — bukan lolos diam-diam karena pola glob tidak cocok.
Perhatikan: script `test` di `package.json` memakai tanda kutip pada pola glob-nya, dan runner CI
memakai shell Linux yang berbeda dari Windows tempat dokumen ini disusun.

### 1.4 Aktifkan Dependabot

Gratis untuk semua repo GitHub. **Buat `.github/dependabot.yml`:**

- Ekosistem `npm` dan `github-actions` (action yang tidak dipin juga permukaan serangan)
- Jadwal `weekly`
- `open-pull-requests-limit: 5`
- **`groups` untuk menggabungkan dev-dependencies jadi satu PR** — tanpa ini akan banjir PR,
  lalu diabaikan, lalu percuma

### 1.5 Pemindaian secret

**Prasyarat — periksa dulu:** ada `.env`, `.env.local`, dan `.env.staging` di direktori kerja.
Konfirmasi ketiganya tercakup `.gitignore` dan tidak pernah ter-commit:

```bash
git log --all --oneline -- .env .env.local .env.staging
```

Kalau riwayatnya tidak kosong, **berhenti dan laporkan ke user** — itu artinya ada rahasia di
riwayat git, dan penanganannya (rotasi kredensial, pembersihan riwayat) adalah keputusan user.

**Pemindaian berkelanjutan:** GitHub Secret Scanning gratis hanya untuk repo publik. Untuk repo
privat, pakai `gitleaks-action` (gratis, open source) sebagai job di CI.

---

## Gelombang 2 — Batas arsitektur ditegakkan mesin

**Dicicil, menempel pada pekerjaan normal. Bukan proyek tersendiri.**

Standar acuan: **OWASP ASVS V1 (Architecture)** dan **Dependency Rule** — dependensi hanya
menunjuk ke dalam:

```
components/*.jsx   →   hooks/use*.js   →   lib/*Sync.js   →   supabaseClient
```

### 2.1 Larang query database dari komponen

Tambahkan blok `files: ["src/components/**"]` di `eslint.config.js` dengan `no-restricted-syntax`
yang mencegat pemanggilan `supabase.from(`:

```
CallExpression[callee.property.name="from"][callee.object.name="supabase"]
```

Pesan: *"Pindahkan query ke `src/lib/*Sync.js` atau `src/hooks/`."*

> **Level `warn`, BUKAN `error`.** Ada 11 file yang melanggar hari ini.

**Daftar pelanggar** (untuk pelacakan, **bukan** untuk dikerjakan sekaligus):

`AIFaqPanel`, `AuditLogPage`, `EquipmentLiveShare`, `ForecastStokPage`, `MigrasiDataTab`,
`NotifRecipientPanel`, `OperatorProfile`, `PermMatrixPage`, `RiwayatPerjalananPanel`,
`StockOpnameTab`, `TelegramWhitelistPanel` — semuanya di `src/components/`.

**Aturan migrasi:** pindahkan query sebuah file **hanya saat file itu memang sedang disentuh untuk
keperluan lain**. Jangan membuka 11 file sekaligus — perubahan sebanyak itu tanpa verifikasi
visual di browser adalah cara yang efisien untuk merusak sebelas fitur sekaligus.

Pola tujuan sudah mapan dan tinggal ditiru: `src/lib/supabaseSync.js`, `src/lib/masterSync.js`,
`src/lib/maturitySync.js`.

Naikkan rule ke `error` setelah pelanggarnya nol.

### 2.2 Architecture Decision Records

**Buat direktori `docs/adr/`.**

`HANDOFF.md` sudah 174 KB dan memikul beban ini sendirian. Keputusan yang terkubur di file sebesar
itu praktis tidak terbaca — dan keputusan yang tidak terbaca akan terlanggar.

Format Nygard, sekitar 20 baris per file: **Konteks / Keputusan / Konsekuensi**. Penomoran
`0001-judul-singkat.md`.

Lima ADR pertama, semuanya keputusan yang **sudah diambil** dan mahal kalau terlanggar:

| No | Judul | Sumber isi |
|---|---|---|
| 0001 | Supabase self-host + allowlist host literal | Komentar di `src/supabaseClient.js` — pindahkan penalarannya ke ADR |
| 0002 | Otorisasi di RLS, bukan di lapisan aplikasi | `supabase/migrations/` |
| 0003 | Cetak dokumen lewat engine print browser, bukan jsPDF raster | Commit `e750090`; jsPDF `.html()` menghasilkan keluaran berantakan |
| 0004 | `wa_sync_status` dipertahankan meski fitur WhatsApp dihapus | Masih dipakai bot Telegram — jangan di-drop |
| 0005 | Risiko `pptxgenjs`/`image-size` diterima | Hasil analisis di 1.1 |

Manfaat langsung: sesi atau vendor berikutnya membaca 20 baris, bukan menggeledah 174 KB.

### 2.3 Wrapper `localStorage`

82 pemakaian mentah berarti 82 titik yang bisa melempar exception (mode privat browser, kuota
penuh) dan 82 nama key tanpa konvensi.

**Buat `src/lib/storage.js`** — sekitar 15 baris `load`/`save`/`drop` berpembungkus `try/catch`.
Fungsi biasa, **bukan kelas**, bukan hook, bukan context.

> ### PERINGATAN KEHILANGAN DATA — baca sebelum menyentuh
>
> Menambahkan prefix akan **mengubah nama key**, sehingga data lama pengguna tidak terbaca lagi.
>
> - Untuk preferensi UI (state tab, urutan kolom): tidak masalah, hilang pun tidak apa-apa.
> - Untuk **draft form yang belum tersimpan ke database**: itu kehilangan data nyata milik
>   pengguna.
>
> **Inventarisasi dan klasifikasikan seluruh 82 pemakaian terlebih dahulu.** Key yang menyimpan
> sesuatu yang berharga dibiarkan tanpa prefix, atau dibaca dengan fallback ke nama lama.

**Jangan tabrak pola yang sudah ada:** `src/lib/supabaseSync.js` punya `endpointScopedStorageKey()`
yang mengikat key ke hostname backend. Itu ada alasannya — marker sinkronisasi dari Supabase Cloud
lama tidak boleh menekan proses pengecekan ulang ke backend self-host. Wrapper baru harus
kompatibel dengannya, bukan menggantikannya.

Pasang `no-restricted-properties` untuk `localStorage.getItem`/`setItem` **setelah** migrasi
selesai, bukan sebelum.

### 2.4 Rapikan `scripts/`

Sekitar 45 file `.mjs` bercampur: migrasi sekali-pakai yang sudah dijalankan berdampingan dengan
skrip pemeriksa yang masih hidup. Akibatnya tidak ada yang tahu mana yang aman dijalankan.

Murni pemindahan file, **nol perubahan logic**:

- `scripts/checks/` — `check-*.mjs` yang masih relevan (kandidat untuk ikut CI)
- `scripts/oneoff/` — migrasi sekali-pakai yang sudah selesai: `migrate_*`, `fill_*`, `enrich_*`,
  `apply_*`. Disimpan sebagai jejak sejarah, bukan sebagai kode hidup
- Sisanya (generator template, skrip audit) tetap di root `scripts/`

**Sebelum memindahkan:** cari rujukan path lama di `package.json`, `.github/workflows/*.yml`, dan
dokumen di `docs/`. Skrip yang dipanggil CI dan pathnya berubah akan membuat workflow gagal.

---

## Gelombang 3 — Kepatuhan dan ketahanan

### 3.1 UU PDP No. 27/2022 — retensi data pribadi

> ### BLOKIR: butuh keputusan user. Codex dilarang memutuskan sendiri.

Yang mengikat WARNOTO secara hukum di Indonesia adalah **UU Perlindungan Data Pribadi No. 27/2022**,
bukan GDPR. Aplikasi ini menyimpan foto KTP dan SIM di bucket privat `tug-docs-private` (lihat
`TXN_PHOTO_SLOTS` di `src/lib/supabaseSync.js`, field `fotoSimKtp`).

Dua pertanyaan yang jawabannya adalah kebijakan, bukan kode:

1. Berapa lama foto identitas disimpan setelah transaksi selesai?
2. Siapa yang boleh mengaksesnya, dan apakah setiap akses tercatat di audit log?

**Tugas Codex:** ajukan kedua pertanyaan ini ke user, jangan mengarang jawabannya. Setelah user
memutuskan, implementasinya kecil (job pembersih terjadwal + pastikan akses lewat signed URL
tercatat), dan keputusannya ditulis sebagai ADR.

### 3.2 Tutup celah di guard env

**File:** `src/supabaseClient.js`, sekitar baris 27.

```js
if (!E2E_MODE && SUPABASE_URL) {
```

Kalau `SUPABASE_URL` bernilai kosong atau `undefined`, **seluruh guard allowlist dilewati diam-diam**
— tidak ada error, tidak ada peringatan. Ada preseden nyata di project ini: `vercel env pull`
pernah mengisi sebuah variabel `VITE_*` dengan string kosong, dan kegagalannya samar serta makan
waktu lama untuk dilacak.

**Perbaikan (~3 baris):** di luar mode E2E, `SUPABASE_URL` atau `SUPABASE_PUBLISHABLE_KEY` yang
kosong harus melempar error yang **menyebut nama variabelnya**. Gagal keras di detik pertama jauh
lebih murah daripada gagal samar di menit kelima.

Hati-hati: jangan merusak jalur E2E. Guard `E2E_MODE` yang ada sekarang sengaja membuat harness
test secara fisik tidak mampu membentuk client produksi meski developer punya `.env.local` berisi
kredensial asli. Pertahankan sifat itu.

### 3.3 Cek kebocoran secret ke bundle

**Buat `scripts/checks/check-bundle-secrets.mjs`:** pindai `dist/` untuk `service_role`,
`SERVICE_ROLE`, dan pola JWT yang bukan anon key. Exit code 1 kalau ada yang cocok.

Pasang sebagai step setelah build di CI.

Catatan: semua variabel `VITE_*` memang publik dan wajar ada di bundle — itu bukan yang dicari.
Yang dijaga adalah key server yang seharusnya tidak pernah sampai ke sisi klien.

### 3.4 Jadikan disiplin contract test sebagai aturan tertulis

Pola `*.contract.test.mjs` sudah berjalan dan bagus. Tuliskan di `CLAUDE.md`:

> Setiap perubahan yang menyentuh RLS, skema tabel, atau scope per-UPT **wajib** menambah atau
> memperbarui satu contract test.

Ini menutup kelas kegagalan yang **sudah dua kali terjadi** di project ini: policy write RLS tidak
ikut termigrasi saat pindah dari Supabase Cloud ke self-host (berujung 403 senyap), dan tabel baru
tanpa `GRANT ... TO service_role` (berujung Edge Function mengembalikan hasil kosong tanpa error).

### 3.5 Baseline Core Web Vitals

Lighthouse sudah tersedia di Chrome, gratis. Jalankan sekali terhadap `dist` yang disajikan
(bukan lewat Vite dev), catat LCP / INP / CLS sebagai baseline di `docs/`.

Tanpa angka awal, "terasa lambat" tidak bisa dibedakan dari "memang lambat".

**Konteks penting:** floor latensi sekitar 1,5 detik per request lewat tunnel self-host sudah
diketahui dan **bukan bug kode**. Jangan mengejar angka yang ditentukan jaringan.

---

## Yang sengaja TIDAK dikerjakan

Kalau kamu merasa salah satu di bawah ini "sebaiknya sekalian dikerjakan" — jangan. Masing-masing
sudah dipertimbangkan dan ditolak dengan alasan.

| Ditolak | Alasan |
|---|---|
| Migrasi TypeScript | 42 ribu baris, berbulan-bulan kerja. Rule `no-undef` dari ESLint sudah menangkap kelas bug yang benar-benar pernah menggigit project ini, dengan biaya dua jam |
| State manager (Redux/Zustand) | 122 `useState` itu masalah organisasi file, bukan masalah teknologi state. Library baru menambah satu konsep tanpa menghapus satu baris pun |
| Repository/service layer baru | `src/lib/*Sync.js` **sudah** merupakan lapisan itu. Yang kurang penegakannya — itulah 2.1 |
| Prettier + husky/pre-commit | Formatting tidak pernah menyebabkan bug di sini, dan hook yang lambat akan di-`--no-verify` dalam seminggu. CI sudah cukup |
| Refactor besar `App.jsx` | **Keputusan user, dihormati.** `App.jsx` tersisa ~5.100 baris berisi state dan handler; user sudah memutuskan berhenti di titik ini karena risikonya tinggi tanpa verifikasi visual browser. Penyusutan boleh terjadi secara oportunistik: saat sebuah domain memang sedang disentuh, pindahkan state dan handler-nya ke `src/hooks/use<Domain>.js` mengikuti pola `useTugTransactions.js`. Jangan membuka domain yang tidak sedang dikerjakan |
| SLSA level tinggi, SOC 2, ISO 27001, OpenTelemetry penuh | Tidak sepadan dengan skala dan model ancaman aplikasi internal ini |
| Abstraksi logger untuk ~80 `console.*` | Tidak ada bug yang disebabkannya, dan Sentry sudah menangkap error sungguhan. Yang perlu dicek sekali saja: tidak ada `console.log` yang mencetak token atau data pribadi |

---

## Verifikasi

### Setelah Gelombang 1

```bash
npm run lint      # error harus NOL; warning boleh ada berapa pun
npm test          # 43 unit test harus hijau
npm run build     # harus tetap hijau
```

Lalu buka `http://localhost:3001` dan periksa beberapa tab utama tidak blank.

> **Lint hijau bukan jaminan runtime aman di project ini.** Ada preseden: build Vite hijau tetapi
> aplikasi melempar `ReferenceError` di browser. Verifikasi visual tetap wajib.

Verifikasi CI: setelah push ke `main`, pastikan keempat step muncul di tab Actions dan log
`npm test` benar-benar menampilkan eksekusi 43 test.

### Setelah 2.3 (`storage.js`)

Login, ganti tab, muat ulang halaman — preferensi UI harus tetap. Buka DevTools → Application →
Local Storage dan pastikan key lama tidak hilang untuk data yang belum tersimpan ke database.

### Setelah 3.3

```bash
npm run build && node scripts/checks/check-bundle-secrets.mjs   # harus exit 0
```

### Penutup

```bash
npm run test:csp
```

Perintah ini melakukan build lalu menyajikan `dist`. **Jangan menguji CSP lewat Vite dev server** —
dev server tidak mengirim header CSP, sehingga hasilnya false negative.

Terakhir: verifikasi di localhost dulu, tunggu persetujuan user, baru push `main`.

---

## Ringkasan eksekusi

| Gelombang | Isi | Waktu | Risiko |
|---|---|---|---|
| **1** | Lint + CI + Dependabot + audit + pemindaian secret | ~2 jam | Sangat rendah — tidak mengubah perilaku aplikasi |
| **2** | Batas arsitektur + ADR + wrapper storage + rapikan scripts | bertahap | Rendah, kecuali 2.3 yang butuh inventarisasi key lebih dulu |
| **3** | UU PDP + guard env + cek bundle + contract test + baseline | bertahap | Rendah; 3.1 terblokir menunggu keputusan user |

Gelombang 1 berdiri sendiri dan memberi porsi nilai terbesar. Gelombang 2 dan 3 dirancang untuk
dicicil menempel pada pekerjaan normal.
