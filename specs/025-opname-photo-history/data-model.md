# Data Model

## `stocks.data.photoHistory`

```js
[{ id, source: "OPNAME"|"MANUAL", sourceId, uptId, at, semester, status,
   before: { fotoKeseluruhan?, fotoNameplate? },
   after: { fotoKeseluruhan?, fotoNameplate? } }]
```

`stock_opname.data.items` tetap menjadi sumber seluruh foto sesi. Foto utama pada stock hanya pointer URL terbaru.

## Embeddings

`stock_photo_embeddings.upt_id` adalah canonical tenant key. `upt` lama tetap untuk kompatibilitas rollout. ID embedding opname mencakup UPT, sesi, item, dan jenis foto.

## Mapping

Exact `item.stockId` wajib memiliki UPT sama. Fallback `katalogId` hanya boleh jika tepat satu kandidat dalam UPT sesi. Mismatch/ambigu/missing tidak dipromosikan.
