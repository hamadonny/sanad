import type { PaymentView } from '@sanad/api-client';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import {
  Badge,
  Button,
  Card,
  EmptyView,
  ErrorView,
  LoadingView,
  Row,
  Screen,
  T,
  useFormat,
} from '../../components/ui';
import { api } from '../../lib/api';
import { errorMessage } from '../../lib/errors';
import { openPdf } from '../../lib/files';
import { keys } from '../../lib/query';
import { useTheme } from '../../lib/theme';
import { track } from '../../lib/telemetry';

const TONE: Record<string, 'good' | 'warn' | 'bad' | 'neutral'> = {
  APPLIED: 'good',
  SUCCEEDED: 'good',
  PENDING: 'warn',
  FAILED: 'bad',
  REFUND_REQUIRED: 'warn',
  REFUNDED: 'neutral',
};

export default function PaymentsTab() {
  const { t } = useTranslation();
  const f = useFormat();
  const { c } = useTheme();
  const q = useQuery({ queryKey: keys.payments, queryFn: api.payments });
  const [error, setError] = useState<string | null>(null);

  const receipt = async (p: PaymentView) => {
    setError(null);
    try {
      await openPdf(api.receiptUrl(p.id), `sanad-receipt-${p.id.slice(0, 8)}.pdf`);
      track('receipt_downloaded');
    } catch (e) {
      setError(errorMessage(t, e));
    }
  };

  if (q.isLoading) return <LoadingView />;
  if (!q.data) return <ErrorView error={q.error} onRetry={() => void q.refetch()} />;
  return (
    <Screen refreshing={q.isRefetching} onRefresh={() => void q.refetch()}>
      <T variant="title">{t('payments.history')}</T>
      {error ? <T color={c.danger}>{error}</T> : null}
      {q.data.length === 0 ? <EmptyView title={t('payments.none')} /> : null}
      {q.data.map((p) => (
        <Card key={p.id} testID={`payment-${p.id}`}>
          <Row>
            <View style={{ flexShrink: 1, gap: 2 }}>
              <T variant="h2">
                {t(`payments.purpose.${p.purpose}`, { month: f.num(p.month ?? '') })}
              </T>
              <T variant="small">{f.date(String(p.createdAt).slice(0, 10))}</T>
            </View>
            <T variant="h2">{f.money(p.amount)}</T>
          </Row>
          <Row>
            <Badge label={t(`status.${p.status}`)} tone={TONE[p.status] ?? 'neutral'} />
            {p.status === 'APPLIED' ? (
              <Button
                title={t('payments.receipt')}
                variant="ghost"
                onPress={() => void receipt(p)}
              />
            ) : null}
          </Row>
        </Card>
      ))}
    </Screen>
  );
}
