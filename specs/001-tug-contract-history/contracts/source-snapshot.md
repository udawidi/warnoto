# Source Snapshot Contract

RPC publik tidak berubah. `tug_create_transaction(jsonb,jsonb,uuid)` dan `tug_amend(uuid,integer,jsonb,jsonb,uuid)` tetap menerima payload lama.

Respons pembacaan canonical menambahkan `sourceSnapshot` pada setiap `stockItems[]`:

```json
{
  "sourceKind": "TUG3_CONTRACT",
  "contracts": [{ "docNo": "198.TUG-3/...", "supplier": "PT. PERSADA INDAH MUDA", "noKontrak": "PENGGANTIAN ISOLATOR KERAMIK", "tglMasuk": 1787492950009 }],
  "provenance": "CREATE"
}
```

Client tidak boleh mengirim atau menimpa nilai ini. Snapshot kosong hanya diizinkan selama migrasi belum diterapkan.
