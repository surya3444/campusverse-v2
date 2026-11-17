'use client';

// Assets and inventory (docs/specs/ASSETS.md): the register with filters and a side panel per
// asset (history, move, custodian, condition, write off); consumable stock with receive and issue;
// places and categories.
import type {
  AssetEvent,
  AssetFigures,
  AssetRow,
  Named,
  StockMove,
  StockRow,
} from '@campusverse/shared-assets';
import {
  Button,
  EmptyState,
  FormModal,
  KeyFigures,
  ModalField,
  PageHeader,
  Pill,
  RecordDrawer,
  Section,
  Segmented,
  SkeletonRows,
  StatePanel,
  cx,
} from '@campusverse/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ClipboardList, Plus, Package, Wrench, ShieldCheck, AlertTriangle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ApiFailure, api } from '../../../lib/api';
import { parseRupees, rupees } from '../../../lib/money';
import { en } from '../../../messages/en';
import { useInstitution } from '../attendance/shared';
import { fieldInline, fieldInput } from '../common/custom-fields';
import { useMe } from '../common/me';
import { ReasonDialog } from '../reason-dialog';
import { useUrlTab } from '../common/url-tab';

const t = en.assets;
type Tab = 'register' | 'stock' | 'disposed' | 'settings';
type Setup = { categories: Named[]; locations: Named[] };
type Staff = { personId: string; name: string; employeeCode: string | null };

const dmy = (d: string) =>
  new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${d.slice(0, 10)}T00:00:00Z`));
const errorText = (e: unknown): string =>
  (e instanceof ApiFailure
    ? e.status === 403
      ? t.errors.forbidden
      : (t.errors[e.code] ?? t.errors.error)
    : t.errors.error) ?? '';
const TONE: Record<string, 'go' | 'warn' | 'stop'> = {
  good: 'go',
  needs_repair: 'warn',
  broken: 'stop',
};

function QueryState({ q }: { q: { isPending: boolean; error: unknown } }) {
  if (q.isPending) return <SkeletonRows rows={5} label={en.states.loading.title} />;
  if (q.error instanceof ApiFailure && q.error.status === 403)
    return <StatePanel kind="denied" title={en.states.denied.title} body={en.states.denied.body} />;
  if (typeof navigator !== 'undefined' && !navigator.onLine)
    return (
      <StatePanel kind="offline" title={en.states.offline.title} body={en.states.offline.body} />
    );
  return <StatePanel kind="error" title={en.states.error.title} />;
}

function useRefresh() {
  const qc = useQueryClient();
  return () => {
    for (const k of [
      'asset-figures',
      'asset-items',
      'asset-item',
      'asset-stock',
      'asset-moves',
      'asset-setup',
    ])
      void qc.invalidateQueries({ queryKey: [k] });
  };
}

function useDebounced(text: string) {
  const [v, setV] = useState('');
  useEffect(() => {
    const h = setTimeout(() => setV(text.trim()), 250);
    return () => clearTimeout(h);
  }, [text]);
  return v;
}

/** A staff member chooser (custodian, issued to) with search. */
function StaffPicker({
  institutionId,
  label,
  hint,
  value,
  onChange,
}: {
  institutionId: string;
  label: string;
  hint: string;
  value: { personId: string; name: string } | null;
  onChange: (v: { personId: string; name: string } | null) => void;
}) {
  const [text, setText] = useState('');
  const q = useDebounced(text);
  const found = useQuery({
    queryKey: ['asset-staff', institutionId, q],
    queryFn: () =>
      api.get<Staff[]>(
        `/assets/custodians?institutionId=${institutionId}&text=${encodeURIComponent(q)}`,
      ),
    enabled: q.length >= 2 && !value,
  });
  if (value)
    return (
      <div className="flex flex-col gap-1.5 sm:col-span-2">
        <span className="text-caption font-medium text-ink">{label}</span>
        <span className="flex items-center gap-3 rounded-lg border border-line-strong px-3 py-2">
          <span className="min-w-0 flex-1 text-body text-ink">{value.name}</span>
          <Button size="sm" variant="secondary" type="button" onClick={() => onChange(null)}>
            {t.change}
            <span className="sr-only"> {label}</span>
          </Button>
        </span>
      </div>
    );
  return (
    <>
      <ModalField label={label} hint={hint} wide>
        <input
          className={fieldInput}
          value={text}
          autoComplete="off"
          onChange={(e) => setText(e.target.value)}
        />
      </ModalField>
      {q.length >= 2 && found.data && (
        <ul className="flex flex-col divide-y divide-line rounded-lg border border-line sm:col-span-2">
          {found.data.length === 0 ? (
            <li className="px-3 py-2 text-body text-ink-muted">{t.noStaff}</li>
          ) : (
            found.data.map((s) => (
              <li key={s.personId}>
                <button
                  type="button"
                  onClick={() => onChange({ personId: s.personId, name: s.name })}
                  className="flex w-full flex-col items-start px-3 py-2 text-left hover:bg-paper"
                >
                  <span className="text-body text-ink">{s.name}</span>
                  {s.employeeCode && (
                    <span className="text-caption text-ink-muted">{s.employeeCode}</span>
                  )}
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </>
  );
}

export function AssetsView() {
  const school = useInstitution();
  const id = school.institutionId;
  const [tab, setTab] = useUrlTab<Tab>(['register', 'stock', 'disposed', 'settings'], 'register');
  const figures = useQuery({
    queryKey: ['asset-figures', id],
    queryFn: () => api.get<AssetFigures>(`/assets/figures?institutionId=${id}`),
    enabled: !!id,
  });
  const setup = useQuery({
    queryKey: ['asset-setup', id],
    queryFn: () => api.get<Setup>(`/assets/setup?institutionId=${id}`),
    enabled: !!id,
  });
  const f = figures.data;
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        icon={ClipboardList}
        art="settings"
        area="amber"
        eyebrow={en.nav.groups.services}
        title={t.title}
        description={t.lead}
        actions={
          <Segmented
            label={t.tabsLabel}
            value={tab}
            onChange={setTab}
            options={(['register', 'stock', 'disposed', 'settings'] as const).map((v) => ({
              value: v,
              label: t.tabs[v],
            }))}
          />
        }
      />
      {f && (
        <KeyFigures
          label={t.figures}
          figures={[
            {
              label: t.fig.assets,
              icon: Package,
              value: String(f.assets),
              note: rupees(f.valuePaise),
            },
            {
              label: t.fig.attention,
              icon: Wrench,
              value: String(f.needsAttention),
              ...(f.needsAttention ? { tone: 'warn' as const } : {}),
            },
            { label: t.fig.warranty, icon: ShieldCheck, value: String(f.warrantySoon) },
            {
              label: t.fig.low,
              icon: AlertTriangle,
              value: String(f.stockLow),
              ...(f.stockLow ? { tone: 'warn' as const } : {}),
            },
          ]}
        />
      )}
      {!id || figures.isError || !setup.data ? (
        <QueryState
          q={!id ? { isPending: true, error: null } : figures.isError ? figures : setup}
        />
      ) : tab === 'register' || tab === 'disposed' ? (
        <Register institutionId={id} setup={setup.data} disposed={tab === 'disposed'} />
      ) : tab === 'stock' ? (
        <Stock institutionId={id} />
      ) : (
        <Settings institutionId={id} setup={setup.data} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Register
// ---------------------------------------------------------------------------------------------

function Register({
  institutionId,
  setup,
  disposed,
}: {
  institutionId: string;
  setup: Setup;
  disposed: boolean;
}) {
  const { can } = useMe();
  const manage = can('assets.item.manage');
  const [text, setText] = useState('');
  const search = useDebounced(text);
  const [locationId, setLocationId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [condition, setCondition] = useState('');
  const [adding, setAdding] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const refresh = useRefresh();
  const params = new URLSearchParams({ institutionId, search, disposed: String(disposed) });
  if (locationId) params.set('locationId', locationId);
  if (categoryId) params.set('categoryId', categoryId);
  if (condition) params.set('condition', condition);
  const q = useQuery({
    queryKey: ['asset-items', params.toString()],
    queryFn: () => api.get<AssetRow[]>(`/assets/items?${params.toString()}`),
  });
  const filtered = !!(search || locationId || categoryId || condition);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex min-w-48 flex-1 flex-col gap-1.5">
          <span className="text-caption font-medium text-ink">{t.search}</span>
          <input
            type="search"
            className={fieldInput}
            value={text}
            placeholder={t.searchHint}
            onChange={(e) => setText(e.target.value)}
          />
        </label>
        <select
          aria-label={t.location}
          className={fieldInline}
          value={locationId}
          onChange={(e) => setLocationId(e.target.value)}
        >
          <option value="">{t.allLocations}</option>
          {setup.locations.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
        <select
          aria-label={t.category}
          className={fieldInline}
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
        >
          <option value="">{t.allCategories}</option>
          {setup.categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        {!disposed && (
          <select
            aria-label={t.condition}
            className={fieldInline}
            value={condition}
            onChange={(e) => setCondition(e.target.value)}
          >
            <option value="">{t.anyCondition}</option>
            {(['good', 'needs_repair', 'broken'] as const).map((c) => (
              <option key={c} value={c}>
                {t.conditions[c]}
              </option>
            ))}
          </select>
        )}
        {manage && !disposed && (
          <Button onClick={() => setAdding(true)}>
            <Plus aria-hidden className="size-4" />
            {t.addAsset}
          </Button>
        )}
      </div>
      {!q.data ? (
        <QueryState q={q} />
      ) : q.data.length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          area="amber"
          title={disposed ? t.noDisposed : filtered ? t.noMatch : t.empty}
          {...(!disposed && !filtered ? { body: t.emptyBody } : {})}
        />
      ) : (
        <Section id="asset-register" title={disposed ? t.tabs.disposed : t.tabs.register} flush>
          <ul className="divide-y divide-line">
            {q.data.map((a) => (
              <li key={a.itemId}>
                <button
                  type="button"
                  onClick={() => setOpen(a.itemId)}
                  className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3 text-left hover:bg-paper"
                >
                  <span className="w-24 shrink-0 font-mono text-caption text-ink-muted">
                    {a.tag}
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="text-body text-ink">{a.name}</span>
                    <span className="text-caption text-ink-muted">
                      {[
                        a.category,
                        a.location,
                        a.custodian,
                        a.costPaise !== null ? rupees(a.costPaise) : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </span>
                  {a.warrantySoon && <Pill tone="warn">{t.warrantySoon}</Pill>}
                  {!a.disposedOn && (
                    <Pill tone={TONE[a.condition] ?? 'neutral'}>{t.conditions[a.condition]}</Pill>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </Section>
      )}
      {adding && (
        <AssetForm
          institutionId={institutionId}
          setup={setup}
          onClose={() => setAdding(false)}
          onDone={() => {
            setAdding(false);
            refresh();
          }}
        />
      )}
      {open && (
        <AssetDrawer
          institutionId={institutionId}
          itemId={open}
          setup={setup}
          onClose={() => setOpen(null)}
        />
      )}
    </div>
  );
}

function AssetForm({
  institutionId,
  setup,
  onClose,
  onDone,
}: {
  institutionId: string;
  setup: Setup;
  onClose: () => void;
  onDone: () => void;
}) {
  const next = useQuery({
    queryKey: ['asset-next', institutionId],
    queryFn: () =>
      api.get<{ tag: string }>(`/assets/items/next-tag?institutionId=${institutionId}`),
  });
  const [tag, setTag] = useState('');
  useEffect(() => {
    if (next.data && !tag) setTag(next.data.tag);
  }, [next.data, tag]);
  const [name, setName] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [locationId, setLocationId] = useState('');
  const [custodian, setCustodian] = useState<{ personId: string; name: string } | null>(null);
  const [purchasedOn, setPurchasedOn] = useState('');
  const [cost, setCost] = useState('');
  const [vendor, setVendor] = useState('');
  const [serial, setSerial] = useState('');
  const [warranty, setWarranty] = useState('');
  const costPaise = cost.trim() ? parseRupees(cost) : null;
  const save = useMutation({
    mutationFn: () =>
      api.post('/assets/items', {
        institutionId,
        tag,
        name,
        categoryId,
        locationId: locationId || null,
        custodianPersonId: custodian?.personId ?? null,
        purchasedOn: purchasedOn || null,
        costPaise,
        vendor,
        serialNo: serial,
        warrantyUntil: warranty || null,
      }),
    onSuccess: onDone,
  });
  return (
    <FormModal
      title={t.addTitle}
      submitLabel={t.addAsset}
      cancelLabel={t.cancel}
      pending={save.isPending}
      submitDisabled={
        !tag.trim() || !name.trim() || !categoryId || (cost.trim() !== '' && costPaise === null)
      }
      error={save.error ? errorText(save.error) : null}
      size="lg"
      onClose={onClose}
      onSubmit={() => save.mutate()}
    >
      <ModalField label={t.tag} hint={t.tagHint}>
        <input
          className={cx(fieldInput, 'font-mono')}
          value={tag}
          maxLength={20}
          onChange={(e) => setTag(e.target.value)}
        />
      </ModalField>
      <ModalField label={t.name}>
        <input
          className={fieldInput}
          value={name}
          maxLength={200}
          onChange={(e) => setName(e.target.value)}
        />
      </ModalField>
      <ModalField label={t.category}>
        <select
          className={fieldInput}
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
        >
          <option value="" />
          {setup.categories
            .filter((c) => c.active)
            .map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
        </select>
      </ModalField>
      <ModalField label={t.location} hint={t.optional}>
        <select
          className={fieldInput}
          value={locationId}
          onChange={(e) => setLocationId(e.target.value)}
        >
          <option value="" />
          {setup.locations
            .filter((l) => l.active)
            .map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
        </select>
      </ModalField>
      <StaffPicker
        institutionId={institutionId}
        label={t.custodian}
        hint={t.custodianHint}
        value={custodian}
        onChange={setCustodian}
      />
      <ModalField label={t.purchasedOn} hint={t.optional}>
        <input
          type="date"
          className={fieldInput}
          value={purchasedOn}
          onChange={(e) => setPurchasedOn(e.target.value)}
        />
      </ModalField>
      <ModalField label={t.cost} hint={cost && costPaise === null ? t.badAmount : t.optional}>
        <input
          className={cx(fieldInput, 'tabular-nums')}
          inputMode="decimal"
          value={cost}
          onChange={(e) => setCost(e.target.value)}
        />
      </ModalField>
      <ModalField label={t.vendor} hint={t.optional}>
        <input
          className={fieldInput}
          value={vendor}
          maxLength={200}
          onChange={(e) => setVendor(e.target.value)}
        />
      </ModalField>
      <ModalField label={t.serial} hint={t.optional}>
        <input
          className={fieldInput}
          value={serial}
          maxLength={100}
          onChange={(e) => setSerial(e.target.value)}
        />
      </ModalField>
      <ModalField label={t.warranty} hint={t.optional}>
        <input
          type="date"
          className={fieldInput}
          value={warranty}
          onChange={(e) => setWarranty(e.target.value)}
        />
      </ModalField>
    </FormModal>
  );
}

function AssetDrawer({
  institutionId,
  itemId,
  setup,
  onClose,
}: {
  institutionId: string;
  itemId: string;
  setup: Setup;
  onClose: () => void;
}) {
  const { can } = useMe();
  const manage = can('assets.item.manage');
  const refresh = useRefresh();
  const [disposing, setDisposing] = useState(false);
  const q = useQuery({
    queryKey: ['asset-item', itemId],
    queryFn: () =>
      api.get<AssetRow & { history: AssetEvent[] }>(
        `/assets/items/${itemId}?institutionId=${institutionId}`,
      ),
  });
  const a = q.data;
  const [locationId, setLocationId] = useState<string | null>(null);
  const [condition, setCondition] = useState<string | null>(null);
  const [custodian, setCustodian] = useState<{ personId: string; name: string } | null | undefined>(
    undefined,
  );
  const [note, setNote] = useState('');
  const save = useMutation({
    mutationFn: () =>
      api.post(`/assets/items/${itemId}/update`, {
        institutionId,
        ...(locationId !== null ? { locationId: locationId || null } : {}),
        ...(condition !== null ? { condition } : {}),
        ...(custodian !== undefined ? { custodianPersonId: custodian?.personId ?? null } : {}),
        note,
      }),
    onSuccess: () => {
      setLocationId(null);
      setCondition(null);
      setCustodian(undefined);
      setNote('');
      refresh();
    },
  });
  const line = (e: AssetEvent) => {
    const h = t.historyLine;
    return e.kind === 'added'
      ? h.added(e.to)
      : e.kind === 'moved'
        ? h.moved(e.from, e.to)
        : e.kind === 'custodian'
          ? h.custodian(e.from, e.to)
          : e.kind === 'condition'
            ? h.condition(t.conditions[e.from] ?? e.from, t.conditions[e.to] ?? e.to)
            : h.disposed();
  };
  return (
    <>
      <RecordDrawer
        open={!disposing}
        onOpenChange={(o) => !o && onClose()}
        title={a ? `${a.tag} · ${a.name}` : t.title}
        {...(a ? { subtitle: [a.category, a.location].filter(Boolean).join(' · ') } : {})}
        closeLabel={t.close}
      >
        {!a ? (
          <QueryState q={q} />
        ) : (
          <div className="flex flex-col gap-5">
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-body">
              {(
                [
                  [t.condition, t.conditions[a.condition]],
                  [t.custodian, a.custodian],
                  [t.cost, a.costPaise !== null ? rupees(a.costPaise) : null],
                  [t.purchasedOn, a.purchasedOn ? dmy(a.purchasedOn) : null],
                  [t.vendor, a.vendor || null],
                  [t.serial, a.serialNo || null],
                  [t.warranty, a.warrantyUntil ? dmy(a.warrantyUntil) : null],
                ] as const
              )
                .filter(([, v]) => v)
                .map(([k, v]) => (
                  <div key={k} className="contents">
                    <dt className="text-ink-muted">{k}</dt>
                    <dd className="text-ink">{v}</dd>
                  </div>
                ))}
            </dl>
            {a.disposedOn && (
              <p className="text-body text-signal-warn-ink">
                {t.disposedOn(dmy(a.disposedOn), a.disposedReason ?? '')}
              </p>
            )}
            {manage && !a.disposedOn && (
              <form
                className="grid gap-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  save.mutate();
                }}
              >
                <label className="flex flex-col gap-1.5">
                  <span className="text-caption font-medium text-ink">{t.location}</span>
                  <select
                    className={fieldInput}
                    value={locationId ?? a.locationId ?? ''}
                    onChange={(e) => setLocationId(e.target.value)}
                  >
                    <option value="" />
                    {setup.locations
                      .filter((l) => l.active)
                      .map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.name}
                        </option>
                      ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className="text-caption font-medium text-ink">{t.condition}</span>
                  <select
                    className={fieldInput}
                    value={condition ?? a.condition}
                    onChange={(e) => setCondition(e.target.value)}
                  >
                    {(['good', 'needs_repair', 'broken'] as const).map((c) => (
                      <option key={c} value={c}>
                        {t.conditions[c]}
                      </option>
                    ))}
                  </select>
                </label>
                <StaffPicker
                  institutionId={institutionId}
                  label={t.custodian}
                  hint={t.custodianHint}
                  value={
                    custodian === undefined
                      ? a.custodianId
                        ? { personId: a.custodianId, name: a.custodian ?? '' }
                        : null
                      : custodian
                  }
                  onChange={setCustodian}
                />
                <label className="flex flex-col gap-1.5">
                  <span className="text-caption font-medium text-ink">{t.noteLabel}</span>
                  <input
                    className={fieldInput}
                    value={note}
                    maxLength={300}
                    onChange={(e) => setNote(e.target.value)}
                  />
                </label>
                {save.isError && (
                  <p role="alert" className="text-caption text-signal-stop-ink">
                    {errorText(save.error)}
                  </p>
                )}
                <div className="flex flex-wrap gap-2">
                  <Button type="submit" disabled={save.isPending}>
                    {t.save}
                  </Button>
                  <Button type="button" variant="secondary" onClick={() => setDisposing(true)}>
                    {t.dispose}
                  </Button>
                </div>
              </form>
            )}
            <section aria-label={t.history} className="flex flex-col gap-2">
              <h3 className="text-caption font-semibold text-ink">{t.history}</h3>
              <ol className="flex flex-col gap-1.5 text-caption text-ink-muted">
                {a.history.map((e, i) => (
                  <li key={`${e.at}-${i}`}>
                    <span className="text-ink">{line(e)}</span>
                    {e.note ? ` · ${e.note}` : ''} · {e.by ?? ''} · {dmy(e.at)}
                  </li>
                ))}
              </ol>
            </section>
          </div>
        )}
      </RecordDrawer>
      {disposing && a && (
        <ReasonDialog
          title={`${t.dispose}: ${a.tag}`}
          hint={t.disposeHint}
          label={t.reason}
          action={t.dispose}
          cancel={t.cancel}
          minLength={3}
          errorText={errorText}
          onClose={() => setDisposing(false)}
          submit={async (reason) => {
            await api.post(`/assets/items/${itemId}/dispose`, { institutionId, reason });
            refresh();
            onClose();
          }}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// Stock
// ---------------------------------------------------------------------------------------------

function Stock({ institutionId }: { institutionId: string }) {
  const { can } = useMe();
  const manage = can('assets.stock.manage');
  const refresh = useRefresh();
  const [editing, setEditing] = useState<StockRow | 'new' | null>(null);
  const [moving, setMoving] = useState<{ item: StockRow; direction: 'in' | 'out' } | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const q = useQuery({
    queryKey: ['asset-stock', institutionId],
    queryFn: () => api.get<StockRow[]>(`/assets/stock?institutionId=${institutionId}`),
  });
  const moves = useQuery({
    queryKey: ['asset-moves', openId],
    queryFn: () =>
      api.get<StockMove[]>(`/assets/stock/${openId}/movements?institutionId=${institutionId}`),
    enabled: !!openId,
  });
  return (
    <Section
      id="asset-stock"
      title={t.tabs.stock}
      flush
      actions={
        manage ? (
          <Button size="sm" onClick={() => setEditing('new')}>
            <Plus aria-hidden className="size-4" />
            {t.addItem}
          </Button>
        ) : undefined
      }
    >
      {!q.data ? (
        <div className="p-5">
          <QueryState q={q} />
        </div>
      ) : q.data.length === 0 ? (
        <EmptyState compact icon={ClipboardList} title={t.noStock} body={t.noStockBody} />
      ) : (
        <ul className="divide-y divide-line">
          {q.data.map((s) => (
            <li key={s.itemId} className="flex flex-col gap-2 px-5 py-3">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <button
                  type="button"
                  className="flex min-w-0 flex-1 flex-col text-left"
                  aria-expanded={openId === s.itemId}
                  onClick={() => setOpenId(openId === s.itemId ? null : s.itemId)}
                >
                  <span className="flex items-center gap-2 text-body text-ink">
                    {s.name}
                    {s.low && <Pill tone="warn">{t.low}</Pill>}
                    {!s.active && <Pill>{t.off}</Pill>}
                  </span>
                  <span className="text-caption text-ink-muted tabular-nums">
                    {t.balance(s.balance, s.unit)}
                    {s.reorderLevel ? ` · ${t.reorder} ${s.reorderLevel}` : ''}
                  </span>
                </button>
                {manage && s.active && (
                  <span className="flex gap-1">
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => setMoving({ item: s, direction: 'in' })}
                    >
                      {t.receive}
                      <span className="sr-only"> {s.name}</span>
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={s.balance === 0}
                      onClick={() => setMoving({ item: s, direction: 'out' })}
                    >
                      {t.issue}
                      <span className="sr-only"> {s.name}</span>
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => setEditing(s)}>
                      {t.edit}
                      <span className="sr-only"> {s.name}</span>
                    </Button>
                  </span>
                )}
              </div>
              {openId === s.itemId && moves.data && (
                <ol
                  aria-label={t.moves}
                  className="flex flex-col gap-1 pl-2 text-caption text-ink-muted"
                >
                  {moves.data.map((m, i) => (
                    <li key={`${m.at}-${i}`} className="tabular-nums">
                      {t.moveLine(m.direction, m.quantity, s.unit)}
                      {m.issuedTo ? ` · ${m.issuedTo}` : ''}
                      {m.note ? ` · ${m.note}` : ''} · {dmy(m.at)}
                    </li>
                  ))}
                </ol>
              )}
            </li>
          ))}
        </ul>
      )}
      {editing && (
        <StockItemForm
          institutionId={institutionId}
          item={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onDone={() => {
            setEditing(null);
            refresh();
          }}
        />
      )}
      {moving && (
        <MoveForm
          institutionId={institutionId}
          item={moving.item}
          direction={moving.direction}
          onClose={() => setMoving(null)}
          onDone={() => {
            setMoving(null);
            refresh();
          }}
        />
      )}
    </Section>
  );
}

function StockItemForm({
  institutionId,
  item,
  onClose,
  onDone,
}: {
  institutionId: string;
  item: StockRow | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [name, setName] = useState(item?.name ?? '');
  const [unit, setUnit] = useState(item?.unit ?? '');
  const [reorder, setReorder] = useState(String(item?.reorderLevel ?? 0));
  const [active, setActive] = useState(item?.active ?? true);
  const n = Number(reorder);
  const save = useMutation({
    mutationFn: () => {
      const body = { institutionId, name, unit, reorderLevel: n, active };
      return item ? api.put(`/assets/stock/${item.itemId}`, body) : api.post('/assets/stock', body);
    },
    onSuccess: onDone,
  });
  return (
    <FormModal
      title={item ? t.editItem : t.addItem}
      submitLabel={t.save}
      cancelLabel={t.cancel}
      pending={save.isPending}
      submitDisabled={!name.trim() || !unit.trim() || !(Number.isInteger(n) && n >= 0)}
      error={save.error ? errorText(save.error) : null}
      size="md"
      onClose={onClose}
      onSubmit={() => save.mutate()}
    >
      <ModalField label={t.name}>
        <input
          className={fieldInput}
          value={name}
          maxLength={120}
          onChange={(e) => setName(e.target.value)}
        />
      </ModalField>
      <ModalField label={t.unit} hint={t.unitHint}>
        <input
          className={fieldInput}
          value={unit}
          maxLength={20}
          onChange={(e) => setUnit(e.target.value)}
        />
      </ModalField>
      <ModalField label={t.reorder} hint={t.reorderHint}>
        <input
          className={fieldInput}
          inputMode="numeric"
          value={reorder}
          onChange={(e) => setReorder(e.target.value)}
        />
      </ModalField>
      {item && (
        <label className="flex items-center gap-2 text-body text-ink sm:col-span-2">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
          {t.active}
        </label>
      )}
    </FormModal>
  );
}

function MoveForm({
  institutionId,
  item,
  direction,
  onClose,
  onDone,
}: {
  institutionId: string;
  item: StockRow;
  direction: 'in' | 'out';
  onClose: () => void;
  onDone: () => void;
}) {
  const [quantity, setQuantity] = useState('');
  const [note, setNote] = useState('');
  const [to, setTo] = useState<{ personId: string; name: string } | null>(null);
  const n = Number(quantity);
  const save = useMutation({
    mutationFn: () =>
      api.post(`/assets/stock/${item.itemId}/move`, {
        institutionId,
        direction,
        quantity: n,
        note,
        issuedToPersonId: direction === 'out' ? (to?.personId ?? null) : null,
      }),
    onSuccess: onDone,
  });
  return (
    <FormModal
      title={direction === 'in' ? t.receiveTitle(item.name) : t.issueTitle(item.name)}
      submitLabel={direction === 'in' ? t.receive : t.issue}
      cancelLabel={t.cancel}
      pending={save.isPending}
      submitDisabled={!(Number.isInteger(n) && n >= 1)}
      error={save.error ? errorText(save.error) : null}
      size="md"
      onClose={onClose}
      onSubmit={() => save.mutate()}
    >
      <ModalField label={t.quantity} hint={t.balance(item.balance, item.unit)}>
        <input
          className={fieldInput}
          inputMode="numeric"
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
        />
      </ModalField>
      <ModalField label={t.noteLabel} hint={t.optional}>
        <input
          className={fieldInput}
          value={note}
          maxLength={300}
          onChange={(e) => setNote(e.target.value)}
        />
      </ModalField>
      {direction === 'out' && (
        <StaffPicker
          institutionId={institutionId}
          label={t.issuedTo}
          hint={t.issuedToHint}
          value={to}
          onChange={setTo}
        />
      )}
    </FormModal>
  );
}

// ---------------------------------------------------------------------------------------------
// Places and categories
// ---------------------------------------------------------------------------------------------

function Settings({ institutionId, setup }: { institutionId: string; setup: Setup }) {
  const { can } = useMe();
  const manage = can('assets.item.manage');
  const refresh = useRefresh();
  const [editing, setEditing] = useState<{
    kind: 'category' | 'location';
    item: Named | null;
  } | null>(null);
  const list = (kind: 'category' | 'location', items: Named[]) => (
    <Section
      id={`asset-${kind}`}
      title={kind === 'category' ? t.categories : t.locations}
      flush
      actions={
        manage ? (
          <Button size="sm" onClick={() => setEditing({ kind, item: null })}>
            <Plus aria-hidden className="size-4" />
            {kind === 'category' ? t.addCategory : t.addLocation}
          </Button>
        ) : undefined
      }
    >
      <ul className="divide-y divide-line">
        {items.map((n) => (
          <li key={n.id} className="flex items-center gap-4 px-5 py-2.5">
            <span className="flex flex-1 items-center gap-2 text-body text-ink">
              {n.name}
              {!n.active && <Pill>{t.off}</Pill>}
            </span>
            {manage && (
              <Button size="sm" variant="secondary" onClick={() => setEditing({ kind, item: n })}>
                {t.edit}
                <span className="sr-only"> {n.name}</span>
              </Button>
            )}
          </li>
        ))}
      </ul>
    </Section>
  );
  return (
    <div className="grid items-start gap-6 lg:grid-cols-2">
      {list('location', setup.locations)}
      {list('category', setup.categories)}
      {editing && (
        <NamedForm
          institutionId={institutionId}
          kind={editing.kind}
          item={editing.item}
          onClose={() => setEditing(null)}
          onDone={() => {
            setEditing(null);
            refresh();
          }}
        />
      )}
    </div>
  );
}

function NamedForm({
  institutionId,
  kind,
  item,
  onClose,
  onDone,
}: {
  institutionId: string;
  kind: 'category' | 'location';
  item: Named | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [name, setName] = useState(item?.name ?? '');
  const [active, setActive] = useState(item?.active ?? true);
  const save = useMutation({
    mutationFn: () => {
      const body = { institutionId, kind, name, active };
      return item ? api.put(`/assets/setup/${item.id}`, body) : api.post('/assets/setup', body);
    },
    onSuccess: onDone,
  });
  return (
    <FormModal
      title={kind === 'category' ? t.addCategory : t.addLocation}
      submitLabel={t.save}
      cancelLabel={t.cancel}
      pending={save.isPending}
      submitDisabled={!name.trim()}
      error={save.error ? errorText(save.error) : null}
      size="md"
      onClose={onClose}
      onSubmit={() => save.mutate()}
    >
      <ModalField label={t.name} wide>
        <input
          className={fieldInput}
          value={name}
          maxLength={80}
          onChange={(e) => setName(e.target.value)}
        />
      </ModalField>
      {item && (
        <label className="flex items-center gap-2 text-body text-ink sm:col-span-2">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
          {t.active}
        </label>
      )}
    </FormModal>
  );
}
