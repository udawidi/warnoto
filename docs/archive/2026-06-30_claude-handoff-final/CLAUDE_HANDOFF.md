# Claude Handoff WARNOTO

Dokumen ini adalah pintu masuk singkat saat project WARNOTO dipindahkan/dilanjutkan di Claude.

Tanggal handoff: 30 Juni 2026.

---

## 1. Baca Berurutan

1. `README.md`
2. `WARNOTO_DOCS.md`
3. `App.jsx`
4. `MATERIAL_CADANG_SPEC.md`
5. `WA_AI_AGENT_SPEC.md`
6. `supabase/schema.sql`
7. `supabase/functions/whatsapp-webhook/index.ts`

Jika konteks terlalu besar, mulai dari:

1. `README.md`
2. `WARNOTO_DOCS.md` bagian 18, 19, dan 20
3. Spec fitur yang sedang dikerjakan

---

## 2. File Project Utama

| File | Fungsi |
| --- | --- |
| `App.jsx` | Aplikasi WARNOTO utama, single-file React. |
| `WARNOTO_DOCS.md` | Dokumentasi status, roadmap, keputusan lintas sesi, dan planning migrasi stok/TUG-15. |
| `MATERIAL_CADANG_SPEC.md` | Spec mandiri fitur Material Cadang. |
| `WA_AI_AGENT_SPEC.md` | Spec mandiri integrasi AI Agent ke WhatsApp Cloud API. |
| `TEMPLATE_IMPORT_MATERIAL_CADANG.xlsx` | Template upload Material Cadang v1. |
| `supabase/schema.sql` | Skema Supabase untuk forecast, RAG, master data, profile, dan sync. |
| `supabase/functions/whatsapp-webhook/index.ts` | Skeleton Supabase Edge Function untuk WhatsApp Cloud API. |

---

## 3. File Referensi Eksternal yang Perlu Diikutkan

Lokasi saat ini:

```text
D:\CLAUDE\WARNOTO data\tester
```

File penting:

| File | Fungsi |
| --- | --- |
| `CATALOG MASTER.xlsx` | Hidden cataloger reference PLN untuk standar naming, terminology, dan classification. |
| `Katalog MARA (01-2026).xlsx` | Hidden SAP MARA reference untuk lookup/validasi/extend material. |
| `ABC ANALISIS 2020-2022 Signed.pdf` | Referensi konsep Material Cadang/ABC analysis. |
| `Buku Perhitungan Standard Jumlah Mat Cadang Trans.pdf` | Referensi rumus dan kebijakan Material Cadang. |
| `TEMPLATE_IMPORT_MATERIAL_CADANG.xlsx` | Salinan template Material Cadang di folder data tester. |

Jangan auto-import seluruh MARA ke Master Katalog WARNOTO.

---

## 4. Status Fitur Terakhir

### Material Cadang

- Spec lengkap ada di `MATERIAL_CADANG_SPEC.md`.
- Template upload sudah dibuat: `TEMPLATE_IMPORT_MATERIAL_CADANG.xlsx`.
- Scope v1 khusus `jenisBarang === "Cadang"`.
- Apply rekomendasi ke `minQty` harus melalui approval Asman.
- Hidden reference:
  - `CATALOG MASTER.xlsx`;
  - `Katalog MARA (01-2026).xlsx`.

### WA AI Agent

- Spec lengkap ada di `WA_AI_AGENT_SPEC.md`.
- Platform: WhatsApp Cloud API.
- Runtime: Supabase Edge Function `whatsapp-webhook`.
- V1 read-only.
- Akses via whitelist nomor WA.
- Status terakhir:
  - Meta App `Warnoto BOT` sudah dibuat.
  - Phone Number ID, WhatsApp Business Account ID, App ID, dan App Secret sudah didapat user.
  - Callback URL target: `https://tadxodrzoquugnsyejld.supabase.co/functions/v1/whatsapp-webhook`.
  - Verify token: `warnoto-wa-verify-2026`.
  - Endpoint terakhir masih `404 Requested function was not found`, artinya function belum deploy.

### Migrasi Stok SAP/Non-SAP + TUG-15

- Planning ada di `WARNOTO_DOCS.md` bagian 20.
- SAP diproses dari XLSX baku.
- Non-SAP masuk staging cleansing dan review Admin + TL.
- Non-SAP yang tidak match SAP/MARA masuk `HOLD_NON_SAP` dan tidak aktif.
- Histori migrasi TUG-15 disimpan terpisah:
  - state: `migratedTug15History`;
  - storage key: `pln_migrated_tug15_v1`.
- TUG-15 menampilkan sumber `MIGRASI` dan `WARNOTO`.
- Histori migrasi belum dipakai forecast sampai divalidasi Admin.

---

## 5. Instruksi Setup WA Besok

Jalankan dari root project:

```powershell
cd "D:\CLAUDE\WARNOTO CODE\warnoto-project"
npx supabase login
npx supabase link --project-ref tadxodrzoquugnsyejld
npx supabase secrets set WHATSAPP_VERIFY_TOKEN=warnoto-wa-verify-2026
npx supabase secrets set WHATSAPP_PHONE_NUMBER_ID=<PHONE_NUMBER_ID_DARI_META>
npx supabase secrets set WHATSAPP_ACCESS_TOKEN=<ACCESS_TOKEN_DARI_META>
npx supabase secrets set GROQ_API_KEY=<GROQ_API_KEY>
npx supabase secrets set COHERE_API_KEY=<COHERE_API_KEY>
npx supabase functions deploy whatsapp-webhook --no-verify-jwt
```

Test endpoint:

```powershell
Invoke-WebRequest -Uri "https://tadxodrzoquugnsyejld.supabase.co/functions/v1/whatsapp-webhook?hub.mode=subscribe&hub.verify_token=warnoto-wa-verify-2026&hub.challenge=TEST_OK" -UseBasicParsing
```

Expected body:

```text
TEST_OK
```

Jika sudah `TEST_OK`, isi Meta `Configure Webhooks`:

```text
Callback URL: https://tadxodrzoquugnsyejld.supabase.co/functions/v1/whatsapp-webhook
Verify token: warnoto-wa-verify-2026
```

---

## 6. Catatan Teknis Penting

- Jangan masukkan secret asli ke repo.
- `.env` tidak ikut git; `.env.example` hanya placeholder.
- `supabase/functions/` saat ini berisi skeleton WA webhook.
- Jika mengubah JSX besar, jalankan build atau cek error Vite/Babel karena beberapa sesi sebelumnya pernah terkena tag JSX tidak seimbang.
- Jangan mengganti data seed sensitif tanpa preview/audit, terutama katalog/stok.
- Untuk migrasi data stok, wajib backup JSON full + XLSX report sebelum replace.

---

## 7. Command Verifikasi

```powershell
npm run build
```

Jika hanya update dokumentasi/template, build tidak wajib, tetapi tetap disarankan sebelum implementasi kode besar.
