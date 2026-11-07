import { defaultConfig } from '@sanad/config';
import { formatKwd, kwd } from '@sanad/core';
import { translations } from '../lib/locale';

const t = translations();

export default function HomePage() {
  return (
    <main className="shell">
      <header className="header">
        <h1>{t.admin.title}</h1>
        <p className="muted">{t.app.tagline}</p>
      </header>

      <section className="card">
        <h2>{t.home.comingSoon}</h2>
        <p className="muted">
          {defaultConfig.circle.allowedMonthlyAmountsKwd
            .map((m) => `${formatKwd(kwd(m))} ${t.common.currency}`)
            .join(' · ')}
        </p>
      </section>
    </main>
  );
}
