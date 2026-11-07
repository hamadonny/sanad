import { defaultLanguage } from '@sanad/i18n';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { I18nextProvider } from 'react-i18next';
import { initI18n } from '../lib/i18n';

const i18n = initI18n(defaultLanguage);

export default function RootLayout() {
  return (
    <I18nextProvider i18n={i18n}>
      <StatusBar style="auto" />
      <Stack screenOptions={{ headerShown: false }} />
    </I18nextProvider>
  );
}
