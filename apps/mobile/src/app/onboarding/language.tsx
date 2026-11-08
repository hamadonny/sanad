import { router } from 'expo-router';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, T } from '../../components/ui';
import { changeLanguage } from '../../lib/i18n';
import { useTheme } from '../../lib/theme';

/** First launch: language (Arabic default). Labels are shown in both languages on purpose. */
export default function LanguageScreen() {
  const { c } = useTheme();
  const pick = async (lang: 'ar' | 'en') => {
    await changeLanguage(lang);
    router.replace('/onboarding/welcome');
  };
  return (
    <SafeAreaView
      style={{
        flex: 1,
        backgroundColor: c.background,
        justifyContent: 'center',
        padding: 24,
        gap: 32,
      }}
    >
      <View style={{ gap: 8 }}>
        <T variant="display" center>
          سند · Sanad
        </T>
        <T variant="muted" center>
          اختر اللغة · Choose your language
        </T>
      </View>
      <View style={{ gap: 12 }}>
        <Button title="العربية" onPress={() => void pick('ar')} testID="lang-ar" />
        <Button
          title="English"
          variant="secondary"
          onPress={() => void pick('en')}
          testID="lang-en"
        />
      </View>
    </SafeAreaView>
  );
}
