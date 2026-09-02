// Self-check src/lib/geo.js — jarak 2 titik dikenal + path kosong/1-titik = 0.
import assert from "assert";
import { haversineMeters, pathDistance } from "../src/lib/geo.js";

// Monas (-6.1754,106.8272) ke Bandara Soetta (-6.1256,106.6559) — jarak dunia-nyata ~19.6km.
const d = haversineMeters(-6.1754, 106.8272, -6.1256, 106.6559);
assert(d > 19000 && d < 20500, `jarak Monas-Soetta meleset: ${d}m`);

assert.strictEqual(haversineMeters(-6.2, 106.8, -6.2, 106.8), 0, "titik sama harus 0");

assert.strictEqual(pathDistance([]), 0, "path kosong harus 0");
assert.strictEqual(pathDistance([[-6.2, 106.8, 1]]), 0, "path 1 titik harus 0");

const path = [[-6.1754, 106.8272, 1], [-6.1256, 106.6559, 2]];
assert.strictEqual(pathDistance(path), haversineMeters(...path[0].slice(0, 2), ...path[1].slice(0, 2)), "pathDistance 2 titik = haversine langsung");

console.log("check-haversine OK");
