# Data Model

## Stock Opname additions in existing JSON

```js
{
  uptId: string | null,
  documentMeta: {
    version: 1,
    tanggal: "YYYY-MM-DD",
    pidRefs: string[],
    examiners: [
      { userId: string | null, name: string, position: string, uptId: string | null }
    ],
    manager: { userId: string, name: string, position: string, uptId: string },
    savedAt: string,
    savedBy: string
  }
}
```

## Validation

- `uptId` harus tunggal setelah membandingkan sumber opname, gudang, dan pembuat.
- `manager` harus tepat satu profil ber-role `MANAGER` pada UPT.
- `examiners` maksimal tiga, nama dan jabatan wajib, serta tidak duplikat.
- `pidRefs` dinormalisasi dari input manual dan nilai kosong dibuang.
- `documentMeta` lama hanya dipakai bila `version === 1` dan tetap divalidasi saat cetak.
