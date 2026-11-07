import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { documentAttributes, translations } from '../lib/locale';
import './globals.css';

const t = translations();

export const metadata: Metadata = {
  title: t.admin.title,
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  const { lang, dir } = documentAttributes();
  return (
    <html lang={lang} dir={dir}>
      <body>{children}</body>
    </html>
  );
}
