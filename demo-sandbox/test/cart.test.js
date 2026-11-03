import test from "node:test";
import assert from "node:assert/strict";

import {
  applyDiscount,
  calculateSubtotal,
  calculateTotal,
  lineTotal,
  roundMoney,
} from "../src/cart.js";

const items = [
  { name: "Keyboard", price: 80, quantity: 1 },
  { name: "USB-C cable", price: 10, quantity: 2 },
];

test("lineTotal multiplies price by quantity", () => {
  assert.equal(lineTotal(items[0]), 80);
  assert.equal(lineTotal(items[1]), 20);
});

test("calculateSubtotal adds every line total", () => {
  assert.equal(calculateSubtotal(items), 100);
  assert.equal(calculateSubtotal([]), 0);
});

test("applyDiscount applies a percentage discount", () => {
  assert.equal(applyDiscount(100, 10), 90);
  assert.equal(applyDiscount(250, 20), 200);
});

test("applyDiscount clamps invalid percentages", () => {
  assert.equal(applyDiscount(100, -5), 100);
  assert.equal(applyDiscount(100, 150), 0);
});

test("calculateTotal applies the discount before tax", () => {
  assert.equal(calculateTotal(items, 10), 97.2);
  assert.equal(calculateTotal(items, 0), 108);
});

test("roundMoney keeps two decimal places", () => {
  assert.equal(roundMoney(12.345), 12.35);
});
