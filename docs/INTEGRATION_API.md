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

## Catatan integrasi SAP

Endpoint sengaja publik tanpa sesi Supabase Auth (SAP tidak punya akun WARNOTO)
— seluruh autentikasi & otorisasi lewat API-key + scope di atas. Field response
sudah dipetakan ke penamaan SAP-friendly (`nomorMaterial` = nomor material SAP
di `katalog.data.katalog`, kalau kosong berarti barang belum di-link ke SAP).
