'use client';

// The Verse AI home (decision 0021): where sign-in lands. One ask box; what needs this person now,
// from the screens they can see, each with "Ask Verse AI"; suggestions for their role; and their
// recent conversations. The normal screens stay for detail.
import type { ConversationTurn } from '@campusverse/platform-verse';
import { Button, Section, SkeletonRows } from '@campusverse/ui';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, MessageSquare, Plus, Sparkles } from 'lucide-react';
import Link from 'next/link';
import { useRef, useState } from 'react';
import { api } from '../../../lib/api';
import { rupees } from '../../../lib/money';
import { en } from '../../../messages/en';
import { useInstitution } from '../attendance/shared';
import { useMe } from '../common/me';
import { VerseChat, type VerseChatHandle } from '../common/verse-chat';

const t = en.verse;
type Need = { key: string; text: string; prompt: string; href: string };

function useFigures(key: string, path: string, enabled: boolean) {
  return useQuery({
    queryKey: ['verse-needs', key, path],
    queryFn: () => api.get<Record<string, number>>(path),
    enabled,
    retry: false,
  });
}

/** What waits for this person, from figures they may already see. */
function useNeeds(): { needs: Need[]; loading: boolean } {
  const { institutionId: id } = useInstitution();
  const { can } = useMe();
  const q = (key: string, path: string, allowed: boolean) => ({ key, path, ok: !!id && allowed });
  const b = q('bills', `/expenses/figures?institutionId=${id}`, can('expenses.bill.approve'));
  const bills = useFigures(b.key, b.path, b.ok);
  const h = q('hostel', `/hostel/figures?institutionId=${id}`, can('hostel.outpass.decide'));
  const hostel = useFigures(h.key, h.path, h.ok);
  const gate = useQuery({
    queryKey: ['verse-needs', 'gate', id],
    queryFn: () => api.get<{ figures: { insideNow: number } }>(`/gate/today?institutionId=${id}`),
    enabled: !!id && can('gate.visitor.read'),
    retry: false,
  });
  const l = q('library', `/library/figures?institutionId=${id}`, can('library.book.manage'));
  const library = useFigures(l.key, l.path, l.ok);
  const leave = useQuery({
    queryKey: ['verse-needs', 'leave', id],
    queryFn: () =>
      api.get<{ requests: { state: string }[] }>(`/staff-leave/requests?institutionId=${id}`),
    enabled: !!id && can('staff.leave.approve'),
    retry: false,
  });
  const needs: Need[] = [];
  if (bills.data?.waiting)
    needs.push({
      key: 'bills',
      text: t.needs.bills(bills.data.waiting, rupees(bills.data.waitingPaise ?? 0)),
      prompt: t.prompts.bills ?? '',
      href: '/expenses',
    });
  if (hostel.data?.requested)
    needs.push({
      key: 'outpasses',
      text: t.needs.outpasses(hostel.data.requested),
      prompt: t.prompts.outpasses ?? '',
      href: '/hostel',
    });
  const waitingLeave = leave.data?.requests.filter((r) => r.state === 'pending').length ?? 0;
  if (waitingLeave)
    needs.push({
      key: 'leave',
      text: t.needs.leave(waitingLeave),
      prompt: t.prompts.leave ?? '',
      href: '/staff-leave',
    });
  if (gate.data?.figures.insideNow)
    needs.push({
      key: 'visitors',
      text: t.needs.visitors(gate.data.figures.insideNow),
      prompt: t.prompts.visitors ?? '',
      href: '/gate',
    });
  if (library.data?.overdue)
    needs.push({
      key: 'overdue',
      text: t.needs.overdue(library.data.overdue),
      prompt: t.prompts.overdue ?? '',
      href: '/library',
    });
  const loading = [bills, hostel, gate, library, leave].some((x) => x.isLoading);
  return { needs, loading };
}

export function AskHome() {
  const { can, data: me } = useMe();
  const chat = useRef<VerseChatHandle>(null);
  const [opened, setOpened] = useState<{ id: string; turns: ConversationTurn[] } | null>(null);
  const [asked, setAsked] = useState(false);
  const { needs, loading } = useNeeds();
  const recent = useQuery({
    queryKey: ['verse-conversations'],
    queryFn: () =>
      api.get<{ conversationId: string; title: string; at: string }[]>('/verse/conversations'),
    retry: false,
  });
  const suggestions = [
    can('school.attendance.read') && 'attendance',
    can('finance.invoice.read') && 'dues',
    can('staff.attendance.read') && 'staff',
    'help',
  ].filter((x): x is string => !!x);
  const ask = (q: string) => {
    setAsked(true);
    chat.current?.ask(q);
  };
  const openConversation = async (id: string) => {
    const turns = await api.get<ConversationTurn[]>(`/verse/conversations/${id}`);
    setOpened({ id, turns });
    setAsked(true);
  };
  const first = me?.name.split(' ')[0] ?? '';

  return (
    <div className="flex flex-col gap-8">
      <section className="hero flex flex-col gap-5 rounded-3xl px-5 py-8 sm:px-10 sm:py-10">
        <p className="flex items-center gap-2 text-caption font-semibold text-navy-950">
          <Sparkles aria-hidden className="size-4" />
          {t.title}
        </p>
        <h1 className="font-display text-display font-semibold tracking-tight text-ink">
          {t.greeting(first)}
        </h1>
        <p className="max-w-2xl text-lead text-ink-muted">{t.lead}</p>
        <div className="max-w-3xl">
          <VerseChat
            key={opened?.id ?? 'new'}
            ref={chat}
            page="/ask"
            conversationId={opened?.id ?? null}
            {...(opened ? { initial: opened.turns } : {})}
            onAsked={() => setAsked(true)}
          />
        </div>
        {!asked && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-caption text-ink-muted">{t.suggestions}</span>
            {suggestions.map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => ask(t.prompts[k] ?? '')}
                className="rounded-full border border-line-strong bg-surface px-3 py-1.5 text-caption text-ink hover:border-navy-950"
              >
                {t.prompts[k]}
              </button>
            ))}
          </div>
        )}
        {asked && (
          <Button
            variant="secondary"
            className="self-start"
            onClick={() => {
              setOpened(null);
              setAsked(false);
              chat.current?.reset();
            }}
          >
            <Plus aria-hidden className="size-4" />
            {t.newChat}
          </Button>
        )}
      </section>

      <div className="grid items-start gap-6 lg:grid-cols-[3fr_2fr]">
        <Section id="verse-needs" title={t.needsYou} flush>
          {loading ? (
            <div className="p-5">
              <SkeletonRows rows={3} label={en.states.loading.title} />
            </div>
          ) : needs.length === 0 ? (
            <p className="px-5 py-4 text-body text-ink-muted">{t.nothingWaiting}</p>
          ) : (
            <ul className="divide-y divide-line">
              {needs.map((n) => (
                <li key={n.key} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3">
                  <span className="min-w-0 flex-1 text-body text-ink tabular-nums">{n.text}</span>
                  <Button size="sm" onClick={() => ask(n.prompt)}>
                    <Sparkles aria-hidden className="size-4" />
                    {t.askAbout}
                    <span className="sr-only">: {n.text}</span>
                  </Button>
                  <Link
                    href={n.href}
                    className="inline-flex items-center gap-1 text-caption font-medium text-navy-950 underline"
                  >
                    {t.open}
                    <span className="sr-only"> {n.text}</span>
                    <ArrowRight aria-hidden className="size-3.5" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Section>
        <Section id="verse-recent" title={t.recent} flush>
          {!recent.data || recent.data.length === 0 ? (
            <p className="px-5 py-4 text-body text-ink-muted">{t.noRecent}</p>
          ) : (
            <ul className="divide-y divide-line">
              {recent.data.map((c) => (
                <li key={c.conversationId}>
                  <button
                    type="button"
                    onClick={() => void openConversation(c.conversationId)}
                    className="flex w-full items-center gap-3 px-5 py-3 text-left hover:bg-paper"
                  >
                    <MessageSquare aria-hidden className="size-4 shrink-0 text-ink-muted" />
                    <span className="min-w-0 flex-1 truncate text-body text-ink">{c.title}</span>
                    <span className="text-caption text-ink-muted">
                      {new Intl.DateTimeFormat('en-IN', {
                        day: 'numeric',
                        month: 'short',
                        timeZone: 'Asia/Kolkata',
                      }).format(new Date(c.at))}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </div>
  );
}
