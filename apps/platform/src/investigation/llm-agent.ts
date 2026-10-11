import Anthropic from '@anthropic-ai/sdk';
import type { Logger } from '@ai-analyzer/shared';
import { z } from 'zod';
import { findingsJsonSchema, findingsSchema, type Findings } from './findings';
import { SYSTEM_PROMPT } from './prompt';
import { EvidenceLedger, TOOL_DEFINITIONS } from './tools';

export const LLM_MODEL = process.env.LLM_MODEL || 'claude-opus-5-5';
const EFFORT = (process.env.LLM_EFFORT || 'medium') as 'low' | 'medium' | 'high' | 'xhigh' | 'max';
const MAX_TURNS = 14;
const REQUEST_TIMEOUT_MS = 90_000;

/** USD per million tokens. Claude Opus 5.5: $4 in, $20 out, $0.20 cache read, cache write 1.25x input. */
const PRICING: Record<string, { input: number; output: number; cacheRead: number; cacheWrite: number }> = {
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  'claude-haiku-4-5': { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
};

const SUBMIT_TOOL = {
  name: 'submit_findings',
  description: 'Submit the final investigation result. Call exactly once, when the investigation is complete.',
  strict: true,
  input_schema: findingsJsonSchema as unknown as Anthropic.Beta.BetaTool.InputSchema,
} satisfies Anthropic.Beta.BetaTool;

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number;
}

export interface AgentResult {
  findings: Findings;
  usage: Usage;
  turns: number;
}

/** Thrown when the agent stops without usable findings; the caller falls back to the playbook. */
export class AgentError extends Error {
  constructor(
    message: string,
    readonly usage: Usage,
  ) {
    super(message);
    this.name = 'AgentError';
  }
}

export type CreateMessage = (params: Anthropic.Beta.MessageCreateParamsNonStreaming) => Promise<Anthropic.Beta.BetaMessage>;

export function hasLlmCredentials(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

let client: Anthropic | null = null;
function getClient(): Anthropic {
  // SDK retries 429/5xx/connection errors twice with backoff; the timeout is per attempt.
  client ??= new Anthropic({ timeout: REQUEST_TIMEOUT_MS, maxRetries: 2 });
  return client;
}

function cost(model: string, u: Omit<Usage, 'costUsd'>): number {
  const p = PRICING[model] ?? PRICING['claude-opus-5-5']!;
  return (
    (u.inputTokens * p.input + u.outputTokens * p.output + u.cacheReadTokens * p.cacheRead + u.cacheWriteTokens * p.cacheWrite) /
    1_000_000
  );
}

/**
 * Tool-calling investigation. A manual loop (not the SDK tool runner) because every tool call
 * must go through the evidence ledger, and the loop enforces a turn limit and a deadline.
 */
export async function runLlmInvestigation(
  incidentContext: string,
  ledger: Pick<EvidenceLedger, 'call'>,
  logger: Logger,
  deadline: number,
  // Injected in tests with a scripted fake; production uses the SDK client.
  createMessage: CreateMessage = (params) => getClient().beta.messages.create(params),
): Promise<AgentResult> {
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: 'user', content: incidentContext }];
  const usage: Usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0 };
  let nudged = false;
  let invalidSubmissions = 0;

  for (let turn = 1; turn <= MAX_TURNS; turn++) {
    if (Date.now() > deadline) throw new AgentError('investigation deadline reached', usage);

    const response = await createMessage({
      model: LLM_MODEL,
      max_tokens: 16_000,
      system: SYSTEM_PROMPT,
      tools: [...TOOL_DEFINITIONS, SUBMIT_TOOL],
      messages,
      output_config: { effort: EFFORT },
      // Caches the stable prefix (tools + system + earlier turns) across loop iterations.
      cache_control: { type: 'ephemeral' },
      // If a safety classifier declines, the API re-runs the request on a fallback model.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
    });

    usage.inputTokens += response.usage.input_tokens;
    usage.outputTokens += response.usage.output_tokens;
    usage.cacheReadTokens += response.usage.cache_read_input_tokens ?? 0;
    usage.cacheWriteTokens += response.usage.cache_creation_input_tokens ?? 0;
    usage.costUsd = cost(LLM_MODEL, usage);

    if (response.stop_reason === 'refusal') throw new AgentError('model declined the request', usage);
    if (response.stop_reason === 'max_tokens') throw new AgentError('response hit max_tokens', usage);
    if (response.stop_reason === 'pause_turn') {
      messages.push({ role: 'assistant', content: response.content });
      continue;
    }

    const toolUses = response.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use');
    if (toolUses.length === 0) {
      // Finished without submitting: ask once, then give up.
      if (nudged) throw new AgentError('model stopped without calling submit_findings', usage);
      nudged = true;
      messages.push({ role: 'assistant', content: response.content });
      messages.push({ role: 'user', content: 'Call submit_findings now with your result.' });
      continue;
    }

    messages.push({ role: 'assistant', content: response.content });
    const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];

    // Data tools run in parallel; submit_findings is handled after them.
    const dataCalls = toolUses.filter((t) => t.name !== 'submit_findings');
    const outputs = await Promise.all(dataCalls.map((t) => ledger.call(t.name, t.input)));
    dataCalls.forEach((t, i) => {
      const out = outputs[i]!;
      results.push({ type: 'tool_result', tool_use_id: t.id, content: out.content, ...(out.ok ? {} : { is_error: true }) });
    });

    const submit = toolUses.find((t) => t.name === 'submit_findings');
    if (submit) {
      const parsed = findingsSchema.safeParse(submit.input);
      if (parsed.success) {
        logger.info(`investigator submitted findings after ${turn} turns`, {
          'llm.turns': turn,
          'llm.cost_usd': Math.round(usage.costUsd * 10_000) / 10_000,
        });
        return { findings: parsed.data, usage, turns: turn };
      }
      if (++invalidSubmissions > 2) throw new AgentError('submit_findings input invalid three times', usage);
      results.push({
        type: 'tool_result',
        tool_use_id: submit.id,
        is_error: true,
        content: `submit_findings input is invalid, fix and call it again:\n${z.prettifyError(parsed.error)}`,
      });
    }
    messages.push({ role: 'user', content: results });
  }
  throw new AgentError(`no findings after ${MAX_TURNS} turns`, usage);
}
