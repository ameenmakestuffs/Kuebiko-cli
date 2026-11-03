import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TriageResult } from "../src/core/types.ts";
import { localRepair } from "../src/services/local-repair.ts";

function triageFor(file: string, headline: string): TriageResult {
  return {
    framework: "generic",
    headline,
    locations: [],
    suspects: [file],
    tail: headline,
  };
}

test("local repair fixes a Python operator mutation", async () => {
  const root = mkdtempSync(join(tmpdir(), "aegis-py-repair-"));
  try {
    mkdirSync(join(root, "src"), { recursive: true });
    const file = join(root, "src", "discount.py");
    writeFileSync(file, "def apply_discount(subtotal, rate):\n    return subtotal * (1 + rate)\n", "utf8");

    const proposal = await localRepair({
      root,
      suspects: [file],
      triage: triageFor(file, "AssertionError: 110 != 90"),
      ignore: ["node_modules"],
      maxCandidates: 24,
      verify: async (patch) => patch.content.includes("1 - rate"),
    });

    assert.ok(proposal);
    assert.match(proposal.patches[0]?.content ?? "", /1 - rate/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("local repair discovers a Go source file when triage only points at the test", async () => {
  const root = mkdtempSync(join(tmpdir(), "aegis-go-repair-"));
  try {
    const source = join(root, "discount.go");
    const spec = join(root, "discount_test.go");
    writeFileSync(
      source,
      "package aegisbench\n\nfunc ApplyDiscount(subtotal float64, rate float64) float64 {\n\treturn subtotal * (1 + rate)\n}\n",
      "utf8",
    );
    writeFileSync(
      spec,
      'package aegisbench\n\nimport "testing"\n\nfunc TestApplyDiscount(t *testing.T) {}\n',
      "utf8",
    );

    const proposal = await localRepair({
      root,
      suspects: [spec],
      triage: triageFor(spec, "ApplyDiscount(100, 0.10) = 110; want 90"),
      ignore: ["node_modules"],
      maxCandidates: 24,
      verify: async (patch) => patch.content.includes("1 - rate"),
    });

    assert.ok(proposal);
    assert.match(proposal.patches[0]?.path ?? "", /discount\.go$/);
    assert.match(proposal.patches[0]?.content ?? "", /1 - rate/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
