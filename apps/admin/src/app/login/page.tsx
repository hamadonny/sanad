import { Logo } from '../../components/ui';
import { IS_DEV } from '../../lib/config';
import { getT } from '../../lib/server';
import { LangSwitch } from '../LangSwitch';
import { LoginForm } from './LoginForm';

export default async function LoginPage() {
  const { t } = await getT();
  return (
    <main className="login">
      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div className="brand">
            <Logo size={34} />
            <div>
              {t('app.name')}
              <small>{t('admin.login.title')}</small>
            </div>
          </div>
          <LangSwitch label={t('admin.language')} />
        </div>
        <LoginForm
          dev={IS_DEV}
          labels={{
            email: t('admin.login.email'),
            password: t('admin.login.password'),
            totp: t('admin.login.totp'),
            submit: t('admin.login.submit'),
            devFill: t('admin.login.devFill'),
            devHint: t('admin.login.devHint'),
          }}
        />
      </div>
    </main>
  );
}
