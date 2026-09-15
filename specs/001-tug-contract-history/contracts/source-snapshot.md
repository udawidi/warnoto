# Source Lot Contracts

RPC canonical publik tetap: `tug_create_transaction(jsonb,jsonb,uuid)`, `tug_amend(uuid,integer,jsonb,jsonb,uuid)`, dan `tug_decide(...)`. `stockItems[].stockId` tetap identitas lot yang dikurangi.

Respons canonical menambahkan snapshot immutable:

```json
{
  "lotKey": "TUG3|upt|lokasi|katalog|pt-a|sp-001",
  "sourceKind": "TUG3_CONTRACT",
  "contracts": [{"docNo":"001.TUG-3/...","supplier":"PT A","noKontrak":"SP-001"}],
  "provenance": "CREATE"
}
```

Client tidak boleh mengirim atau menimpa snapshot tersebut.

RPC baru (proposal, belum diterapkan):

```sql
tug_split_stock_source_lots(
  p_stock_id text,
  p_expected_qty numeric,
  p_allocations jsonb,
  p_idempotency_key text
) returns jsonb
```

Hanya TL pada UPT pemilik stok atau SUPERADMIN. RPC mengunci baris asal, memvalidasi total/keys/qty, mengarsipkan saldo gabungan, membuat lot hasil, dan aman di-retry memakai idempotency key.
