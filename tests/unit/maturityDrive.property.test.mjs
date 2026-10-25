import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../../supabase/functions/maturity-drive/index.ts", import.meta.url), "utf8");
const helperSource = source.match(/const DRIVE_MAPPING_PROPERTY_KEY[\s\S]*?function driveMappingPropertyValue[\s\S]*?\n}/)?.[0];
assert.ok(helperSource, "drive mapping property helper must remain present");
const driveMappingPropertyValue = new Function("TextEncoder", "crypto", `${helperSource.replace("mappingKey: string", "mappingKey")}; return driveMappingPropertyValue;`)(TextEncoder, globalThis.crypto);

test("Drive mapping tags preserve short keys and bound long keys", async () => {
  const short = "maturity-v1:2026-10:UPT-SBY:item:1.2:surat-jalan";
  assert.equal(await driveMappingPropertyValue(short), short);
  const longUnicode = `${"maturity-v1:2026-10:UPT-SBY:item:1.2:"}${"材料".repeat(80)}`;
  const tag = await driveMappingPropertyValue(longUnicode);
  assert.ok(new TextEncoder().encode(`warnoto_maturity_key${tag}`).byteLength <= 124);
  assert.equal(tag, await driveMappingPropertyValue(longUnicode));
  assert.notEqual(tag, await driveMappingPropertyValue(`${longUnicode}-different`));
  assert.match(source, /DRIVE_MAPPING_PROPERTY_MAX_BYTES\s*=\s*124/);
  assert.doesNotMatch(source, /appProperties:\s*\{\s*warnoto_maturity_key:\s*input\.mappingKey/);
});

test("Drive property query uses the same bounded tag as folder creation", () => {
  assert.match(source, /driveMappingPropertyValue\(input\.mappingKey\)/);
  assert.match(source, /\[DRIVE_MAPPING_PROPERTY_KEY\]: driveMappingKey/);
  assert.match(source, /value='\$\{quoteDrive\(driveMappingKey\)\}'/);
});
