# Implementation plan

1. Buat helper scoped Form 5S dan wrapper `Form5SPage` yang menampilkan summary UIT/Pusat serta memakai `Form5STab` untuk UPT aktif.
2. Tambahkan nav alias `maturity5s`, render top-level, dan hapus branch/subtab 5S dari Maturity.
3. Perketat cache fallback, mapping sync, filter history, upload request, dan gudang berdasarkan ID.
4. Tambahkan `download-5s-photo` di `maturity-drive`, client blob helper, lazy history photo, dan print persisted history.
5. Perbarui builder PDF agar master UPT/ASMAN canonical dan filename/title beridentitas record.
6. Tambahkan migration trigger + schema mirror + verifier SQL; tidak dijalankan ke production oleh implementasi ini.
7. Tambah contract/unit/E2E tests, jalankan graphify, tests, build, dan diff-check.

## Public interfaces

- Nav item `{ id: "maturity5s", permissionKey: "menu.maturity" }`.
- Client `downloadForm5SPhoto(assessmentId, photoIndex)` mengembalikan `{ blob, fileName, mime }`.
- Edge action `download-5s-photo` menerima JSON hanya `{ action, assessmentId, photoIndex }`.
- Migration menambah trigger pada `maturity_5s_assessments`; tidak mengubah payload checklist.
