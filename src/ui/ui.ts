import ora, { type Ora } from "ora";
import { colorLogo, theme } from "./theme.js";
import { formatDuration, indent, stripAnsi } from "../util/text.js";

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

  task(text: string): TaskHandle {
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

    const spinner = ora({
      text,
      spinner: "dots12",
      color: "cyan",
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
    this.box("BUILD GREEN  ·  AEGIS SELF-HEALED", summary, theme.successBold);
    for (const line of details) write(`  ${theme.text(line)}`);
    if (reportPath) write(`  ${theme.muted("report")}  ${theme.muted(reportPath)}`);
    write();
  }

  verdictFailure(summary: string, details: string[], reportPath: string | null): void {
    if (this.json) return;
    write();
    this.box("BUILD RED  ·  HUMAN ASSISTANCE NEEDED", summary, theme.dangerBold);
    for (const line of details) write(`  ${theme.text(line)}`);
    if (reportPath) write(`  ${theme.muted("report")}  ${theme.muted(reportPath)}`);
    write();
  }

  private box(title: string, subtitle: string, color: (input: string) => string): void {
    const width = 64;
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
