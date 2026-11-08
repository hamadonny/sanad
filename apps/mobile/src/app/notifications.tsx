import { useQuery } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Card, EmptyView, ErrorView, LoadingView, Screen, T, useFormat } from '../components/ui';
import { api } from '../lib/api';
import { keys } from '../lib/query';

export default function NotificationsScreen() {
  const { t } = useTranslation();
  const f = useFormat();
  const q = useQuery({ queryKey: keys.notifications, queryFn: api.notifications });
  if (q.isLoading) return <LoadingView />;
  if (!q.data) return <ErrorView error={q.error} onRetry={() => void q.refetch()} />;
  return (
    <Screen refreshing={q.isRefetching} onRefresh={() => void q.refetch()}>
      <Stack.Screen options={{ title: t('profile.notifications') }} />
      {q.data.length === 0 ? <EmptyView title={t('common.empty')} /> : null}
      {q.data.map((n) => (
        <Card
          key={n.id}
          onPress={() => void (n.readAt ? undefined : api.markRead(n.id).then(() => q.refetch()))}
        >
          <T variant="h2">{(n.readAt ? '' : '• ') + n.title}</T>
          <T>{n.body}</T>
          <T variant="small">{f.date(String(n.createdAt).slice(0, 10))}</T>
        </Card>
      ))}
    </Screen>
  );
}
