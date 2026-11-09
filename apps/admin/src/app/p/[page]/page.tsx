import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Logo } from '../../../components/ui';
import { PAGES } from '../../../content/public-pages';

type Key = keyof typeof PAGES;

export function generateStaticParams() {
  return Object.keys(PAGES).map((page) => ({ page }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ page: string }>;
}): Promise<Metadata> {
  const p = PAGES[(await params).page as Key];
  return {
    title: p ? `${p.titleAr} — ${p.titleEn} | سند Sanad` : 'Sanad',
    robots: { index: true, follow: false },
  };
}

/** Public store pages (no sign-in): Arabic and English side by side. */
export default async function PublicPage({ params }: { params: Promise<{ page: string }> }) {
  const p = PAGES[(await params).page as Key];
  if (!p) notFound();
  return (
    <main className="public">
      <header className="row" style={{ justifyContent: 'space-between' }}>
        <div className="brand" style={{ color: 'var(--ink)' }}>
          <Logo size={34} />
          <div>سند · Sanad</div>
        </div>
      </header>
      {p.draft ? (
        <div className="banner warn small">
          <span dir="rtl" lang="ar">
            مسودة بانتظار المراجعة القانونية.
          </span>{' '}
          <span dir="ltr" lang="en">
            Draft pending legal review.
          </span>
        </div>
      ) : null}
      <div className="two">
        <article dir="rtl" lang="ar" className="card">
          <h1>{p.titleAr}</h1>
          {p.sections.map((s) => (
            <section key={s.ar[0]}>
              <h2>{s.ar[0]}</h2>
              <p>{s.ar[1]}</p>
            </section>
          ))}
        </article>
        <article dir="ltr" lang="en" className="card">
          <h1>{p.titleEn}</h1>
          {p.sections.map((s) => (
            <section key={s.en[0]}>
              <h2>{s.en[0]}</h2>
              <p>{s.en[1]}</p>
            </section>
          ))}
        </article>
      </div>
    </main>
  );
}
