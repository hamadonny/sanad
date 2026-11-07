import { kwd } from '@sanad/core';
import { isSupportedLanguage, defaultLanguage } from '@sanad/i18n';
import { colors, radii, spacing, typography } from '@sanad/ui-tokens';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View, useColorScheme } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { layoutDirection } from '../lib/i18n';
import { displayKwd } from '../lib/money';

export default function HomeScreen() {
  const { t, i18n } = useTranslation();
  const language = isSupportedLanguage(i18n.language) ? i18n.language : defaultLanguage;
  const palette = colors[useColorScheme() === 'dark' ? 'dark' : 'light'];

  return (
    <SafeAreaView
      style={[
        styles.screen,
        { backgroundColor: palette.background, direction: layoutDirection(language) },
      ]}
    >
      <Text style={[styles.title, { color: palette.primary }]}>{t('app.name')}</Text>
      <Text style={[styles.subtitle, { color: palette.textMuted }]}>{t('app.tagline')}</Text>

      <View
        style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.border }]}
      >
        <Text style={[styles.cardTitle, { color: palette.text }]}>{t('home.guaranteeBanner')}</Text>
        <Text
          style={[styles.amount, { color: palette.text }]}
          accessibilityLabel={displayKwd(kwd(1000), language)}
        >
          {displayKwd(kwd(1000), language)}
        </Text>
        <Text style={{ color: palette.textMuted }}>{t('home.comingSoon')}</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, padding: spacing.xl, gap: spacing.md },
  title: {
    fontSize: typography.size.display,
    fontWeight: typography.weight.bold,
    textAlign: 'auto',
  },
  subtitle: { fontSize: typography.size.md },
  card: {
    marginTop: spacing.xl,
    padding: spacing.xl,
    borderRadius: radii.lg,
    borderWidth: 1,
    gap: spacing.sm,
  },
  cardTitle: { fontSize: typography.size.lg, fontWeight: typography.weight.medium },
  amount: { fontSize: typography.size.xxl, fontWeight: typography.weight.bold },
});
