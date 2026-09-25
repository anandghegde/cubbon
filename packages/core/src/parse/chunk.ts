import type { Heading, ParsedDoc } from './markdown.ts';

export interface Chunk {
  index: number;
  /** Offsets into the document body. */
  start: number;
  end: number;
  text: string;
  /** Enclosing headings that are not part of the chunk text itself. */
  headingPath: string[];
}

interface Piece {
  start: number;
  end: number;
}

/**
 * Splits a document body into chunks of at most `maxChars`, preferring heading boundaries,
 * then paragraph boundaries. Adjacent small sections are packed together to reduce model calls.
 */
export function chunkDocument(doc: ParsedDoc, maxChars = 24_000): Chunk[] {
  const body = doc.body;
  if (body.trim().length === 0) return [];
  const pieces = splitRange(body, doc.headings, 0, body.length, maxChars);
  const packed = pack(pieces, maxChars);
  return packed.map((p, index) => ({
    index,
    start: p.start,
    end: p.end,
    text: body.slice(p.start, p.end),
    headingPath: enclosingHeadings(doc.headings, p.start),
  }));
}

function splitRange(
  body: string,
  headings: Heading[],
  start: number,
  end: number,
  maxChars: number,
): Piece[] {
  if (end - start <= maxChars) return [{ start, end }];
  const inner = headings.filter((h) => h.start >= start && h.start < end);
  const depth = splitDepth(inner);
  if (depth !== null) {
    const bounds = inner.filter((h) => h.depth <= depth).map((h) => h.start);
    const cuts = [start, ...bounds.filter((b) => b > start), end];
    const out: Piece[] = [];
    for (let i = 0; i < cuts.length - 1; i++) {
      const s = cuts[i] as number;
      const e = cuts[i + 1] as number;
      if (e <= s) continue;
      const deeper = headings.filter((h) => h.start > s && h.start < e && h.depth > depth);
      out.push(...splitRange(body, deeper, s, e, maxChars));
    }
    return out;
  }
  return splitByParagraphs(body, start, end, maxChars);
}

/** The shallowest heading depth that yields at least two sections. */
function splitDepth(headings: Heading[]): number | null {
  const depths = [...new Set(headings.map((h) => h.depth))].sort((a, b) => a - b);
  let count = 0;
  for (const d of depths) {
    count += headings.filter((h) => h.depth === d).length;
    if (count >= 2) return d;
  }
  return null;
}

function splitByParagraphs(body: string, start: number, end: number, maxChars: number): Piece[] {
  const out: Piece[] = [];
  const re = /\n[ \t]*\n/g;
  re.lastIndex = start;
  let pieceStart = start;
  let lastBoundary = -1;
  let m: RegExpExecArray | null = re.exec(body);
  while (m && m.index < end) {
    const boundary = m.index + m[0].length;
    if (boundary - pieceStart > maxChars) {
      if (lastBoundary > pieceStart) {
        out.push({ start: pieceStart, end: lastBoundary });
        pieceStart = lastBoundary;
      } else {
        // A single paragraph larger than the limit: hard split at line ends.
        out.push(...hardSplit(body, pieceStart, boundary, maxChars));
        pieceStart = boundary;
      }
    }
    lastBoundary = boundary;
    m = re.exec(body);
  }
  if (end - pieceStart > maxChars) {
    if (lastBoundary > pieceStart) {
      out.push({ start: pieceStart, end: lastBoundary });
      out.push(...hardSplit(body, lastBoundary, end, maxChars));
    } else {
      out.push(...hardSplit(body, pieceStart, end, maxChars));
    }
  } else if (end > pieceStart) {
    out.push({ start: pieceStart, end });
  }
  return out;
}

function hardSplit(body: string, start: number, end: number, maxChars: number): Piece[] {
  const out: Piece[] = [];
  let s = start;
  while (end - s > maxChars) {
    const nl = body.lastIndexOf('\n', s + maxChars);
    const cut = nl > s ? nl + 1 : s + maxChars;
    out.push({ start: s, end: cut });
    s = cut;
  }
  if (end > s) out.push({ start: s, end });
  return out;
}

function pack(pieces: Piece[], maxChars: number): Piece[] {
  const out: Piece[] = [];
  for (const p of pieces) {
    const last = out[out.length - 1];
    if (last && last.end === p.start && p.end - last.start <= maxChars) {
      last.end = p.end;
    } else {
      out.push({ ...p });
    }
  }
  return out;
}

/** Headings whose scope contains `offset`, excluding a heading that starts exactly at `offset`. */
export function enclosingHeadings(headings: Heading[], offset: number): string[] {
  const stack: Heading[] = [];
  for (const h of headings) {
    if (h.start > offset) break;
    while (stack.length && (stack[stack.length - 1] as Heading).depth >= h.depth) stack.pop();
    // A heading that starts exactly at the offset belongs to the chunk itself: it closes its
    // siblings but is not part of the path.
    if (h.start === offset) break;
    stack.push(h);
  }
  return stack.map((h) => h.text);
}
