// Komponen BarcodeScanner — dipindah dari App.jsx (refactor Fase 4).
import { useState, useEffect, useRef } from "react";

export function BarcodeScanner({ onDetect, onClose }) {
  const videoRef = useRef(null);
  const [error, setError] = useState("");
  const [scanning, setScanning] = useState(true);
  const streamRef = useRef(null);
  const detectorRef = useRef(null);

  useEffect(() => {
    let active = true;
    async function start() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        if (!active) { stream.getTracks().forEach(t=>t.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play(); }
        if ("BarcodeDetector" in window) {
          detectorRef.current = new window.BarcodeDetector({ formats: ["qr_code","code_128","ean_13","code_39","upc_a","upc_e","ean_8"] });
          scanLoop();
        } else {
          setError("Browser ini tidak mendukung scan barcode otomatis. Gunakan Chrome di Android, atau input manual kode katalog.");
        }
      } catch (e) {
        setError("Tidak dapat mengakses kamera. Pastikan izin kamera diaktifkan.");
      }
    }
    async function scanLoop() {
      if (!active || !videoRef.current || !detectorRef.current) return;
      try {
        const codes = await detectorRef.current.detect(videoRef.current);
        if (codes.length > 0 && active) {
          onDetect(codes[0].rawValue);
          return;
        }
      } catch {}
      if (active) requestAnimationFrame(scanLoop);
    }
    start();
    return () => { active = false; if (streamRef.current) streamRef.current.getTracks().forEach(t=>t.stop()); };
  }, []);

  return (
    <div style={{position:"fixed",inset:0,background:"black",zIndex:2000,display:"flex",flexDirection:"column"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:16,background:"#111"}}>
        <span style={{color:"white",fontWeight:700,fontSize:14}}>📷 Scan Barcode / QR Barang</span>
        <button onClick={onClose} style={{background:"#dc2626",color:"white",border:"none",borderRadius:8,padding:"6px 14px",cursor:"pointer",fontSize:13}}>✕ Tutup</button>
      </div>
      <div style={{flex:1,position:"relative",overflow:"hidden",display:"flex",alignItems:"center",justifyContent:"center"}}>
        {error ? (
          <div style={{color:"white",textAlign:"center",padding:30,fontSize:13}}>⚠️ {error}</div>
        ) : (
          <>
            <video ref={videoRef} style={{width:"100%",height:"100%",objectFit:"cover"}} muted playsInline/>
            <div style={{position:"absolute",width:240,height:240,border:"3px solid #22d3ee",borderRadius:16,boxShadow:"0 0 0 9999px rgba(0,0,0,0.45)"}}/>
          </>
        )}
      </div>
      <div style={{padding:14,background:"#111",color:"#9ca3af",fontSize:12,textAlign:"center"}}>Arahkan kamera ke barcode / QR code label barang</div>
    </div>
  );
}
