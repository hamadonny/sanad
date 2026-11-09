import { useQuery } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Badge,
  Banner,
  Button,
  Card,
  ErrorText,
  ErrorView,
  LoadingView,
  Screen,
  T,
  useFormat,
} from '../components/ui';
import { api } from '../lib/api';
import { errorMessage } from '../lib/errors';
import { openPdf } from '../lib/files';
import { useDir } from '../lib/i18n';
import { keys } from '../lib/query';

/**
 * Agreement [LEGAL]: text comes from the server (versioned), never hard-coded. Shows whether the
 * lawyer's final text and the Shariah review are in, and the member's signed PDFs.
 */
export default function ContractScreen() {
  const { t } = useTranslation();
  const f = useFormat();
  const { language } = useDir();
  const [error, setError] = useState<string | null>(null);
  const q = useQuery({ queryKey: keys.contract, queryFn: api.contract });
  const sigs = useQuery({ queryKey: keys.signatures, queryFn: api.signatures });
  if (q.isLoading) return <LoadingView />;
  if (!q.data) return <ErrorView error={q.error} onRetry={() => void q.refetch()} />;
  const c = q.data;
  const shariah = c.legal.shariah;
  const open = (url: string, name: string, auth = true) =>
    void openPdf(url, name, auth).catch((e: unknown) => setError(errorMessage(t, e)));
  return (
    <Screen>
      <Stack.Screen options={{ title: t('circle.contract') }} />
      <T variant="title">{language === 'ar' ? c.titleAr : c.titleEn}</T>
      <Badge
        label={`v${f.num(c.version)}${c.signed ? ' ✓' : ''}`}
        tone={c.signed ? 'good' : 'neutral'}
      />
      {!c.legal.lawyerApproved ? <Banner tone="warning" title={t('contract.placeholder')} /> : null}
      <T variant="muted" testID="shariah-status">
        {shariah
          ? shariah.reviewer
            ? t('contract.shariahBy', {
                status: t(`contract.statuses.${shariah.status}`),
                reviewer: shariah.reviewer,
              })
            : t('contract.shariahStatus', { status: t(`contract.statuses.${shariah.status}`) })
          : t('contract.shariahNone')}
      </T>
      {shariah?.downloadable ? (
        <Button
          title={t('contract.viewShariah')}
          variant="ghost"
          onPress={() => open(api.legalDocUrl(shariah.id), 'sanad-shariah-review.pdf', false)}
        />
      ) : null}
      <Card>
        <T>{language === 'ar' ? c.bodyAr : c.bodyEn}</T>
      </Card>
      {language === 'ar' ? (
        <Card>
          <T variant="muted">{c.bodyEn}</T>
        </Card>
      ) : null}
      <T variant="small">SHA-256 {c.sha256}</T>

      <T variant="h2">{t('contract.documents')}</T>
      {sigs.data && sigs.data.length === 0 ? (
        <T variant="muted">{t('contract.noDocuments')}</T>
      ) : null}
      {sigs.data?.map((s) => (
        <Card key={s.id} testID={`signature-${s.id}`}>
          <T variant="h2">
            {s.kind === 'MEMBERSHIP'
              ? t('contract.membership', { v: f.num(s.contractVersion ?? '') })
              : t('contract.addendum')}
          </T>
          <T variant="small">{t('contract.signedOn', { date: f.date(s.signedAt) })}</T>
          <Button
            title={t('contract.download')}
            variant="ghost"
            onPress={() =>
              open(api.signatureUrl(s.id), `sanad-${s.kind.toLowerCase()}-${s.id.slice(0, 8)}.pdf`)
            }
          />
        </Card>
      ))}
      {error ? <ErrorText>{error}</ErrorText> : null}
    </Screen>
  );
}
