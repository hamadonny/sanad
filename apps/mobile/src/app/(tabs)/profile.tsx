import { useMutation, useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
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
  Toggle,
  useFormat,
} from '../../components/ui';
import { api } from '../../lib/api';
import { biometricsAvailable } from '../../lib/biometrics';
import { errorMessage } from '../../lib/errors';
import { changeLanguage, useDir } from '../../lib/i18n';
import { keys, queryClient } from '../../lib/query';
import { useSettings } from '../../lib/settings';
import { useTheme } from '../../lib/theme';

export default function ProfileTab() {
  const { t } = useTranslation();
  const f = useFormat();
  const { c } = useTheme();
  const { language } = useDir();
  const settings = useSettings();
  const me = useQuery({ queryKey: keys.me, queryFn: api.me });
  const [bioAvailable, setBioAvailable] = useState(false);
  const [deleting, setDeleting] = useState(false);
  useEffect(() => {
    void biometricsAvailable().then(setBioAvailable);
  }, []);
  const del = useMutation({
    mutationFn: api.deleteAccount,
    onSuccess: async () => {
      await signOut();
    },
  });

  const signOut = async () => {
    await api.logout();
    queryClient.clear();
    router.replace('/');
  };

  const setLang = async (l: 'ar' | 'en') => {
    await api.setLanguage(l).catch(() => undefined);
    await changeLanguage(l);
  };

  if (me.isLoading) return <LoadingView />;
  if (!me.data) return <ErrorView error={me.error} onRetry={() => void me.refetch()} />;
  const m = me.data;
  const tierKey = m.trust.banned || m.trust.tier === null ? 'banned' : `t${m.trust.tier}`;
  const next = m.trust.nextTier;

  return (
    <Screen refreshing={me.isRefetching} onRefresh={() => void me.refetch()}>
      <T variant="title">{(language === 'ar' ? m.fullNameAr : m.fullNameEn) ?? f.num(m.phone)}</T>
      <Card tone="primary">
        <Row>
          <T variant="h2">{t('profile.tier')}</T>
          <Badge
            label={t(`profile.tierName.${tierKey}`)}
            tone={m.trust.banned ? 'bad' : 'primary'}
          />
        </Row>
        {next ? (
          <>
            <ProgressBar
              value={
                m.trust.completedCircles /
                Math.max(1, m.trust.completedCircles + next.completedCirclesNeeded)
              }
            />
            <T variant="muted">
              {t('profile.nextTier', { n: f.num(next.completedCirclesNeeded) })}
            </T>
          </>
        ) : !m.trust.banned ? (
          <T variant="muted">{t('profile.topTier')}</T>
        ) : null}
        <Divider />
        <KeyValue label={t('profile.completed')} value={f.num(m.trust.completedCircles)} />
        <KeyValue
          label={t('profile.onTime')}
          value={m.onTimeRate === null ? '—' : `${f.num(Math.round(m.onTimeRate * 100))}%`}
          testID="on-time-rate"
        />
        <KeyValue label={t('profile.late')} value={f.num(m.trust.latePayments)} />
      </Card>

      <Card>
        <T variant="h2">{t('profile.language')}</T>
        <Row justify="flex-start">
          <Button
            title="العربية"
            variant={language === 'ar' ? 'primary' : 'secondary'}
            onPress={() => void setLang('ar')}
            testID="profile-lang-ar"
          />
          <Button
            title="English"
            variant={language === 'en' ? 'primary' : 'secondary'}
            onPress={() => void setLang('en')}
            testID="profile-lang-en"
          />
        </Row>
        <T variant="small">{t('profile.restartNote')}</T>
        <Divider />
        <Toggle
          label={t('profile.arabicNumerals')}
          value={settings.arabicNumerals}
          onChange={(v) => settings.set({ arabicNumerals: v })}
          testID="toggle-numerals"
        />
        <Toggle
          label={t('profile.hijri')}
          value={settings.hijri}
          onChange={(v) => settings.set({ hijri: v })}
        />
        {bioAvailable ? (
          <Toggle
            label={t('profile.biometrics')}
            value={settings.biometricLock}
            onChange={(v) => settings.set({ biometricLock: v })}
          />
        ) : null}
        <Toggle
          label={t('profile.shareUsage')}
          value={settings.shareUsage}
          onChange={(v) => settings.set({ shareUsage: v })}
          testID="share-usage"
        />
        <T variant="small">{t('profile.shareUsageNote')}</T>
      </Card>

      <Card>
        <Button
          title={t('profile.notifications')}
          variant="ghost"
          onPress={() => router.push('/notifications')}
        />
        <Button
          title={t('profile.support')}
          variant="ghost"
          onPress={() => router.push('/support')}
          testID="open-support"
        />
        <Button
          title={t('profile.legal')}
          variant="ghost"
          onPress={() => router.push('/contract')}
        />
        <Button
          title={t('profile.signOut')}
          variant="secondary"
          onPress={() => void signOut()}
          testID="sign-out"
        />
        <Button
          title={t('profile.deleteAccount')}
          variant="ghost"
          onPress={() => setDeleting(true)}
          testID="delete-account"
        />
      </Card>
      <T variant="small" center>
        {f.num(m.phone)} · {api.baseUrl}
      </T>

      <Sheet
        visible={deleting}
        onClose={() => setDeleting(false)}
        title={t('profile.deleteAccount')}
      >
        {m.inOpenCircle ? (
          <>
            <T testID="delete-blocked">{t('profile.deleteBlocked')}</T>
            <Button
              title={t('common.close')}
              variant="secondary"
              onPress={() => setDeleting(false)}
            />
          </>
        ) : (
          <>
            <T>{t('profile.deleteConfirm')}</T>
            {del.error ? <T color={c.danger}>{errorMessage(t, del.error)}</T> : null}
            <Button
              title={t('profile.deleteAccount')}
              variant="danger"
              loading={del.isPending}
              onPress={() => del.mutate()}
            />
            <Button title={t('common.cancel')} variant="ghost" onPress={() => setDeleting(false)} />
          </>
        )}
      </Sheet>
    </Screen>
  );
}
