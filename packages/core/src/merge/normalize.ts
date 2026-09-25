/** Name normalization shared by resolution and ids. Lowercase, no diacritics or punctuation. */
export function normalizeName(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[“”"‘’'`]/g, '')
    .replace(/[^\p{L}\p{N}@./:-]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^(the|project|team) /, '');
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TICKET = /^[A-Z][A-Z0-9]{1,9}-\d{1,6}$/;
const URL = /^https?:\/\/\S+$/i;

export function isEmail(s: string): boolean {
  return EMAIL.test(s.trim());
}

/** External keys resolve before names: an email, a ticket key or a URL identifies one thing. */
export function externalKey(name: string): string | null {
  const t = name.trim();
  if (EMAIL.test(t)) return `email:${t.toLowerCase()}`;
  if (TICKET.test(t.toUpperCase()) && /[A-Z]/.test(t)) return `ticket:${t.toUpperCase()}`;
  if (URL.test(t)) return `url:${t.replace(/\/+$/, '').toLowerCase()}`;
  return null;
}

export type ExternalKind = 'ticket' | 'url' | 'email' | 'document' | 'other';

export function externalKind(name: string): ExternalKind {
  const key = externalKey(name);
  if (key?.startsWith('ticket:')) return 'ticket';
  if (key?.startsWith('url:')) return 'url';
  if (key?.startsWith('email:')) return 'email';
  return /\.(md|docx?|pdf|pptx?|xlsx?)$/i.test(name) || /\bdoc\b/i.test(name)
    ? 'document'
    : 'other';
}

/** Characters Obsidian and common filesystems reject in note names. */
export function sanitizeFileName(name: string): string {
  const cleaned = name
    .replace(/[\\/:*?"<>|#^[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\.+$/, '');
  return cleaned.length ? cleaned.slice(0, 120) : 'untitled';
}
