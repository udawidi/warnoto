# Role: Frontend Developer — WARNOTO

Dokumen ini aturan main untuk **frontend developer** WARNOTO (mis. Kevin). Tujuannya: kamu bisa langsung mengedit tampilan aplikasi dan deploy ke production, tanpa merusak data, database, atau alur backend. Baca sekali sampai habis sebelum mulai.

WARNOTO = aplikasi manajemen gudang PLN. Stack: React + Vite 4 + Tailwind v4, backend Supabase self-host, deploy otomatis via Vercel saat push ke `main`.

---

## 1. Zona aman — boleh kamu edit bebas

Ini semua soal **tampilan** (layout, teks, warna, spacing, komponen visual):

- **`src/components/*.jsx`** — 63 komponen presentasi. Semua data masuk lewat props (prop-drilling dari `App.jsx`). Ubah layout, teks/copy, styling, susunan elemen di sini dengan aman.
- **`src/theme.js`** — palet warna (`C`) dan builder style (`sty.btn`, `sty.card`, dll). Dipakai lintas komponen, jadi hati-hati: ganti nilai warna aman, tapi ubah struktur builder bisa berdampak ke banyak layar.
- **`src/index.css`** — CSS global. Semua styling interaktif (hover/focus/active) ada di sini (lihat bagian Quirk).
- **`App.jsx` — HANYA bagian JSX / markup tampilan** di dalam `return (...)`. Boleh ubah susunan visual, teks, className. **JANGAN** sentuh `useState`, `useEffect`, atau fungsi handler (lihat zona terlarang).

Kalau ragu sebuah file masuk zona aman atau tidak: kalau isinya JSX/style → aman; kalau isinya logic/pengambilan/penyimpanan data → jangan.

---

## 2. Zona terlarang — JANGAN disentuh

Kalau diubah, bisa merusak data production, sinkronisasi database, atau deploy:

- **`App.jsx` bagian logic**: semua `useState`, `useEffect`, dan fungsi handler — contoh: `saveStock`, `saveToCloud` (baris ~1307), `openEditStock`, dan sejenisnya. Ini yang menulis ke database.
- **`src/lib/*`** — terutama `supabaseSync.js`, `sap.js`, `utils.js`.
- **`src/supabaseClient.js`** — koneksi ke database.
- **`src/hooks/*`** — 10 hook data (`useTugTransactions`, `useWarehouseConfig`, `useMaturity`, `useStockOpname`, dll). Semua ini logika bisnis + data.
- **`docs/*` (schema/spec)**, **`.github/workflows/*`**, **`package.json` / dependency**, **Supabase edge functions**.

Kalau sebuah perubahan tampilan mengharuskan menyentuh salah satu di atas, **stop dan tanya admin utama dulu** — jangan diakali sendiri.

---

## 3. Quirk yang WAJIB kamu tahu (kalau dilanggar, styling patah)

- **Tailwind v4** dipasang via `@tailwindcss/postcss`, dan **preflight OFF**. Jangan berasumsi reset default Tailwind aktif.
- **Interaktivitas (hover/focus/active) ditulis di `src/index.css` sebagai element-selector global, BUKAN lewat className Tailwind** (`hover:bg-...` tidak dipakai sebagai pola utama). Kalau mau efek hover, cari/edit selector-nya di `index.css`.
- **Font floor 12px** — jangan bikin teks lebih kecil dari 12px (keterbacaan di laptop lebih diutamakan daripada kepadatan).

---

## 4. Alur kerja & deploy

- Dev lokal: `npm run dev` → jalan di port **3001**.
- Build cek: `npm run build` (pastikan hijau sebelum push).
- Deploy production: **cukup `git push` ke `main`** → Vercel deploy otomatis.
- **JANGAN `vercel --prod`** — folder `outputs/` yang berat ikut terupload. Selalu lewat git push.

---

## 5. Kalau kadung bikin error — cara balik (rollback)

Urut dari yang paling cepat:

1. **Tampilan production rusak** → buka **dashboard Vercel → Deployments → pilih deploy sebelumnya yang bagus → Instant Rollback**. Production balik dalam hitungan detik, tanpa perlu ngoprek kode.
2. **Kode salah** → `git revert <sha>` lalu push, atau balik ke tag snapshot harian: `git reset --hard snapshot-YYYY-MM-DD` (tag dibuat otomatis tiap hari, lihat `daily-snapshot.yml`).
3. **Data database kelihatan kacau** → jangan panik, backup jalan otomatis: dump `pg_dump` per-jam ada di `minipc-gudang` (`/mnt/backup2`). Hubungi admin utama untuk restore — jangan coba restore sendiri.

---

## 6. Ringkasan satu kalimat

Edit tampilan di `src/components`, `theme.js`, `index.css`, dan JSX `App.jsx` sepuasnya; jangan sentuh state/handler/lib/hooks/database; deploy lewat `git push main`; kalau rusak, Vercel Instant Rollback dulu.
