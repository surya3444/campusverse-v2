// A Verse AI tool: a typed, permissioned wrapper around one module use case. The gateway offers a
// tool only when the person holds its permission, and the use case checks again with can() and RLS.
import type { z } from 'zod';

/** act: prepares a change the person confirms; the change runs only through `execute` (decision 0021). */
export type Risk = 'read' | 'draft' | 'act';
/**
 * What a tool's output may carry to the model. names: people's names, classes and admission or
 * employee numbers (decision 0021). personal and sensitive stay off.
 */
export type DataClass = 'public' | 'operational' | 'names' | 'personal' | 'sensitive';

export type Source = { label: string; href: string; asOf: string };
export type Draft = { kind: 'notice'; title: string; body: string; href: string };

/** Who is asking, where. Handlers receive it from the gateway, never from the model. */
export type ToolContext = {
  actor: { accountId: string; orgId: string; personId: string };
  institutionId: string;
  today: string;
};

/** What an act tool will do, shown to the person on a card with Confirm. */
export type Proposal = {
  title: string;
  lines: string[];
  /** The Confirm button's word: "Approve", "Check out". */
  confirm: string;
  /** money: amounts change hands, the card says so. */
  tone: 'normal' | 'money';
};

export type ToolResult = {
  data: unknown;
  sources?: Source[];
  draft?: Draft;
  proposal?: Proposal;
  /** For act tools: the exact input Confirm runs with (the id the name resolved to). */
  confirmInput?: unknown;
};

/**
 * Finds the one row an act tool means: by its id when the model has it, otherwise by words (a
 * name) that match exactly one row. Anything else returns the rows, so the model can ask or retry.
 */
export function pickOne<R>(
  rows: R[],
  by: { id?: string | undefined; text?: string | undefined },
  idOf: (r: R) => string,
  textOf: (r: R) => string,
): { row: R } | { error: string } {
  if (by.id) {
    const r = rows.find((x) => idOf(x) === by.id);
    if (r) return { row: r };
  }
  const words = (by.text ?? '')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 1);
  if (words.length) {
    const hits = rows.filter((r) => {
      const t = textOf(r).toLowerCase();
      return words.every((w) => t.includes(w));
    });
    if (hits.length === 1 && hits[0] !== undefined) return { row: hits[0] };
    if (hits.length > 1) return { error: 'More than one matches: ask the person which one.' };
  }
  // One waiting and no other words: that's the one (the card shows exactly what it is).
  if (rows.length === 1 && rows[0] !== undefined && !words.length) return { row: rows[0] };
  return {
    error: rows.length ? 'No single match: ask the person which one.' : 'Nothing is waiting.',
  };
}

export type VerseTool<I extends z.ZodType = z.ZodType> = {
  /** module.resource.action, like permissions; the model sees dots as underscores. */
  name: string;
  description: string;
  /** Offered when the person holds any of these; null: anyone signed in (help articles). */
  permission: string[] | null;
  risk: Risk;
  dataClasses: DataClass[];
  input: I;
  /** For act tools: read-only; returns the proposal (and data for the model). */
  handler: (ctx: ToolContext, input: z.infer<I>) => Promise<ToolResult>;
  /** For act tools: makes the change through the module's use case, as the person. */
  execute?: (ctx: ToolContext, input: z.infer<I>) => Promise<{ done: string }>;
};

export const defineTool = <I extends z.ZodType>(tool: VerseTool<I>): VerseTool => tool as VerseTool;

/** The API only accepts [a-zA-Z0-9_-] in tool names. */
export const modelName = (name: string) => name.replaceAll('.', '_');
