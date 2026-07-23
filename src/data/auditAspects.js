export const AUDIT_CATEGORIES = [
  { id: "tata_kelola", label: "Tata Kelola", desc: "1. Tata Kelola Gudang", key: "tata_kelola_gudang" },
  { id: "tenaga_kerja", label: "Tenaga Kerja", desc: "2. Manajemen Tenaga Kerja", key: "manajemen_tenaga_kerja" },
  { id: "sarana_prasarana", label: "Sarana Prasarana", desc: "3. Ketersediaan Sarana dan Prasarana Gudang", key: "sarana_prasarana" },
  { id: "k3", label: "K3", desc: "4. Keamanan dan Keselamatan Kerja (K3) Lingkungan Pergudangan", key: "keamanan_keselamatan" },
  { id: "teknologi", label: "Teknologi/SI", desc: "5. Teknologi dan Sistem Informasi Logistik", key: "teknologi_sistem" }
];

export const AUDIT_ASPECTS = [
  // ─────────────────────────────────────────────────────────────────
  // 1. TATA KELOLA GUDANG
  // ─────────────────────────────────────────────────────────────────
  {
    id: "1.1",
    category: "tata_kelola",
    title: "Ketersediaan Probis Pengelolaan Logistik Material",
    subtext: "Tata Kelola • Gudang Persediaan • 7 evidence wajib",
    requiredEvidence: [
      { id: "probis_1", label: "Probis Pemeriksaan dan Penerimaan Material Persediaan (flowchart)" },
      { id: "probis_2", label: "Probis Penerimaan Material Sisa Pemakaian / Pengembalian Material dari User (flowchart)" },
      { id: "probis_3", label: "Probis Pengeluaran Material untuk Pemakaian Normal" },
      { id: "probis_4", label: "Probis Pengeluaran Material untuk Pemakaian Emergency" },
      { id: "probis_5", label: "Probis Pemeriksaan Fisik Material (Stock Opname)" },
      { id: "probis_6", label: "Probis Transfer/Mutasi Material Antar Gudang dalam 1 Unit Induk (Intra Company)" },
      { id: "probis_7", label: "Probis Transfer/Mutasi Material Antar Gudang Antar Unit Induk (Inter Company)" }
    ],
    catatan: [
      "Eviden harus terpenuhi lengkap untuk level yang ingin dicapai.",
      "Dokumen Eviden (Probis) tertanda tangan oleh GM.",
      "Menunjukan evidence yang telah dilakukan, dari batas waktu di dokumen eviden hingga tanggal pelaksanaan self assessment."
    ],
    levels: [
      "Level 1: Tidak Ada Probis sesuai Eviden",
      "Level 2: Probis belum lengkap sesuai eviden (kurang dari 2) yang telah bertandatangan General Manager",
      "Level 3: Minimal 3 dari 7 sudah terpenuhi lengkap sesuai eviden dan telah bertanda tangan General Manager",
      "Level 4: Minimal 5 dari 7 Probis sudah terpenuhi lengkap sesuai eviden dan telah bertanda tangan General Manager",
      "Level 5: 7 Probis sudah terpenuhi lengkap sesuai eviden dan telah bertanda tangan General Manager periode berjalan"
    ],
    aiNote: "Evidence wajib terdeteksi lengkap. Auditor tetap perlu membuka dokumen untuk memastikan objektivitas level."
  },
  {
    id: "1.2",
    category: "tata_kelola",
    title: "Implementasi Proses Bisnis Penerimaan Material",
    subtext: "Tata Kelola • Gudang Persediaan • 7 evidence wajib (Sampling 2 Material)",
    requiredEvidence: [
      { id: "inbound_sj", label: "Surat Jalan dari Vendor ke PLN" },
      { id: "inbound_spb", label: "Kontrak Material / SPB UPT" },
      { id: "inbound_po", label: "Form PO Material (dari SAP/SMAR)" },
      { id: "inbound_tug4", label: "Form Pemeriksaan TUG 4 (SAP/SMAR) tertanda tangan pihak terkait" },
      { id: "inbound_tug3", label: "Form Penerimaan TUG 3 (SAP/SMAR) tertanda tangan pihak terkait" },
      { id: "inbound_tug2", label: "Kartu Gantung TUG 2" },
      { id: "inbound_foto", label: "Foto Material" }
    ],
    catatan: [
      "Wajib melampirkan siklus lengkap untuk 2 sampling material persediaan.",
      "Seluruh tanda tangan petugas penerima dan pemeriksa harus terisi lengkap.",
      "Foto material harus memperlihatkan fisik barang secara jelas."
    ],
    levels: [
      "Level 1: Belum ada dokumen pendukung penerimaan barang",
      "Level 2: Dokumen penerimaan tidak lengkap (kurang dari 3 dokumen)",
      "Level 3: Minimal 4 dari 7 dokumen penerimaan terpenuhi lengkap",
      "Level 4: Minimal 6 dari 7 dokumen penerimaan terpenuhi lengkap",
      "Level 5: Seluruh 7 dokumen penerimaan terpenuhi lengkap untuk kedua sampling material"
    ],
    aiNote: "Validasi PO, TUG 3, dan TUG 4 untuk kesesuaian jumlah barang."
  },
  {
    id: "1.3",
    category: "tata_kelola",
    title: "Waktu Pemberitahuan Pengiriman Material dari Vendor",
    subtext: "Tata Kelola • Gudang Persediaan • 2 evidence wajib",
    requiredEvidence: [
      { id: "vendor_notif", label: "Surat pemberitahuan dari vendor ke gudang PLN terkait rencana pengiriman material" },
      { id: "vendor_ba", label: "Tanda Terima Material / Berita Acara (BA)" }
    ],
    catatan: [
      "Pemberitahuan harus dikirim minimal 7 hari sebelum rencana pengiriman.",
      "Keterlambatan pemberitahuan vendor merupakan temuan non-konformitas."
    ],
    levels: [
      "Level 1: Tidak ada surat pemberitahuan dari vendor",
      "Level 2: Surat pemberitahuan ada tapi dikirim < 3 hari sebelum pengiriman",
      "Level 3: Surat pemberitahuan dikirim 3-5 hari sebelum rencana pengiriman",
      "Level 4: Surat pemberitahuan dikirim 6-7 hari sebelum rencana pengiriman",
      "Level 5: Surat pemberitahuan dikirim >7 hari sebelum rencana pengiriman dengan BA tanda terima lengkap"
    ],
    aiNote: "Periksa timestamp surat pemberitahuan dibanding tanggal kedatangan aktual."
  },
  {
    id: "1.4",
    category: "tata_kelola",
    title: "Waktu Pelaksanaan Pemeriksaan Material Datang (TUG 4)",
    subtext: "Tata Kelola • Gudang Persediaan • 2 evidence wajib",
    requiredEvidence: [
      { id: "tug4_ba", label: "Tanda Terima Material" },
      { id: "tug4_doc", label: "Form Pemeriksaan TUG 4" }
    ],
    catatan: [
      "Pemeriksaan material oleh Tim Mutu harus segera dilakukan setelah material datang.",
      "Rata-rata penyelesaian TUG 4 harus dipantau."
    ],
    levels: [
      "Level 1: Pemeriksaan TUG 4 tidak didokumentasikan",
      "Level 2: Pemeriksaan selesai >5 hari kerja setelah barang tiba",
      "Level 3: Pemeriksaan diselesaikan 4-5 hari kerja setelah barang tiba",
      "Level 4: Pemeriksaan diselesaikan 2-3 hari kerja setelah barang tiba",
      "Level 5: Rata-rata durasi penyelesaian TUG 4 selesai dalam 1 hari kerja (real-time)"
    ],
    aiNote: "Periksa keselarasan tanggal pada Tanda Terima Material vs tanggal Form TUG 4."
  },
  {
    id: "1.5",
    category: "tata_kelola",
    title: "Waktu Proses Penerimaan Hingga Penyimpanan",
    subtext: "Tata Kelola • Gudang Persediaan • 2 evidence wajib",
    requiredEvidence: [
      { id: "proc_recv_tug3", label: "Form TUG 3 (Input SAP)" },
      { id: "proc_recv_tug2", label: "Kartu Gantung TUG 2" }
    ],
    catatan: [
      "Waktu proses penerimaan hingga penyimpanan harus diselesaikan dalam waktu cepat.",
      "Kartu gantung TUG 2 wajib langsung terisi dan digantung pada material."
    ],
    levels: [
      "Level 1: Penerimaan dan penyimpanan tidak terdokumentasi",
      "Level 2: Proses penerimaan selesai tapi penyimpanan ditunda >3 hari",
      "Level 3: Proses penerimaan hingga penyimpanan selesai dalam 2-3 hari kerja",
      "Level 4: Proses penerimaan hingga penyimpanan selesai dalam 1-2 hari kerja",
      "Level 5: Proses penerimaan hingga penyimpanan selesai dalam waktu <24 jam (real-time)"
    ],
    aiNote: "Periksa selisih tanggal antara TUG 3 (penerimaan SAP) dengan tanggal kartu gantung TUG 2."
  },
  {
    id: "1.6",
    category: "tata_kelola",
    title: "Implementasi Proses Bisnis Pengeluaran Material",
    subtext: "Tata Kelola • Gudang Persediaan • 6 evidence wajib (Sampling 2 Material)",
    requiredEvidence: [
      { id: "proc_out_req", label: "Surat/Form Permintaan/Permohonan Material kepada Manajemen yang membawahi fungsi Logistik" },
      { id: "proc_out_kontrak", label: "Kontrak Kerjasama dengan pihak eksternal (apabila pihak eksternal yang melakukan permohonan)" },
      { id: "proc_out_sap", label: "Form Pemesanan (Reservation Slip) / Work Order (SAP) bertanda tangan" },
      { id: "proc_out_tug9", label: "Slip Pengeluaran Barang-2 / Spare Parts (Pemakaian Reservasi) SAP bertanda tangan (TUG 9)" },
      { id: "proc_out_tug2", label: "Kartu Gantung TUG 2" },
      { id: "proc_out_foto", label: "Foto Proses Pengeluaran Material" }
    ],
    catatan: [
      "Setiap pengeluaran material wajib didasarkan pada dokumen TUG 9 yang sah.",
      "Tanda tangan penerima barang wajib tertera secara lengkap.",
      "Sampling 2 material wajib dilampirkan siklus lengkap dokumen pengeluaran."
    ],
    levels: [
      "Level 1: Pengeluaran barang dilakukan secara lisan tanpa administrasi",
      "Level 2: Pengeluaran memakai TUG 9 namun kelengkapan tanda tangan kurang",
      "Level 3: Minimal 3 dari 6 dokumen pengeluaran terpenuhi lengkap",
      "Level 4: Minimal 5 dari 6 dokumen pengeluaran terpenuhi lengkap",
      "Level 5: Seluruh 6 siklus dokumen pengeluaran lengkap beserta foto penyerahan untuk kedua sampling"
    ],
    aiNote: "Pastikan nomor reservasi SAP sinkron dengan data pengeluaran TUG 9."
  },
  {
    id: "1.7",
    category: "tata_kelola",
    title: "Durasi Waktu Pemberitahuan Pengambilan Material",
    subtext: "Tata Kelola • Gudang Persediaan • 2 evidence wajib",
    requiredEvidence: [
      { id: "user_notif_req", label: "Surat atau Nota Dinas di AMS atau TUG dari User ke Gudang terkait permohonan/permintaan material" },
      { id: "user_notif_ba", label: "Tanda Terima Pengeluaran Material / Berita Acara (BA)" }
    ],
    catatan: [
      "User wajib memberikan notifikasi rencana pengambilan material minimal sebelum kedatangan."
    ],
    levels: [
      "Level 1: User mengambil barang langsung tanpa pemberitahuan tertulis",
      "Level 2: Pemberitahuan pengambilan kurang dari 1 hari sebelum kedatangan",
      "Level 3: Pemberitahuan pengambilan 1-2 hari sebelum rencana pengambilan",
      "Level 4: Pemberitahuan pengambilan 3 hari sebelum rencana pengambilan",
      "Level 5: Pemberitahuan pengambilan minimal >3 hari sebelum rencana pengambilan dengan BA serah terima lengkap"
    ],
    aiNote: "Periksa selisih hari notifikasi dengan tanggal pengeluaran aktual di gudang."
  },
  {
    id: "1.8",
    category: "tata_kelola",
    title: "Implementasi Metode Penyimpanan Material (RAK)",
    subtext: "Tata Kelola • Gudang Persediaan • 4 evidence wajib",
    requiredEvidence: [
      { id: "rak_melintang", label: "Foto Penyusunan Rak melintang (semua rak ditempatkan melintang di dalam ruangan, berderet ke belakang, dengan lorong lalu lintas barang yang cukup lebar)" },
      { id: "rak_penamaan", label: "Foto Penamaan (list daftar material dalam 1 rak) / Penomoran Rak sesuai jenis material" },
      { id: "rak_kartu", label: "Foto Kartu Gantung yang menempel/menggantung jelas pada material" },
      { id: "rak_penempatan", label: "Foto Penempatan Material yang sesuai dengan penamaan/penomoran raknya" }
    ],
    catatan: [
      "Evidence sesuai ketentuan Perdir 687 STK Tata Kelola Gudang.",
      "Rak harus ditata melintang agar ada lorong lebar untuk lalu lintas material.",
      "Daftar material dan kartu gantung wajib terpasang pada masing-masing rak/material."
    ],
    levels: [
      "Level 1: Penataan rak acak-acahan dan tidak teratur",
      "Level 2: Rak disusun memanjang (longitudinal) atau sempit",
      "Level 3: Minimal 2 dari 4 kriteria penataan rak terpenuhi",
      "Level 4: Minimal 3 dari 4 kriteria penataan rak terpenuhi",
      "Level 5: Seluruh 4 kriteria penyimpanan rak (melintang, penamaan, kartu gantung, penempatan sesuai) terpenuhi sempurna"
    ],
    aiNote: "Verifikasi orientasi rak melintang dan keterbacaan label list material pada foto."
  },
  {
    id: "1.9",
    category: "tata_kelola",
    title: "Ketersediaan Referensi Dokumen dan Kesesuaian Penyimpanan Material",
    subtext: "Tata Kelola • Gudang Persediaan • 2 evidence wajib",
    requiredEvidence: [
      { id: "ref_doc_manual", label: "Referensi Dokumen (Softcopy/Hardcopy): Manual Book metode penyimpanan / Buku Kajian Umur Maksimum Material Cadang / Proses Bisnis Penyimpanan Material" },
      { id: "ref_doc_foto", label: "Foto Penyimpanan Material (kondisi fisik di lapangan)" }
    ],
    catatan: [
      "Menyediakan panduan referensi penyimpanan untuk material khusus (MTU/Isolator/Kabel).",
      "Kondisi fisik penyimpanan harus sesuai dengan anjuran referensi dokumen."
    ],
    levels: [
      "Level 1: Tidak ada referensi dokumen penyimpanan material khusus",
      "Level 2: Referensi ada tapi kondisi penyimpanan fisik menyimpang",
      "Level 3: Kesesuaian penyimpanan terpenuhi untuk 1 dari 3 sampling material khusus",
      "Level 4: Kesesuaian penyimpanan terpenuhi untuk 2 dari 3 sampling material khusus",
      "Level 5: Kesesuaian penyimpanan terpenuhi lengkap untuk 3 sampling material khusus sesuai referensi dokumen"
    ],
    aiNote: "Bandingkan kondisi fisik penyimpanan dengan ketentuan dalam referensi dokumen yang dilampirkan."
  },
  {
    id: "1.10",
    category: "tata_kelola",
    title: "Penyimpanan Material Dikelompokkan Berdasarkan Varian/Jenis",
    subtext: "Tata Kelola • Gudang Persediaan • 1 evidence wajib",
    requiredEvidence: [
      { id: "group_var_foto", label: "Foto Penyimpanan Material sesuai varian/jenisnya (material sejenis dikelompokkan dalam satu area)" }
    ],
    catatan: [
      "Material sejenis wajib dikelompokkan dalam satu blok yang sama.",
      "Foto harus menunjukkan dengan jelas pengelompokan material berdasarkan jenisnya."
    ],
    levels: [
      "Level 1: Penyimpanan dicampur tanpa pengelompokan varian",
      "Level 2: Material dikelompokkan namun tidak ada papan penanda kategori",
      "Level 3: Pengelompokan terpenuhi untuk 1 dari 3 zona penyimpanan utama",
      "Level 4: Pengelompokan terpenuhi untuk 2 dari 3 zona penyimpanan utama",
      "Level 5: Seluruh material dikelompokkan rapi per varian dengan penanda yang jelas"
    ],
    aiNote: "Pastikan foto menunjukkan pemisahan jenis material persediaan secara visual yang jelas."
  },

  // ─────────────────────────────────────────────────────────────────
  // 2. MANAJEMEN TENAGA KERJA
  // ─────────────────────────────────────────────────────────────────
  {
    id: "2.1",
    category: "tenaga_kerja",
    title: "Kolaborasi Antar Fungsi Logistik dan Akuntansi",
    subtext: "Tenaga Kerja • SDM Gudang • 4 evidence wajib",
    requiredEvidence: [
      { id: "so_undangan", label: "Undangan / Notulen rapat terkait jadwal pelaksanaan stock opname" },
      { id: "so_ba", label: "BA Stock Opname (inventarisasi material) / PID" },
      { id: "so_foto", label: "Foto zoom atau foto kegiatan stock opname" },
      { id: "so_jurnal", label: "Jurnal terkait Selisih + Rekap List of Inventory Differences (ditulis Nihil apabila tidak ada selisih)" }
    ],
    catatan: [
      "Stock opname harus melibatkan fungsi Logistik dan Keuangan/Akuntansi.",
      "BA Stock Opname wajib ditandatangani oleh kedua fungsi dan disetujui MAN UPT."
    ],
    levels: [
      "Level 1: Stock opname tidak melibatkan fungsi keuangan (sepihak)",
      "Level 2: Stock opname melibatkan keuangan tapi tidak ada BA formal",
      "Level 3: BA Stock Opname tersedia tapi tidak ada bukti notulen/undangan persiapan",
      "Level 4: BA Stock Opname lengkap dengan bukti kolaborasi namun investigasi selisih terlambat",
      "Level 5: Kolaborasi Stock Opname lengkap (undangan, BA ttd, foto, investigasi selisih tuntas)"
    ],
    aiNote: "Verifikasi tanda tangan fungsi akuntansi pada BA Stock Opname."
  },
  {
    id: "2.2",
    category: "tenaga_kerja",
    title: "Kolaborasi Antar Fungsi Logistik dan Pemeliharaan",
    subtext: "Tenaga Kerja • SDM Gudang • 3 evidence wajib",
    requiredEvidence: [
      { id: "inspeksi_undangan", label: "Undangan Pelaksanaan Pemeriksaan (Visual Inspeksi)" },
      { id: "inspeksi_ba", label: "Berita Acara Visual Inspeksi MTU yang ditandatangani HAR dan LOG, diketahui oleh MAN UPT (terlampir form BA)" },
      { id: "inspeksi_foto", label: "Foto Pelaksanaan Pemeriksaan" }
    ],
    catatan: [
      "Inspeksi material cadang/MTU harus dilakukan bersama tim pemeliharaan (HAR).",
      "Dilakukan minimal 1 kali per semester."
    ],
    levels: [
      "Level 1: Tidak ada inspeksi visual material cadang",
      "Level 2: Inspeksi dilakukan sepihak oleh logistik saja (tanpa fungsi HAR)",
      "Level 3: Inspeksi bersama HAR dilakukan tapi tidak dibuatkan BA formal",
      "Level 4: BA inspeksi bersama ditandatangani HAR & LOG tapi belum diketahui MAN UPT",
      "Level 5: Inspeksi berkala bersama lengkap dengan BA formal ttd HAR, LOG, dan diketahui MAN UPT"
    ],
    aiNote: "Validasi tanda tangan tim HAR (Pemeliharaan) dan MAN UPT di BA Inspeksi."
  },
  {
    id: "2.3",
    category: "tenaga_kerja",
    title: "Ketersediaan Pengelola Gudang",
    subtext: "Tenaga Kerja • SDM Gudang • 1 evidence wajib (mencakup 4 fungsi mandatory)",
    requiredEvidence: [
      { id: "pengelola_struktur", label: "Struktur Organisasi / Daftar Pengelola Gudang (termasuk foto dari pengelola) yang ditandatangani Manajer UPT — mencakup 4 mandatory: Petugas Admin, Helper Gudang, Cleaning Service, Security" }
    ],
    catatan: [
      "Struktur Organisasi harus terupdate apabila terdapat perubahan personil pengelola gudang.",
      "4 fungsi pengelola mandatory: Petugas Admin, Helper Gudang, Cleaning Service, dan Security."
    ],
    levels: [
      "Level 1: Tidak ada pengelola gudang khusus (rangkap jabatan total)",
      "Level 2: Pengelola gudang dijabat oleh personil non-logistik (bukan tugas utama)",
      "Level 3: Pengelola gudang terpenuhi minimal 1 fungsi mandatory dengan SK resmi",
      "Level 4: Pengelola gudang terpenuhi minimal 2-3 fungsi mandatory",
      "Level 5: Seluruh 4 fungsi mandatory (Admin, Helper, Cleaning Service, Security) terpenuhi dengan struktur organisasi resmi ttd MAN UPT"
    ],
    aiNote: "Periksa kelengkapan 4 fungsi mandatory pada struktur organisasi/daftar pengelola gudang."
  },
  {
    id: "2.4",
    category: "tenaga_kerja",
    title: "Peningkatan Kompetensi Pegawai Fungsi Logistik",
    subtext: "Tenaga Kerja • Sertifikasi Logistik • 1 evidence wajib",
    requiredEvidence: [
      { id: "cert_logistik", label: "Sertifikat kompetensi/diklat logistik untuk pegawai yang bertugas di Fungsi Logistik minimal 1 tahun berdasarkan SK/Surat Penugasan" }
    ],
    catatan: [
      "Evidence berupa sertifikat kompetensi logistik dari PLN atau lembaga eksternal yang masih berlaku.",
      "Pegawai yang dibuktikan harus memiliki SK/Surat Penugasan di Fungsi Logistik minimal 1 tahun."
    ],
    levels: [
      "Level 1: Seluruh pegawai gudang belum pernah mengikuti diklat kompetensi logistik",
      "Level 2: Kurang dari 25% pegawai memiliki sertifikat kompetensi logistik aktif",
      "Level 3: Minimal 25% - 50% pegawai memiliki sertifikat kompetensi logistik aktif",
      "Level 4: Minimal 50% - 75% pegawai memiliki sertifikat kompetensi logistik aktif",
      "Level 5: Lebih dari 75% pegawai memiliki sertifikat kompetensi logistik aktif"
    ],
    aiNote: "Periksa masa berlaku dan kesesuaian bidang sertifikat dengan fungsi logistik."
  },
  {
    id: "2.5",
    category: "tenaga_kerja",
    title: "Adanya Budaya Reward atau Ide Inovasi",
    subtext: "Tenaga Kerja • Reward/Inovasi • 2 evidence wajib",
    requiredEvidence: [
      { id: "rwd_nd", label: "Informasi berupa ND/Surat penyampaian reward kinerja pengelolaan logistik dari Unit Induk" },
      { id: "rwd_foto", label: "ND/Surat pelaksanaan kegiatan reward beserta Foto Pelaksanaan kegiatan" }
    ],
    catatan: [
      "Cukup salah satu dari dua evidence di atas, atau keduanya.",
      "Program reward dari Unit Induk sebagai motivasi kerja pegawai logistik."
    ],
    levels: [
      "Level 1: Tidak ada partisipasi program reward atau ide inovasi logistik",
      "Level 2: Program reward / ide inovasi diusulkan tapi belum terealisasi",
      "Level 3: Program reward / ide inovasi terealisasi tanpa dokumentasi formal",
      "Level 4: Berpartisipasi aktif dengan ND/Surat penyampaian reward dari Unit Induk",
      "Level 5: Partisipasi aktif dengan ND/Surat + Foto pelaksanaan kegiatan reward lengkap"
    ],
    aiNote: "Periksa lampiran ND penyampaian reward dan foto pelaksanaan kegiatan."
  },

  // ─────────────────────────────────────────────────────────────────
  // 3. KETERSEDIAAN SARANA DAN PRASARANA
  // ─────────────────────────────────────────────────────────────────
  {
    id: "3.1",
    category: "sarana_prasarana",
    title: "Ketersediaan Peralatan Kerja dan Alat Angkut/Angkat",
    subtext: "Sarana Prasarana • Fasilitas Gudang • 6 evidence wajib",
    requiredEvidence: [
      { id: "area_loading_dock", label: "Foto Area Loading Dock / Bongkar Muat / Drop Zone" },
      { id: "area_penerimaan", label: "Foto Area Penerimaan (area karantina merupakan bagian dari area ini)" },
      { id: "area_pengeluaran", label: "Foto Area Pengeluaran" },
      { id: "area_penyimpanan", label: "Foto Area Penyimpanan" },
      { id: "area_admin", label: "Foto Ruang Administrasi" },
      { id: "area_toilet", label: "Foto Toilet" }
    ],
    catatan: [
      "Evidence merupakan foto dari setiap area prasarana gudang.",
      "Area karantina merupakan bagian dari Area Penerimaan."
    ],
    levels: [
      "Level 1: Tidak ada prasarana penunjang yang memadai",
      "Level 2: Tersedia 1-2 area prasarana dengan kondisi minimal",
      "Level 3: Tersedia 3-4 area prasarana yang terdefinisi jelas",
      "Level 4: Tersedia 5 dari 6 area prasarana dengan kondisi layak",
      "Level 5: Seluruh 6 area prasarana (Loading Dock, Penerimaan, Pengeluaran, Penyimpanan, Admin, Toilet) tersedia lengkap"
    ],
    aiNote: "Verifikasi keberadaan dan kondisi setiap area prasarana dari foto yang dilampirkan."
  },
  {
    id: "3.2",
    category: "sarana_prasarana",
    title: "Ketersediaan dan Pemeliharaan Sarana Prasarana Gudang",
    subtext: "Sarana Prasarana • Alat Angkut • 7 evidence wajib",
    requiredEvidence: [
      { id: "eq_forklift", label: "Foto Forklift" },
      { id: "eq_handlift", label: "Foto Handlift" },
      { id: "eq_trolley", label: "Foto Trolley" },
      { id: "eq_crane", label: "Foto Crane" },
      { id: "sia_alat", label: "Sertifikat SIA / Surat Izin Alat (untuk Level 4 dan 5)" },
      { id: "sio_operator", label: "Sertifikat SIO / Surat Izin Operator (untuk Level 4 dan 5)" },
      { id: "daftar_alat", label: "Daftar Alat Kerja Gudang (sebagai lampiran dari Laporan Bulanan)" }
    ],
    catatan: [
      "SIA dan SIO wajib dilampirkan untuk mencapai Level 4 dan 5.",
      "SIA diterbitkan oleh Kemenaker/Disnaker sebagai jaminan kelaikan alat."
    ],
    levels: [
      "Level 1: Tidak ada alat angkut mekanis (manual angkat tangan)",
      "Level 2: Hanya tersedia trolley/handlift dalam kondisi seadanya",
      "Level 3: Forklift dan handlift tersedia namun tidak dilengkapi SIA/SIO",
      "Level 4: Forklift dan handlift tersedia dengan SIA dan SIO aktif",
      "Level 5: Forklift, handlift, trolley, crane tersedia lengkap dengan SIA/SIO aktif dan Daftar Alat"
    ],
    aiNote: "Periksa masa berlaku SIA alat dan SIO operator."
  },
  {
    id: "3.3",
    category: "sarana_prasarana",
    title: "Ketersediaan Layout Gudang Terpasang",
    subtext: "Sarana Prasarana • Denah Gudang • 2 evidence wajib",
    requiredEvidence: [
      { id: "lay_close_foto", label: "Foto Layout Gudang Tertutup (disesuaikan dengan persyaratan per level penilaian)" },
      { id: "lay_close_ukuran", label: "Layout Gudang dicetak minimal ukuran A3 (apabila tidak sesuai ukuran menjadi Level 1)" }
    ],
    catatan: [
      "Denah harus mencantumkan letak rak, area kerja, dan pintu evakuasi.",
      "Layout wajib dicetak minimal ukuran A3 dan ditandatangani Manajer UPT."
    ],
    levels: [
      "Level 1: Tidak ada layout gudang tertutup / ukuran di bawah A3",
      "Level 2: Layout ada ukuran A3 namun tidak ada keterangan area dan tanpa ttd Manajer",
      "Level 3: Layout ukuran A3 tersedia dengan keterangan area namun belum ditandatangani Manajer UPT",
      "Level 4: Layout ukuran A3 bertanda tangan Manajer UPT tapi tidak dipasang di area gudang",
      "Level 5: Layout gudang tertutup ukuran A3 terpasang jelas di dinding, ditandatangani MAN UPT, mencantumkan kondisi aktual tata letak"
    ],
    aiNote: "Pastikan tanda tangan Manajer UPT terlihat di pojok layout."
  },
  {
    id: "3.4",
    category: "sarana_prasarana",
    title: "Evaluasi Tata Letak (Layout) dan Kapasitas Gudang",
    subtext: "Sarana Prasarana • Evaluasi Ruang • 1 evidence wajib",
    requiredEvidence: [
      { id: "eval_notulen", label: "Notulen rapat evaluasi tata kelola material yang memuat pembahasan: a) Kontrak Material (kesesuaian material dengan GI/Gudang), b) Rencana area penyimpanan material yang akan datang tahun berjalan, c) Rencana tindaklanjut dari setiap jenis material di area penyimpanan (rencana keluar material)" }
    ],
    catatan: [
      "Rapat evaluasi kapasitas ruang minimal 1 kali per semester.",
      "Notulen wajib memuat 3 poin pembahasan: Kontrak Material, Rencana Penyimpanan, dan Rencana Tindaklanjut."
    ],
    levels: [
      "Level 1: Tidak ada evaluasi tata letak berkala",
      "Level 2: Evaluasi dilakukan informal tanpa notulen rapat",
      "Level 3: Notulen evaluasi ada tapi tidak mencakup ketiga poin pembahasan wajib",
      "Level 4: Notulen evaluasi lengkap 3 poin tapi belum ditandatangani pimpinan",
      "Level 5: Rapat evaluasi terdokumentasi lengkap (notulen 3 poin, daftar hadir, ttd pimpinan)"
    ],
    aiNote: "Periksa apakah ketiga poin pembahasan wajib (kontrak, rencana penyimpanan, rencana tindaklanjut) ada dalam notulen."
  },
  {
    id: "3.5",
    category: "sarana_prasarana",
    title: "Penyampaian Kondisi Sarana Prasarana dan Peralatan Kerja",
    subtext: "Sarana Prasarana • Material Ex-Ops • 2 evidence wajib (Sampling 3 Material)",
    requiredEvidence: [
      { id: "exops_tug10", label: "TUG 10 / Pengembalian (terisi lengkap: nama material, jumlah, satuan, keterangan pekerjaan, tanggal penerimaan/pengembalian, tanggal TUG 9/operasi terakhir, nama gudang/SLoc, nama lokasi pekerjaan/GI) — ditandatangani PIC ULTG dan PIC Gudang UPT" },
      { id: "exops_ba", label: "BA Penggantian Material dari tim ULTG" }
    ],
    catatan: [
      "Sampling untuk 3 material ex-operasi wajib melampirkan TUG 10 dan BA penggantian.",
      "TUG 10 harus lengkap semua kolom isian dan ditandatangani kedua pihak."
    ],
    levels: [
      "Level 1: Material ex-operasi disimpan tanpa pencatatan TUG 10",
      "Level 2: Dokumen TUG 10 ada tapi isian tidak lengkap atau tanpa tanda tangan salah satu pihak",
      "Level 3: TUG 10 lengkap tapi tidak dilampiri BA Penggantian Material",
      "Level 4: TUG 10 dan BA lengkap untuk sebagian sampling material ex-operasi",
      "Level 5: Administrasi TUG 10 + BA Penggantian lengkap dan valid untuk ketiga sampling material ex-operasi"
    ],
    aiNote: "Cocokkan kelengkapan isian TUG 10 dengan BA Penggantian Material dari ULTG."
  },
  {
    id: "3.6",
    category: "sarana_prasarana",
    title: "Pemilahan Material Usang/Rusak (Scrap/Ex-Bongkaran)",
    subtext: "Sarana Prasarana • Material Ex-Ops • 3 evidence wajib (Sampling 3 Material)",
    requiredEvidence: [
      { id: "cls_4cluster", label: "Foto dari setiap cluster: Cluster ATTB Standby, Cluster ATTB Perbaikan, Cluster ATTB Garansi/Asuransi, Cluster ATTB Usul Hapus" },
      { id: "cls_foto_penyimpanan", label: "Foto Penyimpanan Material berdasarkan cluster" },
      { id: "cls_sampling", label: "Total Sampling 3 Jenis Material berdasarkan clusternya (dapat dalam 1 cluster yang sama atau cluster berbeda-beda)" }
    ],
    catatan: [
      "Keempat cluster fisik ex-operasi harus ditempatkan pada blok terpisah dengan penanda label.",
      "Total 3 jenis material wajib di-sampling, boleh dari cluster yang sama atau berbeda."
    ],
    levels: [
      "Level 1: Material ex-operasi ditumpuk campur aduk tanpa pemilahan cluster",
      "Level 2: Hanya 1-2 cluster yang terpilah secara fisik",
      "Level 3: Sebanyak 3 cluster terpilah fisik namun label penanda belum seragam",
      "Level 4: Seluruh 4 cluster terpilah secara fisik tapi area penempatan masih berdekatan",
      "Level 5: Seluruh 4 cluster (Standby, Perbaikan, Garansi, Usul Hapus) terpilah fisik di blok terpisah dengan foto sampling 3 material"
    ],
    aiNote: "Periksa keberadaan penanda/label cluster pada masing-masing foto."
  },
  {
    id: "3.7",
    category: "sarana_prasarana",
    title: "Ketersediaan Layout Area Penyimpanan Material Sisa",
    subtext: "Sarana Prasarana • Denah Gudang • 2 evidence wajib",
    requiredEvidence: [
      { id: "lay_open_foto", label: "Foto Layout Gudang Terbuka (disesuaikan dengan persyaratan per level penilaian)" },
      { id: "lay_open_ukuran", label: "Layout Gudang Terbuka dicetak minimal ukuran A3 (apabila tidak sesuai ukuran menjadi Level 1)" }
    ],
    catatan: [
      "Denah area terbuka (yard) untuk penyimpanan kabel, tiang, ex-operasi dll.",
      "Layout wajib dicetak minimal ukuran A3 dan ditandatangani Manajer UPT."
    ],
    levels: [
      "Level 1: Tidak ada layout gudang terbuka / ukuran di bawah A3",
      "Level 2: Layout ada ukuran A3 namun tanpa keterangan zona dan tanpa ttd Manajer",
      "Level 3: Layout ukuran A3 tersedia dengan keterangan zona namun belum ditandatangani Manajer UPT",
      "Level 4: Layout ukuran A3 bertanda tangan Manajer UPT tapi tidak dipasang di area gudang",
      "Level 5: Layout gudang terbuka ukuran A3 terpasang jelas di dinding, ditandatangani MAN UPT, mencantumkan pembagian zona cluster"
    ],
    aiNote: "Pastikan tanda tangan Manajer UPT tertera di layout terbuka."
  },

  // ─────────────────────────────────────────────────────────────────
  // 4. KEAMANAN DAN KESELAMATAN (K3)
  // ─────────────────────────────────────────────────────────────────
  {
    id: "4.1",
    category: "k3",
    title: "Ketersediaan Sistem Keamanan dan Pengawasan Area Gudang",
    subtext: "K3 • Proteksi Kebakaran • 4 evidence wajib",
    requiredEvidence: [
      { id: "k3_apar_unit", label: "Foto APAR yang terpasang (di Gudang dan di Ruang Admin/Kantor apabila terpisah dengan Gudangnya)" },
      { id: "k3_apar_tag", label: "Foto kelayakan APAR: tag/kartu pemeriksaan berkala dengan tanggal APAR yang belum expired" },
      { id: "k3_apar_sign", label: "Foto tanda penunjuk posisi APAR" },
      { id: "k3_hydrant_alarm", label: "Foto Hydrant, Alarm/Detector dan Foto Pengujian (Alarm/Detector & Hydrant) atau ceklist pemeliharaan (untuk Level 5)" }
    ],
    catatan: [
      "APAR wajib terpasang di area Gudang dan Ruang Admin/Kantor.",
      "Tanda penunjuk posisi APAR harus terpasang jelas.",
      "Hydrant dan Alarm/Detector + bukti pengujian wajib untuk mencapai Level 5."
    ],
    levels: [
      "Level 1: Tidak tersedia APAR di gudang",
      "Level 2: APAR tersedia tapi tidak terpasang atau masa berlakunya expired",
      "Level 3: APAR terpasang dengan tanda penunjuk posisi APAR",
      "Level 4: APAR terpasang, kelayakan aktif, dan tanda penunjuk APAR jelas",
      "Level 5: APAR lengkap + Hydrant dan Alarm/Detector berfungsi penuh dengan bukti pengujian/ceklist pemeliharaan"
    ],
    aiNote: "Periksa tanggal kedaluwarsa pada tag APAR dan kelengkapan sistem hydrant/alarm."
  },
  {
    id: "4.2",
    category: "k3",
    title: "Ketersediaan Rambu-rambu K3 dan Jalur Evakuasi",
    subtext: "K3 • Rambu & Sarana K3 • 8 evidence wajib",
    requiredEvidence: [
      { id: "k3_evac_sign", label: "Foto rambu jalur evakuasi gempa/kebakaran" },
      { id: "k3_safety_sign", label: "Foto rambu keselamatan kerja (safety sign)" },
      { id: "k3_sop_darurat", label: "Foto SOP Kondisi emergency/darurat (terpasang di dinding)" },
      { id: "k3_sk_tim", label: "SK Tim Tanggap Darurat (terupdate pada tahun berjalan, termasuk SK tim)" },
      { id: "k3_p3k_box", label: "Foto kotak P3K (terpasang di area strategis)" },
      { id: "k3_apd_helm", label: "Foto Helm Safety (disesuaikan dengan jumlah kebutuhan di gudang)" },
      { id: "k3_apd_sepatu", label: "Foto Sepatu Safety / Pelindung Sepatu (disesuaikan dengan jumlah kebutuhan di gudang)" },
      { id: "k3_apd_rompi", label: "Foto Rompi Safety (disesuaikan dengan jumlah kebutuhan di gudang)" }
    ],
    catatan: [
      "Evidence terbagi dua: Rambu-rambu K3 (4 item) dan Sarana K3 (4 item APD + P3K).",
      "SK Tim Tanggap Darurat harus diperbarui setiap tahun berjalan."
    ],
    levels: [
      "Level 1: Tidak ada rambu K3 dan sarana keselamatan",
      "Level 2: Rambu K3 terbatas (1-2 item) dan sarana K3 tidak lengkap",
      "Level 3: Sebagian rambu K3 dan sarana P3K+APD tersedia",
      "Level 4: Rambu K3 (evakuasi, safety sign, SOP, SK Tim) lengkap dan sarana K3 (P3K, APD) tersedia",
      "Level 5: Seluruh 8 evidence rambu dan sarana K3 lengkap terpasang di titik-titik strategis"
    ],
    aiNote: "Periksa tahun SK Tim Tanggap Darurat dan kelayakan APD serta isi P3K."
  },
  {
    id: "4.3",
    category: "k3",
    title: "Ketersediaan Sarana Proteksi Kebakaran (APAR/Hydrant)",
    subtext: "K3 • Keamanan CCTV • 2 evidence wajib",
    requiredEvidence: [
      { id: "k3_cctv_cam", label: "Foto CCTV yang terpasang (di area vital gudang)" },
      { id: "k3_cctv_mon", label: "Foto tampilan layar monitor CCTV (menunjukkan kamera aktif)" }
    ],
    catatan: [
      "CCTV harus mencakup area vital: pintu masuk, penerimaan, penyimpanan, pengeluaran, admin, dan 4 cluster gudang terbuka."
    ],
    levels: [
      "Level 1: Tidak ada sistem CCTV di gudang",
      "Level 2: Kamera CCTV terpasang tapi mati / rusak",
      "Level 3: CCTV aktif tapi hanya mencakup 1-2 area saja",
      "Level 4: CCTV aktif di seluruh area vital namun rekaman < 30 hari",
      "Level 5: CCTV aktif 24 jam di seluruh area vital, kualitas gambar jelas, rekaman minimal 30 hari"
    ],
    aiNote: "Periksa cakupan area pada tampilan layar monitor CCTV."
  },
  {
    id: "4.4",
    category: "k3",
    title: "Ketersediaan Alat Pelindung Diri (APD) Bagi Petugas Gudang",
    subtext: "K3 • Izin Kerja • 2 evidence wajib",
    requiredEvidence: [
      { id: "k3_wp_doc", label: "Working Permit yang ditandatangani pejabat terkait secara lengkap" },
      { id: "k3_wp_foto", label: "Foto Pelaksanaan Pekerjaan untuk 2 Sampling Working Permit" }
    ],
    catatan: [
      "WP wajib diurus untuk pekerjaan berisiko tinggi (angkat beban berat, kelistrikan).",
      "Sampling 2 WP harus dilengkapi foto dokumentasi pelaksanaan pekerjaan di lapangan."
    ],
    levels: [
      "Level 1: Pekerjaan berisiko tinggi dilakukan tanpa Working Permit",
      "Level 2: WP diurus tapi tanda tangan tidak lengkap (kurang pejabat K3)",
      "Level 3: WP lengkap tapi tidak ada dokumentasi foto pelaksanaan",
      "Level 4: WP dan foto lengkap untuk 1 sampling pekerjaan berisiko",
      "Level 5: WP dan foto pengawasan K3 lengkap untuk kedua sampling pekerjaan berisiko"
    ],
    aiNote: "Verifikasi tanda tangan Pejabat K3 pada dokumen WP dan kesesuaian foto dengan jenis pekerjaan."
  },
  {
    id: "4.5",
    category: "k3",
    title: "Implementasi 5S di Area Pergudangan",
    subtext: "K3 • Budaya Kerja • 2 evidence wajib",
    requiredEvidence: [
      { id: "k3_5s_chk", label: "Hasil Checklist Form 5S (penilaian bulanan/berkala)" },
      { id: "k3_5s_foto", label: "3 Sampling Foto implementasi 5S di lapangan gudang" }
    ],
    catatan: [
      "Evaluasi 5S dilakukan rutin bulanan untuk menjaga kerapian gudang.",
      "Wajib melampirkan minimal 3 foto sampling kondisi aktual lapangan."
    ],
    levels: [
      "Level 1: Tidak ada penerapan 5S di gudang",
      "Level 2: Ada pembersihan berkala tapi tanpa checklist 5S formal",
      "Level 3: Checklist 5S bulanan tersedia tapi tanpa foto sampling lapangan",
      "Level 4: Checklist 5S aktif beserta 1-2 foto sampling lapangan",
      "Level 5: Checklist 5S rutin terisi lengkap dengan 3 sampling foto lapangan yang mencerminkan implementasi nyata"
    ],
    aiNote: "Periksa kesesuaian kondisi pada foto sampling dengan skor checklist 5S yang dilampirkan."
  },
  {
    id: "4.6",
    category: "k3",
    title: "Tersedianya Identifikasi Risiko (IBPRP) K3 Lingkungan",
    subtext: "K3 • Manajemen Risiko • 1 evidence wajib",
    requiredEvidence: [
      { id: "k3_risk_doc", label: "Dokumen Profil Risiko Unit (yang memuat risiko pengelolaan logistik material)" }
    ],
    catatan: [
      "Profil risiko unit harus memuat identifikasi dan mitigasi risiko logistik tahun berjalan."
    ],
    levels: [
      "Level 1: Tidak ada dokumen profil risiko unit",
      "Level 2: Dokumen profil risiko ada tapi tidak memuat risiko logistik",
      "Level 3: Profil risiko memuat risiko logistik secara umum tanpa mitigasi terperinci",
      "Level 4: Profil risiko memuat risiko logistik dengan rencana mitigasi jelas",
      "Level 5: Profil risiko terupdate berkala lengkap dengan mitigasi risiko logistik tahun berjalan"
    ],
    aiNote: "Periksa isi dokumen profil risiko pada bagian mitigasi operasional logistik."
  },

  // ─────────────────────────────────────────────────────────────────
  // 5. TEKNOLOGI DAN SISTEM INFORMASI
  // ─────────────────────────────────────────────────────────────────
  {
    id: "5.1",
    category: "teknologi",
    title: "Penyampaian Laporan Rutin Logistik dan Pergudangan",
    subtext: "Teknologi/SI • Integrasi Data Material • 3 evidence wajib",
    requiredEvidence: [
      { id: "it_ams_pdf", label: "PDF Surat Penyampaian AMS dari UPT per bulan / Notulen Konsolidasi Data Logistik (periode semester hingga waktu pelaksanaan assessment)" },
      { id: "it_tableau_material", label: "Screenshoot kesesuaian data material internal unit (spreadsheet) dan data Tableau: a) Material Persediaan pada Dashboard Material Persediaan (3 sampling material), b) Material Cadang pada dashboard monitoring material cadang (3 sampling material)" },
      { id: "it_foto_fisik_material", label: "Foto Sampling material untuk mengecek kesesuaian dengan fisik material" }
    ],
    catatan: [
      "Integrasi data mencakup Material Persediaan (3 sampling) dan Material Cadang (3 sampling) di Tableau.",
      "Foto fisik material wajib dilampirkan untuk membuktikan kesesuaian data dengan kondisi riil."
    ],
    levels: [
      "Level 1: Tidak ada penyampaian data AMS dan tidak ada integrasi Tableau",
      "Level 2: Laporan AMS ada tapi data Tableau tidak sesuai dengan spreadsheet internal",
      "Level 3: Laporan AMS dan konsolidasi data ada, kesesuaian Tableau berkisar 5%-10%",
      "Level 4: Integrasi data berjalan dengan selisih Tableau < 5% untuk sebagian sampling",
      "Level 5: Laporan AMS bulanan, konsolidasi rutin, Tableau akurat (6 sampling material persediaan+cadang) + foto fisik sesuai"
    ],
    aiNote: "Periksa kesesuaian angka kuantitas antara spreadsheet internal dan data Tableau untuk masing-masing sampling material."
  },
  {
    id: "5.2",
    category: "teknologi",
    title: "Penyampaian Evaluasi dan Monitoring Pengelolaan Logistik",
    subtext: "Teknologi/SI • Kapasitas Gudang • 3 evidence wajib",
    requiredEvidence: [
      { id: "it_ams_kapasitas", label: "PDF Surat Penyampaian AMS per bulan / Notulen Konsolidasi Data Logistik (periode semester)" },
      { id: "it_tableau_gudang", label: "Screenshoot kesesuaian Data Gudang (spreadsheet) dan data Tableau: a) % Luas Gudang, Luas Terpakai, Sisa Gudang, Gudang Terpakai, b) Komposisi Material di Gudang (Persediaan, Cadang, Pre Memory, ATTB, Lainnya/Limbah Non B3)" },
      { id: "it_foto_gudang", label: "Foto Sampling Gudang Terbuka dan Gudang Tertutup" }
    ],
    catatan: [
      "Data kapasitas gudang di Tableau harus sinkron dengan spreadsheet internal unit.",
      "Foto sampling gudang terbuka dan tertutup wajib dilampirkan untuk verifikasi fisik."
    ],
    levels: [
      "Level 1: Tidak ada visualisasi kapasitas gudang di Tableau",
      "Level 2: Data kapasitas ada di Tableau tapi tidak sesuai fisik gudang",
      "Level 3: Integrasi Tableau ada dengan akurasi kapasitas berkisar 5%-10% dari fisik",
      "Level 4: Integrasi Tableau berjalan dengan akurasi kapasitas di bawah 5%",
      "Level 5: Tableau terupdate dengan akurasi kapasitas sesuai fisik riil + foto sampling gudang terbuka dan tertutup lengkap"
    ],
    aiNote: "Cocokkan persentase kapasitas (%) di Tableau dengan foto kondisi volume terisi gudang."
  },
  {
    id: "5.3",
    category: "teknologi",
    title: "Digitalisasi Proses Bisnis Pergudangan",
    subtext: "Teknologi/SI • SMAR • 2 evidence wajib",
    requiredEvidence: [
      { id: "it_smar_dash", label: "Screenshoot Penerimaan SMAR menggunakan data penerimaan material di unit tersebut (sampling dari 1 GI/gudang dalam UPT) untuk mengecek kesesuaian jumlah DO yang telah sukses diterima SMAR" },
      { id: "it_smar_periode", label: "Screenshoot Penerimaan MTU di SMAR pada periode semester tersebut" }
    ],
    catatan: [
      "Sampling diambil dari 1 GI/gudang dalam lingkup UPT yang bersangkutan.",
      "Screenshoot harus menunjukkan status DO yang sukses diterima dan rekap periode semester."
    ],
    levels: [
      "Level 1: Penerimaan MTU KHS dilakukan manual (tanpa input SMAR)",
      "Level 2: Akun SMAR ada tapi tidak aktif / tidak pernah digunakan",
      "Level 3: Penerimaan diinput ke SMAR namun sering terlambat (delayed >3 hari)",
      "Level 4: Penerimaan diinput ke SMAR tepat waktu untuk sebagian besar transaksi",
      "Level 5: Seluruh penerimaan MTU KHS terintegrasi lancar di SMAR, status DO sukses, dan rekap periode semester lengkap"
    ],
    aiNote: "Verifikasi kesamaan jumlah DO di SMAR dengan data penerimaan aktual unit."
  },
  {
    id: "5.4",
    category: "teknologi",
    title: "Update Data Material Terintegrasi (Barcode/MIMS/SAP)",
    subtext: "Teknologi/SI • MIMS-AGO • 3 evidence wajib (Sampling 2 Material)",
    requiredEvidence: [
      { id: "it_mims_dash", label: "Screenshoot Aplikasi AGO-MIMS (user logistik dan material terinput di aplikasi)" },
      { id: "it_mims_ba", label: "BA Inspeksi (format dari Aplikasi AGO-MIMS)" },
      { id: "it_mims_store", label: "Foto Penyimpanan Material eks operasi (fisik di lapangan)" }
    ],
    catatan: [
      "Sampling 2 material eks operasi wajib dilampirkan ketiga evidence.",
      "BA Inspeksi harus menggunakan format resmi yang diterbitkan oleh Aplikasi AGO-MIMS."
    ],
    levels: [
      "Level 1: Material eks operasi tidak diinput ke dalam sistem MIMS-AGO",
      "Level 2: Material diinput ke MIMS-AGO tanpa melampirkan BA Inspeksi",
      "Level 3: Material diinput ke MIMS-AGO beserta BA Inspeksi namun belum ada foto fisik",
      "Level 4: Update MIMS-AGO lengkap (screenshoot + BA + foto) untuk 1 sampling material",
      "Level 5: Seluruh 2 sampling material eks-operasi terupdate lengkap di MIMS-AGO (screenshoot, BA format AGO-MIMS, foto fisik)"
    ],
    aiNote: "Validasi apakah BA Inspeksi menggunakan format resmi dari aplikasi AGO-MIMS, bukan format manual."
  }
];
