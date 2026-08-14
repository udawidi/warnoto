"""Self-test normalize_katalog_code + build_lokasi_upt_map (tanpa Supabase/Prophet).
Run: python ml/train_forecast_selftest.py"""
from lib.normalize_katalog_code import normalize_katalog_code
from train_forecast import build_lokasi_upt_map

assert normalize_katalog_code("1001060031") == "1060031", "10 digit berawalan 100 harus dibuang 3 digit pertama"
assert normalize_katalog_code("1060031") == "1060031", "kode pendek yang sudah sesuai tidak boleh berubah"
assert normalize_katalog_code("MTRL-0267") == "0267", "karakter non-digit harus dibuang, sisakan digitnya"
assert normalize_katalog_code("0093") == "0093", "kode pendek numerik tidak boleh terpotong jadi kosong"

lokasi_rows = [
    {"id": "LOK1", "data": {"gudangId": "GDG1"}},
    {"id": "LOK2", "data": {"gudangId": "GDG_TAK_ADA"}},
    {"id": "LOK3", "data": {}},
]
gudang_rows = [{"id": "GDG1", "data": {"uptId": "UPT-SBY"}}]
upt_map = build_lokasi_upt_map(lokasi_rows, gudang_rows)
assert upt_map["LOK1"] == "UPT-SBY", "lokasi->gudang->upt harus resolve normal"
assert upt_map["LOK2"] is None, "gudang_id yang tidak ada di tabel gudang harus None, bukan error"
assert upt_map["LOK3"] is None, "lokasi tanpa gudangId harus None"

print("OK: semua self-test normalize_katalog_code + build_lokasi_upt_map lulus.")
