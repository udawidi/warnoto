# Contract: `public_block_stock`

## Request

```json
{
  "p_lokasi_id": "LOKASI-ID",
  "p_token": "uuid-token"
}
```

## Success

```json
{
  "upt": "UPT Surabaya",
  "gudang": "Gudang Ketintang",
  "subgudang": "Area A",
  "blok": "RAK-A",
  "materials": [
    {
      "katalog": "12345678",
      "nama": "Nama material",
      "satuan": "BH",
      "qty": 4,
      "sapLabel": "SAP — Persediaan",
      "jenisBarang": "Persediaan"
    }
  ]
}
```

## Invalid token or unknown location

```json
null
```

## Invariants

- Respons tidak pernah mengembalikan token.
- Hanya material dengan total kuantitas positif yang dikembalikan.
- Kuantitas dijumlahkan per katalog, label SAP, dan jenis material.
- Fungsi tetap baca-saja dan tersedia hanya untuk `anon` serta `authenticated`.
