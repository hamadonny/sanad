import { useMutation, useQuery } from '@tanstack/react-query';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { PaymentSheet, type PaymentRequest } from '../../../components/PaymentSheet';
import {
  Badge,
  Button,
  Card,
  Divider,
  ErrorView,
  KeyValue,
  LoadingView,
  ProgressBar,
  Row,
  Screen,
  Sheet,
  T,
  useFormat,
} from '../../../components/ui';
import { api } from '../../../lib/api';
import { errorMessage } from '../../../lib/errors';
import { invalidateMoney, keys } from '../../../lib/query';
import { useTheme } from '../../../lib/theme';

const TONE: Record<string, 'good' | 'warn' | 'bad' | 'neutral' | 'primary'> = {
  PAID: 'good',
  REPAID: 'good',
  ADVANCED: 'warn',
  UNPAID: 'neutral',
  WAIVED: 'neutral',
  PAID_OUT: 'good',
  UPCOMING: 'neutral',
  HELD: 'warn',
  VACANT: 'bad',
  RETURNED_TO_FUND: 'neutral',
};

export default function CircleDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useTranslation();
  const f = useFormat();
  const { c } = useTheme();
  const q = useQuery({
    queryKey: keys.circle(id),
    queryFn: () => api.circle(id),
    refetchInterval: 30_000,
  });
  const [pay, setPay] = useState<PaymentRequest | null>(null);
  const [leaving, setLeaving] = useState(false);
  const leave = useMutation({
    mutationFn: () => api.leaveQueue(id),
    onSuccess: async () => {
      await invalidateMoney();
      setLeaving(false);
      router.back();
    },
  });

  if (q.isLoading) return <LoadingView />;
  if (!q.data) return <ErrorView error={q.error} onRetry={() => void q.refetch()} />;
  const d = q.data;
  const me = d.me;
  const late = me?.payments.some((p) => p.status === 'ADVANCED');
  const payable =
    me?.payments.filter((p) => p.status === 'UNPAID' || p.status === 'ADVANCED') ?? [];
  const canPay = d.status === 'ACTIVE' || d.status === 'CLOSING';
  const nextMonth = payable[0]?.month;
  const aheadMonth = payable[1]?.month;

  const startPay = (month: number) =>
    setPay({
      title: t('payments.purpose.CONTRIBUTION', { month: f.num(month) }),
      create: (key) => api.payContribution(id, month, key),
    });

  return (
    <Screen refreshing={q.isRefetching} onRefresh={() => void q.refetch()}>
      <Stack.Screen
        options={{ title: t('join.perMonth', { amount: f.money(d.monthly, false) }) }}
      />
      <Row>
        <T variant="title">{t('join.perMonth', { amount: f.money(d.monthly, false) })}</T>
        <Badge label={t(`status.${d.status}`)} tone="primary" />
      </Row>

      {d.status === 'FORMING' ? (
        <Card>
          <T variant="h2">{t('join.queued')}</T>
          <T>{t('join.queuedBody', { count: f.num(d.joined), total: f.num(d.members) })}</T>
          <ProgressBar value={d.joined / d.members} />
          <Button
            title={t('join.leave')}
            variant="ghost"
            onPress={() => setLeaving(true)}
            testID="leave-circle"
          />
        </Card>
      ) : null}

      {d.status === 'AUCTION' ? (
        <Button
          title={t('circle.goToAuction')}
          onPress={() => router.push(`/circle/${id}/auction`)}
          testID="go-auction"
        />
      ) : null}

      {late ? (
        <Card tone="warning">
          <T>{t('circle.lateNote')}</T>
        </Card>
      ) : null}

      {me && me.spot ? (
        <Card tone="primary">
          <KeyValue label={t('circle.mySpotLabel')} value={f.num(me.spot)} strong />
          <KeyValue
            label={t('circle.expectedPayout')}
            value={f.money(me.payoutAmount.fils !== '0' ? me.payoutAmount : me.expectedPayout)}
            strong
            testID="expected-payout"
          />
          {me.bid.fils !== '0' ? (
            <KeyValue label={t('circle.bid')} value={f.money(me.bid)} />
          ) : null}
          {me.holdbackHeld.fils !== '0' ? (
            <KeyValue label={t('circle.holdback')} value={f.money(me.holdbackHeld)} />
          ) : null}
          {me.expectedRefund.fils !== '0' ? (
            <KeyValue label={t('circle.refund')} value={f.money(me.expectedRefund)} />
          ) : null}
        </Card>
      ) : null}

      {me && me.payments.length > 0 ? (
        <>
          <T variant="h2">{t('circle.myPayments')}</T>
          <Card>
            {me.payments.map((p, i) => (
              <View key={p.month} style={{ gap: 6 }}>
                {i > 0 ? <Divider /> : null}
                <Row>
                  <View style={{ flexShrink: 1, gap: 2 }}>
                    <T>{t('common.month', { n: f.num(p.month) })}</T>
                    <T variant="small">{f.date(p.dueDate)}</T>
                  </View>
                  <Row gap={8} justify="flex-end">
                    <T>{f.money(p.amount)}</T>
                    <Badge label={t(`status.${p.status}`)} tone={TONE[p.status] ?? 'neutral'} />
                  </Row>
                </Row>
              </View>
            ))}
          </Card>
          {canPay && nextMonth !== undefined ? (
            <View style={{ gap: 8 }}>
              <Button
                title={t('circle.pay', { month: f.num(nextMonth) })}
                onPress={() => startPay(nextMonth)}
                testID="pay-next"
              />
              {aheadMonth !== undefined ? (
                <Button
                  title={`${t('circle.payAhead')} — ${t('common.month', { n: f.num(aheadMonth) })}`}
                  variant="secondary"
                  onPress={() => startPay(aheadMonth)}
                  testID="pay-ahead"
                />
              ) : null}
            </View>
          ) : null}
        </>
      ) : null}

      {d.timeline.length > 0 ? (
        <>
          <T variant="h2">{t('circle.timeline')}</T>
          <Card>
            {d.timeline.map((r, i) => (
              <View key={r.month} style={{ gap: 4 }}>
                {i > 0 ? <Divider /> : null}
                <Row>
                  <View style={{ flexShrink: 1 }}>
                    <T variant={r.isMe ? 'h2' : 'body'} color={r.isMe ? c.primary : undefined}>
                      {t('common.month', { n: f.num(r.month) })} ·{' '}
                      {r.isMe ? t('circle.you') : (r.receiver ?? '—')}
                    </T>
                    <T variant="small">{f.date(r.payoutDate)}</T>
                  </View>
                  <Badge label={t(`status.${r.status}`)} tone={TONE[r.status] ?? 'neutral'} />
                </Row>
              </View>
            ))}
          </Card>
        </>
      ) : null}

      {d.commitment ? (
        <Button
          title={t('circle.verify')}
          variant="secondary"
          onPress={() => router.push(`/circle/${id}/verify`)}
          testID="verify-draw"
        />
      ) : null}
      <Button
        title={t('circle.contract')}
        variant="ghost"
        onPress={() => router.push('/contract')}
      />

      <Sheet visible={leaving} onClose={() => setLeaving(false)} title={t('join.leave')}>
        <T>{t('join.leaveConfirm', { amount: f.money(me?.entryFeePaid ?? '0.000', false) })}</T>
        {leave.error ? <T color={c.danger}>{errorMessage(t, leave.error)}</T> : null}
        <Button
          title={t('common.confirm')}
          variant="danger"
          loading={leave.isPending}
          onPress={() => leave.mutate()}
          testID="leave-confirm"
        />
        <Button title={t('common.cancel')} variant="ghost" onPress={() => setLeaving(false)} />
      </Sheet>
      <PaymentSheet request={pay} onClose={() => setPay(null)} />
    </Screen>
  );
}
