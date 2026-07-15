# HANDOFF — WARNOTO

**Vendor aktif terakhir:** Claude | **Update:** 2026-07-15 18:11

## Tujuan / benang merah
WARNOTO adalah aplikasi gudang PLN (React, Vite 4, Supabase). Fokus: penyempurnaan UI bertahap dan migrasi Non-SAP UPT Surabaya secara review-first, bukan redesign besar.

## Keputusan arsitektur
- `App.jsx` masih besar; split internal ditunda sampai user menyetujui.
- Supabase `tadxodrzoquugnsyejld`; perubahan skema harus diusulkan dulu. Jangan drop `wa_sync_status`.
- Tailwind v4 via PostCSS, preflight off. Deploy hanya `git push main`.
- Sidebar: desktop 260/76px, drawer mobile <=768px; toggle di footer sidebar (lebar = « pojok kanan bawah, compact = »» tengah).
- Alur bisnis review-first; jangan membuat aksi turunan atau auto-approve tanpa persetujuan.
- Pak War: Groq (`llama-3.3-70b-versatile`), key selalu di-`.trim()` (pernah 401 gara-gara spasi bawaan `vercel env pull`); fallback data lokal saat AI eksternal gagal. Gaya jawaban humanis-korporat, jawab yang ditanya saja, list = `- **Nama** [kode] — stok X unit · Lokasi: Y`, dirender kartu `.ai-richlist`.
- Tipografi: floor 12px di semua CSS + inline style (kecuali ScanPublicView 10.5px, halaman print). JANGAN menambah teks <12px.
- Banner KPI seragam via kelas bersama `.kpi-banner` di `src/index.css` (proporsi compact seperti `.dashboard-maturity`: min-height 104px, radius 14px, angka 22px/800, gradient navy). Dipakai: Approval, Kapasitas Gudang, Forecast Stok, TUG; OperationsHero (Alat Berat + ATTB) diselaraskan proporsinya di `src/styles/operations.css`.
- Foto satpam & foto alat berat: data URL terkompres (satpam max 400px/±120KB via `compressImage` dari `src/lib/supabaseSync.js`) disimpan inline di jsonb master — TANPA perubahan skema.

## Status sekarang
- **Selesai & dipublikasikan ke `main`:** commit terdahulu `efb9fca` (Pak War humanis + fix 401 Groq), `6a09f83` (floor font 12px + toggle sidebar footer), serta satu commit fungsional shift Codex ini yang mencakup:
  1. Foto satpam (modal add/edit + avatar 44px di daftar Master Data → Satpam; helper `handleSatpamFoto` di App.jsx ~2456).
  2. Alat Berat: mode switch "Daftar Alat"|"Peminjaman & Histori" (+badge pending), dualisme filter dihapus (chip kondisi → dropdown di baris kategori).
  3. Banner KPI navy di 6 permukaan sudah memakai tipografi compact (angka 22px/800, label 12px lebih ringan, separator halus) + floor 12px `operations.css`.
  4. Kapasitas Gudang: blok asli `Warehouse capacity / Data Kapasitas Gudang / Laporan...` menjadi header banner navy; tujuh KPI ditumpuk pada baris di bawahnya. Banner berada sebelum switch dan tetap tampil di Ringkasan/Data/Peta, responsif desktop/tablet/mobile.
  5. Forecast Stok: banner dipindah sebelum switch dan tetap tampil di Forecast/Material Cadang; font seluruh subtree diselaraskan ke Data Stok (`Inter`, system-ui), termasuk kontrol dan tabel.
  6. TUG: command bar putih menjadi banner navy sebelum switch proses/status; KPI memakai total/status dokumen jenis aktif, sedangkan TUG-15 context-only. Switch berupa kartu klik yang eksplisit (`Sedang dibuka`/`Klik untuk buka`); CTA berada di action bar setelah switch dengan guard role tetap.
  `npm run build` LULUS atas seluruh perubahan.
- **Selesai & di-commit (shift Claude 2026-07-15 sore):** paket TUG-10 + pagination Forecast — (a) cascade lokasi Gudang→Sub Gudang→Blok di form TUG-10 (kontrak txn tetap `lokasiTujuanId`, plus `gudangTujuanId`/`subGudangTujuanId`/`satpamId`; legacy blok via sentinel `__legacy__`), (b) satpam punya `gudangId` di jsonb (tanpa ubah skema), Master Data satpam dikelompokkan per gudang, select satpam TUG-10 terfilter gudang (auto-pilih bila 1), tanda tangan "SATPAM GUDANG <nama>" di `buildTUG10HTML` — signature fungsi kini `(txn, katalogList, lokasiList, users, satpamList, gudangList, subGudangList)`, `downloadTUG10HTML` ikut berubah (showToast pindah ke argumen terakhir), (c) fix "tombol Ajukan mati": state `savingTxn` + checklist kelengkapan live via `tug10Missing()` + scroll-highlight `flagTug10Invalid()` + banner role non-ADMIN/TL; catatan: validasi kini menuntut SEMUA baris barang lengkap (baris kosong harus dihapus, tidak lagi difilter diam-diam), (d) kartu material "Barang #N" collapsible + upload foto kompak, (e) pagination Forecast Stok: 20/50/100 per halaman (default 20) + Sebelumnya/Berikutnya + reset ke hal.1 saat filter/search/sort berubah (`ForecastStokPage.jsx`, class `.forecast-pagination` di `src/index.css`). Build LULUS. Masih perlu dicek user: layout cetak 4 kolom tanda tangan TUG-10; verifikasi end-to-end foto satpam (SP001/SP002 belum ada foto).
- **Langkah berikutnya (urut, bisa langsung dieksekusi):**
  1. User cek dokumen BA TUG-10 hasil cetak/unduh: kenyamanan layout 4 kolom tanda tangan (kolom baru "SATPAM GUDANG <nama>").
  2. User isi `gudangId` satpam via Master Data → Satpam (tiap gudang UPT Surabaya list satpamnya beda) dan upload 1 foto satpam; lalu verifikasi DB: `select id, data->>'name', (data?'foto'), length(data->>'foto') from satpam;` — harus `punya_foto=true` di baris yang diedit.
  3. Lanjut migrasi Non-SAP UPT Surabaya review-first: 40 baris hasil audit (34 kuat, 5 lemah, 1 tanpa kandidat), dieksekusi via UI Opname Non-SAP → Upload Usulan Pencocokan — BUKAN write langsung ke Supabase.
- **Blocker:** tidak ada. Dev server aktif port 3001 (Vite listen IPv6 — pakai `http://localhost:3001`, bukan 127.0.0.1). Catatan: nilai `VITE_GROQ_API_KEY` di dashboard Vercel kemungkinan masih berspasi (kode sudah kebal via trim; bersihkan kapan-kapan, opsional).

## Perintah verifikasi
- `npm run dev` → port 3001 (akses via `localhost`)
- `npm run build`
- Deploy: `git push main`

## Riwayat shift (maksimal 2)
- 2026-07-15 12:03 Codex: foto satpam, mode Alat Berat, banner compact 6 halaman, serta UX Kapasitas/Forecast/TUG diselesaikan, build lulus, dan dipublikasikan ke `main`.
- 2026-07-15 18:11 Claude: paket TUG-10 (cascade lokasi Gudang→Sub Gudang→Blok, satpam per gudang, fix tombol Ajukan + checklist live, kartu material collapsible) + pagination Forecast Stok 20/50/100 — di-commit ke `main`.
