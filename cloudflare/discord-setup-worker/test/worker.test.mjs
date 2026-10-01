import assert from "node:assert/strict";
import test from "node:test";
import { __test } from "../src/index.mjs";

test("validSession accepts NeoY bootstrap ids only", () => {
  assert.equal(__test.validSession("bootstrap-6f6050bd-8f40-4f13-8f1f-37178dfbc442"), true);
  assert.equal(__test.validSession("abc"), false);
  assert.equal(__test.validSession("../bootstrap-test"), false);
});
