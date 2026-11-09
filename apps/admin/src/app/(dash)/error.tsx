'use client';
import { useEffect } from 'react';
import { reportClientError } from '../report-error';

/** A dashboard page crashed: report it (scrubbed) and offer a retry. */
export default function DashError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    void reportClientError(
      `${error.name}: ${error.message}`,
      error.stack ?? null,
      error.digest ?? null,
    );
  }, [error]);
  return (
    <div className="banner bad" role="alert">
      <p style={{ marginTop: 0 }}>
        <span lang="ar">حدث خطأ غير متوقع وتم إبلاغ الفريق.</span> /{' '}
        <span lang="en">Something went wrong; the team was notified.</span>
      </p>
      <button className="btn" type="button" onClick={reset}>
        ↻
      </button>
    </div>
  );
}
