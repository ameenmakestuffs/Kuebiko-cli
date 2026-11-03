import test from "node:test";
import assert from "node:assert/strict";
import { diffLines } from "../src/util/diff.ts";

test("diffLines counts an edited line as one add and one remove", () => {
  const before = "const a = 1;\nconst b = 2;\n";
  const after = "const a = 1;\nconst b = 3;\n";
  const result = diffLines(before, after, "src/math.ts");
  assert.equal(result.added, 1);
  assert.equal(result.removed, 1);
  assert.match(result.text, /-const b = 2;/);
  assert.match(result.text, /\+const b = 3;/);
  assert.match(result.text, /--- a\/src\/math\.ts/);
  assert.match(result.text, /\+\+\+ b\/src\/math\.ts/);
});

test("diffLines returns empty output for identical content", () => {
  const result = diffLines("same\n", "same\n", "x.txt");
  assert.equal(result.text, "");
  assert.equal(result.added, 0);
  assert.equal(result.removed, 0);
});

test("diffLines handles a brand new file", () => {
  const result = diffLines("", "one\ntwo\n", "new.ts");
  assert.equal(result.added, 2);
  assert.equal(result.removed, 0);
});
