import { existsSync, readFileSync } from "node:fs";
import { extname, join, relative } from "node:path";
import type { FilePatch, RepairProposal, TriageResult } from "../core/types.js";
import { listProjectTree } from "./context.js";
import { isTestFile } from "./triage.js";

const CODE_EXTENSIONS = new Set([".js", ".mjs", ".cjs", ".jsx", ".ts", ".tsx", ".py", ".go"]);
const MAX_FILE_BYTES = 400_000;

const OP_SWAPS: Record<string, string[]> = {
  "+": ["-"],
  "-": ["+"],
  "*": ["/"],
  "/": ["*"],
  "%": ["*"],
  "===": ["!=="],
  "!==": ["==="],
  "==": ["!="],
  "!=": ["=="],
  ">": ["<"],
  "<": [">"],
  ">=": ["<="],
  "<=": [">="],
  "&&": ["||"],
  "||": ["&&"],
  and: ["or"],
  or: ["and"],
};

const STOP_WORDS = new Set([
  "the", "and", "for", "with", "that", "this", "from", "have", "not", "are", "was", "were",
  "error", "expected", "actual", "assert", "assertion", "test", "tests", "should", "when",
  "then", "true", "false", "null", "undefined", "const", "let", "var", "function", "return",
  "import", "export", "default", "class", "async", "await", "value", "values", "line", "file",
  "code", "failed", "failure", "pass", "passing", "strictly", "equal", "received", "message",
  "stack", "at", "in", "of", "to", "is", "on", "by", "an", "be", "it", "as", "or", "if", "else",
]);

type TokenKind = "operator" | "number" | "boolean";

interface Token {
  kind: TokenKind;
  start: number;
  end: number;
  text: string;
  line: number;
}

interface Candidate {
  file: string;
  relPath: string;
  content: string;
  label: string;
  line: number;
  score: number;
}

export interface LocalRepairInput {
  root: string;
  suspects: string[];
  triage: TriageResult;
  ignore: string[];
  maxCandidates: number;
  verify: (patch: FilePatch) => Promise<boolean>;
  onCandidate?: (current: number, total: number, label: string) => void;
}

function isIdentifierStart(char: string): boolean {
  return /[A-Za-z_$]/.test(char);
}

function isIdentifierPart(char: string): boolean {
  return /[A-Za-z0-9_$]/.test(char);
}

function isDigit(char: string): boolean {
  return char >= "0" && char <= "9";
}

function skipQuoted(code: string, start: number, quote: string): number {
  let i = start + 1;
  while (i < code.length) {
    if (code[i] === "\\") {
      i += 2;
      continue;
    }
    if (code[i] === quote) return i + 1;
    i += 1;
  }
  return code.length;
}

function lineIndex(code: string): number[] {
  const starts = [0];
  for (let i = 0; i < code.length; i += 1) {
    if (code[i] === "\n") starts.push(i + 1);
  }
  return starts;
}

function lineFor(starts: number[], offset: number): number {
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if ((starts[mid] ?? 0) <= offset) low = mid;
    else high = mid - 1;
  }
  return low + 1;
}

function isBinaryContext(code: string, start: number, end: number): boolean {
  let left = start - 1;
  while (left >= 0 && /\s/.test(code[left] ?? "")) left -= 1;
  let right = end;
  while (right < code.length && /\s/.test(code[right] ?? "")) right += 1;

  if (left < 0 || right >= code.length) return false;
  const prev = code[left] ?? "";
  const next = code[right] ?? "";

  if ("([{,;:=!?&|<>+-*/%^~".includes(prev)) return false;
  if (")]},;:".includes(next)) return false;
  return true;
}

function scan(code: string, python: boolean): Token[] {
  const tokens: Token[] = [];
  const starts = lineIndex(code);
  let i = 0;

  while (i < code.length) {
    const char = code[i] ?? "";
    const next = code[i + 1] ?? "";

    if (python && char === "#") {
      i = code.indexOf("\n", i);
      if (i === -1) break;
      continue;
    }

    if (!python && char === "/" && next === "/") {
      i = code.indexOf("\n", i);
      if (i === -1) break;
      continue;
    }

    if (!python && char === "/" && next === "*") {
      const close = code.indexOf("*/", i + 2);
      i = close === -1 ? code.length : close + 2;
      continue;
    }

    if (python && (code.startsWith('"""', i) || code.startsWith("'''", i))) {
      const quote = code.slice(i, i + 3);
      const close = code.indexOf(quote, i + 3);
      i = close === -1 ? code.length : close + 3;
      continue;
    }

    if (char === '"' || char === "'" || (!python && char === "`")) {
      i = skipQuoted(code, i, char);
      continue;
    }

    if (isIdentifierStart(char)) {
      let end = i + 1;
      while (end < code.length && isIdentifierPart(code[end] ?? "")) end += 1;
      const text = code.slice(i, end);
      if (text === "true" || text === "false" || (python && (text === "True" || text === "False"))) {
        tokens.push({ kind: "boolean", start: i, end, text, line: lineFor(starts, i) });
      } else if (python && (text === "and" || text === "or")) {
        tokens.push({ kind: "operator", start: i, end, text, line: lineFor(starts, i) });
      }
      i = end;
      continue;
    }

    if (isDigit(char)) {
      const prevChar = i > 0 ? code[i - 1] ?? "" : "";
      if (prevChar && isIdentifierPart(prevChar)) {
        i += 1;
        continue;
      }
      const match = /^\d+(?:\.\d+)?(?:e[+-]?\d+)?/i.exec(code.slice(i));
      if (match) {
        const text = match[0];
        const end = i + text.length;
        const after = code[end] ?? "";
        if (!after || !isIdentifierPart(after)) {
          tokens.push({ kind: "number", start: i, end, text, line: lineFor(starts, i) });
        }
        i = end;
        continue;
      }
    }

    const three = code.slice(i, i + 3);
    if (three === "===" || three === "!==") {
      if (isBinaryContext(code, i, i + 3)) {
        tokens.push({ kind: "operator", start: i, end: i + 3, text: three, line: lineFor(starts, i) });
      }
      i += 3;
      continue;
    }

    const two = code.slice(i, i + 2);
    if (["==", "!=", ">=", "<=", "&&", "||"].includes(two)) {
      if (isBinaryContext(code, i, i + 2)) {
        tokens.push({ kind: "operator", start: i, end: i + 2, text: two, line: lineFor(starts, i) });
      }
      i += 2;
      continue;
    }

    if (["+=", "-=", "*=", "/=", "%=", "=>", "->", "++", "--", "**", "<<", ">>"].includes(two)) {
      i += 2;
      continue;
    }

    if ("+-*/%<>".includes(char)) {
      if (isBinaryContext(code, i, i + 1)) {
        tokens.push({ kind: "operator", start: i, end: i + 1, text: char, line: lineFor(starts, i) });
      }
      i += 1;
      continue;
    }

    i += 1;
  }

  return tokens;
}

function hotIdentifiers(triage: TriageResult): Set<string> {
  const source = `${triage.headline}\n${triage.assertion?.message ?? ""}\n${triage.tail.slice(-5000)}`;
  const counts = new Map<string, number>();
  const matches = source.match(/[A-Za-z_$][A-Za-z0-9_$]{2,}/g) ?? [];
  for (const match of matches) {
    const lower = match.toLowerCase();
    if (STOP_WORDS.has(lower)) continue;
    if (match.length < 3 || match.length > 40) continue;
    counts.set(match, (counts.get(match) ?? 0) + 1);
  }
  return new Set(
    [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([identifier]) => identifier),
  );
}

function candidateFiles(input: LocalRepairInput): string[] {
  const codeFiles = input.suspects.filter((file) => {
    if (!existsSync(file)) return false;
    if (!CODE_EXTENSIONS.has(extname(file).toLowerCase())) return false;
    try {
      const size = readFileSync(file, "utf8").length;
      return size <= MAX_FILE_BYTES;
    } catch {
      return false;
    }
  });

  const sourceFiles = codeFiles.filter((file) => !isTestFile(file));
  const tree = listProjectTree(input.root, input.ignore, 5, 500);
  const discovered = tree
    .filter((rel) => CODE_EXTENSIONS.has(extname(rel).toLowerCase()))
    .filter((rel) => !isTestFile(rel))
    .filter((rel) => !rel.includes("node_modules"))
    .map((rel) => join(input.root, rel))
    .filter((file) => existsSync(file) && !sourceFiles.includes(file));

  const merged = [...sourceFiles, ...discovered];
  if (merged.length > 0) return merged.slice(0, 6);
  if (codeFiles.length > 0) return codeFiles.slice(0, 4);
  return [];
}

function buildCandidates(input: LocalRepairInput): Candidate[] {
  const hot = hotIdentifiers(input.triage);
  const candidates: Candidate[] = [];
  const seen = new Set<string>();
  const files = candidateFiles(input);

  files.forEach((file, fileIndex) => {
    let code: string;
    try {
      code = readFileSync(file, "utf8");
    } catch {
      return;
    }

    const python = extname(file).toLowerCase() === ".py";
    const tokens = scan(code, python);
    const lines = code.split(/\r?\n/);
    const isTest = isTestFile(file);
    const relPath = relative(input.root, file).replace(/\\/g, "/");

    const hotLines = new Set<number>();
    lines.forEach((line, index) => {
      for (const identifier of hot) {
        if (line.includes(identifier)) {
          hotLines.add(index + 1);
          break;
        }
      }
    });

    const proximity = (line: number): number => {
      let best = 99;
      for (const hotLine of hotLines) best = Math.min(best, Math.abs(hotLine - line));
      return best;
    };

    const addCandidate = (token: Token, replacement: string, label: string, kindScore: number, reason: string): void => {
      const content = `${code.slice(0, token.start)}${replacement}${code.slice(token.end)}`;
      if (content === code) return;
      const key = `${file}\u0000${content}`;
      if (seen.has(key)) return;
      seen.add(key);

      const distance = proximity(token.line);
      let score = kindScore;
      score += Math.max(0, 8 - fileIndex) * 4;
      if (isTest) score -= 80;
      if (distance === 0) score += 35;
      else if (distance <= 5) score += 16;
      else if (distance <= 12) score += 6;
      score += Math.max(0, 10 - token.line / 40);
      if (lines[token.line - 1]?.includes("import ")) score -= 60;

      candidates.push({
        file,
        relPath,
        content,
        label,
        line: token.line,
        score,
      });
    };

    for (const token of tokens) {
      if (token.kind === "operator") {
        for (const replacement of OP_SWAPS[token.text] ?? []) {
          addCandidate(token, replacement, `${token.text} → ${replacement}`, 120, "operator");
        }
      } else if (token.kind === "boolean") {
        const isTrue = token.text.toLowerCase() === "true";
        const replacement = isTrue
          ? token.text === "True" ? "False" : "false"
          : token.text === "False" ? "True" : "true";
        addCandidate(token, replacement, `${token.text} → ${replacement}`, 80, "boolean");
      } else if (token.kind === "number") {
        const value = Number(token.text);
        if (!Number.isFinite(value)) continue;
        const replacements = [value + 1, value - 1].filter((next) => next >= 0);
        for (const replacement of replacements) {
          if (replacement === value) continue;
          addCandidate(token, String(replacement), `${token.text} → ${replacement}`, 45, "literal");
        }
      }
    }
  });

  candidates.sort((a, b) => b.score - a.score);
  return candidates;
}

export async function localRepair(input: LocalRepairInput): Promise<RepairProposal | null> {
  const all = buildCandidates(input);
  const candidates = all.slice(0, input.maxCandidates);
  if (candidates.length === 0) return null;

  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    if (!candidate) continue;
    input.onCandidate?.(index + 1, candidates.length, `${candidate.relPath}:${candidate.line} ${candidate.label}`);

    const patch: FilePatch = {
      path: candidate.relPath,
      content: candidate.content,
      reason: `Local mutation search matched the failing assertion (${candidate.label} at line ${candidate.line}).`,
    };

    if (await input.verify(patch)) {
      return {
        engine: "local",
        summary: `Corrected ${candidate.label} in ${candidate.relPath} (line ${candidate.line}) and verified the command turns green.`,
        patches: [patch],
      };
    }
  }

  return null;
}
