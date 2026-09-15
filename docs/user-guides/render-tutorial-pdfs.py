from pathlib import Path
from pdf2image import convert_from_path


GUIDE_DIR = Path(__file__).resolve().parent
POPPLER = Path("C:/Users/PLN/.cache/codex-runtimes/codex-primary-runtime/dependencies/native/poppler/Library/bin")
PDFS = [
    GUIDE_DIR / "Panduan Stock Opname Gudang - WARNOTO.pdf",
    GUIDE_DIR / "Panduan Stock Count Gudang - WARNOTO.pdf",
    GUIDE_DIR / "Panduan Pengisian Maturity Level Gudang - WARNOTO.pdf",
]

for pdf in PDFS:
    output_dir = GUIDE_DIR / "qa" / pdf.stem
    output_dir.mkdir(parents=True, exist_ok=True)
    for old in output_dir.glob("page-*.png"):
        old.unlink()
    pages = convert_from_path(str(pdf), dpi=120, poppler_path=str(POPPLER), thread_count=8)
    for index, page in enumerate(pages, start=1):
        page.save(output_dir / f"page-{index}.png", "PNG", optimize=True)
    print(f"{pdf.name}: {len(pages)} pages")
