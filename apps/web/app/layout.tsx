import type { CSSProperties } from 'react';
import { appEnv, simulatingHere } from '@campusverse/config';
import type { Metadata, Viewport } from 'next';
import {
  DM_Sans,
  Noto_Sans_Devanagari,
  Noto_Sans_Kannada,
  Noto_Sans_Tamil,
  Noto_Sans_Telugu,
  Plus_Jakarta_Sans,
} from 'next/font/google';
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
  weight: ['500', '600', '700', '800'],
  variable: '--font-jakarta',
  display: 'swap',
});
// Regional faces load only when a page uses that script. next/font needs literal options.
const kannada = Noto_Sans_Kannada({
  subsets: ['kannada'],
  weight: ['400', '600', '700'],
  variable: '--font-noto-kannada',
  display: 'swap',
  preload: false,
});
const telugu = Noto_Sans_Telugu({
  subsets: ['telugu'],
  weight: ['400', '600', '700'],
  variable: '--font-noto-telugu',
  display: 'swap',
  preload: false,
});
const tamil = Noto_Sans_Tamil({
  subsets: ['tamil'],
  weight: ['400', '600', '700'],
  variable: '--font-noto-tamil',
  display: 'swap',
  preload: false,
});
const devanagari = Noto_Sans_Devanagari({
  subsets: ['devanagari'],
  weight: ['400', '600', '700'],
  variable: '--font-noto-devanagari',
  display: 'swap',
  preload: false,
});

// Rendered per request: the environment banner comes from the running container, so the same
// image serves the test and live environments.
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: en.app.name,
  icons: { icon: '/icon.svg' },
};
export const viewport: Viewport = { themeColor: '#04266d', width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: ReactNode }) {
  const env = appEnv();
  const simulating = simulatingHere();
  const showBar = env !== 'production' || simulating;
  const fonts = [dmSans, jakarta, kannada, telugu, tamil, devanagari]
    .map((f) => f.variable)
    .join(' ');
  return (
    <html
      lang="en"
      className={fonts}
      // The slim environment bar's height, so the sticky sidebar and top bar sit under it.
      style={{ '--env-bar': showBar ? '26px' : '0px' } as CSSProperties}
    >
      <body className="min-h-dvh">
        <a
          href="#main"
          className="sr-only z-50 rounded-md bg-navy-950 px-4 py-2 text-white focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
        >
          {en.app.skipToContent}
        </a>
        {showBar && (
          // One slim bar: which environment this is, and whether messages are simulated.
          <div
            role="note"
            className={
              env === 'test'
                ? 'sticky top-0 z-40 flex h-[26px] items-center justify-center gap-x-3 overflow-hidden bg-signal-warn-tint px-4 text-center text-[12px] font-medium whitespace-nowrap text-signal-warn-ink'
                : 'sticky top-0 z-40 flex h-[26px] items-center justify-center gap-x-3 overflow-hidden bg-midnight-950 px-4 text-center text-[12px] font-medium whitespace-nowrap text-white/85'
            }
          >
            {env !== 'production' && (
              <span className="inline-flex items-center gap-1.5">
                <span aria-hidden className="size-1.5 rounded-full bg-cyan-400" />
                {en.app.env[env]}
              </span>
            )}
            {simulating && <span className="truncate">{en.app.simulation}</span>}
          </div>
        )}
        {children}
      </body>
    </html>
  );
}
