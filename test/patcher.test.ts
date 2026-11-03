import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Patcher, PatchValidationError } from "../src/services/patcher.ts";

test("patcher applies, backs up, and restores a patch", async () => {
  const root = mkdtempSync(join(tmpdir(), "aegis-patch-"));
  try {
    mkdirSync(join(root, "src"), { recursive: true });
    const file = join(root, "src", "math.ts");
    writeFileSync(file, "export const sum = (a, b) => a - b;\n", "utf8");

    const patcher = new Patcher(root, "session-1");
    const applied = await patcher.apply([
      { path: "src/math.ts", content: "export const sum = (a, b) => a + b;\n", reason: "operator" },
    ]);

    assert.equal(readFileSync(file, "utf8"), "export const sum = (a, b) => a + b;\n");
    assert.equal(applied.length, 1);
    assert.ok(existsSync(join(root, ".aegis", "backups", "session-1", "src", "math.ts")));

    await patcher.restore(applied);
    assert.equal(readFileSync(file, "utf8"), "export const sum = (a, b) => a - b;\n");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("patcher rejects traversal, protected directories, and unsupported files", async () => {
  const root = mkdtempSync(join(tmpdir(), "aegis-safe-"));
  try {
    const patcher = new Patcher(root, "session-2");
    await assert.rejects(
      patcher.apply([{ path: "../evil.ts", content: "x", reason: "bad" }]),
      PatchValidationError,
    );
    await assert.rejects(
      patcher.apply([{ path: "node_modules/pkg/index.js", content: "x", reason: "bad" }]),
      PatchValidationError,
    );
    await assert.rejects(
      patcher.apply([{ path: "image.png", content: "x", reason: "bad" }]),
      PatchValidationError,
    );
    await assert.rejects(
      patcher.apply([{ path: "package-lock.json", content: "{}", reason: "bad" }]),
      PatchValidationError,
    );
    await assert.rejects(
      patcher.apply([{ path: ".env", content: "SECRET=x", reason: "bad" }]),
      PatchValidationError,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("withTemporaryPatch restores the original even when the action throws", async () => {
  const root = mkdtempSync(join(tmpdir(), "aegis-temp-"));
  try {
    mkdirSync(join(root, "src"), { recursive: true });
    const file = join(root, "src", "a.js");
    writeFileSync(file, "const value = 1;\n", "utf8");

    const patcher = new Patcher(root, "session-3");
    await assert.rejects(
      patcher.withTemporaryPatch(
        { path: "src/a.js", content: "const value = 2;\n", reason: "candidate" },
        async () => {
          assert.equal(readFileSync(file, "utf8"), "const value = 2;\n");
          throw new Error("candidate failed");
        },
      ),
      /candidate failed/,
    );
    assert.equal(readFileSync(file, "utf8"), "const value = 1;\n");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
