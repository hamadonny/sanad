/** App-level behaviours: biometric lock on open/resume, notification taps, push registration. */
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AppState, View } from 'react-native';
import { useAuth } from '../lib/auth';
import { authenticate, biometricsAvailable } from '../lib/biometrics';
import { registerForPush } from '../lib/push';
import { useSettings } from '../lib/settings';
import { useTheme } from '../lib/theme';
import { Button, T } from './ui';

const RELOCK_AFTER_MS = 30_000;

export function BiometricGate() {
  const { t } = useTranslation();
  const { c } = useTheme();
  const signedIn = useAuth((s) => s.status === 'signedIn');
  const enabled = useSettings((s) => s.biometricLock);
  const [locked, setLocked] = useState(false);
  const backgroundAt = useRef<number | null>(null);

  const unlock = async () => {
    if (await authenticate(t('lock.prompt'), t('common.cancel'))) setLocked(false);
  };

  useEffect(() => {
    void (async () => {
      if (signedIn && enabled && (await biometricsAvailable())) {
        setLocked(true);
        void unlock();
      }
    })();
    // Lock on cold start only once per mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'background') backgroundAt.current = Date.now();
      if (
        s === 'active' &&
        backgroundAt.current &&
        Date.now() - backgroundAt.current > RELOCK_AFTER_MS
      ) {
        backgroundAt.current = null;
        void (async () => {
          if (
            useAuth.getState().status === 'signedIn' &&
            useSettings.getState().biometricLock &&
            (await biometricsAvailable())
          ) {
            setLocked(true);
            void unlock();
          }
        })();
      }
    });
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!locked) return null;
  return (
    <View
      style={{
        position: 'absolute',
        top: 0,
        bottom: 0,
        left: 0,
        right: 0,
        backgroundColor: c.background,
        alignItems: 'center',
        justifyContent: 'center',
        gap: 24,
        padding: 32,
      }}
      testID="lock-screen"
    >
      <T variant="display" center>
        {t('app.name')}
      </T>
      <T variant="h2" center>
        {t('lock.title')}
      </T>
      <Button title={t('lock.unlock')} onPress={() => void unlock()} testID="unlock" />
    </View>
  );
}

export function NotificationRouter() {
  const signedIn = useAuth((s) => s.status === 'signedIn');
  const asked = useSettings((s) => s.askedNotifications);
  useEffect(() => {
    if (signedIn && asked) void registerForPush(false);
  }, [signedIn, asked]);
  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener(() =>
      router.push('/notifications'),
    );
    return () => sub.remove();
  }, []);
  return null;
}
