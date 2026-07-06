---
name: mulai
description: Use this skill when the user types "/mulai" or asks to start/boot up the WARNOTO app for local development. Starts the Vite dev server (npm run dev) in the background and confirms the app is ready at its local URL.
---

# Mulai WARNOTO

Menyalakan environment development WARNOTO agar siap dipakai/di-review di browser.

## Langkah

1. Cek apakah dev server sudah jalan (proses `vite` sudah listen di port 3001). Jika sudah, laporkan URL-nya langsung tanpa start ulang.
2. Jika belum jalan, jalankan `npm run dev` di working directory project ini sebagai proses background (`run_in_background: true`).
3. Tunggu output Vite sampai muncul baris `Local:` yang menunjukkan server sudah siap (gunakan Monitor/BashOutput, jangan sleep-poll manual).
4. Laporkan ke user bahwa aplikasi sudah siap, sertakan URL lokal (default `http://localhost:3001/`, Vite akan auto-open browser sesuai `vite.config.js`).
5. Jika `npm run dev` gagal (port bentrok, dependency belum ke-install, dll), tampilkan error-nya apa adanya dan sarankan langkah perbaikan (mis. `npm install` dulu kalau `node_modules` belum lengkap).

## Catatan

- Project ini cuma satu server (frontend Vite, `package.json:19`). Tidak ada backend terpisah yang perlu dinyalakan.
- Jangan matikan proses dev server yang sudah berjalan tanpa diminta user.
