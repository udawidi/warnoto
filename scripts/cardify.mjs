// Codemod Fase 1: terapkan pola .mobile-card-table (docs/DESIGN_GUIDELINES.md bagian 8)
// pada satu blok <tbody>. Dipakai sekali per tabel, lalu hasilnya diperiksa manual.
//
//   node scripts/cardify.mjs <file> <lineAwal> <lineAkhir> <titleIdx|-1> '["Kol 1","Kol 2",...]'
//
// lineAwal..lineAkhir = rentang baris yang memuat <tbody>...</tbody> (1-based, inklusif).
// Tiap <tr> di dalamnya dapat class baris; tiap <td> dapat data-label sesuai urutan kolom.
// <td colSpan=...> (baris kosong) dilewati labelnya. Kolom titleIdx dapat class judul.
import fs from "fs";

const [file, from, to, titleIdx, labelsRaw] = process.argv.slice(2);
const labels = JSON.parse(labelsRaw);
const lines = fs.readFileSync(file, "utf8").split("\n");
let col = 0, nTr = 0, nTd = 0;

for (let i = +from - 1; i <= +to - 1; i++) {
  let ln = lines[i];
  if (/<tr[\s>]/.test(ln) && !/className=/.test(ln)) {
    ln = ln.replace(/<tr(?=[\s>])/, '<tr className="mobile-card-table__row"');
    col = 0; nTr++;
  } else if (/<tr[\s>]/.test(ln)) {
    ln = ln.replace(/className="/, 'className="mobile-card-table__row ');
    col = 0; nTr++;
  }
  ln = ln.replace(/<td(?=[\s>])/g, () => {
    if (/colSpan/.test(lines[i])) return "<td";
    const label = labels[col] ?? "";
    const cls = +titleIdx === col ? ' className="mobile-card-table__title"' : "";
    col++; nTd++;
    return `<td data-label="${label}"${cls}`;
  });
  lines[i] = ln;
}
fs.writeFileSync(file, lines.join("\n"));
console.log(`${file}: ${nTr} <tr>, ${nTd} <td>`);
