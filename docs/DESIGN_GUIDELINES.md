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

## 8. Tabel di HP — pola wajib `.mobile-card-table` (Fase 1, 2026-08-15)

Semua `<table>` data **wajib** memakai pola ini. CSS-nya sudah generik di `src/index.css` (~L1723, di dalam `@media (max-width:700px)`) — **jangan tulis CSS baru per tabel**. Class bespoke lama (`.stock-card-table`, `.forecast-card-table`, `.attb-card-table`, `.catalog-card-table`) hanya penghalus opsional (sembunyikan kolom / warna aksen), bukan prasyarat.

Empat langkah, tidak ada yang kelima:

1. **Wrapper** — `<div className="mobile-card-table" style={{...sty.card,padding:0,overflowX:"auto"}}>`. Kalau sudah ada class lain, tambahkan saja: `className="mobile-card-table capacity-data-list"`.
2. **Baris tbody** — tiap `<tr>` di dalam `<tbody>` dapat `className="mobile-card-table__row"`. Termasuk baris kosong (`<td colSpan=...>Belum ada data</td>`).
3. **Tiap `<td>`** — wajib `data-label="<judul kolom persis seperti di thead>"`. Ini yang dipakai CSS untuk mencetak label kartu; `<td>` tanpa `data-label` akan tampil tanpa keterangan.
4. **Kolom judul & foto (opsional)** — `<td>` nama/identitas utama diberi `className="mobile-card-table__title"` (tampil besar tanpa label), `<td>` foto diberi `className="mobile-card-table__photo"`.

`minWidth` pada `<table>` **tidak perlu dihapus** — CSS sudah menetralkannya di HP (`.mobile-card-table table { min-width:0 !important }`). Biarkan agar desktop tidak berubah.

**Rujukan yang benar:** `DataStokTab.jsx` L217 (paling lengkap: foto + judul + sort) dan `ForecastStokPage.jsx` L417.

**Dikecualikan (jangan dikonversi):** tabel layout **cetak** — `KartuGantungModal.jsx`, `BarcodePrintModal.jsx`. Font kecil & lebar tetap di sana disengaja untuk hasil cetak; mengonversinya merusak kartu gantung.

### Daftar dikecualikan (hasil Fase 1, 2026-08-15)

Sembilan `<table>` sengaja **tidak** dikonversi. Jangan "diperbaiki" di sesi berikutnya:

| File | Alasan |
| --- | --- |
| `KartuGantungModal.jsx` (3 tabel) | layout cetak |
| `InspeksiMaterialCadangTab.jsx` L670 | layout cetak Berita Acara |
| `MaturityAuditSystem.jsx` L1388 | sudah responsif lewat `isMobile` (kolom disembunyikan, `minWidth:0`) |
| `StockOpnameTab.jsx` L443 | kolom kondisional `isMobile`/`isSAP`, jumlah kolom berubah-ubah |
| `PermMatrixPage.jsx` L98 | punya CSS mobile bespoke sendiri |
| `KapasitasGudangTab.jsx` L203 | punya CSS mobile bespoke sendiri (`.capacity-data-list`) |
| `TugFinalReviewModal.jsx` (preview) | hanya 2 kolom, muat di 360 px |

Alat ukur: `node scripts/audit-mobile.mjs` — kolom `TABLE_RAW` harus tetap **9**.
Naik di atas 9 berarti ada tabel baru tanpa pola kartu.

Codemod pembantu: `node scripts/cardify.mjs <file> <lineAwal> <lineAkhir> <titleIdx|-1> '["Kol 1",...]'`.

## 9. Breakpoint resmi (Fase 5, 2026-08-15)

Tujuh breakpoint lama (480 / 520 / 700 / 768 / 900 / 980 / min-769) dipangkas jadi **tiga tier**:

| Tier | Query | Untuk |
| --- | --- | --- |
| HP kecil | `@media (max-width: 520px)` | penghalus (sembunyikan identitas akun, rapatkan kartu maturity) |
| HP | `@media (max-width: 768px)` | tier utama mobile — sejajar dengan prop `isMobile` (`innerWidth <= 768`) |
| Tablet | `@media (max-width: 1024px)` | grid dua kolom jatuh jadi satu kolom |
| Desktop | `@media (min-width: 769px)` | pelengkap tier HP |

**Jangan menambah breakpoint baru.** 768 dipilih (bukan 640 seperti rencana awal) supaya CSS
dan `isMobile` tidak berbeda pendapat di rentang 641–768 px — dan 768/1024 kebetulan persis
`md:`/`lg:` milik Tailwind, jadi tetap sejajar kalau nanti prefix Tailwind dipakai.
Tier 520 dipertahankan karena isinya penghalus HP kecil yang merugikan kalau naik ke 768.

## 10. Lantai skor scanner (per 2026-08-15)

`node scripts/audit-mobile.mjs` — angka acuan **118**:

| Metrik | Sisa | Kenapa dibiarkan |
| --- | --- | --- |
| `FONT` | 18 | semuanya layout cetak (`KartuGantungModal`, Berita Acara inspeksi) |
| `NOWRAP` | 38 | badge/chip pendek — memang tidak boleh patah |
| `TABLE_RAW` | 9 | daftar kecuali di bagian 8 |
| `MINMAX` | 7 | sudah dinetralkan CSS (`minmax(260/280/300/320px` dipaksa `1fr` di HP) |
| `GRID` | 3 | blok tanda tangan cetak + tiga kotak KPI yang memang muat |
| `MINW` | 1 | tabel yang dikecualikan |

Naik di atas 118 berarti ada regresi baru. Turun tidak lagi jadi target.

## 11. Skala tipografi

Satu skala untuk seluruh aplikasi, dipakai baik di inline `style` maupun di `src/index.css`:

| px | Peran |
|----|-------|
| 12 | teks bantu, label, badge, isi tabel |
| 13 | teks isi (body) |
| 15 | subjudul, label tombol di HP |
| 17 | judul kartu / seksi |
| 20 | judul halaman (`pageTitleStyle`), angka KPI |
| 24 | judul modal besar |
| 32 | angka display (halaman scan publik, ringkasan besar) |

Aturan:

- **12 px adalah lantai.** Tidak ada teks di bawah 12 px kecuali layout cetak.
- **16 px hanya untuk `input`/`select`/`textarea`** — nilai ini mencegah iOS ikut memperbesar halaman saat field difokus, jadi jangan diturunkan ke 15.
- Ukuran di luar skala dibulatkan ke tetangga terdekat. Codemod: `node scripts/typescale.mjs`.
- Dikecualikan: `KartuGantungModal.jsx`, `BarcodePrintModal.jsx`, dan blok Berita Acara di `InspeksiMaterialCadangTab.jsx` (baris ~640-720).

## 12. Bentuk tombol dan sudut

Sumber kebenaran bentuk tombol ada di `sty.btn()` (`src/theme.js`): sudut 10, `fontWeight` 700,
tinggi minimal 44 px di HP. Tombol berbasis class (`.approval-actions button`,
`.table-action-button`) sudah disamakan ke angka yang sama — kalau salah satu diubah,
ubah ketiganya.

Skala sudut hanya tiga nilai:

| Nilai | Dipakai untuk |
|-------|---------------|
| 10 px | tombol, field, chip, kotak kecil |
| 14 px | kartu, panel, modal |
| 999 px / 50% | pill dan tombol ikon bulat |

Nilai ≤ 4 px (garis tipis, bar progres) dibiarkan. Codemod: `node scripts/radiusscale.mjs`.

## 13. Banner penjelasan (`.info-note`)

Banner yang isinya paragraf **wajib** memakai `className="info-note"` dan `tabIndex={0}`:

```jsx
<div tabIndex={0} className="info-note" style={{ ...sty.card, background: "#eff6ff" }}>
  ℹ️ Penjelasan panjang…
</div>
```

Di desktop banner tampil utuh dengan lebar baca dibatasi 72 karakter. Di layar ≤768 px hanya
dua baris pertama yang tampil; sisanya terbuka saat banner disentuh (elemen fokusabel, tanpa
JavaScript). Tujuannya menjaga halaman HP tetap ringkas — teks panjang tersedia, tapi tidak
menjadi dinding teks.

Yang **bukan** `.info-note`: label, header tabel, grid KPI, dan teks pendek satu baris.
Codemod penanda: `node scripts/infonote.mjs --apply` lalu `node scripts/infonote2.mjs --apply`.

## 14. Palet warna teks

Warna teks memakai token di `src/theme.js`: `C.text` (`#0f172a`), `C.muted` (`#64748b`),
`C.accent` (`#1d4ed8`), `C.green`, `C.yellow`, `C.red`. Varian abu dan biru yang sebelumnya
ditulis manual (`#374151`, `#4b5563`, `#475569`, `#334155`, `#94a3b8`, `#9ca3af`, `#6b7280`,
`#1e40af`, `#1e3a8a`, `#2563eb`, `#0f4c81`) sudah dipetakan ke token tersebut.

Warna yang **menempel pada latar bertint** (teks amber di kotak amber, cyan di kotak cyan,
merah di kotak merah) tetap dibiarkan — itu pasangan kontras, bukan inkonsistensi.
Codemod: `node scripts/colortoken.mjs`.

## 15. Mode ringkas di HP (referensi Apple / SaaS enterprise)

Prinsipnya: di layar ≤768 px yang tampil hanya **judul dan angka**. Kalimat penjelas tidak
dikecilkan — disembunyikan, lalu dibuka atas permintaan. Teksnya tetap ada di desktop, jadi
tidak ada informasi yang hilang.

Tiga mekanisme, semuanya CSS murni tanpa JavaScript:

| Permukaan | Perilaku di HP | Cara membuka |
|---|---|---|
| Banner berparagraf (`.info-note`) | 2 baris pertama | sentuh banner (`:focus`) |
| Kartu tabel (`.mobile-card-table__row`) | 4 sel pertama + sel bertombol | sentuh kartu — modal detail kalau ada, kalau tidak terbuka di tempat |
| Kalimat penjelas di banner/kepala seksi | disembunyikan | hanya tampil di desktop |

Aturan kartu tabel:

- Kolom yang wajib tampil meski urutannya ke-5 atau lebih: beri `className="is-key"`
  (contoh: kolom Status di tabel Material Cadang).
- Sel yang berisi `<button>` atau `<a>` tidak pernah disembunyikan.
- Setiap `<tr className="mobile-card-table__row">` **wajib** punya `tabIndex={0}`; tanpa itu
  kartu tidak bisa dibuka di HP.
- Judul kartu (`.mobile-card-table__title`) dipotong satu baris sampai kartu dibuka —
  ini yang membuat nama material panjang tidak lagi memakan tiga baris.
- Aturan `:focus` yang membuka kartu **harus lebih spesifik** daripada aturan yang
  menyembunyikan sel. Dijaga oleh `node scripts/check-card-collapse.mjs` — jalankan setelah
  menyentuh blok CSS ini.

Kalimat penjelas yang disembunyikan di HP: `<small>` di dalam `.kpi-banner`,
`.forecast-overview__copy`, `.approval-section-title`, `.exec-overview__heading`,
`.forecast-cockpit-col-title`; `<p>` di `.approval-hero` dan `.maturity-hero`; identitas
sekunder dan pertanyaan lengkap di halaman Pak War (`.ai-conversation__identity small`,
`.ai-start__intro > span`, `.ai-start__status`, `.ai-quick-prompts button small`).

**Yang sengaja tidak disembunyikan:** `<small>` yang isinya angka atau tanggal (jumlah hasil
filter, tanggal asesmen) — itu data, bukan penjelasan.

### Jebakan yang sudah pernah menggigit

- **`:has()` tidak boleh bersarang di dalam `:has()`.** Browser membuang *seluruh* aturan
  tanpa peringatan, jadi CSS-nya kelihatan benar tapi mati. Ini pernah membuat penanda
  "Ketuk untuk detail" tidak pernah muncul sama sekali, padahal sel kartu benar-benar
  tersembunyi. Rantai `:not(:has(button))` boleh dipakai di aturan penyembunyi (tidak
  bersarang), tapi **tidak** boleh ikut masuk ke dalam `:has(> …)` di aturan penanda.
  Dijaga oleh `node scripts/check-card-collapse.mjs`.
- **Kartu punya dua mekanisme buka, jangan disamakan.** Baris yang punya `onClick`
  (Data Stok, Material Cadang, Forecast, TUG-15) membuka **modal**; sel tersembunyinya
  memang tidak akan muncul lewat `:focus` — itu benar, bukan bug. Baris tanpa `onClick`
  (Audit Log, Master Katalog, Migrasi Data, Import Lokasi) mengandalkan `:focus` untuk
  terbuka di tempat. Waktu menguji mekanisme `:focus`, pakai tabel jenis kedua.
- **Tabel yang punya layout kartu bespoke tidak ikut aturan generik.** `.stock-card-table`
  (`src/styles/stock.css`) dan `.forecast-card-table` menyembunyikan sel tertentu secara
  permanen dengan `!important` dan menggantinya dengan ringkasan sendiri.
- **Jangan tandai `.info-note` pada elemen yang bisa diklik atau yang sudah ada di dalam
  `<details>`.** Yang pertama membuat opsi dropdown ikut terpotong dan menambah tab stop
  liar; yang kedua membuat teks tetap terpotong walau `<details>`-nya sudah dibuka.

### Cara memverifikasi tanpa buka HP

`npx playwright test tests/e2e/mobile-minimal.spec.js --project=phone-360` membuktikan ketiga
mekanisme di atas benar-benar hidup di viewport 360px. Screenshot mentah tiap menu ada di
`test-results/<slug>-actual.png` setelah menjalankan `responsive.spec.js`.
