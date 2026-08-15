---
name: war-pendingitem
description: Use this skill when the user types "/war-pendingitem" or asks for a review of pending/unfinished WARNOTO work, both short-term and long-term, plus a recap of what has already been done. Read-only review — does not edit code, commit, push, or touch pending-review data.
---

# Pending Item WARNOTO

Menyusun gambaran menyeluruh: apa yang **sudah dikerjakan** (progres terbaru) dan apa yang **masih menggantung** — baik jangka pendek (siap dilanjutkan sesi ini/besok) maupun jangka panjang (backlog, terblokir, belum mulai). Ini skill review, bukan eksekusi.

## Sumber yang Harus Dicek

Kumpulkan dari semua sumber ini sebelum menulis ringkasan (baca paralel bila memungkinkan):

1. **`docs/CLAUDE_HANDOFF.md` section 4 "STATUS TERKINI"** — sumber utama pending item resmi (ditandai `⏳ PENDING`). Ini paling otoritatif dan paling baru.
2. **`git status`** — file staged/modified/untracked yang belum di-commit = pending jangka pendek yang paling konkret.
3. **`git log --oneline -20`** (atau lebih kalau perlu) — dasar untuk merangkum "sudah dikerjakan" (progres terbaru, bukan cuma dari handoff doc).
4. **Auto-memory project-type** di `C:\Users\PLN\.claude\projects\D--CLAUDE-WARNOTO-CODE-warnoto-project\memory\` — baca `MEMORY.md` lalu file-file bertipe `project` (mis. `project_pending_tug_surabaya.md`). Memory bisa lebih baru atau lebih detail daripada dokumen di repo, tapi **verifikasi dulu masih relevan** (cross-check dengan file/status yang disebutkan sebelum menganggapnya masih berlaku).
5. **Spec docs** (`docs/*_SPEC.md`) — cek apakah ada fitur yang spec-nya ada tapi implementasinya sebagian/belum jalan (mis. WA Bot terblokir Meta Verification), ini biasanya pending jangka panjang.
6. **`docs/WARNOTO_DOCS.md`** — untuk item roadmap/keputusan historis yang mungkin belum tercermin di CLAUDE_HANDOFF.md section 4.

Kalau ada ketidaksesuaian antar sumber (mis. memory bilang sesuatu masih pending tapi `git log`/`git status` menunjukkan sudah selesai & ter-commit), **percaya kondisi repo/git yang sekarang**, dan tandai memory/dokumen itu sebagai kemungkinan basi di laporan.

## Klasifikasi

- **Jangka pendek**: siap dilanjutkan dalam 1 sesi kerja berikutnya — file staged belum di-commit, bug yang sudah ditemukan tapi belum di-fix, fitur yang sudah 80% jadi, keputusan kecil yang tinggal dikonfirmasi user.
- **Jangka panjang**: backlog/belum mulai, atau terblokir oleh sesuatu di luar kendali langsung (mis. verifikasi bisnis Meta untuk WA Bot), atau butuh review manual besar (mis. ratusan baris data histori yang butuh keputusan Admin/TL satu per satu).

## Alur

1. Baca semua sumber di atas.
2. Susun laporan dengan struktur di bawah (Bahasa Indonesia).
3. Untuk tiap item pending, sertakan: apa itemnya, kenapa masih menggantung (kalau diketahui), dan file/lokasi acuan (path spesifik) supaya user/sesi berikutnya bisa langsung lanjut tanpa re-investigasi.
4. Kalau menemukan item yang statusnya kelihatan sudah selesai tapi dokumentasi (`CLAUDE_HANDOFF.md` atau memory) belum diupdate, tandai secara eksplisit di bagian akhir sebagai "perlu update dokumentasi" — jangan langsung edit filenya sendiri, cukup laporkan.

## Format Output

```
## Ringkasan Singkat
(2-3 kalimat: kondisi project saat ini secara umum)

## Sudah Dikerjakan (Progres Terbaru)
- (dari git log, ringkas per commit/kelompok commit, bukan sekadar copy pesan commit)

## Pending Jangka Pendek
- (item + lokasi/file acuan + alasan menggantung)

## Pending Jangka Panjang
- (item + lokasi/file acuan + apa yang memblokir/berapa besar scope-nya)

## Perlu Update Dokumentasi (kalau ada mismatch)
- (sebutkan file mana dan bagian mana yang kelihatan basi)

## Rekomendasi Urutan Kerja
(urutan prioritas yang masuk akal kalau user mau lanjut sekarang — bukan keputusan final, cuma saran)
```

## Batasan Keras

- **Read-only.** Jangan edit `App.jsx`, `schema.sql`, dokumentasi, atau file apa pun sebagai bagian dari skill ini.
- Jangan commit, push, atau jalankan `git add`.
- Jangan memproses/approve data yang statusnya pending-review (histori TUG Surabaya, Material Cadang, dll) — skill ini cuma melaporkan bahwa itu masih ada, bukan menindaklanjuti.
- Jangan menjalankan migrasi atau perubahan skema Supabase.
- Kalau user, setelah membaca laporan, minta lanjut mengerjakan salah satu item — itu boleh, tapi itu sudah di luar scope skill ini (lanjutkan sebagai kerja normal, bukan lagi dalam mode `/war-pendingitem`).
