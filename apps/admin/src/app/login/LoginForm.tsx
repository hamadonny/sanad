'use client';
import { useActionState, useRef } from 'react';
import { devTotp, login, type LoginState } from './actions';

export function LoginForm({
  labels,
  dev,
}: {
  labels: Record<'email' | 'password' | 'totp' | 'submit' | 'devFill' | 'devHint', string>;
  dev: boolean;
}) {
  const [state, action, pending] = useActionState<LoginState, FormData>(login, null);
  const email = useRef<HTMLInputElement>(null);
  const totp = useRef<HTMLInputElement>(null);
  return (
    <form action={action} className="form">
      <label>
        {labels.email}
        <input ref={email} name="email" type="email" autoComplete="username" required dir="ltr" />
      </label>
      <label>
        {labels.password}
        <input name="password" type="password" autoComplete="current-password" required dir="ltr" />
      </label>
      <label>
        {labels.totp}
        <span className="row">
          <input
            ref={totp}
            name="totp"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="\d{6}"
            maxLength={6}
            required
            dir="ltr"
            style={{ flex: 1, letterSpacing: 4 }}
          />
          {dev ? (
            <button
              type="button"
              className="btn secondary small"
              onClick={async () => {
                const code = await devTotp(email.current?.value ?? '');
                if (code && totp.current) totp.current.value = code;
              }}
            >
              {labels.devFill}
            </button>
          ) : null}
        </span>
      </label>
      {state?.error ? (
        <div className="banner bad" role="alert">
          {state.error}
        </div>
      ) : null}
      <button className="btn" type="submit" disabled={pending}>
        {pending ? '…' : labels.submit}
      </button>
      {dev ? <p className="muted small">{labels.devHint}</p> : null}
    </form>
  );
}
