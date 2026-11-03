import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TriageResult } from "../src/core/types.ts";
import { localRepair } from "../src/services/local-repair.ts";

test("local repair finds the operator mutation that makes verification pass", async () => {
  const root = mkdtempSync(join(tmpdir(), "aegis-local-"));
  try {
    mkdirSync(join(root, "src"), { recursive: true });
    const file = join(root, "src", "discount.js");
    writeFileSync(file, "export function applyDiscount(x) {\n  return x * (1 + 0.1);\n}\n", "utf8");

    const triage: TriageResult = {
      framework: "node:test",
      headline: "applyDiscount applies a discount",
      locations: [],
      suspects: [file],
      tail: "applyDiscount expected 90 actual 110",
    };

    const verified: string[] = [];
    const proposal = await localRepair({
      root,
      suspects: [file],
      triage,
      ignore: ["node_modules"],
      maxCandidates: 20,
      verify: async (patch) => {
        verified.push(patch.content);
        return patch.content.includes("1 - 0.1");
      },
    });

    assert.ok(proposal, "expected a repair proposal");
    assert.equal(proposal.engine, "local");
    assert.equal(proposal.patches.length, 1);
    assert.match(proposal.patches[0]?.content ?? "", /1 - 0\.1/);
    assert.ok(verified.length >= 1);
    assert.ok(verified.length <= 20);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("local repair returns null when no candidate verifies", async () => {
  const root = mkdtempSync(join(tmpdir(), "aegis-local-none-"));
  try {
    mkdirSync(join(root, "src"), { recursive: true });
    const file = join(root, "src", "math.js");
    writeFileSync(file, "export const add = (a, b) => a + b;\n", "utf8");

    const proposal = await localRepair({
      root,
      suspects: [file],
      triage: {
        framework: "generic",
        headline: "unfixable",
        locations: [],
        suspects: [file],
        tail: "unfixable",
      },
      ignore: ["node_modules"],
      maxCandidates: 5,
      verify: async () => false,
    });

    assert.equal(proposal, null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
