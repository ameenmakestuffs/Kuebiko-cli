import { relative } from "node:path";
import ora, { type Ora } from "ora";
import { colorLogo, theme, microSpinners, type MicroAnimationType } from "./theme.js";
import { formatDuration, indent, stripAnsi } from "../util/text.js";
import type { TriageResult } from "../core/types.js";

export interface TaskHandle {
  update(text: string): void;
  succeed(text?: string): void;
  fail(text?: string): void;
  warn(text?: string): void;
  stop(): void;
}

export interface UiOptions {
  json: boolean;
  verbose: boolean;
}

function write(line = ""): void {
  process.stdout.write(`${line}\n`);
}

export class Ui {
  readonly json: boolean;
  readonly verbose: boolean;
  private readonly interactive: boolean;
  private readonly activeTasks = new Set<Ora>();

  constructor(options: UiOptions) {
    this.json = options.json;
    this.verbose = options.verbose;
    this.interactive = Boolean(process.stdout.isTTY) && process.env.NO_SPINNER !== "1";
  }

  banner(version: string, tagline: string): void {
    if (this.json) return;
    write();
    for (const line of colorLogo()) write(line);
    write(`  ${theme.brand(tagline)}  ${theme.muted(`v${version}`)}`);
    write();
  }

  blank(): void {
    if (this.json) return;
    write();
  }

  kv(rows: Array<[string, string]>): void {
    if (this.json) return;
    const width = Math.max(...rows.map(([key]) => key.length));
    for (const [key, value] of rows) {
      write(`  ${theme.muted(key.padEnd(width))}  ${value}`);
    }
  }

  step(message: string): void {
    if (this.json) return;
    write(`  ${theme.accent("›")} ${message}`);
  }

  stepHeader(stepNumber: number, totalSteps: number, title: string, subtitle?: string): void {
    if (this.json) return;
    write();
    const badge = theme.badge(`STEP ${stepNumber}/${totalSteps}`, "#FFFFFF", "#6366F1");
    write(`  ${badge}  ${theme.brandBold(title)}${subtitle ? ` ${theme.muted(`· ${subtitle}`)}` : ""}`);
  }

  info(message: string): void {
    if (this.json) return;
    write(`  ${theme.accent("ℹ")} ${message}`);
  }

  success(message: string): void {
    if (this.json) return;
    write(`  ${theme.success("✔")} ${message}`);
  }

  fail(message: string): void {
    if (this.json) return;
    write(`  ${theme.danger("✖")} ${message}`);
  }

  warn(message: string): void {
    if (this.json) return;
    write(`  ${theme.warning("▲")} ${message}`);
  }

  muted(message: string): void {
    if (this.json) return;
    write(`  ${theme.muted(message)}`);
  }

  heading(message: string): void {
    if (this.json) return;
    write();
    write(`  ${theme.bold(message)}`);
  }

  task(text: string, type: MicroAnimationType = "thinking"): TaskHandle {
    if (this.json) {
      return {
        update: () => undefined,
        succeed: () => undefined,
        fail: () => undefined,
        warn: () => undefined,
        stop: () => undefined,
      };
    }

    let current = text;
    if (!this.interactive) {
      write(`  ${theme.accent("◐")} ${text}`);
      return {
        update: (next) => {
          current = next;
        },
        succeed: (message) => write(`  ${theme.success("✔")} ${message ?? current}`),
        fail: (message) => write(`  ${theme.danger("✖")} ${message ?? current}`),
        warn: (message) => write(`  ${theme.warning("▲")} ${message ?? current}`),
        stop: () => undefined,
      };
    }

    const config = microSpinners[type] ?? microSpinners.thinking;
    const spinner = ora({
      text,
      spinner: {
        interval: config.interval,
        frames: config.frames,
      },
      stream: process.stdout,
    }).start();
    this.activeTasks.add(spinner);

    const finish = (): void => {
      this.activeTasks.delete(spinner);
    };

    return {
      update: (next) => {
        current = next;
        spinner.text = next;
      },
      succeed: (message) => {
        finish();
        spinner.succeed(message ?? current);
      },
      fail: (message) => {
        finish();
        spinner.fail(message ?? current);
      },
      warn: (message) => {
        finish();
        spinner.warn(message ?? current);
      },
      stop: () => {
        finish();
        spinner.stop();
      },
    };
  }

  agentBox(options: {
    targetFile: string;
    extraFiles?: string[];
    headline: string;
    todos: Array<{ label: string; done: boolean }>;
    footer?: string;
  }): void {
    if (this.json) return;
    write();

    // Context files indexed (dim)
    if (options.extraFiles && options.extraFiles.length > 0) {
      for (const f of options.extraFiles.slice(0, 3)) {
        write(`    ${theme.muted(f)}`);
      }
      if (options.extraFiles.length > 3) {
        write(`    ${theme.dim(`${options.extraFiles.length - 3} more files indexed`)}`);
      }
      write();
    }

    const width = 64;
    const border = theme.muted("─".repeat(width));
    write(`  ${theme.muted("┌")}${border}${theme.muted("┐")}`);

    // Target pill
    const targetPadded = `  ${theme.badge(options.targetFile, "#FFFFFF", "#1E1E2E")}`;
    const padRight1 = Math.max(0, width - stripAnsi(targetPadded).length - 2);
    write(`  ${theme.muted("│")}${targetPadded}${" ".repeat(padRight1)}${theme.muted("│")}`);
    write(`  ${theme.muted("│")}${" ".repeat(width)}${theme.muted("│")}`);

    // Headline
    const hl = `  ${theme.text(options.headline)}`;
    const padRight2 = Math.max(0, width - stripAnsi(hl).length - 2);
    write(`  ${theme.muted("│")}${hl}${" ".repeat(padRight2)}${theme.muted("│")}`);
    write(`  ${theme.muted("│")}${" ".repeat(width)}${theme.muted("│")}`);

    // Working on to-dos
    const todoHdr = `  ${theme.brand("⬡ Working on " + options.todos.length + " to-dos")}`;
    const padRight3 = Math.max(0, width - stripAnsi(todoHdr).length - 2);
    write(`  ${theme.muted("│")}${todoHdr}${" ".repeat(padRight3)}${theme.muted("│")}`);

    for (const todo of options.todos) {
      const mark = todo.done ? theme.success("☒") : theme.muted("☐");
      const label = todo.done ? theme.dim(todo.label) : theme.text(todo.label);
      const line = `    ${mark} ${label}`;
      const padRight = Math.max(0, width - stripAnsi(line).length - 2);
      write(`  ${theme.muted("│")}${line}${" ".repeat(padRight)}${theme.muted("│")}`);
    }

    write(`  ${theme.muted("│")}${" ".repeat(width)}${theme.muted("│")}`);
    write(`  ${theme.muted("└")}${border}${theme.muted("┘")}`);

    if (options.footer) {
      write(`  ${theme.dim(options.footer)}`);
    }
    write();
  }

  diagnosisCard(
    diagnosis: TriageResult,
    iteration: number,
    maxIterations: number,
    cwd: string,
  ): void {
    if (this.json) return;
    this.stepHeader(1, 3, "Triage & Root Cause Diagnosis", `Attempt ${iteration} of ${maxIterations}`);
    write();

    // Runner pill + headline
    const frameworkLabel = diagnosis.framework || "generic test runner";
    const pill = theme.pill(frameworkLabel, "#38BDF8", "#0F172A");
    write(`  ${pill}  ${theme.dangerBold(diagnosis.headline || "Test execution failed")}`);

    // Clean Assertion Breakdown
    if (diagnosis.assertion) {
      write();
      write(`  ${theme.muted("┌─")} ${theme.bold("Assertion Discrepancy")}`);
      if (diagnosis.assertion.expected !== undefined) {
        write(
          `  ${theme.muted("│")}   ${theme.muted("Expected: ")} ${theme.successBold(diagnosis.assertion.expected)}  ${theme.success("✔ (what test expected)")}`,
        );
      }
      if (diagnosis.assertion.actual !== undefined) {
        write(
          `  ${theme.muted("│")}   ${theme.muted("Received: ")} ${theme.dangerBold(diagnosis.assertion.actual)}  ${theme.danger("✖ (what code returned)")}`,
        );
      }
      write(`  ${theme.muted("└─────────────────────────────────────────────────────────────")}`);
    }

    // Suspects list with visual badges
    if (diagnosis.suspects.length > 0) {
      write();
      write(`  ${theme.accentBold("🎯 Suspect Files on the Scene:")}`);
      diagnosis.suspects.slice(0, 4).forEach((file, index) => {
        const rel = relative(cwd, file).split(/[\\/]/).join("/") || file;
        const tag = index === 0 ? theme.pillYellow("Most Likely") : theme.muted("Related");
        write(`     ${theme.accent("•")} ${theme.filePath(rel)}  ${tag}`);
      });
    }

    // Trace output box
    if (diagnosis.tail) {
      write();
      this.outputTail("Failure Output Snippet", diagnosis.tail, this.verbose ? 200 : 10);
    }
  }

  outputTail(label: string, output: string, maxLines = 14): void {
    if (this.json) return;
    const clean = stripAnsi(output).replace(/\r/g, "").trimEnd();
    if (!clean) return;
    const lines = clean.split("\n");
    const shown = lines.slice(-maxLines);
    const hidden = lines.length - shown.length;
    write(`  ${theme.muted(`┌─ ${label}${hidden > 0 ? ` (last ${shown.length} of ${lines.length} lines)` : ""}`)}`);
    for (const line of shown) {
      write(`  ${theme.muted("│")} ${theme.dim(line)}`);
    }
    write(`  ${theme.muted("└─")}`);
  }

  fullOutput(label: string, output: string): void {
    if (this.json || !this.verbose) return;
    const clean = stripAnsi(output).replace(/\r/g, "").trimEnd();
    if (!clean) return;
    this.outputTail(label, clean, clean.split("\n").length);
  }

  diff(label: string, diff: string): void {
    if (this.json) return;
    write();
    write(`  ${theme.bold(label)}`);
    for (const line of diff.split("\n")) {
      if (line.startsWith("+++") || line.startsWith("---")) write(`  ${theme.bold(line)}`);
      else if (line.startsWith("@@")) write(`  ${theme.accent(line)}`);
      else if (line.startsWith("+")) write(`  ${theme.success(line)}`);
      else if (line.startsWith("-")) write(`  ${theme.danger(line)}`);
      else write(`  ${theme.muted(line)}`);
    }
  }

  note(label: string, body: string): void {
    if (this.json) return;
    write(`  ${theme.muted(`${label}:`)} ${body}`);
  }

  verdictSuccess(summary: string, details: string[], reportPath: string | null): void {
    if (this.json) return;
    write();
    const humorTaglines = [
      "Crisis averted. Go grab a coffee, we got this ☕✨",
      "Tests are green. Back to shipping features! 🚀",
      "Self-healed with precision. Another bug bites the dust 🛡️",
      "Build turned green without breaking a sweat 💪",
    ];
    const tagline = humorTaglines[Math.floor(Math.random() * humorTaglines.length)];
    this.box("BUILD GREEN  ·  KUEBIKO SELF-HEALED", `${summary} · ${tagline}`, theme.successBold);
    for (const line of details) write(`  ${theme.text(line)}`);
    if (reportPath) write(`  ${theme.muted("report")}  ${theme.muted(reportPath)}`);
    write();
  }

  verdictFailure(summary: string, details: string[], reportPath: string | null): void {
    if (this.json) return;
    write();
    this.box("BUILD RED  ·  HUMAN ASSISTANCE NEEDED", `${summary} · Even superheroes need a hand sometimes 🦸`, theme.dangerBold);
    for (const line of details) write(`  ${theme.text(line)}`);
    if (reportPath) write(`  ${theme.muted("report")}  ${theme.muted(reportPath)}`);
    write();
  }

  private box(title: string, subtitle: string, color: (input: string) => string): void {
    const width = 66;
    const titleLine = ` ${color(title)}`;
    const bottom = `  ${theme.muted(`╰${"─".repeat(width)}╯`)}`;
    write(`  ${theme.muted(`╭${"─".repeat(width)}╮`)}`);
    write(`  ${theme.muted("│")}${titleLine}${" ".repeat(Math.max(0, width - title.length - 1))}${theme.muted("│")}`);
    const clipped = subtitle.length > width - 3 ? `${subtitle.slice(0, width - 4)}…` : subtitle;
    write(`  ${theme.muted("│")} ${theme.dim(clipped.padEnd(width - 2))} ${theme.muted("│")}`);
    write(bottom);
  }
}

export function attemptHeading(
  iteration: number,
  maxIterations: number,
  engineLabel: string,
  duration: number,
): string {
  return `${theme.bold(`repair ${iteration}/${maxIterations}`)} ${theme.muted("·")} ${theme.accent(engineLabel)} ${theme.muted(`· ${formatDuration(duration)}`)}`;
}

export function printRaw(text: string): void {
  write(indent(text));
}
