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

## Login Demo

| Role | Username | Password |
|:---|:---|:---|
| Admin Gudang | admin.ketintang | pln2024 |
| TL Logistik | tl.ketintang | pln2024 |
| Asman | asman.ketintang | pln2024 |
| Manager | manager.ketintang | pln2024 |
| Admin UIT | admin.uit | pln2024 |
| Mgr Logistik UIT | mgrlog.uit | pln2024 |
| Pengadaan | pengadaan.ketintang | pln2024 |

---

## Struktur File

```
warnoto-project/
├── App.jsx              ← Aplikasi utama (single file, ~7000 baris)
├── index.html           ← Entry HTML
├── vite.config.js       ← Vite config
├── package.json         ← Dependencies
├── src/
│   ├── main.jsx         ← React entry point
│   └── storage.js       ← Storage adapter (Artifact ↔ localStorage)
└── WARNOTO_DOCS.md      ← Dokumentasi lengkap & planning
```

Catatan dokumen tambahan:
- `MATERIAL_CADANG_SPEC.md` berisi spesifikasi fitur Material Cadang, format import CSV/XLSX, dashboard manajemen, approval Asman untuk apply `minQty`, hidden Catalog Master PLN, dan hidden SAP MARA reference.
- `TEMPLATE_IMPORT_MATERIAL_CADANG.xlsx` adalah template upload XLSX resmi v1 untuk data populasi/failure Material Cadang; CSV harus mengikuti header yang sama.
- `WA_AI_AGENT_SPEC.md` berisi spesifikasi integrasi AI Agent WARNOTO ke WhatsApp Cloud API via Supabase Edge Function, read-only, whitelist nomor, server-side state, RAG sync harian, dan audit log.

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

- **v32** — Juni 2026
- Single-file React architecture
- 145 material SAP Persediaan UPT Surabaya hardcoded sebagai default data
- Planning fitur Material Cadang tersedia di `MATERIAL_CADANG_SPEC.md`
- Planning fitur WA AI Agent tersedia di `WA_AI_AGENT_SPEC.md`
- Lihat WARNOTO_DOCS.md untuk roadmap lengkap

## Kontak
Widi — Admin Gudang PT PLN UPT Surabaya (Gudang Ketintang)
