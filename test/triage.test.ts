import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { ExecResult } from "../src/core/types.ts";
import { detectFramework, extractLocations, triage } from "../src/services/triage.ts";

function makeResult(output: string): ExecResult {
  return {
    command: "npm test",
    cwd: process.cwd(),
    exitCode: 1,
    stdout: output,
    stderr: "",
    durationMs: 10,
    timedOut: false,
  };
}

test("triage extracts node:test locations, suspects, and assertion values", () => {
  const root = mkdtempSync(join(tmpdir(), "aegis-triage-"));
  try {
    mkdirSync(join(root, "src"), { recursive: true });
    mkdirSync(join(root, "test"), { recursive: true });
    const source = join(root, "src", "cart.js");
    const spec = join(root, "test", "cart.test.js");
    writeFileSync(source, "export const calculateTotal = (x) => x * (1 + 0.1);\n", "utf8");
    writeFileSync(
      spec,
      'import { calculateTotal } from "../src/cart.js";\n',
      "utf8",
    );

    const output = [
      "▶ calculateTotal",
      "  ✖ calculateTotal applies a discount",
      `      at TestContext.<anonymous> (${pathToFileURL(spec).href}:8:10)`,
      "AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:",
      "expected: 90,",
      "actual: 110,",
    ].join("\n");

    const result = triage(makeResult(output), root, ["node_modules"]);
    assert.equal(result.framework, "node:test");
    assert.ok(result.suspects.includes(source), "imported source should be a suspect");
    assert.ok(result.suspects.includes(spec), "test file should be a suspect");
    assert.equal(result.assertion?.expected, "90");
    assert.equal(result.assertion?.actual, "110");
    assert.equal(result.locations[0]?.file, spec);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("extractLocations ignores paths outside the project and node_modules", () => {
  const root = mkdtempSync(join(tmpdir(), "aegis-loc-"));
  try {
    mkdirSync(join(root, "src"), { recursive: true });
    const inside = join(root, "src", "ok.ts");
    writeFileSync(inside, "export const ok = true;\n", "utf8");

    const output = [
      `    at thing (${pathToFileURL(inside).href}:3:2)`,
      "    at x (C:/outside/elsewhere/file.ts:4:1)",
      "    at y (C:/project/node_modules/pkg/index.js:9:1)",
    ].join("\n");

    const found = extractLocations(output, root, ["node_modules"]);
    assert.equal(found.length, 1);
    assert.equal(found[0]?.file, inside);
    assert.equal(found[0]?.line, 3);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("detectFramework recognizes common runners", () => {
  assert.equal(detectFramework("✖ failing test", "npm test"), "node:test");
  assert.equal(detectFramework("error TS2322: bad type", "tsc"), "TypeScript");
  assert.equal(detectFramework("FAILED test_app.py::test_x", "pytest"), "pytest");
  assert.equal(detectFramework("--- FAIL: TestThing", "go test ./..."), "go test");
  assert.equal(detectFramework("● Console", "npx jest"), "Jest");
});
