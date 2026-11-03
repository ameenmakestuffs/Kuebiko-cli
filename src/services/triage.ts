import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, isAbsolute, join, normalize, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { AssertionHint, ExecResult, SourceLocation, TriageResult } from "../core/types.js";
import { oneLine, stripAnsi, tail } from "../util/text.js";

const CODE_EXTENSIONS = new Set([".js", ".mjs", ".cjs", ".jsx", ".ts", ".tsx", ".py", ".go", ".rs", ".java", ".rb", ".php"]);

const FILE_LOCATION_PATTERNS: RegExp[] = [
  /(?:file:\/\/\/)?((?:[A-Za-z]:[\\/]|\/|\.{1,2}[\\/])?[A-Za-z0-9_.@\-%\\/[\]]*?\.(?:js|mjs|cjs|jsx|tsx|ts|py|go|rs|java|rb|php)):(\d+)(?::(\d+))?/g,
  /File\s+"([^"]+)",\s+line\s+(\d+)/g,
];

const TEST_FILE_PATTERN =
  /(?:^|[\\/])(?:test|tests|spec|__tests__)(?:[\\/]|$)|\.(?:test|spec)\.[a-z]+$|(?:^|[\\/])_?test_?[^\\/]*\.py$|_test\.go$/i;

function normalizeOutput(result: ExecResult): string {
  const stdout = stripAnsi(result.stdout).replace(/\r/g, "");
  const stderr = stripAnsi(result.stderr).replace(/\r/g, "");
  const parts: string[] = [];
  if (stdout.trim()) parts.push(`--- stdout ---\n${stdout.trimEnd()}`);
  if (stderr.trim()) parts.push(`--- stderr ---\n${stderr.trimEnd()}`);
  return parts.join("\n");
}

function canonicalize(raw: string, root: string): string | null {
  let value = raw.trim();
  if (!value) return null;

  if (value.startsWith("file://")) {
    try {
      value = fileURLToPath(value);
    } catch {
      value = decodeURIComponent(value.replace(/^file:\/\/\/?/, ""));
    }
  }

  value = value.replace(/^["'(]+|["')]+$/g, "");
  if (!value) return null;

  const absolute = isAbsolute(value) ? normalize(value) : resolve(root, value);
  return existsSync(absolute) ? absolute : null;
}

function isIgnored(file: string, root: string, ignore: string[]): boolean {
  const relativePath = relative(root, file).replace(/\\/g, "/").toLowerCase();
  return ignore.some((entry) => {
    const needle = entry.toLowerCase().replace(/\\/g, "/");
    return relativePath.split("/").includes(needle) || relativePath.startsWith(`${needle}/`);
  });
}

export function extractLocations(output: string, root: string, ignore: string[]): SourceLocation[] {
  const found = new Map<string, SourceLocation>();

  for (const pattern of FILE_LOCATION_PATTERNS) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(output)) !== null) {
      const rawFile = match[1];
      if (!rawFile) continue;
      const line = Number(match[2] ?? "1");
      const column = Number(match[3] ?? "1");
      if (!Number.isFinite(line) || line <= 0) continue;

      const absolute = canonicalize(rawFile, root);
      if (!absolute || isIgnored(absolute, root, ignore)) continue;
      if (!CODE_EXTENSIONS.has(extname(absolute).toLowerCase())) continue;

      const key = `${absolute}:${line}`;
      if (!found.has(key)) {
        found.set(key, { file: absolute, line, column: Number.isFinite(column) ? column : 1 });
      }
    }
  }

  return [...found.values()];
}

function resolveImport(fromFile: string, specifier: string, root: string): string | null {
  if (!specifier.startsWith(".")) return null;
  const base = resolve(dirname(fromFile), specifier);
  const extension = extname(base);

  const candidates: string[] = [base];
  if (extension === ".js" || extension === ".jsx" || extension === ".mjs" || extension === ".cjs") {
    const stem = base.slice(0, -extension.length);
    candidates.push(`${stem}.ts`, `${stem}.tsx`, `${stem}.jsx`, `${stem}.js`, `${stem}.mjs`, `${stem}.cjs`);
  }
  candidates.push(
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.js`,
    `${base}.jsx`,
    `${base}.mjs`,
    `${base}.cjs`,
    `${base}.py`,
    join(base, "index.ts"),
    join(base, "index.tsx"),
    join(base, "index.js"),
    join(base, "__init__.py"),
  );

  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    const normalized = normalize(candidate);
    if (!normalized.startsWith(normalize(root))) continue;
    return normalized;
  }
  return null;
}

function pythonRelativeBase(fromFile: string, levels: number): string {
  let base = dirname(fromFile);
  for (let index = 1; index < levels; index += 1) base = dirname(base);
  return base;
}

function pythonSourcesIn(directory: string): string[] {
  let entries: import("node:fs").Dirent<string>[];
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".py") && entry.name !== "__init__.py")
    .map((entry) => join(directory, entry.name));
}

function resolvePythonImport(fromFile: string, specifier: string, root: string): string | null {
  const value = specifier.trim();
  if (!value) return null;

  let base: string;
  if (value.startsWith(".")) {
    const levels = /^\.+/.exec(value)?.[0].length ?? 1;
    const rest = value.slice(levels).replace(/\./g, "/");
    base = pythonRelativeBase(fromFile, levels);
    if (rest) base = resolve(base, rest);
  } else {
    base = resolve(root, value.replace(/\./g, "/"));
  }

  for (const candidate of [`${base}.py`, join(base, "__init__.py")]) {
    if (existsSync(candidate)) return normalize(candidate);
  }
  return null;
}

function goModuleName(root: string): string {
  try {
    const source = readFileSync(join(root, "go.mod"), "utf8").slice(0, 20_000);
    return /^\s*module\s+(\S+)/m.exec(source)?.[1] ?? "";
  } catch {
    return "";
  }
}

function goFilesIn(directory: string): string[] {
  let entries: import("node:fs").Dirent<string>[];
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".go"))
    .map((entry) => join(directory, entry.name));
}

function resolveGoImport(specifier: string, root: string, module: string): string[] {
  if (!module) return [];
  let directory: string;
  if (specifier === module) {
    directory = root;
  } else if (specifier.startsWith(`${module}/`)) {
    directory = join(root, specifier.slice(module.length + 1));
  } else {
    return [];
  }
  const normalized = normalize(directory);
  const rel = relative(root, normalized);
  if (rel.startsWith("..") || isAbsolute(rel)) return [];
  if (existsSync(normalized) && statSync(normalized).isFile()) return [normalized];
  return goFilesIn(normalized);
}

function importsOf(file: string, root: string): string[] {
  let source: string;
  try {
    source = readFileSync(file, "utf8");
  } catch {
    return [];
  }
  if (source.length > 400_000) source = source.slice(0, 400_000);

  const extension = extname(file).toLowerCase();
  const resolved: string[] = [];
  const add = (target: string | null): void => {
    if (target && !resolved.includes(target)) resolved.push(target);
  };

  if (extension === ".py") {
    const fromPattern = /^\s*from\s+([.\w]+)\s+import\s+[^\n#]+/gm;
    const importPattern = /^\s*import\s+([^\n#]+)/gm;
    let match: RegExpExecArray | null;
    while ((match = fromPattern.exec(source)) !== null) {
      const specifier = match[1] ?? "";
      if (/^\.+$/.test(specifier)) {
        for (const target of pythonSourcesIn(pythonRelativeBase(file, specifier.length))) add(target);
      } else if (specifier) {
        add(resolvePythonImport(file, specifier, root));
      }
    }
    while ((match = importPattern.exec(source)) !== null) {
      for (const part of (match[1] ?? "").split(",")) {
        const specifier = part.trim().split(/\s+/)[0];
        if (specifier) add(resolvePythonImport(file, specifier, root));
      }
    }
    return resolved;
  }

  if (extension === ".go") {
    const module = goModuleName(root);
    const specifiers = new Set<string>();
    const single = /^\s*import\s+"([^"]+)"/gm;
    const block = /^\s*import\s*\(([\s\S]*?)\)/gm;
    let match: RegExpExecArray | null;
    while ((match = single.exec(source)) !== null) {
      if (match[1]) specifiers.add(match[1]);
    }
    while ((match = block.exec(source)) !== null) {
      const quoted = /"([^"]+)"/g;
      let quotedMatch: RegExpExecArray | null;
      while ((quotedMatch = quoted.exec(match[1] ?? "")) !== null) {
        if (quotedMatch[1]) specifiers.add(quotedMatch[1]);
      }
    }
    for (const specifier of specifiers) {
      for (const target of resolveGoImport(specifier, root, module)) add(target);
    }
    return resolved;
  }

  const specifiers = new Set<string>();
  const jsPatterns = [
    /(?:import|export)\s+(?:[^'"]*?\s+from\s+)?["']([^"']+)["']/g,
    /\brequire\(\s*["']([^"']+)["']\s*\)/g,
    /\bimport\(\s*["']([^"']+)["']\s*\)/g,
  ];
  for (const pattern of jsPatterns) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(source)) !== null) {
      if (match[1]) specifiers.add(match[1]);
    }
  }

  for (const specifier of specifiers) {
    add(resolveImport(file, specifier, root));
  }
  return resolved;
}

export function detectFramework(output: string, command: string): string {
  const haystack = `${command}\n${output}`.toLowerCase();
  if (/\berror\s+ts\d+/.test(haystack)) return "TypeScript";
  if (haystack.includes("vitest")) return "Vitest";
  if (haystack.includes("jest") || haystack.includes("● ")) return "Jest";
  if (
    haystack.includes("node:test") ||
    haystack.includes("not ok ") ||
    haystack.includes("✖") ||
    haystack.includes("✔") ||
    haystack.includes("▶") ||
    /# tests \d+/.test(haystack)
  ) {
    return "node:test";
  }
  if (haystack.includes("pytest") || haystack.includes("= failures =")) return "pytest";
  if (/ran \d+ tests? in [\d.]+s/.test(haystack) || haystack.includes("unittest")) return "unittest";
  if (haystack.includes("--- fail") || haystack.includes("panic:") || haystack.includes("go test")) return "go test";
  if (haystack.includes("mocha")) return "Mocha";
  if (haystack.includes("cargo test")) return "cargo";
  if (haystack.includes("rspec")) return "RSpec";
  if (/\b(test|jest|vitest|pytest|tsc|build)\b/.test(command.toLowerCase())) return "generic test runner";
  return "unknown";
}

function findHeadline(output: string): string {
  const patterns = [
    /AssertionError[^\n]*/,
    /\berror TS\d+[^\n]*/,
    /\bE\s{2,}[^\n]*/,
    /--- FAIL:[^\n]*/,
    /\bFAILED[^\n]*/,
    /✕[^\n]*/,
    /not ok \d+[^\n]*/,
    /\bpanic:[^\n]*/i,
    /\bfatal error:[^\n]*/i,
    /\bError:[^\n]*/,
    /\bfailed[^\n]*/i,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(output);
    if (match) return oneLine(match[0], 220);
  }
  const lines = output.split("\n").map((line) => line.trim()).filter(Boolean);
  return oneLine(lines[lines.length - 1] ?? "The command exited with a non-zero status.", 220);
}

function findAssertion(output: string): AssertionHint | undefined {
  const hint: AssertionHint = {};

  const message = /AssertionError(?:\s*\[[^\]]+\])?:\s*([^\n]+)/.exec(output);
  if (message?.[1]) hint.message = oneLine(message[1], 200);

  const nodeExpected = /\bexpected:\s*([^,\n]+)/i.exec(output);
  const nodeActual = /\bactual:\s*([^,\n]+)/i.exec(output);
  if (nodeExpected?.[1]) hint.expected = oneLine(nodeExpected[1], 120);
  if (nodeActual?.[1]) hint.actual = oneLine(nodeActual[1], 120);

  const jestExpected = /Expected:\s*([^\n]+)/.exec(output);
  const jestReceived = /Received:\s*([^\n]+)/.exec(output);
  if (!hint.expected && jestExpected?.[1]) hint.expected = oneLine(jestExpected[1], 120);
  if (!hint.actual && jestReceived?.[1]) hint.actual = oneLine(jestReceived[1], 120);

  const strictEqual = /Expected values to be strictly equal:\s*\n+\s*([^\n]+?)\s*!==\s*([^\n]+)/.exec(output);
  if (!hint.actual && strictEqual?.[1]) hint.actual = oneLine(strictEqual[1], 120);
  if (!hint.expected && strictEqual?.[2]) hint.expected = oneLine(strictEqual[2], 120);

  const pytest = /assert\s+([^\n=]+?)\s*==\s*([^\n]+)/.exec(output);
  if (!hint.actual && pytest?.[1]) hint.actual = oneLine(pytest[1], 120);
  if (!hint.expected && pytest?.[2]) hint.expected = oneLine(pytest[2], 120);

  const pythonNe = /AssertionError:\s*([^\n]+?)\s*!=\s*([^\n]+)/.exec(output);
  if (!hint.actual && pythonNe?.[1]) hint.actual = oneLine(pythonNe[1], 120);
  if (!hint.expected && pythonNe?.[2]) hint.expected = oneLine(pythonNe[2], 120);

  const goWant = /=\s*([^;\n]+);\s*want\s+([^\n]+)/.exec(output);
  if (!hint.actual && goWant?.[1]) hint.actual = oneLine(goWant[1], 120);
  if (!hint.expected && goWant?.[2]) hint.expected = oneLine(goWant[2], 120);

  return Object.keys(hint).length > 0 ? hint : undefined;
}

export function triage(result: ExecResult, root: string, ignore: string[]): TriageResult {
  const output = normalizeOutput(result);
  const locations = extractLocations(output, root, ignore);
  const framework = detectFramework(output, result.command);

  const imported = new Set<string>();
  for (const location of locations) {
    for (const target of importsOf(location.file, root)) {
      if (!isIgnored(target, root, ignore)) imported.add(target);
    }
  }

  const directSource: string[] = [];
  const testFiles: string[] = [];
  for (const location of locations) {
    if (TEST_FILE_PATTERN.test(location.file)) testFiles.push(location.file);
    else if (!directSource.includes(location.file)) directSource.push(location.file);
  }

  const suspects: string[] = [];
  const add = (file: string): void => {
    if (!suspects.includes(file)) suspects.push(file);
  };
  for (const file of imported) add(file);
  for (const file of directSource) add(file);
  for (const file of testFiles) add(file);

  const assertion = findAssertion(output);

  return {
    framework,
    headline: findHeadline(output),
    locations,
    suspects: suspects.slice(0, 12),
    tail: tail(output, 12_000),
    ...(assertion ? { assertion } : {}),
  };
}

export function isTestFile(file: string): boolean {
  return TEST_FILE_PATTERN.test(file);
}
