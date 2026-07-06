---
name: update-data
description: Use this skill when the user types "/update-data" or asks to sync/push all finished work to the repo and Supabase. Reviews git changes, commits and (after confirmation) pushes to GitHub, and flags Supabase schema.sql changes for manual/confirmed application. Does NOT touch pending-review data (e.g. batch imports awaiting manual approval).
---

# Update & Sinkronisasi Data WARNOTO

Menyatukan pekerjaan yang sudah selesai ke git repo (GitHub) dan (kalau ada perubahan skema) ke Supabase. Skill ini **bukan** untuk mendorong data yang masih menunggu review manual (mis. histori TUG UPT Surabaya, batch import Material Cadang) — data semacam itu tetap harus lewat alur review/approval manual di aplikasi, lihat `CLAUDE_HANDOFF.md` section 4 & 5.

## Langkah

1. **Cek status.** Jalankan `git status` dan `git diff` (staged + unstaged) untuk lihat semua perubahan tracked.
2. **Untracked files.** Kalau ada file baru yang belum di-track, tampilkan daftarnya ke user dan tanya satu per satu/kelompok mana yang mau ikut di-commit. **Jangan** pakai `git add -A`/`git add .` — add file spesifik saja. Cek dulu tidak ada file sensitif (`.env`, credentials, key apapun) yang ikut ke-stage.
3. **Draft commit message.** Ringkas *kenapa* perubahan ini dibuat (bukan cuma daftar file), ikuti gaya commit message project ini (lihat `git log` terakhir — Bahasa Indonesia, ringkas, fokus pada perubahan fungsional).
4. **Commit lokal.** Buat commit dengan file yang sudah dikonfirmasi. Sertakan co-author line seperti biasa.
5. **Cek App.jsx belum ditest.** Kalau commit ini menyentuh `App.jsx`, ingatkan user untuk pastikan sudah `npm run build` sukses dan (idealnya) sudah dicoba di browser — jangan asumsikan otomatis aman, ini sudah beberapa kali jadi sumber bug menurut `CLAUDE_HANDOFF.md` section 5.
6. **Cek perubahan skema Supabase.** Kalau `supabase/schema.sql` termasuk dalam commit ini, tampilkan ringkasan diff-nya dan tanya user: mau diterapkan sekarang ke Supabase (lewat SQL Editor manual, atau lewat tool MCP Supabase kalau user minta), atau ditunda? **Jangan pernah menerapkan schema.sql ke Supabase tanpa konfirmasi eksplisit** — ini instance database production/shared.
7. **Konfirmasi sebelum push.** Tampilkan ringkasan commit (`git log -1 --stat` atau sejenis) dan tanya eksplisit "push ke remote sekarang?" sebelum menjalankan `git push`. **Selalu tunggu jawaban user di sini, jangan auto-push.**
8. **Push.** Setelah dikonfirmasi, `git push` ke branch yang sedang aktif (bukan force-push, bukan ke branch lain tanpa diminta).
9. **Laporkan hasil.** Ringkas: apa yang ter-commit, apakah sudah ter-push, apakah ada item skema Supabase yang masih menunggu keputusan user, dan apakah ada data pending-review (TUG Surabaya dkk) yang **sengaja tidak disentuh** skill ini supaya user tidak lupa itu masih ada.

## Batasan Keras

- **Tidak pernah** memproses/menyetujui data yang statusnya masih "pending review" (histori TUG Surabaya, approval Material Cadang, migrasi SAP/Non-SAP, dll) — itu tetap harus manual lewat UI aplikasi sesuai alur approval yang sudah ada.
- **Tidak pernah** push otomatis tanpa konfirmasi user tiap kali skill ini jalan.
- **Tidak pernah** force-push atau push ke branch selain branch yang sedang aktif.
- **Tidak pernah** menjalankan `supabase/schema.sql` ke database tanpa konfirmasi eksplisit di langkah itu.
- Kalau `git status` menunjukkan sesuatu yang mencurigakan (file besar, kemungkinan berisi secret), stop dan tanya user dulu sebelum lanjut commit.
