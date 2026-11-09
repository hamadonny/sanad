import type { CircleSummary } from '@sanad/api-client';
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
  EmptyView,
  ErrorView,
  LoadingView,
  Money,
  ProgressBar,
  Row,
  Screen,
  T,
  useFormat,
} from '../../components/ui';
import { api } from '../../lib/api';
import { keys } from '../../lib/query';
import { useTheme } from '../../lib/theme';

const UPCOMING_DAYS = 10;

export default function Home() {
  const { t } = useTranslation();
  const f = useFormat();
  const { c } = useTheme();
  const circles = useQuery({ queryKey: keys.circles, queryFn: api.circles });
  const pending = useQuery({ queryKey: keys.pendingAddenda, queryFn: api.pendingAddenda });
  const [pay, setPay] = useState<PaymentRequest | null>(null);

  const open = (circles.data ?? []).filter((x) => !['CLOSED', 'CANCELLED'].includes(x.status));
  const soon = open.find(
    (x) =>
      x.myPayoutDate &&
      daysUntil(x.myPayoutDate) >= 0 &&
      daysUntil(x.myPayoutDate) <= UPCOMING_DAYS,
  );

  const startPay = (x: CircleSummary) => {
    if (!x.nextDue) return;
    const month = x.nextDue.month;
    setPay({
      title: t('payments.purpose.CONTRIBUTION', { month: f.num(month) }),
      create: (key) => api.payContribution(x.id, month, key),
    });
  };

  return (
    <Screen refreshing={circles.isRefetching} onRefresh={() => void circles.refetch()}>
      <Banner
        title={t('home.trustBanner')}
        body={t('home.trustBody')}
        testID="trust-banner"
      />
      {pending.data?.[0] ? (
        <Card
          tone="primary"
          onPress={() => router.push(`/circle/${pending.data[0]}`)}
          testID="addendum-pending"
        >
          <T variant="h2">{t('contract.pendingBanner')}</T>
        </Card>
      ) : null}
      {soon ? (
        <Card tone="primary" onPress={() => router.push(`/circle/${soon.id}`)}>
          <T variant="h2">{t('home.upcomingPayout')}</T>
          <T>{t('home.upcomingPayoutBody', { date: f.date(soon.myPayoutDate) })}</T>
        </Card>
      ) : null}
      <T variant="title">{t('home.title')}</T>
      {circles.isLoading ? <LoadingView /> : null}
      {circles.isError && !circles.data ? (
        <ErrorView error={circles.error} onRetry={() => void circles.refetch()} />
      ) : null}
      {circles.data && open.length === 0 ? (
        <EmptyView
          title={t('home.noCircles')}
          action={t('home.joinFirst')}
          onAction={() => router.push('/(tabs)/join')}
        />
      ) : null}
      {open.map((x) => (
        <Card
          key={x.id}
          onPress={() => router.push(`/circle/${x.id}`)}
          testID={`circle-card-${x.mySpot ?? 'q'}`}
          accessibilityLabel={f.money(x.monthly)}
        >
          <Row>
            <T variant="h2">{t('join.perMonth', { amount: f.money(x.monthly, false) })}</T>
            <Badge
              label={t(`status.${x.status}`)}
              tone={x.status === 'ACTIVE' ? 'good' : 'primary'}
            />
          </Row>
          {x.status === 'FORMING' ? (
            <>
              <T variant="muted">
                {t('home.joined', { count: f.num(x.joined), total: f.num(x.members) })}
              </T>
              <ProgressBar value={x.joined / x.members} />
            </>
          ) : null}
          {x.status === 'AUCTION' && x.auctionEndsAt ? (
            <T variant="muted">
              {t('home.auctionOpen', { date: f.date(x.auctionEndsAt.slice(0, 10)) })}
            </T>
          ) : null}
          {x.currentMonth ? (
            <T variant="muted">
              {t('home.currentMonth', { current: f.num(x.currentMonth), total: f.num(x.members) })}
            </T>
          ) : null}
          <T>{x.mySpot ? t('home.mySpot', { spot: f.num(x.mySpot) }) : t('home.noSpotYet')}</T>
          {x.nextDue ? (
            <>
              <Row>
                <T variant="muted" style={{ flexShrink: 1 }}>
                  {t('home.nextDue', {
                    month: f.num(x.nextDue.month),
                    date: f.date(x.nextDue.dueDate),
                  })}
                </T>
                <Money value={x.nextDue.amount} variant="h2" color={c.primaryText} />
              </Row>
              <Button
                title={t('home.payNow')}
                onPress={() => startPay(x)}
                testID={`pay-now-${x.mySpot ?? ''}`}
              />
            </>
          ) : null}
        </Card>
      ))}
      <PaymentSheet request={pay} onClose={() => setPay(null)} />
    </Screen>
  );
}

function daysUntil(date: string): number {
  return Math.round((Date.parse(`${date}T00:00:00+03:00`) - Date.now()) / 86_400_000);
}
