import type { ReactNode } from 'react';
import { Logo } from '../../components/ui';
import { visibleNav } from '../../lib/nav';
import { getMe, getT } from '../../lib/server';
import { LangSwitch } from '../LangSwitch';
import { logout } from '../session-actions';
import { NavLinks } from './NavLinks';

export default async function DashLayout({ children }: { children: ReactNode }) {
  const [{ t }, me] = await Promise.all([getT(), getMe()]);
  const items = visibleNav(me.roles).map((n) => ({ href: n.href, label: t(`admin.nav.${n.key}`) }));
  return (
    <div className="app">
      <a className="skip" href="#main">
        {t('admin.skip')}
      </a>
      <aside className="sidebar" aria-label={t('admin.title')}>
        <div className="brand">
          <Logo />
          <div>
            {t('app.name')}
            <small>{t('admin.title')}</small>
          </div>
        </div>
        <NavLinks items={items} />
        <div className="sidebar-foot">
          <span className="mono" style={{ color: 'inherit' }}>
            {me.email}
          </span>
          <span className="roles">
            {me.roles.map((r) => (
              <span key={r} className="badge dark">
                {t(`admin.roles.${r}`)}
              </span>
            ))}
          </span>
          <LangSwitch label={t('admin.language')} />
          <form action={logout}>
            <button className="linkish" type="submit">
              {t('admin.logout')}
            </button>
          </form>
        </div>
      </aside>
      <main className="main" id="main" tabIndex={-1}>
        {children}
      </main>
    </div>
  );
}
