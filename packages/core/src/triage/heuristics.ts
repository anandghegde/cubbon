import path from 'node:path';
import type { SourceType } from '../model/types.ts';
import { findDates } from '../parse/dates.ts';
import type { ParsedDoc } from '../parse/markdown.ts';
import { expandHome } from '../util/paths.ts';

export type TriageState = 'work' | 'ignore' | 'unsure';

export interface TriageDecision {
  decision: TriageState;
  sourceType: SourceType;
  reason: string;
  confidence: number;
}

export interface TriageInput {
  path: string;
  size: number;
  parsed: ParsedDoc;
}

export interface TriageOptions {
  minBytes: number;
  force: Record<string, 'work' | 'ignore'>;
}

const BOILERPLATE = new Set([
  'readme.md',
  'changelog.md',
  'license.md',
  'contributing.md',
  'code_of_conduct.md',
  'security.md',
  'pull_request_template.md',
]);

const WORK_KEYWORDS = [
  'project',
  'milestone',
  'roadmap',
  'sprint',
  'launch',
  'blocker',
  'blocked',
  'decision',
  'action item',
  'owner',
  'stakeholder',
  'deadline',
  'deliverable',
  'status',
  'at risk',
  'on track',
  'prd',
  'okr',
  'retro',
  'standup',
  'customer',
  'ticket',
  'jira',
  'epic',
  'timeline',
  'dependency',
  'escalat',
  'q1',
  'q2',
  'q3',
  'q4',
];

const MEETING_NAME =
  /(meeting|standup|stand-up|sync|1[:-]?1\b|1on1|one-on-one|retro|weekly|notes)/i;
const TICKET_KEY = /\b[A-Z][A-Z0-9]{1,9}-\d{1,6}\b/;

function matchesForce(p: string, key: string): boolean {
  const expanded = expandHome(key);
  if (expanded.includes('*')) {
    try {
      return new Bun.Glob(expanded).match(p);
    } catch {
      return false;
    }
  }
  return p === expanded || p.startsWith(expanded.endsWith('/') ? expanded : `${expanded}/`);
}

export function detectSourceType(input: TriageInput): SourceType {
  const { parsed } = input;
  const fm = parsed.frontmatter ?? {};
  const keys = new Set(Object.keys(fm).map((k) => k.toLowerCase()));
  const base = path.basename(input.path);
  const title = parsed.title ?? '';

  if (keys.has('from') && (keys.has('subject') || keys.has('to'))) return 'email';
  if (keys.has('attendees') || keys.has('participants')) return 'meeting';
  if (keys.has('channel') || keys.has('room') || keys.has('thread')) return 'chat';
  if (
    keys.has('issue') ||
    keys.has('ticket') ||
    keys.has('jira') ||
    (keys.has('key') && keys.has('status')) ||
    (keys.has('assignee') && keys.has('reporter'))
  ) {
    return 'ticket';
  }

  const lines = parsed.body.split('\n');
  const head = lines.slice(0, 12);
  const headerLines = head.filter((l) => /^(from|to|cc|subject|sent|date):\s/i.test(l)).length;
  if (headerLines >= 2) return 'email';

  const nonEmpty = lines.filter((l) => l.trim().length > 0);
  if (nonEmpty.length >= 8) {
    const chatty = nonEmpty.filter(
      (l) => /^\[?\d{1,2}:\d{2}/.test(l) || /^(\*\*)?[A-Z][\w .'-]{1,30}(\*\*)?:\s\S/.test(l),
    ).length;
    if (chatty / nonEmpty.length >= 0.5) return 'chat';
  }

  if (TICKET_KEY.test(title) || TICKET_KEY.test(base)) return 'ticket';

  const headingText = parsed.headings.map((h) => h.text.toLowerCase());
  if (
    MEETING_NAME.test(base) ||
    MEETING_NAME.test(title) ||
    headingText.some((h) => /^(attendees|agenda|action items|notes)$/.test(h))
  ) {
    return 'meeting';
  }
  return 'document';
}

/** Pass one of triage: cheap rules. Anything left `unsure` may go to the local model later. */
export function triageHeuristic(input: TriageInput, opts: TriageOptions): TriageDecision {
  const sourceType = detectSourceType(input);
  for (const [key, decision] of Object.entries(opts.force)) {
    if (matchesForce(input.path, key)) {
      return { decision, sourceType, reason: `forced by config (${key})`, confidence: 1 };
    }
  }
  const base = path.basename(input.path).toLowerCase();
  if (input.size < opts.minBytes) {
    return {
      decision: 'ignore',
      sourceType,
      reason: `smaller than ${opts.minBytes} bytes`,
      confidence: 0.9,
    };
  }
  if (BOILERPLATE.has(base)) {
    return {
      decision: 'ignore',
      sourceType,
      reason: 'repository boilerplate file',
      confidence: 0.8,
    };
  }
  if (sourceType !== 'document') {
    return {
      decision: 'work',
      sourceType,
      reason: `recognized ${sourceType} export`,
      confidence: 0.85,
    };
  }

  const fm = input.parsed.frontmatter ?? {};
  const fmType = typeof fm.type === 'string' ? fm.type.toLowerCase() : '';
  let score = 0;
  if (/^(prd|roadmap|project|sprint|meeting|decision|status|plan|spec|rfc)/.test(fmType))
    score += 2;

  const sample = [
    input.parsed.title ?? '',
    ...input.parsed.headings.map((h) => h.text),
    input.parsed.body.slice(0, 4000),
  ]
    .join('\n')
    .toLowerCase();
  const hits = WORK_KEYWORDS.filter((k) => sample.includes(k));
  score += Math.min(hits.length, 5);
  const dates = findDates(input.parsed.body.slice(0, 6000)).filter((d) => d.precision === 'day');
  if (dates.length > 0) score += 1;
  const fences = (input.parsed.body.match(/^```/gm) ?? []).length / 2;

  if (fences >= 3 && score < 4) {
    return {
      decision: 'ignore',
      sourceType,
      reason: 'looks like code documentation',
      confidence: 0.7,
    };
  }
  if (score >= 3) {
    return {
      decision: 'work',
      sourceType,
      reason: `work signals: ${hits.slice(0, 4).join(', ')}${dates.length ? ', dated' : ''}`,
      confidence: Math.min(0.95, 0.55 + 0.1 * score),
    };
  }
  if (score === 0) {
    return { decision: 'ignore', sourceType, reason: 'no work signals', confidence: 0.7 };
  }
  return {
    decision: 'unsure',
    sourceType,
    reason: `weak signals: ${hits.join(', ') || 'dates only'}`,
    confidence: 0.5,
  };
}
