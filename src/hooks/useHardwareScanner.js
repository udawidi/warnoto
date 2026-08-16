import { useEffect, useRef } from "react";

// Hook: tangkap ketikan dari barcode scanner hardware keyboard-wedge/HID (mis.
// Kassen KS-606). Scanner "mengetik" hasil scan + Enter dalam waktu sangat
// singkat antar-tombol; ketikan manusia jauh lebih lambat. Beda dibedakan lewat
// jeda antar-keydown (gapMs), BUKAN panjang string — QR bisa berupa URL ~40-60
// karakter (scanUrlFor), jadi tidak ada batas panjang atas.
export function useHardwareScanner(onScan, { enabled = true, minLength = 4, gapMs = 120 } = {}) {
  const bufferRef = useRef("");
  const lastTimeRef = useRef(0);
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan; // hindari re-pasang listener tiap render kalau caller kirim arrow function baru

  useEffect(() => {
    if (!enabled) return;
    function onKeyDown(e) {
      const now = Date.now();
      const gap = now - lastTimeRef.current;
      lastTimeRef.current = now;
      if (gap > gapMs) bufferRef.current = ""; // jeda lama = ketikan manusia, reset buffer

      if (e.key === "Enter") {
        const code = bufferRef.current;
        bufferRef.current = "";
        if (code.length >= minLength) {
          e.preventDefault(); // cegah submit/type-ahead dari Enter si scanner
          onScanRef.current(code);
        }
        return;
      }
      if (e.key.length === 1) bufferRef.current += e.key; // char printable saja, abaikan modifier/Shift/Tab/dll
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [enabled, minLength, gapMs]);
}
