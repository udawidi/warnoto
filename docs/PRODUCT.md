# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Staf gudang PT PLN (Persero) lintas jenjang organisasi, dengan scoping 3-tier:
- **UPT** (satu unit): Admin/TL & Asman UPT — kerja operasional harian (stok, transaksi, material cadang, opname).
- **UIT** (gabungan beberapa UPT): ADMIN_UIT, ASMAN_LOG_UIT, MGR_LOGISTIK_UIT — memantau & memutuskan tingkat unit induk, melihat agregat lintas-UPT.
- **Pusat / SUPERADMIN**: cakupan nasional.

Untuk surface **Rekomendasi Pengadaan (cockpit forecast gabungan)**, pengguna utama = **Manajemen UIT/Pusat** dalam situasi memantau agregat lintas-UPT untuk analisa & keputusan pengadaan tingkat unit (bukan eksekusi per-item harian).

## Product Purpose

Digitalisasi gudang PLN: kelola stok material, transaksi keluar/masuk, forecast kebutuhan, material cadang (spare), pengadaan, opname/stock count, dan aset. Sukses = manajemen & petugas gudang mengambil keputusan persediaan/pengadaan berbasis data yang akurat dan ter-scope sesuai wewenang.

## Positioning

- **Scoping 3-tier tunggal** (`getScopeUptIds`/`inScopeUpt`): satu sumber kebenaran cakupan data untuk semua layar — UPT lihat unitnya, UIT lihat gabungan UPT-nya, Pusat nasional.
- **Dua mesin forecast digabung** dalam satu rekomendasi pengadaan: (a) statistik ROP/ROQ + prediksi ML (Prophet) untuk material bertransaksi, dan (b) Material Cadang berbasis Poisson service-level per kelas ABC + Health Index untuk spare kritis. Gap dari kedua mesin menyatu jadi satu usulan beli.

## Operating Context

- Budaya **review-first / persetujuan manual**: aksi tulis (mis. apply min qty) melewati pengajuan → approval Asman; tidak ada aksi turunan otomatis.
- Rekomendasi Pengadaan tingkat manajemen = **read-only**: pantau, banding antar-UPT, salin/ekspor daftar. Aksi tulis (apply/ajukan min qty) tetap di menu Material Cadang, bukan di cockpit ini.
- Production Supabase **self-host** (minipc, domain warnoto.com); deploy via `git push` ke main (auto Vercel); dev lokal port 3001.

## Capabilities and Constraints

- React + Vite 4, Supabase (REST), Tailwind v4 via `@tailwindcss/postcss` dengan **preflight OFF** — interaktivitas via CSS global element-selector, bukan utility class per-elemen.
- Data nyata: stok (junction lokasi×katalog), transaksi, hasil analisis Material Cadang (ter-stamp `uptId`), katalog (Master + referensi MARA/SAP). Tidak ada data karangan.
- Layar forecast menerima data yang **sudah ter-scope** dari App (`scopedStocks`/`scopedTxns`); pola filter per-UPT untuk viewer multi-UPT sudah ada (`stockUptFilterOptions`).
- Terminologi: Material Cadang (spare), Forecast Stok, Rekomendasi Pengadaan, Min Qty, Gap, Health Index, ABC, ROP/ROQ, UPT/UIT.

## Brand Commitments

- Identitas korporat **PT PLN (Persero)**: logo PLN, nuansa biru korporat yang sudah dipakai di seluruh aplikasi.
- Batasan visual mengikat yang dinyatakan user untuk surface ini: **tema korporat, mudah dilihat & dibaca, tampilan elegan.** (Dicatat sebagai batasan; elaborasi dunia visual dilakukan di tahap new-work.)
- Floor keterbacaan: font efektif ≥ 12px (prioritas keterbacaan di layar laptop).

## Evidence on Hand

- Sumber data operasional live di Supabase self-host (stok, transaksi, material_cadang_* tables, katalog, MARA reference). AI Insight via Groq (openai/gpt-oss-120b) dengan fallback lokal deterministik saat key kosong.
- Tidak ada testimoni/benchmark/pricing — jangan difabrikasi.

## Product Principles

1. **Wewenang menentukan data**: setiap tampilan menghormati scope 3-tier; tidak ada kebocoran antar-UPT.
2. **Keputusan berbasis dua mesin**: forecast statistik dan Material Cadang dibaca berdampingan, bukan terpisah, agar manajemen menilai kebutuhan pengadaan utuh.
3. **Review-first**: cockpit manajemen memantau & menganalisa; aksi tulis selalu lewat jalur persetujuan di menu operasional.
4. **Angka deterministik dulu, AI belakangan**: perhitungan resmi (gap, ROP, health) lokal & dapat diaudit; AI hanya lapisan insight, tidak menulis angka resmi.

## Accessibility & Inclusion

Keterbacaan di layar laptop kantor adalah kebutuhan utama: hierarki jelas, kontras cukup, ukuran teks tidak di bawah floor 12px. Cockpit dipakai untuk membaca banyak angka sekaligus — utamakan scanability.
