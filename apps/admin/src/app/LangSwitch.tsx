import { switchLanguage } from './session-actions';

export function LangSwitch({ label }: { label: string }) {
  return (
    <form action={switchLanguage}>
      <button type="submit" className="linkish" lang={label === 'English' ? 'en' : 'ar'}>
        {label}
      </button>
    </form>
  );
}
