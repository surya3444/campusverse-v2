import { cx } from '@campusverse/ui';
import { ArrowRight } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { SYSTEMS } from '../../lib/systems';
import { en } from '../../messages/en';
import { productText } from '../../messages/product';
import { FOCUS_DARK } from '../welcome/site';
import { DocCta, DocHead, Pager } from './parts';
import { systemHref } from './paths';

const p = productText;
const s = en.systems;

export const metadata: Metadata = {
  title: p.meta.product,
  description: p.meta.productDescription,
};

/** The docs home: every system in one table. */
export default function ProductPage() {
  const first = SYSTEMS[0];
  return (
    <>
      <DocHead
        crumbs={[
          [p.crumbs.home, '/'],
          [p.crumbs.product, null],
        ]}
        title={p.overview.title}
        lead={p.overview.lead}
      />
      <div className="py-10">
        <div className="overflow-hidden rounded-lg border border-white/10">
          <div
            aria-hidden
            className="hidden grid-cols-[14rem_minmax(0,1fr)_5rem_1.5rem] gap-4 border-b border-white/10 bg-white/[0.03] px-4 py-2.5 text-caption font-medium text-white/70 md:grid"
          >
            <span>{p.systemsTable.system}</span>
            <span>{p.systemsTable.what}</span>
            <span className="text-right">{p.systemsTable.modules}</span>
            <span />
          </div>
          <ul className="divide-y divide-white/10">
            {SYSTEMS.map((sys) => {
              const live = sys.apps.filter((a) => a.status === 'live').length;
              return (
                <li key={sys.key}>
                  <Link
                    href={systemHref(sys.key)}
                    className={cx(
                      'group grid gap-1 px-4 py-3.5 transition-colors hover:bg-white/[0.04] md:grid-cols-[14rem_minmax(0,1fr)_5rem_1.5rem] md:items-center md:gap-4',
                      FOCUS_DARK,
                    )}
                  >
                    <span className="flex items-center gap-2.5 font-display font-semibold text-white">
                      <sys.Icon aria-hidden className="size-4 text-white/70" />
                      {s.groups[sys.key]}
                    </span>
                    <span className="text-body text-white/70">{s.taglines[sys.key]}</span>
                    <span className="tabular text-caption text-white/70 md:text-right">
                      {live}/{sys.apps.length}
                    </span>
                    <ArrowRight
                      aria-hidden
                      className="hidden size-4 text-white/40 transition group-hover:translate-x-0.5 group-hover:text-white md:block"
                    />
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
      {first && <Pager next={{ href: systemHref(first.key), label: s.groups[first.key] ?? '' }} />}
      <DocCta />
    </>
  );
}
