import { useQuery } from '@tanstack/react-query';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { PaymentSheet, type PaymentRequest } from '../../components/PaymentSheet';
import {
  Button,
  Card,
  Choice,
  Divider,
  ErrorView,
  KeyValue,
  LoadingView,
  Row,
  Screen,
  Sheet,
  T,
  Toggle,
  useFormat,
} from '../../components/ui';
import { api } from '../../lib/api';
import { errorMessage } from '../../lib/errors';
import { useDir } from '../../lib/i18n';
import { keys, queryClient } from '../../lib/query';

/** Calculator → spot choice → agreement → membership fee (spec §9.1 "Join a circle"). */
export default function JoinAmount() {
  const { t } = useTranslation();
  const f = useFormat();
  const { language } = useDir();
  const { monthly } = useLocalSearchParams<{ monthly: string }>();
  const options = useQuery({ queryKey: keys.options, queryFn: api.options });
  const contract = useQuery({ queryKey: keys.contract, queryFn: api.contract });
  const [mode, setMode] = useState<'random' | 'priority'>('random');
  const [showContract, setShowContract] = useState(false);
  const [agree, setAgree] = useState(false);
  const [pay, setPay] = useState<PaymentRequest | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (options.isLoading || contract.isLoading) return <LoadingView />;
  const opt = options.data?.options.find((o) => o.monthly.fils === monthly);
  if (!opt || !contract.data)
    return (
      <ErrorView error={options.error ?? contract.error} onRetry={() => void options.refetch()} />
    );
  const c = contract.data;

  const startPayment = async () => {
    setError(null);
    try {
      if (!c.signed) await api.signContract(c.version);
      await queryClient.invalidateQueries({ queryKey: keys.contract });
      setShowContract(false);
      setPay({
        title: t('payments.purpose.ENTRY_FEE'),
        create: (key) => api.joinQueue(Number(opt.monthly.kwd.split('.')[0]), key),
      });
    } catch (e) {
      setError(errorMessage(t, e));
    }
  };

  return (
    <Screen
      footer={
        <Button
          title={c.signed ? t('join.payFee') : t('join.reviewContract')}
          onPress={() => (c.signed ? void startPayment() : setShowContract(true))}
          testID="join-continue"
        />
      }
    >
      <Stack.Screen
        options={{ title: t('join.perMonth', { amount: f.money(opt.monthly, false) }) }}
      />
      <T variant="h2">{t('join.calculator')}</T>
      <Card>
        <KeyValue label={t('join.youPay')} value={f.money(opt.monthly)} />
        <KeyValue
          label={t('join.totalPay', { n: f.num(opt.months) })}
          value={f.money(opt.totalContributions)}
        />
        <KeyValue
          label={t('join.youReceive')}
          value={f.money(opt.pot)}
          strong
          testID="calc-receive"
        />
        <Divider />
        <KeyValue
          label={t('join.entryFee')}
          value={f.money(opt.entryFee)}
          testID="calc-entry-fee"
        />
        <T variant="small">{t('join.entryFeeNote')}</T>
      </Card>

      <T variant="h2">{t('join.refundBySpot')}</T>
      <Card>
        {opt.refundBySpot
          .filter((r) => r.refund.fils !== '0')
          .map((r) => (
            <KeyValue
              key={r.spot}
              label={t('common.spot', { n: f.num(r.spot) })}
              value={f.money(r.refund)}
            />
          ))}
        {opt.refundBySpot.findIndex((r) => r.refund.fils !== '0') > 0 ? (
          <T variant="small">
            {t('common.spot', {
              n: `${f.num(1)}–${f.num(opt.refundBySpot.findIndex((r) => r.refund.fils !== '0'))}`,
            })}
            : {f.money('0.000')}
          </T>
        ) : null}
      </Card>

      <T variant="h2">{t('join.spotChoice')}</T>
      <Choice
        title={t('join.random')}
        body={t('join.randomBody')}
        selected={mode === 'random'}
        onPress={() => setMode('random')}
        testID="choice-random"
      />
      <Choice
        title={t('join.priority')}
        body={opt.canBid ? t('join.priorityBody') : t('join.priorityUnavailable')}
        selected={mode === 'priority'}
        onPress={() => setMode('priority')}
        disabled={!opt.canBid}
        testID="choice-priority"
      />
      {mode === 'priority' ? (
        <Card>
          {opt.prioritySpots.map((p) => (
            <View key={p.spot} style={{ gap: 4 }}>
              <T variant="h2">
                {t('join.minBid', { spot: f.num(p.spot), amount: f.money(p.minBid, false) })}
              </T>
              <T variant="muted">
                {t('join.receiveAtMin', { amount: f.money(p.receiveAtMinBid, false) })}
              </T>
              {p.holdback.fils !== '0' ? (
                <T variant="small">
                  {t('join.holdbackNote', { amount: f.money(p.holdback, false) })}
                </T>
              ) : null}
            </View>
          ))}
        </Card>
      ) : null}
      {error ? <T color="#C62828">{error}</T> : null}

      <Sheet
        visible={showContract}
        onClose={() => setShowContract(false)}
        title={language === 'ar' ? c.titleAr : c.titleEn}
      >
        <View style={{ maxHeight: 320 }}>
          <T>{language === 'ar' ? c.bodyAr : c.bodyEn}</T>
        </View>
        <Toggle label={t('join.agree')} value={agree} onChange={setAgree} testID="contract-agree" />
        <Row>
          <View style={{ flex: 1 }}>
            <Button
              title={t('join.signAndPay')}
              disabled={!agree}
              onPress={() => void startPayment()}
              testID="contract-sign"
            />
          </View>
        </Row>
      </Sheet>

      <PaymentSheet
        request={pay}
        onClose={() => {
          setPay(null);
        }}
        onPaid={() => {
          setTimeout(() => router.replace('/(tabs)'), 600);
        }}
      />
    </Screen>
  );
}
