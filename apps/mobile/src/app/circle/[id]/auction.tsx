import type { AuctionView } from '@sanad/api-client';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import {
  Badge,
  Button,
  Card,
  ErrorView,
  Field,
  KeyValue,
  LoadingView,
  Row,
  Screen,
  Sheet,
  T,
  useFormat,
} from '../../../components/ui';
import { api } from '../../../lib/api';
import { authenticate } from '../../../lib/biometrics';
import { errorMessage } from '../../../lib/errors';
import { formatCountdown, parseKwdInput } from '../../../lib/format';
import { useDir } from '../../../lib/i18n';
import { invalidateMoney, keys, queryClient } from '../../../lib/query';
import { useSettings } from '../../../lib/settings';
import { useTheme } from '../../../lib/theme';

type Spot = AuctionView['spots'][number];

export default function AuctionScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useTranslation();
  const f = useFormat();
  const { language } = useDir();
  const { c } = useTheme();
  const q = useQuery({
    queryKey: keys.auction(id),
    queryFn: () => api.auction(id),
    refetchInterval: 5_000,
  });
  const [now, setNow] = useState(Date.now());
  const [target, setTarget] = useState<Spot | null>(null);
  const [input, setInput] = useState('');
  useEffect(() => {
    const i = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(i);
  }, []);

  const bid = useMutation({
    mutationFn: async ({ spot, fils }: { spot: number; fils: bigint }) => {
      if (
        useSettings.getState().biometricLock &&
        !(await authenticate(t('auction.confirmTitle'), t('common.cancel')))
      )
        throw new Error('cancelled');
      return api.bid(id, spot, fils.toString());
    },
    onSuccess: async (view) => {
      queryClient.setQueryData(keys.auction(id), view);
      await invalidateMoney();
      setTarget(null);
    },
  });

  if (q.isLoading) return <LoadingView />;
  if (!q.data) return <ErrorView error={q.error} onRetry={() => void q.refetch()} />;
  const a = q.data;
  const leading = a.spots.find((s) => s.myStatus === 'LEADING');
  const pot = BigInt(a.pot.fils);

  const amount = parseKwdInput(input);
  const min = target ? BigInt(target.minNextBid.fils) : 0n;
  const holdback = target ? BigInt(target.myHoldback.fils) : 0n;
  const valid = amount !== null && amount >= min;
  const receive = valid && amount !== null ? pot - amount - holdback : null;

  const open = (s: Spot) => {
    setTarget(s);
    setInput(s.minNextBid.kwd);
    bid.reset();
  };

  return (
    <Screen refreshing={q.isRefetching} onRefresh={() => void q.refetch()}>
      <Stack.Screen options={{ title: t('auction.title') }} />
      <T variant="muted">{t('auction.explainer')}</T>
      {!a.canBid ? (
        <Card tone="warning">
          <T>{t('auction.cannotBid')}</T>
        </Card>
      ) : null}
      {a.spots.map((s) => {
        const left = Date.parse(s.endsAt) - now;
        return (
          <Card key={s.spot} testID={`auction-spot-${s.spot}`}>
            <Row>
              <T variant="h2">{t('common.spot', { n: f.num(s.spot) })}</T>
              {s.myStatus !== 'NONE' ? (
                <Badge
                  label={t(`auction.my.${s.myStatus}`)}
                  tone={s.myStatus === 'LEADING' || s.myStatus === 'WON' ? 'good' : 'warn'}
                />
              ) : null}
            </Row>
            <KeyValue
              label={t('auction.highest')}
              value={s.highestBid ? f.money(s.highestBid) : t('auction.noBids')}
              strong
            />
            <KeyValue label={t('auction.minNext')} value={f.money(s.minNextBid)} />
            <KeyValue
              label={t('auction.timeLeft')}
              value={f.num(formatCountdown(left, language))}
            />
            {!s.closed && left > 0 && a.canBid && s.myStatus !== 'LEADING' ? (
              <Button
                title={t('auction.placeBid', { spot: f.num(s.spot) })}
                onPress={() => open(s)}
                testID={`bid-spot-${s.spot}`}
              />
            ) : null}
          </Card>
        );
      })}

      {a.winners.length > 0 ? (
        <Card>
          <T variant="h2">{t('auction.resultsTitle')}</T>
          {a.winners.map((w) => (
            <KeyValue
              key={w.spot}
              label={`${t('common.spot', { n: f.num(w.spot) })}${w.isMe ? ` · ${t('circle.you')}` : ''}`}
              value={f.money(w.amount)}
            />
          ))}
        </Card>
      ) : null}

      <Sheet
        visible={target !== null}
        onClose={() => setTarget(null)}
        title={t('auction.confirmTitle')}
        testID="bid-sheet"
      >
        {target ? (
          <View style={{ gap: 12 }}>
            <Field
              label={t('auction.yourBid')}
              value={input}
              onChangeText={setInput}
              keyboardType="decimal-pad"
              testID="bid-input"
              error={!valid && input ? t('auction.tooLow') : undefined}
            />
            <T variant="small">
              {t('auction.minNext')}: {f.money(target.minNextBid)}
            </T>
            {receive !== null && amount !== null ? (
              <Card tone="primary">
                <T testID="bid-preview">
                  {t('auction.preview', {
                    spot: f.num(target.spot),
                    bid: f.money(amount, false),
                    receive: f.money(receive, false),
                  })}
                </T>
                {holdback > 0n ? (
                  <T variant="small">
                    {t('auction.previewHoldback', { holdback: f.money(holdback, false) })}
                  </T>
                ) : null}
                <T variant="small">{t('auction.confirmBody', { bid: f.money(amount, false) })}</T>
              </Card>
            ) : null}
            {leading && leading.spot !== target.spot ? (
              <T color={c.warning}>{t('auction.switchWarning', { spot: f.num(leading.spot) })}</T>
            ) : null}
            {bid.error && (bid.error as Error).message !== 'cancelled' ? (
              <T color={c.danger}>{errorMessage(t, bid.error)}</T>
            ) : null}
            <Button
              title={
                amount !== null ? `${t('common.confirm')} ${f.money(amount)}` : t('common.confirm')
              }
              disabled={!valid}
              loading={bid.isPending}
              onPress={() => amount !== null && bid.mutate({ spot: target.spot, fils: amount })}
              testID="bid-confirm"
            />
          </View>
        ) : null}
      </Sheet>
    </Screen>
  );
}
