# HANDOFF — WARNOTO

**Vendor aktif terakhir:** Claude | **Update:** 2026-07-15

## Tujuan / benang merah
WARNOTO adalah aplikasi gudang PLN (React, Vite 4, Supabase). Fokus: penyempurnaan UI bertahap dan migrasi Non-SAP UPT Surabaya secara review-first, bukan redesign besar.

## Keputusan arsitektur
- `App.jsx` masih besar; split internal ditunda sampai user menyetujui.
- Supabase `tadxodrzoquugnsyejld`; perubahan skema harus diusulkan dulu. Jangan drop `wa_sync_status`.
- Tailwind v4 via PostCSS, preflight off. Deploy hanya `git push main`.
- Sidebar: desktop 260/76px, auto-compact <=1120px, drawer mobile <=768px. Top bar navy menjadi satu-satunya header halaman (eyebrow + judul dinamis) dan memuat dropdown akun; ikon SVG putih, warna/logo PLN/font lama tetap.
- Alur bisnis review-first; jangan membuat aksi turunan atau auto-approve tanpa persetujuan.
- Pak War memakai Groq untuk jawaban generatif; bila layanan gagal, pertanyaan stok/material inti dijawab dari snapshot lokal WARNOTO agar fitur tetap operasional.

## Status sekarang
- **Selesai:** UI shell responsif; dashboard/modul operasional/TUG dipoles. Forecast Stok diubah menjadi ringkasan, filter, tabel risiko, dan detail analisis yang mudah dipindai. Komposer Pak War kini memakai input penuh di atas tombol kirim, tipografi diperbesar, error API ditangani eksplisit, dan fallback data lokal menjawab stok/material saat Groq gagal. Logo compact memakai rasio vertikal logo PLN asli. Build produksi lulus.
- **Sedang dikerjakan:** migrasi Non-SAP UPT Surabaya sudah diaudit: 40 baris (34 kuat, 5 lemah, 1 tanpa kandidat); belum ada sesi opname atau write ke Supabase.
- **Langkah berikutnya:** user uji visual di `http://localhost:3001`: (a) font kecil dinormalisasi seluruh app (6–8px→10, 9–10px→11; 72 titik CSS + 216 inline JSX), (b) toggle sidebar pindah ke footer sidebar (desktop; compact = ikon expand, lebar = "Sembunyikan menu"). Belum commit. Jika oke, commit+push lalu lanjut migrasi Non-SAP review-first.
- **Blocker:** TIDAK ADA. Akar 401 Groq ditemukan: spasi di depan `VITE_GROQ_API_KEY` di `.env.local` (bawaan `vercel env pull` — nilai di Vercel kemungkinan juga berspasi, tapi kode kini `.trim()` key jadi produksi aman setelah deploy). Key valid, model `llama-3.3-70b-versatile` aktif. Dev server HTTP 200 di `http://localhost:3001` (Vite listen IPv6, jangan pakai 127.0.0.1).

## Perintah verifikasi
- `npm run dev` → port 3001
- `npm run build`
- Deploy: `git push main`

## Riwayat shift (maksimal 2)
- 2026-07-15 Codex: Forecast Stok dan Pak War dipoles, commit `16b8c37` diringkas, dev server HTTP 200 di port 3001; handoff ke Claude.
- 2026-07-15 Claude: Review diff Pak War Codex (fallback lokal + komposer) — scope variabel valid, error handling benar; `npm run build` lulus. Perubahan BELUM di-commit, menunggu user uji + key Groq baru.
