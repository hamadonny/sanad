import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as ImagePicker from 'expo-image-picker';
import { router, Stack } from 'expo-router';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Image, View } from 'react-native';
import { z } from 'zod';
import {
  Button,
  Card,
  ErrorView,
  Field,
  LoadingView,
  Row,
  Screen,
  T,
  ErrorText,
} from '../../components/ui';
import { api } from '../../lib/api';
import { errorMessage } from '../../lib/errors';
import { keys } from '../../lib/query';
import { track } from '../../lib/telemetry';

type Doc = 'front' | 'back' | 'selfie';
type Photo = { uri: string; name: string; type: string };
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export default function KycScreen() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const status = useQuery({ queryKey: keys.kyc, queryFn: api.kycStatus });
  const [photos, setPhotos] = useState<Partial<Record<Doc, Photo>>>({});
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  const schema = z.object({
    fullNameAr: z.string().min(2, t('kyc.required')),
    fullNameEn: z.string().min(2, t('kyc.required')),
    civilIdNumber: z.string().regex(/^\d{12}$/, t('kyc.civilIdInvalid')),
    nationality: z.string().min(2, t('kyc.required')),
    dateOfBirth: z.string().regex(DATE, t('kyc.dateInvalid')),
    civilIdExpiry: z.string().regex(DATE, t('kyc.dateInvalid')),
    address: z.string().min(3, t('kyc.required')),
    employer: z.string().optional(),
    incomeBand: z.string().optional(),
  });
  type Form = z.infer<typeof schema>;
  const { control, handleSubmit, formState } = useForm<Form>({
    resolver: zodResolver(schema),
    defaultValues: {
      fullNameAr: '',
      fullNameEn: '',
      civilIdNumber: '',
      nationality: 'KW',
      dateOfBirth: '',
      civilIdExpiry: '',
      address: '',
      employer: '',
      incomeBand: '',
    },
  });

  const take = async (doc: Doc) => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    const opts: ImagePicker.ImagePickerOptions = {
      quality: 0.6,
      mediaTypes: ['images'],
      ...(doc === 'selfie' ? { cameraType: ImagePicker.CameraType.front } : {}),
    };
    const res = perm.granted
      ? await ImagePicker.launchCameraAsync(opts)
      : await ImagePicker.launchImageLibraryAsync(opts);
    const a = res.canceled ? undefined : res.assets[0];
    if (a)
      setPhotos((p) => ({
        ...p,
        [doc]: { uri: a.uri, name: `${doc}.jpg`, type: a.mimeType ?? 'image/jpeg' },
      }));
  };

  const submit = handleSubmit(async (values) => {
    setError(null);
    try {
      const fields = Object.fromEntries(
        Object.entries(values).filter(([, v]) => v !== undefined && v !== ''),
      ) as Record<string, string>;
      await api.submitKyc(fields, photos);
      track('kyc_submitted');
      await qc.invalidateQueries({ queryKey: keys.kyc });
      await qc.invalidateQueries({ queryKey: keys.me });
      setEditing(false);
    } catch (e) {
      setError(errorMessage(t, e));
    }
  });

  if (status.isLoading) return <LoadingView />;
  if (status.isError)
    return <ErrorView error={status.error} onRetry={() => void status.refetch()} />;
  const s = status.data?.status ?? 'NONE';

  if (s === 'APPROVED' || (s === 'PENDING_REVIEW' && !editing)) {
    return (
      <Screen>
        <Stack.Screen options={{ title: t('kyc.title') }} />
        <Card tone={s === 'APPROVED' ? 'primary' : undefined}>
          <T variant="title" center>
            {s === 'APPROVED' ? '✓' : '⏳'}
          </T>
          <T variant="h2" center testID="kyc-status">
            {s === 'APPROVED' ? t('kyc.approvedTitle') : t('kyc.pendingTitle')}
          </T>
          {s === 'PENDING_REVIEW' ? <T center>{t('kyc.pendingBody')}</T> : null}
        </Card>
        <Button
          title={t('common.continue')}
          onPress={() => router.replace('/')}
          testID="kyc-continue"
        />
      </Screen>
    );
  }

  const field = (name: keyof Form, label: string, extra: Record<string, unknown> = {}) => (
    <Controller
      control={control}
      name={name}
      render={({ field: f }) => (
        <Field
          label={label}
          value={f.value ?? ''}
          onChangeText={f.onChange}
          error={formState.errors[name]?.message}
          testID={`kyc-${name}`}
          {...extra}
        />
      )}
    />
  );

  return (
    <Screen>
      <Stack.Screen options={{ title: t('kyc.title') }} />
      <T variant="title">{t('kyc.title')}</T>
      <T variant="muted">{t('kyc.intro')}</T>
      {s === 'REJECTED' ? (
        <Card tone="warning">
          <T variant="h2">{t('kyc.rejectedTitle')}</T>
          <T>{t('kyc.rejectedBody', { reason: status.data?.lastSubmission?.reason ?? '' })}</T>
        </Card>
      ) : null}
      {field('fullNameAr', t('kyc.fullNameAr'))}
      {field('fullNameEn', t('kyc.fullNameEn'), { autoCapitalize: 'words' })}
      {field('civilIdNumber', t('kyc.civilId'), { keyboardType: 'number-pad', maxLength: 12 })}
      {field('nationality', t('kyc.nationality'), { autoCapitalize: 'characters', maxLength: 3 })}
      {field('dateOfBirth', t('kyc.dateOfBirth'), { placeholder: '1990-01-31', maxLength: 10 })}
      {field('civilIdExpiry', t('kyc.civilIdExpiry'), { placeholder: '2030-01-31', maxLength: 10 })}
      {field('address', t('kyc.address'))}
      {field('employer', t('kyc.employer'))}
      {field('incomeBand', t('kyc.incomeBand'))}

      <T variant="h2">{t('kyc.documents')}</T>
      {(['front', 'back', 'selfie'] as const).map((doc) => (
        <Card key={doc}>
          <Row>
            <T style={{ flexShrink: 1 }}>{t(`kyc.${doc}`)}</T>
            <Button
              title={photos[doc] ? t('kyc.retake') : t('kyc.takePhoto')}
              variant="secondary"
              onPress={() => void take(doc)}
              testID={`kyc-photo-${doc}`}
            />
          </Row>
          {photos[doc] ? (
            <Image
              source={{ uri: photos[doc]?.uri }}
              style={{ width: '100%', height: 140, borderRadius: 8 }}
              accessibilityIgnoresInvertColors
            />
          ) : null}
        </Card>
      ))}
      {error ? <ErrorText>{error}</ErrorText> : null}
      <View>
        <Button
          title={t('kyc.submit')}
          onPress={() => void submit()}
          loading={formState.isSubmitting}
          testID="kyc-submit"
        />
      </View>
    </Screen>
  );
}
