# WARNOTO — CLAUDE.md project

**Benang merah lintas-vendor ada di `HANDOFF.md` — WAJIB baca di awal sesi dan lanjutkan dari "Langkah berikutnya".**

`HANDOFF.md` harus ringkas dan diperbarui hanya saat status material berubah. Riwayat hanya untuk pergantian vendor/shift, maksimal 2 entri terakhir; saat menambah entri ketiga, hapus yang tertua. Jangan membuat log per sub-langkah.

**Hemat token baca `HANDOFF.md` (file ini sudah besar, >35rb token kalau dibaca penuh):** kalau task-nya spesifik (bukan awal sesi butuh orientasi umum), `Grep` heading/keyword relevan dulu (mis. nama fitur/menu yang disebut user) lalu `Read` dengan `offset`/`limit` ke bagian itu saja — jangan `Read` seluruh file tanpa `offset`/`limit` kecuali memang butuh gambaran menyeluruh di awal sesi baru.

## Tujuan project
Aplikasi manajemen gudang PLN (React + Vite 4 + Supabase, deploy Vercel).

## Fakta mengikat (jangan dilanggar)
- Dev lokal: `npm run dev` — port **3001**. Build: `npm run build`.
- Deploy: **git push ke main** (auto Vercel). JANGAN `vercel --prod` (folder `outputs/` berat ikut terupload).
- **Production Supabase SELF-HOST** di `minipc-gudang` (domain `warnoto.com`), migrasi dari Cloud (`tadxodrzoquugnsyejld`) selesai 2026-07-22 — cloud lama sengaja tidak dihapus (jaring pengaman rollback) tapi APLIKASI TIDAK LAGI MEMBACANYA. Akses DB: `ssh minipc-gudang` + `docker exec supabase-db psql`. Perubahan skema = proposal dulu, eksekusi hanya setelah konfirmasi user. Detail lengkap ada di `HANDOFF.md`.
- Tabel `wa_sync_status` MASIH dipakai bot Telegram — jangan di-drop meski fitur WA sudah dihapus.
- Tailwind v4 via `@tailwindcss/postcss` (bukan plugin Vite), preflight OFF; interaktivitas via CSS global element-selector, bukan className.
- `App.jsx` sudah di-refactor (2026-07-25, ~9.320→~5.539 baris) — semua JSX per-tab/modal yang aman dipisah sudah diekstrak ke `src/components/*.jsx` (murni relokasi, prop-drilling dari `PLNWarehouse()`, tidak ada logic yang berubah). Sisa ~5.000 baris di `PLNWarehouse()` adalah state (`useState`) + handler function — user MEMUTUSKAN CUKUP di titik ini, TIDAK melanjutkan ke ekstraksi logic/handler (custom hooks) karena risikonya lebih tinggi tanpa verifikasi visual browser. Kalau nanti mau lanjut ke situ, itu keputusan terpisah, bukan otomatis lanjutan dari sesi ini.
- Alur produk review-first / persetujuan manual; jangan auto-membuat aksi turunan.

## Status pekerjaan
Lihat bagian "Status sekarang" di `HANDOFF.md` (satu-satunya sumber status, supaya tidak ada dua versi).

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- **Awal sesi/project**: sebelum mulai kerja, baca dulu graphify (mis. `graphify query "<ringkasan project>"` atau GRAPH_REPORT.md) supaya orientasi konsisten dan terstruktur, apapun model/vendor yang sedang dipakai (Fable/Opus/Sonnet/Codex).
- **Setelah edit kode** → jalankan `graphify update .` supaya graph tetap sinkron (AST-only, tidak kena biaya API).
- **Sekali per topik, bukan per tool call (hemat token, ditambahkan 2026-07-25):** jalankan `graphify query/explain/path` SEKALI di awal saat menyelusuri topik/bug/fitur baru untuk menemukan file & fungsi yang tepat. Begitu lokasi kode sudah pasti dalam sesi yang sama, `Read`/`Grep` langsung ke file/baris itu untuk langkah-langkah susulan (baca detail, verifikasi, edit) TIDAK perlu mengulang query graphify lagi — output graphify per-query bisa ~2rb token dan sering nyaris sama untuk area yang sudah dieksplorasi, jadi pengulangannya murni boros tanpa nilai orientasi baru.

Untuk pertanyaan tentang WARNOTO project, pilih sesuai skala:
- **Relasi antar dua bagian kode** → `graphify path "<A>" "<B>"`.
- **Pahami satu konsep/modul** → `graphify explain "<konsep>"`.
- **Pertanyaan codebase umum** → `graphify query "<pertanyaan>"` — lebih hemat daripada grep manual, hasilnya subgraph relevan saja.
- **Navigasi arsitektur luas** → buka `graphify-out/wiki/index.md` dulu (kalau ada) sebelum baca source mentah.
- **Review arsitektur menyeluruh** → baca `graphify-out/GRAPH_REPORT.md`, dipakai kalau query/path/explain belum cukup.
