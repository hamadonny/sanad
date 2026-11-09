import { useQuery } from '@tanstack/react-query';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { PaymentSheet, type PaymentRequest } from '../../components/PaymentSheet';
import {
  Banner,
  Button,
  Card,
  Choice,
  Divider,
  ErrorView,
  Field,
  KeyValue,
  LoadingView,
  Row,
  Screen,
  Sheet,
  T,
  Toggle,
  useFormat,
  ErrorText,
} from '../../components/ui';
import { api } from '../../lib/api';
import { errorMessage } from '../../lib/errors';
import { openPdf } from '../../lib/files';
import { useDir } from '../../lib/i18n';
import { keys, queryClient } from '../../lib/query';
import { track } from '../../lib/telemetry';

/** Calculator → spot choice → agreement → membership fee (spec §9.1 "Join a circle"). */
export default function JoinAmount() {
  const { t } = useTranslation();
  const f = useFormat();
  const { language } = useDir();
  const { monthly } = useLocalSearchParams<{ monthly: string }>();
  const options = useQuery({ queryKey: keys.options, queryFn: api.options });
  const contract = useQuery({ queryKey: keys.contract, queryFn: api.contract });
  useEffect(() => track('join_viewed'), []);
  const [mode, setMode] = useState<'random' | 'priority'>('random');
  const [showContract, setShowContract] = useState(false);
  const [agree, setAgree] = useState(false);
  const [codeSent, setCodeSent] = useState(false);
  const [code, setCode] = useState('');
  const [devCode, setDevCode] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [pay, setPay] = useState<PaymentRequest | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (options.isLoading || contract.isLoading) return <LoadingView />;
  const opt = options.data?.options.find((o) => o.monthly.fils === monthly);
  if (!opt || !contract.data)
    return (
      <ErrorView error={options.error ?? contract.error} onRetry={() => void options.refetch()} />
    );
  const c = contract.data;

  const sendCode = async () => {
    setError(null);
    setBusy(true);
    try {
      const r = await api.requestSignCode(c.version, language);
      setCodeSent(true);
      setDevCode(r.devCode);
      if (r.devCode) setCode(r.devCode); // development only: SMS is mocked
    } catch (e) {
      setError(errorMessage(t, e));
    } finally {
      setBusy(false);
    }
  };

  const startPayment = async () => {
    setError(null);
    try {
      if (!c.signed) {
        const western = code.replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
        await api.signContract(c.version, western);
        track('contract_signed');
        void queryClient.invalidateQueries({ queryKey: keys.signatures });
      }
      await queryClient.invalidateQueries({ queryKey: keys.contract });
      setShowContract(false);
      setPay({
        title: t('payments.purpose.ORGANIZING_FEE'),
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
          label={t('join.organizingFee')}
          value={f.money(opt.organizingFee)}
          testID="calc-organizing-fee"
        />
        <T variant="small">{t('join.organizingFeeNote')}</T>
      </Card>

      <Card>
        <T variant="h2">{t('join.noGuaranteeTitle')}</T>
        <T variant="small">{t('join.noGuarantee')}</T>
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
      {error ? <ErrorText>{error}</ErrorText> : null}

      <Sheet
        visible={showContract}
        onClose={() => setShowContract(false)}
        title={language === 'ar' ? c.titleAr : c.titleEn}
      >
        {!c.legal.lawyerApproved ? (
          <Banner tone="warning" title={t('contract.placeholder')} />
        ) : null}
        <View style={{ maxHeight: 280 }}>
          <T>{language === 'ar' ? c.bodyAr : c.bodyEn}</T>
        </View>
        <T variant="small" testID="shariah-status">
          {c.legal.shariah
            ? c.legal.shariah.reviewer
              ? t('contract.shariahBy', {
                  status: t(`contract.statuses.${c.legal.shariah.status}`),
                  reviewer: c.legal.shariah.reviewer,
                })
              : t('contract.shariahStatus', {
                  status: t(`contract.statuses.${c.legal.shariah.status}`),
                })
            : t('contract.shariahNone')}
        </T>
        {c.legal.shariah?.downloadable ? (
          <Button
            title={t('contract.viewShariah')}
            variant="ghost"
            onPress={() =>
              void openPdf(
                api.legalDocUrl(c.legal.shariah?.id ?? ''),
                'sanad-shariah-review.pdf',
                false,
              ).catch((e: unknown) => setError(errorMessage(t, e)))
            }
          />
        ) : null}
        <Toggle label={t('join.agree')} value={agree} onChange={setAgree} testID="contract-agree" />
        {!codeSent ? (
          <Button
            title={t('contract.sendCode')}
            disabled={!agree}
            loading={busy}
            onPress={() => void sendCode()}
            testID="contract-send-code"
          />
        ) : (
          <>
            <T variant="muted">{t('contract.codeSent')}</T>
            {devCode ? (
              <T variant="small">{t('contract.devCode', { code: f.num(devCode) })}</T>
            ) : null}
            <Field
              label={t('contract.codeLabel')}
              value={code}
              onChangeText={setCode}
              keyboardType="number-pad"
              textContentType="oneTimeCode"
              autoComplete="sms-otp"
              maxLength={6}
              testID="contract-code"
              style={{ letterSpacing: 6, textAlign: 'center', fontSize: 20 }}
            />
            <Row>
              <View style={{ flex: 1 }}>
                <Button
                  title={t('join.signAndPay')}
                  disabled={!agree || code.length !== 6}
                  onPress={() => void startPayment()}
                  testID="contract-sign"
                />
              </View>
            </Row>
          </>
        )}
        {error ? <ErrorText>{error}</ErrorText> : null}
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
