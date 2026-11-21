import type { Metadata } from 'next';
import { en } from '../../messages/en';
import { Landing } from './landing';

export const metadata: Metadata = {
  title: en.landing.metaTitle,
  description: en.landing.metaDescription,
  openGraph: {
    title: en.landing.metaTitle,
    description: en.landing.metaDescription,
    type: 'website',
  },
};

/** The public landing page. proxy.ts shows it at / to anyone not signed in. */
export default function WelcomePage() {
  return <Landing />;
}
