import React, { useRef, useState, useEffect } from "react";

export function SignaturePadModal({
  isOpen,
  onClose,
  onSave,
  title = "Tanda Tangan Digital",
  subtitle = "Gunakan mouse atau sentuhan jari pada layar untuk menggambar tanda tangan Anda",
  initialSignature = null,
  C = {},
  sty = {},
  isMobile = false
}) {
  const canvasRef = useRef(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasDrawn, setHasDrawn] = useState(false);
  const [penColor, setPenColor] = useState("#0f172a");
  const [penWidth, setPenWidth] = useState(2.5);

  // Inisialisasi canvas saat modal dibuka
  useEffect(() => {
    if (!isOpen) return;

    // Small delay agar DOM modal & canvas sudah selesai di-render
    const timer = setTimeout(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");

      // Sesuaikan ukuran resolusi canvas dengan ukuran kontainer
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width || (isMobile ? 320 : 480);
      canvas.height = 180;

      // Bersihkan & atur style awal
      ctx.fillStyle = "transparent";
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.strokeStyle = penColor;
      ctx.lineWidth = penWidth;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";

      // Jika ada tanda tangan awal (dataURL), gambar ke canvas
      if (initialSignature) {
        const img = new Image();
        img.onload = () => {
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          setHasDrawn(true);
        };
        img.src = initialSignature;
      } else {
        setHasDrawn(false);
      }
    }, 50);

    return () => clearTimeout(timer);
  }, [isOpen, initialSignature, isMobile]);

  // Update properti pen saat warna/ukuran berubah
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    ctx.strokeStyle = penColor;
    ctx.lineWidth = penWidth;
  }, [penColor, penWidth]);

  if (!isOpen) return null;

  // Helper mendapatkan koordinat presisi (mouse/touch)
  function getCoordinates(e) {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();

    let clientX = e.clientX;
    let clientY = e.clientY;

    if (e.touches && e.touches.length > 0) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    }

    return {
      x: clientX - rect.left,
      y: clientY - rect.top
    };
  }

  // Event handlers gambar (Pointer / Touch / Mouse)
  function handleStart(e) {
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const { x, y } = getCoordinates(e);

    ctx.beginPath();
    ctx.moveTo(x, y);
    setIsDrawing(true);
    setHasDrawn(true);
  }

  function handleMove(e) {
    if (!isDrawing) return;
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const { x, y } = getCoordinates(e);

    ctx.lineTo(x, y);
    ctx.stroke();
  }

  function handleEnd(e) {
    if (!isDrawing) return;
    e.preventDefault();
    setIsDrawing(false);
  }

  // Hapus coretan
  function handleClear() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasDrawn(false);
  }

  // Simpan hasil tanda tangan (Data URL PNG transparan)
  function handleSave() {
    if (!hasDrawn) {
      alert("Silakan buat tanda tangan terlebih dahulu pada kotak yang tersedia.");
      return;
    }
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dataUrl = canvas.toDataURL("image/png");
    onSave && onSave(dataUrl);
    onClose && onClose();
  }

  return (
    <div style={{
      position: "fixed",
      inset: 0,
      zIndex: 9999,
      background: "rgba(15, 23, 42, 0.75)",
      backdropFilter: "blur(4px)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: 16
    }}>
      <div style={{
        background: C.surface || "#ffffff",
        color: C.text || "#0f172a",
        width: "100%",
        maxWidth: 520,
        borderRadius: 16,
        boxShadow: "0 25px 50px -12px rgba(0,0,0,0.25)",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column"
      }}>
        {/* Header Modal */}
        <div style={{
          padding: "16px 20px",
          background: C.bg || "#f8fafc",
          borderBottom: `1px solid ${C.border || "#e2e8f0"}`,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center"
        }}>
          <div>
            <h3 style={{ fontSize: 15, fontWeight: 800, margin: 0, color: C.text || "#0f172a" }}>
              ✍️ {title}
            </h3>
            {subtitle && (
              <p style={{ fontSize: 11, color: C.muted || "#64748b", margin: "2px 0 0 0" }}>
                {subtitle}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              fontSize: 20,
              fontWeight: 700,
              color: C.muted || "#64748b",
              cursor: "pointer",
              padding: "0 4px"
            }}
          >
            ✕
          </button>
        </div>

        {/* Body Modal: Canvas Signature Pad */}
        <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 14 }}>
          
          {/* Controls Mini (Pilihan Warna & Ukuran Pensil) */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 11 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <span style={{ fontWeight: 700, color: C.muted || "#64748b" }}>Warna Tint:</span>
              <div style={{ display: "flex", gap: 6 }}>
                {[
                  { name: "Hitam/Navy", color: "#0f172a" },
                  { name: "Biru Tinta", color: "#1e40af" }
                ].map(c => (
                  <button
                    key={c.color}
                    type="button"
                    onClick={() => setPenColor(c.color)}
                    style={{
                      width: 22,
                      height: 22,
                      borderRadius: "50%",
                      background: c.color,
                      border: penColor === c.color ? "2px solid #3b82f6" : "1px solid #cbd5e1",
                      cursor: "pointer",
                      boxShadow: penColor === c.color ? "0 0 0 2px rgba(59,130,246,0.3)" : "none"
                    }}
                    title={c.name}
                  />
                ))}
              </div>
            </div>

            <button
              type="button"
              onClick={handleClear}
              style={{
                background: "none",
                border: "none",
                color: "#ef4444",
                fontWeight: 700,
                fontSize: 11,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: 4
              }}
            >
              🗑️ Bersihkan Canvas
            </button>
          </div>

          {/* Area Canvas Gambar */}
          <div style={{
            position: "relative",
            border: `2px dashed ${hasDrawn ? (C.accent || "#2563eb") : (C.border || "#cbd5e1")}`,
            borderRadius: 12,
            background: "#ffffff",
            overflow: "hidden",
            touchAction: "none"
          }}>
            <canvas
              ref={canvasRef}
              onMouseDown={handleStart}
              onMouseMove={handleMove}
              onMouseUp={handleEnd}
              onMouseLeave={handleEnd}
              onTouchStart={handleStart}
              onTouchMove={handleMove}
              onTouchEnd={handleEnd}
              style={{
                display: "block",
                width: "100%",
                height: 180,
                cursor: "crosshair",
                touchAction: "none"
              }}
            />

            {!hasDrawn && (
              <div style={{
                position: "absolute",
                inset: 0,
                pointerEvents: "none",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#cbd5e1",
                fontSize: 13,
                fontWeight: 700,
                letterSpacing: "0.5px"
              }}>
                [ Area Coretan Tanda Tangan ]
              </div>
            )}
          </div>

          {/* Guide Line Tipis */}
          <div style={{ fontSize: 10, color: C.muted || "#64748b", textAlign: "center", fontStyle: "italic" }}>
            Tanda tangan ini akan langsung dimasukkan ke dalam template cetak resmi dokumen TUG / Berita Acara.
          </div>
        </div>

        {/* Footer Actions */}
        <div style={{
          padding: "12px 20px",
          background: C.bg || "#f8fafc",
          borderTop: `1px solid ${C.border || "#e2e8f0"}`,
          display: "flex",
          justifyContent: "flex-end",
          gap: 10
        }}>
          <button
            type="button"
            style={{ ...sty.btn("ghost", "sm"), padding: "8px 16px" }}
            onClick={onClose}
          >
            Batal
          </button>

          <button
            type="button"
            style={{ ...sty.btn("primary", "sm"), padding: "8px 20px", fontWeight: 800 }}
            onClick={handleSave}
          >
            💾 Simpan Tanda Tangan
          </button>
        </div>
      </div>
    </div>
  );
}

// Helper Button & Preview TTD untuk dipakai di komponen mana saja
export function SignaturePreviewButton({
  signatureUrl,
  onOpenModal,
  onRemove,
  label = "Tanda Tangan Digital",
  C = {},
  sty = {}
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {label && (
        <label style={{ fontSize: 11, fontWeight: 700, color: C.text || "#0f172a" }}>
          {label}
        </label>
      )}

      {signatureUrl ? (
        <div style={{
          position: "relative",
          width: "100%",
          maxWidth: 220,
          height: 65,
          border: `1px solid ${C.border || "#cbd5e1"}`,
          borderRadius: 8,
          background: "#ffffff",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 6,
          boxShadow: "0 1px 3px rgba(0,0,0,0.05)"
        }}>
          <img src={signatureUrl} alt="TTD Preview" style={{ maxHeight: "100%", maxWidth: "100%", objectFit: "contain" }} />
          <div style={{ position: "absolute", top: 2, right: 2, display: "flex", gap: 2 }}>
            <button
              type="button"
              onClick={onOpenModal}
              title="Ubah TTD"
              style={{ background: "#2563eb", color: "white", border: "none", borderRadius: 4, width: 20, height: 20, cursor: "pointer", fontSize: 10, display: "flex", alignItems: "center", justifyContent: "center" }}
            >✏️</button>
            {onRemove && (
              <button
                type="button"
                onClick={onRemove}
                title="Hapus TTD"
                style={{ background: "#ef4444", color: "white", border: "none", borderRadius: 4, width: 20, height: 20, cursor: "pointer", fontSize: 10, display: "flex", alignItems: "center", justifyContent: "center" }}
              >✕</button>
            )}
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={onOpenModal}
          style={{
            ...sty.btn("ghost", "sm"),
            border: `1.5px dashed ${C.accent || "#2563eb"}`,
            color: C.accent || "#2563eb",
            background: C.surface || "#ffffff",
            padding: "8px 12px",
            fontWeight: 700,
            fontSize: 11,
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            borderRadius: 8,
            width: "fit-content"
          }}
        >
          ✍️ + Buat TTD Digital
        </button>
      )}
    </div>
  );
}
