import { useMutation, useQuery } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking } from 'react-native';
import { Button, Card, Field, Row, Screen, T } from '../components/ui';
import { api } from '../lib/api';
import { errorMessage } from '../lib/errors';
import { useDir } from '../lib/i18n';
import { keys } from '../lib/query';
import { useTheme } from '../lib/theme';
import { track } from '../lib/telemetry';

/** Support contacts come from app config (EXPO_PUBLIC_SUPPORT_WHATSAPP / _PHONE). */
const WHATSAPP = process.env.EXPO_PUBLIC_SUPPORT_WHATSAPP ?? '96599302447';
const PHONE = process.env.EXPO_PUBLIC_SUPPORT_PHONE ?? '+96599302447';
const FAQ = ['1', '2', '3', '4', '5'] as const;

export default function SupportScreen() {
  const { t } = useTranslation();
  const { c } = useTheme();
  const { language } = useDir();
  // FAQ is edited in the admin dashboard; the bundled copy is the offline fallback.
  const faq = useQuery({ queryKey: keys.faq, queryFn: api.faq, staleTime: 3600_000 });
  const items =
    faq.data && faq.data.length > 0
      ? faq.data.map((f) => ({
          id: f.id,
          q: language === 'en' ? f.questionEn : f.questionAr,
          a: language === 'en' ? f.answerEn : f.answerAr,
        }))
      : FAQ.map((n) => ({ id: n, q: t(`support.faqItems.q${n}`), a: t(`support.faqItems.a${n}`) }));
  const [open, setOpen] = useState<string | null>(null);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const send = useMutation({
    mutationFn: () => api.supportTicket(subject, body).then((r) => (track('support_ticket'), r)),
    onSuccess: () => (setSubject(''), setBody('')),
  });

  return (
    <Screen>
      <Stack.Screen options={{ title: t('support.title') }} />
      <T variant="h2">{t('support.faq')}</T>
      {items.map((f, i) => (
        <Card
          key={f.id}
          onPress={() => setOpen(open === f.id ? null : f.id)}
          testID={`faq-${i + 1}`}
        >
          <T variant="h2">{f.q}</T>
          {open === f.id ? <T>{f.a}</T> : null}
        </Card>
      ))}
      <T variant="h2">{t('support.contact')}</T>
      <Row>
        <Button
          title={t('support.whatsapp')}
          variant="secondary"
          onPress={() => void Linking.openURL(`https://wa.me/${WHATSAPP}`)}
        />
        <Button
          title={t('support.call')}
          variant="secondary"
          onPress={() => void Linking.openURL(`tel:${PHONE}`)}
        />
      </Row>
      <T variant="h2">{t('support.ticket')}</T>
      <Field
        label={t('support.subject')}
        value={subject}
        onChangeText={setSubject}
        maxLength={140}
      />
      <Field
        label={t('support.message')}
        value={body}
        onChangeText={setBody}
        multiline
        style={{ minHeight: 120, textAlignVertical: 'top' }}
        maxLength={4000}
      />
      {send.isSuccess ? <T color={c.success}>{t('support.sent')}</T> : null}
      {send.error ? <T color={c.danger}>{errorMessage(t, send.error)}</T> : null}
      <Button
        title={t('support.send')}
        disabled={subject.length < 3 || body.length < 3}
        loading={send.isPending}
        onPress={() => send.mutate()}
      />
    </Screen>
  );
}
