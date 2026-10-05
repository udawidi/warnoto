import "niimbot-web-bluetooth";
import QRCode from "qrcode";
import { canonicalKatalogCode } from "./normalizeKatalogCode.js";
import { scanUrlFor } from "./utils.js";

export const NIIMBOT_M2H_MODEL_ID = 4608;
export const COMPACT_LABEL_RASTER = Object.freeze({ w_px: 567, h_px: 827, density: 3 });
export const NIIMBOT_M2H_MODEL = Object.freeze({
  name_prefixes: ["M2"],
  task: "b1",
  density: 3,
  label_type: 1,
  speed: 1,
});

const LANDSCAPE_LABEL = Object.freeze({ width: 827, height: 567 });

export function isSupportedM2hPrinter(info) {
  return Number(info?.modelId) === NIIMBOT_M2H_MODEL_ID;
}

export function getCompactLabelPayload(katalog = {}) {
  return {
    scanId: katalog.id || "",
    catalogCode: canonicalKatalogCode(katalog.katalog) || "-",
    unit: String(katalog.satuan || "BH"),
    description: String(katalog.name || "-"),
  };
}

// Resolve the master row before printing. History rows may predate the catalog id
// being persisted, so new-material rows use the same canonical catalog code used by
// the master-data screens.
export function resolveCompactLabelKatalog(item = {}, katalogList = []) {
  const list = Array.isArray(katalogList) ? katalogList : [];
  if (item.katalogId) {
    const byId = list.find(k => k?.id === item.katalogId);
    if (byId) return byId;
  }
  const code = canonicalKatalogCode(item.katalogBaru);
  if (!code) return null;
  return list.find(k => canonicalKatalogCode(k?.katalog) === code) || null;
}

export function getCompactLabelCanvasSize() {
  return { landscape: { ...LANDSCAPE_LABEL }, printer: { ...COMPACT_LABEL_RASTER } };
}

/** Rotate the on-screen landscape design clockwise to the M2-H feed orientation. */
export function rotateLandscapeCanvasToPrinter(landscapeCanvas, printerCanvas) {
  const context = printerCanvas.getContext("2d");
  context.translate(COMPACT_LABEL_RASTER.w_px, 0);
  context.rotate(Math.PI / 2);
  context.drawImage(landscapeCanvas, 0, 0);
  return printerCanvas;
}

export function wrapCanvasText(context, text, maxWidth) {
  const words = String(text || "-").trim().split(/\s+/).filter(Boolean);
  const lines = [];
  let line = "";
  const pushToken = token => {
    let chunk = "";
    for (const character of Array.from(token)) {
      const next = `${chunk}${character}`;
      if (chunk && context.measureText(next).width > maxWidth) {
        lines.push(chunk);
        chunk = character;
      } else {
        chunk = next;
      }
    }
    if (chunk) line = chunk;
  };
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (line && context.measureText(next).width > maxWidth) {
      lines.push(line);
      line = "";
      pushToken(word);
    } else if (context.measureText(word).width > maxWidth) {
      if (line) lines.push(line);
      line = "";
      pushToken(word);
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : ["-"];
}

function ellipsizeCanvasText(context, text, maxWidth, force = false) {
  const value = String(text || "");
  if (!force && context.measureText(value).width <= maxWidth) return value;
  let output = "";
  for (const character of Array.from(value)) {
    const next = `${output}${character}`;
    if (context.measureText(`${next}…`).width > maxWidth) break;
    output = next;
  }
  return `${output}…`;
}

export function getCompactDescriptionLayout(context, text, maxWidth, maxLines = 5) {
  const fontSizes = [36, 32, 28, 24, 21, 18, 16];
  let selected = fontSizes[fontSizes.length - 1];
  let lines = [];
  for (const fontSize of fontSizes) {
    context.font = `700 ${fontSize}px Arial, sans-serif`;
    const candidate = wrapCanvasText(context, text, maxWidth);
    selected = fontSize;
    lines = candidate;
    if (candidate.length <= maxLines) break;
  }
  if (lines.length > maxLines) {
    lines = lines.slice(0, maxLines);
    lines[maxLines - 1] = ellipsizeCanvasText(context, lines[maxLines - 1], maxWidth, true);
  }
  return { fontSize: selected, lineHeight: Math.max(24, selected + 5), lines };
}

function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    if (typeof Image === "undefined") {
      reject(new Error("Browser tidak mendukung renderer label."));
      return;
    }
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("QR katalog gagal disiapkan."));
    image.src = dataUrl;
  });
}

function drawCenteredLines(context, lines, x, y, lineHeight, maxWidth) {
  lines.forEach((line, index) => context.fillText(line, x, y + (index * lineHeight), maxWidth));
}

/** Render the compact card as a native PNG, independent from browser print CSS. */
export async function renderCompactLabelRaster(katalog) {
  if (typeof document === "undefined" || typeof document.createElement !== "function") {
    throw new Error("Renderer label hanya tersedia di browser.");
  }
  const payload = getCompactLabelPayload(katalog);
  const qrDataUrl = await QRCode.toDataURL(scanUrlFor(payload.scanId), { margin: 1, width: 300 });
  const qrImage = await loadImage(qrDataUrl);
  const landscape = document.createElement("canvas");
  landscape.width = LANDSCAPE_LABEL.width;
  landscape.height = LANDSCAPE_LABEL.height;
  const context = landscape.getContext("2d");
  context.fillStyle = "#fff";
  context.fillRect(0, 0, LANDSCAPE_LABEL.width, LANDSCAPE_LABEL.height);
  context.strokeStyle = "#111";
  context.lineWidth = 3;
  context.strokeRect(8, 8, LANDSCAPE_LABEL.width - 16, LANDSCAPE_LABEL.height - 16);

  const qrSize = 390;
  const qrX = 48;
  const qrY = (LANDSCAPE_LABEL.height - qrSize) / 2;
  context.drawImage(qrImage, qrX, qrY, qrSize, qrSize);
  context.beginPath();
  context.moveTo(470, 32);
  context.lineTo(470, LANDSCAPE_LABEL.height - 32);
  context.stroke();

  const centerX = 646;
  const maxTextWidth = 310;
  context.textAlign = "center";
  context.fillStyle = "#111";
  context.font = "700 22px Arial, sans-serif";
  context.fillText("SATUAN", centerX, 72);
  context.font = "900 40px Arial, sans-serif";
  context.fillText(payload.unit, centerX, 122);

  const descriptionLayout = getCompactDescriptionLayout(context, payload.description, maxTextWidth, 5);
  context.font = `700 ${descriptionLayout.fontSize}px Arial, sans-serif`;
  const descriptionLines = descriptionLayout.lines;
  const descriptionLineHeight = descriptionLayout.lineHeight;
  const descriptionY = 282 - ((descriptionLines.length - 1) * descriptionLineHeight) / 2;
  context.save?.();
  context.beginPath();
  context.rect?.(centerX - (maxTextWidth / 2), 150, maxTextWidth, 245);
  context.clip?.();
  drawCenteredLines(context, descriptionLines, centerX, descriptionY, descriptionLineHeight, maxTextWidth);
  context.restore?.();

  context.beginPath();
  context.moveTo(510, 425);
  context.lineTo(782, 425);
  context.stroke();
  context.font = "700 20px Arial, sans-serif";
  context.fillStyle = "#475569";
  context.fillText("NO. CATALOG", centerX, 470);
  context.font = "900 34px Arial, sans-serif";
  context.fillStyle = "#111";
  const catalogLines = wrapCanvasText(context, payload.catalogCode, maxTextWidth).slice(0, 2);
  drawCenteredLines(context, catalogLines, centerX, 515, 35, maxTextWidth);

  const printerCanvas = document.createElement("canvas");
  printerCanvas.width = COMPACT_LABEL_RASTER.w_px;
  printerCanvas.height = COMPACT_LABEL_RASTER.h_px;
  const printerContext = printerCanvas.getContext("2d");
  printerContext.fillStyle = "#fff";
  printerContext.fillRect(0, 0, printerCanvas.width, printerCanvas.height);
  rotateLandscapeCanvasToPrinter(landscape, printerCanvas);
  return printerCanvas.toDataURL("image/png");
}

export function friendlyNiimbotError(error, { phase = "connecting" } = {}) {
  const message = String(error?.message || error || "");
  if (/Web Bluetooth|doesn't expose|not supported|secure context/i.test(message)) {
    return "NIIMBOT membutuhkan Android Chrome melalui HTTPS atau localhost dengan Bluetooth aktif.";
  }
  if (/cancel|abort|chooser|requestDevice/i.test(message)) {
    return "Pemilihan printer dibatalkan. Tekan coba lagi untuk memilih NIIMBOT M2-H.";
  }
  if (/model|Connected printer|4608|M2-H/i.test(message)) {
    return "Printer tidak didukung. Pilih NIIMBOT M2-H (model 4608).";
  }
  if (/Not connected|disconnect|link dropped|gatt/i.test(message)) {
    return "Koneksi NIIMBOT terputus. Pastikan printer menyala, lalu coba lagi.";
  }
  if (/PageEnd|not acknowledged|unconfirmed/i.test(message)) {
    return "NIIMBOT belum mengonfirmasi akhir halaman (PageEnd). Pastikan label terpasang lurus, lalu coba lagi.";
  }
  if (/counter.*(?:stopped|stalled)|(?:stopped|stalled).*counter/i.test(message)) {
    return "Counter printer NIIMBOT berhenti (stalled). Pastikan roll label terpasang dan printer siap, lalu coba lagi.";
  }
  if (/Failed to write to BLE|writeValue|Operation failed/i.test(message)) {
    return "NIIMBOT gagal mengirim data BLE (mode=acked, bundle=0). Pastikan Bluetooth aktif, printer dekat, lalu coba lagi.";
  }
  if (phase === "printing") {
    return "NIIMBOT gagal menyelesaikan cetak. Label mungkin sudah tercetak sebagian; periksa printer lalu coba lagi.";
  }
  return "NIIMBOT tidak siap. Pastikan Bluetooth, Lokasi, dan printer M2-H aktif, lalu coba lagi.";
}

function getDriver() {
  const driver = globalThis.Niimbot;
  if (!driver || typeof driver.identify !== "function" || typeof driver.printImage !== "function") {
    throw new Error("Web Bluetooth driver NIIMBOT tidak tersedia.");
  }
  return driver;
}

async function resetConnection(driver) {
  if (typeof driver?.disconnect !== "function") return;
  try { await driver.disconnect(); } catch { /* connection is already gone */ }
}

/** Pair/identify immediately from the click, then render and send exactly one label. */
export async function printCompactLabelM2h(katalog, { onStatus } = {}) {
  const driver = getDriver();
  onStatus?.("connecting");
  // Keep this call before the first await below. Chrome only opens the chooser in a user gesture.
  const identityPromise = driver.identify(NIIMBOT_M2H_MODEL);
  identityPromise.catch(() => {}); // consume a late chooser rejection if raster preparation fails first
  try {
    onStatus?.("preparing");
    const rasterDataUrl = await renderCompactLabelRaster(katalog);
    const printer = await identityPromise;
    if (!isSupportedM2hPrinter(printer)) {
      await resetConnection(driver);
      throw new Error(`Printer model ${printer?.modelId ?? "unknown"} bukan NIIMBOT M2-H (4608).`);
    }
    driver.WRITE_MODE = "acked";
    driver.BUNDLE_MAX = 0;
    onStatus?.("printing");
    await driver.printImage(rasterDataUrl, {
      model: NIIMBOT_M2H_MODEL,
      size: { w_px: COMPACT_LABEL_RASTER.w_px, h_px: COMPACT_LABEL_RASTER.h_px },
      density: COMPACT_LABEL_RASTER.density,
      copies: 1,
    });
    onStatus?.("success");
    return rasterDataUrl;
  } catch (error) {
    await resetConnection(driver);
    throw error;
  }
}
