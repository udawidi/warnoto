// Self-check untuk isImageEvidence (duplikasi ringkas dari MaturityAuditSystem.jsx,
// bukan import — file itu JSX/React, bukan modul node biasa).
function isImageEvidence(mime, name = "") {
  if (mime && mime.startsWith("image/")) return true;
  if (!mime && /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(name)) return true;
  return false;
}

assert(isImageEvidence("image/png") === true, "image/png harus true");
assert(isImageEvidence("application/pdf") === false, "application/pdf harus false");
assert(isImageEvidence("", "foto.jpg") === true, "mime kosong + foto.jpg harus true");
assert(isImageEvidence("", "dok.pdf") === false, "mime kosong + dok.pdf harus false");
assert(isImageEvidence(undefined, "gambar.PNG") === true, "ekstensi uppercase harus true");
assert(isImageEvidence("text/plain", "foto.jpg") === false, "mime non-image menang atas nama file");

function assert(cond, msg) {
  if (!cond) throw new Error("FAIL: " + msg);
}

console.log("check-evidence-viewer: semua assert lolos");
