import { existsSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import type { AppliedPatch, FilePatch, PatchStat } from "../core/types.js";
import { atomicWriteFile, isPathInside, readTextFile, removeFile } from "../util/fs.js";
import { diffLines } from "../util/diff.js";

const WRITABLE_EXTENSIONS = new Set([
  ".js", ".mjs", ".cjs", ".jsx", ".ts", ".tsx", ".py", ".go", ".rs", ".java", ".rb", ".php",
  ".json", ".yaml", ".yml", ".toml", ".css", ".scss", ".html", ".sql", ".sh", ".ps1", ".env",
]);

const BLOCKED_SEGMENTS = new Set([".git", "node_modules", "dist", "build", ".kuebiko", ".aegis", "coverage"]);

const BLOCKED_FILES = new Set([
  ".env",
  ".env.local",
  ".npmrc",
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lock",
  "bun.lockb",
  "go.sum",
  "cargo.lock",
  "composer.lock",
  "pipfile.lock",
  "poetry.lock",
]);

export class PatchValidationError extends Error {
  override name = "PatchValidationError";
}

function extensionOf(path: string): string {
  const match = /\.[A-Za-z0-9]+$/.exec(path);
  return match ? match[0].toLowerCase() : "";
}

const cleanupRegistry = new Set<() => Promise<void>>();

export function registerCleanup(cleanup: () => Promise<void>): () => void {
  cleanupRegistry.add(cleanup);
  return () => cleanupRegistry.delete(cleanup);
}

export async function runCleanups(): Promise<void> {
  const tasks = [...cleanupRegistry];
  cleanupRegistry.clear();
  for (const task of tasks) {
    try {
      await task();
    } catch {
      // Best effort during shutdown.
    }
  }
}

export class Patcher {
  constructor(
    private readonly root: string,
    private readonly sessionId: string,
  ) {}

  private resolveTarget(relPath: string): string {
    const normalized = relPath.trim().replace(/\\/g, "/").replace(/^\.\//, "");
    if (!normalized || normalized.startsWith("/") || /^[A-Za-z]:/.test(normalized)) {
      throw new PatchValidationError(`Refusing to patch an absolute or empty path: "${relPath}"`);
    }

    const segments = normalized.split("/");
    if (segments.some((segment) => segment === ".." || segment === ".")) {
      throw new PatchValidationError(`Refusing to patch a path that escapes the project: "${relPath}"`);
    }
    if (segments.some((segment) => BLOCKED_SEGMENTS.has(segment.toLowerCase()))) {
      throw new PatchValidationError(`Refusing to patch a protected path: "${relPath}"`);
    }
    const baseName = (segments[segments.length - 1] ?? "").toLowerCase();
    if (BLOCKED_FILES.has(baseName)) {
      throw new PatchValidationError(`Refusing to patch a protected file: "${relPath}"`);
    }

    const absolute = resolve(this.root, normalized);
    if (!isPathInside(this.root, absolute)) {
      throw new PatchValidationError(`Refusing to patch outside the project root: "${relPath}"`);
    }
    if (!WRITABLE_EXTENSIONS.has(extensionOf(absolute))) {
      throw new PatchValidationError(`Refusing to patch an unsupported file type: "${relPath}"`);
    }
    return absolute;
  }

  async apply(patches: FilePatch[], options: { backup?: boolean } = {}): Promise<AppliedPatch[]> {
    const backup = options.backup ?? true;
    if (patches.length === 0) return [];
    if (patches.length > 8) {
      throw new PatchValidationError("Refusing to apply more than 8 patches in one attempt.");
    }

    const seen = new Set<string>();
    const prepared: AppliedPatch[] = [];

    for (const patch of patches) {
      if (typeof patch.content !== "string") {
        throw new PatchValidationError(`Patch for "${patch.path}" has no content.`);
      }
      if (patch.content.includes("\u0000")) {
        throw new PatchValidationError(`Patch for "${patch.path}" contains binary data.`);
      }
      if (patch.content.length > 2_000_000) {
        throw new PatchValidationError(`Patch for "${patch.path}" is too large.`);
      }

      const absolutePath = this.resolveTarget(patch.path);
      const relPath = relative(this.root, absolutePath).split(sep).join("/");
      if (seen.has(relPath.toLowerCase())) {
        throw new PatchValidationError(`Duplicate patch for "${relPath}".`);
      }
      seen.add(relPath.toLowerCase());

      const original = await readTextFile(absolutePath);
      if (original === patch.content) {
        throw new PatchValidationError(`Patch for "${relPath}" is a no-op.`);
      }

      prepared.push({ relPath, absolutePath, original, updated: patch.content, backupPath: null });
    }

    const applied: AppliedPatch[] = [];
    try {
      for (const entry of prepared) {
        if (backup && entry.original !== null) {
          const dirName = existsSync(join(this.root, ".aegis")) && !existsSync(join(this.root, ".kuebiko")) ? ".aegis" : ".kuebiko";
          const backupPath = join(this.root, dirName, "backups", this.sessionId, entry.relPath);
          await atomicWriteFile(backupPath, entry.original);
          entry.backupPath = backupPath;
        }
        await atomicWriteFile(entry.absolutePath, entry.updated);
        applied.push(entry);
      }
      return applied;
    } catch (error) {
      await this.restore(applied);
      throw error;
    }
  }

  async restore(patches: AppliedPatch[]): Promise<void> {
    for (const patch of [...patches].reverse()) {
      try {
        if (patch.original === null) {
          await removeFile(patch.absolutePath);
        } else {
          await atomicWriteFile(patch.absolutePath, patch.original);
        }
      } catch {
        // Continue restoring the rest; the backup remains on disk.
      }
    }
  }

  async withTemporaryPatch<T>(patch: FilePatch, action: () => Promise<T>): Promise<T> {
    const applied = await this.apply([patch], { backup: false });
    try {
      return await action();
    } finally {
      await this.restore(applied);
    }
  }

  stats(patches: Array<{ patch: FilePatch; applied: AppliedPatch }>): PatchStat[] {
    return patches.map(({ patch, applied }) => {
      const diff = diffLines(applied.original ?? "", patch.content, patch.path);
      return {
        path: patch.path,
        reason: patch.reason,
        added: diff.added,
        removed: diff.removed,
      };
    });
  }
}
