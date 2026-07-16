# HANDOFF — WARNOTO

**Vendor aktif terakhir:** Claude | **Update:** 2026-07-16

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
- **Selesai & dipublikasikan ke `main` (shift-shift sebelumnya):** Pak War humanis + fix 401 Groq (`efb9fca`), floor font 12px + toggle sidebar footer (`6a09f83`), paket Codex `df92373` (foto satpam, mode Alat Berat, banner KPI navy compact di 6 permukaan, UX Kapasitas/Forecast/TUG).
- **Selesai & di-commit (shift Claude 2026-07-15 sore):** paket TUG-10 + pagination Forecast — (a) cascade lokasi Gudang→Sub Gudang→Blok di form TUG-10 (kontrak txn tetap `lokasiTujuanId`, plus `gudangTujuanId`/`subGudangTujuanId`/`satpamId`; legacy blok via sentinel `__legacy__`), (b) satpam punya `gudangId` di jsonb (tanpa ubah skema), Master Data satpam dikelompokkan per gudang, select satpam TUG-10 terfilter gudang (auto-pilih bila 1), tanda tangan "SATPAM GUDANG <nama>" di `buildTUG10HTML` — signature fungsi kini `(txn, katalogList, lokasiList, users, satpamList, gudangList, subGudangList)`, `downloadTUG10HTML` ikut berubah (showToast pindah ke argumen terakhir), (c) fix "tombol Ajukan mati": state `savingTxn` + checklist kelengkapan live via `tug10Missing()` + scroll-highlight `flagTug10Invalid()` + banner role non-ADMIN/TL; catatan: validasi kini menuntut SEMUA baris barang lengkap (baris kosong harus dihapus, tidak lagi difilter diam-diam), (d) kartu material "Barang #N" collapsible + upload foto kompak, (e) pagination Forecast Stok: 20/50/100 per halaman (default 20) + Sebelumnya/Berikutnya + reset ke hal.1 saat filter/search/sort berubah (`ForecastStokPage.jsx`, class `.forecast-pagination` di `src/index.css`). Build LULUS. Masih perlu dicek user: layout cetak 4 kolom tanda tangan TUG-10; verifikasi end-to-end foto satpam (SP001/SP002 belum ada foto).
- **Selesai, di-commit & di-push ke `main` (deploy Vercel otomatis):** fix "Ajukan TUG tidak terjadi apa-apa" — (i) overlay global "Menyimpan Transaksi" (spinner navy + progres upload foto x/y, state `savingInfo`, App.jsx ~4166, kelas `.txn-spinner`), `catch` di `commitNewTxn` (error simpan kini toast merah, tidak diam), timeout 30 detik per upload foto di `processTxnPhotos` (param opsional `onProgress`); (ii) akar masalah: `_isDataUrl` dipakai `commitNewTxn` tapi tak diimpor (sisa refactor split App.jsx) — mematikan Ajukan di SEMUA jenis TUG secara diam-diam. Sweep eslint no-undef menemukan total 6 import/prop hilang, semua diperbaiki: `_isDataUrl` (export supabaseSync + import App.jsx), 2 helper alat berat di `HeavyEquipmentDashboardSummary.jsx`, 2 helper alat berat di `docBuilders.js` (`buildHeavyEquipmentLoanHTML`), `compressImage` di `rag.js` (`ocrSpaceOCR`), prop `isMobile` di `RencanaKedatanganTab.jsx` + call site. Build LULUS, sweep no-undef 0 error. Tips sweep ulang: `npx --yes eslint@8 --no-eslintrc --parser-options=ecmaVersion:2023,sourceType:module,ecmaFeatures:{jsx:true} --env browser,es2023 --rule '{"no-undef":"error"}' App.jsx src/lib/*.js src/components/*.jsx`.
- **Selesai, di-commit & di-push ke `main` (shift Claude 2026-07-16):** paket UI Pak War (`src/components/AIAgentPage.jsx`, `src/index.css`, App.jsx) — (a) fix overlap mobile: `.ai-start` dapat `overflow-y:auto` + `align-content: safe center` (welcome tidak lagi menimpa panel lain); (b) FAQ & Telegram jadi halaman penuh via state `view` ("chat"|"faq"|"telegram") — tanpa kolom chat/composer, ada tombol `← Kembali ke percakapan` (`.ai-config-back`), `.ai-conversation__config` kini `flex:1` full-page scrollable; (c) Sinkron data tetap tombol dengan progres nyata 0–100% (`.ai-sync-mini` mini progress bar; `syncRagChunks` di App.jsx dapat param `onProgress` per batch, call site lama `syncRagChunks(true)` tetap kompatibel). Build LULUS 3x.
- **Selesai, di-commit & di-push ke `main`:** fix "Memuat sesi..." selalu lama saat buka web — akar masalah: startup menunggu 2 roundtrip berurutan (refresh token Auth + fetch `profiles` di dalam callback `onAuthStateChange`) sebelum `authLoading` false. Solusi cache-first (App.jsx saja): profil user di-cache di localStorage (`warnoto_profile_cache_v1`, helper `readCachedProfile` module scope), `currentUser`/`authLoading` init dari cache → app langsung tampil tanpa network; profil di-refresh di latar belakang, cache dibuang saat logout/sesi invalid (auto-lempar ke login); callback `onAuthStateChange` kini non-async (hindari deadlock lock auth per docs supabase-js); semua akses localStorage diguard try/catch. Role client tetap kosmetik — penjaga asli RLS. Build LULUS.
- **Langkah berikutnya (urut, bisa langsung dieksekusi):**
  1. User cek dokumen BA TUG-10 hasil cetak/unduh: kenyamanan layout 4 kolom tanda tangan (kolom baru "SATPAM GUDANG <nama>").
  2. User isi `gudangId` satpam via Master Data → Satpam (tiap gudang UPT Surabaya list satpamnya beda) dan upload 1 foto satpam; lalu verifikasi DB: `select id, data->>'name', (data?'foto'), length(data->>'foto') from satpam;` — harus `punya_foto=true` di baris yang diedit.
  3. Lanjut migrasi Non-SAP UPT Surabaya review-first: 40 baris hasil audit (34 kuat, 5 lemah, 1 tanpa kandidat), dieksekusi via UI Opname Non-SAP → Upload Usulan Pencocokan — BUKAN write langsung ke Supabase.
- **Blocker:** tidak ada. Dev server: `npm run dev` port 3001 (Vite listen IPv6 — pakai `http://localhost:3001`, bukan 127.0.0.1). Catatan: nilai `VITE_GROQ_API_KEY` di dashboard Vercel kemungkinan masih berspasi (kode sudah kebal via trim; bersihkan kapan-kapan, opsional).

## Perintah verifikasi
- `npm run dev` → port 3001 (akses via `localhost`)
- `npm run build`
- Deploy: `git push main`

## Riwayat shift (maksimal 2)
- 2026-07-16 Claude: paket UI Pak War — fix overlap welcome di mobile, FAQ/Telegram jadi halaman penuh + tombol kembali, Sinkron data dengan progres 0–100% — commit + push ke `main`.
- 2026-07-16 Claude: fix "Memuat sesi..." lama — cache-first profil di localStorage, callback auth non-async, app tampil instan tanpa menunggu network — commit + push ke `main`.
