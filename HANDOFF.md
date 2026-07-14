# HANDOFF — warnoto-project

> File benang merah lintas-vendor. Dibaca & ditulis oleh **Claude (Vendor A)** dan **Codex (Vendor B)**.
> Siapa pun yang mengerjakan proyek ini WAJIB baca file ini dulu, lalu memperbaruinya setelah tiap langkah.
> Jangan keluar jalur / mendesain ulang pekerjaan yang sedang berjalan.

**Vendor aktif terakhir:** Codex  |  **Update terakhir:** 2026-07-14 19:10

## Tujuan / benang merah
WARNOTO — aplikasi manajemen gudang PLN (React + Vite 4 + Supabase, deploy Vercel). Fokus saat ini: penyelesaian item pending (migrasi Non-SAP UPT Surabaya) dan penyempurnaan bertahap, BUKAN redesign.

## Keputusan arsitektur
- Entry `App.jsx` masih besar (~7.800 baris); komponen lain sudah dipecah ke `src/`. Split internal `PLNWarehouse` DITUNDA menunggu keputusan user — jangan dikerjakan tanpa persetujuan.
- Tailwind v4 via `@tailwindcss/postcss` (bukan plugin Vite), preflight OFF; interaktivitas via CSS global element-selector, bukan className.
- Supabase project `tadxodrzoquugnsyejld`; perubahan skema = proposal dulu, eksekusi setelah konfirmasi user.
- Tabel `wa_sync_status` MASIH dipakai bot Telegram (fitur WA sudah dihapus) — jangan di-drop.
- Deploy: git push ke `main` (auto Vercel). JANGAN `vercel --prod` (folder `outputs/` berat).
- Alur kerja produk: review-first / persetujuan manual; jangan auto-membuat aksi turunan.

## Status sekarang
- **Selesai:** upgrade UI Tailwind v4 + overhaul visual (commit 2048119 dst., sudah push); bot nightly sync Telegram diperbaiki; refactor split App.jsx tahap 1; sistem dua-vendor Claude/Codex terpasang & terverifikasi 2026-07-14; refresh UI Approval + seluruh sidebar 2026-07-14; refresh corporate halaman Alat Berat dan ATTB 2026-07-14 (shared operations hero, metrik/scope UPT, filter dan section hierarchy compact, kartu/tabel lebih formal, emoji dekoratif utama dikurangi; workflow tetap). Komponen bersama dipecah ke `OperationsHero.jsx`, CSS ke `src/styles/operations.css`, dan item sidebar ke `SidebarNavItem.jsx` agar `App.jsx` tidak bertambah besar. Build produksi lulus.
- **Sedang dikerjakan:** migrasi Non-SAP UPT Surabaya — tahap audit pra-upload selesai. File `outputs/warnoto-nonstock-review/USULAN_PENCOCOKAN_MARA_NONSTOCK_UPT_SURABAYA.xlsx` tervalidasi: sheet `usulan_pencocokan`, 40 baris (34 KUAT, 5 LEMAH, 1 TIDAK_ADA_KANDIDAT). Belum dibuat sesi opname dan 0 baris dieksekusi ke Supabase.
- **Langkah berikutnya:** retry `git push origin main` ketika koneksi GitHub pulih (commit UI sudah lokal), lalu cek auto-deploy Vercel. Setelah publish, user review visual halaman Approval, Alat Berat, dan ATTB (desktop + mobile). Berikutnya kembali ke migrasi Non-SAP review-first; JANGAN auto-approve.
- **Blocker:** koneksi GitHub dari mesin reset/timeout pada seluruh jalur resmi (Git HTTPS, `gh api`, SSH 443) tanggal 2026-07-14 19:10. Remote `main` terverifikasi masih di `2048119`; commit lokal UI `a2ef1a8` aman dan belum ter-push.
- **File belum di-commit (dirty):** dokumen sistem dua-vendor `HANDOFF.md`, `AGENTS.md`, `CLAUDE.md`; perubahan UI di `App.jsx`, `src/components/ApprovalTab.jsx`, `src/components/AttbTab.jsx`, `src/components/HeavyEquipmentTabV2.jsx`, `src/components/OperationsHero.jsx` (baru), `src/components/SidebarNavItem.jsx` (baru), `src/index.css`, `src/styles/operations.css` (baru). JANGAN commit sendiri; tunggu alur `/update-data` user.

## Perintah verifikasi
- Dev lokal: `npm run dev` -> http://localhost:3001
- Build: `npm run build`
- Deploy: `git push` ke main (cek dashboard Vercel)

## Log handoff (append-only, terbaru di bawah)
- 2026-07-14 16:30 Claude: mengisi HANDOFF.md perdana + memasang sistem dua-vendor (profile PowerShell, AGENTS.md global & project, skill /pindah-codex, kontrak CLAUDE.md global)
- 2026-07-14 17:15 Claude: audit rantai serah-terima — prompt handoff diberi fallback buat-HANDOFF, CLAUDE.md project WARNOTO dibuat, aturan Fable=arsitek murni (tukang: Opus sulit / Sonnet mudah) final
- 2026-07-14 17:30 Claude: sesi ditutup bersih, tidak ada pekerjaan menggantung — serah-terima ke Codex
- 2026-07-14 18:20 Codex: audit pra-upload migrasi Non-SAP UPT Surabaya selesai; workbook dan parser divalidasi 40 baris (34 KUAT, 5 LEMAH, 1 tanpa kandidat), belum membuat sesi opname atau menulis ke Supabase karena menunggu persetujuan manual user
- 2026-07-14 18:36 Codex: refresh corporate UI Approval selesai di sidebar dan halaman utama; build produksi lulus, QA browser localhost dibatasi kebijakan perusahaan sehingga review visual akhir desktop/mobile diserahkan ke user di dev lokal
- 2026-07-14 18:42 Codex: memperbaiki active shadow sidebar agar berpindah sesuai menu, menghapus subtitle Approval, dan menerapkan pola corporate yang sama ke seluruh menu utama; ekstrak `SidebarNavItem.jsx` supaya App.jsx tidak membesar, build produksi dan diff check lulus
- 2026-07-14 19:05 Codex: refresh corporate halaman Alat Berat dan ATTB selesai; shared `OperationsHero.jsx` dan stylesheet modular `src/styles/operations.css` ditambahkan, tampilan dibuat compact dan emoji dekoratif dikurangi tanpa mengubah workflow; build produksi dan diff check lulus
- 2026-07-14 19:10 Codex: commit lokal `a2ef1a8` dibuat; push ke main gagal karena koneksi GitHub di-reset pada HTTPS/API/SSH, remote dipastikan belum berubah dan retry push dicatat sebagai langkah berikutnya
