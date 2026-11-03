import { mkdir, readFile, rename, rm, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";

export async function pathExists(target: string): Promise<boolean> {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

export async function readTextFile(target: string): Promise<string | null> {
  try {
    return await readFile(target, "utf8");
  } catch {
    return null;
  }
}

export async function atomicWriteFile(target: string, content: string): Promise<void> {
  await mkdir(dirname(target), { recursive: true });
  const temp = join(
    dirname(target),
    `.${randomBytes(6).toString("hex")}-aegis.tmp`,
  );
  await writeFile(temp, content, "utf8");
  try {
    await rename(temp, target);
  } catch {
    await rm(target, { force: true });
    await rename(temp, target);
  } finally {
    await unlink(temp).catch(() => undefined);
  }
}

export async function removeFile(target: string): Promise<void> {
  await rm(target, { force: true });
}

export function isPathInside(root: string, candidate: string): boolean {
  const normalizedRoot = root.replace(/\\/g, "/").toLowerCase();
  const normalizedCandidate = candidate.replace(/\\/g, "/").toLowerCase();
  return normalizedCandidate === normalizedRoot || normalizedCandidate.startsWith(`${normalizedRoot}/`);
}
