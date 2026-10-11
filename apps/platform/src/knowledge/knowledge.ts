import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Logger } from '@ai-analyzer/shared';
import { db } from '../clients/db';
import { embed, toVectorLiteral } from './embedder';

/**
 * Runbooks and past incidents, stored with embeddings in Postgres (pgvector) and searched by
 * cosine distance through the HNSW indexes. No separate vector database.
 */

const RUNBOOK_DIR = process.env.RUNBOOK_DIR || path.resolve(__dirname, '../../../../docs/runbooks');

export interface RunbookHit {
  slug: string;
  title: string;
  excerpt: string;
  body: string;
  similarity: number;
}

export interface IncidentHit {
  number: number;
  text: string;
  category: string | null;
  service: string | null;
  similarity: number;
}

/** Loads docs/runbooks/*.md into the Runbook table (upsert by file name). Safe to run at every start. */
export async function syncRunbooks(logger: Logger): Promise<number> {
  let files: string[];
  try {
    files = (await readdir(RUNBOOK_DIR)).filter((f) => f.endsWith('.md'));
  } catch {
    logger.warn(`runbook directory not found: ${RUNBOOK_DIR}`);
    return 0;
  }
  for (const file of files) {
    const body = await readFile(path.join(RUNBOOK_DIR, file), 'utf8');
    const slug = file.replace(/\.md$/, '');
    const title = /^#\s+(.+)$/m.exec(body)?.[1]?.trim() ?? slug;
    const vector = toVectorLiteral(embed(`${title}\n${title}\n${body}`));
    await db.$executeRaw`
      INSERT INTO "Runbook" ("id", "slug", "title", "body", "embedding", "updatedAt")
      VALUES (gen_random_uuid()::text, ${slug}, ${title}, ${body}, ${vector}::vector, now())
      ON CONFLICT ("slug") DO UPDATE
        SET "title" = EXCLUDED."title", "body" = EXCLUDED."body", "embedding" = EXCLUDED."embedding", "updatedAt" = now()`;
  }
  logger.info(`synced ${files.length} runbooks`);
  return files.length;
}

export async function searchRunbooks(query: string, limit = 3): Promise<RunbookHit[]> {
  const vector = toVectorLiteral(embed(query));
  const rows = await db.$queryRaw<{ slug: string; title: string; body: string; similarity: number }[]>`
    SELECT "slug", "title", "body", 1 - ("embedding" <=> ${vector}::vector) AS similarity
    FROM "Runbook" WHERE "embedding" IS NOT NULL
    ORDER BY "embedding" <=> ${vector}::vector LIMIT ${limit}`;
  return rows.map((r) => ({
    slug: r.slug,
    title: r.title,
    body: r.body,
    excerpt: r.body.split('\n').filter((l) => l.trim() && !l.startsWith('#')).slice(0, 3).join(' ').slice(0, 300),
    similarity: Math.round(Number(r.similarity) * 1000) / 1000,
  }));
}

/** Stores what an investigation concluded, so later incidents can find it. */
export async function rememberIncident(input: {
  incidentId: string;
  number: number;
  text: string;
  category: string | null;
  service: string | null;
}): Promise<void> {
  const vector = toVectorLiteral(embed(input.text));
  await db.$executeRaw`
    INSERT INTO "IncidentMemory" ("incidentId", "number", "text", "category", "service", "embedding", "createdAt")
    VALUES (${input.incidentId}, ${input.number}, ${input.text}, ${input.category}, ${input.service}, ${vector}::vector, now())
    ON CONFLICT ("incidentId") DO UPDATE
      SET "text" = EXCLUDED."text", "category" = EXCLUDED."category", "service" = EXCLUDED."service", "embedding" = EXCLUDED."embedding"`;
}

export async function findSimilarIncidents(query: string, excludeIncidentId: string | null, limit = 3): Promise<IncidentHit[]> {
  const vector = toVectorLiteral(embed(query));
  const rows = await db.$queryRaw<{ number: number; text: string; category: string | null; service: string | null; similarity: number }[]>`
    SELECT "number", "text", "category", "service", 1 - ("embedding" <=> ${vector}::vector) AS similarity
    FROM "IncidentMemory"
    WHERE "embedding" IS NOT NULL AND "incidentId" <> ${excludeIncidentId ?? ''}
    ORDER BY "embedding" <=> ${vector}::vector LIMIT ${limit}`;
  return rows.map((r) => ({ ...r, similarity: Math.round(Number(r.similarity) * 1000) / 1000 }));
}
