// The Verse Gateway: offers only the tools this person may use, runs the model's tool calls
// through those tools (never anything else), cleans what goes back, and reports what happened.
import { z } from 'zod';
import { asData, scrub } from './clean.js';
import type { Model, ModelMessage, ModelTool, ToolReply } from './models.js';
import { SYSTEM_PROMPT } from './prompt.js';
import {
  modelName,
  type DataClass,
  type Draft,
  type Proposal,
  type Source,
  type ToolContext,
  type VerseTool,
} from './tool.js';

/** Data classes the model may see: names since decision 0021; personal data still waits. */
export const MODEL_SAFE: readonly DataClass[] = ['public', 'operational', 'names'];

/** The tools this person may be offered: permission held, and nothing beyond the safe classes. */
export async function selectTools(
  all: readonly VerseTool[],
  holds: (permission: string) => Promise<boolean>,
): Promise<VerseTool[]> {
  const out: VerseTool[] = [];
  for (const t of all) {
    if (!t.dataClasses.every((c) => MODEL_SAFE.includes(c))) continue;
    if (t.permission === null) out.push(t);
    else
      for (const p of t.permission)
        if (await holds(p)) {
          out.push(t);
          break;
        }
  }
  return out;
}

export type ToolCall = {
  tool: string;
  outcome: 'ok' | 'not_offered' | 'invalid_input' | 'denied' | 'failed';
  dataClasses: DataClass[];
};

export type GatewayResult = {
  answer: string;
  outcome: 'answered' | 'refused' | 'incomplete';
  sources: Source[];
  drafts: Draft[];
  /** Prepared actions waiting for the person's Confirm, in the order the model made them. */
  proposals: { tool: string; input: unknown; preview: Proposal }[];
  calls: ToolCall[];
  usage: { input: number; output: number };
};

/** "Tuesday": models guess weekdays wrong from a bare date. */
const weekday = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'UTC' });

const isDenied = (e: unknown) => e instanceof Error && e.name === 'PermissionDenied';

export async function runGateway(opts: {
  model: Model;
  tools: readonly VerseTool[];
  ctx: ToolContext;
  question: string;
  /** Earlier questions and answers in this conversation, oldest first. */
  history?: { question: string; answer: string }[];
  maxSteps?: number;
}): Promise<GatewayResult> {
  const offered = new Map(opts.tools.map((t) => [modelName(t.name), t]));
  const modelTools: ModelTool[] = opts.tools.map((t) => ({
    name: modelName(t.name),
    description: t.description,
    input_schema: z.toJSONSchema(t.input) as ModelTool['input_schema'],
  }));
  const messages: ModelMessage[] = [
    ...(opts.history ?? []).flatMap((h): ModelMessage[] => [
      { role: 'user', content: h.question },
      { role: 'assistant', content: scrub(h.answer) || '…' },
    ]),
    {
      role: 'user',
      content: `Today is ${weekday(opts.ctx.today)} ${opts.ctx.today}.\n\nQuestion: ${opts.question}`,
    },
  ];
  const result: GatewayResult = {
    answer: '',
    outcome: 'incomplete',
    sources: [],
    drafts: [],
    proposals: [],
    calls: [],
    usage: { input: 0, output: 0 },
  };

  for (let step = 0; step < (opts.maxSteps ?? 4); step++) {
    const t = await opts.model.respond({ system: SYSTEM_PROMPT, tools: modelTools, messages });
    result.usage.input += t.usage.input;
    result.usage.output += t.usage.output;
    if (t.stop === 'refusal') {
      result.outcome = 'refused';
      result.answer = 'I can’t help with that.';
      return result;
    }
    if (t.toolUses.length === 0 || t.stop === 'max_tokens') {
      result.answer = scrub(t.text.trim()) || 'I couldn’t find an answer to that.';
      result.outcome = t.stop === 'max_tokens' ? 'incomplete' : 'answered';
      return result;
    }
    messages.push(t.assistant);
    const replies: ToolReply[] = [];
    for (const use of t.toolUses) {
      const tool = offered.get(use.name);
      const reply = (content: string, error: boolean) =>
        replies.push({ type: 'tool_result', tool_use_id: use.id, content, is_error: error });
      if (!tool) {
        result.calls.push({ tool: use.name, outcome: 'not_offered', dataClasses: [] });
        reply('This tool is not available to this person.', true);
        continue;
      }
      const input = tool.input.safeParse(use.input);
      if (!input.success) {
        result.calls.push({ tool: tool.name, outcome: 'invalid_input', dataClasses: [] });
        reply(`Invalid input: ${input.error.issues[0]?.message ?? 'check the fields'}`, true);
        continue;
      }
      try {
        const out = await tool.handler(opts.ctx, input.data);
        result.sources.push(...(out.sources ?? []));
        if (out.draft) result.drafts.push(out.draft);
        result.calls.push({ tool: tool.name, outcome: 'ok', dataClasses: tool.dataClasses });
        if (tool.risk === 'act' && out.proposal) {
          result.proposals.push({
            tool: tool.name,
            input: out.confirmInput ?? input.data,
            preview: out.proposal,
          });
          reply(
            `${asData(use.name, out.data)}\nPrepared for the person to confirm on screen. Nothing has changed yet: say what will happen when they tap ${out.proposal.confirm}.`,
            false,
          );
        } else reply(asData(use.name, out.data), false);
      } catch (e) {
        const denied = isDenied(e);
        result.calls.push({
          tool: tool.name,
          outcome: denied ? 'denied' : 'failed',
          dataClasses: [],
        });
        reply(
          denied ? 'This person is not allowed to see this.' : 'The tool failed. Try again later.',
          true,
        );
      }
    }
    messages.push({ role: 'user', content: replies });
  }
  result.answer = 'I couldn’t finish that. Try asking more simply.';
  return result;
}
