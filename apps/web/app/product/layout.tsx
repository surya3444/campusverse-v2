import { cx } from '@campusverse/ui';
import type { ReactNode } from 'react';
import { SHELL, SiteFooter, SiteHeader, SkipLink } from '../welcome/site';
import { DocsNav } from './docs-nav';

/** The product docs: the site header, then a dark two-column reading layout with the sidebar. */
export default function ProductLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh bg-paper text-ink">
      <SkipLink />
      <SiteHeader />
      <div className="bg-navy-900 text-white">
        <div
          className={cx(
            SHELL,
            'grid gap-8 pt-6 lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-12 lg:pt-0',
          )}
        >
          <DocsNav />
          <main id="main" className="min-w-0 py-10 lg:py-14">
            {children}
          </main>
        </div>
      </div>
      <SiteFooter />
    </div>
  );
}
