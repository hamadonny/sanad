import { zodResolver } from '@hookform/resolvers/zod';
import { router, Stack } from 'expo-router';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { Button, Field, Screen, T, ErrorText } from '../../components/ui';
import { api } from '../../lib/api';
import { errorMessage } from '../../lib/errors';
import { normalizeKuwaitPhone } from '../../lib/format';
import { queryClient } from '../../lib/query';
import { useDir } from '../../lib/i18n';
import { track } from '../../lib/telemetry';

export default function PhoneScreen() {
  const { t } = useTranslation();
  const { language } = useDir();
  const [error, setError] = useState<string | null>(null);
  const schema = z.object({
    phone: z.string().refine((v) => normalizeKuwaitPhone(v) !== null, t('onboarding.phoneInvalid')),
  });
  const { control, handleSubmit, formState } = useForm<{ phone: string }>({
    resolver: zodResolver(schema),
    defaultValues: { phone: '' },
  });

  const submit = handleSubmit(async ({ phone }) => {
    setError(null);
    const normalized = normalizeKuwaitPhone(phone) as string;
    try {
      const r = await api.requestOtp(normalized, language);
      track('otp_requested');
      if (r.devLogin) {
        // Development only: allow-listed test phone, no SMS code (see DEV_LOGIN_PHONES).
        queryClient.clear();
        await api.devLogin(normalized);
        track('signed_in');
        await api.setLanguage(language).catch(() => undefined);
        router.replace('/');
        return;
      }
      router.push({
        pathname: '/onboarding/otp',
        params: r.devCode ? { phone: normalized, devCode: r.devCode } : { phone: normalized },
      });
    } catch (e) {
      setError(errorMessage(t, e));
    }
  });

  return (
    <Screen>
      <Stack.Screen options={{ title: t('onboarding.phoneTitle') }} />
      <T variant="title">{t('onboarding.phoneTitle')}</T>
      <T variant="muted">{t('onboarding.phoneHint')}</T>
      <Controller
        control={control}
        name="phone"
        render={({ field }) => (
          <Field
            label="+965"
            placeholder={t('onboarding.phonePlaceholder')}
            keyboardType="phone-pad"
            autoComplete="tel"
            textContentType="telephoneNumber"
            value={field.value}
            onChangeText={field.onChange}
            error={formState.errors.phone?.message}
            testID="phone-input"
            maxLength={16}
          />
        )}
      />
      {error ? <ErrorText>{error}</ErrorText> : null}
      <Button
        title={t('onboarding.sendCode')}
        onPress={() => void submit()}
        loading={formState.isSubmitting}
        testID="phone-submit"
      />
    </Screen>
  );
}
