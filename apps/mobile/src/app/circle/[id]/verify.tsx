import { verifyDraw, type DrawVerification } from '@sanad/core';
import { useQuery } from '@tanstack/react-query';
import * as Clipboard from 'expo-clipboard';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Button,
  Card,
  ErrorView,
  KeyValue,
  LoadingView,
  Screen,
  T,
  useFormat,
} from '../../../components/ui';
import { api } from '../../../lib/api';
import { keys } from '../../../lib/query';
import { useTheme } from '../../../lib/theme';
import { track } from '../../../lib/telemetry';

/** "Verify fairness" (spec §5.7): recomputes SHA-256 and the HMAC Fisher–Yates draw on-device. */
export default function VerifyScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useTranslation();
  const f = useFormat();
  const { c } = useTheme();
  const q = useQuery({ queryKey: keys.draw(id), queryFn: () => api.draw(id) });
  const [result, setResult] = useState<DrawVerification | null>(null);

  if (q.isLoading) return <LoadingView />;
  if (!q.data) return <ErrorView error={q.error} onRetry={() => void q.refetch()} />;
  const d = q.data;
  const mine = d.result.find((r) => r.isMe);

  const run = () => {
    if (!d.revealedSeed || !d.commitment) return;
    track('draw_verified');
    setResult(
      verifyDraw({
        seed: d.revealedSeed,
        commitment: d.commitment,
        circleId: d.circleId,
        memberIds: d.memberIds,
        spots: d.spots,
        result: d.result.map(({ memberId, spot }) => ({ memberId, spot })),
      }),
    );
  };

  return (
    <Screen>
      <Stack.Screen options={{ title: t('verify.title') }} />
      <T variant="muted">{t('verify.explainer')}</T>
      <Card>
        <T variant="label">{t('verify.commitment')}</T>
        <T variant="small" style={{ fontFamily: 'monospace' }} testID="commitment">
          {d.commitment ?? '—'}
        </T>
        <T variant="label">{t('verify.seed')}</T>
        <T variant="small" style={{ fontFamily: 'monospace' }}>
          {d.revealedSeed ?? t('verify.notYet')}
        </T>
        {d.revealedSeed ? (
          <Button
            title={t('common.copy')}
            variant="ghost"
            onPress={() =>
              void Clipboard.setStringAsync(`${d.commitment ?? ''}\n${d.revealedSeed ?? ''}`)
            }
          />
        ) : null}
        {mine ? <KeyValue label={t('circle.mySpotLabel')} value={f.num(mine.spot)} strong /> : null}
      </Card>
      <Button
        title={t('verify.run')}
        onPress={run}
        disabled={!d.revealedSeed}
        testID="verify-run"
      />
      {result ? (
        <Card tone={result.ok ? 'primary' : 'warning'}>
          <T variant="h2" color={result.ok ? c.success : c.danger} testID="verify-result">
            {result.ok ? t('verify.ok') : t('verify.fail')}
          </T>
          <T>{result.ok ? t('verify.okBody') : t(`verify.failReasons.${result.reason}`)}</T>
        </Card>
      ) : null}
    </Screen>
  );
}
