import test from "node:test";
import assert from "node:assert/strict";
import { applyDiscount } from "../src/discount.js";

test("applies a 10% discount", () => {
  assert.equal(applyDiscount(100, 0.1), 90);
});
