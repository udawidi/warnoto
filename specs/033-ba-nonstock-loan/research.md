# Research: BA Pengeluaran Material Non Stock dan Pinjam

## Modul persistence

**Decision**: Gunakan tabel dan RPC khusus BA, bukan `tug_transactions` atau `tug_workflow_transactions`.

**Rationale**: Canonical TUG-8/9 terikat stok dan source lot. Generic workflow memiliki allowlist, numbering, dan transition untuk TUG-5/7/8/9. Modul terpisah memberi diff lebih kecil dan mencegah BA masuk mutasi stok.

**Alternatives considered**: Menambah doc type ke canonical TUG ditolak karena berisiko menjalankan aturan stok; memperluas workflow generic ditolak karena menyentuh fungsi lintas TUG yang sudah stabil.

## Bentuk data

**Decision**: Header typed, item child typed, snapshot penandatangan JSONB.

**Rationale**: Constraint qty, urutan item, status, uniqueness nomor, dan audit dapat ditegakkan database; snapshot fleksibel tetapi tetap immutable setelah final.

**Alternatives considered**: Satu blob JSONB lebih singkat, tetapi validasi item dan concurrency approval lebih lemah.

## Penomoran

**Decision**: Counter khusus `(upt_id, year)` dikunci dalam RPC approval final.

**Rationale**: User memilih reset tahunan per UPT. Counter TUG existing global per UPT dan tidak reset tahunan.

**Alternatives considered**: `max(sequence)+1` rawan race; counter TUG existing menghasilkan seri yang salah.

## Foto

**Decision**: Reuse compressor dan bucket `tug-photos`, prefix `ba-non-stock/<id>/`, dua filename tetap.

**Rationale**: Tidak ada identitas privat; pola storage sudah tersedia. RPC final memeriksa path dan object nyata.

**Alternatives considered**: Bucket baru tidak diperlukan; base64 database dilarang karena ukuran dan sinkronisasi.

## Dokumen

**Decision**: Builder HTML A4 existing, bukan menghasilkan DOCX.

**Rationale**: Seluruh TUG memakai preview iframe dan browser Print/Save PDF. Contoh DOCX menjadi referensi isi dan layout.

**Alternatives considered**: DOCX baru menambah dependency dan jalur output yang tidak konsisten.
