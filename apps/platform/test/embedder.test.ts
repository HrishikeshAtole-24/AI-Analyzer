import { describe, expect, it } from 'vitest';
import { cosine, embed, EMBEDDING_DIM, tokenize, toVectorLiteral } from '../src/knowledge/embedder';

describe('embedder', () => {
  it('produces normalised vectors of the fixed size', () => {
    const v = embed('timeout acquiring connection from pool');
    expect(v).toHaveLength(EMBEDDING_DIM);
    expect(cosine(v, v)).toBeCloseTo(1, 3);
  });

  it('is deterministic', () => {
    expect(embed('heap usage high')).toEqual(embed('heap usage high'));
  });

  it('ranks text with shared vocabulary closer', () => {
    const query = embed('payment-service failed to record payment: timeout acquiring connection from pool payments-db');
    const pool = embed('Database connection pool exhausted. Symptoms: timeout acquiring connection from pool errors');
    const leak = embed('Memory leak. Symptoms: heap usage high warnings, heap used climbing');
    expect(cosine(query, pool)).toBeGreaterThan(cosine(query, leak));
  });

  it('drops stop words, numbers and folds plurals', () => {
    expect(tokenize('The 3 timeouts of the pools')).toEqual(['timeout', 'pool']);
  });

  it('formats a pgvector literal', () => {
    expect(toVectorLiteral([0.5, -0.25])).toBe('[0.5,-0.25]');
  });
});
