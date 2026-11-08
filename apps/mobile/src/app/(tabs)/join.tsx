import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PaymentSheet, type PaymentRequest } from '../../components/PaymentSheet';
import {
  Badge,
  Banner,
  Button,
  Card,
  ErrorView,
  LoadingView,
  Row,
  Screen,
  T,
  useFormat,
} from '../../components/ui';
import { api } from '../../lib/api';
import { keys } from '../../lib/query';

export default function JoinTab() {
  const { t } = useTranslation();
  const f = useFormat();
  const options = useQuery({ queryKey: keys.options, queryFn: api.options });
  const replacements = useQuery({ queryKey: keys.replacements, queryFn: api.replacements });
  const [pay, setPay] = useState<PaymentRequest | null>(null);

  if (options.isLoading) return <LoadingView />;
  if (!options.data)
    return <ErrorView error={options.error} onRetry={() => void options.refetch()} />;
  const o = options.data;

  return (
    <Screen refreshing={options.isRefetching} onRefresh={() => void options.refetch()}>
      {o.kycStatus !== 'APPROVED' ? (
        <Card tone="warning" onPress={() => router.push('/kyc')}>
          <T variant="h2">{t('join.lockReasons.IDENTITY_NOT_VERIFIED')}</T>
        </Card>
      ) : null}
      {o.circuitBreaker === 'TRIPPED' ? (
        <Banner tone="warning" title={t('join.lockReasons.PAUSED_BY_CIRCUIT_BREAKER')} />
      ) : null}
      <T variant="title">{t('join.chooseAmount')}</T>
      {o.options.map((opt) => (
        <Card
          key={opt.monthly.fils}
          {...(opt.available ? { onPress: () => router.push(`/join/${opt.monthly.fils}`) } : {})}
          testID={`amount-${opt.monthly.kwd}`}
          accessibilityLabel={f.money(opt.monthly)}
        >
          <Row>
            <T variant="h2">{t('join.perMonth', { amount: f.money(opt.monthly, false) })}</T>
            {opt.available ? (
              <Badge label={f.money(opt.pot)} tone="good" />
            ) : (
              <Badge label={t('join.locked')} tone="neutral" />
            )}
          </Row>
          {!opt.available
            ? opt.blockers.map((b) => (
                <T key={b} variant="muted">
                  🔒 {t(`join.lockReasons.${b}`)}
                </T>
              ))
            : null}
        </Card>
      ))}

      {replacements.data && replacements.data.length > 0 ? (
        <>
          <T variant="h2">{t('join.replacementsTitle')}</T>
          {replacements.data.map((r) => (
            <Card key={`${r.circleId}-${r.spot}`}>
              <Row>
                <T variant="h2">{t('join.perMonth', { amount: f.money(r.monthly, false) })}</T>
                <Badge label={t('common.spot', { n: f.num(r.spot) })} tone="primary" />
              </Row>
              <Button
                title={t('join.replacementPay', { amount: f.money(r.payNow, false) })}
                disabled={!r.available}
                onPress={() =>
                  setPay({
                    title: t('payments.purpose.REPLACEMENT'),
                    create: (key) => api.payReplacement(r.circleId, r.spot, key),
                  })
                }
              />
            </Card>
          ))}
        </>
      ) : null}
      <PaymentSheet request={pay} onClose={() => setPay(null)} />
    </Screen>
  );
}
