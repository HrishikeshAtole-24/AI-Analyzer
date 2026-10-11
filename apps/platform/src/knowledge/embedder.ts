/**
 * Local text embedder: feature hashing of words and word pairs into a fixed-size vector,
 * log-scaled term frequency, signed buckets, L2-normalised. It needs no model download and no
 * external API, runs in microseconds, and is deterministic.
 *
 * Trade-off: it is lexical, not semantic ("pool exhausted" matches "pool exhaustion" through
 * shared words, but "OOM" does not match "memory leak"). It works here because runbooks, error
 * messages and incident summaries share vocabulary. A neural embedder can replace `embed()`
 * without touching the storage or the search (same dimension, cosine distance).
 */

export const EMBEDDING_DIM = 512;

const STOP = new Set(['the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'is', 'are', 'was', 'with', 'by', 'it', 'at', 'as', 'be', 'from', 'this', 'that', 'not', 'no']);

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9_\s-]/g, ' ')
    .split(/[\s-]+/)
    .filter((t) => t.length > 1 && !STOP.has(t) && !/^\d+$/.test(t))
    .map((t) => (t.length > 4 && t.endsWith('s') ? t.slice(0, -1) : t)); // crude plural folding
}

/** 32-bit FNV-1a. */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function embed(text: string): number[] {
  const tokens = tokenize(text);
  const features = [...tokens, ...tokens.slice(1).map((t, i) => `${tokens[i]}_${t}`)];
  const counts = new Map<string, number>();
  for (const f of features) counts.set(f, (counts.get(f) ?? 0) + 1);

  const v = new Array<number>(EMBEDDING_DIM).fill(0);
  for (const [feature, count] of counts) {
    const h = hash(feature);
    const sign = h & 1 ? 1 : -1; // signed hashing keeps collisions from only adding up
    const weight = (1 + Math.log(count)) * (feature.includes('_') ? 0.7 : 1);
    v[(h >>> 1) % EMBEDDING_DIM]! += sign * weight;
  }
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return v.map((x) => Math.round((x / norm) * 1e6) / 1e6);
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i]! * b[i]!;
  return dot; // inputs are normalised
}

/** pgvector literal: '[0.1,0.2,...]'. */
export function toVectorLiteral(v: number[]): string {
  return `[${v.join(',')}]`;
}
