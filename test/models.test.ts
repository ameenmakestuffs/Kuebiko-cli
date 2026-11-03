import test from "node:test";
import assert from "node:assert/strict";
import {
  buildModelLadder,
  LITE_MODEL,
  PRIMARY_MODEL,
} from "../src/core/models.ts";

test("default ladder is gemini-3.8-flash then gemini-3.5-flash-lite", () => {
  assert.equal(PRIMARY_MODEL, "gemini-3.8-flash");
  assert.equal(LITE_MODEL, "gemini-3.5-flash-lite");
  assert.deepEqual(buildModelLadder(PRIMARY_MODEL), [PRIMARY_MODEL, LITE_MODEL]);
});

test("a custom primary stays first and keeps the default fallback order", () => {
  assert.deepEqual(buildModelLadder("custom-model"), ["custom-model", PRIMARY_MODEL, LITE_MODEL]);
});

test("the ladder is deduplicated", () => {
  assert.deepEqual(buildModelLadder(LITE_MODEL), [LITE_MODEL, PRIMARY_MODEL]);
  assert.deepEqual(buildModelLadder(""), [PRIMARY_MODEL, LITE_MODEL]);
});
