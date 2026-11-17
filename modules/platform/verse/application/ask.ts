// Ask Verse AI: the switch and budget first, then only the tools this person may use, the
// gateway run outside any transaction, and one append-only log row per question.
import { withTenant, type Db } from '@campusverse/db';
import { command } from '@campusverse/platform-events';
import { placeOf } from '@campusverse/platform-organisation';
import {
  PermissionDenied,
  type Actor,
  type createPermissions,
} from '@campusverse/platform-permissions';
import {
  runGateway,
  selectTools,
  type Draft,
  type GatewayResult,
  type Model,
  type Proposal,
  type Source,
  type VerseTool,
} from '@campusverse/verse-ai';
import { sql } from 'drizzle-orm';

export type VerseDeps = {
  db: Db;
  permissions: ReturnType<typeof createPermissions>;
  /** Null when no model is configured: Verse AI is then off everywhere. */
  model: Model | null;
  tools: readonly VerseTool[];
  /** The customer's verse_ai flag (super admin). */
  switchedOn: (orgId: string) => Promise<boolean>;
  /** This customer's monthly token budget (from their plan). */
  monthlyTokens: (orgId: string) => Promise<number>;
};

export class VerseError extends Error {
  constructor(readonly code: string) {
    super(`Verse AI: ${code}`);
    this.name = 'VerseError';
  }
}

export type ActionCard = Proposal & {
  actionId: string;
  tool: string;
  state: 'proposed' | 'done' | 'failed' | 'dismissed' | 'expired';
  /** What happened, once confirmed. */
  outcome: string | null;
  expiresAt: string;
};

export type VerseAnswer = {
  requestId: string;
  conversationId: string | null;
  outcome: GatewayResult['outcome'] | 'switched_off' | 'over_budget';
  answer: string;
  sources: Source[];
  drafts: Draft[];
  /** Actions prepared for the person to confirm (decision 0021). */
  actions: ActionCard[];
  /** Always true: every message from Verse AI is labelled as AI. */
  ai: true;
};

/** Follow-ups see this many earlier turns. */
const HISTORY = 6;

const SWITCHED_OFF = 'Verse AI is switched off for your school.';
const OVER_BUDGET =
  'Verse AI has used this month’s allowance for your school. It resets on the 1st.';

export async function askVerse(
  deps: VerseDeps,
  actor: Actor,
  input: {
    institutionId: string;
    question: string;
    page?: string | null | undefined;
    conversationId?: string | null | undefined;
  },
): Promise<VerseAnswer> {
  const question = input.question.trim();
  if (question.length < 2 || question.length > 1000) throw new VerseError('bad_question');

  // Who may ask, what they may use, and what is left this month: one read transaction.
  const pre = await withTenant(deps.db, actor.orgId, async (tx) => {
    const place = await placeOf(tx, input.institutionId);
    if (!place) throw new VerseError('institution_not_found');
    const resource = { orgId: actor.orgId, place };
    await deps.permissions.assertCan(tx, actor, 'platform.verse.ask', resource);
    const tools = await selectTools(
      deps.tools,
      async (p) => (await deps.permissions.can(tx, actor, p, resource)).allowed,
    );
    const [r] = await tx.execute<{ used: number; today: string }>(sql`
      select coalesce(sum(input_tokens + output_tokens), 0)::int as used, app_today()::text as today
      from verse_request where org_id = app_current_org()
        and created_at >= date_trunc('month', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata'`);
    // Follow-ups see this person's last few turns of the same conversation, nothing else.
    const history = input.conversationId
      ? [
          ...(await tx.execute<{ question: string; answer: string }>(sql`
            select question, coalesce(answer, '') as answer from (
              select question, answer, created_at from verse_request
              where org_id = app_current_org() and person_id = ${actor.personId}
                and conversation_id = ${input.conversationId}
              order by created_at desc limit ${HISTORY}) h
            order by created_at`)),
        ]
      : [];
    return { tools, resource, used: r?.used ?? 0, today: r?.today ?? '', history };
  });

  let run: GatewayResult | null = null;
  let outcome: VerseAnswer['outcome'];
  let answer: string;
  let failure: unknown = null;
  if (!deps.model || !(await deps.switchedOn(actor.orgId))) {
    outcome = 'switched_off';
    answer = SWITCHED_OFF;
  } else if (pre.used >= (await deps.monthlyTokens(actor.orgId))) {
    outcome = 'over_budget';
    answer = OVER_BUDGET;
  } else {
    try {
      run = await runGateway({
        model: deps.model,
        tools: pre.tools,
        ctx: { actor, institutionId: input.institutionId, today: pre.today },
        question,
        history: pre.history,
      });
      outcome = run.outcome;
      answer = run.answer;
    } catch (e) {
      failure = e;
      outcome = 'incomplete';
      answer = 'Verse AI couldn’t answer just now. Try again in a minute.';
    }
  }

  const dataClasses = [...new Set(run?.calls.flatMap((c) => c.dataClasses) ?? [])];
  const { requestId, actions } = await command(
    deps.db,
    deps.permissions,
    actor,
    { permission: 'platform.verse.ask', resource: pre.resource },
    async (tx) => {
      const [row] = await tx.execute<{ id: string }>(sql`
        insert into verse_request (org_id, person_id, institution_id, page, question, model, tools,
          data_classes, answer, outcome, input_tokens, output_tokens, conversation_id)
        values (app_current_org(), ${actor.personId}, ${input.institutionId}, ${input.page ?? null},
          ${question}, ${deps.model?.name ?? 'none'}, ${JSON.stringify(run?.calls ?? [])}::jsonb,
          ${`{${dataClasses.join(',')}}`}::text[], ${answer}, ${failure ? 'error' : outcome},
          ${run?.usage.input ?? 0}, ${run?.usage.output ?? 0}, ${input.conversationId ?? null})
        returning id::text`);
      const id = row?.id ?? '';
      const cards: ActionCard[] = [];
      for (const p of run?.proposals ?? []) {
        const [a] = await tx.execute<{ id: string; expiresAt: string }>(sql`
          insert into verse_action (org_id, request_id, person_id, institution_id, tool, input, preview)
          values (app_current_org(), ${id}, ${actor.personId}, ${input.institutionId}, ${p.tool},
            ${JSON.stringify(p.input)}::jsonb, ${JSON.stringify(p.preview)}::jsonb)
          returning id::text, expires_at as "expiresAt"`);
        cards.push({
          ...p.preview,
          actionId: a?.id ?? '',
          tool: p.tool,
          state: 'proposed',
          outcome: null,
          expiresAt: a ? new Date(a.expiresAt).toISOString() : '',
        });
      }
      return {
        result: { requestId: id, actions: cards },
        // Ids and codes only; the question itself stays in verse_request.
        audit: {
          action: 'platform.verse.ask',
          entityType: 'verse_request',
          entityId: id,
          dataClass: 'personal',
          detail: {
            outcome: failure ? 'error' : outcome,
            tools: run?.calls.length ?? 0,
            proposals: cards.length,
          },
        },
      };
    },
  );
  if (failure) console.error('verse: model call failed', (failure as Error).message);
  return {
    requestId,
    conversationId: input.conversationId ?? null,
    outcome,
    answer,
    sources: run?.sources ?? [],
    drafts: run?.drafts ?? [],
    actions,
    ai: true,
  };
}

/** Tokens used this month, for the school's settings and the super admin. */
export async function verseUsage(
  db: Db,
  orgId: string,
): Promise<{ tokens: number; questions: number }> {
  return withTenant(db, orgId, async (tx) => {
    const [r] = await tx.execute<{ tokens: number; questions: number }>(sql`
      select coalesce(sum(input_tokens + output_tokens), 0)::int as tokens, count(*)::int as questions
      from verse_request where org_id = app_current_org()
        and created_at >= date_trunc('month', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata'`);
    return { tokens: r?.tokens ?? 0, questions: r?.questions ?? 0 };
  });
}

// ---------------------------------------------------------------------------------------------
// Actions: confirmed by the person they were prepared for, once, within 15 minutes (decision 0021)
// ---------------------------------------------------------------------------------------------

type ActionRow = {
  id: string;
  tool: string;
  input: unknown;
  preview: Proposal;
  state: 'proposed' | 'done' | 'failed' | 'dismissed';
  outcome: string | null;
  expiresAt: string;
  expired: boolean;
  institutionId: string;
  personId: string;
};

const card = (r: ActionRow): ActionCard => ({
  ...r.preview,
  actionId: r.id,
  tool: r.tool,
  state: r.state === 'proposed' && r.expired ? 'expired' : r.state,
  outcome: r.outcome,
  expiresAt: new Date(r.expiresAt).toISOString(),
});

const actionSelect = sql`
  select id::text, tool, input, preview, state, outcome, expires_at as "expiresAt",
    expires_at < now() as expired, institution_id::text as "institutionId", person_id::text as "personId"
  from verse_action where org_id = app_current_org()`;

/** Words for a module's refusal, from its error code: "bed_taken" → "Bed taken". */
const words = (code: string) => {
  const w = code.replaceAll('_', ' ');
  return w.charAt(0).toUpperCase() + w.slice(1);
};

/**
 * Runs a prepared action: the person's own, still fresh, not used. The tool's permission is
 * checked again, then its execute calls the module's use case as this person (its own can(), RLS,
 * audit and outbox). The proposal is claimed first, so two taps can't run it twice.
 */
export async function confirmAction(
  deps: VerseDeps,
  actor: Actor,
  actionId: string,
): Promise<ActionCard> {
  const found = await withTenant(deps.db, actor.orgId, async (tx) => {
    const [r] = await tx.execute<ActionRow>(sql`${actionSelect} and id = ${actionId}`);
    if (!r || r.personId !== actor.personId) throw new VerseError('action_not_found');
    const place = await placeOf(tx, r.institutionId);
    if (!place) throw new VerseError('institution_not_found');
    const resource = { orgId: actor.orgId, place };
    const tool = deps.tools.find((t) => t.name === r.tool && t.risk === 'act' && t.execute);
    if (!tool) throw new VerseError('action_not_found');
    let allowed = tool.permission === null;
    for (const p of tool.permission ?? [])
      if ((await deps.permissions.can(tx, actor, p, resource)).allowed) allowed = true;
    if (!allowed) throw new PermissionDenied(tool.permission?.[0] ?? '', 'no_grant');
    const [d] = await tx.execute<{ today: string }>(sql`select app_today()::text as today`);
    return { r, tool, resource, today: d?.today ?? '' };
  });
  if (found.r.state !== 'proposed') return card(found.r);
  if (found.r.expired) throw new VerseError('action_expired');

  const claimed = await command(
    deps.db,
    deps.permissions,
    actor,
    { permission: 'platform.verse.ask', resource: found.resource },
    async (tx) => {
      const done = await tx.execute(sql`
        update verse_action set state = 'done', decided_at = now()
        where org_id = app_current_org() and id = ${actionId} and state = 'proposed' and expires_at >= now()
        returning id`);
      return {
        result: done.length > 0,
        audit: {
          action: 'platform.verse.act',
          entityType: 'verse_action',
          entityId: actionId,
          dataClass: 'personal',
          detail: { tool: found.r.tool },
        },
      };
    },
  );
  if (!claimed) throw new VerseError('action_expired');

  let state: 'done' | 'failed' = 'done';
  let outcome: string;
  const input = found.tool.input.safeParse(found.r.input);
  try {
    if (!input.success || !found.tool.execute) throw new VerseError('action_not_found');
    outcome = (
      await found.tool.execute(
        { actor, institutionId: found.r.institutionId, today: found.today },
        input.data,
      )
    ).done;
  } catch (e) {
    state = 'failed';
    const code =
      e instanceof PermissionDenied
        ? 'not_allowed'
        : typeof (e as { code?: unknown }).code === 'string'
          ? (e as { code: string }).code
          : 'failed';
    outcome = words(code);
    if (code === 'failed') console.error('verse: action failed', (e as Error).message);
  }
  const final = await withTenant(deps.db, actor.orgId, async (tx) => {
    await tx.execute(sql`
      update verse_action set state = ${state}, outcome = ${outcome.slice(0, 500)}
      where org_id = app_current_org() and id = ${actionId}`);
    const [r] = await tx.execute<ActionRow>(sql`${actionSelect} and id = ${actionId}`);
    return r;
  });
  if (!final) throw new VerseError('action_not_found');
  return card(final);
}

/** "Not now": the proposal is put aside and can't be confirmed later. */
export async function dismissAction(
  deps: VerseDeps,
  actor: Actor,
  actionId: string,
): Promise<ActionCard> {
  return withTenant(deps.db, actor.orgId, async (tx) => {
    const [r] = await tx.execute<ActionRow>(sql`${actionSelect} and id = ${actionId}`);
    if (!r || r.personId !== actor.personId) throw new VerseError('action_not_found');
    if (r.state === 'proposed')
      await tx.execute(sql`
        update verse_action set state = 'dismissed', decided_at = now()
        where org_id = app_current_org() and id = ${actionId} and state = 'proposed'`);
    const [after] = await tx.execute<ActionRow>(sql`${actionSelect} and id = ${actionId}`);
    return card(after ?? r);
  });
}

export type ConversationTurn = {
  requestId: string;
  question: string;
  answer: string;
  outcome: string;
  at: string;
  actions: ActionCard[];
};

/** One of this person's conversations, oldest first, with its action cards as they stand. */
export async function conversation(
  deps: VerseDeps,
  actor: Actor,
  conversationId: string,
): Promise<ConversationTurn[]> {
  return withTenant(deps.db, actor.orgId, async (tx) => {
    const turns = await tx.execute<Omit<ConversationTurn, 'actions'>>(sql`
      select id::text as "requestId", question, coalesce(answer, '') as answer, outcome, created_at as at
      from verse_request where org_id = app_current_org() and person_id = ${actor.personId}
        and conversation_id = ${conversationId}
      order by created_at limit 50`);
    const ids = turns.map((t) => t.requestId);
    const acts = ids.length
      ? await tx.execute<ActionRow & { requestId: string }>(sql`
          select id::text, tool, input, preview, state, outcome, expires_at as "expiresAt",
            expires_at < now() as expired, institution_id::text as "institutionId",
            person_id::text as "personId", request_id::text as "requestId"
          from verse_action where org_id = app_current_org()
            and request_id = any(${`{${ids.join(',')}}`}::uuid[]) order by created_at`)
      : [];
    return turns.map((t) => ({
      ...t,
      at: new Date(t.at).toISOString(),
      actions: acts.filter((a) => a.requestId === t.requestId).map(card),
    }));
  });
}

/** This person's recent conversations: the first question and when they last asked. */
export async function conversations(
  deps: VerseDeps,
  actor: Actor,
): Promise<{ conversationId: string; title: string; at: string }[]> {
  return withTenant(deps.db, actor.orgId, async (tx) => {
    const rows = await tx.execute<{ conversationId: string; title: string; at: string }>(sql`
      select conversation_id::text as "conversationId",
        (array_agg(question order by created_at))[1] as title, max(created_at) as at
      from verse_request where org_id = app_current_org() and person_id = ${actor.personId}
        and conversation_id is not null
      group by conversation_id order by max(created_at) desc limit 12`);
    return rows.map((r) => ({ ...r, at: new Date(r.at).toISOString() }));
  });
}
