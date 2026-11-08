import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { I18nextProvider } from 'react-i18next';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { initI18n } from '../lib/i18n';
import { useSettings } from '../lib/settings';

/** Render with i18n (Arabic by default), React Query and safe-area providers. */
export async function renderWithProviders(
  ui: ReactElement,
  opts: { language?: 'ar' | 'en'; arabicNumerals?: boolean } = {},
) {
  const i18n = initI18n('ar');
  void i18n.changeLanguage(opts.language ?? 'ar');
  useSettings.setState({
    language: opts.language ?? 'ar',
    arabicNumerals: opts.arabicNumerals ?? false,
    biometricLock: true,
    hydrated: true,
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return await render(
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 390, height: 844 },
        insets: { top: 0, left: 0, right: 0, bottom: 0 },
      }}
    >
      <QueryClientProvider client={client}>
        <I18nextProvider i18n={i18n}>{ui}</I18nextProvider>
      </QueryClientProvider>
    </SafeAreaProvider>,
  );
}
