# WARNOTO — PLN TUG Digital
## Warehouse Intelligent Control for Transmission Operation
### PT PLN (Persero) UPT Surabaya — Gudang Ketintang

---

## Quick Start (Claude Code / Lokal)

```bash
# 1. Install dependencies
npm install

# 2. Jalankan development server
npm run dev

# 3. Buka browser → http://localhost:3000
```

## Login

Login sudah pindah dari password hardcoded ke **Supabase Auth** (`auth.users` + tabel `profiles`).
Username disintesis jadi email lewat `usernameToAuthEmail()` (domain `@warnoto.pln.local`).
Akun aktual (username, role, password) dikelola Admin lewat `scripts/bulk_create_users.mjs`
atau Supabase Dashboard — tidak ada lagi password default yang berlaku untuk semua environment.

Role yang dikenal: `ADMIN, TL, ASMAN, MANAGER, ADMIN_UIT, MGR_LOGISTIK_UIT, ADMIN_ULTG, MGR_ULTG, PENGADAAN, VIEWER`.

---

## Struktur File

```
warnoto-project/
├── App.jsx              ← Aplikasi utama (single file, ~14.500 baris)
├── index.html           ← Entry HTML
├── vite.config.js       ← Vite config
├── package.json         ← Dependencies
├── src/
│   ├── main.jsx         ← React entry point
│   └── storage.js       ← Storage adapter (Artifact ↔ localStorage)
├── supabase/
│   ├── schema.sql       ← Skema Supabase lengkap (master data, forecast, RAG, bot, dst)
│   └── functions/       ← Edge Functions: telegram-webhook (aktif), whatsapp-webhook (blocked Meta)
├── scripts/             ← bulk_create_users.mjs, nightly_sync.mjs, gen_form_telegram.py, dll
└── docs/                ← Semua dokumentasi (handoff, spec fitur, arsip lama)
    ├── CLAUDE_HANDOFF.md
    ├── WARNOTO_DOCS.md
    ├── MATERIAL_CADANG_SPEC.md
    ├── WA_AI_AGENT_SPEC.md
    ├── GUDANG_CAPACITY_SPEC.md
    └── archive/         ← Snapshot dokumentasi basi (2026-06-30), cuma referensi historis
```

Catatan dokumen tambahan (semua di folder `docs/`, kecuali README.md ini yang tetap di root):
- `docs/SYSTEM_OVERVIEW.md` peta besar sistem — tujuan, modul utama, hubungan antar fitur, aturan global. **Baca ini duluan** untuk orientasi cepat.
- `docs/CLAUDE_HANDOFF.md` adalah pintu masuk singkat saat project dipindahkan/dilanjutkan di Claude — baca setelah SYSTEM_OVERVIEW, berisi status terkini dan aturan kerja wajib.
- `docs/MATERIAL_CADANG_SPEC.md` berisi spesifikasi fitur Material Cadang — **sudah diimplementasikan** (ABC/policy + Health Index + AI Insight, lihat addendum di bagian akhir dokumen), termasuk hidden Catalog Master PLN dan hidden SAP MARA reference.
- `docs/WA_AI_AGENT_SPEC.md` berisi spesifikasi integrasi AI Agent ke WhatsApp Cloud API — kode Edge Function **sudah selesai tapi terblokir Meta Business Verification**; channel bot AI yang aktif sekarang adalah **Telegram** (`supabase/functions/telegram-webhook`).
- `docs/GUDANG_CAPACITY_SPEC.md` berisi spesifikasi fitur Monitoring Kapasitas Gudang — **sudah diimplementasikan** dengan auto-backup ke Supabase (`warehouse_capacity`).
- Planning migrasi stok SAP/Non-SAP dan histori TUG-15 ada di `docs/WARNOTO_DOCS.md` bagian 20 — **sudah diimplementasikan** sebagai `MigrasiDataTab` dengan aturan keamanan review manual (lihat `docs/CLAUDE_HANDOFF.md` bagian 4).

## Perbedaan Artifact vs Lokal

| Aspek | Claude Artifact | Claude Code / Lokal |
|:---|:---|:---|
| Storage | window.storage (cloud) | localStorage browser |
| Data persisten | Per-session artifact | Permanen di browser |
| Anthropic API | Sudah ter-inject | Perlu API key di .env |

## Anthropic API Key (untuk AI Agent & Forecasting)

Buat file `.env` di root project:
```
VITE_ANTHROPIC_API_KEY=sk-ant-xxxxxxxx
```

Lalu update di App.jsx bagian `fetch("https://api.anthropic.com/v1/messages"`:
```js
headers: {
  "Content-Type": "application/json",
  "x-api-key": import.meta.env.VITE_ANTHROPIC_API_KEY,
  "anthropic-version": "2023-06-01"
}
```

---

## Versi

- Status per **2026-07-06** — lihat `docs/CLAUDE_HANDOFF.md` bagian 4 untuk detail terkini
- Single-file React architecture, ~14.500 baris, storage Supabase (Postgres + Auth + Edge Functions) menggantikan localStorage-only
- Login memakai Supabase Auth (bukan lagi password hardcoded)
- Fitur Material Cadang (ABC/policy + Health Index + AI Insight) sudah diimplementasikan — spec di `docs/MATERIAL_CADANG_SPEC.md`
- Fitur Monitoring Kapasitas Gudang sudah diimplementasikan — spec di `docs/GUDANG_CAPACITY_SPEC.md`
- Migrasi stok SAP/Non-SAP + histori TUG-15 sudah diimplementasikan (`MigrasiDataTab`) — spec di `docs/WARNOTO_DOCS.md` bagian 20
- Menu Alat Berat tersedia untuk monitoring alat angkat/angkut multi-UPT, foto alat, peminjaman antar UPT dengan approval Asman pemilik, reminder overdue, histori peminjaman, dan ringkasan dashboard — sekarang auto-backup ke Supabase (`heavy_equipment`/`heavy_equipment_loans`)
- Bot AI: **Telegram aktif** sebagai channel utama; WA Agent kodenya selesai (`docs/WA_AI_AGENT_SPEC.md`) tapi terblokir Meta Business Verification
- Scan Barcode multi-device (`ScanPublicView`) sudah bisa dipakai banyak orang bersamaan tanpa bentrok (`stock_scan_log`)
- Lihat `docs/CLAUDE_HANDOFF.md` untuk status terkini dan `docs/WARNOTO_DOCS.md` untuk roadmap/histori lengkap

## Kontak
Widi — Admin Gudang PT PLN UPT Surabaya (Gudang Ketintang)
