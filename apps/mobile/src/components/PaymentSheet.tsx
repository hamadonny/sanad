/**
 * Every money action goes through this sheet (spec §9.2): the server creates the payment
 * intent first, so the member confirms the exact amounts (3 decimals) the server will charge,
 * then confirms with Face ID / fingerprint, then pays at the gateway.
 *
 * Phases 2–6 use the mock gateway: "Pay" simulates the gateway's confirmation (dev endpoint).
 */
import { newIdempotencyKey, type IntentResponse } from '@sanad/api-client';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { api, isMockCheckout } from '../lib/api';
import { authenticate } from '../lib/biometrics';
import { errorMessage } from '../lib/errors';
import { invalidateMoney } from '../lib/query';
import { useSettings } from '../lib/settings';
import { Button, Divider, KeyValue, LoadingView, Sheet, T, useFormat } from './ui';
import { track } from '../lib/telemetry';

export interface PaymentRequest {
  /** Human description shown at the top (e.g. "Month 3 payment"). */
  title: string;
  /** Creates the intent; receives a stable idempotency key for this sheet. */
  create: (idempotencyKey: string) => Promise<IntentResponse>;
}

type Phase = 'creating' | 'review' | 'paying' | 'done' | 'error';

export function PaymentSheet({
  request,
  onClose,
  onPaid,
}: {
  request: PaymentRequest | null;
  onClose: () => void;
  onPaid?: () => void;
}) {
  const { t } = useTranslation();
  const f = useFormat();
  const biometricLock = useSettings((s) => s.biometricLock);
  const key = useMemo(() => (request ? newIdempotencyKey() : ''), [request]);
  const [phase, setPhase] = useState<Phase>('creating');
  const [intent, setIntent] = useState<IntentResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!request) return;
    setPhase('creating');
    setIntent(null);
    setError(null);
    request
      .create(key)
      .then((i) => {
        setIntent(i);
        track('payment_started');
        setPhase('review');
      })
      .catch((e: unknown) => {
        setError(errorMessage(t, e));
        setPhase('error');
      });
  }, [request, key, t]);

  const pay = async () => {
    if (!intent) return;
    if (biometricLock && !(await authenticate(t('payments.biometricPrompt'), t('common.cancel'))))
      return;
    setPhase('paying');
    try {
      if (isMockCheckout(intent.checkoutUrl)) {
        const p = await api.devConfirm(intent.payment.id);
        if (p.status !== 'APPLIED') throw new Error(p.failureReason ?? p.status);
      } else {
        throw new Error('Real payment gateway arrives in Phase 7');
      }
      await invalidateMoney();
      setPhase('done');
      track('payment_completed');
      onPaid?.();
    } catch (e) {
      setError(errorMessage(t, e));
      setPhase('error');
    }
  };

  const total = intent ? intent.payment.amount : null;

  return (
    <Sheet
      visible={request !== null}
      onClose={onClose}
      title={t('payments.confirmTitle')}
      testID="payment-sheet"
    >
      {phase === 'creating' || phase === 'paying' ? (
        <View>
          <LoadingView />
          {phase === 'paying' ? (
            <T center variant="muted">
              {t('payments.processing')}
            </T>
          ) : null}
        </View>
      ) : null}

      {phase === 'review' && intent && total ? (
        <View style={{ gap: 12 }}>
          <T variant="h2">{request?.title}</T>
          {intent.payment.penalty.fils !== '0' ? (
            <>
              <KeyValue
                label={t('payments.amount')}
                value={f.money(subtract(intent.payment.amount.fils, intent.payment.penalty.fils))}
              />
              <KeyValue label={t('payments.penalty')} value={f.money(intent.payment.penalty)} />
              <Divider />
            </>
          ) : null}
          <KeyValue
            label={t('payments.total')}
            value={f.money(total)}
            strong
            testID="payment-total"
          />
          {isMockCheckout(intent.checkoutUrl) ? (
            <T variant="small">{t('payments.mockGateway')}</T>
          ) : null}
          <Button
            title={`${t('payments.payWithBiometrics')} ${f.money(total)}`}
            onPress={() => void pay()}
            testID="payment-confirm"
          />
          <Button title={t('common.cancel')} variant="ghost" onPress={onClose} />
        </View>
      ) : null}

      {phase === 'done' ? (
        <View style={{ gap: 12 }}>
          <T variant="title" center>
            ✓
          </T>
          <T variant="h2" center testID="payment-success">
            {t('payments.success')}
          </T>
          <Button title={t('common.done')} onPress={onClose} testID="payment-done" />
        </View>
      ) : null}

      {phase === 'error' ? (
        <View style={{ gap: 12 }}>
          <T variant="h2">{error}</T>
          <Button title={t('common.close')} variant="secondary" onPress={onClose} />
        </View>
      ) : null}
    </Sheet>
  );
}

function subtract(a: string, b: string): bigint {
  return BigInt(a) - BigInt(b);
}
