import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExecResult } from "../core/types.js";

const MAX_CAPTURE = 2_000_000;

function appendCapped(buffer: string, chunk: string): string {
  const next = buffer + chunk;
  if (next.length <= MAX_CAPTURE) return next;
  return next.slice(next.length - MAX_CAPTURE);
}

function killTree(pid: number | undefined): void {
  if (!pid) return;
  if (process.platform === "win32") {
    spawn("taskkill", ["/pid", String(pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    }).on("error", () => undefined);
    return;
  }
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // Process already exited.
    }
  }
}

export async function execute(
  command: string,
  cwd: string,
  timeoutMs: number,
): Promise<ExecResult> {
  const startedAt = Date.now();
  const pycache = mkdtempSync(join(tmpdir(), "aegis-pycache-"));

  return await new Promise<ExecResult>((resolve) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;

    const child = spawn(command, {
      cwd,
      shell: true,
      windowsHide: true,
      env: { ...process.env, FORCE_COLOR: "1", PYTHONPYCACHEPREFIX: pycache },
      detached: process.platform !== "win32",
    });

    const finish = (exitCode: number, extraError?: string): void => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      rmSync(pycache, { recursive: true, force: true });
      if (extraError) stderr = appendCapped(stderr, extraError);
      resolve({
        command,
        cwd,
        exitCode,
        stdout,
        stderr,
        durationMs: Date.now() - startedAt,
        timedOut,
      });
    };

    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child.pid);
      setTimeout(() => finish(124), 1500);
    }, timeoutMs);

    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      stdout = appendCapped(stdout, chunk);
    });
    child.stderr?.on("data", (chunk: string) => {
      stderr = appendCapped(stderr, chunk);
    });

    child.on("error", (error) => {
      finish(127, `Aegis could not start the command: ${error.message}`);
    });

    child.on("close", (code, signal) => {
      if (timedOut) {
        finish(124, `Command timed out after ${Math.round(timeoutMs / 1000)}s and was terminated.`);
        return;
      }
      if (typeof code === "number") {
        finish(code);
        return;
      }
      finish(1, `Command terminated by signal ${signal ?? "unknown"}.`);
    });
  });
}
