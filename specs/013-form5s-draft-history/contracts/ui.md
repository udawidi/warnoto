# UI contract

- `Simpan Draft` stores meaningful partial input and reports success/failure.
- One `Tambah Foto` control opens `Kamera` and `Galeri` actions; both actions are at least 44 px high.
- A history row always exposes `Detail Audit` and `Cetak / PDF`.
- `Detail Audit` is the only action that mounts full checklist, notes, and photo loading.
- Closing detail revokes temporary photo URLs.
