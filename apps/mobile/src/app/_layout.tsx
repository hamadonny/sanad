import {
  ReadexPro_400Regular,
  ReadexPro_500Medium,
  ReadexPro_700Bold,
  useFonts,
} from '@expo-google-fonts/readex-pro';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import * as SplashScreen from 'expo-splash-screen';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo } from 'react';
import { I18nextProvider, useTranslation } from 'react-i18next';
import { Pressable, Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { BiometricGate, NotificationRouter } from '../components/Gates';
import { useAuth } from '../lib/auth';
import { initI18n, useDir } from '../lib/i18n';
import { persister, queryClient } from '../lib/query';
import { useSettings } from '../lib/settings';
import { useTheme } from '../lib/theme';
import { installGlobalErrorHandler, reportError, track } from '../lib/telemetry';

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
          headerTintColor: c.primaryText,
          headerTitleStyle: { color: c.text, fontFamily: 'ReadexPro_700Bold' },
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

void SplashScreen.preventAutoHideAsync().catch(() => undefined);

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    ReadexPro_400Regular,
    ReadexPro_500Medium,
    ReadexPro_700Bold,
  });
  const hydrated = useSettings((s) => s.hydrated);
  const language = useSettings((s) => s.language);
  const authLoading = useAuth((s) => s.status === 'loading');
  useEffect(() => {
    void useAuth.getState().load();
    installGlobalErrorHandler();
  }, []);
  useEffect(() => {
    if (hydrated) track('app_open');
  }, [hydrated]);
  const i18n = useMemo(() => (hydrated ? initI18n(language ?? 'ar') : null), [hydrated, language]);
  const ready = Boolean(i18n) && !authLoading && (fontsLoaded || fontError !== null);
  useEffect(() => {
    if (ready) void SplashScreen.hideAsync().catch(() => undefined);
  }, [ready]);
  if (!ready || !i18n) return null;
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

/**
 * Shown if a screen crashes while rendering: reports the error (no personal data) and offers a
 * retry instead of a blank screen. Plain React Native, so it works even if i18n failed.
 */
export function ErrorBoundary({ error, retry }: { error: Error; retry: () => Promise<void> }) {
  useEffect(() => reportError(error, 'render'), [error]);
  const ar = (useSettings.getState().language ?? 'ar') === 'ar';
  return (
    <View
      style={{
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        gap: 16,
        backgroundColor: '#FFFCF2',
      }}
    >
      <Text style={{ fontSize: 18, fontWeight: '700', color: '#252422', textAlign: 'center' }}>
        {ar ? 'حدث خطأ غير متوقع' : 'Something went wrong'}
      </Text>
      <Text style={{ color: '#5F5A53', textAlign: 'center' }}>
        {ar ? 'أبلغنا الفريق تلقائيًا. حاول مرة أخرى.' : 'We let the team know. Please try again.'}
      </Text>
      <Pressable
        onPress={() => void retry()}
        accessibilityRole="button"
        style={{
          backgroundColor: '#EB5E28',
          paddingHorizontal: 24,
          paddingVertical: 12,
          borderRadius: 12,
        }}
      >
        <Text style={{ color: '#252422', fontWeight: '700' }}>
          {ar ? 'إعادة المحاولة' : 'Try again'}
        </Text>
      </Pressable>
    </View>
  );
}
