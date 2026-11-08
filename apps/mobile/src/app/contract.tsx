import { useQuery } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Badge, Card, ErrorView, LoadingView, Screen, T, useFormat } from '../components/ui';
import { api } from '../lib/api';
import { useDir } from '../lib/i18n';
import { keys } from '../lib/query';

/** Agreement view [LEGAL]: text comes from the server (versioned), never hard-coded. */
export default function ContractScreen() {
  const { t } = useTranslation();
  const f = useFormat();
  const { language } = useDir();
  const q = useQuery({ queryKey: keys.contract, queryFn: api.contract });
  if (q.isLoading) return <LoadingView />;
  if (!q.data) return <ErrorView error={q.error} onRetry={() => void q.refetch()} />;
  const c = q.data;
  return (
    <Screen>
      <Stack.Screen options={{ title: t('circle.contract') }} />
      <T variant="title">{language === 'ar' ? c.titleAr : c.titleEn}</T>
      <Badge
        label={`v${f.num(c.version)}${c.signed ? ' ✓' : ''}`}
        tone={c.signed ? 'good' : 'neutral'}
      />
      <Card>
        <T>{language === 'ar' ? c.bodyAr : c.bodyEn}</T>
      </Card>
      {language === 'ar' ? (
        <Card>
          <T variant="muted">{c.bodyEn}</T>
        </Card>
      ) : null}
      <T variant="small">SHA-256 {c.sha256}</T>
    </Screen>
  );
}
