export interface DiffResult {
  text: string;
  added: number;
  removed: number;
}

const MAX_DIFF_LINES = 1500;
const MAX_DP_CELLS = 4_000_000;

type Op = "equal" | "add" | "remove";

interface Row {
  op: Op;
  line: string;
}

function fallback(before: string, after: string, label: string): DiffResult {
  const beforeLines = before.split(/\r?\n/);
  const afterLines = after.split(/\r?\n/);
  const beforeSet = new Set(beforeLines);
  const afterSet = new Set(afterLines);
  const added = afterLines.filter((line) => !beforeSet.has(line)).length;
  const removed = beforeLines.filter((line) => !afterSet.has(line)).length;
  return {
    text: `--- a/${label}\n+++ b/${label}\n@@ file too large for inline diff @@\n- ${removed} lines removed\n+ ${added} lines added`,
    added,
    removed,
  };
}

export function diffLines(before: string, after: string, label: string): DiffResult {
  if (before === after) return { text: "", added: 0, removed: 0 };

  const a = before.split(/\r?\n/);
  const b = after.split(/\r?\n/);

  if (a.length > MAX_DIFF_LINES || b.length > MAX_DIFF_LINES) {
    return fallback(before, after, label);
  }
  if (a.length * b.length > MAX_DP_CELLS) {
    return fallback(before, after, label);
  }

  const n = a.length;
  const m = b.length;
  const width = m + 1;
  const table = new Uint32Array((n + 1) * width);

  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      const cell = i * width + j;
      if (a[i] === b[j]) {
        table[cell] = (table[(i + 1) * width + (j + 1)] ?? 0) + 1;
      } else {
        const down = table[(i + 1) * width + j] ?? 0;
        const right = table[i * width + (j + 1)] ?? 0;
        table[cell] = Math.max(down, right);
      }
    }
  }

  const rows: Row[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      rows.push({ op: "equal", line: a[i] ?? "" });
      i += 1;
      j += 1;
    } else if ((table[(i + 1) * width + j] ?? 0) >= (table[i * width + (j + 1)] ?? 0)) {
      rows.push({ op: "remove", line: a[i] ?? "" });
      i += 1;
    } else {
      rows.push({ op: "add", line: b[j] ?? "" });
      j += 1;
    }
  }
  while (i < n) {
    rows.push({ op: "remove", line: a[i] ?? "" });
    i += 1;
  }
  while (j < m) {
    rows.push({ op: "add", line: b[j] ?? "" });
    j += 1;
  }

  let added = 0;
  let removed = 0;
  for (const row of rows) {
    if (row.op === "add") added += 1;
    if (row.op === "remove") removed += 1;
  }

  const context = 3;
  const lines: string[] = [`--- a/${label}`, `+++ b/${label}`];
  let cursor = 0;
  while (cursor < rows.length) {
    while (cursor < rows.length && rows[cursor]?.op === "equal") cursor += 1;
    if (cursor >= rows.length) break;

    const hunkStart = Math.max(0, cursor - context);
    let hunkEnd = cursor;
    let lastChange = cursor;
    while (hunkEnd < rows.length) {
      if (rows[hunkEnd]?.op !== "equal") lastChange = hunkEnd;
      if (hunkEnd - lastChange > context * 2) break;
      hunkEnd += 1;
    }
    hunkEnd = Math.min(rows.length, lastChange + context + 1);

    const beforeStart = rows.slice(0, hunkStart).filter((row) => row.op !== "add").length;
    const afterStart = rows.slice(0, hunkStart).filter((row) => row.op !== "remove").length;
    const slice = rows.slice(hunkStart, hunkEnd);
    const beforeCount = slice.filter((row) => row.op !== "add").length;
    const afterCount = slice.filter((row) => row.op !== "remove").length;

    lines.push(`@@ -${beforeStart + 1},${beforeCount} +${afterStart + 1},${afterCount} @@`);
    for (const row of slice) {
      if (row.op === "equal") lines.push(` ${row.line}`);
      else if (row.op === "add") lines.push(`+${row.line}`);
      else lines.push(`-${row.line}`);
    }
    cursor = hunkEnd;
  }

  return { text: lines.join("\n"), added, removed };
}
