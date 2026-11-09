'use server';
import { API_URL } from '../lib/config';

/** Forward a dashboard crash to the API's monitoring (the API scrubs personal data). */
export async function reportClientError(
  message: string,
  stack: string | null,
  digest: string | null,
) {
  try {
    await fetch(`${API_URL}/telemetry/errors`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: 'admin',
        message: message.slice(0, 1000),
        ...(stack ? { stack: stack.slice(0, 6000) } : {}),
        ...(digest ? { context: `digest ${digest}`.slice(0, 200) } : {}),
        platform: 'web',
      }),
    });
  } catch {
    /* best effort */
  }
}
