# Feature Specification: Penilaian Matlev Dua Jenis Gudang

**Feature Branch**: `003-matlev-dual-warehouse`  
**Created**: 2026-09-14  
**Status**: Approved for implementation  
**Input**: Pisahkan penilaian Matlev untuk Gudang Persediaan dan Gudang ATTB/MRWI berdasarkan sheet PROGNOSA, sesuaikan kebutuhan evidence/catatan, serta hapus Mode Demo TUG dan Sinkronkan Drive yang tidak lagi dipakai.

## User Scenarios & Testing

### User Story 1 - Menilai dua jenis gudang secara terpisah (Priority: P1)

Petugas memilih Gudang Persediaan atau Gudang ATTB/MRWI, mengisi nilai dan evidence hanya untuk aspek yang berlaku, lalu melihat subtotal masing-masing dan nilai gabungan.

**Independent Test**: Buat audit baru, isi aspek yang sama pada kedua tab dengan nilai/evidence berbeda, muat ulang, dan pastikan keduanya tetap terpisah.

**Acceptance Scenarios**:

1. **Given** audit aktif, **When** pengguna memilih Gudang Persediaan, **Then** hanya 28 aspek yang berlaku ditampilkan.
2. **Given** audit aktif, **When** pengguna memilih Gudang ATTB/MRWI, **Then** hanya 8 aspek yang berlaku ditampilkan.
3. **Given** aspek bersama 3.4, 4.3, 4.4, atau 5.2, **When** nilai/evidence diisi pada kedua jenis gudang, **Then** data tersimpan terpisah.
4. **Given** semua nilai terisi, **When** ringkasan dihitung, **Then** nilai gabungan memakai bobot Persediaan 75% dan ATTB/MRWI 25%.

### User Story 2 - Membuka audit lama tanpa kehilangan data (Priority: P2)

Petugas membuka audit format lama dan aplikasi menormalkannya otomatis tanpa migrasi database massal.

**Independent Test**: Muat fixture audit lama; aspek eksklusif masuk ke gudang yang sesuai dan aspek bersama masuk ke Persediaan saja.

**Acceptance Scenarios**:

1. **Given** audit lama, **When** dibuka, **Then** aspek eksklusif dipetakan ke satu-satunya jenis gudang yang berlaku.
2. **Given** evidence lama pada aspek bersama, **When** dibuka, **Then** evidence hanya muncul pada Gudang Persediaan.
3. **Given** audit aktif format lama, **When** pengguna melakukan perubahan sah, **Then** data berikutnya tersimpan sebagai format versi 2.
4. **Given** audit FINAL format lama, **When** hanya dilihat, **Then** audit tetap read-only dan tidak ditulis ulang.

### User Story 3 - Menggunakan alur produksi tanpa kontrol mati (Priority: P2)

Pengguna tidak lagi melihat Mode Demo TUG atau Sinkronkan Drive. Upload, lihat, unduh, dan lepas evidence tetap berjalan dari aplikasi.

**Independent Test**: Cari kedua kontrol di UI, pastikan tidak ada; unggah dan buka evidence melalui alur aplikasi.

**Acceptance Scenarios**:

1. **Given** aplikasi dibuka, **When** menu profil dibuka, **Then** Mode Demo TUG dan banner demo tidak ada.
2. **Given** halaman audit dibuka, **When** pengguna mengelola evidence, **Then** tidak ada tombol Sinkronkan Drive atau panel file belum terpasang.
3. **Given** flag demo lama tersimpan di browser, **When** aplikasi dimulai, **Then** flag dibersihkan dan alur simpan produksi tidak terblokir.

## Requirements

### Functional Requirements

- **FR-001**: Sistem MUST mempertahankan satu audit per UPT, tahun, dan semester.
- **FR-002**: Sistem MUST menyimpan data audit versi 2 dalam `warehouseAssessments.PERSEDIAAN` dan `warehouseAssessments.ATTB_MRWI`.
- **FR-003**: Setiap bagian gudang MUST memiliki `aspekScores`, `evidence`, dan `aiAnalysis` sendiri.
- **FR-004**: Sistem MUST menandai penerapan aspek dari kolom V untuk Persediaan dan kolom X untuk ATTB/MRWI pada sheet PROGNOSA; nilai `N/A` berarti tidak dinilai.
- **FR-005**: Pemetaan MUST menghasilkan 28 aspek Persediaan dan 8 aspek ATTB/MRWI; aspek bersama adalah 3.4, 4.3, 4.4, dan 5.2.
- **FR-006**: Kebutuhan evidence MUST mengikuti kolom J dan catatan evidence MUST mengikuti kolom K, tanpa mengubah judul aspek atau rubrik level yang sudah dipakai aplikasi.
- **FR-007**: Catatan kosong pada sumber MUST tetap kosong dan tidak boleh diisi dengan teks buatan.
- **FR-008**: Nilai per jenis gudang MUST hanya menghitung aspek/kategori yang berlaku; nilai gabungan MUST memakai `(Persediaan × 75%) + (ATTB/MRWI × 25%)`.
- **FR-009**: Evidence, review, dan analisis AI MUST memakai identitas gabungan jenis gudang dan ID aspek agar aspek bersama tidak bercampur.
- **FR-010**: Evidence lama pada aspek bersama MUST dipetakan ke Persediaan saja; aspek eksklusif MUST dipetakan ke jenis gudang tunggalnya.
- **FR-011**: Audit lama MUST dinormalisasi saat dibaca; audit aktif MUST dipersistenkan ke versi 2 pada perubahan normal berikutnya, sedangkan audit FINAL tidak boleh dimutasi hanya karena dilihat.
- **FR-012**: Evidence 5S otomatis untuk aspek 4.5 MUST hanya masuk ke Gudang Persediaan.
- **FR-013**: UI MUST menyediakan dua tab ramah sentuh untuk Persediaan dan ATTB/MRWI serta tetap dapat digunakan pada layar 360 px tanpa overflow halaman.
- **FR-014**: Ringkasan dan export PDF/PPT/Excel MUST membedakan kedua jenis gudang dan menampilkan nilai gabungan.
- **FR-015**: Export template Excel MUST menulis skor Persediaan ke kolom X dan ATTB/MRWI ke kolom Y tanpa menimpa formula atau sel N/A.
- **FR-016**: Menu Mode Demo TUG, banner demo, dan seluruh guard demo produksi MUST dihapus; flag `warnoto_demo` lama MUST dibersihkan saat aplikasi dimulai.
- **FR-017**: Tombol Sinkronkan Drive, pemindaian manual, dan panel assignment file MUST dihapus, tetapi upload/load/open/download/unlink/backfill evidence dari aplikasi MUST tetap berfungsi.
- **FR-018**: Perubahan MUST tidak memerlukan schema database, RLS, dependency, atau deployment Edge Function baru.
- **FR-019**: Teks evidence dari PROGNOSA MUST ditampilkan dalam format ringkas dan terstruktur. Kriteria isi yang masih berada dalam satu dokumen MUST menjadi `manualCriteria` display-only untuk checker, bukan field status, review row, atau folder tambahan.
- **FR-020**: Hanya sub-evidence yang membutuhkan dokumen/artefak terpisah MUST menjadi evidence item normal dengan folder, upload, review, dan gate sendiri. Implementasi mencakup 10 item dokumen terpisah.
- **FR-021**: Kriteria manual MUST berjumlah 19 kriteria display-only: 1.8, 2.3, 3.4, 3.5, dan 5.2. Kriteria ini diperiksa langsung dari dokumen utama oleh checker dan tidak memiliki status tersimpan.
- **FR-022**: Pengajuan dan finalisasi MUST memvalidasi minimal satu file pada setiap evidence item normal, review UIT yang masih current, serta Form 5S yang berlaku. Kriteria manual tidak memiliki status pengisian tersimpan.
- **FR-023**: Jalur 2.5 MUST mendukung salah satu dari dua artefak yang disyaratkan (ND/Surat kegiatan atau foto kegiatan); keduanya tidak wajib sekaligus.
- **FR-024**: Alias legacy dan item legacy MUST hanya dibaca/dinormalisasi untuk kompatibilitas. Tidak boleh membuat folder anak atau menghidupkan kembali status evidence anak.
- **FR-025**: AI MUST menerima definisi `manualCriteria` sebagai metadata panduan checker, tanpa mengubah status, menandai terpenuhi, atau menggantikan verifikasi manual.

### Key Entities

- **Maturity Audit**: Rekaman audit UPT/periode dengan status workflow dan nilai gabungan.
- **Warehouse Assessment**: Nilai, evidence, dan analisis untuk satu jenis gudang dalam audit.
- **Typed Aspect ID**: Identitas wire `${warehouseType}::${aspectId}` untuk evidence dan review.
- **Audit Aspect**: Definisi aspek, penerapan gudang, evidence yang dibutuhkan, catatan, dan rubrik existing.

## Success Criteria

- **SC-001**: Audit baru menampilkan tepat 28 aspek Persediaan dan 8 aspek ATTB/MRWI.
- **SC-002**: Empat aspek bersama dapat menyimpan dua nilai dan dua kumpulan evidence tanpa kontaminasi silang.
- **SC-003**: Perhitungan contoh sumber menghasilkan Persediaan 4.506666667, ATTB/MRWI 3.333333333, dan gabungan 4.213333333 dalam toleransi pembulatan UI.
- **SC-004**: Audit lama tetap dapat dibuka; seluruh data lama terpetakan tanpa hilang.
- **SC-005**: Mode Demo TUG dan Sinkronkan Drive tidak muncul di desktop maupun mobile.
- **SC-006**: Build, unit/contract test relevan, dan smoke test browser desktop/mobile lulus.

## Assumptions

- Kolom X pada workbook sumber adalah penilaian Gudang ATTB/MRWI walau deskripsi awal pengguna sempat menyebut kolom V dan X.
- Template export existing tetap dipakai; hanya nilai pada kolom X/Y yang dipisahkan.
- Server action sinkronisasi lama dibiarkan untuk kompatibilitas, tetapi tidak dipanggil UI baru.
