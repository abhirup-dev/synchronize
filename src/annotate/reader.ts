// Offset-based JSONL reader. Tolerates a partial trailing line (a session still
// being written): bytes after the last newline are NOT consumed, so the next
// read picks them up once complete. v0 callers reparse whole sessions (offset 0),
// but the offset path is here so incremental tailing is a cheap later add.

export interface RawLine {
  lineNumber: number; // 1-based, across the whole file
  text: string;
}

export interface ReadResult {
  lines: RawLine[];
  endOffset: number; // byte offset up to and including the last complete newline
}

export async function readJsonlLines(path: string, fromOffset = 0): Promise<ReadResult> {
  const buf = new Uint8Array(await Bun.file(path).arrayBuffer());
  if (fromOffset >= buf.length) return { lines: [], endOffset: buf.length };

  // Find the last newline so we never emit a half-written trailing record.
  let lastNl = -1;
  for (let i = buf.length - 1; i >= fromOffset; i--) {
    if (buf[i] === 0x0a) { lastNl = i; break; }
  }
  if (lastNl < 0) return { lines: [], endOffset: fromOffset };

  const complete = buf.subarray(fromOffset, lastNl + 1);
  const text = new TextDecoder().decode(complete);

  // lineNumber is global: count newlines before fromOffset to seed the base.
  let baseLine = 0;
  for (let i = 0; i < fromOffset; i++) if (buf[i] === 0x0a) baseLine++;

  const lines: RawLine[] = [];
  let n = baseLine;
  for (const raw of text.split("\n")) {
    n++;
    if (raw.trim().length === 0) continue;
    lines.push({ lineNumber: n, text: raw });
  }
  return { lines, endOffset: lastNl + 1 };
}
