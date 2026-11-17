// OpenAI as Verse AI's model (decision 0020: providers switchable). The gateway keeps one
// conversation shape (Anthropic Messages); this adapter translates to and from OpenAI's chat
// completions over plain HTTPS, so no extra SDK is needed. Tools, permissions, budgets and logs
// stay in the gateway and are the same whichever provider answers.
import type { ModelMessage, ModelTurn, Model, ToolUse } from './models.js';

export const DEFAULT_OPENAI_MODEL = 'gpt-4o-mini';
const URL = 'https://api.openai.com/v1/chat/completions';

type ChatMessage =
  | { role: 'system' | 'user'; content: string }
  | {
      role: 'assistant';
      content: string | null;
      tool_calls?: {
        id: string;
        type: 'function';
        function: { name: string; arguments: string };
      }[];
    }
  | { role: 'tool'; tool_call_id: string; content: string };

/** The shared conversation, as OpenAI chat messages. */
export function toChat(system: string, messages: ModelMessage[]): ChatMessage[] {
  const out: ChatMessage[] = system ? [{ role: 'system', content: system }] : [];
  for (const m of messages) {
    if (typeof m.content === 'string') {
      out.push(
        m.role === 'user'
          ? { role: 'user', content: m.content }
          : { role: 'assistant', content: m.content },
      );
      continue;
    }
    if (m.role === 'assistant') {
      let text = '';
      const calls: NonNullable<Extract<ChatMessage, { role: 'assistant' }>['tool_calls']> = [];
      for (const b of m.content) {
        if (b.type === 'text') text += b.text;
        if (b.type === 'tool_use')
          calls.push({
            id: b.id,
            type: 'function',
            function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) },
          });
      }
      out.push({
        role: 'assistant',
        content: text || null,
        ...(calls.length ? { tool_calls: calls } : {}),
      });
      continue;
    }
    // A user turn: tool results become tool messages; text stays a user message.
    let text = '';
    for (const b of m.content ?? []) {
      if (b.type === 'text') text += b.text;
      if (b.type === 'tool_result') {
        const content =
          typeof b.content === 'string'
            ? b.content
            : (b.content ?? []).map((c) => (c.type === 'text' ? c.text : '')).join('');
        out.push({ role: 'tool', tool_call_id: b.tool_use_id, content });
      }
    }
    if (text) out.push({ role: 'user', content: text });
  }
  return out;
}

export function openaiModel(opts: {
  apiKey: string;
  model?: string | undefined;
  /** For tests; defaults to the global fetch. */
  fetch?: typeof fetch;
}): Model {
  const model = opts.model ?? DEFAULT_OPENAI_MODEL;
  const send = opts.fetch ?? fetch;
  return {
    name: model,
    async respond({ system, tools, messages }): Promise<ModelTurn> {
      const res = await send(URL, {
        method: 'POST',
        headers: { authorization: `Bearer ${opts.apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          model,
          max_completion_tokens: 4096,
          messages: toChat(system, messages),
          ...(tools.length
            ? {
                tools: tools.map((t) => ({
                  type: 'function',
                  function: {
                    name: t.name,
                    description: t.description ?? '',
                    parameters: t.input_schema,
                  },
                })),
              }
            : {}),
        }),
        signal: AbortSignal.timeout(60_000),
      });
      if (!res.ok) throw new Error(`OpenAI request failed: ${res.status}`);
      const r = (await res.json()) as {
        choices: {
          finish_reason: string;
          message: {
            content: string | null;
            refusal?: string | null;
            tool_calls?: { id: string; function: { name: string; arguments: string } }[];
          };
        }[];
        usage?: { prompt_tokens: number; completion_tokens: number };
      };
      const choice = r.choices[0];
      const text = choice?.message.content ?? '';
      const toolUses: ToolUse[] = (choice?.message.tool_calls ?? []).map((c) => ({
        id: c.id,
        name: c.function.name,
        input: safeJson(c.function.arguments),
      }));
      return {
        assistant: {
          role: 'assistant',
          content: [
            ...(text ? [{ type: 'text' as const, text }] : []),
            ...toolUses.map((t) => ({
              type: 'tool_use' as const,
              id: t.id,
              name: t.name,
              input: t.input as Record<string, unknown>,
            })),
          ],
        },
        text,
        toolUses,
        stop: choice?.message.refusal
          ? 'refusal'
          : choice?.finish_reason === 'length'
            ? 'max_tokens'
            : toolUses.length > 0
              ? 'tool_use'
              : 'end',
        usage: { input: r.usage?.prompt_tokens ?? 0, output: r.usage?.completion_tokens ?? 0 },
      };
    },
  };
}

/** Malformed arguments become an empty object; the tool's own input check then refuses them. */
function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}
