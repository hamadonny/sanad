'use client';
/**
 * A form bound to a server action that shows the action's result message inline.
 * Works without JavaScript too (plain form post); with JS it stays on the page.
 */
import { startTransition, useActionState, useEffect, useRef, type ReactNode } from 'react';
import { useFormStatus } from 'react-dom';

export type ActionResult = { ok: boolean; message: string } | null;
type Action = (prev: ActionResult, data: FormData) => Promise<ActionResult>;

export function SubmitButton({
  children,
  variant,
  small,
}: {
  children: ReactNode;
  variant?: 'secondary' | 'danger';
  small?: boolean;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      className={`btn ${variant ?? ''} ${small ? 'small' : ''}`}
      disabled={pending}
      aria-busy={pending}
    >
      {pending ? '…' : children}
    </button>
  );
}

export function ActionForm({
  action,
  children,
  className,
  inline,
  resetOnSuccess,
}: {
  action: Action;
  children: ReactNode;
  className?: string | undefined;
  inline?: boolean | undefined;
  resetOnSuccess?: boolean | undefined;
}) {
  const [state, formAction] = useActionState(action, null);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok && resetOnSuccess) ref.current?.reset();
  }, [state, resetOnSuccess]);
  return (
    <form
      ref={ref}
      action={formAction}
      // Keep what the admin typed when the server says no (React would otherwise clear it).
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        startTransition(() => formAction(data));
      }}
      className={className ?? (inline ? 'form-row' : 'form')}
    >
      {children}
      {state ? (
        <span role="status" className={`result ${state.ok ? 'ok' : 'err'}`}>
          {state.message}
        </span>
      ) : null}
    </form>
  );
}
