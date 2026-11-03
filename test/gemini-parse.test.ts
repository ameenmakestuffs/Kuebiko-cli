import test from "node:test";
import assert from "node:assert/strict";
import { parseProposal } from "../src/services/gemini.ts";

test("parseProposal accepts fenced JSON and normalizes paths", () => {
  const payload = {
    summary: "Fix the discount sign",
    patches: [
      {
        path: "./src\\cart.js",
        reason: "wrong operator",
        content: "export const x = 1;\n",
      },
    ],
  };

  const parsed = parseProposal(`\`\`\`json\n${JSON.stringify(payload)}\n\`\`\``);
  assert.equal(parsed.summary, "Fix the discount sign");
  assert.equal(parsed.patches.length, 1);
  assert.equal(parsed.patches[0]?.path, "src/cart.js");
});

test("parseProposal drops traversal, protected paths, duplicates, and binary content", () => {
  const payload = {
    summary: "unsafe",
    patches: [
      { path: "../outside.js", reason: "bad", content: "x" },
      { path: "node_modules/pkg/index.js", reason: "bad", content: "x" },
      { path: "/etc/passwd", reason: "bad", content: "x" },
      { path: "src/a.js", reason: "ok", content: "export const a = 1;\n" },
      { path: "src/a.js", reason: "dupe", content: "export const a = 2;\n" },
      { path: "src/b.js", reason: "binary", content: "a\u0000b" },
      { path: "package-lock.json", reason: "lockfile", content: "{}" },
    ],
  };

  const parsed = parseProposal(JSON.stringify(payload));
  assert.equal(parsed.patches.length, 1);
  assert.equal(parsed.patches[0]?.path, "src/a.js");
});

test("parseProposal rejects invalid JSON", () => {
  assert.throws(() => parseProposal("this is not json"), /not valid JSON/);
});
