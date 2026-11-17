import { appEnv, simulatingHere } from '@campusverse/config';
import type { Metadata, Viewport } from 'next';
import { DM_Sans, Plus_Jakarta_Sans } from 'next/font/google';
import type { ReactNode } from 'react';
import { en } from '../messages/en';
import './globals.css';

// As in the Campusverse hub: DM Sans for text, Plus Jakarta Sans for headings (decision 0022).
const dmSans = DM_Sans({
  subsets: ['latin'],
  variable: '--font-dm-sans',
  display: 'swap',
});
const jakarta = Plus_Jakarta_Sans({
  subsets: ['latin'],
  weight: ['500', '600', '700'],
  variable: '--font-jakarta',
  display: 'swap',
});

// Rendered per request: the environment banner comes from the running container, so the same
// image serves the test and live environments.
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: en.app.name,
  icons: { icon: '/icon.svg' },
  robots: { index: false, follow: false },
};
export const viewport: Viewport = { themeColor: '#04266d', width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: ReactNode }) {
  const banner = en.app.env[appEnv()];
  return (
    <html lang="en" className={`${dmSans.variable} ${jakarta.variable}`}>
      <body className="min-h-dvh">
        <a
          href="#main"
          className="sr-only z-50 rounded-md bg-navy-950 px-4 py-2 text-white focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
        >
          {en.app.skipToContent}
        </a>
        {(banner || simulatingHere()) && (
          // One slim bar, as in the school app: which environment, and whether SMS is simulated.
          <div
            role="note"
            className="flex flex-wrap items-center justify-center gap-x-3 bg-midnight-950 px-4 py-1 text-center text-[12px] font-medium text-white/85"
          >
            {banner && (
              <span className="inline-flex items-center gap-1.5">
                <span aria-hidden className="size-1.5 rounded-full bg-cyan-400" />
                {banner}
              </span>
            )}
            {simulatingHere() && <span>{en.app.simulation}</span>}
          </div>
        )}
        {children}
      </body>
    </html>
  );
}
