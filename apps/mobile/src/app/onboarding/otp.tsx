import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Field, Screen, T, useFormat } from '../../components/ui';
import { api } from '../../lib/api';
import { errorMessage } from '../../lib/errors';
import { useDir } from '../../lib/i18n';
import { queryClient } from '../../lib/query';

export default function OtpScreen() {
  const { t } = useTranslation();
  const f = useFormat();
  const { language } = useDir();
  const { phone } = useLocalSearchParams<{ phone: string }>();
  const [code, setCode] = useState('');
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
          void api.requestOtp(phone, language).catch((e: unknown) => setError(errorMessage(t, e)));
        }}
      />
    </Screen>
  );
}
