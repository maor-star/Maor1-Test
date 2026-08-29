import type { Metadata, Viewport } from 'next';
import { Assistant } from 'next/font/google';
import './globals.css';

const assistant = Assistant({
  subsets: ['hebrew', 'latin'],
  variable: '--font-assistant',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Adnimation CEO Cockpit',
  description: 'מערכת הניהול של מנכ"ל Adnimation',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="he" dir="rtl" className={assistant.variable}>
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}
