import { existsSync } from "node:fs";
import { join, relative } from "node:path";
import type { SessionReport } from "../core/types.js";
import { atomicWriteFile } from "../util/fs.js";

export async function writeReport(root: string, report: SessionReport): Promise<string> {
  const dirName = existsSync(join(root, ".aegis")) && !existsSync(join(root, ".kuebiko")) ? ".aegis" : ".kuebiko";
  const dir = join(root, dirName, "reports");
  const fileName = `${report.id}.json`;
  const absolute = join(dir, fileName);
  const payload = `${JSON.stringify(report, null, 2)}\n`;

  await atomicWriteFile(absolute, payload);
  await atomicWriteFile(join(dir, "latest.json"), payload);

  return relative(root, absolute).split(/[\\/]/).join("/");
}

export function makeSessionId(): string {
  const now = new Date();
  const stamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
    "-",
    String(now.getHours()).padStart(2, "0"),
    String(now.getMinutes()).padStart(2, "0"),
    String(now.getSeconds()).padStart(2, "0"),
  ].join("");
  const random = Math.random().toString(36).slice(2, 7);
  return `kuebiko-${stamp}-${random}`;
}
