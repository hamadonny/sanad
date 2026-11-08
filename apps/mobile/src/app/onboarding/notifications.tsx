import { router, Stack } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Button, Card, Screen, T } from '../../components/ui';
import { registerForPush } from '../../lib/push';
import { useSettings } from '../../lib/settings';

export default function NotificationsPermission() {
  const { t } = useTranslation();
  const done = () => {
    useSettings.getState().set({ askedNotifications: true });
    router.replace('/(tabs)');
  };
  return (
    <Screen>
      <Stack.Screen options={{ title: t('onboarding.notificationsTitle') }} />
      <Card>
        <T variant="display" center>
          🔔
        </T>
        <T variant="title" center>
          {t('onboarding.notificationsTitle')}
        </T>
        <T center>{t('onboarding.notificationsBody')}</T>
      </Card>
      <Button
        title={t('onboarding.enableNotifications')}
        onPress={() => {
          void registerForPush(true).finally(done);
        }}
        testID="notifications-enable"
      />
      <Button
        title={t('onboarding.later')}
        variant="ghost"
        onPress={done}
        testID="notifications-later"
      />
    </Screen>
  );
}
