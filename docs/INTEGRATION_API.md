# WARNOTO Integration API (Fase 1 — READ)

API-key ter-scope untuk aplikasi pihak ketiga (khususnya SAP S/4HANA) membaca
data WARNOTO. Fase 1 hanya endpoint READ; Fase berikutnya (belum dibangun)
akan menambah WRITE.

## Base URL

```
https://warnoto.com/functions/v1/integration-api
```

(self-host, path Edge Function standar Supabase — `functions/v1/<nama-function>`)

## Autentikasi

Kirim API key lewat salah satu header:

```
Authorization: Bearer wrn_live_xxxxxxxxxxxxxxxx
```
atau
```
x-api-key: wrn_live_xxxxxxxxxxxxxxxx
```

Key dibuat lewat menu **Integrasi API** di WARNOTO (Admin only). Plaintext key
hanya ditampilkan **sekali** saat dibuat — simpan segera, tidak bisa dilihat
ulang. Key bisa dicabut kapan saja dari menu yang sama; setelah dicabut,
semua request dengan key itu langsung ditolak (401).

## Scope

Tiap key hanya boleh mengakses endpoint sesuai scope yang diberikan saat
dibuat:

| Scope | Endpoint |
| --- | --- |
| `read:stock` | `GET /stock` |
| `read:catalog` | `GET /catalog` |
| `read:tug` | `GET /tug` |

Request tanpa scope yang sesuai dibalas `403`.

## Rate limit

Default 120 request/menit per key (bisa disesuaikan per key). Melebihi limit
dibalas `429`.

## Endpoint

### `GET /stock`

Qty stok terkini per material (dijumlah dari semua lokasi).

```bash
curl -H "Authorization: Bearer wrn_live_xxxx" \
  "https://warnoto.com/functions/v1/integration-api/stock?limit=100"
```

```json
{
  "ok": true,
  "stock": [
    { "katalogId": "KAT-1060011", "nama": "Kabel NYY 4x10mm", "nomorMaterial": "1060011", "satuan": "M", "qty": 250, "updatedAt": "2026-08-17T02:00:00Z" }
  ]
}
```

### `GET /catalog`

Master katalog barang.

```bash
curl -H "x-api-key: wrn_live_xxxx" \
  "https://warnoto.com/functions/v1/integration-api/catalog?limit=100"
```

```json
{
  "ok": true,
  "catalog": [
    { "katalogId": "KAT-1060011", "nama": "Kabel NYY 4x10mm", "nomorMaterial": "1060011", "satuan": "M", "jenisBarang": "Persediaan" }
  ]
}
```

### `GET /tug`

Riwayat mutasi stok (dokumen TUG), terbaru dulu.

```bash
curl -H "Authorization: Bearer wrn_live_xxxx" \
  "https://warnoto.com/functions/v1/integration-api/tug?limit=100"
```

```json
{
  "ok": true,
  "tug": [
    { "id": 123, "katalogId": "KAT-1060011", "tanggal": "2026-08-15", "jenisTransaksi": "KELUAR", "qty": 10, "lokasiKode": "GD-A1", "docType": "TUG9", "noBon": "123/TUG9/2026", "catatan": "Pekerjaan JTM Rungkut" }
  ]
}
```

## Parameter umum

- `limit` — jumlah baris maksimal (default 200, hard cap 1000).

## Kode error

| Status | Arti |
| --- | --- |
| 401 | Key tidak dikirim / tidak dikenal / sudah dicabut |
| 403 | Key valid tapi tidak punya scope untuk endpoint ini |
| 404 | Endpoint tidak dikenal |
| 429 | Rate limit terlampaui |
| 500 | Kesalahan server |

## Keamanan & Rotasi

### Kedaluwarsa & IP allowlist

Saat membuat key di menu **Integrasi API**, dua field opsional:

- **Kedaluwarsa** — tanggal setelah itu key otomatis ditolak (401), meski
  belum dicabut manual. Kosongkan untuk key yang tidak pernah kedaluwarsa.
- **IP Diizinkan** — daftar IP (pisah koma) yang boleh pakai key ini; request
  dari IP lain ditolak (403). Kosongkan untuk mengizinkan semua IP. Kalau SAP
  ada di belakang proxy/NAT tetap (mis. IP keluar minipc-gudang), isi field
  ini dengan IP keluar itu untuk mempersempit blast radius kalau key bocor.

Setiap percobaan autentikasi (sukses maupun gagal — 401/403/429) dicatat ke
`integration_request_log` termasuk IP pengirim, jadi anomali (mis. banyak 401
dari IP tak dikenal) bisa dipantau lewat query ke tabel itu.

### Rotasi key tanpa downtime

1. Buat key baru dengan scope yang sama (dan expiry/IP allowlist kalau
   dipakai) lewat menu Integrasi API — plaintext tampil sekali, salin segera.
2. Update konfigurasi SAP (SM59 / credential store) untuk memakai key baru.
   Verifikasi request SAP sukses dengan key baru (cek `last_used_at` di
   daftar key naik).
3. Baru setelah SAP terbukti pakai key baru, cabut key lama dari menu yang
   sama. Selama langkah 1-3, kedua key aktif berdampingan sehingga tidak ada
   jeda gagal autentikasi di sisi SAP.

### Penyimpanan key di sisi SAP

Plaintext key hanya tampil sekali saat dibuat. Simpan di credential store SAP
(mis. SM59 destination dengan secure storage, atau credential store
S/4HANA) — jangan taruh di file konfigurasi plaintext atau kode ABAP yang
ikut ter-commit ke transport.

### Lapisan tambahan (di luar scope kode ini)

Untuk pertahanan berlapis, disarankan IT memasang **Cloudflare Access atau
mTLS** di depan endpoint Edge Function (`warnoto.com/functions/v1/integration-api`)
supaya hanya IP/klien yang dikenal Cloudflare yang bisa mencapai fungsi ini
sama sekali, sebelum request sampai ke pengecekan API-key. Ini konfigurasi
Cloudflare dashboard, bukan perubahan kode.

## Catatan integrasi SAP

Endpoint sengaja publik tanpa sesi Supabase Auth (SAP tidak punya akun WARNOTO)
— seluruh autentikasi & otorisasi lewat API-key + scope di atas. Field response
sudah dipetakan ke penamaan SAP-friendly (`nomorMaterial` = nomor material SAP
di `katalog.data.katalog`, kalau kosong berarti barang belum di-link ke SAP).
