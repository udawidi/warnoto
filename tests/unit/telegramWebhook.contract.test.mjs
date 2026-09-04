import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(
  new URL("../../supabase/functions/telegram-webhook/index.ts", import.meta.url),
  "utf8",
);

test("Telegram retries malformed Markdown once as plain text", () => {
  // Batasi tepat ke sendTelegramMessage: editTelegramMessage (fitur baru, sama
  // pola retry) sekarang duduk di antara sendTelegramMessage dan
  // sendTypingAction, jadi slice sampai sendTypingAction ikut menghitung
  // parse_mode miliknya juga.
  const sendMessage = source.slice(
    source.indexOf("async function sendTelegramMessage"),
    source.indexOf("async function editTelegramMessage"),
  );

  assert.match(sendMessage, /parse_mode:\s*"Markdown"/);
  assert.match(sendMessage, /resp\.status\s*===\s*400/);
  assert.match(sendMessage, /parse entities/i);
  assert.match(sendMessage, /body:\s*JSON\.stringify\(\{\s*chat_id:\s*chatId,\s*text\s*\}\)/s);
  assert.equal(
    (sendMessage.match(/parse_mode:\s*"Markdown"/g) || []).length,
    1,
    "plain-text retry must not send parse_mode again",
  );
});

test("Telegram does not retry unrelated API errors as plain text", () => {
  const sendMessage = source.slice(
    source.indexOf("async function sendTelegramMessage"),
    source.indexOf("async function sendTypingAction"),
  );

  assert.match(sendMessage, /isMarkdownEntityError/);
  assert.match(sendMessage, /if\s*\(isMarkdownEntityError\)/);
  assert.match(sendMessage, /console\.error\("Gagal kirim Telegram:",\s*resp\.status,\s*errorBody\)/);
});
