# UI_DESIGN_REVIEW_LOG.md

Log temuan review tampilan/UX WARNOTO dari waktu ke waktu (agent `ui-design-reviewer`). Format: tiap review baru ditambah di atas, checklist item ditandai `[x]` kalau sudah diperbaiki (dicek ulang tiap sesi berikutnya, bukan dilaporkan dobel).

---

## Review 2026-07-10 — Fokus form transaksi: TUG-9/TUG-8 (Pengeluaran), TUG-3 (Penerimaan/Karantina), TUG-10 (Pengembalian)

**Metodologi**: analisis statis kode (bukan screenshot — tidak ada browser automation tool/`chromium-cli`/playwright terpasang di environment ini saat review dijalankan). Semua temuan diverifikasi lewat grep + baca langsung ke `App.jsx`, termasuk baca `saveTxn` (App.jsx:5262-5331) untuk tahu field mana yang benar-benar wajib vs cuma terlihat wajib.

**Temuan kunci**: TUG-5 (App.jsx:9135-9273), form sejenis yang letaknya persis sebelum 3 form ini di kode, SUDAH punya 2 pola yang lebih baik dan belum dipakai di TUG-9/8, TUG-10, TUG-3: (1) tanda wajib `*` di label (App.jsx:9153, 9157), (2) baris barang bisa collapse/expand + pagination kalau item banyak (App.jsx:9199-9252). Rekomendasi utama sesi ini: tiru pola yang sudah ada, bukan bikin baru.

### 🟠 Major

- [x] **[DIPERBAIKI 2026-07-10]** Grid 2-3 kolom di form TUG-9/8, TUG-10, TUG-3 semuanya nilai tetap (`gridTemplateColumns:"1fr 1fr"` / `"1fr 1fr 1fr"`), TIDAK ADA cabang `isMobile` sama sekali di 3 form ini (App.jsx:9275-9607, sudah dicek grep — 0 kemunculan `isMobile` di rentang baris tsb). Padahal `sty.input`/`sty.btn` sudah auto-membesar di HP (App.jsx:6329,6341), tapi jumlah kolom yang ditampilkan berdampingan tidak ikut menyesuaikan. Paling parah: App.jsx:9300 (Data Penerima: Nama/Jabatan/Unit) dan App.jsx:9307 (Transportasi: Nopol/Pengemudi/SIM-KTP) di TUG-9/8 — 3 kolom teks bebas di layar 375px berarti ±90-95px per field, mengetik nama jadi scroll-di-dalam-kotak. Juga App.jsx:9577 (TUG-3, Jumlah/Harga/Lokasi Tujuan di dalam kartu item — makin sempit karena nested padding).
  - **Fix**: `gridTemplateColumns:isMobile?"1fr":"1fr 1fr 1fr"` (atau `"1fr 1fr"`) di tiap grid tsb, pola yang sama seperti `sty.input`/`sty.btn`.
  - **Dikerjakan**: semua `gridTemplateColumns` fixed di TUG-9/8, TUG-10, TUG-3 (termasuk grid di dalam kartu item barang) diganti pakai cabang `isMobile`. `npm run build` sukses.

- [x] **[DIPERBAIKI 2026-07-10]** Tidak ada tanda field wajib (`*`) di TUG-9/8, TUG-10 (sebagian), TUG-3 — padahal `saveTxn` (App.jsx:5268-5276, 5289-5290, 5308-5309) mewajibkan banyak field (namaPekerjaan, lokasiPekerjaan, penerimaNama, unitTujuan untuk TUG8, menyerahkanNama, lokasiTujuanId, dariSupplier, tanggalDiterima). User baru tahu field mana yang kurang lewat toast error SETELAH klik submit — bikin siklus gagal-submit-benerin berulang, padahal form ini dipakai admin gudang isi transaksi tiap hari (kecepatan input penting). TUG-5 sebelahnya sudah pakai `*` untuk field yang sama (App.jsx:9153, 9157) dan TUG-10 sudah pakai `*` untuk field foto/ATTB (App.jsx:9485,9493,9495) — jadi TIDAK konsisten bahkan di dalam TUG-10 sendiri (menyerahkanNama App.jsx:9420 dan lokasiTujuanId App.jsx:9425 wajib tapi tidak ditandai).
  - **Fix**: tambah `*` ke label field wajib di App.jsx:9287,9288,9292,9301 (TUG-9/8), 9420,9425 (TUG-10), 9533,9534 (TUG-3). Sekalian hapus teks "(opsional)" ad-hoc (App.jsx:9541,9543) supaya konvensinya konsisten: ada `*` = wajib, tidak ada = opsional.
  - **Dikerjakan**: `*` ditambahkan ke semua field wajib di 3 form (dicocokkan dengan validasi `saveTxn`). Teks "(opsional)" ad-hoc pada label field individual dihapus (Nomor Katalog/Nomor Asset di TUG-10, No. Faktur/No. Amandemen di TUG-3) — konvensi sekarang: `*` = wajib, tanpa tanda = opsional. Section header "(opsional)" (mis. "LAMPIRAN FOTO (opsional)") dibiarkan karena itu label tingkat-section, bukan field.

- [x] **[DIPERBAIKI SEBAGIAN 2026-07-10]** Baris item barang TUG-9/8 (App.jsx:9326-9348) satu baris flex tanpa wrap: SearchableSelect(flex:3) + Qty(flex:1) + tombol 📷 + tombol ✕, semua sejajar. Di 375px, kotak pencarian barang (perlu tampilkan nama+katalog+lokasi) jadi sangat sempit, dan tombol hapus ✕ nempel persis di sebelah tombol kamera — gampang salah pencet, dan salah pencet = baris hilang tanpa konfirmasi.
  - **Fix**: pola collapse/expand milik TUG-5 (App.jsx:9199-9226) bisa langsung dipakai ulang di sini — sudah ada, tinggal disalin ke TUG-9/8.
  - **Dikerjakan**: bukan collapse/expand penuh (lebih besar scope-nya), tapi baris di-stack (`flexDirection:isMobile?"column":"row"`) — SearchableSelect dapat lebar penuh di baris atas, Qty+📷+✕ di baris bawah (tombol hapus jadi 44px, tidak nempel tombol kamera). Menyelesaikan masalah "sempit"-nya tapi belum menambahkan collapse/pagination seperti TUG-5 — kalau daftar barang TUG-9/8 sering >5 baris, pola collapse TUG-5 masih layak disalin di sesi berikutnya.

- [x] **[DIPERBAIKI 2026-07-10]** Tombol "Status Material" TUG-10 (App.jsx:9469-9479, 3 tombol `flex:1` sejajar) — label terpanjang "Bongkaran ATTB (MTU)" di ±90-95px per tombol pada 375px pasti wrap jadi 2-3 baris, terlihat berantakan. Pola sama juga ada di TUG-5 "Jenis Transfer" (App.jsx:9178-9182) — perbaiki dua-duanya sekalian biar konsisten.
  - **Fix**: `flexDirection:isMobile?"column":"row"` untuk grup tombol toggle semacam ini.
  - **Dikerjakan**: diterapkan ke toggle "Status Material" TUG-10. TUG-5 "Jenis Transfer" belum disentuh (di luar cakupan sesi ini — user hanya minta TUG pengeluaran/penerimaan).

- [x] **[DIPERBAIKI 2026-07-10]** `SearchableSelect` (App.jsx:1705-1749, dipakai di SEMUA form TUG termasuk TUG-5) — baris opsi dropdown (App.jsx:1738-1743) `fontSize:12`, `padding:"8px 10px"` tetap, TIDAK ADA cabang `isMobile` (komponen ini tidak menerima/pakai `isMobile` sama sekali). Tinggi baris ±30-34px, di bawah target sentuh 44px yang jadi standar di tempat lain (`sty.btn`/`sty.input`). Karena ini komponen bersama, 1 perbaikan di sini otomatis membenahi 4 form sekaligus (TUG-9/8, TUG-10, TUG-3, TUG-5) — prioritas tinggi karena levernya besar.
  - **Fix**: terima prop `isMobile` (teruskan dari pemanggil, semua sudah punya akses ke `isMobile` di scope komponen induk), lalu `padding:isMobile?"12px 10px":"8px 10px"`, `minHeight:isMobile?44:undefined`.
  - **Dikerjakan**: prop `isMobile` ditambahkan ke komponen + diteruskan di semua 5 titik pemanggilan (TUG-5, TUG-9/8, TUG-10, TUG-3, dan modal Stock Opname App.jsx:12696).

- [x] **[DIPERBAIKI 2026-07-10]** TUG-3 section "DATA PENERIMAAN" (App.jsx:9532-9545) — 11 field dalam 1 grid 2-kolom datar, tanggal/nomor dokumen/nominal bercampur tanpa sub-grouping. Bikin urutan isi terasa acak, bukan alur logis (dokumen pengiriman vs dokumen keuangan).
  - **Fix**: kelompokkan jadi 2 sub-blok visual (mis. jarak lebih besar / label kecil "Dokumen Pengiriman" & "Dokumen Keuangan") di dalam section yang sama, tanpa perlu section header baru.
  - **Dikerjakan**: dipecah jadi 3 grid kecil dalam 1 section: info dasar (Tanggal/Supplier/Dengan) → label kecil "Dokumen Pengiriman" → label kecil "Dokumen Keuangan".

### 🟡 Minor

- [x] **[DIPERBAIKI 2026-07-10]** TUG-3 App.jsx:9536 — ada `<div></div>` kosong di grid 2 kolom (pengisi slot setelah field "Dengan") yang muncul sebagai kotak putih kosong di tampilan — terlihat belum selesai/rusak. Fix: kasih `gridColumn:"1/-1"` ke field "Dengan" (App.jsx:9535) supaya tidak butuh pengisi, atau isi slot itu dengan field lain.
- [x] **[DIPERBAIKI 2026-07-10]** Preview foto ukuran tidak konsisten antar form sejenis: TUG-9 pakai `width:"100%",height:70` (App.jsx:9360,9365,9370), TUG-10 pakai `width:120,height:80` tetap (App.jsx:9487,9497,9509). Tidak masalah secara fungsi, tapi tidak ada alasan jelas kenapa beda — pilih satu konvensi. **Dikerjakan**: TUG-10 diganti jadi `width:isMobile?"100%":120,height:isMobile?140:80` (lebar penuh + lebih tinggi di HP supaya foto lebih mudah dicek sebelum submit), TUG-9/8 juga dapat `height:isMobile?140:70`.
- [ ] Section header "📸 LAMPIRAN FOTO" (App.jsx:9355) di TUG-9/8 pakai ikon, section header lain di form yang sama ("DATA PEKERJAAN" dll, App.jsx:9285,9299,9306,9321) tidak — tidak konsisten, pilih salah satu (semua pakai ikon, atau tidak sama sekali). Belum dikerjakan — kosmetik murni, prioritas rendah.
- [x] **[DIPERBAIKI 2026-07-10]** Foto grid 3-kolom TUG-9/8 (App.jsx:9356, "Foto Kendaraan/SIM-KTP/Surat") tidak collapse di HP — preview ±90px lebar terlalu kecil untuk mengecek foto blur/jelas sebelum submit di lapangan. Fix: `isMobile?"1fr":"1fr 1fr 1fr"`.
- [x] **[DIPERBAIKI 2026-07-10]** Input file mentah (`<input type="file">`, App.jsx:9359,9364,9369 dan serupa di TUG-10/TUG-3) distyle `fontSize:10-11,color:C.muted` — teks abu kecil, sulit dibaca di cahaya terik luar ruangan (gudang/lapangan). Tidak ada afforsansi tombol seperti komponen lain di form ini. Pertimbangkan bungkus jadi label bergaya `sty.btn("ghost","sm")`.
  - **Dikerjakan**: naikkan jadi `fontSize:12,color:C.text` di semua `<input type="file">` TUG-9/8 & TUG-10 (lebih kontras/terbaca). Belum dibungkus jadi tombol custom bergaya `sty.btn` — itu perubahan visual lebih besar, di luar cakupan sesi ini.
- [x] **[DIPERBAIKI SEBAGIAN 2026-07-10]** Tombol hapus baris ✕ (App.jsx:9347 TUG-9/8, 9439 TUG-10, 9554 TUG-3, juga 9206/9225 di TUG-5) tidak ada `title=` dan tidak ada konfirmasi — beda konteks dari ✕ tutup modal (yang sudah diputuskan aman tanpa title di review sebelumnya) karena ini aksi destruktif yang menghapus data yang sudah diketik, bukan cuma menutup dialog. Terutama berisiko di TUG-10/TUG-3 karena kartu item bisa berisi banyak field manual (namaBaru, katalogBaru, dst).
  - **Dikerjakan**: `title=` ditambahkan ke tombol hapus baris di TUG-9/8, TUG-10, TUG-3 (bukan TUG-5 — di luar cakupan sesi ini). Konfirmasi dialog (`confirm()`) belum ditambahkan — dianggap terlalu mengganggu alur input cepat, `title` saja dulu sebagai mitigasi murah.
- [x] **[DIPERBAIKI 2026-07-10]** `PIHAK YANG MENYERAHKAN` di TUG-10 (App.jsx:9417-9421) adalah section header penuh untuk 1 field saja ("Nama") — terasa berat sebelah dibanding section lain. Pertimbangkan gabung dengan section "Lokasi Penyimpanan" jadi 1 section 2-kolom (1-kolom di HP). **Dikerjakan**: digabung jadi 1 section "PIHAK & LOKASI PENYIMPANAN", grid `isMobile?"1fr":"1fr 1fr"`.
- [ ] Section header di ketiga form (`fontSize:12,fontWeight:800,color:C.accent` + garis bawah tipis, mis. App.jsx:9285,9299,9306,9321 / 9409,9417,9432 / 9531,9547,9592) konsisten satu sama lain (bagus, jangan diubah strukturnya) tapi terasa datar — bisa ditambah `background` tint tipis (`#f8fafc`) + padding kecil supaya section lebih "berbunyi" saat scroll form panjang. Prioritas rendah, kerjakan setelah perbaikan struktural di atas. Belum dikerjakan.

### Belum sempat dicek sesi ini (lanjut sesi berikutnya)

- Form TUG-5 dan TUG-7 sendiri belum direview mendalam (cuma dipakai sebagai referensi pola yang sudah baik/kurang baik untuk 3 form di atas) — TUG-5 juga punya beberapa gejala sama (Jenis Transfer toggle 3 kolom tidak collapse, delete button tanpa title) yang perlu diperbaiki sekalian kalau tim mengerjakan perbaikan ini.
- Modal preview dokumen (App.jsx:9609 dst, `docPreview`) belum direview.
- **Screenshot visual asli belum pernah diambil untuk sesi ini** — semua temuan dari baca kode, bukan lihat langsung tampilannya. Kalau nanti browser automation tool tersedia, ulangi review dengan screenshot sungguhan (375×667 dan 1440×900) untuk verifikasi, terutama klaim soal grid 3-kolom yang cramped di HP.

---

## Review 2026-07-08 — Fokus mobile: Data Stok, Stock Opname, TUG, Approval

**Metodologi**: analisis statis kode (bukan screenshot — tidak ada browser automation tool/`chromium-cli`/playwright terpasang di environment ini saat review dijalankan). Semua temuan diverifikasi lewat grep + baca langsung ke `App.jsx`, bukan tebakan.

### 🔴 Critical

- [x] **[DIPERBAIKI 2026-07-08]** Semua modal pakai lebar piksel tetap, tidak ada `maxWidth` sama sekali — `sty.card` (App.jsx:5684, definisi dasar) cuma punya `background/borderRadius/border/padding`, TIDAK ADA `maxWidth`. Ditemukan **28 modal** yang override `width` jadi angka tetap 400–700px (App.jsx baris 7637, 7703, 7772, 7818, 7855, 7876, 7955, 7998, 8038, 8065, 8185, 8241, 8267, 8280, 8300, 8319, 8428, 8453, 8593, 8723, 8851, 9935, 11343, 15594, 15918, 16075, 16104, 16429) — termasuk modal "Kartu Gantung QR" baru (11343, width:420) dan modal Edit Katalog/Ganti Password yang sering dipakai. Di HP lebar umum (360-414px), SEMUA modal ini overflow horizontal — ini kemungkinan besar penyebab utama kesan "berantakan" yang dilaporkan.
  - **Fix**: tambah `maxWidth:"100%"` di tiap modal (atau bikin 1 helper baru `sty.modalCard(width)` yang otomatis kasih `maxWidth:"92vw"` bareng `width`, supaya tidak perlu ubah 28 tempat manual satu-satu).
  - **Dikerjakan**: `maxWidth:"100%"` ditambahkan ke seluruh 28 modal (script regex tertarget `...sty.card,width:N` → `...sty.card,width:N,maxWidth:"100%"`, diverifikasi 28/28 kena, `npm run build` sukses). Belum dites manual di browser/HP.
  - **Dicek ulang 2026-07-10**: dikonfirmasi juga berlaku di 3 modal TUG yang direview sesi ini (App.jsx:9278 width:680, 9402 width:700, 9524 width:700 — semua sudah punya `maxWidth:"100%"`). Tetap `[x]`.

### 🟠 Major

- [x] **[DIPERBAIKI 2026-07-08]** Grid KPI/dashboard 4-5 kolom tetap, tidak collapse di HP — App.jsx:9594, 9781, 9856 (`repeat(4,1fr)`), 10023, 10125 (`repeat(5,1fr)`), 11116 (`repeat(4,1fr)`, widget "Progress Pengisian" opname). Di layar 375px, 4-5 kolom berarti tiap kotak cuma ~60-70px.
  - **Dikerjakan**: diganti `gridTemplateColumns:"repeat(auto-fit,minmax(Npx,1fr))"` di semua 6 lokasi (N disesuaikan per konten: 80-160px) — pendekatan CSS Grid murni, kolom otomatis menyesuaikan lebar layar tanpa perlu prop `isMobile` diteruskan ke tiap komponen (lebih robust dari rencana awal `isMobile?a:b`, karena juga menangani lebar tablet di antara mobile/desktop). `npm run build` sukses.

- [x] **[DIPERBAIKI SEBAGIAN 2026-07-08]** 17 tabel mengandalkan scroll horizontal tanpa alternatif mobile. Tabel item Stock Opname (App.jsx ~11160-an, 11-12 kolom) — kolom **No**, **No Katalog**, **Qty Sistem** sekarang disembunyikan di HP (`{!isMobile && <th/td>...}`), plus lebar maksimal nama barang dikecilkan (200px→120px di HP). Sisa kolom (Nama, Satuan, Qty Fisik, Selisih, Status, Lokasi, Keterangan, Foto) tetap tampil karena itu yang benar-benar dipakai aktif saat opname lapangan. `isMobile` sekarang diteruskan sebagai prop baru ke `StockOpnameTab`.
  - **BELUM dikerjakan** (di luar cakupan sesi ini, butuh effort lebih besar): redesain penuh jadi layout kartu (1 card per item) untuk tabel Stock Opname & Data Stok — masih scroll horizontal untuk kolom yang tersisa, cuma lebih ringkas. 16 tabel lain (termasuk Data Stok) belum disentuh sama sekali.

### 🟡 Minor

- [x] **[DIPERBAIKI SEBAGIAN 2026-07-08]** Tombol ikon-saja tanpa label/tooltip — 8 tombol Edit/Hapus (✏️/🗑️) yang jelas-jelas belum punya `title=` sudah ditambahkan (Edit/Hapus UIT, UPT, ULTG, Gudang, Lokasi, Bersihkan Chat, Hapus Opname, Hapus Rencana Kedatangan). Tombol close "✕" (modal) sengaja TIDAK disentuh — konvensi "X = tutup" sudah cukup universal, dan `title` tetap tidak muncul di HP (tidak ada hover di layar sentuh) jadi dampaknya kecil untuk keluhan mobile spesifik. ~50 kandidat lain dari heuristik grep awal belum diaudit manual satu-satu (banyak kemungkinan false-positive dari pola grep kasar).
  - **Catatan 2026-07-10**: tombol ✕ hapus BARIS ITEM (bukan tutup modal) di form TUG-9/8/10/3/5 termasuk kandidat yang belum diaudit — beda risiko dari ✕ tutup modal karena menghapus data yang sudah diketik. Ditambahkan sebagai temuan baru di review 2026-07-10 di atas.

- [x] **[DICEK 2026-07-08, TIDAK ADA MASALAH]** Overlay/z-index menu mobile — drawer overlay z-index 1400, modal z-index 1000 (modal lebih rendah). Secara teori kalau keduanya kebuka bersamaan, drawer akan menutupi modal — tapi dicek semua item nav yang memicu perpindahan tab/modal sudah memanggil `setMobileMenuOpen(false)` di `onClick`-nya, jadi drawer selalu tertutup duluan sebelum modal manapun terbuka. Tidak ditemukan skenario nyata yang bentrok.

### Belum sempat dicek sesi ini (lanjut sesi berikutnya)

- Kontras warna teks abu-abu (`C.muted`) di berbagai ukuran font kecil — belum dibandingkan visual.
- Konsistensi padding/gap antar komponen sejenis (card, badge) — belum di-audit sistematis.
- ~50 tombol ikon-saja sisanya dari heuristik grep awal — belum diaudit manual satu-satu.
- Layout kartu (card-based) untuk tabel Stock Opname & Data Stok di HP — perbaikan sekarang cuma mengurangi kolom, belum redesain penuh.
- 16 dari 17 tabel `overflowX:"auto"` lainnya (termasuk Data Stok) belum disentuh.
- **Screenshot visual asli belum pernah diambil** — semua temuan & perbaikan di atas dari baca/edit kode, bukan lihat langsung tampilannya. Kalau nanti browser automation tool tersedia, ulangi review dengan screenshot sungguhan untuk verifikasi.
