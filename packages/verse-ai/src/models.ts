// Models the gateway can talk to: Claude through the Anthropic API, an offline keyword model for
// development without a key, and a scripted model for tests. All speak the Messages API shapes.
import Anthropic from '@anthropic-ai/sdk';

export type ModelTool = Anthropic.Beta.BetaTool;
export type ModelMessage = Anthropic.Beta.BetaMessageParam;
export type ToolReply = Anthropic.Beta.BetaToolResultBlockParam;
export type ToolUse = { id: string; name: string; input: unknown };

export type ModelTurn = {
  /** Appended to the conversation unchanged (thinking blocks included). */
  assistant: ModelMessage;
  text: string;
  toolUses: ToolUse[];
  stop: 'end' | 'tool_use' | 'refusal' | 'max_tokens';
  usage: { input: number; output: number };
};

export type Model = {
  name: string;
  respond(req: {
    system: string;
    tools: ModelTool[];
    messages: ModelMessage[];
  }): Promise<ModelTurn>;
};

export const DEFAULT_MODEL = 'claude-opus-5-5';

/**
 * Claude via the Anthropic API. Low effort (short operational answers), the system prompt and
 * tools cached, and server-side fallbacks so a declined request is retried on a suitable model.
 */
export function claudeModel(opts: { apiKey: string; model?: string | undefined }): Model {
  const client = new Anthropic({ apiKey: opts.apiKey, maxRetries: 2, timeout: 60_000 });
  const model = opts.model ?? DEFAULT_MODEL;
  return {
    name: model,
    async respond({ system, tools, messages }) {
      const r = await client.beta.messages.create({
        model,
        max_tokens: 4096,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        output_config: { effort: 'low' },
        cache_control: { type: 'ephemeral' },
        system,
        tools,
        messages,
      });
      const toolUses: ToolUse[] = [];
      let text = '';
      for (const b of r.content) {
        if (b.type === 'text') text += b.text;
        if (b.type === 'tool_use') toolUses.push({ id: b.id, name: b.name, input: b.input });
      }
      const u = r.usage;
      return {
        assistant: { role: 'assistant', content: r.content },
        text,
        toolUses,
        stop:
          r.stop_reason === 'refusal'
            ? 'refusal'
            : r.stop_reason === 'max_tokens'
              ? 'max_tokens'
              : toolUses.length > 0
                ? 'tool_use'
                : 'end',
        usage: {
          input:
            u.input_tokens +
            (u.cache_read_input_tokens ?? 0) +
            (u.cache_creation_input_tokens ?? 0),
          output: u.output_tokens,
        },
      };
    },
  };
}

const roughTokens = (s: string) => Math.ceil(s.length / 4);

function turnOf(text: string, toolUses: ToolUse[] = []): ModelTurn {
  const content: Anthropic.Beta.BetaContentBlockParam[] = [
    ...(text ? [{ type: 'text' as const, text }] : []),
    ...toolUses.map((t) => ({
      type: 'tool_use' as const,
      id: t.id,
      name: t.name,
      input: t.input as Record<string, unknown>,
    })),
  ];
  return {
    assistant: { role: 'assistant', content },
    text,
    toolUses,
    stop: toolUses.length ? 'tool_use' : 'end',
    usage: { input: 0, output: roughTokens(text) },
  };
}

/** Builders for scripted models in tests. */
export const turn = {
  text: (text: string) => turnOf(text),
  call: (
    name: string,
    input: unknown,
    id = `t_${name}_${Math.random().toString(36).slice(2, 8)}`,
  ) => turnOf('', [{ id, name, input }]),
  refusal: (): ModelTurn => ({ ...turnOf(''), stop: 'refusal' }),
};

/** Plays turns in order; each step may look at the request (for checking what was sent). */
export function scriptedModel(
  steps: ((req: { tools: ModelTool[]; messages: ModelMessage[] }) => ModelTurn)[],
): Model & { requests: { tools: ModelTool[]; messages: ModelMessage[] }[] } {
  const requests: { tools: ModelTool[]; messages: ModelMessage[] }[] = [];
  return {
    name: 'scripted',
    requests,
    async respond(req) {
      requests.push({ tools: req.tools, messages: structuredClone(req.messages) });
      const step = steps[requests.length - 1];
      return step ? step(req) : turn.text('');
    },
  };
}

const KEYWORDS: [RegExp, string][] = [
  [/\b(draft|write|compose)\b/i, 'communications_notice_draft'],
  [/\b(on leave|leave requests?|staff leave)\b/i, 'staff_leave_today'],
  [/\b(homework|diary)\b/i, 'homework_summary'],
  [
    /\bstaff\b.*\b(in|late|attendance|absent|present)\b|\bwho is (in|late)\b/i,
    'staff_attendance_today',
  ],
  [/\b(admissions?|enquir\w*|applications?|seats?)\b/i, 'school_admissions_summary'],
  [
    /\b(documents?|papers?)\b.*\b(check|verify|pending|waiting)\b/i,
    'people_documents_awaiting_check',
  ],
  [
    /\b(no teacher|without (a )?teacher|unassigned|teaching gaps?|class teacher)\b/i,
    'school_subjects_gaps',
  ],
  [/\b(how do i|how to|how can i|steps)\b/i, 'help_search'],
  [/\b(attendance|absent|marked|register)\b/i, 'school_attendance_today'],
  [/\b(due|dues|overdue|outstanding|fees?|arrears)\b/i, 'finance_dues_summary'],
  [/\b(average|averages|pass rate|toppers?|how did .* (do|go))\b/i, 'school_exams_results'],
  [/\b(exam|exams|marks|results?|papers?)\b/i, 'school_exams_progress'],
];

function lastToolOutputs(messages: ModelMessage[]): string[] {
  const content = messages.at(-1)?.content;
  if (!Array.isArray(content)) return [];
  return content.flatMap((b) =>
    b.type === 'tool_result' && typeof b.content === 'string' ? [b.content] : [],
  );
}

function summarise(output: string): string {
  const json = output.replace(/^<tool_output[^>]*>\n?|\n?<\/tool_output>$/g, '');
  try {
    const value: unknown = JSON.parse(json);
    const show = (x: unknown): string =>
      Array.isArray(x)
        ? x.map(show).join(', ')
        : typeof x === 'object'
          ? JSON.stringify(x)
          : String(x);
    const line = (v: unknown): string =>
      v && typeof v === 'object'
        ? Object.entries(v)
            .filter(([, x]) => x !== null && !(Array.isArray(x) && x.length === 0))
            .map(([k, x]) => `${k}: ${show(x)}`)
            .join('; ')
        : String(v);
    return Array.isArray(value) ? value.map((v) => `- ${line(v)}`).join('\n') : line(value);
  } catch {
    return output;
  }
}

/** Two-step phrasings: list first, then prepare the action on the matching row (decision 0021). */
const ACTS: {
  re: RegExp;
  list: string;
  act: string;
  id: string;
  input?: Record<string, unknown>;
}[] = [
  {
    re: /\bcheck(?:ed)?[ -]?out\b/i,
    list: 'gate_inside',
    act: 'gate_visitor_check_out',
    id: 'visitId',
  },
  {
    re: /\b(approve|reject)\b.*\bbill\b|\bbill\b.*\b(approve|reject)\b/i,
    list: 'expenses_bills_waiting',
    act: 'expenses_bill_decide',
    id: 'billId',
  },
  {
    re: /\b(approve|reject)\b.*\boutpass\b|\boutpass\b.*\b(approve|reject)\b/i,
    list: 'hostel_outpasses_waiting',
    act: 'hostel_outpass_decide',
    id: 'outpassId',
  },
  {
    re: /\b(approve|refuse|reject)\b.*\bleave\b|\bleave\b.*\b(approve|refuse|reject)\b/i,
    list: 'staff_leave_waiting',
    act: 'staff_leave_decide',
    id: 'requestId',
  },
];

/** The question this turn: the last plain user message ("Today is …\n\nQuestion: …"). */
function currentQuestion(messages: ModelMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m?.role === 'user' && typeof m.content === 'string' && m.content.startsWith('Today is '))
      return m.content.replace(/^Today is [^\n]*\n\nQuestion: /, '');
  }
  return '';
}

/** The tool the model called last, if the conversation is waiting on its result. */
function lastCall(messages: ModelMessage[]): string | null {
  const a = messages.at(-2);
  if (a?.role !== 'assistant' || !Array.isArray(a.content)) return null;
  const use = a.content.find((b) => b.type === 'tool_use');
  return use && use.type === 'tool_use' ? use.name : null;
}

/** The row of a list whose words best match the question; the only row if there's one. */
function pick(output: string, question: string, id: string): string | null {
  const json = output.replace(/^<tool_output[^>]*>\n?|\n?<\/tool_output>$/g, '');
  let rows: Record<string, unknown>[];
  try {
    const v: unknown = JSON.parse(json);
    rows = Array.isArray(v) ? (v as Record<string, unknown>[]) : [];
  } catch {
    return null;
  }
  if (rows.length === 1) return String(rows[0]?.[id] ?? '') || null;
  const words = question
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2);
  const scored = rows
    .map((r) => ({
      r,
      n: words.filter((w) => JSON.stringify(r).toLowerCase().includes(w)).length,
    }))
    .sort((a, b) => b.n - a.n);
  const best = scored[0];
  if (!best || best.n === 0 || scored[1]?.n === best.n) return null;
  return String(best.r[id] ?? '') || null;
}

/**
 * Development stand-in when no API key is configured: picks one tool by keywords (or, for an
 * action, lists then prepares it on the matching row), then reports what came back. Sends
 * nothing anywhere. English only.
 */
export function localModel(): Model {
  const sorry = 'I can’t see that with your access. Ask your school administrator if you need it.';
  return {
    name: 'local',
    async respond({ tools, messages }) {
      const q = currentQuestion(messages);
      const outputs = lastToolOutputs(messages);
      const called = lastCall(messages);
      const has = (name: string) => tools.some((t) => t.name === name);
      if (outputs.length > 0) {
        const content = messages.at(-1)?.content;
        const failed =
          Array.isArray(content) && content.some((b) => b.type === 'tool_result' && b.is_error);
        if (failed) return turnOf(sorry);
        const act = ACTS.find((a) => a.list === called && a.re.test(q));
        if (act && has(act.act)) {
          const id = pick(outputs[0] ?? '', q, act.id);
          if (!id) return turnOf(`Which one?\n${outputs.map(summarise).join('\n')}`);
          const reject = /\b(reject|refuse)\b/i.test(q);
          const note = /\bbecause\b(.*)$/i.exec(q)?.[1]?.trim() ?? '';
          const input: Record<string, unknown> = { [act.id]: id };
          if (act.act !== 'gate_visitor_check_out')
            Object.assign(input, {
              approve: !reject,
              note: note || (reject ? 'Not approved' : ''),
            });
          return turnOf('', [{ id: `local_${act.act}`, name: act.act, input }]);
        }
        if (outputs.some((o) => o.includes('Prepared for the person to confirm')))
          return turnOf('Here it is. Check the details and tap the button to confirm.');
        return turnOf(`Here is what I found:\n${outputs.map(summarise).join('\n')}`);
      }
      if (/\b(fee )?reminders?\b/i.test(q) && /\bsend\b/i.test(q) && has('finance_reminders_send'))
        return turnOf('', [
          {
            id: 'local_reminders',
            name: 'finance_reminders_send',
            input: { minDaysOverdue: Number(/(\d+)\s*days?/i.exec(q)?.[1] ?? 7) },
          },
        ]);
      const accession = /\breturn\b.*?\b([A-Za-z]{2,}[-/]?\d+)\b/i.exec(q)?.[1];
      if (accession && has('library_loan_return'))
        return turnOf('', [
          { id: 'local_return', name: 'library_loan_return', input: { accessionNo: accession } },
        ]);
      const act = ACTS.find((a) => a.re.test(q));
      if (act) {
        if (!has(act.list) || !has(act.act)) return turnOf(sorry);
        return turnOf('', [{ id: `local_${act.list}`, name: act.list, input: {} }]);
      }
      const wanted =
        (/\b(visitors?|inside|at the gate)\b/i.test(q) && 'gate_inside') ||
        (/\boutpass/i.test(q) && 'hostel_outpasses_waiting') ||
        (/\bbills?\b/i.test(q) && 'expenses_bills_waiting') ||
        (/\b(find|who is)\b\s+([A-Z][a-z]+)/.test(q) && 'people_find') ||
        KEYWORDS.find(([re]) => re.test(q))?.[1] ||
        'help_search';
      if (!has(wanted)) return turnOf(sorry);
      const input: Record<string, unknown> =
        wanted === 'help_search'
          ? { query: q }
          : wanted === 'people_find'
            ? { text: /\b(?:find|who is)\b\s+(.+?)\??$/i.exec(q)?.[1] ?? q }
            : wanted === 'communications_notice_draft'
              ? {
                  title:
                    q
                      .replace(
                        /^.*?(draft|write|compose)\s+(a\s+)?(notice\s+)?(that|about|saying)?\s*/i,
                        '',
                      )
                      .slice(0, 80) || 'Notice',
                  body: q,
                }
              : {};
      return turnOf('', [{ id: `local_${wanted}`, name: wanted, input }]);
    },
  };
}
