// Snapshot of PROGNOSA columns J/K/V/X used by the maturity audit UI.
// Generated from the approved workbook; no runtime workbook fetch is required.
export const MATLEV_SOURCE = Object.freeze({
  "1.1": {
    "requiredEvidence": "Evidence :\n\n1. Probis Pemeriksaan dan Penerimaan Material Persediaan (flowchart)\n2. Probis Penerimaan Material Sisa Pemakaian / Pengembalian Material dari User (flowchart)\n3. Probis Pengeluaran Material untuk Pemakaian Normal\n4. Probis Pengeluaran Material untuk Pemakaian Emergency\n5. Probis Pemeriksaan Fisik Material (Stock Opname)\n6. Probis Transfer/Mutasi Material Antar Gudang dalam 1 Unit Induk (Intra Company)\n7. Probis Transfer/Mutasi Material Antar Gudang Antar Unit Induk (Inter Company)",
    "catatan": "Note :\n\n1. Eviden harus terpenuhi lengkap untuk level yang ingin dicapai\n2. Dokumen Eviden (Probis) tertanda tangan oleh GM\n3. Menunjukan evidence yang telah dilakukan (batas waktu di dokumen eviden, hingga tanggal pelaksanaan self assessment)\n",
    "persediaan": "4",
    "attbMrwi": "N/A"
  },
  "1.2": {
    "requiredEvidence": "Evidence 1 Cycle (Sampling 2 Material) :\n\n  1. Surat Jalan dari Vendor ke PLN\n  2. Kontrak Material / SPB UPT\n  3. Form PO Material (dari SAP/SMAR) \n  4. Form Pemeriksaan TUG 4 (SAP/SMAR) tertanda tangan pihak terkait\n  5. Form Penerimaan TUG 3 (SAP/SMAR) tertanda tangan pihak terkait\n  6. Kartu Gantung TUG 2\n  7. Foto Material \n",
    "catatan": "Note :\n\n1. Evidence harus terpenuhi lengkap untuk level yang ingin dicapai\n2. Menunjukan evidence yang telah dilakukan (batas waktu di dokumen eviden, hingga tanggal pelaksanaan self assessment)\n3. Apabila yang disampling adalah material non stock yang tidak terdapat TUG secara SMAR/SAP dapat menunjukkan TUG Manual (TUG 3, 4), Bon Pemakaian (TUG 9), PO (SAP) dan Good Receipt (SAP)\n4. Material sampling adalah material pada semester berjalan atau 1 semester sebelumnya",
    "persediaan": "5",
    "attbMrwi": "N/A"
  },
  "1.3": {
    "requiredEvidence": "Eviden :\n\n1. Surat pemberitahuan dari vendor ke gudang PLN terkait terkait rencana pengiriman\n2. Tanda Terima Material / Berita Acara\n",
    "catatan": "Note :\n\n1. sampling material berjumlah 2 dari sampling nomor 1.2\n2. Nilai Level adalah Selisih hari dari Eviden poin 2 dan poin 1\n",
    "persediaan": "4",
    "attbMrwi": "N/A"
  },
  "1.4": {
    "requiredEvidence": "Eviden :\n\n1. Tanda Terima Material\n2. TUG 4",
    "catatan": "Note :\n\n1. Sampling material berjumlah 2 dari sampling nomor 1.2\n2. Nilai Level adalah Selisih hari dari Eviden poin 2 dan poin 1",
    "persediaan": "4",
    "attbMrwi": "N/A"
  },
  "1.5": {
    "requiredEvidence": "Eviden :\n\n1. TUG 3\n2. TUG 2",
    "catatan": "Note :\n\n1. Sampling material berjumlah 2 dari sampling nomor 1.2\n2. Nilai Level adalah Selisih hari dari Eviden poin 2 dan poin 1",
    "persediaan": "5",
    "attbMrwi": "N/A"
  },
  "1.6": {
    "requiredEvidence": "Evidence 1 Cycle (Sampling 2 Material) :\n\n  1. Surat/Form Permintaan/Permohonan Material kepada Manajemen yang membawahi fungsi Logistik\n  2. Kontrak Kerjasama dengan pihak eksternal apabila pihak eksternal yang melakukan permohonan/permintaan\n  3. Form Pemesanan (Reservation Slip) / Work Order (SAP) TTD \n  4. Slip Pengeluaran Barang - 2 / Spare Parts (Pemakaian Reservasi) (SAP) TTD (TUG 9)\n  5. Kartu Gantung TUG 2\n  6. Foto Proses Pengeluaran Material",
    "catatan": "Note :\n\n 1. Evidence harus terpenuhi lengkap untuk level yang ingin dicapai\n 2. Menunjukan evidence yang telah dilakukan (batas waktu di dokumen eviden, hingga tanggal pelaksanaan self assessment)\n 3. Apabila yang disampling adalah material non stock yang tidak terdapat TUG secara SAP dapat menunjukkan TUG Manual (TUG 3, 4), Bon Pemakaian (TUG 9), PO (SAP) dan Good Receipt (SAP)  \n 4. Material sampling adalah material pada semester berjalan atau 1 semester sebelumnya",
    "persediaan": "5",
    "attbMrwi": "N/A"
  },
  "1.7": {
    "requiredEvidence": "Eviden :\n\n1. Surat atau Nota Dinas di AMS atau TUG dari User ke Gudang terkait permohonan/permintaan material\n2. Tanda Terima Pengeluaran Material / Berita Acara",
    "catatan": "Note :\n\n1. Sampling material berjumlah 2 dari sampling nomor 1.6\n2. Nilai Level adalah Selisih hari dari Eviden poin 2 dan poin 1\n3. Sampling Material bukan peruntukan emergency",
    "persediaan": "5",
    "attbMrwi": "N/A"
  },
  "1.8": {
    "requiredEvidence": "Evidence yang memenuhi ketentuan Perdir 687 STK Tata Kelola Gudang, sebagai berikut :\n\n 1. Penyusunan Rak (foto):\n  a. Semua rak ditempatkan melintang di dalam ruangan gudang, berderet-deret kebelakang\n  b. Apabila ruangan gudang cukup memuat lebih dari 1 deret maka antara deretan satu dengan yang lain, harus terdapat lorong yang cukup lebar untuk lalu lintas barang\n \n 2. Penamaan (list material dalam 1 rak)/Penomoran Rak sesuai jenis material (foto)\n 3. Kartu Gantung menempel/menggantung pada material (foto)\n 4. Penempatan Material sesuai penamaan/penomoran Raknya (foto)",
    "catatan": "",
    "persediaan": "5",
    "attbMrwi": "N/A"
  },
  "1.9": {
    "requiredEvidence": "Eviden Kesesuaian Penyimpanan Material dengan Referensi Dokumen :\n\n1. Referensi Dokumen (Softcopy/Hardcoyp) : Manual Book metode penyimpanan / Buku Kajian Umur Maksimum Material Cadang / Proses Bisnis Penyimpanan Material\n2. Foto Penyimpanan Material",
    "catatan": "Note :\n\n1. Sampling material berjumlah 3\n\nLIst Prioritas Penyimpanan Material:\n1. MTU (Material Cadang)\n2. Isolator Polymer\n3. Kabel/Konduktor",
    "persediaan": "4",
    "attbMrwi": "N/A"
  },
  "1.10": {
    "requiredEvidence": "Eviden :\n\n1. Foto Penyimpanan Material sesuai varian/ jenisnya",
    "catatan": "Note :\n\n1. Sampling material berjumlah 3 dari sampling nomor 1.9.\n\nLIst Prioritas Penyimpanan Material:\n1. MTU (Material Cadang)\n2. Isolator Polymer\n3. Kabel/Konduktor",
    "persediaan": "5",
    "attbMrwi": "N/A"
  },
  "2.1": {
    "requiredEvidence": "Evidence :\n\n 1. Undangan / Notulen rapat terkait jadwal pelaksanaan stock opname\n 2. BA stock opname (inventarisasi material) / PID\n 3. Foto zoom atau foto kegiatan stock opname\n 4. a. Jurnal terkait Selisih (dituliskan Nihil apabila tidak ada selisih) dan \n     b. Rekap List of Inventory Differences (dituliskan Nihil apabila tidak ada selisih)",
    "catatan": "Note :\n\n 1. Menunjukan BA Stock Opname terakhir (batas waktu hingga tanggal pelaksanaan self assessment), dan dapat melihat BA Stock Opname 1 semester sebelumnya untuk melihat rutinitas periode waktu semesternya\n 2. Apabila tedapat gudang yang tidak memiliki material Stock maka kegiatan Opname tidak dilakukan (BA Stock Opname tidak perlu dibuat),Namun harus menyampaikan lampiran 5D bulanan dalam periode waktu semester\n 3. Data Stock Opname adalah data pada semester berjalan atau 1 semester sebelumnya",
    "persediaan": "4",
    "attbMrwi": "N/A"
  },
  "2.2": {
    "requiredEvidence": "Evidence :\n\n 1. Undangan Pelaksanaan Pemeriksaan\n 2. Berita Acara Visual Inspeksi MTU yang di tanda tangani HAR dan LOG, selanjutnya di tandatangani Mengetahui Man UPT (terlampir form BA)\n 3. Foto Pelaksanaan Pemeriksaan",
    "catatan": "Note :\n\n 1. Menunjukan BA Visual Inspeksi terakhir (batas waktu hingga tanggal pelaksanaan self assessment), dan dapat melihat BA Visual Inspeksi periode sebelumnya untuk melihat rutinitas periode waktu semester\n 2. Material MTU adalah : PMT, CT, CVT/PT, DS, LA \n 3. Apabila tidak ada material cadang MTU (poin 2) maka menggunakan material lain utk kolaborasi pemeriksaan Log dan HAR (TUG 15)\n 4. Periode MTU yang diinspeksi adalah dalam minimal penyimpanan di gudang 6 bulan",
    "persediaan": "4",
    "attbMrwi": "N/A"
  },
  "2.3": {
    "requiredEvidence": "Evidence :\n\n 1. Struktur Organisasi / Daftar Pengelola Gudang (termasuk foto dari pengelola gudang tersebut) yang di tandatangani oleh Manajer UPT \n \n 2. Struktur Organisasi terupdate = apabila terdapat perubahan personil pengelola gudang, maka harus diupdate\n \n 3. Pengelola Gudang yang menjadi mandatory sebagai berikut:\n  a. Petugas Admin\n  b. Helper Gudang\n  c. Cleaning Service\n  d. Security",
    "catatan": "Note :\n\n 1. 1 (satu) pengelola gudang dapat menjalankan maksimum 2 (dua) pekerjaan (contoh: petugas Admin dapat menjadi Helper Gudang), Kecuali Security\n \n 2. Keseluruhan pengelola dapat menjalankan pekerjaan dalam 1 area/kawasan kantor (tidak dedicated terhadap 1 gudang saja)",
    "persediaan": "5",
    "attbMrwi": "N/A"
  },
  "2.4": {
    "requiredEvidence": "Evidence :\n\nPegawai yang bertugas di Fungsi Logistik minimal 1 (satu) tahun berdasarkan SK/ Surat Penugasan",
    "catatan": "Note :\n\n 1. Sertifikat Diklat PLN berkaitan dengan fungsi Logistik atau\n 2. Sertifikat Pelaksanaan Training/Workshop Logistik dari Eksternal (di Luar PLN) dengan periode waktu belum expired (Periode berlakunya Sertifikat hingga tanggal dilaksanakan self Assessment).",
    "persediaan": "5",
    "attbMrwi": "N/A"
  },
  "2.5": {
    "requiredEvidence": "Evidence :\n\n1. Informasi berupa ND/Surat penyampaian reward kinerja pengelolaan logistik atau \n2. a. Informasi berupa ND/Surat pelaksanaan kegiatan reward  \n    b. Foto Pelaksanaan kegiatan",
    "catatan": "Note :\n\n 1.Kegiatan dapat di inisiasi oleh Unit Induk dengan partisipasi oleh UPT seperti penghargaan atau penyampaian nilai matlev terbaik atau penghargaan guadng terbaik/terapih/terbersih/terinovatif\n\n 2. Kegiatan ini dilakukan dalam periode tahun berjalan atau tahun sebelumnya.",
    "persediaan": "5",
    "attbMrwi": "N/A"
  },
  "3.1": {
    "requiredEvidence": "Evidence merupakan foto dari setiap area:\n 1. Area Loading Dock/Bongkar Muat/Drop Zone\n 2. Area Penerimaan (area karantina merupakan bagian dari area ini)\n 3. Area Pengeluaran\n 4. Area Penyimpanan\n 5. Ruang Administrasi*\n 6. Toilet*",
    "catatan": "Note :\n\n  1. Ruang Admin dan Toilet dapat berada dalam 1 Area/Kawasan Kantor (tidak harus didalam gudang)\n  2. Area gudang diberikan pemisah yang jelas (demarkasi/rantai) dan tagging penamaan\n\n (2) Melihat data pemakaian alat harian (jika ada)",
    "persediaan": "5",
    "attbMrwi": "N/A"
  },
  "3.2": {
    "requiredEvidence": "Evidence, merupakan foto dari :\n\n 1. Forklift \n 2. Handlift\n 3. Trolley\n 4. Crane\n 5. SIA (untuk level 4 dan 5)\n 6. SIO (untuk level 4 dan 5)\n 7. Daftar Alat Kerja Gudang (sebagai lampiran dari Laporan Bulanan)",
    "catatan": "Note :\n\n 1. Apabila Unit melakukan Kontrak Sewa terhadap penggunaan Alat Angkut maka dapat diakomodir (bukan harus kepemilikan PLN) namun tetap memperhatikan Kelayakan Sarana dan sertifikat (SIA & SIO). Batas berlakunya Sertifikat hingga tanggal dilaksanakan self Assessment\n\n2.Tabel Daftar Alat Kerja Gudang untuk lampiran laporan bulanan",
    "persediaan": "5",
    "attbMrwi": "N/A"
  },
  "3.3": {
    "requiredEvidence": "Evidence, merupakan foto dari :\n\n 1. Layout Gudang yang disesuaikan dengan persyaratan per level penilaian\n 2. Ukuran Layout Gudang adalah Minimal A3, apabila tidak seusai ukuran menjadi Level 1",
    "catatan": "Note :\n\n 1. Layout Gudang terupdate = sesuai penggambaran tata letak material kondisi aktual\n \n 2. Area Gudang: \n  a. Area Bongkar Muat/Loading Dock/Drop Zone\n  b. Area Penerimaan\n  c. Area Pengeluaran\n  d. Area Penyimpanan\n  e. Area Pendukung (ruang Admin), apabila terdapat di dalam Gudang maka harus tergambarkan dalam layout\n \n 3. Tanda Tangan MAN UPT",
    "persediaan": "5",
    "attbMrwi": "N/A"
  },
  "3.4": {
    "requiredEvidence": "Evidence, Evaluasi :\n\n1. Notulen rapat evaluasi tata kelola material dengan terdapat pembahasan:\n     a. Kontrak Material (terkait kesesuaian material dengan GI/Gudangnya)\n     b. Rencana area penyimpanan untuk material yang akan datang pada tahun berjalan\n     c. Rencana tindaklanjut dari setiap jenis material di area penyimpanan (rencana keluar material)",
    "catatan": "Note :\n\n1. Unit Induk dapat melakukan atau mengkoordinir pelaksanaan evaluasi pengelolaan logistik (penyimpanan material di gudang sesuai dengan item pada eviden)",
    "persediaan": "5",
    "attbMrwi": "3"
  },
  "3.5": {
    "requiredEvidence": "Evidence (Sampling 3 Material) : \n\n1) TUG 10 / Pengembalian, dimana terinfokan pada TUG tsb:\n     a. Nama material\n     b. Jumlah \n     c. Satuan\n     d. Keterangan: (nama pekerjaan)\n     e. Tanggal Penerimaan//Tanggal Pengembalian:\n     f. Tanggal Pengeluaran TUG 9/Tanggal terakhir Operasi :\n     g. Nama Gudang / SLoc :\n     h. Nama Lokasi Pekerjaan / GI : \n\n     TUG 10 di Tandatangani PIC ULTG dan PIC Gudang UPT\n\n2) BA Penggantian Material dari tim ULTG",
    "catatan": "Note :\n\n1. Apabila pihak yang mengembalikan material adalah vendor, maka tetap harus dilengkapi dengan TUG 10, dikarenakan TUG 10 merupakan bagian lampiran dari STK Pergudangan",
    "persediaan": "N/A",
    "attbMrwi": "3"
  },
  "3.6": {
    "requiredEvidence": "Evidence :\n\n1. Evidence merupakan foto dari setiap cluster:\n     1. Cluster ATTB standby\n     2. Cluster ATTB Perbaikan\n     3. Cluster ATTB Garansi/Asuransi\n     4. Cluster ATTB Usul Hapus\n\n2. Foto Penyimpanan Material berdasarkan cluster\n\n3. Total Sampling 3 Jenis Material berdasarkan clusternya (Sampling 3 jenis material tersebut, dapat dalam 1 cluster yang sama atau cluster yang berbeda-beda)",
    "catatan": "",
    "persediaan": "N/A",
    "attbMrwi": "3"
  },
  "3.7": {
    "requiredEvidence": "Evidence, merupakan foto dari :\n\n 1. Layout Gudang yang disesuaikan dengan persyaratan per level penilaian\n 2. Ukuran Layout Gudang adalah Minimal A3, apabila tidak seusai ukuran menjadi Level 1",
    "catatan": "Note :\n\n 1. Layout harus memenuhi Cluster Gudang: \n    a. Cluster ATTB standby\n    b. Cluster ATTB Perbaikan\n    c. Cluster ATTB Garansi / Asuransi\n    d. Cluster ATTB Usul Hapus\n \n2. Tanda Tangan MAN UPT",
    "persediaan": "N/A",
    "attbMrwi": "3"
  },
  "4.1": {
    "requiredEvidence": "Evidence :\n\n 1. Foto APAR (di Gudang dan di Ruang Admin/Kantor apabila terpisah dengan Gudangnya)\n 2. Foto kelayakan APAR (tanggal APAR belum expired)\n 3. Foto tanda penunjuk posisi APAR \n 4. Level 5 : Foto dari Hydrant, Alarm/Detector dan Foto Pengujian (Alarm/Detector & Hydrant) atau ceklist pemeliharaan \n",
    "catatan": "",
    "persediaan": "5",
    "attbMrwi": "N/A"
  },
  "4.2": {
    "requiredEvidence": "Evidence, Rambu-rambu K3, merupakan foto :\n\n 1. Rambu jalur evakuasi gempa/kebakaran \n 2. Rambu keselamatan kerja (safety sign) \n 3. SOP Kondisi emergency/darurat \n 4. SK tim tanggap darurat (update pada tahun berjalan termasuk SK tim)\n\n\nEvidence, Sarana K3 merupakan foto :\n\n 1. Kotak P3K\n 2. Helm Safety (disesuaikan dengan jumlah kebutuhan di gudang)\n 3. Sepatu Safety/Pelindung Sepatu (disesuaikan dengan jumlah kebutuhan di gudang)\n 4. Rompi (disesuaikan dengan jumlah kebutuhan di gudang)",
    "catatan": "Note :\n\n 1. Penggunaan Rambu-rambu mengacu referensi SPLN K3\n 2. Jumlah Helm, Sepatu dan Rompi dapat disediakan lebih dari jumlah kebutuhan di gudang (apabila ada kebutuhan tamu)\n 3. Warna helm : helm putih atau helm biru",
    "persediaan": "5",
    "attbMrwi": "N/A"
  },
  "4.3": {
    "requiredEvidence": "Evidence, merupakan foto dari :\n 1. CCTV yang terpasang \n 2. Tampilan layar CCTV,",
    "catatan": "Note :\n\n 1. Area gudang tertutup yang termonitor CCTV sebagai berikut:\n  a. Area bongkar muat\n  b. Area penyimpanan\n  c. Area pengeluaran\n  d. Area penerimaan\n  e. Area pendukung (ruang admin)\n\n2. Area gudang terbuka yang termonitor CCTV sebagai berikut:\n    a. Cluster ATTB standby\n    b. Cluster ATTB Perbaikan\n    c. Cluster ATTB Garansi / Asuransi\n    d. Cluster ATTB Usul Hapus",
    "persediaan": "5",
    "attbMrwi": "5"
  },
  "4.4": {
    "requiredEvidence": "Evidence :\n\n1. Working Permit yang di tanda tangani pejabat terkait secara lengkap\n\n2. Foto Pelaksanaan Pekerjaan untuk 2 Sampling WP",
    "catatan": "Note:\n1. sampling 1 WP untuk masing-masing gudang, sehingga total 2 sampling WP\n2. WP untuk masing-masing gudang dapat berupa kegiatan yang berkaitan dengan gudang tersebut",
    "persediaan": "3",
    "attbMrwi": "3"
  },
  "4.5": {
    "requiredEvidence": "Evidence :\n\n1. Hasil Checklist dari Form Checklist :\nhttps://docs.google.com/spreadsheets/d/1NoIKcULiaKt7znet1CcYm75TOvfc6lqY/edit?gid=930629523#gid=930629523 \n\n2. 3 Sampling Foto berdasarkan Itemnya ",
    "catatan": "",
    "persediaan": "5",
    "attbMrwi": "N/A"
  },
  "4.6": {
    "requiredEvidence": "Evidence :\n\n1. Dokumen Profil Risiko Unit",
    "catatan": "Note:\n1. item kegiatan risiko dapat berupa berkaitan dengan pengelolaan logistik (tidak harus terkait dengan kinerja maturity level pergudangan transmisi)",
    "persediaan": "5",
    "attbMrwi": "N/A"
  },
  "5.1": {
    "requiredEvidence": "Evidence :\n\n 1. pdf dari surat penyampaian AMS dari UPT perbulan / Notulen Konsolidasi Data Logistik (pada periode semester hingga waktu pelaksanaan assessment)\n \n 2. Kesesuaian Data material internal unit (spreadsheet) dan data material pada Tableu untuk setiap jenis peruntukan material dibawah ini, yaitu :\n  a. Material Persediaan pada Dashboard Material Persediaan (3 sampling material)\n  b. Material Cadang pada dashboard monitoring material cadang (3 sampling material)\n\n3. Foto Sampling material untuk mengecek kesesuaian dengan fisik material",
    "catatan": "Note :\n\n1. Apabila di gudang tersebut hanya terdapat 1 jenis peruntukan material, maka hanya  jenis peruntukan tersebut yang di sampling",
    "persediaan": "3",
    "attbMrwi": "N/A"
  },
  "5.2": {
    "requiredEvidence": "Evidence :\n\n 1. pdf dari surat penyampaian AMS perbulan / Notulen Konsolidasi Data Logistik (pada periode semester hingga waktu pelaksanaan assessment)\n \n 2. Kesesuaian Data Gudang internal unit (spreadsheet) dan data gudang pada Tableu, sebagai berikut:\n  a. % Luas Gudang, Luas Terpakai, Sisa Gudang, Gudang Terpakai\n  b. Komposisi Material di Gudang (Persediaan, Cadang, Pre Memory, ATTB, Lainnya (Limbah Non B3)\n\n3. Sampling Gudang Terbuka dan Gudang Tertutup",
    "catatan": "",
    "persediaan": "3",
    "attbMrwi": "3"
  },
  "5.3": {
    "requiredEvidence": "Evidence :\n\n1. Data Screenshoot Penerimaan SMAR  menggunakan data Penerimaan material (SMAR) di Unit tersebut (sampling dari 1 GI/gudang dalam UPT tersebut) untuk mengecek kesesuaian jumlah DO yang telah sukses diterima SMAR.\n2. Penerimaan MTU di SMAR periode semester tersebut",
    "catatan": "Note :\n\n 1. Data eviden merupakan data pada semester berjalan dilaksanakan check point atau 1 semester sebelumnya\n 2. Apabila dalam 1 UPT belum ada kondisi terbit DO (belum alokasi) yang sehingga tidak dapat dilakukan proses penerimaan di SMAR maka termasuk dalam level 2 (namun harus menunjukkan screenshoot tampilan SMAR)",
    "persediaan": "5",
    "attbMrwi": "N/A"
  },
  "5.4": {
    "requiredEvidence": "Eviden (Sampling 2 Material) :\n\n1. Screenshoot Aplikasi AGO-MIMS (user logistik dan material terinput di aplikasi)\n2. BA Inspeksi (format dari Aplikasi AGO-MIMS)\n3. Foto Penyimpanan Material",
    "catatan": "",
    "persediaan": "N/A",
    "attbMrwi": "3"
  }
});

// Kriteria berikut dibaca checker di dalam dokumen utama. Kriteria ini sengaja
// tidak memiliki state, checkbox, review, atau folder upload tersendiri.
export const MATLEV_MANUAL_CRITERIA = Object.freeze({
  "1.8": Object.freeze({
    rak_melintang: Object.freeze([
      "Semua rak ditempatkan melintang di dalam ruangan gudang, berderet-deret ke belakang.",
      "Jika ada lebih dari satu deret, tersedia lorong yang cukup lebar untuk lalu lintas barang.",
    ]),
  }),
  "2.3": Object.freeze({
    pengelola_mandatory: Object.freeze(["Petugas Admin", "Helper Gudang", "Cleaning Service", "Security"]),
  }),
  "3.4": Object.freeze({
    eval_notulen: Object.freeze([
      "Kontrak material dan kesesuaiannya dengan GI/gudang.",
      "Rencana area penyimpanan material yang akan datang pada tahun berjalan.",
      "Rencana tindak lanjut setiap jenis material di area penyimpanan (rencana keluar material).",
    ]),
  }),
  "3.5": Object.freeze({
    exops_tug10: Object.freeze([
      "Nama material.", "Jumlah.", "Satuan.", "Keterangan atau nama pekerjaan.",
      "Tanggal penerimaan/pengembalian.", "Tanggal pengeluaran TUG 9 atau operasi terakhir.",
      "Nama gudang/SLoc.", "Nama lokasi pekerjaan/GI.",
    ]),
  }),
  "5.2": Object.freeze({
    it_tableau_gudang: Object.freeze([
      "% luas gudang, luas terpakai, sisa gudang, dan gudang terpakai.",
      "Komposisi material di gudang: Persediaan, Cadang, Pre Memory, ATTB, dan lainnya/Limbah Non B3.",
    ]),
  }),
});

// Hanya item yang benar-benar memerlukan berkas tambahan yang dipecah menjadi
// evidence normal. Setiap item mendapat folder dan review sendiri.
export const MATLEV_EVIDENCE_SPLITS = Object.freeze({
  "2.1": Object.freeze({ so_jurnal: Object.freeze([
    Object.freeze({ id: "so_jurnal_selisih", label: "Jurnal selisih (tulis Nihil jika tidak ada selisih)" }),
    Object.freeze({ id: "so_rekap_inventory_difference", label: "Rekap List of Inventory Differences (tulis Nihil jika tidak ada selisih)" }),
  ]) }),
  "2.5": Object.freeze({ rwd_foto: Object.freeze([
    Object.freeze({ id: "rwd_kegiatan_nd", label: "ND/Surat pelaksanaan kegiatan reward", alternativeGroup: "reward", alternativePath: "kegiatan" }),
    Object.freeze({ id: "rwd_kegiatan_foto", label: "Foto pelaksanaan kegiatan reward", alternativeGroup: "reward", alternativePath: "kegiatan" }),
  ]) }),
  "3.6": Object.freeze({ cls_4cluster: Object.freeze([
    Object.freeze({ id: "cls_cluster_standby", label: "Foto cluster ATTB standby" }),
    Object.freeze({ id: "cls_cluster_perbaikan", label: "Foto cluster ATTB perbaikan" }),
    Object.freeze({ id: "cls_cluster_garansi_asuransi", label: "Foto cluster ATTB garansi/asuransi" }),
    Object.freeze({ id: "cls_cluster_usul_hapus", label: "Foto cluster ATTB usul hapus" }),
  ]) }),
  "5.1": Object.freeze({ it_tableau_material: Object.freeze([
    Object.freeze({ id: "it_tableau_persediaan", label: "Kesesuaian data Material Persediaan di dashboard (3 sampling)" }),
    Object.freeze({ id: "it_tableau_cadang", label: "Kesesuaian data Material Cadang di dashboard (3 sampling)" }),
  ]) }),
});
