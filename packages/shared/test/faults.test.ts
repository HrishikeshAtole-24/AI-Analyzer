import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { FaultError, FaultRegistry } from '../src/faults';

function registry(onEnable = vi.fn(), onDisable = vi.fn()) {
  return new FaultRegistry().define({
    name: 'slow',
    description: 'test fault',
    params: z.object({ delayMs: z.number().int().max(1000).default(100) }),
    onEnable,
    onDisable,
  });
}

describe('FaultRegistry', () => {
  it('is off until enabled, and applies defaults', () => {
    const r = registry();
    expect(r.active('slow')).toBeNull();
    r.enable('slow');
    expect(r.active('slow')).toEqual({ delayMs: 100 });
  });

  it('validates params', () => {
    const r = registry();
    expect(() => r.enable('slow', { delayMs: 5000 })).toThrow(FaultError);
    expect(r.active('slow')).toBeNull();
  });

  it('rejects unknown faults with 404', () => {
    try {
      registry().enable('nope');
      expect.unreachable();
    } catch (err) {
      expect((err as FaultError).status).toBe(404);
    }
  });

  it('runs hooks; onDisable only when it was on', () => {
    const onEnable = vi.fn();
    const onDisable = vi.fn();
    const r = registry(onEnable, onDisable);
    r.disable('slow');
    expect(onDisable).not.toHaveBeenCalled();
    r.enable('slow', { delayMs: 5 });
    expect(onEnable).toHaveBeenCalledWith({ delayMs: 5 });
    r.reset();
    expect(onDisable).toHaveBeenCalledOnce();
    expect(r.list()[0]).toMatchObject({ name: 'slow', enabled: false, params: { delayMs: 100 } });
  });
});
