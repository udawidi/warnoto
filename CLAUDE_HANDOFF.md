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
6. `GUDANG_CAPACITY_SPEC.md`
7. `supabase/schema.sql`
8. `supabase/functions/whatsapp-webhook/index.ts`

Jika konteks terlalu besar, mulai dari:

1. `README.md`
2. `WARNOTO_DOCS.md` bagian 18, 19, 20, 22, dan 23
3. Spec fitur yang sedang dikerjakan

---

## 2. File Project Utama

| File | Fungsi |
| --- | --- |
| `App.jsx` | Aplikasi WARNOTO utama, single-file React. |
| `WARNOTO_DOCS.md` | Dokumentasi status, roadmap, keputusan lintas sesi, dan planning migrasi stok/TUG-15. |
| `MATERIAL_CADANG_SPEC.md` | Spec mandiri fitur Material Cadang. |
| `WA_AI_AGENT_SPEC.md` | Spec mandiri integrasi AI Agent ke WhatsApp Cloud API. |
| `GUDANG_CAPACITY_SPEC.md` | Spec mandiri fitur Monitoring Kapasitas Gudang. |
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
| `KAPASITAS GUDANG UIT JBM.xlsx` | Laporan rutin kapasitas gudang UIT JBM untuk fitur Monitoring Kapasitas Gudang. |
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

### Monitoring Kapasitas Gudang

- Spec lengkap ada di `GUDANG_CAPACITY_SPEC.md`.
- Sumber awal: `KAPASITAS GUDANG UIT JBM.xlsx`.
- Ukuran utama: luas m2, bukan `lokasi.kapasitas` existing.
- Grain v1: `UPT x Gudang x Sub Gudang`.
- Data awal masuk lewat Import UI Review, bukan hardcoded seed.
- Storage utama: Supabase table `warehouse_capacity`, fallback local/CLOUD `pln_gudang_capacity_v1`.
- Mapping ke Peta Gudang memakai auto-suggest + konfirmasi manual Admin/TL.
- Status kapasitas:
  - `KRITIS` jika pemakaian >= 90%;
  - `WASPADA` jika 75% sampai < 90%;
  - `AMAN` jika < 75%.
- Sheet `ALAT ANGKAT ANGKUT` tidak masuk v1.

### Alat Berat / Alat Angkat Angkut

- Implementasi kode sudah masuk di `App.jsx`.
- Menu sidebar: `Alat Berat`.
- Komponen aktif yang dirender menu adalah `HeavyEquipmentTabV2`; `HeavyEquipmentTab` lama masih tersisa sebagai legacy pembanding dan belum dirender.
- Seed awal memakai 51 record dari sheet `ALAT ANGKAT ANGKUT` pada `KAPASITAS GUDANG UIT JBM.xlsx`.
- Fitur:
  - list alat multi-UPT;
  - status kelayakan alat;
  - status tersedia/dipinjam;
  - upload foto alat oleh Admin/TL;
  - peminjaman alat antar UPT dengan `requesterUpt`, `ownerUpt`, `namaPekerjaan`, `tanggalAmbil`, dan `tanggalKembali`;
  - approval/reject oleh Asman UPT pemilik alat;
  - status `PENDING_OWNER_ASMAN`, `DIPINJAM`, `OVERDUE`, `SELESAI`, `REJECTED`;
  - reminder overdue di dashboard/menu jika melewati tanggal kembali;
  - tombol tandai alat sudah kembali;
  - tab histori peminjaman dengan filter UPT pemilik, UPT peminjam, alat, status, dan rentang tanggal;
  - ringkasan Alat Berat di dashboard default, Asman, dan Manager.
- Storage fallback:
  - `pln_heavy_equipment_v1`;
  - `pln_heavy_equipment_loans_v1`.
- Belum dibuat dokumen cetak/form resmi peminjaman alat.
- Histori v1 tidak memakai state baru; dibaca dari `heavyEquipmentLoans`.
- Catatan: jika data user sudah punya field `upt`, `uptName`, `uptKode`, atau `uptId`, approve Asman dibatasi ke UPT pemilik alat. Jika field UPT user masih kosong, Asman tetap bisa approve agar fitur berjalan.

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
- Untuk fitur Kapasitas Gudang, jangan mengubah makna field `lokasi.kapasitas`; kapasitas luas m2 harus memakai dataset terpisah.

---

## 7. Command Verifikasi

```powershell
npm run build
```

Jika hanya update dokumentasi/template, build tidak wajib, tetapi tetap disarankan sebelum implementasi kode besar.

---

## 8. Prompt Pembuka untuk Claude

Gunakan prompt ini saat project dipindahkan ke Claude:

```text
Baca `CLAUDE_HANDOFF.md` dulu sebagai pintu masuk, lalu baca `README.md` dan `WARNOTO_DOCS.md`.

Project WARNOTO adalah single-file React app di `App.jsx`. Jangan refactor besar dulu. Pertahankan data seed sensitif dan jangan overwrite katalog/stok tanpa preview + backup.

Status terakhir:
- Material Cadang: spec/template siap, implementasi kode belum dimulai.
- WA AI Agent: spec siap, WhatsApp Cloud API akan memakai Supabase Edge Function `whatsapp-webhook`; function belum deploy.
- Migrasi Stok SAP/Non-SAP + TUG-15: planning final di `WARNOTO_DOCS.md` bagian 20.
- Monitoring Kapasitas Gudang: spec siap di `GUDANG_CAPACITY_SPEC.md`; implementasi kode belum dimulai.
- Alat Berat: kode sudah diimplementasikan di `App.jsx`; baca `WARNOTO_DOCS.md` bagian 23 sebelum mengubah.

Untuk Alat Berat, pertahankan flow:
- Admin/TL UPT peminjam mengajukan pinjam alat ke UPT pemilik.
- Asman UPT pemilik approve/reject.
- Status loan: `PENDING_OWNER_ASMAN`, `DIPINJAM`, `OVERDUE`, `SELESAI`, `REJECTED`.
- Histori v1 dibaca dari `heavyEquipmentLoans`, bukan state baru.
- Jika profil user belum punya binding UPT, Asman tetap bisa approve sebagai fallback.

Sebelum final, jalankan `npm run build`.
```
