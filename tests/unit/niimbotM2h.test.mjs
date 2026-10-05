import test from "node:test";
import assert from "node:assert/strict";
import {
  COMPACT_LABEL_RASTER,
  NIIMBOT_M2H_MODEL,
  NIIMBOT_M2H_MODEL_ID,
  getCompactLabelPayload,
  getCompactLabelCanvasSize,
  rotateLandscapeCanvasToPrinter,
  friendlyNiimbotError,
  isSupportedM2hPrinter,
  printCompactLabelM2h,
} from "../../src/lib/niimbotM2h.js";

test("M2-H profile and printer identity are fail-closed", () => {
  assert.deepEqual(NIIMBOT_M2H_MODEL, {
    name_prefixes: ["M2"],
    task: "b1",
    density: 3,
    label_type: 1,
    speed: 1,
  });
  assert.equal(NIIMBOT_M2H_MODEL_ID, 4608);
  assert.equal(isSupportedM2hPrinter({ modelId: 4608 }), true);
  assert.equal(isSupportedM2hPrinter({ modelId: "4608" }), true);
  assert.equal(isSupportedM2hPrinter({ modelId: 4096 }), false);
  assert.equal(isSupportedM2hPrinter(null), false);
});

test("compact payload keeps required order and safe fallbacks", () => {
  assert.deepEqual(getCompactLabelPayload({ id: "kat-1", katalog: " 123 ", name: "Motor", satuan: "PCS" }), {
    scanId: "kat-1",
    catalogCode: "123",
    unit: "PCS",
    description: "Motor",
  });
  assert.deepEqual(getCompactLabelPayload({ id: "kat-2" }), {
    scanId: "kat-2",
    catalogCode: "-",
    unit: "BH",
    description: "-",
  });
});

test("printer raster is 567x827 after rotating 827x567 landscape", () => {
  assert.deepEqual(getCompactLabelCanvasSize(), { landscape: { width: 827, height: 567 }, printer: COMPACT_LABEL_RASTER });
  const drawCalls = [];
  const context = {
    translate: (...args) => drawCalls.push(["translate", ...args]),
    rotate: (...args) => drawCalls.push(["rotate", ...args]),
    drawImage: (...args) => drawCalls.push(["drawImage", ...args]),
  };
  const output = { width: 567, height: 827, getContext: () => context };
  const input = { width: 827, height: 567 };
  assert.equal(rotateLandscapeCanvasToPrinter(input, output), output);
  assert.deepEqual(drawCalls.map(call => call[0]), ["translate", "rotate", "drawImage"]);
  assert.deepEqual(drawCalls[0], ["translate", 567, 0]);
  assert.equal(drawCalls[1][1], Math.PI / 2);
});

test("printer errors are actionable and do not hide disconnect risk", () => {
  assert.match(friendlyNiimbotError(new Error("Web Bluetooth unavailable")), /Android Chrome|HTTPS|localhost/i);
  assert.match(friendlyNiimbotError(new Error("User cancelled the requestDevice chooser")), /dibatalkan/i);
  assert.match(friendlyNiimbotError(new Error("Connected printer is B1")), /M2-H|4608/i);
  assert.match(friendlyNiimbotError(new Error("Not connected")), /terputus|hubungkan/i);
  assert.match(friendlyNiimbotError(new Error("PageEnd timeout"), { phase: "printing" }), /PageEnd|akhir halaman/i);
  assert.match(friendlyNiimbotError(new Error("PageEnd not acknowledged"), { phase: "printing" }), /PageEnd|akhir halaman/i);
  assert.match(friendlyNiimbotError(new Error("printer counter stalled"), { phase: "printing" }), /counter|stalled/i);
  assert.match(friendlyNiimbotError(new Error("Failed to write to BLE"), { phase: "printing" }), /BLE.*mode=acked, bundle=0/i);
});

test("one print sends one raster with the M2-H contract and retry resets the connection", async () => {
  const previousDriver = globalThis.Niimbot;
  const previousDocument = globalThis.document;
  const previousImage = globalThis.Image;
  const statuses = [];
  const calls = [];
  const context = {
    measureText: value => ({ width: String(value).length * 12 }),
    fillRect() {}, strokeRect() {}, drawImage() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, fillText() {}, translate() {}, rotate() {},
  };
  const canvas = { width: 0, height: 0, getContext: () => context, toDataURL: () => "data:image/png;base64,label" };
  globalThis.document = { createElement: () => ({ ...canvas }) };
  globalThis.Image = class FakeImage {
    set src(value) { this.onload?.(); }
  };
  const driver = {
    identify: async model => { calls.push(["identify", model]); return { modelId: 4608 }; },
    printImage: async (url, options) => calls.push(["printImage", url, options, driver.WRITE_MODE]),
    disconnect: async () => calls.push(["disconnect"]),
  };
  let writeMode;
  let bundleMax;
  Object.defineProperty(driver, "WRITE_MODE", {
    get: () => writeMode,
    set: value => { writeMode = value; calls.push(["writeMode", value]); },
  });
  Object.defineProperty(driver, "BUNDLE_MAX", {
    get: () => bundleMax,
    set: value => { bundleMax = value; calls.push(["bundleMax", value]); },
  });
  globalThis.Niimbot = driver;
  try {
    await printCompactLabelM2h({ id: "kat-1", katalog: "123", name: "Motor", satuan: "BH" }, { onStatus: value => statuses.push(value) });
    assert.deepEqual(statuses, ["connecting", "preparing", "printing", "success"]);
    assert.equal(calls[0][0], "identify");
    assert.deepEqual(calls[1], ["writeMode", "acked"]);
    assert.deepEqual(calls[2], ["bundleMax", 0]);
    assert.equal(calls[3][0], "printImage");
    assert.equal(calls[3][1], "data:image/png;base64,label");
    assert.equal(calls[3][3], "acked");
    assert.deepEqual(calls[3][2].size, { w_px: 567, h_px: 827 });
    assert.equal(calls[3][2].density, 3);
    assert.equal(calls[3][2].copies, 1);
  } finally {
    globalThis.Niimbot = previousDriver;
    globalThis.document = previousDocument;
    globalThis.Image = previousImage;
  }
});

test("wrong printer model is fail-closed before printImage", async () => {
  const previousDriver = globalThis.Niimbot;
  const previousDocument = globalThis.document;
  const previousImage = globalThis.Image;
  const calls = [];
  const context = {
    measureText: value => ({ width: String(value).length * 12 }),
    fillRect() {}, strokeRect() {}, drawImage() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, fillText() {}, translate() {}, rotate() {},
  };
  const canvas = { width: 0, height: 0, getContext: () => context, toDataURL: () => "data:image/png;base64,label" };
  globalThis.document = { createElement: () => ({ ...canvas }) };
  globalThis.Image = class FakeImage {
    set src(value) { this.onload?.(); }
  };
  globalThis.Niimbot = {
    identify: async () => ({ modelId: 4096, label: "B1" }),
    printImage: async () => calls.push("printImage"),
    disconnect: async () => calls.push("disconnect"),
  };
  try {
    await assert.rejects(
      printCompactLabelM2h({ id: "kat-wrong", katalog: "123", name: "Motor", satuan: "BH" }),
      /bukan NIIMBOT M2-H|4608/,
    );
    assert.equal(calls.includes("printImage"), false);
    assert.equal(calls.includes("disconnect"), true);
  } finally {
    globalThis.Niimbot = previousDriver;
    globalThis.document = previousDocument;
    globalThis.Image = previousImage;
  }
});
