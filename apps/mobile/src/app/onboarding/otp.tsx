import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Banner, Button, Field, Screen, T, useFormat } from '../../components/ui';
import { api } from '../../lib/api';
import { errorMessage } from '../../lib/errors';
import { useDir } from '../../lib/i18n';
import { queryClient } from '../../lib/query';
import { track } from '../../lib/telemetry';

export default function OtpScreen() {
  const { t } = useTranslation();
  const f = useFormat();
  const { language } = useDir();
  const params = useLocalSearchParams<{ phone: string; devCode?: string }>();
  const phone = params.phone;
  const [devCode, setDevCode] = useState(params.devCode);
  // Development only (mock SMS): the API returns the code, so prefill it.
  const [code, setCode] = useState(params.devCode ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [wait, setWait] = useState(30);

  useEffect(() => {
    const id = setInterval(() => setWait((w) => (w > 0 ? w - 1 : 0)), 1000);
    return () => clearInterval(id);
  }, []);

  const verify = async (value = code) => {
    const western = value.replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
    if (!/^\d{6}$/.test(western)) return setError(t('onboarding.otpInvalid'));
    setBusy(true);
    setError(null);
    try {
      queryClient.clear();
      await api.verifyOtp(phone, western);
      track('signed_in');
      await api.setLanguage(language).catch(() => undefined);
      router.replace('/');
    } catch (e) {
      setError(errorMessage(t, e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Stack.Screen options={{ title: t('onboarding.otpTitle') }} />
      <T variant="title">{t('onboarding.otpTitle')}</T>
      <T variant="muted">{t('onboarding.otpHint', { phone: f.num(phone) })}</T>
      {devCode ? (
        <Banner
          tone="warning"
          title={t('onboarding.devCodeTitle', { code: f.num(devCode) })}
          body={t('onboarding.devCodeBody')}
          testID="dev-code"
        />
      ) : null}
      <Field
        label={t('onboarding.otpTitle')}
        value={code}
        onChangeText={(v) => {
          setCode(v);
          if (v.length === 6) void verify(v);
        }}
        keyboardType="number-pad"
        textContentType="oneTimeCode"
        autoComplete="sms-otp"
        maxLength={6}
        error={error ?? undefined}
        testID="otp-input"
        style={{ letterSpacing: 8, textAlign: 'center', fontSize: 24 }}
      />
      <Button
        title={t('onboarding.verify')}
        onPress={() => void verify()}
        loading={busy}
        testID="otp-submit"
      />
      <Button
        title={wait > 0 ? t('onboarding.resendIn', { s: f.num(wait) }) : t('onboarding.resend')}
        variant="ghost"
        disabled={wait > 0}
        onPress={() => {
          setWait(30);
          api
            .requestOtp(phone, language)
            .then((r) => {
              setDevCode(r.devCode);
              if (r.devCode) setCode(r.devCode);
            })
            .catch((e: unknown) => setError(errorMessage(t, e)));
        }}
      />
    </Screen>
  );
}
