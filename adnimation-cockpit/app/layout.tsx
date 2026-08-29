import type { Metadata, Viewport } from 'next';
import { Barlow, Barlow_Condensed, Barlow_Semi_Condensed } from 'next/font/google';
import './globals.css';

/** The three Barlow families the design system is built on. */
const barlow = Barlow({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-barlow',
  display: 'swap',
});

const barlowCondensed = Barlow_Condensed({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-barlow-condensed',
  display: 'swap',
});

const barlowSemi = Barlow_Semi_Condensed({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-barlow-semi',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Adnimation CEO Cockpit',
  description: 'Executive command centre for Adnimation.',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#0f1a24',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      dir="ltr"
      className={`${barlow.variable} ${barlowCondensed.variable} ${barlowSemi.variable}`}
    >
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
