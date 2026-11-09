import type { Metadata } from 'next';
import localFont from 'next/font/local';
import type { ReactNode } from 'react';
import { getT } from '../lib/server';
import './globals.css';

const readex = localFont({
  src: [
    { path: '../fonts/ReadexPro_400Regular.ttf', weight: '400' },
    { path: '../fonts/ReadexPro_500Medium.ttf', weight: '500' },
    { path: '../fonts/ReadexPro_700Bold.ttf', weight: '700' },
  ],
  variable: '--font-readex',
  display: 'swap',
});

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: t('admin.title'), robots: { index: false, follow: false } };
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const { lang, dir } = await getT();
  return (
    <html lang={lang} dir={dir} className={readex.variable}>
      <body>{children}</body>
    </html>
  );
}
