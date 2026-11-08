import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Card, Row, T } from '../../components/ui';
import { useSettings } from '../../lib/settings';
import { useTheme } from '../../lib/theme';

const SLIDES = ['s1', 's2', 's3', 's4'] as const;
const ICONS = ['🤝', '🛡️', '⏩', '🎁'];

/** Explains the jamiya, the guarantee, priority spots and patience refunds (spec §9.1). */
export default function Welcome() {
  const { t } = useTranslation();
  const { c } = useTheme();
  const [i, setI] = useState(0);
  const last = i === SLIDES.length - 1;
  const finish = () => {
    useSettings.getState().set({ seenWelcome: true });
    router.replace('/onboarding/phone');
  };
  const s = SLIDES[i] ?? 's1';
  return (
    <SafeAreaView
      style={{
        flex: 1,
        backgroundColor: c.background,
        padding: 24,
        justifyContent: 'space-between',
      }}
    >
      <Row justify="flex-end">
        <Button title={t('common.skip')} variant="ghost" onPress={finish} testID="welcome-skip" />
      </Row>
      <Card>
        <T variant="display" center>
          {ICONS[i]}
        </T>
        <T variant="title" center>
          {t(`onboarding.slides.${s}Title`)}
        </T>
        <T center>{t(`onboarding.slides.${s}Body`)}</T>
      </Card>
      <View style={{ gap: 16 }}>
        <Row justify="center">
          {SLIDES.map((x, k) => (
            <View
              key={x}
              style={{
                width: k === i ? 20 : 8,
                height: 8,
                borderRadius: 4,
                backgroundColor: k === i ? c.primary : c.border,
              }}
            />
          ))}
        </Row>
        <Button
          title={last ? t('onboarding.start') : t('common.next')}
          onPress={() => (last ? finish() : setI(i + 1))}
          testID="welcome-next"
        />
      </View>
    </SafeAreaView>
  );
}
