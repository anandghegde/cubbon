import { toString as mdastToString } from 'mdast-util-to-string';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import { unified } from 'unified';
import { splitFrontmatter } from './frontmatter.ts';

export interface Heading {
  depth: number;
  text: string;
  /** Offsets into the body. */
  start: number;
  end: number;
}

export interface ParsedDoc {
  text: string;
  frontmatter: Record<string, unknown> | null;
  frontmatterRaw: string | null;
  frontmatterError?: string;
  body: string;
  bodyOffset: number;
  title: string | null;
  headings: Heading[];
}

const processor = unified().use(remarkParse).use(remarkGfm);

export function parseDocument(text: string): ParsedDoc {
  const fm = splitFrontmatter(text);
  const tree = processor.parse(fm.body);
  const headings: Heading[] = [];
  for (const node of tree.children) {
    if (node.type !== 'heading') continue;
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    if (start === undefined || end === undefined) continue;
    headings.push({ depth: node.depth, text: mdastToString(node).trim(), start, end });
  }
  const fmTitle = fm.data?.title;
  const title =
    typeof fmTitle === 'string' && fmTitle.trim()
      ? fmTitle.trim()
      : (headings.find((h) => h.depth === 1)?.text ?? null);
  const doc: ParsedDoc = {
    text,
    frontmatter: fm.data,
    frontmatterRaw: fm.raw,
    body: fm.body,
    bodyOffset: fm.bodyOffset,
    title,
    headings,
  };
  if (fm.error) doc.frontmatterError = fm.error;
  return doc;
}
