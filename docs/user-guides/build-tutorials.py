from __future__ import annotations

from pathlib import Path
from typing import Iterable

from PIL import Image, ImageDraw, ImageFont, ImageOps
from docx import Document
from docx.enum.section import WD_SECTION
from docx.enum.table import WD_CELL_VERTICAL_ALIGNMENT, WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_BREAK
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Cm, Inches, Pt, RGBColor


ROOT = Path(__file__).resolve().parents[2]
GUIDE_DIR = ROOT / "docs" / "user-guides"
ASSET_DIR = GUIDE_DIR / "assets"
ANNOTATED_DIR = ASSET_DIR / "annotated"
LOGO = ROOT / "src" / "assets" / "Logo_PLN.png"

BLUE = "1246A0"
NAVY = "0B2E63"
LIGHT_BLUE = "EAF2FF"
PALE_BLUE = "F5F8FE"
YELLOW = "F8D117"
GREEN = "16834A"
RED = "C62828"
GRAY = "64748B"
LIGHT_GRAY = "D9E0EA"
BLACK = "000000"
WHITE = "FFFFFF"


def set_cell_shading(cell, fill: str) -> None:
    tc_pr = cell._tc.get_or_add_tcPr()
    shd = tc_pr.find(qn("w:shd"))
    if shd is None:
        shd = OxmlElement("w:shd")
        tc_pr.append(shd)
    shd.set(qn("w:fill"), fill)


def set_cell_border(cell, color: str = LIGHT_GRAY, size: str = "6") -> None:
    tc_pr = cell._tc.get_or_add_tcPr()
    borders = tc_pr.first_child_found_in("w:tcBorders")
    if borders is None:
        borders = OxmlElement("w:tcBorders")
        tc_pr.append(borders)
    for edge in ("top", "left", "bottom", "right", "insideH", "insideV"):
        tag = f"w:{edge}"
        element = borders.find(qn(tag))
        if element is None:
            element = OxmlElement(tag)
            borders.append(element)
        element.set(qn("w:val"), "single")
        element.set(qn("w:sz"), size)
        element.set(qn("w:color"), color)


def set_repeat_table_header(row) -> None:
    tr_pr = row._tr.get_or_add_trPr()
    tbl_header = OxmlElement("w:tblHeader")
    tbl_header.set(qn("w:val"), "true")
    tr_pr.append(tbl_header)


def set_alt_text(inline_shape, title: str, description: str) -> None:
    doc_pr = inline_shape._inline.docPr
    doc_pr.set("title", title)
    doc_pr.set("descr", description)


def add_page_number(paragraph) -> None:
    paragraph.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    run = paragraph.add_run()
    run.font.name = "Arial"
    run.font.size = Pt(8)
    fld_char1 = OxmlElement("w:fldChar")
    fld_char1.set(qn("w:fldCharType"), "begin")
    instr_text = OxmlElement("w:instrText")
    instr_text.set(qn("xml:space"), "preserve")
    instr_text.text = " PAGE "
    fld_char2 = OxmlElement("w:fldChar")
    fld_char2.set(qn("w:fldCharType"), "end")
    run._r.append(fld_char1)
    run._r.append(instr_text)
    run._r.append(fld_char2)


def clear_paragraph_border(paragraph) -> None:
    p_pr = paragraph._p.get_or_add_pPr()
    p_bdr = p_pr.find(qn("w:pBdr"))
    if p_bdr is None:
        p_bdr = OxmlElement("w:pBdr")
        p_pr.append(p_bdr)
    for edge in ("top", "left", "bottom", "right", "between", "bar"):
        tag = f"w:{edge}"
        element = p_bdr.find(qn(tag))
        if element is None:
            element = OxmlElement(tag)
            p_bdr.append(element)
        element.set(qn("w:val"), "nil")


def add_footer_separator(paragraph) -> None:
    p_pr = paragraph._p.get_or_add_pPr()
    p_bdr = p_pr.find(qn("w:pBdr"))
    if p_bdr is None:
        p_bdr = OxmlElement("w:pBdr")
        p_pr.append(p_bdr)
    top = p_bdr.find(qn("w:top"))
    if top is None:
        top = OxmlElement("w:top")
        p_bdr.append(top)
    top.set(qn("w:val"), "single")
    top.set(qn("w:sz"), "4")
    top.set(qn("w:space"), "6")
    top.set(qn("w:color"), LIGHT_GRAY)


def safe_font(size: int):
    candidates = [
        Path("C:/Windows/Fonts/arialbd.ttf"),
        Path("C:/Windows/Fonts/calibrib.ttf"),
    ]
    for candidate in candidates:
        if candidate.exists():
            return ImageFont.truetype(str(candidate), size=size)
    return ImageFont.load_default()


def _stitch_bands(image: Image.Image, bands: list[tuple[float, float]], gap: int = 14) -> tuple[Image.Image, list[tuple[int, int, int]]]:
    """Crop several horizontal bands (orig-frac top/bottom, full width) and stack them
    vertically with a small gap, dropping the empty space between bands. Returns the
    stitched image plus (orig_top_px, orig_bottom_px, stitched_top_px) per band, so
    callers can map an original-image y coordinate into the stitched image."""
    w, h = image.width, image.height
    bands_px = [(int(h * top), int(h * bottom)) for top, bottom in bands]
    total_h = sum(bottom - top for top, bottom in bands_px) + gap * (len(bands_px) - 1)
    stitched = Image.new("RGB", (w, total_h), (244, 246, 251))
    offsets = []
    cursor = 0
    for top, bottom in bands_px:
        stitched.paste(image.crop((0, top, w, bottom)), (0, cursor))
        offsets.append((top, bottom, cursor))
        cursor += (bottom - top) + gap
    return stitched, offsets


def _map_band_y(orig_y_frac: float, orig_h: int, offsets: list[tuple[int, int, int]]) -> int:
    orig_y = orig_h * orig_y_frac
    for top, bottom, new_top in offsets:
        if top <= orig_y <= bottom:
            return int(new_top + (orig_y - top))
    # outside every band: clamp to nearest edge
    first_top, _, first_new = offsets[0]
    if orig_y < first_top:
        return first_new
    last_top, last_bottom, last_new = offsets[-1]
    return last_new + (last_bottom - last_top)


def annotate_image(
    source_name: str,
    output_name: str,
    targets: list[tuple[float, float]],
    crop: tuple[float, float, float, float] | None = None,
    crop_bands: list[tuple[float, float]] | None = None,
) -> Path:
    source = ASSET_DIR / source_name
    image = Image.open(source).convert("RGB")
    if crop_bands:
        orig_h = image.height
        image, offsets = _stitch_bands(image, crop_bands)
        target_points = [(int(image.width * x), _map_band_y(y, orig_h, offsets)) for x, y in targets]
    elif crop:
        left = int(image.width * crop[0])
        top = int(image.height * crop[1])
        right = int(image.width * crop[2])
        bottom = int(image.height * crop[3])
        image = image.crop((left, top, right, bottom))
        target_points = [(int(image.width * x), int(image.height * y)) for x, y in targets]
    else:
        target_points = [(int(image.width * x), int(image.height * y)) for x, y in targets]

    # No on-image markers — clean screenshot only (guidance lives in the step text).
    # `targets` is kept in the signature so crop_bands y-mapping stays available, but
    # nothing is drawn on the image. Subtle 1px frame for a tidy, premium look.
    del target_points
    framed = ImageOps.expand(image, border=1, fill=(217, 224, 234))
    ANNOTATED_DIR.mkdir(parents=True, exist_ok=True)
    output = ANNOTATED_DIR / output_name
    framed.save(output, quality=94, optimize=True)
    return output


ANNOTATIONS = {
    "opname_list": annotate_image("opname-01-daftar.png", "opname-list.png", [(0.50, 0.41), (0.12, 0.88)]),
    "opname_upload": annotate_image("opname-03-upload.png", "opname-upload.png", [(0.50, 0.39), (0.50, 0.47)]),
    "opname_dashboard": annotate_image("opname-02-dashboard.png", "opname-dashboard.png", [(0.13, 0.20), (0.91, 0.95), (0.14, 0.62)]),
    "opname_field": annotate_image("opname-04-mode-lapangan.png", "opname-field.png", [(0.50, 0.32), (0.85, 0.58), (0.85, 0.84)], crop=(0, 0, 1, 0.42)),
    "opname_items": annotate_image("opname-05-daftar-barang.png", "opname-items.png", [(0.68, 0.95), (0.32, 0.24)], crop_bands=[(0, 0.30), (0.87, 1.0)]),
    "opname_qty": annotate_image("opname-06-input-fisik.png", "opname-qty.png", [(0.50, 0.30), (0.49, 0.90)], crop_bands=[(0, 0.36), (0.86, 1.0)]),
    "opname_recon": annotate_image("opname-07-rekonsiliasi.png", "opname-recon.png", [(0.42, 0.70), (0.72, 0.70), (0.91, 0.08)]),
    "approval": annotate_image("approval-01-asman.png", "approval-asman.png", [(0.86, 0.46), (0.09, 0.61), (0.83, 0.61)]),
    "opname_done": annotate_image("opname-08-selesai.png", "opname-done.png", [(0.83, 0.87)]),
    "count_start": annotate_image("stockcount-01-awal.png", "count-start.png", [(0.15, 0.36), (0.48, 0.50)]),
    "count_review": annotate_image("stockcount-02-review-draft.png", "count-review.png", [(0.21, 0.56), (0.73, 0.68), (0.50, 0.92)]),
    "count_history": annotate_image("stockcount-03-riwayat.png", "count-history.png", [(0.17, 0.47), (0.83, 0.55)]),
    "maturity_dashboard": annotate_image("maturity-01-dashboard.png", "maturity-dashboard.png", [(0.17, 0.13), (0.39, 0.21), (0.73, 0.36)]),
    "maturity_list": annotate_image("maturity-02-daftar-audit.png", "maturity-list.png", [(0.50, 0.20), (0.90, 0.61)]),
    "maturity_input": annotate_image("maturity-03-input-audit.png", "maturity-input.png", [(0.20, 0.36), (0.28, 0.56), (0.80, 0.93)]),
    "maturity_evidence": annotate_image("maturity-04-upload-evidence.png", "maturity-evidence.png", [(0.25, 0.30), (0.60, 0.46), (0.84, 0.42)], crop=(0, 0, 1, 0.63)),
    "maturity_exit": annotate_image("maturity-05-konfirmasi-keluar.png", "maturity-exit.png", [(0.46, 0.53), (0.59, 0.55)]),
    "maturity_5s_top": annotate_image("maturity-06-form-5s.png", "maturity-5s-top.png", [(0.20, 0.13), (0.90, 0.33)], crop=(0, 0, 1, 0.54)),
    "maturity_5s_bottom": annotate_image("maturity-06-form-5s.png", "maturity-5s-bottom.png", [(0.84, 0.67), (0.83, 0.91)], crop=(0, 0.48, 1, 1)),
}


def set_run_font(run, name: str = "Arial", size: float | None = None, bold: bool | None = None, color: str | None = None) -> None:
    run.font.name = name
    run._element.get_or_add_rPr().rFonts.set(qn("w:ascii"), name)
    run._element.get_or_add_rPr().rFonts.set(qn("w:hAnsi"), name)
    if size is not None:
        run.font.size = Pt(size)
    if bold is not None:
        run.bold = bold
    if color:
        run.font.color.rgb = RGBColor.from_string(color)


def configure_document(doc: Document, short_title: str) -> None:
    section = doc.sections[0]
    section.page_width = Cm(21)
    section.page_height = Cm(29.7)
    section.top_margin = Cm(1.6)
    section.bottom_margin = Cm(1.5)
    section.left_margin = Cm(1.7)
    section.right_margin = Cm(1.7)

    styles = doc.styles
    normal = styles["Normal"]
    normal.font.name = "Arial"
    normal._element.rPr.rFonts.set(qn("w:ascii"), "Arial")
    normal._element.rPr.rFonts.set(qn("w:hAnsi"), "Arial")
    normal.font.size = Pt(10)
    normal.font.color.rgb = RGBColor.from_string(BLACK)
    normal.paragraph_format.space_after = Pt(5)
    normal.paragraph_format.line_spacing = 1.15

    title = styles["Title"]
    title.font.name = "Arial"
    title.font.size = Pt(24)
    title.font.bold = True
    title.font.color.rgb = RGBColor.from_string(BLACK)
    title.paragraph_format.space_after = Pt(8)

    for style_name, size in (("Heading 1", 17), ("Heading 2", 13), ("Heading 3", 11)):
        style = styles[style_name]
        style.font.name = "Arial"
        style._element.rPr.rFonts.set(qn("w:ascii"), "Arial")
        style._element.rPr.rFonts.set(qn("w:hAnsi"), "Arial")
        style.font.size = Pt(size)
        style.font.bold = True
        style.font.color.rgb = RGBColor.from_string(BLACK)
        style.paragraph_format.keep_with_next = True
        style.paragraph_format.space_before = Pt(12)
        style.paragraph_format.space_after = Pt(5)

    header = section.header
    p = header.paragraphs[0]
    p.alignment = WD_ALIGN_PARAGRAPH.LEFT
    if LOGO.exists():
        shape = p.add_run().add_picture(str(LOGO), width=Cm(0.75))
        set_alt_text(shape, "Logo PLN", "Logo PT PLN (Persero)")
    run = p.add_run(f"  PT PLN (PERSERO)  |  WARNOTO  |  {short_title}")
    set_run_font(run, size=8.5, bold=True, color=NAVY)

    footer = section.footer
    p = footer.paragraphs[0]
    add_footer_separator(p)
    run = p.add_run("Panduan pengguna WARNOTO  |  Data contoh untuk pembelajaran")
    set_run_font(run, size=8, color=GRAY)
    run = p.add_run("  |  Halaman ")
    set_run_font(run, size=8, color=GRAY)
    add_page_number(p)

    doc.core_properties.author = "PT PLN (Persero)"
    doc.core_properties.company = "PT PLN (Persero)"
    doc.core_properties.comments = "Panduan pengguna aplikasi WARNOTO"


def add_cover(doc: Document, title: str, subtitle: str, purpose: str) -> None:
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.paragraph_format.space_before = Pt(26)
    if LOGO.exists():
        shape = p.add_run().add_picture(str(LOGO), width=Cm(2.0))
        set_alt_text(shape, "Logo PLN", "Logo PT PLN (Persero)")
    p = doc.add_paragraph(title, style="Title")
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    clear_paragraph_border(p)
    p = doc.add_paragraph(subtitle)
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    run = p.runs[0]
    set_run_font(run, size=12, bold=True, color=NAVY)
    p.paragraph_format.space_after = Pt(20)
    p = doc.add_paragraph(purpose)
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.paragraph_format.left_indent = Cm(1.4)
    p.paragraph_format.right_indent = Cm(1.4)
    doc.add_paragraph()
    table = doc.add_table(rows=3, cols=2)
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    table.autofit = False
    rows = [
        ("Sasaran pengguna", "UPT pelaksana kegiatan gudang"),
        ("Aplikasi", "WARNOTO"),
        ("Versi panduan", "September 2026"),
    ]
    for index, (label, value) in enumerate(rows):
        table.cell(index, 0).width = Cm(4.2)
        table.cell(index, 1).width = Cm(10.0)
        table.cell(index, 0).text = label
        table.cell(index, 1).text = value
        set_cell_shading(table.cell(index, 0), LIGHT_BLUE)
        for cell in table.rows[index].cells:
            set_cell_border(cell)
            cell.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER
            for paragraph in cell.paragraphs:
                paragraph.paragraph_format.space_after = Pt(0)
                for run in paragraph.runs:
                    set_run_font(run, size=9.5, bold=(cell is table.cell(index, 0)))
    doc.add_page_break()


def add_heading(doc: Document, text: str, level: int = 1) -> None:
    doc.add_heading(text, level=level)


def add_para(doc: Document, text: str, bold_lead: str | None = None) -> None:
    p = doc.add_paragraph()
    if bold_lead and text.startswith(bold_lead):
        lead = p.add_run(bold_lead)
        set_run_font(lead, bold=True)
        rest = p.add_run(text[len(bold_lead):])
        set_run_font(rest)
    else:
        run = p.add_run(text)
        set_run_font(run)


def add_bullets(doc: Document, items: Iterable[str]) -> None:
    for item in items:
        p = doc.add_paragraph(style="List Bullet")
        p.paragraph_format.space_after = Pt(3)
        set_run_font(p.add_run(item))


def add_numbered(doc: Document, items: Iterable[str]) -> None:
    for item in items:
        p = doc.add_paragraph(style="List Number")
        p.paragraph_format.space_after = Pt(4)
        set_run_font(p.add_run(item))


def add_table(doc: Document, headers: list[str], rows: list[list[str]], widths: list[float] | None = None) -> None:
    table = doc.add_table(rows=1, cols=len(headers))
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    table.autofit = False
    set_repeat_table_header(table.rows[0])
    for index, header in enumerate(headers):
        cell = table.rows[0].cells[index]
        cell.text = header
        set_cell_shading(cell, NAVY)
        set_cell_border(cell)
        cell.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER
        if widths:
            cell.width = Cm(widths[index])
        for paragraph in cell.paragraphs:
            paragraph.alignment = WD_ALIGN_PARAGRAPH.CENTER
            paragraph.paragraph_format.space_after = Pt(0)
            for run in paragraph.runs:
                set_run_font(run, size=9, bold=True, color=WHITE)
    for row_index, values in enumerate(rows):
        cells = table.add_row().cells
        for index, value in enumerate(values):
            cells[index].text = value
            set_cell_border(cells[index])
            set_cell_shading(cells[index], PALE_BLUE if row_index % 2 else WHITE)
            cells[index].vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER
            if widths:
                cells[index].width = Cm(widths[index])
            for paragraph in cells[index].paragraphs:
                paragraph.paragraph_format.space_after = Pt(0)
                paragraph.alignment = WD_ALIGN_PARAGRAPH.CENTER if index == 0 and len(headers) > 2 else WD_ALIGN_PARAGRAPH.LEFT
                for run in paragraph.runs:
                    set_run_font(run, size=8.8)
    doc.add_paragraph().paragraph_format.space_after = Pt(0)


def add_figure(doc: Document, key: str, caption: str, alt: str, width_cm: float = 16.8) -> None:
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.paragraph_format.keep_with_next = True
    p.paragraph_format.space_before = Pt(5)
    shape = p.add_run().add_picture(str(ANNOTATIONS[key]), width=Cm(width_cm))
    set_alt_text(shape, caption, alt)
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.paragraph_format.keep_with_next = False
    p.paragraph_format.space_after = Pt(7)
    run = p.add_run(caption)
    set_run_font(run, size=8.5, bold=True, color=GRAY)


def add_figure_row(doc: Document, items: list[tuple[str, str, str]], width_cm: float = 8.2) -> None:
    """Place figures side by side (2 columns) so mobile screenshots don't waste a
    half-empty page. Each item is (annotation_key, caption, alt_text)."""
    table = doc.add_table(rows=2, cols=len(items))
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    table.autofit = False
    for col, (key, caption, alt) in enumerate(items):
        pic_cell = table.cell(0, col)
        set_cell_border(pic_cell, color=WHITE, size="2")
        pic_cell.width = Cm(width_cm)
        p = pic_cell.paragraphs[0]
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        p.paragraph_format.keep_with_next = True
        shape = p.add_run().add_picture(str(ANNOTATIONS[key]), width=Cm(width_cm - 0.4))
        set_alt_text(shape, caption, alt)

        cap_cell = table.cell(1, col)
        set_cell_border(cap_cell, color=WHITE, size="2")
        cap_cell.width = Cm(width_cm)
        p = cap_cell.paragraphs[0]
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        p.paragraph_format.space_after = Pt(7)
        run = p.add_run(caption)
        set_run_font(run, size=8.5, bold=True, color=GRAY)
    doc.add_paragraph().paragraph_format.space_after = Pt(0)


def add_step(doc: Document, number: int, title: str, body: str, bullets: list[str] | None = None) -> None:
    p = doc.add_paragraph(style="Heading 2")
    run = p.add_run(f"Langkah {number}  {title}")
    set_run_font(run, size=13, bold=True, color=BLACK)
    add_para(doc, body)
    if bullets:
        add_bullets(doc, bullets)


def add_checklist(doc: Document, title: str, items: list[str]) -> None:
    add_heading(doc, title, 1)
    for item in items:
        p = doc.add_paragraph()
        p.paragraph_format.left_indent = Cm(0.2)
        run = p.add_run("☐  ")
        set_run_font(run, size=11, bold=True, color=BLUE)
        set_run_font(p.add_run(item), size=9.8)


def save_document(doc: Document, filename: str) -> Path:
    output = GUIDE_DIR / filename
    doc.save(output)
    return output


def build_stock_opname() -> Path:
    doc = Document()
    configure_document(doc, "STOCK OPNAME")
    add_cover(
        doc,
        "Panduan Pelaksanaan Stock Opname Gudang di WARNOTO",
        "Alur TL Logistik dan Approval Asman",
        "Panduan ini membantu TL Logistik UPT menjalankan penghitungan fisik, rekonsiliasi, dan pengiriman hasil Stock Opname untuk di-approve Asman, hingga pencetakan dokumen hasil tanpa kehilangan perubahan data.",
    )
    add_heading(doc, "Tujuan dan hasil akhir")
    add_para(doc, "Stock Opname membandingkan jumlah menurut aplikasi, jumlah SAP, dan jumlah fisik di gudang. Proses selesai setelah Asman menyetujui hasil. WARNOTO kemudian menyesuaikan Data Stok, mencatat histori pada Kartu Gantung, melepaskan freeze gudang, dan membuka pencetakan BA serta TUG-15.")
    add_table(doc, ["Peran", "Tanggung jawab"], [
        ["TL Logistik (pelaksana)", "Upload data SAP, memilih gudang, menghitung fisik, melengkapi selisih, menyimpan draft, dan mengirim hasil ke Asman."],
        ["Petugas lapangan", "Menghitung barang per blok melalui Mode Lapangan, scanner, atau kamera."],
        ["Asman", "Memeriksa hasil, menyetujui, atau menolak dengan alasan."],
    ], [4.4, 12.0])
    add_heading(doc, "Persiapan sebelum mulai")
    add_bullets(doc, [
        "Siapkan file CSV/XLSX hasil ekspor SAP MM dengan format PEMAT_DDMMYYYY.",
        "Pastikan Master Gudang, Blok Lokasi, Master Katalog, dan Data Stok sudah benar.",
        "Pastikan tidak ada sesi Draft lain untuk gudang dan periode yang sama.",
        "Koordinasikan penghentian transaksi TUG karena gudang akan di-freeze saat hitung fisik dimulai.",
        "Gunakan jaringan stabil. Draft lokal tetap membantu pemulihan bila halaman tertutup, tetapi sinkronisasi server tetap harus dipastikan.",
    ])
    add_heading(doc, "Ringkasan alur")
    add_numbered(doc, [
        "Upload file SAP dan pilih gudang.",
        "Aktifkan atau pastikan freeze gudang berjalan.",
        "Hitung fisik setiap material per blok.",
        "Lakukan hitung ulang untuk setiap selisih.",
        "Lengkapi rekonsiliasi dan keterangan.",
        "Kirim hasil kepada Asman.",
        "Setelah disetujui, cetak BA dan TUG-15.",
    ])
    doc.add_page_break()

    add_heading(doc, "Pelaksanaan oleh TL")
    add_step(doc, 1, "Buka menu dan pilih sesi", "Buka Stock Opname & Count, lalu pilih Stock Opname. Jika sesi sudah pernah dibuat, klik Lanjutkan draft atau Edit. Jika belum, gunakan zona upload file PID.")
    add_figure(doc, "opname_list", "Gambar 1  Daftar Stock Opname dan sesi Draft", "Penanda 1 menunjukkan tombol melanjutkan draft. Penanda 2 menunjukkan riwayat sesi dan tombol Edit.")
    add_step(doc, 2, "Upload file SAP", "Tarik file ke zona upload atau klik Pilih File. Sistem membaca CSV/XLSX dan membuat Draft setelah file berhasil diproses.", [
        "Periksa nama file dan periode sebelum memilih.",
        "Jika file berisi beberapa gudang, pilih gudang yang akan dibuatkan sesi.",
        "Satu sesi Draft dibuat untuk setiap gudang terpilih.",
    ])
    add_figure(doc, "opname_upload", "Gambar 2  Zona upload file SAP", "Penanda 1 menunjukkan zona tarik dan lepas. Penanda 2 menunjukkan tombol Pilih File.")

    add_step(doc, 3, "Periksa dashboard dan freeze gudang", "Pastikan periode, jumlah item, blok, dan data SAP sudah sesuai. Saat penghitungan fisik dimulai, gudang terpilih diblokir untuk transaksi TUG masuk maupun keluar. Freeze dilepas setelah opname selesai atau ditolak.", [
        "Gunakan Lembar Hitung bila tim membutuhkan formulir cetak.",
        "Klik Mulai Hitung untuk penghitungan pertama.",
        "Klik Mode Lapangan untuk tampilan yang lebih sederhana di HP.",
        "Klik Simpan Draft sebelum berpindah perangkat atau berhenti bekerja.",
    ])
    add_figure(doc, "opname_dashboard", "Gambar 3  Dashboard sesi dan kontrol penghitungan", "Penanda 1 menunjukkan freeze gudang. Penanda 2 menunjukkan tombol mulai dan Mode Lapangan. Penanda 3 menunjukkan progres item.")
    add_step(doc, 4, "Pilih blok di Mode Lapangan", "Pada HP, pilih Scan QR Blok atau pilih blok secara manual. Angka pada setiap kartu menunjukkan jumlah item yang sudah dihitung dibanding total item di blok tersebut.")
    add_figure(doc, "opname_field", "Gambar 4  Pemilihan blok pada Mode Lapangan", "Penanda 1 menunjukkan scan QR blok. Penanda 2 dan 3 menunjukkan blok yang dapat dipilih manual.", width_cm=8.1)

    add_step(doc, 5, "Pilih barang dan masukkan jumlah fisik", "Buka material pada blok aktif. Hitung barang secara langsung, masukkan Qty Hasil Hitung Fisik, lalu simpan.", [
        "Gunakan Tandai Nihil jika barang tidak ditemukan.",
        "Gunakan Scan Barang untuk mencari material melalui kode.",
        "Jika barang ditemukan di blok berbeda, gunakan Catat di Blok Ini.",
        "Jika material tidak ada dalam daftar, gunakan Tambah Material Ditemukan.",
    ])
    add_figure_row(doc, [
        ("opname_items", "Gambar 5  Daftar barang pada blok aktif", "Penanda 1 menunjukkan scan barang. Penanda 2 menunjukkan material yang dipilih untuk dihitung."),
        ("opname_qty", "Gambar 6  Input jumlah fisik", "Penanda 1 menunjukkan kolom Qty Hasil Hitung Fisik. Penanda 2 menunjukkan tombol simpan."),
    ])
    add_step(doc, 6, "Selesaikan hitung ulang selisih", "Jika jumlah fisik berbeda dari sistem atau SAP, WARNOTO memasukkan item ke antrian Hitung Ulang. Masukkan hitungan kedua dan konfirmasi. Hasil tidak dapat dikirim sebelum seluruh selisih dikonfirmasi.")
    add_para(doc, "Penting: hitung ulang harus dilakukan dari kondisi fisik barang. Jangan menyalin angka hitungan pertama tanpa pemeriksaan ulang.", bold_lead="Penting:")
    doc.add_page_break()

    add_step(doc, 7, "Periksa rekonsiliasi", "Setelah semua blok selesai, buka rekonsiliasi. Periksa Qty Sistem, Qty SAP, Qty Fisik, Selisih, Status, dan Keterangan.", [
        "Keterangan wajib diisi untuk setiap item berselisih.",
        "Untuk sesi Non-SAP, Gudang dan Blok wajib terisi untuk setiap material.",
        "Gunakan foto bila diperlukan untuk memperjelas kondisi material.",
        "Klik Simpan Draft jika pemeriksaan belum selesai.",
    ])
    add_figure(doc, "opname_recon", "Gambar 7  Rekonsiliasi hasil Stock Opname", "Penanda 1 menunjukkan Qty Sistem, SAP, dan Fisik. Penanda 2 menunjukkan selisih dan keterangan. Penanda 3 menunjukkan Lembar Hitung dan kembali ke daftar.")
    add_step(doc, 8, "Kirim hasil kepada Asman", "Klik Submit ke Asman setelah semua item terhitung, semua selisih memiliki keterangan, dan hitung ulang selesai. Status berubah menjadi Menunggu Asman.")

    add_heading(doc, "Pemeriksaan dan approval Asman")
    add_para(doc, "Asman membuka menu Approval. Pada bagian Stock Opname, periksa jumlah item, jumlah selisih, pengaju, dan waktu pengajuan.")
    add_bullets(doc, [
        "Klik Setuju untuk menyelesaikan opname.",
        "Klik Tolak bila hasil harus diperbaiki. Alasan penolakan wajib diisi agar TL memahami revisi.",
        "Approval final menyesuaikan Data Stok, menambah histori Kartu Gantung, dan melepaskan freeze gudang.",
    ])
    add_figure(doc, "approval", "Gambar 8  Antrian approval Asman", "Penanda 1 menunjukkan tombol Setuju atau Tolak Stock Opname. Penanda 2 menunjukkan item Stock Count. Penanda 3 menunjukkan persetujuan terpilih.")
    doc.add_page_break()

    add_heading(doc, "Penyelesaian dan dokumen hasil")
    add_para(doc, "Setelah status menjadi Selesai, buka daftar Stock Opname dan klik Cetak BA + TUG-15. Lengkapi susunan tim, PID, tanggal, dan pejabat Mengetahui sebelum mencetak.")
    add_figure(doc, "opname_done", "Gambar 9  Sesi selesai dan pencetakan BA serta TUG-15", "Penanda 1 menunjukkan tombol Cetak BA dan TUG-15.")

    add_heading(doc, "Masalah umum dan tindakan")
    add_table(doc, ["Masalah", "Tindakan"], [
        ["File tidak terbaca", "Pastikan format CSV/XLSX, header SAP, dan ukuran file sesuai. Ekspor ulang bila perlu."],
        ["Blok tidak muncul", "Periksa hubungan material dengan Master Gudang dan Blok Lokasi."],
        ["Submit ditolak sistem", "Lengkapi qty fisik, keterangan selisih, lokasi Non-SAP, dan hitung ulang."],
        ["Draft belum tersinkron", "Pastikan jaringan aktif, buka kembali sesi, lalu klik Simpan Draft."],
        ["Hasil ditolak Asman", "Baca alasan penolakan, perbaiki data atau evidence, lalu kirim ulang."],
        ["Transaksi TUG terblokir", "Ini perilaku freeze yang benar. Selesaikan atau batalkan opname melalui alur resmi."],
    ], [5.0, 11.4])

    doc.add_page_break()
    add_checklist(doc, "Checklist sebelum dinyatakan selesai", [
        "Semua blok dan semua material sudah dihitung.",
        "Semua selisih sudah dihitung ulang.",
        "Semua selisih memiliki keterangan yang jelas.",
        "Sesi Non-SAP memiliki gudang dan blok untuk seluruh item.",
        "Draft sudah tersimpan dan berhasil dikirim kepada Asman.",
        "Asman sudah memberikan keputusan final.",
        "BA dan TUG-15 sudah dicetak atau disimpan sesuai kebutuhan UPT.",
        "Freeze gudang sudah terlepas setelah sesi selesai atau ditolak.",
    ])
    return save_document(doc, "Panduan Stock Opname Gudang - WARNOTO.docx")


def build_stock_count() -> Path:
    doc = Document()
    configure_document(doc, "STOCK COUNT")
    add_cover(
        doc,
        "Panduan Pelaksanaan Stock Count Gudang di WARNOTO",
        "Perbandingan SAP dan Aplikasi",
        "Panduan ini membantu UPT membandingkan jumlah SAP dengan Data Stok WARNOTO, meninjau temuan, memilih rekomendasi, dan meminta keputusan Asman tanpa menjalankan perubahan stok otomatis.",
    )
    add_heading(doc, "Tujuan dan batas proses")
    add_para(doc, "Stock Count adalah pemeriksaan berbasis file SAP. WARNOTO membaca dan membandingkan data, tetapi tidak langsung mengubah Data Stok. Temuan selisih dikirim kepada Asman untuk divalidasi. Rekomendasi tindak lanjut tetap harus dijalankan melalui proses operasional yang sesuai.")
    add_table(doc, ["Stock Count", "Stock Opname"], [
        ["Membandingkan Qty SAP dan Qty Aplikasi.", "Membandingkan Qty Sistem, SAP, dan hasil fisik."],
        ["Tidak memerlukan hitung fisik dalam alur ini.", "Wajib melakukan hitung fisik per blok."],
        ["Approval memvalidasi temuan, tidak otomatis mengubah stok.", "Approval final menyesuaikan Data Stok."],
        ["Tindak lanjut rekomendasi dilakukan manual.", "Hasil akhir menghasilkan BA dan TUG-15."],
    ], [8.2, 8.2])
    add_heading(doc, "Persiapan")
    add_bullets(doc, [
        "Siapkan file CSV/XLSX SAP terbaru.",
        "Pastikan kode material pada file sama dengan Master Katalog.",
        "Pastikan Data Stok sudah tersinkron sebelum membandingkan.",
        "Gunakan akun yang memiliki izin import.",
    ])
    doc.add_page_break()

    add_heading(doc, "Pelaksanaan oleh Operator")
    add_step(doc, 1, "Buka Stock Count dan upload file", "Buka Stock Opname & Count, pilih Stock Count, lalu klik Upload CSV/XLSX SAP. Halaman menegaskan bahwa proses hanya membaca dan membandingkan data.")
    add_figure(doc, "count_start", "Gambar 1  Halaman awal Stock Count", "Penanda 1 menunjukkan tombol upload. Penanda 2 menunjukkan informasi bahwa proses tidak mengubah data.")
    add_step(doc, 2, "Periksa Draft Review", "Setelah file dibaca, WARNOTO menampilkan Review Draft. Tahap ini belum tersimpan dan belum terlihat oleh Asman.", [
        "Centang item yang akan disertakan.",
        "Periksa Total Item, Akurat, Selisih, dan Belum Terdaftar.",
        "Cocokkan Nama Barang dan No. Katalog sebelum membaca qty.",
        "Item akurat tetap ditampilkan sebagai informasi dan tidak masuk antrian approval.",
    ])
    add_figure(doc, "count_review", "Gambar 2  Draft Review Stock Count", "Penanda 1 menunjukkan kolom perbandingan. Penanda 2 menunjukkan rekomendasi. Penanda 3 menunjukkan tombol simpan dan kirim.")
    doc.add_page_break()

    add_heading(doc, "Membaca hasil perbandingan")
    add_table(doc, ["Status", "Makna", "Tindakan awal"], [
        ["Akurat", "Selisih masih dalam toleransi 5 persen.", "Tidak membutuhkan approval; simpan sebagai informasi."],
        ["App Kurang", "Qty Aplikasi lebih kecil daripada Qty SAP.", "Periksa transaksi masuk dan kemungkinan stok belum tercatat."],
        ["App Lebih", "Qty Aplikasi lebih besar daripada Qty SAP.", "Periksa pemakaian atau pengeluaran yang belum tercatat."],
        ["Belum Terdaftar", "Kode material belum ditemukan di Master Katalog.", "Verifikasi kode dan tindak lanjuti melalui prosedur master data."],
    ], [3.2, 6.7, 6.5])
    add_heading(doc, "Memilih rekomendasi")
    add_table(doc, ["Rekomendasi", "Gunakan ketika", "Catatan"], [
        ["Tambah stok di Aplikasi", "Qty Aplikasi kurang atau material perlu dicatat.", "Tetap verifikasi dokumen sumber sebelum menambah stok."],
        ["Buat TUG Keluar", "Ada kemungkinan pemakaian belum dicatat.", "Buat transaksi TUG melalui menu yang sesuai."],
        ["Tidak ada tindakan", "SAP belum diproses atau selisih belum membutuhkan tindakan.", "Tuliskan dasar keputusan pada catatan operasional bila diperlukan."],
    ], [4.4, 6.3, 5.7])
    add_para(doc, "Penting: pilihan rekomendasi hanya saran. Menyetujui temuan tidak membuat TUG dan tidak menambah atau mengurangi stok secara otomatis.", bold_lead="Penting:")

    add_step(doc, 3, "Simpan dan kirim kepada Asman", "Setelah seluruh item diperiksa, klik Simpan & Kirim ke Asman. Hanya item yang dicentang yang disimpan. Temuan selisih berstatus Pending dan masuk ke menu Approval.")
    add_step(doc, 4, "Periksa riwayat sesi", "Riwayat menampilkan akurasi, jumlah item akurat, jumlah temuan, dan status approval setiap item.")
    add_figure(doc, "count_history", "Gambar 3  Ringkasan dan riwayat sesi Stock Count", "Penanda 1 menunjukkan ringkasan sesi. Penanda 2 menunjukkan status temuan dan rekomendasi.")
    doc.add_page_break()

    add_heading(doc, "Approval oleh Asman")
    add_para(doc, "Asman membuka menu Approval dan memilih kategori Stock Count. Setiap baris menampilkan No. Katalog, Qty SAP, Qty Aplikasi, selisih, persentase, dan tanggal upload.")
    add_numbered(doc, [
        "Centang satu atau beberapa temuan yang benar.",
        "Klik Setuju terpilih untuk menyetujui secara kelompok.",
        "Klik Tolak pada item yang tidak valid, kemudian isi alasan penolakan.",
        "Setelah keputusan, koordinasikan tindak lanjut rekomendasi melalui transaksi atau master data yang sesuai.",
    ])
    add_figure(doc, "approval", "Gambar 4  Approval Stock Count oleh Asman", "Penanda 1 menunjukkan approval Stock Opname. Penanda 2 menunjukkan checkbox temuan Stock Count. Penanda 3 menunjukkan Setuju terpilih.")

    add_heading(doc, "Masalah umum dan tindakan")
    add_table(doc, ["Masalah", "Tindakan"], [
        ["Semua Qty Aplikasi nol", "Pastikan material aplikasi berstatus SAP dan kode katalog cocok dengan file."],
        ["Material belum terdaftar", "Periksa salah ketik kode. Jika benar material baru, tindak lanjuti Master Katalog."],
        ["Rekomendasi tidak sesuai", "Ubah rekomendasi pada Draft Review sebelum dikirim."],
        ["Item tidak perlu dikirim", "Hilangkan centang item pada Draft Review."],
        ["Temuan ditolak", "Baca alasan Asman, verifikasi sumber data, lalu lakukan Stock Count baru bila diperlukan."],
    ], [5.2, 11.2])
    add_checklist(doc, "Checklist penyelesaian", [
        "File SAP yang digunakan adalah versi terbaru.",
        "Kode material dan satuan sudah diperiksa.",
        "Item yang tidak relevan sudah dikeluarkan dari Draft Review.",
        "Rekomendasi setiap temuan sudah sesuai.",
        "Sesi berhasil dikirim kepada Asman.",
        "Asman sudah menyetujui atau menolak seluruh temuan.",
        "Tindak lanjut rekomendasi sudah dikoordinasikan melalui proses resmi.",
    ])
    return save_document(doc, "Panduan Stock Count Gudang - WARNOTO.docx")


def build_maturity() -> Path:
    doc = Document()
    configure_document(doc, "MATURITY LEVEL")
    add_cover(
        doc,
        "Panduan Pengisian Maturity Level Gudang di WARNOTO",
        "Guideline UPT untuk Evidence dan Form 5S",
        "Panduan ini membantu Admin dan TL UPT membuat audit, melengkapi evidence, memantau review UIT, mengisi Form 5S, menyimpan perubahan, dan mengajukan penilaian final ke Pusat.",
    )
    add_heading(doc, "Pengguna dan alur kewenangan")
    add_table(doc, ["Jenjang", "Kewenangan utama"], [
        ["UPT  Admin atau TL", "Membuat audit, memilih jenis gudang, mengunggah evidence, mengisi Form 5S, menyimpan draft, dan mengajukan penilaian final."],
        ["UIT", "Memeriksa setiap evidence, memberi status Checked atau Rejected, dan meminta revisi."],
        ["Pusat", "Memberi nilai final 1 sampai 5, meminta revisi, atau melakukan Finalisasi dan Simpan."],
        ["Asman atau Manager UPT", "Akses baca untuk memantau hasil."],
    ], [4.0, 12.4])
    add_heading(doc, "Aturan utama sebelum mengisi")
    add_bullets(doc, [
        "Audit baru hanya dapat dibuat satu kali per bulan untuk setiap UPT.",
        "Isi kedua jenis gudang yang berlaku: Gudang Persediaan dan Gudang ATTB/MRWI.",
        "Evidence harus sesuai nama persyaratan dan kriteria checker.",
        "Ukuran maksimal setiap berkas adalah 25 MB. Format yang didukung ditampilkan pada detail evidence.",
        "Form Pengisian 5S bulan berjalan wajib disimpan sebelum pengajuan final.",
        "Evidence yang diganti setelah Checked harus diperiksa kembali oleh UIT.",
    ])
    add_heading(doc, "Ringkasan alur UPT")
    add_numbered(doc, [
        "Pilih UPT aktif dan buka Pelaksanaan Audit.",
        "Buat audit baru.",
        "Pilih jenis gudang, kategori, dan aspek.",
        "Upload semua evidence wajib.",
        "Pantau status review UIT dan perbaiki evidence yang ditolak.",
        "Isi dan simpan Form Pengisian 5S.",
        "Simpan Draft selama proses berjalan.",
        "Ajukan Penilaian Final ke Pusat setelah seluruh gate terpenuhi.",
    ])
    doc.add_page_break()

    add_heading(doc, "Tahapan pengisian oleh UPT")
    add_step(doc, 1, "Buka Penilaian Maturity", "Pilih menu Penilaian Maturity. Pastikan nama UPT aktif sudah benar. Dashboard menampilkan status audit, Level Maturity, progres evidence, dan riwayat.")
    add_figure(doc, "maturity_dashboard", "Gambar 1  Dashboard Penilaian Maturity", "Penanda 1 menunjukkan UPT aktif. Penanda 2 menunjukkan tab Pelaksanaan Audit. Penanda 3 menunjukkan progres pengisian.")
    add_step(doc, 2, "Buka Pelaksanaan Audit dan buat audit", "Klik Pelaksanaan Audit, lalu klik + Audit Baru. Jika audit bulan berjalan sudah ada, tombol Audit Baru dinonaktifkan; klik Input pada audit yang tersedia.")
    add_figure(doc, "maturity_list", "Gambar 2  Daftar audit dan tombol Audit Baru", "Penanda 1 menunjukkan tab Pelaksanaan Audit. Penanda 2 menunjukkan tombol Audit Baru.")

    add_step(doc, 3, "Pilih jenis gudang, kategori, dan aspek", "Pada editor audit, pilih Gudang Persediaan atau Gudang ATTB/MRWI. Pilih kategori Tata Kelola, Tenaga Kerja, Sarana Prasarana, K3, atau Teknologi/SI. Klik Kelola Evidence pada aspek yang akan dikerjakan.", [
        "Kelengkapan Dokumen menunjukkan jumlah aspek yang sudah lengkap.",
        "Progress Review menunjukkan jumlah aspek yang sudah diperiksa.",
        "Skor Terlihat menampilkan skor sesuai peran yang sedang melihat.",
        "Gunakan Berikut untuk membuka halaman aspek selanjutnya.",
    ])
    add_figure(doc, "maturity_input", "Gambar 3  Editor audit dan daftar aspek", "Penanda 1 menunjukkan jenis gudang. Penanda 2 menunjukkan kategori dan Kelola Evidence. Penanda 3 menunjukkan Simpan Draft serta pengajuan final.", width_cm=13.5)
    add_step(doc, 4, "Upload evidence wajib", "Buka suatu aspek. Baca nama evidence, Catatan Evidence, dan bagian Yang harus diperiksa checker. Klik Pilih File atau Foto untuk mengunggah bukti.", [
        "Gunakan dokumen periode berjalan dan pastikan tanggal terlihat.",
        "Gunakan foto yang jelas, tidak buram, dan memperlihatkan objek yang dinilai.",
        "Untuk persyaratan dengan Pilihan A atau Pilihan B, ikuti satu jalur secara lengkap.",
        "Tunggu proses upload selesai sebelum menyimpan atau keluar.",
    ])
    add_figure(doc, "maturity_evidence", "Gambar 4  Detail aspek dan area upload evidence", "Penanda 1 menunjukkan identitas aspek. Penanda 2 menunjukkan tombol upload. Penanda 3 menunjukkan kriteria level dan Catatan Evidence.", width_cm=15.2)

    add_heading(doc, "Memahami status evidence")
    add_table(doc, ["Status", "Arti", "Tindakan UPT"], [
        ["Menunggu Review", "Evidence sudah tersedia tetapi belum diputuskan UIT.", "Tunggu pemeriksaan. Jangan mengganti berkas tanpa alasan."],
        ["Checked", "Evidence telah dinyatakan sesuai oleh UIT.", "Pertahankan berkas. Perubahan baru akan membuka review ulang."],
        ["Rejected", "Evidence tidak memenuhi persyaratan.", "Baca alasan, siapkan bukti pengganti, lalu upload ulang."],
    ], [3.5, 6.2, 6.7])
    add_para(doc, "Evidence yang sudah Checked akan terkunci untuk UPT. Jika bukti terbaru memang diperlukan, koordinasikan pembukaan revisi melalui UIT.")

    add_step(doc, 5, "Isi Form Pengisian 5S", "Buka tab Form Pengisian 5S. Pilih periode bulan, tahun, gudang atau lokasi, dan periksa nama auditor. Centang setiap indikator yang benar-benar terpenuhi.", [
        "Lengkapi kelompok Sort, Set in Order, Shine, Standardize, dan Sustain.",
        "Isi catatan temuan atau tindak lanjut secara spesifik.",
        "Upload tiga foto sampling implementasi 5S.",
        "Klik Simpan Checklist setelah data lengkap.",
    ])
    add_figure(doc, "maturity_5s_top", "Gambar 5  Data pengisian dan checklist 5S", "Penanda 1 menunjukkan periode dan gudang. Penanda 2 menunjukkan kolom checklist.", width_cm=14.2)
    add_figure(doc, "maturity_5s_bottom", "Gambar 6  Foto sampling dan penyimpanan Form 5S", "Penanda 1 menunjukkan area foto sampling. Penanda 2 menunjukkan tombol Simpan Checklist.", width_cm=14.2)

    add_step(doc, 6, "Simpan perubahan selama pengisian", "WARNOTO menampilkan waktu Tersimpan otomatis selama Anda mengisi. Tetap gunakan Simpan Draft pada akhir satu kelompok pekerjaan atau sebelum berhenti.")
    add_para(doc, "Jangan menutup browser ketika indikator upload masih berjalan. Tombol simpan dan keluar dinonaktifkan selama upload aktif untuk mencegah evidence hilang.")
    add_step(doc, 7, "Keluar dengan aman", "Klik Kembali ke Daftar atau Batal. Jika ada perubahan, WARNOTO menampilkan konfirmasi.", [
        "Pilih Ya, Simpan & Keluar untuk menunggu upload selesai, menyimpan update, lalu kembali ke daftar.",
        "Pilih Tidak, Tetap di Input untuk membatalkan keluar dan melanjutkan pengisian.",
        "Jika upload gagal, proses keluar dibatalkan dan pesan error ditampilkan. Perbaiki upload terlebih dahulu.",
    ])
    add_figure(doc, "maturity_exit", "Gambar 7  Konfirmasi keluar dari input", "Penanda 1 menunjukkan pilihan tetap di input. Penanda 2 menunjukkan Simpan dan Keluar.")

    add_step(doc, 8, "Ajukan Penilaian Final ke Pusat", "Klik Ajukan Penilaian Final ke Pusat hanya setelah seluruh evidence lengkap, semua item sudah Checked oleh UIT, dan Form 5S bulan berjalan tersimpan. Bila salah satu syarat belum terpenuhi, sistem menampilkan peringatan dan tidak mengirim audit.")
    add_figure(doc, "maturity_input", "Gambar 8  Tombol Simpan Draft dan pengajuan final", "Penanda 1 menunjukkan jenis gudang. Penanda 2 menunjukkan daftar aspek. Penanda 3 menunjukkan tombol pengajuan final.", width_cm=14.2)

    doc.add_page_break()
    add_heading(doc, "Setelah audit diajukan")
    add_bullets(doc, [
        "Pusat memeriksa evidence dan hasil review UIT.",
        "Pusat memberi nilai final 1 sampai 5 pada setiap item.",
        "Jika ada kekurangan, audit dapat dikembalikan dengan status Revisi.",
        "Setelah Finalisasi dan Simpan, hasil masuk ke History Audit dan Level Maturity diperbarui.",
    ])

    add_heading(doc, "Masalah umum dan tindakan")
    add_table(doc, ["Masalah", "Tindakan"], [
        ["Tombol Audit Baru tidak aktif", "Audit bulan berjalan sudah tersedia. Buka audit tersebut melalui tombol Input."],
        ["Upload tidak selesai", "Periksa jaringan, ukuran maksimal 25 MB, dan format file. Ulangi upload."],
        ["Evidence Rejected", "Baca alasan UIT, perbaiki isi atau periode dokumen, lalu upload ulang."],
        ["Tidak dapat mengajukan", "Lengkapi evidence, tunggu semua item Checked, dan simpan Form 5S bulan berjalan."],
        ["Perubahan belum tersimpan", "Tunggu indikator autosave atau klik Simpan Draft sebelum meninggalkan halaman."],
        ["Keluar dibatalkan", "Selesaikan upload yang aktif atau perbaiki error upload, kemudian pilih Simpan dan Keluar."],
    ], [5.0, 11.4])

    add_checklist(doc, "Checklist UPT sebelum pengajuan final", [
        "UPT aktif dan periode audit sudah benar.",
        "Gudang Persediaan sudah diisi sesuai aspek yang berlaku.",
        "Gudang ATTB/MRWI sudah diisi sesuai aspek yang berlaku.",
        "Semua evidence wajib sudah diunggah.",
        "Dokumen dan foto memenuhi kriteria checker.",
        "Semua evidence sudah berstatus Checked oleh UIT.",
        "Tidak ada evidence baru yang belum direview ulang.",
        "Form Pengisian 5S bulan berjalan sudah lengkap dan tersimpan.",
        "Tiga foto sampling 5S sudah tersedia.",
        "Draft terakhir sudah tersimpan.",
        "Pengajuan final berhasil diteruskan ke Pusat.",
    ])
    return save_document(doc, "Panduan Pengisian Maturity Level Gudang - WARNOTO.docx")


if __name__ == "__main__":
    outputs = [build_stock_opname(), build_stock_count(), build_maturity()]
    for output in outputs:
        print(output)
