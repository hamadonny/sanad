import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo } from 'react';
import { I18nextProvider, useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { BiometricGate, NotificationRouter } from '../components/Gates';
import { useAuth } from '../lib/auth';
import { initI18n, useDir } from '../lib/i18n';
import { persister, queryClient } from '../lib/query';
import { useSettings } from '../lib/settings';
import { useTheme } from '../lib/theme';

function Shell() {
  const { dir } = useDir();
  const { c, scheme } = useTheme();
  const { t } = useTranslation();
  return (
    <View style={{ flex: 1, direction: dir, backgroundColor: c.background }}>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerTitleAlign: 'center',
          headerBackButtonDisplayMode: 'minimal',
          headerStyle: { backgroundColor: c.surface },
          headerTintColor: c.primary,
          headerTitleStyle: { color: c.text },
          contentStyle: { backgroundColor: c.background },
        }}
      >
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="(tabs)" options={{ headerShown: false, title: t('app.name') }} />
        <Stack.Screen name="onboarding/language" options={{ headerShown: false }} />
        <Stack.Screen name="onboarding/welcome" options={{ headerShown: false }} />
        <Stack.Screen
          name="onboarding/notifications"
          options={{ headerBackVisible: false, gestureEnabled: false }}
        />
      </Stack>
      <BiometricGate />
      <NotificationRouter />
    </View>
  );
}

export default function RootLayout() {
  const hydrated = useSettings((s) => s.hydrated);
  const language = useSettings((s) => s.language);
  const authLoading = useAuth((s) => s.status === 'loading');
  useEffect(() => {
    void useAuth.getState().load();
  }, []);
  const i18n = useMemo(() => (hydrated ? initI18n(language ?? 'ar') : null), [hydrated, language]);
  if (!i18n || authLoading) return null;
  return (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{ persister, maxAge: 7 * 24 * 3600_000 }}
    >
      <I18nextProvider i18n={i18n}>
        <SafeAreaProvider>
          <Shell />
        </SafeAreaProvider>
      </I18nextProvider>
    </PersistQueryClientProvider>
  );
}
