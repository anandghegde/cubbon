import path from 'node:path';
import type { ExtractedEntity } from '../extract/schema.ts';
import { mergeLedger } from '../merge/merge.ts';
import { sanitizeFileName } from '../merge/normalize.ts';
import { EntityRegistry } from '../merge/registry.ts';
import { ID_PREFIX } from '../model/entities.ts';
import type { Claim } from '../model/types.ts';
import { BASES } from '../render/bases.ts';
import { renderDays } from '../render/days.ts';
import { buildIncoming, type RenderContext, renderEntity } from '../render/entities.ts';
import { renderHub } from '../render/hub.ts';
import { renderSource } from '../render/sources.ts';
import { type PreservedEdit, writeIfChanged, writeNote } from '../render/writer.ts';
import { EntityStore } from '../state/entityStore.ts';
import { shortHash } from '../util/hash.ts';
import { isoDate } from '../util/text.ts';
import { type PipelineContext, VAULT_DIRS } from './context.ts';

export interface RenderSummary {
  entities: number;
  liveClaims: number;
  questions: number;
  created: number;
  updated: number;
  unchanged: number;
  preserved: { path: string; block: string }[];
}

/**
 * Merge the whole ledger into entity records and render the vault: entity notes, source notes,
 * day pages, Bases files and the hub. Only files whose content changed are written (FR4.8).
 */
export async function renderVault(ctx: PipelineContext): Promise<RenderSummary> {
  const entitiesDir = path.join(ctx.vaultPath, VAULT_DIRS.entities);
  const registry = await EntityRegistry.load(entitiesDir);
  const store = new EntityStore(entitiesDir);
  const claims = ctx.db.allClaims();
  const sources = ctx.db.listSources();

  const liveHashes = [
    ...new Set(claims.filter((c) => c.supersededAt === undefined).map((c) => c.sourceHash)),
  ].sort();
  const metaEntities: Record<string, ExtractedEntity[]> = {};
  for (const hash of liveHashes) {
    const meta = await ctx.claims.readMeta(hash);
    if (meta) metaEntities[hash] = meta.entities;
  }

  const merge = mergeLedger({ claims, metaEntities, registry, owner: ctx.owner });

  // Source notes are keyed by path; the registry fixes their filenames like any other entity.
  const sourceByHash = new Map<string, string>();
  const sourceNotes = sources
    .filter((s) => s.triage !== 'ignore')
    .sort((a, b) => a.path.localeCompare(b.path))
    .map((row) => {
      const id = `${ID_PREFIX.source}_${shortHash(row.path, 8)}`;
      const base = sanitizeFileName(path.basename(row.path).replace(/\.(md|markdown)$/i, ''));
      const entry = registry.register(id, 'source', base, base);
      sourceByHash.set(row.hash, entry.fileName);
      return { row, id, fileName: entry.fileName };
    });
  const claimsByHash = new Map<string, Claim[]>();
  for (const c of claims) {
    const list = claimsByHash.get(c.sourceHash) ?? [];
    list.push(c);
    claimsByHash.set(c.sourceHash, list);
  }
  const hashesByPath = new Map<string, Set<string>>();
  for (const c of claims) {
    const set = hashesByPath.get(c.sourcePath) ?? new Set();
    set.add(c.sourceHash);
    hashesByPath.set(c.sourcePath, set);
  }
  for (const [hash, list] of claimsByHash) {
    if (sourceByHash.has(hash)) continue;
    const p = list[0]?.sourcePath;
    const note = p ? sourceNotes.find((s) => s.row.path === p) : undefined;
    if (note) sourceByHash.set(hash, note.fileName);
  }

  const renderCtx: RenderContext = {
    entities: merge.entities,
    incoming: buildIncoming(merge.entities),
    sourceFile: (hash) => sourceByHash.get(hash),
    asOf: merge.asOf,
  };

  const summary: RenderSummary = {
    entities: merge.entities.size,
    liveClaims: merge.stats.live,
    questions: merge.stats.questions,
    created: 0,
    updated: 0,
    unchanged: 0,
    preserved: [],
  };
  const today = isoDate(ctx.now());
  const count = (
    action: 'created' | 'updated' | 'unchanged',
    rel: string,
    preserved: PreservedEdit[] = [],
  ): void => {
    summary[action] += 1;
    for (const p of preserved) summary.preserved.push({ path: rel, block: p.block });
  };

  for (const e of merge.entities.values()) {
    const previous = await store.read(e.type, e.id);
    const note = renderEntity(e, renderCtx);
    const out = await writeNote(ctx.vaultPath, note, previous?.renderHashes, today);
    count(out.action, out.path, out.preserved);
    e.renderHashes = out.renderHashes;
    await store.write(e);
  }

  for (const s of sourceNotes) {
    const hashes = new Set([s.row.hash, ...(hashesByPath.get(s.row.path) ?? [])]);
    const all = [...hashes].flatMap((h) => claimsByHash.get(h) ?? []);
    const note = renderSource({ ...s, claims: all }, renderCtx, merge);
    const previous = await store.read('source', s.id);
    const out = await writeNote(ctx.vaultPath, note, previous?.renderHashes, today);
    count(out.action, out.path, out.preserved);
    await store.write({
      id: s.id,
      type: 'source',
      name: s.row.title ?? s.fileName,
      aliases: [],
      fileName: s.fileName,
      firstSeen: s.row.docDate?.date ?? '',
      lastSeen: s.row.docDate?.date ?? '',
      sources: [s.row.hash],
      statusLog: [],
      dates: {},
      texts: {},
      links: [],
      questions: [],
      retired: false,
      renderHashes: out.renderHashes,
    });
  }

  for (const [rel, content] of renderDays(claims, renderCtx, merge))
    count(await writeIfChanged(ctx.vaultPath, rel, content), rel);
  for (const [rel, content] of Object.entries(BASES))
    count(await writeIfChanged(ctx.vaultPath, rel, content), rel);

  const hub = renderHub(merge, renderCtx, sourceNotes.length);
  const hubOut = await writeNote(ctx.vaultPath, hub, await store.readHashes('index'), today);
  count(hubOut.action, hubOut.path, hubOut.preserved);
  await store.writeHashes('index', hubOut.renderHashes);

  await registry.save();
  return summary;
}
