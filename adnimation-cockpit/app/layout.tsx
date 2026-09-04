import type { Metadata, Viewport } from 'next';
import { Barlow, IBM_Plex_Mono } from 'next/font/google';
import './globals.css';

/**
 * Two families, as the design package specifies: Barlow for words, IBM Plex
 * Mono for every figure. Nothing on a screen is set in anything else.
 */
const barlow = Barlow({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-barlow',
  display: 'swap',
});

const plexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['500', '600'],
  variable: '--font-mono',
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
  themeColor: '#fbfcfd',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      dir="ltr"
      className={`${barlow.variable} ${plexMono.variable}`}
    >
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
