from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib.colors import HexColor
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, HRFlowable
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_CENTER, TA_LEFT

PLN_BLUE = HexColor("#003087")
GRAY = HexColor("#6b7280")
LIGHT = HexColor("#f1f5f9")

styles = getSampleStyleSheet()
h1 = ParagraphStyle("h1", parent=styles["Title"], fontSize=14, textColor=PLN_BLUE, spaceAfter=2, alignment=TA_CENTER)
h2 = ParagraphStyle("h2", parent=styles["Normal"], fontSize=10.5, textColor=GRAY, alignment=TA_CENTER, spaceAfter=0)
h3 = ParagraphStyle("h3", parent=styles["Normal"], fontSize=9, textColor=GRAY, alignment=TA_CENTER, spaceAfter=10)
sect = ParagraphStyle("sect", parent=styles["Heading2"], fontSize=11.5, textColor=PLN_BLUE, spaceBefore=14, spaceAfter=6)
body = ParagraphStyle("body", parent=styles["Normal"], fontSize=9.5, leading=14)
small = ParagraphStyle("small", parent=styles["Normal"], fontSize=8.5, leading=12.5, textColor=HexColor("#374151"))
label = ParagraphStyle("label", parent=styles["Normal"], fontSize=9.5, textColor=HexColor("#111827"))

doc = SimpleDocTemplate(
    "Form_Pendaftaran_Telegram_Bot_WARNOTO.pdf",
    pagesize=A4,
    topMargin=18*mm, bottomMargin=16*mm, leftMargin=18*mm, rightMargin=18*mm,
)

story = []

story.append(Paragraph("PT PLN (PERSERO) UPT SURABAYA", h1))
story.append(Paragraph("Formulir Pendaftaran Akses WARNOTO Telegram Bot", h2))
story.append(Paragraph("Diisi oleh calon pengguna, dikirim kembali ke Admin WARNOTO untuk diaktifkan", h3))
story.append(HRFlowable(width="100%", thickness=1.2, color=PLN_BLUE, spaceAfter=14))

story.append(Paragraph("Tentang WARNOTO Telegram Bot", sect))
story.append(Paragraph(
    "WARNOTO Telegram Bot adalah asisten chat yang bisa menjawab pertanyaan seputar stok material, "
    "lokasi gudang, dan status SAP/Non-SAP langsung dari Telegram. Untuk menjaga keamanan data, "
    "hanya nomor akun Telegram yang terdaftar (whitelist) yang bisa menggunakan bot ini. "
    "Lengkapi formulir di bawah ini dengan benar, lalu kirimkan ke Admin WARNOTO.",
    body,
))

story.append(Paragraph("Langkah 1 — Cari Tahu User ID Telegram Anda (WAJIB)", sect))
steps = [
    "1. Buka aplikasi Telegram di HP/laptop Anda.",
    "2. Ketik <b>@userinfobot</b> di kolom pencarian, lalu buka bot tersebut.",
    "3. Tekan tombol <b>START</b> (atau ketik /start).",
    "4. Bot akan otomatis membalas dengan data akun Anda, termasuk baris <b>Id</b> berupa deretan angka "
    "(contoh: <b>Id: 123456789</b>).",
    "5. Salin angka tersebut, lalu tuliskan di kolom \"User ID Telegram\" pada formulir di bawah.",
]
for s in steps:
    story.append(Paragraph(s, small))
story.append(Spacer(1, 4))
story.append(Paragraph(
    "Catatan: User ID Telegram BUKAN username (@nama). Wajib berupa angka dari @userinfobot di atas.",
    ParagraphStyle("note", parent=small, textColor=HexColor("#b91c1c"), spaceBefore=4),
))

story.append(Paragraph("Langkah 2 — Isi Data Diri", sect))

def field_row(label_text, height=16):
    return Table(
        [[Paragraph(label_text, label), ""]],
        colWidths=[52*mm, 108*mm],
        rowHeights=[height],
        style=TableStyle([
            ("VALIGN", (0,0), (-1,-1), "BOTTOM"),
            ("LINEBELOW", (1,0), (1,0), 0.8, HexColor("#111827")),
            ("TOPPADDING", (0,0), (-1,-1), 6),
            ("BOTTOMPADDING", (0,0), (-1,-1), 2),
        ]),
    )

fields = [
    "Nama Lengkap",
    "Jabatan / Unit Kerja",
    "Nomor HP (WhatsApp aktif)",
    "Username Telegram (@...)",
    "User ID Telegram (angka, WAJIB — dari @userinfobot)",
    "Tanggal Pengajuan",
]
for f in fields:
    story.append(field_row(f))
    story.append(Spacer(1, 4))

story.append(Spacer(1, 10))
story.append(Paragraph("Tanda Tangan Pemohon", sect))
sig_table = Table(
    [[""]],
    colWidths=[70*mm],
    rowHeights=[26*mm],
    style=TableStyle([
        ("BOX", (0,0), (-1,-1), 0.8, HexColor("#9ca3af")),
        ("BACKGROUND", (0,0), (-1,-1), LIGHT),
    ]),
)
story.append(sig_table)

story.append(Spacer(1, 16))
story.append(HRFlowable(width="100%", thickness=0.6, color=HexColor("#d1d5db"), spaceAfter=6))
story.append(Paragraph(
    "Diisi oleh Admin WARNOTO — JANGAN diisi oleh pemohon",
    ParagraphStyle("adm", parent=small, textColor=GRAY, spaceAfter=4),
))
story.append(field_row("Ditambahkan ke whitelist tanggal", 14))
story.append(Spacer(1, 4))
story.append(field_row("Oleh (nama Admin)", 14))

doc.build(story)
print("done")
