# WARNOTO — Design Guidelines

Pedoman desain statis untuk gaya korporat WARNOTO. Dirujuk langsung (baca file ini + baca kode pola yang sudah ada) sebelum/selama mengerjakan UI — **bukan** dengan memanggil skill `ui-ux-pro-max` atau agent screenshot `ui-design-reviewer` untuk task rutin (terlalu boros token, dicabut user 2026-07-25). Screenshot/browser automation hanya dipakai kalau user eksplisit minta verifikasi visual.

Cara pakai: sebelum bikin/ubah elemen UI, cek apakah pola yang dibutuhkan sudah ada di daftar di bawah — reuse class/komponen yang sudah ada, jangan hand-roll style baru yang mirip tapi beda.

## 1. Banner navy korporat — `.kpi-banner`

Class bersama di `src/index.css` (~baris 903), dipakai di Approval/Forecast Stok/Kapasitas Gudang/Maturity. Gradient navy `linear-gradient(120deg,#0b2559 0%,#123d83 58%,#1d4ed8 100%)`, `border-radius:14px`, `min-height:104px`.

**Gotcha penting:** `.kpi-banner` TIDAK punya `padding` di level container sendiri — padding cuma didefinisikan lewat child selector khusus (`.kpi-banner__item`, `.approval-summary-strip.kpi-banner > div`, dll). Kalau sebuah komponen custom (struktur div bebas, bukan pola `__item`) memakai `className="kpi-banner"`, **padding HARUS ditambahkan manual** di inline style instance itu (pola yang sudah benar: `.maturity-hero` di `src/index.css` mempertahankan `padding: 18px 22px` sendiri di atas `.kpi-banner`). Lupakan hal ini = konten mepet ke tepi banner (insiden 2026-07-25, banner "Wilayah Kerja Audit").

## 2. Lebar konten — full-width HANYA kalau isinya grid/reflow, kalau tumpukan 1-kolom kasih max-width wajar

Pola app-wide: `.workspace-page`, `.operations-page`, `.approval-page` (`src/index.css` ~502) → `width:100%; max-width:none; margin:0`. Ini cocok untuk halaman yang isinya GRID kartu auto-fit/banner yang memang didesain reflow mengisi ruang (Alat Berat, ATTB) — di halaman begitu, `maxWidth` custom bikin "kejepit" (insiden 2026-07-25 tahap 1: Maturity kena `maxWidth:960`/`1040` yang terlalu sempit).

TAPI kalau isi halaman berupa tumpukan 1-kolom (judul+deskripsi teks, toggle/switch tab, kartu tunggal) yang TIDAK didesain reflow, full-width mentah di layar lebar (1440px+) bikin teks/toggle meregang tidak proporsional — terasa "mengambang"/kurang grounded (insiden 2026-07-25 tahap 2, setelah `maxWidth` dihapus total). Fix-nya: kasih max-width WAJAR yang lebih lega dari sebelumnya tapi tetap terbatas (mis. `1200px`, `margin:"0 auto"`) — jangan 0 (edge-to-edge) dan jangan terlalu sempit (960 dkk). Pilih berdasar tipe konten, bukan aturan seragam.

## 3. Header halaman — komponen `OperationsHero`

`src/components/OperationsHero.jsx` — dipakai Alat Berat & ATTB. Props: `eyebrow, title, description, scope, metrics[], controls`. Render otomatis navy-gradient (`.operations-hero--summary-only`, proporsi diselaraskan ke `.kpi-banner`). Untuk header halaman BARU yang punya pola serupa (judul + deskripsi + metrik ringkas + kontrol), reuse komponen ini alih-alih hand-roll header baru.

## 4. Tombol aksi — `.approval-btn--*`

Kelas bersama untuk tombol approval/aksi: `--primary` (aksi utama/lanjut), `--cancel` (batal/kembali/netral), `--danger` (hapus), `--approve`/`--reject` (approval eksplisit). Bungkus grup tombol dengan `className="approval-actions"` (sizing/padding/radius/font ikut standar via selector `.approval-actions button`). JANGAN pakai `sty.btn("ghost","sm")` + inline style panjang untuk tombol aksi biasa kalau salah satu varian di atas cocok secara semantik.

Perkecualian yang SAH tidak pakai `.approval-btn--*` (bukan bug): tombol skor (`.score-btn`), toggle checkbox/checklist bulat, chip aksi kecil dalam baris list (mis. "Kelola Evidence"), icon-only delete di dalam chip/overlay compact — semua ini punya kebutuhan visual sendiri yang lebih kecil/beda dari pill `.approval-btn`.

## 5. Mobile — pola `isMobile`

- Grup tombol/tab yang bisa overflow di HP: JANGAN `flex:1` + `whiteSpace:"nowrap"` tanpa `minWidth:0` — teks akan tumpang tindih, bukan wrap. Pilih salah satu: (a) `flexDirection:isMobile?"column":"row"` (tumpuk vertikal penuh-lebar), atau (b) `flex:"1 1 45%", whiteSpace:"normal"` di HP (wrap ke grid 2 kolom, kontainer perlu `flex-wrap:wrap`).
- Tabel data yang AKTIF dipakai isi-form/checklist di lapangan (bukan cuma referensi lihat-lihat): prioritaskan kolom yang benar-benar dipakai (checklist/indikator) terlihat tanpa scroll dulu; kolom penjelasan panjang boleh jadi `<details>` collapsible.
- Tabel referensi biasa: cukup `overflowX:"auto"` + `minWidth` tetap (pola lama, masih sah) — atau `mobile-card-table` (vertical card view) untuk tabel yang sering dikeluhkan user (pola dipakai Forecast Stok/ATTB).
- Target sentuh minimal 44px (sudah di-enforce global via CSS `.app-content` breakpoint mobile, `src/index.css` ~1930).
- Grid kartu KPI/metrik: `gridTemplateColumns:"repeat(auto-fit,minmax(Npx,1fr))"` lebih robust daripada `isMobile?"repeat(2,1fr)":"repeat(5,1fr)"` (auto-fit menghindari 1 kartu nyempil sendirian di baris terakhir, dan otomatis menangani lebar tablet di antara mobile/desktop).

## 6. Tipografi & warna

- Floor 12px di semua teks (CSS + inline style) — kecuali `ScanPublicView`/halaman print (10.5px, disengaja). Jangan tambah teks di bawah 12px.
- Dark mode: pakai token `C.xxx` (dari `src/theme.js`, prop-drilled `C`/`sty`) untuk warna yang perlu berubah antar tema — jangan hardcode hex literal untuk teks/background yang harus kebaca di kedua tema. Banner navy (`.kpi-banner` dkk) & sidebar SUDAH gelap dari awal, sengaja tidak ikut varian dark-mode terpisah (sudah kontras).
- Icon: hindari emoji sebagai icon struktural (navigasi/status/section header) — pakai `@phosphor-icons/react` (sudah terpasang, dipakai `SidebarIcon.jsx` + 3 varian dashboard). Rollout Phosphor BELUM menyeluruh ke semua halaman — jangan asumsikan semua icon di app sudah vector, tapi kalau menambah icon BARU, pakai Phosphor bukan emoji.

## 7. Sebelum lapor "UI sudah selaras/beres"

1. Baca ulang diff sendiri — bandingkan dengan pola di atas dan dengan file sejenis yang sudah pernah "diselaraskan" (contoh baik: `.maturity-hero`, `OperationsHero` di Alat Berat/ATTB).
2. `npm run build` harus lulus.
3. Kalau ragu apakah suatu elemen padding/spacing sudah proporsional, ukur/bandingkan lewat baca CSS (cari nilai padding/margin di komponen sejenis yang sudah established), bukan tebak.
4. Screenshot/browser automation cuma kalau user eksplisit minta atau kasusnya benar-benar butuh verifikasi visual (bukan default workflow).
