import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExecResult } from "../src/core/types.ts";
import { triage } from "../src/services/triage.ts";

function result(output: string, command: string): ExecResult {
  return {
    command,
    cwd: process.cwd(),
    exitCode: 1,
    stdout: output,
    stderr: "",
    durationMs: 10,
    timedOut: false,
  };
}

test("triage understands Python tracebacks, unittest output, and import suspects", () => {
  const root = mkdtempSync(join(tmpdir(), "aegis-py-triage-"));
  try {
    mkdirSync(join(root, "src"), { recursive: true });
    mkdirSync(join(root, "test"), { recursive: true });
    const source = join(root, "src", "discount.py");
    const spec = join(root, "test", "test_discount.py");
    writeFileSync(source, "def apply_discount(subtotal, rate):\n    return subtotal * (1 + rate)\n", "utf8");
    writeFileSync(spec, "from src.discount import apply_discount\n", "utf8");

    const output = [
      "FAIL: test_applies_discount (test.test_discount.TestDiscount.test_applies_discount)",
      "AssertionError: 110.0 != 90",
      `  File "${source}", line 2, in apply_discount`,
      "Ran 1 test in 0.001s",
      "FAILED (failures=1)",
    ].join("\n");

    const diagnosis = triage(result(output, "python -m unittest"), root, ["node_modules"]);
    assert.equal(diagnosis.framework, "unittest");
    assert.equal(diagnosis.assertion?.actual, "110.0");
    assert.equal(diagnosis.assertion?.expected, "90");
    assert.ok(diagnosis.suspects.includes(source));
    assert.ok(diagnosis.locations.some((location) => location.file === source));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("triage understands Go test failures and got/want assertions", () => {
  const root = mkdtempSync(join(tmpdir(), "aegis-go-triage-"));
  try {
    const source = join(root, "discount.go");
    const spec = join(root, "discount_test.go");
    writeFileSync(source, "package aegisbench\n", "utf8");
    writeFileSync(spec, "package aegisbench\n", "utf8");

    const output = [
      "--- FAIL: TestApplyDiscount (0.00s)",
      "    discount_test.go:6: ApplyDiscount(100, 0.10) = 110; want 90",
      "FAIL",
      "exit status 1",
    ].join("\n");

    const diagnosis = triage(result(output, "go test ./..."), root, ["node_modules"]);
    assert.equal(diagnosis.framework, "go test");
    assert.equal(diagnosis.assertion?.actual, "110");
    assert.equal(diagnosis.assertion?.expected, "90");
    assert.ok(diagnosis.locations.some((location) => location.file === spec));
    assert.ok(diagnosis.suspects.includes(spec));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
