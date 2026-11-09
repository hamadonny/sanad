import { Ionicons } from '@expo/vector-icons';
import { Redirect, Tabs } from 'expo-router';
import { useTranslation } from 'react-i18next';
import type { ColorValue } from 'react-native';
import { useAuth } from '../../lib/auth';
import { useTheme } from '../../lib/theme';

export default function TabsLayout() {
  const { t } = useTranslation();
  const { c } = useTheme();
  const signedIn = useAuth((s) => s.status === 'signedIn');
  if (!signedIn) return <Redirect href="/onboarding/phone" />;
  const icon = (name: keyof typeof Ionicons.glyphMap) =>
    function TabIcon({ color, size }: { color: ColorValue; size: number }) {
      return <Ionicons name={name} color={String(color)} size={size} />;
    };
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: c.primaryText,
        tabBarLabelStyle: { fontFamily: 'ReadexPro_500Medium' },
        tabBarInactiveTintColor: c.textMuted,
        tabBarStyle: { backgroundColor: c.surface, borderTopColor: c.border },
        headerStyle: { backgroundColor: c.surface },
        headerTitleStyle: { color: c.text, fontFamily: 'ReadexPro_700Bold' },
        headerTitleAlign: 'center',
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: t('tabs.home'),
          tabBarIcon: icon('home-outline'),
          tabBarButtonTestID: 'tab-home',
        }}
      />
      <Tabs.Screen
        name="join"
        options={{
          title: t('tabs.join'),
          tabBarIcon: icon('add-circle-outline'),
          tabBarButtonTestID: 'tab-join',
        }}
      />
      <Tabs.Screen
        name="payments"
        options={{
          title: t('tabs.payments'),
          tabBarIcon: icon('card-outline'),
          tabBarButtonTestID: 'tab-payments',
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: t('tabs.profile'),
          tabBarIcon: icon('person-outline'),
          tabBarButtonTestID: 'tab-profile',
        }}
      />
    </Tabs>
  );
}
