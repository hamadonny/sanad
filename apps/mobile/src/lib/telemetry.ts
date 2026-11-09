/**
 * Error reports and anonymous usage counts, sent to Sanad's own API (no third-party SDKs).
 * Nothing identifies the member: no user id, phone, device id or IP is sent or stored, and
 * the server scrubs messages again. Usage counts respect the "share usage" setting.
 */
import Constants from 'expo-constants';
import { AppState, Platform } from 'react-native';
import { resolveApiUrl } from './api';
import { useSettings } from './settings';

export type UsageEvent =
  | 'app_open'
  | 'onboarding_language'
  | 'otp_requested'
  | 'signed_in'
  | 'kyc_submitted'
  | 'join_viewed'
  | 'contract_signed'
  | 'payment_started'
  | 'payment_completed'
  | 'bid_placed'
  | 'addendum_confirmed'
  | 'draw_verified'
  | 'receipt_downloaded'
  | 'support_ticket';

const appVersion = Constants.expoConfig?.version ?? '0.0.0';
const platform = Platform.OS;
let queue: UsageEvent[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;

async function post(path: string, body: unknown): Promise<void> {
  try {
    await fetch(`${resolveApiUrl()}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    /* offline: drop silently, telemetry must never bother the member */
  }
}

export function flushUsage(): void {
  if (timer) clearTimeout(timer);
  timer = null;
  if (queue.length === 0) return;
  const events = queue.map((name) => ({ name }));
  queue = [];
  void post('/telemetry/events', { events, platform, appVersion });
}

/** Count an anonymous event (batched, sent every 30 s or when the app goes to background). */
export function track(event: UsageEvent): void {
  if (!useSettings.getState().shareUsage || process.env.NODE_ENV === 'test') return;
  queue.push(event);
  if (queue.length >= 50) flushUsage();
  else timer ??= setTimeout(flushUsage, 30_000);
}

let lastReport = 0;
/** Report an unexpected error (at most one every 5 seconds). */
export function reportError(error: unknown, context?: string): void {
  if (process.env.NODE_ENV === 'test') return;
  const now = Date.now();
  if (now - lastReport < 5_000) return;
  lastReport = now;
  const e = error instanceof Error ? error : new Error(String(error));
  void post('/telemetry/errors', {
    source: 'mobile',
    message: `${e.name}: ${e.message}`.slice(0, 1000),
    stack: e.stack?.slice(0, 6000),
    context: context?.slice(0, 200),
    platform,
    appVersion,
  });
}

let installed = false;
/** Catch errors nobody handled (JS exceptions outside React rendering). */
export function installGlobalErrorHandler(): void {
  if (installed) return;
  installed = true;
  const g = globalThis as {
    ErrorUtils?: {
      getGlobalHandler: () => (e: unknown, fatal?: boolean) => void;
      setGlobalHandler: (h: (e: unknown, fatal?: boolean) => void) => void;
    };
  };
  const prev = g.ErrorUtils?.getGlobalHandler();
  g.ErrorUtils?.setGlobalHandler((e, fatal) => {
    reportError(e, fatal ? 'fatal' : 'global');
    prev?.(e, fatal);
  });
  AppState.addEventListener('change', (s) => {
    if (s !== 'active') flushUsage();
  });
}
