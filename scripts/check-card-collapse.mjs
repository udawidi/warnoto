// Aturan pembuka kartu (:focus) harus lebih spesifik daripada aturan penyembunyi,
// kalau tidak kartu tidak pernah bisa dibuka di HP. Pernah salah sekali, jadi dijaga.
import fs from "fs";
import assert from "assert";

const css = fs.readFileSync("src/index.css", "utf8");
// Bobot kelas/pseudo-class/atribut — cukup untuk membandingkan dua selektor sejenis.
const berat = sel => (sel.match(/\.[a-zA-Z_-]|:[a-z-]+\(|:[a-z-]+(?!\()/g) || []).length;

const cari = re => { const m = css.match(re); assert(m, "selektor tidak ketemu: " + re); return m[0]; };
const sembunyi = cari(/\.mobile-card-table__row > td:nth-of-type\(n\+5\)[^{]*/);
const buka = cari(/\.mobile-card-table__row:is\(:focus,:focus-within\) > td:nth-of-type\(n\+5\)[^{]*/);

assert(berat(buka) > berat(sembunyi),
  `aturan :focus (${berat(buka)}) harus lebih spesifik dari aturan penyembunyi (${berat(sembunyi)})`);

// :has() bersarang di dalam :has() itu invalid — browser membuang SELURUH aturannya
// tanpa peringatan. Pernah kejadian: penanda "Ketuk untuk detail" tidak pernah tampil.
for (const [i, sel] of css.split("{").entries()) {
  const mulai = sel.indexOf(":has(");
  if (mulai < 0) continue;
  let sisa = 0;
  for (let j = mulai + 4; j < sel.length; j++) {
    if (sel[j] === "(") sisa++;
    else if (sel[j] === ")" && --sisa === 0) break;
    else if (sisa > 0 && sel.startsWith(":has(", j)) {
      assert.fail(`:has() bersarang di :has() (aturan ke-${i}): ${sel.trim().slice(-120)}`);
    }
  }
}
console.log("ok — buka", berat(buka), "> sembunyi", berat(sembunyi), "; tidak ada :has bersarang");
