'use client';

// A Verse AI conversation (decision 0021): questions and answers in order, sources and drafts,
// and action cards that change nothing until the person taps Confirm. Used by the AI home and
// by the panel on every page; follow-ups carry the conversation id so "approve it" makes sense.
import type { ActionCard, ConversationTurn, VerseAnswer } from '@campusverse/platform-verse';
import { Button, cx } from '@campusverse/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowUp, FileText, IndianRupee, Link2, Sparkles } from 'lucide-react';
import Link from 'next/link';
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type FormEvent,
} from 'react';
import { ApiFailure, api } from '../../../lib/api';
import { en } from '../../../messages/en';
import { useInstitution } from '../attendance/shared';

const t = en.verse;
const day = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const asOf = (iso: string) => day.format(new Date(`${iso}T00:00:00Z`));
const clock = (iso: string) =>
  new Intl.DateTimeFormat('en-IN', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'Asia/Kolkata',
  }).format(new Date(iso));

type Turn = {
  key: string;
  question: string;
  status: 'asking' | 'answered' | 'failed';
  answer?: Pick<VerseAnswer, 'answer' | 'sources' | 'drafts' | 'outcome'>;
  actions: ActionCard[];
  error?: unknown;
};

const failedText = (e: unknown) =>
  typeof navigator !== 'undefined' && !navigator.onLine
    ? t.offline
    : e instanceof ApiFailure && e.status === 403
      ? t.denied
      : t.failed;

/** Model answers use **bold** and "- " lists; show the bold, keep the lines. Nothing else is parsed. */
function Rich({ text }: { text: string }) {
  return (
    <p className="text-body whitespace-pre-line text-ink">
      {text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
        part.startsWith('**') && part.endsWith('**') ? (
          <strong key={i} className="font-semibold">
            {part.slice(2, -2)}
          </strong>
        ) : (
          part
        ),
      )}
    </p>
  );
}

export type VerseChatHandle = { ask: (question: string) => void; reset: () => void };

/** One action Verse AI prepared: what will change, Confirm and Not now, then what happened. */
export function ActionCardView({
  card,
  onChange,
}: {
  card: ActionCard;
  onChange: (c: ActionCard) => void;
}) {
  const qc = useQueryClient();
  const act = useMutation({
    mutationFn: (what: 'confirm' | 'dismiss') =>
      api.post<ActionCard>(`/verse/actions/${card.actionId}/${what}`),
    onSuccess: (c) => {
      onChange(c);
      // Whatever screen is open behind shows the change.
      void qc.invalidateQueries();
    },
  });
  const open = card.state === 'proposed';
  const tone =
    card.state === 'done'
      ? 'border-signal-go bg-signal-go-tint'
      : card.state === 'failed'
        ? 'border-signal-stop bg-signal-stop-tint'
        : 'border-line-strong bg-surface';
  return (
    <section
      aria-label={card.title}
      className={cx('flex flex-col gap-2 rounded-xl border p-4 shadow-[var(--shadow-card)]', tone)}
    >
      <p className="flex items-center gap-2 text-caption font-medium text-ink-muted">
        <Sparkles aria-hidden className="size-3.5" />
        {t.card.label}
        {card.tone === 'money' && (
          <span className="inline-flex items-center gap-1 text-signal-warn-ink">
            <IndianRupee aria-hidden className="size-3.5" />
            {t.card.money}
          </span>
        )}
      </p>
      <h3 className="text-body font-semibold text-ink">{card.title}</h3>
      {card.lines.length > 0 && (
        <ul className="flex flex-col gap-0.5 text-body text-ink">
          {card.lines.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      )}
      {open ? (
        <>
          <p className="text-caption text-ink-muted">{t.card.expires(clock(card.expiresAt))}</p>
          <div className="flex flex-wrap gap-2">
            <Button disabled={act.isPending} onClick={() => act.mutate('confirm')}>
              {act.isPending && act.variables === 'confirm' ? t.card.working : card.confirm}
            </Button>
            <Button
              variant="secondary"
              disabled={act.isPending}
              onClick={() => act.mutate('dismiss')}
            >
              {t.card.notNow}
            </Button>
          </div>
        </>
      ) : (
        <p
          role="status"
          className={cx(
            'text-body font-medium',
            card.state === 'done'
              ? 'text-signal-go-ink'
              : card.state === 'failed'
                ? 'text-signal-stop-ink'
                : 'text-ink-muted',
          )}
        >
          {card.state === 'done'
            ? `${t.card.done}. ${card.outcome ?? ''}`
            : card.state === 'failed'
              ? `${t.card.failed}: ${card.outcome ?? ''}`
              : card.state === 'expired'
                ? t.card.expired
                : t.card.dismissed}
        </p>
      )}
      {act.isError && (
        <p role="alert" className="text-caption text-signal-stop-ink">
          {act.error instanceof ApiFailure
            ? act.error.status === 403
              ? t.errors.forbidden
              : (t.errors[act.error.code] ?? t.errors.error)
            : t.errors.error}
        </p>
      )}
    </section>
  );
}

/** The conversation and its ask box. */
export const VerseChat = forwardRef<
  VerseChatHandle,
  {
    page?: string | undefined;
    /** Show an earlier conversation. */
    conversationId?: string | null;
    initial?: ConversationTurn[];
    compact?: boolean;
    /** A question to ask as soon as it opens (from Ctrl K). */
    startWith?: string | null;
    onNavigate?: () => void;
    onAsked?: (conversationId: string) => void;
  }
>(function VerseChat(
  { page, conversationId, initial, compact, startWith, onNavigate, onAsked },
  ref,
) {
  const { institutionId } = useInstitution();
  const qc = useQueryClient();
  const [cid, setCid] = useState<string>(() => conversationId ?? crypto.randomUUID());
  const [turns, setTurns] = useState<Turn[]>(() =>
    (initial ?? []).map((x) => ({
      key: x.requestId,
      question: x.question,
      status: 'answered',
      answer: { answer: x.answer, sources: [], drafts: [], outcome: 'answered' },
      actions: x.actions,
    })),
  );
  const [text, setText] = useState('');
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'nearest' });
  }, [turns]);

  const ask = (question: string) => {
    const q = question.trim();
    if (q.length < 2 || !institutionId) return;
    const key = crypto.randomUUID();
    setTurns((cur) => [...cur, { key, question: q, status: 'asking', actions: [] }]);
    setText('');
    api
      .post<VerseAnswer>('/verse/ask', {
        institutionId,
        question: q,
        page: page ?? null,
        conversationId: cid,
      })
      .then((data) => {
        setTurns((cur) =>
          cur.map((x) =>
            x.key === key ? { ...x, status: 'answered', answer: data, actions: data.actions } : x,
          ),
        );
        onAsked?.(cid);
        void qc.invalidateQueries({ queryKey: ['verse-conversations'] });
      })
      .catch((error: unknown) =>
        setTurns((cur) => cur.map((x) => (x.key === key ? { ...x, status: 'failed', error } : x))),
      );
  };
  const started = useRef(false);
  useEffect(() => {
    if (!startWith || started.current || !institutionId) return;
    started.current = true;
    ask(startWith);
    // A one-off start: ask reads the latest state when it runs.
  }, [startWith, institutionId]);
  useImperativeHandle(ref, () => ({
    ask,
    reset: () => {
      setTurns([]);
      setCid(crypto.randomUUID());
    },
  }));
  const submit = (e: FormEvent) => {
    e.preventDefault();
    ask(text);
  };

  return (
    <div className="flex flex-col gap-4">
      {turns.length > 0 && (
        <ol aria-live="polite" className="flex flex-col gap-5">
          {turns.map((x) => (
            <li key={x.key} className="flex flex-col gap-3">
              <p className="self-end rounded-2xl rounded-br-sm bg-navy-950 px-4 py-2 text-body text-white">
                <span className="sr-only">{t.you}: </span>
                {x.question}
              </p>
              <div className="flex flex-col gap-3">
                <p className="flex items-center gap-1.5 text-caption font-medium text-ink-muted">
                  <Sparkles aria-hidden className="size-3.5" />
                  {t.ai}
                </p>
                {x.status === 'asking' && <p className="text-body text-ink-muted">{t.asking}</p>}
                {x.status === 'failed' && (
                  <p role="alert" className="text-body text-signal-stop-ink">
                    {failedText(x.error)}
                  </p>
                )}
                {x.answer && (
                  <>
                    <Rich text={x.answer.answer} />
                    {x.actions.map((c) => (
                      <ActionCardView
                        key={c.actionId}
                        card={c}
                        onChange={(next) =>
                          setTurns((cur) =>
                            cur.map((y) =>
                              y.key === x.key
                                ? {
                                    ...y,
                                    actions: y.actions.map((a) =>
                                      a.actionId === next.actionId ? next : a,
                                    ),
                                  }
                                : y,
                            ),
                          )
                        }
                      />
                    ))}
                    {x.answer.drafts.map((d) => (
                      <Link
                        key={d.href}
                        href={d.href}
                        {...(onNavigate ? { onClick: onNavigate } : {})}
                        className="flex w-fit items-center gap-2 rounded-md border border-line bg-surface px-3 py-1.5 text-caption font-medium text-navy-950 hover:border-navy-950"
                      >
                        <FileText aria-hidden className="size-4" />
                        {t.reviewDraft(d.title)}
                      </Link>
                    ))}
                    {x.answer.sources.length > 0 && (
                      <ul
                        aria-label={t.sources}
                        className="flex flex-wrap gap-x-3 gap-y-1 text-caption"
                      >
                        {x.answer.sources.map((s) => (
                          <li key={`${s.href}-${s.label}`}>
                            <Link
                              href={s.href}
                              {...(onNavigate ? { onClick: onNavigate } : {})}
                              className="inline-flex items-center gap-1 text-navy-700 underline underline-offset-2"
                            >
                              <Link2 aria-hidden className="size-3.5" />
                              {t.source(s.label, asOf(s.asOf))}
                            </Link>
                          </li>
                        ))}
                      </ul>
                    )}
                  </>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
      <div ref={end} />
      <form
        onSubmit={submit}
        className={cx(
          'flex items-end gap-2 rounded-2xl border border-line-strong bg-surface p-2 shadow-[var(--shadow-card)] focus-within:border-navy-950',
          compact ? '' : 'p-3',
        )}
      >
        <label className="flex-1">
          <span className="sr-only">{turns.length ? t.followUp : t.placeholder}</span>
          <textarea
            value={text}
            rows={compact ? 1 : 2}
            maxLength={1000}
            placeholder={turns.length ? t.followUp : t.placeholder}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                ask(text);
              }
            }}
            className="block w-full resize-none bg-transparent px-2 py-1.5 text-body text-ink outline-none placeholder:text-ink-faint"
          />
        </label>
        <Button
          type="submit"
          disabled={text.trim().length < 2 || !institutionId}
          aria-label={t.send}
        >
          <ArrowUp aria-hidden className="size-4" />
          {!compact && t.send}
        </Button>
      </form>
      <p className="text-caption text-ink-muted">{t.disclaimer}</p>
    </div>
  );
});
