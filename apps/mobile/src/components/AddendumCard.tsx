import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api';
import { authenticate } from '../lib/biometrics';
import { errorMessage } from '../lib/errors';
import { openPdf } from '../lib/files';
import { keys, queryClient } from '../lib/query';
import { Button, Card, ErrorText, KeyValue, T, useFormat } from './ui';
import { track } from '../lib/telemetry';

/**
 * Post-draw addendum (spec §8): the member's spot, payout date and schedule, acknowledged once
 * with Face ID / fingerprint. The PDF copy is available any time.
 */
export function AddendumCard({ circleId }: { circleId: string }) {
  const { t } = useTranslation();
  const f = useFormat();
  const [error, setError] = useState<string | null>(null);
  const q = useQuery({ queryKey: keys.addendum(circleId), queryFn: () => api.addendum(circleId) });
  const ack = useMutation({
    mutationFn: async () => {
      const hash = q.data?.documentHash;
      if (!hash || !(await authenticate(t('contract.confirm'), t('common.cancel')))) return null;
      return api.acknowledgeAddendum(circleId, hash);
    },
    onSuccess: (r) => {
      if (!r) return;
      queryClient.setQueryData(keys.addendum(circleId), r);
      track('addendum_confirmed');
      void queryClient.invalidateQueries({ queryKey: keys.pendingAddenda });
      void queryClient.invalidateQueries({ queryKey: keys.signatures });
    },
    onError: (e) => setError(errorMessage(t, e)),
  });
  const a = q.data;
  if (!a) return null;
  return (
    <Card testID="addendum-card">
      <T variant="h2">{t('contract.addendumTitle')}</T>
      <T>
        {t('contract.addendumBody', {
          spot: f.num(a.spot),
          months: f.num(a.months),
          amount: f.money(a.expectedPayout),
          date: f.date(a.payoutDate),
          monthly: f.money(a.monthly),
        })}
      </T>
      {a.holdback.fils !== '0' ? (
        <T variant="small">{t('contract.addendumHoldback', { amount: f.money(a.holdback) })}</T>
      ) : null}
      <KeyValue label={t('common.spot', { n: f.num(a.spot) })} value={f.date(a.payoutDate)} />
      {a.acknowledged ? (
        <T variant="muted" testID="addendum-confirmed">
          {t('contract.confirmed', { date: f.date(a.acknowledgedAt) })}
        </T>
      ) : (
        <Button
          title={t('contract.confirm')}
          loading={ack.isPending}
          onPress={() => ack.mutate()}
          testID="addendum-confirm"
        />
      )}
      <Button
        title={t('contract.download')}
        variant="ghost"
        onPress={() =>
          void openPdf(
            api.addendumUrl(circleId),
            `sanad-addendum-${circleId.slice(0, 8)}.pdf`,
          ).catch((e: unknown) => setError(errorMessage(t, e)))
        }
      />
      {error ? <ErrorText>{error}</ErrorText> : null}
    </Card>
  );
}
