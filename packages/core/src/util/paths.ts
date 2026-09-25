import os from 'node:os';
import path from 'node:path';

export function expandHome(p: string): string {
  if (p === '~') return os.homedir();
  if (p.startsWith('~/')) return path.join(os.homedir(), p.slice(2));
  return p;
}

export function contractHome(p: string): string {
  const home = os.homedir();
  if (p === home) return '~';
  if (p.startsWith(`${home}${path.sep}`)) return `~${p.slice(home.length)}`;
  return p;
}

export function isInside(parent: string, child: string): boolean {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}
