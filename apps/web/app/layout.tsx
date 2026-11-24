import type { CSSProperties } from 'react';
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
  const fonts = [dmSans, jakarta, kannada, telugu, tamil, devanagari]
    .map((f) => f.variable)
    .join(' ');
  return (
    <html
      lang="en"
      className={fonts}
      // No environment bar: the sticky sidebar and top bar sit at the very top.
      style={{ '--env-bar': '0px' } as CSSProperties}
    >
      <body className="min-h-dvh">
        <a
          href="#main"
          className="sr-only z-50 rounded-md bg-navy-950 px-4 py-2 text-white focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
        >
          {en.app.skipToContent}
        </a>
        {children}
      </body>
    </html>
  );
}
