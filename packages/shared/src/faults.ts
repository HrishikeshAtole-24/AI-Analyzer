import { z } from 'zod';

/**
 * Runtime fault switches. Each service declares the faults it supports with typed parameters,
 * and code paths check `registry.active(name)` to change behaviour.
 *
 * Fault toggles are deliberately NOT written to the shipped log stream: the AI investigator must
 * find the cause from symptoms, not read "fault injected" from the logs. They are printed to
 * stderr only, and the eval harness keeps the ground truth separately.
 */

export interface FaultDefinition<S extends z.ZodObject = z.ZodObject> {
  name: string;
  description: string;
  params: S;
  onEnable?: (params: z.infer<S>) => void;
  onDisable?: () => void;
}

interface FaultState {
  definition: FaultDefinition;
  params: Record<string, unknown> | null;
  enabledAt: string | null;
}

export interface FaultView {
  name: string;
  description: string;
  enabled: boolean;
  enabledAt: string | null;
  params: Record<string, unknown>;
}

export class FaultError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export class FaultRegistry {
  private readonly faults = new Map<string, FaultState>();

  define<S extends z.ZodObject>(definition: FaultDefinition<S>): this {
    this.faults.set(definition.name, {
      definition: definition as unknown as FaultDefinition,
      params: null,
      enabledAt: null,
    });
    return this;
  }

  /** Returns the active parameters, or null when the fault is off. */
  active<T = Record<string, unknown>>(name: string): T | null {
    return (this.faults.get(name)?.params as T | undefined) ?? null;
  }

  enable(name: string, rawParams: unknown = {}): FaultView {
    const state = this.get(name);
    const parsed = state.definition.params.safeParse(rawParams ?? {});
    if (!parsed.success) {
      throw new FaultError(`invalid params for ${name}: ${z.prettifyError(parsed.error)}`, 400);
    }
    state.params = parsed.data as Record<string, unknown>;
    state.enabledAt = new Date().toISOString();
    state.definition.onEnable?.(parsed.data);
    return this.view(state);
  }

  disable(name: string): FaultView {
    const state = this.get(name);
    if (state.params) state.definition.onDisable?.();
    state.params = null;
    state.enabledAt = null;
    return this.view(state);
  }

  reset(): void {
    for (const name of this.faults.keys()) this.disable(name);
  }

  list(): FaultView[] {
    return [...this.faults.values()].map((s) => this.view(s));
  }

  private get(name: string): FaultState {
    const state = this.faults.get(name);
    if (!state) throw new FaultError(`unknown fault "${name}"`, 404);
    return state;
  }

  private view(state: FaultState): FaultView {
    const { definition } = state;
    return {
      name: definition.name,
      description: definition.description,
      enabled: state.params !== null,
      enabledAt: state.enabledAt,
      params: state.params ?? (definition.params.parse({}) as Record<string, unknown>),
    };
  }
}
