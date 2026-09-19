# Form 5S Mandiri dan Scope UPT

**Status:** Approved for implementation  
**Feature:** `maturity5s` top-level sidebar + scoped history/evidence/PDF

## Tujuan

Form Pengisian 5S dipisahkan dari Penilaian Maturity tanpa menggandakan state atau alur penyimpanan. Data dan foto tetap canonical di Supabase self-host, dengan batas akses berbasis `upt_id`.

## Acceptance criteria

- Menu `Form Pengisian 5S` muncul di sidebar tepat di bawah `Penilaian Maturity`; subtab 5S tidak muncul di Maturity.
- UPT hanya melihat dan menulis record Form 5S dengan `upt_id` sendiri.
- UIT melihat seluruh UPT pada `uit_id` sendiri, termasuk baris UPT tanpa data; Pusat melihat nasional. UIT/Pusat read-only.
- Cache fallback hanya menampilkan record dengan `upt_id` yang masuk scope.
- Gudang, history, detail, dan PDF memakai `upt_id` canonical.
- Foto history dimuat lazy melalui action `download-5s-photo(assessmentId, photoIndex)`; action menolak path/ID file bebas dan memeriksa scope.
- Upload baru menyimpan Drive metadata dan object private bucket `maturity-evidence`; legacy boleh fallback Drive sampai backfill selesai.
- PDF hanya berasal dari record tersimpan; nama UPT berasal dari master melalui `upt_id`, dengan fallback nama tersimpan hanya untuk legacy.
- Trigger insert Form 5S menolak foto kosong, path salah, status bukan `BACKUP_RECORDED`, atau object self-host hilang.
- Verifier SQL membuktikan RLS/helper, trigger valid-invalid, dan jumlah object self-host yang hilang tanpa mutasi permanen.

## Batasan

Tidak ada dependency baru, tidak ada penghapusan data lama, tidak ada perubahan format checklist, tidak ada deploy/eksekusi migration produksi pada fase implementasi ini.
