# Data Model

## `stocks.data.sourceLot`

```json
{
  "key": "TUG3|upt|lokasi|katalog|supplier|contract",
  "kind": "TUG3_CONTRACT",
  "supplier": "PT A",
  "contractNo": "SP-001",
  "sourceDocumentNo": "001.TUG-3/...",
  "sourceDate": 1787492950009,
  "sourceTransactionId": "uuid",
  "sourceItemIndex": 0,
  "status": "ACTIVE"
}
```

`kind`: `TUG3_CONTRACT`, `TUG10_RETURN`, `SAP_MIGRATION`, atau `INITIAL_STOCK`. `key` immutable dan unik secara logis dalam katalog/lokasi.

## Legacy state

Baris tanpa `sourceLot` dan lebih dari satu referensi kontrak diperlakukan sebagai `NEEDS_SOURCE_ALLOCATION`. Setelah split, qty baris asal menjadi 0 dan `sourceLotSplit` menyimpan idempotency key serta ID lot hasil. Baris hasil menyalin identitas katalog/lokasi dan masing-masing memiliki satu sumber.

## TUG Item Source Snapshot

`tug_items.source_snapshot` menyimpan `{lotKey, sourceKind, contracts, sourceDocumentNo, provenance}`. Nilai diturunkan database dari `stock_id` saat create/amend dan immutable untuk histori.

## Allocation RPC Input

`tug_split_stock_source_lots(stock_id text, expected_qty numeric, allocations jsonb, idempotency_key text)` menerima allocation dengan `qty`, `key`, `kind`, dan metadata sumber. Qty harus positif, key unik, total tepat sama dengan qty terkunci.
