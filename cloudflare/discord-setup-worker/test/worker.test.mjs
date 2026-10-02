import assert from "node:assert/strict";
import test from "node:test";
import { __test } from "../src/index.mjs";

test("validSession accepts NeoY bootstrap ids only", () => {
  assert.equal(__test.validSession("bootstrap-6f6050bd-8f40-4f13-8f1f-37178dfbc442"), true);
  assert.equal(__test.validSession("abc"), false);
  assert.equal(__test.validSession("../bootstrap-test"), false);
});

import { discordSnowflakeTimestamp, normalizeDiscordAttachment } from "../src/gateway.mjs";

test("normalizes Discord attachments for Family Tutor ingress", () => {
  assert.deepEqual(normalizeDiscordAttachment({ url: "https://cdn.discordapp.com/a.png", filename: "a.png", content_type: "image/png", size: 42 }), {
    url: "https://cdn.discordapp.com/a.png",
    name: "a.png",
    mimeType: "image/png",
    size: 42,
  });
});


test("decodes Discord snowflake timestamps", () => {
  const now=Date.now();
  const snowflake=((BigInt(now-1420070400000)<<22n)).toString();
  assert.ok(Math.abs(discordSnowflakeTimestamp(snowflake)-now)<2);
});
